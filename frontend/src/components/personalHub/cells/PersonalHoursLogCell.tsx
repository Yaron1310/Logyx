import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FiPlus, FiTrash2 } from 'react-icons/fi';
import { useUpdatePersonalItemValue, usePersonalItemValues } from '../../../hooks/queries/usePersonalHubQueries';
import { useSubitemGroup } from '../../../hooks/queries/useGroupQueries';
import { useGroupItems } from '../../../hooks/queries/useItemQueries';
import { useAuthSession } from '../../../hooks/useAuthSession';
import { useUndo } from '../../../contexts/UndoContext';
import { useFormulaRecording } from '../../../contexts/FormulaRecordingContext';
import { formulaRefDomKey } from '../../../utils/formulaEngine';
import { HOURS_LOG_MINUTE_STEPS, formatHoursLogDuration, formatHoursLogTimestamp, sumHoursLogMinutes } from '../../../utils/hoursLog';
import type { Column, HoursLogColumnSettings, HoursLogEntry } from '../../../types';
import type { PersonalCellProps, PersonalGridContext } from './types';
import CellWrapper from '../../boards/cells/CellWrapper';

interface Props extends PersonalCellProps {
  gridContext?: PersonalGridContext;
}

// Same picker/list UI as the board's HoursLogCell — kept as a separate copy because this cell
// reads/writes personalItemValues (useUpdatePersonalItemValue) instead of item.values, same as
// every other Personal Hub cell (see PersonalColumnCell's file comment for why).

const HOURS_OPTIONS = Array.from({ length: 24 }, (_, i) => i);
type MinuteStep = typeof HOURS_LOG_MINUTE_STEPS[number];

interface DurationPickerProps {
  anchorEl: HTMLElement | null;
  onCommit: (minutes: number) => void;
  onCancel: () => void;
}

const DurationPicker: React.FC<DurationPickerProps> = ({ anchorEl, onCommit, onCancel }) => {
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState<MinuteStep>(0);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    let top = r.bottom + 6;
    let left = r.left;
    const w = 220;
    const h = 140;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8);
    setPos({ top, left });
  }, [anchorEl]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handler); };
  }, [onCancel]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCancel]);

  const total = hours * 60 + minutes;

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 10002, width: 220 }}
      className="bg-white border border-gray-200 rounded-xl shadow-2xl p-3 select-none"
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="Log hours"
    >
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Log hours</p>
      <div className="flex items-center justify-center gap-1.5">
        <select
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
          className="px-2 py-1.5 border border-gray-300 rounded text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
          aria-label="Hours"
        >
          {HOURS_OPTIONS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}</option>)}
        </select>
        <span className="text-gray-400 font-semibold">:</span>
        <select
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value) as MinuteStep)}
          className="px-2 py-1.5 border border-gray-300 rounded text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
          aria-label="Minutes"
        >
          {HOURS_LOG_MINUTE_STEPS.map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
        </select>
      </div>
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Cancel"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => total > 0 && onCommit(total)}
          disabled={total === 0}
          className="px-3 py-1 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-40"
          aria-label="Save logged hours"
        >
          Save
        </button>
      </div>
    </div>
  );
};

