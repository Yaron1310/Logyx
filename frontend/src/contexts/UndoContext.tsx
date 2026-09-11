import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as wm from '../services/workManagementService';

export interface UndoAction {
  label: string;
  undo: () => void;
  /**
   * Optional serializable description of this undo action. When present, the action
   * survives a page reload (persisted to sessionStorage) by re-deriving the `undo`
   * function from this descriptor on the next load, instead of relying on the
   * in-memory closure above (which cannot survive a reload).
   *
   * Only add a `persist` descriptor for actions whose reversal is a plain server call
   * with no dependency on other in-memory state (e.g. restoring a soft-deleted record).
   */
  persist?: PersistableUndo;
}

export type PersistableUndo =
  | { type: 'restoreItem'; itemId: string }
  | { type: 'restoreGroup'; boardId: string; groupId: string };

interface StoredUndoEntry {
  id: string;
  label: string;
  persist: PersistableUndo;
  createdAt: number;
}

interface UndoContextValue {
  push: (action: UndoAction) => void;
  undo: (count?: number) => void;
  history: UndoAction[];
  canUndo: boolean;
}

const UndoContext = createContext<UndoContextValue>({
  push: () => {},
  undo: () => {},
  history: [],
  canUndo: false,
});

const MAX_HISTORY = 20;
const STORAGE_KEY = 'logyx.undoHistory.v1';
// Keep persisted undo entries actionable only while the underlying soft-deleted
// record is still expected to be recoverable server-side.
const PERSIST_TTL_MS = 24 * 60 * 60 * 1000;

const readStoredEntries = (): StoredUndoEntry[] => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredUndoEntry[];
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - PERSIST_TTL_MS;
    return parsed.filter((e) => e && e.createdAt >= cutoff).slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
};

const writeStoredEntries = (entries: StoredUndoEntry[]) => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
  } catch {
    // Storage unavailable/full — persisted undo is best-effort only.
  }
};

const removeStoredEntry = (id: string) => {
  writeStoredEntries(readStoredEntries().filter((e) => e.id !== id));
};

export const UndoProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [history, setHistory] = useState<UndoAction[]>([]);
  const qc = useQueryClient();
  // Tracks the persisted-entry id (if any) backing each live history entry, by position,
  // so `undo()` can also clear it from sessionStorage once replayed.
  const persistedIdsRef = useRef<(string | undefined)[]>([]);

  const runPersistedRestore = useCallback(async (persist: PersistableUndo) => {
    if (persist.type === 'restoreItem') {
      await wm.restoreItem(persist.itemId);
    } else if (persist.type === 'restoreGroup') {
      await wm.restoreGroup(persist.boardId, persist.groupId);
    }
    void qc.invalidateQueries({ queryKey: ['items'] });
    void qc.invalidateQueries({ queryKey: ['groups'] });
  }, [qc]);

  // On mount, rehydrate any undo actions that survived a reload (e.g. "delete item" /
  // "delete group") so the undo button/history keeps working after a refresh.
  useEffect(() => {
    const stored = readStoredEntries();
    if (!stored.length) return;
    setHistory(stored.map((entry) => ({
      label: entry.label,
      undo: () => { void runPersistedRestore(entry.persist); },
      persist: entry.persist,
    })));
    persistedIdsRef.current = stored.map((e) => e.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const push = useCallback((action: UndoAction) => {
    let storedId: string | undefined;
    if (action.persist) {
      storedId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const entry: StoredUndoEntry = {
        id: storedId,
        label: action.label,
        persist: action.persist,
        createdAt: Date.now(),
      };
      writeStoredEntries([entry, ...readStoredEntries()]);
    }
    persistedIdsRef.current = [storedId, ...persistedIdsRef.current].slice(0, MAX_HISTORY);
    setHistory((prev) => [action, ...prev].slice(0, MAX_HISTORY));
  }, []);

  const undo = useCallback((count = 1) => {
    setHistory((prev) => {
      if (!prev.length) return prev;
      const n = Math.min(count, prev.length);
      prev.slice(0, n).forEach((a) => a.undo());
      persistedIdsRef.current.slice(0, n).forEach((id) => { if (id) removeStoredEntry(id); });
      persistedIdsRef.current = persistedIdsRef.current.slice(n);
      return prev.slice(n);
    });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo]);

  return (
    <UndoContext.Provider value={{ push, undo, history, canUndo: history.length > 0 }}>
      {children}
    </UndoContext.Provider>
  );
};

export const useUndo = () => useContext(UndoContext);
