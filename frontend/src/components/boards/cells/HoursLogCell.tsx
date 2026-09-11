import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FiPlus, FiTrash2 } from 'react-icons/fi';
import { useUpdateItem, useGroupItems } from '../../../hooks/queries/useItemQueries';
import { useSubitemGroup } from '../../../hooks/queries/useGroupQueries';
import { useSubitemColumns } from '../../../hooks/queries/useColumnQueries';
import { useUndo } from '../../../contexts/UndoContext';
import { useFormulaRecording } from '../../../contexts/FormulaRecordingContext';
import { formulaRefDomKey } from '../../../utils/formulaEngine';
import { HOURS_LOG_MINUTE_STEPS, formatHoursLogDuration, formatHoursLogTimestamp, sumHoursLogMinutes } from '../../../utils/hoursLog';
import { ColumnType } from '../../../types';
import type { Item, Column, HoursLogEntry, HoursLogColumnSettings } from '../../../types';
import CellWrapper from './CellWrapper';

interface Props { item: Item; column: Column }

// ---------------------------------------------------------------------------
// Duration picker (hh:mm, minutes locked to :00/:15/:30/:45) — used both to
// log the very first entry and to add another one from the log list.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Log list popover — shown when the cell already has entries.
// ---------------------------------------------------------------------------

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

  // Most recently logged first.
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const HoursLogCellInner: React.FC<Props> = ({ item, column }) => {
  const rawValue = (item.values[column.id] as HoursLogEntry[] | null | undefined) ?? [];
  const { mutate } = useUpdateItem();
  const { push: pushUndo } = useUndo();
  const { isRecording, insertRef } = useFormulaRecording();
  const cellRef = useRef<HTMLDivElement | null>(null);
  // Explicit override, set only when the user clicks "Add Hours" from an open list — otherwise
  // the view defaults to 'list'/'picker' below based on whether the cell already has entries.
  const [forcedView, setForcedView] = useState<'picker' | null>(null);

  // "Subitems only" — this top-level column auto-mirrors into every subitem group. Once this
  // item has subitems, its own cell goes read-only and shows their combined total instead.
  const isSubitemsOnly = !column.parentGroupId && (column.settings as HoursLogColumnSettings).subitemsOnly === true;
  const { data: subitemGroup } = useSubitemGroup(item.boardId, item.id, isSubitemsOnly);
  const { data: subitemColumns = [] } = useSubitemColumns(item.boardId, subitemGroup?.id ?? '', isSubitemsOnly && !!subitemGroup);
  const mirroredColumn = subitemColumns.find(
    (c) => c.type === ColumnType.HOURS_LOG && (c.settings as HoursLogColumnSettings).mirroredFromColumnId === column.id,
  );
  const { data: subitemsPage } = useGroupItems(
    subitemGroup?.id ?? '',
    undefined,
    500,
    isSubitemsOnly && !!subitemGroup && !!mirroredColumn,
  );
  const subitems = subitemsPage?.data ?? [];
  const hasSubitems = isSubitemsOnly && !!subitemGroup && subitems.length > 0;
  const subitemsTotalMinutes = mirroredColumn
    ? subitems.reduce((sum, si) => sum + sumHoursLogMinutes(si.values[mirroredColumn.id] as HoursLogEntry[] | undefined), 0)
    : 0;

  // Additive, not a replacement: any hours already logged directly on the item before
  // "Subitems only" was turned on (kept rather than cleared at that point) simply keep
  // counting alongside the subitems' total — the item itself just can't gain any more.
  const totalMinutes = hasSubitems ? sumHoursLogMinutes(rawValue) + subitemsTotalMinutes : sumHoursLogMinutes(rawValue);

  const commitEntries = (next: HoursLogEntry[], label: string) => {
    pushUndo({ label, undo: () => mutate({ id: item.id, patch: { values: { [column.id]: rawValue } } }) });
    mutate({ id: item.id, patch: { values: { [column.id]: next } } });
  };

  // While any formula is recording, clicking this cell inserts a reference to its running total
  // (in decimal hours — see formulaEngine's HOURS_LOG handling) instead of opening the picker.
  if (isRecording) {
    return (
      <CellWrapper column={column} isReadOnly>
        {() => (
          <div
            className="px-3 py-2 text-sm text-gray-700 truncate w-full text-center cursor-pointer hover:bg-indigo-100/60 transition-colors"
            onMouseDown={(e) => {
              e.preventDefault();
              insertRef({ kind: 'b', boardId: item.boardId, columnId: column.id, itemId: item.id });
            }}
            title="Add this cell's total hours to the formula"
            aria-label={`Add ${column.name} total for ${item.name} to the formula`}
            data-formula-insertable="true"
            data-formula-cell-key={formulaRefDomKey({ kind: 'b', boardId: item.boardId, columnId: column.id, itemId: item.id })}
          >
            {totalMinutes > 0 ? formatHoursLogDuration(totalMinutes) : <span className="text-gray-300 text-xs">—</span>}
          </div>
        )}
      </CellWrapper>
    );
  }

  // Item has subitems and this column mirrors into them — show their total, read-only. No
  // entries can be logged on the parent itself while it's rolling up its subitems' hours.
  if (hasSubitems) {
    return (
      <CellWrapper column={column} isReadOnly>
        {() => (
          <div
            className="px-3 py-2 text-sm text-gray-700 truncate w-full text-center"
            title="Total logged hours across this item's subitems"
            aria-label={`${column.name} total across subitems for ${item.name}`}
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
    <CellWrapper column={column}>
      {(isEditing, stopEdit) => {
        const view: 'list' | 'picker' | null = !isEditing ? null : (forcedView ?? (rawValue.length > 0 ? 'list' : 'picker'));

        const close = () => { setForcedView(null); stopEdit(); };

        const handleAdd = (minutes: number) => {
          const entry: HoursLogEntry = { id: crypto.randomUUID(), minutes, loggedAt: new Date().toISOString() };
          commitEntries([...rawValue, entry], `Logged ${formatHoursLogDuration(minutes)} on "${item.name}"`);
          close();
        };

        const handleRemove = (id: string) => {
          const next = rawValue.filter((e) => e.id !== id);
          commitEntries(next, `Removed a logged entry on "${item.name}"`);
          // Nothing left to list — close rather than flash an empty popover.
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

const HoursLogCell = React.memo(HoursLogCellInner);
export default HoursLogCell;