interface LogListProps {
  anchorEl: HTMLElement | null;
  entries: HoursLogEntry[];
  onAddClick: () => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

const LogList: React.FC<LogListProps> = ({ anchorEl, entries, onAddClick, onRemove, onClose }) => {
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    let top = r.bottom + 6;
    let left = r.left;
    const w = 260;
    const h = Math.min(320, 90 + entries.length * 34);
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8);
    setPos({ top, left });
  }, [anchorEl, entries.length]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handler); };
  }, [onClose]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const sorted = [...entries].sort((a, b) => (b.loggedAt || '').localeCompare(a.loggedAt || ''));

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 10002, width: 260, maxHeight: 320 }}
      className="bg-white border border-gray-200 rounded-xl shadow-2xl flex flex-col select-none"
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="Logged hours"
    >
      <div className="p-2 border-b border-gray-100 flex-shrink-0">
        <button
          type="button"
          onClick={onAddClick}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
          aria-label="Add hours"
        >
          <FiPlus size={13} aria-hidden="true" />
          Add Hours
        </button>
      </div>
      <div className="overflow-y-auto py-1">
        {sorted.map((entry) => (
          <div
            key={entry.id}
            className="group flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
          >
            <span className="font-medium flex-shrink-0">{formatHoursLogDuration(entry.minutes)}</span>
            <span className="text-gray-400 flex-shrink-0">|</span>
            <span className="text-gray-500 truncate flex-1">{formatHoursLogTimestamp(entry.loggedAt)}</span>
            <button
              type="button"
              onClick={() => onRemove(entry.id)}
              className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              aria-label={`Remove logged entry of ${formatHoursLogDuration(entry.minutes)}`}
            >
              <FiTrash2 size={12} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

const PersonalHoursLogCellInner: React.FC<Props> = ({ column, itemId, itemName, value, editable, gridContext, userId, itemBoardId }) => {
  const { user } = useAuthSession();
  const ownerId = userId ?? user?.id;
  const rawValue = (value as HoursLogEntry[] | null | undefined) ?? [];
  const { mutate } = useUpdatePersonalItemValue(userId);
  const { push: pushUndo } = useUndo();
  const { isRecording, insertRef } = useFormulaRecording();
  const cellRef = useRef<HTMLDivElement | null>(null);
  const [forcedView, setForcedView] = useState<'picker' | null>(null);

  // "Subitems only" — attached here for the viewer, not part of the board. Once this item has
  // subitems the owner is assigned to, its own cell goes read-only and shows their total instead.
  const isSubitemsOnly = (column.settings as HoursLogColumnSettings).subitemsOnly === true;
  const { data: subitemGroup } = useSubitemGroup(itemBoardId ?? '', itemId, isSubitemsOnly && !!itemBoardId);
  const { data: subitemsPage } = useGroupItems(subitemGroup?.id ?? '', undefined, 500, isSubitemsOnly && !!subitemGroup);
  const assignedSubitems = (subitemsPage?.data ?? []).filter((si) => ownerId && (si.assignees ?? []).includes(ownerId));
  const { data: subitemPersonalValues = {} } = usePersonalItemValues(
    assignedSubitems.map((si) => si.id),
    userId,
    assignedSubitems.length > 0,
  );
  const hasSubitems = isSubitemsOnly && assignedSubitems.length > 0;
  const subitemsTotalMinutes = assignedSubitems.reduce(
    (sum, si) => sum + sumHoursLogMinutes(subitemPersonalValues[si.id]?.[column.id] as HoursLogEntry[] | undefined),
    0,
  );

  const totalMinutes = hasSubitems ? subitemsTotalMinutes : sumHoursLogMinutes(rawValue);

  const commitEntries = (next: HoursLogEntry[], label: string) => {
    pushUndo({ label, undo: () => mutate({ itemId, columnId: column.id, value: rawValue }) });
    mutate({ itemId, columnId: column.id, value: next });
  };

  // A cross-board formula is recording: clicks add this cell as a stable-ID reference, same
  // addressing PersonalNumberCell uses ('p' refs are keyed by itemId+columnId).
  if (isRecording) {
    return (
      <div
        role="gridcell"
        className="px-3 py-2 text-sm text-gray-700 truncate w-full text-center cursor-pointer hover:bg-indigo-100/60 transition-colors"
        onMouseDown={(e) => {
          e.preventDefault();
          insertRef({ kind: 'p', boardId: gridContext?.boardId ?? '', columnId: column.id, itemId, ownerId: userId });
        }}
        title="Add this cell's total hours to the formula"
        aria-label={`Add ${column.name} total for ${itemName} to the formula`}
        data-formula-insertable="true"
        data-formula-cell-key={formulaRefDomKey({ kind: 'p', boardId: gridContext?.boardId ?? '', columnId: column.id, itemId, ownerId: userId })}
      >
        {totalMinutes > 0 ? formatHoursLogDuration(totalMinutes) : <span className="text-gray-300 text-xs">—</span>}
      </div>
    );
  }

  if (hasSubitems) {
    return (
      <CellWrapper column={column as unknown as Column} isReadOnly>
        {() => (
          <div
            className="px-3 py-2 text-sm text-gray-700 truncate w-full text-center"
            title="Total logged hours across this item's subitems assigned to you"
            aria-label={`${column.name} total across subitems for ${itemName}`}
          >
            {totalMinutes > 0
              ? formatHoursLogDuration(totalMinutes)
              : <span className="text-gray-300 text-xs">—</span>}
          </div>
        )}
      </CellWrapper>
    );
  }

  return (
    <CellWrapper column={column as unknown as Column} isReadOnly={!editable}>
      {(isEditing, stopEdit) => {
        const view: 'list' | 'picker' | null = !isEditing ? null : (forcedView ?? (rawValue.length > 0 ? 'list' : 'picker'));

        const close = () => { setForcedView(null); stopEdit(); };

        const handleAdd = (minutes: number) => {
          const entry: HoursLogEntry = { id: crypto.randomUUID(), minutes, loggedAt: new Date().toISOString() };
          commitEntries([...rawValue, entry], `Logged ${formatHoursLogDuration(minutes)} on "${itemName}"`);
          close();
        };

        const handleRemove = (id: string) => {
          const next = rawValue.filter((e) => e.id !== id);
          commitEntries(next, `Removed a logged entry on "${itemName}"`);
          if (next.length === 0) close();
        };

        return (
          <div ref={cellRef} className="w-full h-full flex items-center justify-center">
            <div className="px-3 py-2 text-sm text-gray-700 truncate w-full text-center">
              {totalMinutes > 0
                ? formatHoursLogDuration(totalMinutes)
                : <span className="text-gray-300 text-xs italic">Log hours</span>}
            </div>

            {view === 'picker' && createPortal(
              <DurationPicker anchorEl={cellRef.current} onCommit={handleAdd} onCancel={close} />,
              document.body,
            )}

            {view === 'list' && createPortal(
              <LogList
                anchorEl={cellRef.current}
                entries={rawValue}
                onAddClick={() => setForcedView('picker')}
                onRemove={handleRemove}
                onClose={close}
              />,
              document.body,
            )}
          </div>
        );
      }}
    </CellWrapper>
  );
};

export default React.memo(PersonalHoursLogCellInner);
