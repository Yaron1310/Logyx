import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { FiX, FiSettings, FiPlus, FiTrash2, FiMenu, FiShield } from 'react-icons/fi';
import ColorPickerPopover, { PRESET_COLORS } from './ColorPickerPopover';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useUpdateColumn } from '../../hooks/queries/useColumnQueries';
import { useUpdatePersonalColumn } from '../../hooks/queries/usePersonalHubQueries';
import { useAuthSession } from '../../hooks/useAuthSession';
import * as wm from '../../services/workManagementService';
import { ColumnType, UserRole } from '../../types';
import type {
  Column,
  Item,
  PersonalColumn,
  StatusOption,
  DropdownOption,
  TextColumnSettings,
  NumberColumnSettings,
  StatusColumnSettings,
  DropdownColumnSettings,
  SimpleFormulaColumnSettings,
  HoursLogColumnSettings,
  ColumnVisibility,
} from '../../types';
import { COLUMN_VISIBILITY_OPTIONS, DEFAULT_COLUMN_VISIBILITY } from '../../utils/columnVisibilityOptions';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface EditColumnConfigModalProps {
  /** Required in board mode (default); ignored in personal mode. */
  boardId?: string;
  column: Column | PersonalColumn;
  onClose: () => void;
  mode?: 'board' | 'personal';
  /** Personal mode only: whose hub this column belongs to — undefined for your own. */
  personalOwnerId?: string;
}

interface SortableStatusOptionProps {
  opt: StatusOption;
  idx: number;
  openColorPickerIdx: number | null;
  colorPickerRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  onColorPickerToggle: (idx: number) => void;
  onUpdateOption: (idx: number, field: 'label' | 'color', value: string) => void;
  onRemoveOption: (idx: number) => void;
  usedColors: string[];
}

const SortableStatusOption: React.FC<SortableStatusOptionProps> = ({
  opt,
  idx,
  openColorPickerIdx,
  colorPickerRefs,
  onColorPickerToggle,
  onUpdateOption,
  onRemoveOption,
  usedColors,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: opt.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2">
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing flex-shrink-0 p-0.5"
        aria-label={`Drag to reorder ${opt.label}`}
      >
        <FiMenu size={14} aria-hidden="true" />
      </button>
      <div
        className="relative flex-shrink-0"
        ref={(el) => { colorPickerRefs.current[idx] = el; }}
      >
        <button
          type="button"
          aria-label={`Color for option ${opt.label}`}
          onClick={() => onColorPickerToggle(idx)}
          className="w-7 h-7 rounded border border-gray-300 cursor-pointer hover:border-gray-500 transition-colors"
          style={{ backgroundColor: opt.color }}
        />
        {openColorPickerIdx === idx && (
          <div className="absolute left-0 top-full mt-1 z-[60] bg-white border border-gray-200 rounded shadow-lg w-[168px]">
            <ColorPickerPopover
              value={opt.color}
              onChange={(c) => { onUpdateOption(idx, 'color', c); onColorPickerToggle(-1); }}
              usedColors={usedColors}
            />
          </div>
        )}
      </div>
      <input
        type="text"
        value={opt.label}
        onChange={(e) => onUpdateOption(idx, 'label', e.target.value)}
        className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        aria-label={`Label for option ${idx + 1}`}
      />
      <button
        type="button"
        onClick={() => onRemoveOption(idx)}
        className="text-gray-400 hover:text-red-500 transition-colors p-1 flex-shrink-0"
        aria-label={`Remove option ${opt.label}`}
      >
        <FiTrash2 size={13} aria-hidden="true" />
      </button>
    </div>
  );
};


const EditColumnConfigModal: React.FC<EditColumnConfigModalProps> = ({ boardId, column, onClose, mode = 'board', personalOwnerId }) => {
  const isPersonal = mode === 'personal';
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  const { mutateAsync: updateBoardColumn, isPending: isPendingBoard } = useUpdateColumn(boardId ?? '');
  const { mutateAsync: updatePersonalColumn, isPending: isPendingPersonal } = useUpdatePersonalColumn(personalOwnerId);
  const isPendingSave = isPersonal ? isPendingPersonal : isPendingBoard;
  const [error, setError] = useState('');
  const { user } = useAuthSession();
  const isOrgAdmin =
    user?.role === UserRole.ORGANIZATION_ADMIN || user?.role === UserRole.SYSTEM_ADMIN;

  // VISIBILITY (top-level board columns only — personal/subitem columns don't carry it)
  const isSubitemColumn = !isPersonal && !!(column as Column).parentGroupId;
  const showVisibility = !isPersonal && !isSubitemColumn;

  // HOURS_LOG — "Subitems only" (org admins, top-level columns only)
  const hoursLogSettings = column.settings as HoursLogColumnSettings;
  const showSubitemsOnly = !isPersonal && !isSubitemColumn && isOrgAdmin && column.type === ColumnType.HOURS_LOG;
  const [subitemsOnly, setSubitemsOnly] = useState(hoursLogSettings.subitemsOnly ?? false);
  const turningOnSubitemsOnly = showSubitemsOnly && subitemsOnly && !hoursLogSettings.subitemsOnly;
  const [isBackfilling, setIsBackfilling] = useState(false);
  // Set once items-with-subitems already holding their own logged hours are found while turning
  // "Subitems only" on — holds the save until the admin picks what to do with them (see below).
  const [legacyConfirm, setLegacyConfirm] = useState<{ items: Item[] } | null>(null);
  const isPending = isPendingSave || isBackfilling;
  const [visibility, setVisibility] = useState<ColumnVisibility>(
    (column as Column).visibility ?? DEFAULT_COLUMN_VISIBILITY,
  );

  // TEXT
  const textSettings = column.settings as TextColumnSettings;
  const [maxLength, setMaxLength] = useState(
    textSettings.maxLength != null ? String(textSettings.maxLength) : '',
  );
  const [richText, setRichText] = useState(textSettings.richText ?? false);

  // NUMBER
  const numSettings = column.settings as NumberColumnSettings;
  const [unit, setUnit] = useState(numSettings.unit ?? '');
  const [precision, setPrecision] = useState(
    numSettings.precision != null ? String(numSettings.precision) : '',
  );

  // SIMPLE_FORMULA
  const formulaSettings = column.settings as SimpleFormulaColumnSettings;
  const [formulaUnit, setFormulaUnit] = useState(formulaSettings.unit ?? '');
  const [formulaPercentMultiply, setFormulaPercentMultiply] = useState(formulaSettings.percentAutoMultiply ?? true);
  const [formulaApplyScope, setFormulaApplyScope] = useState<'all' | 'perCell'>(
    formulaSettings.applyScope ?? 'perCell',
  );

  // STATUS
  const statusSettings = column.settings as StatusColumnSettings;
  const [statusOptions, setStatusOptions] = useState<StatusOption[]>(
    statusSettings.options ? [...statusSettings.options] : [],
  );
  const [defaultStatusId, setDefaultStatusId] = useState(statusSettings.defaultStatusId ?? '');

  // DROPDOWN
  const dropdownSettings = column.settings as DropdownColumnSettings;
  const [dropdownOptions, setDropdownOptions] = useState<DropdownOption[]>(
    dropdownSettings.options ? [...dropdownSettings.options] : [],
  );
  const [dropdownMultiple, setDropdownMultiple] = useState(dropdownSettings.multiple ?? false);

  const [openColorPickerIdx, setOpenColorPickerIdx] = useState<number | null>(null);
  const colorPickerRefs = useRef<(HTMLDivElement | null)[]>([]);

  const sensors = useSensors(useSensor(PointerSensor));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setStatusOptions((prev) => {
        const oldIdx = prev.findIndex((o) => o.id === active.id);
        const newIdx = prev.findIndex((o) => o.id === over.id);
        return arrayMove(prev, oldIdx, newIdx);
      });
    }
  };

  useEffect(() => {
    if (openColorPickerIdx === null) return;
    const handler = (e: MouseEvent) => {
      const ref = colorPickerRefs.current[openColorPickerIdx];
      if (ref && !ref.contains(e.target as Node)) setOpenColorPickerIdx(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openColorPickerIdx]);

  const addStatusOption = () => {
    const id = `opt_${Date.now()}`;
    const color = PRESET_COLORS[statusOptions.length % PRESET_COLORS.length];
    setStatusOptions((prev) => [...prev, { id, label: 'New Option', color }]);
  };

  const updateStatusOption = (idx: number, field: 'label' | 'color', value: string) => {
    setStatusOptions((prev) => prev.map((opt, i) => (i === idx ? { ...opt, [field]: value } : opt)));
  };

  const removeStatusOption = (idx: number) => {
    const removed = statusOptions[idx];
    setStatusOptions((prev) => prev.filter((_, i) => i !== idx));
    if (defaultStatusId === removed.id) setDefaultStatusId('');
  };

  const addDropdownOption = () => {
    const id = `opt_${Date.now()}`;
    setDropdownOptions((prev) => [...prev, { id, label: 'New Option' }]);
  };

  const updateDropdownOption = (idx: number, label: string) => {
    setDropdownOptions((prev) => prev.map((opt, i) => (i === idx ? { ...opt, label } : opt)));
  };

  const removeDropdownOption = (idx: number) => {
    setDropdownOptions((prev) => prev.filter((_, i) => i !== idx));
  };

  const buildSettings = () => {
    switch (column.type) {
      case ColumnType.TEXT:
        return { ...(maxLength ? { maxLength: parseInt(maxLength, 10) } : {}), richText };
      case ColumnType.NUMBER:
        return { ...(unit ? { unit } : {}), ...(precision ? { precision: parseInt(precision, 10) } : {}) };
      case ColumnType.SIMPLE_FORMULA:
        return {
          defaultFormula: formulaSettings.defaultFormula,
          ...(formulaUnit ? { unit: formulaUnit } : {}),
          ...(formulaUnit === '%' ? { percentAutoMultiply: formulaPercentMultiply } : {}),
          ...(formulaSettings.applyScope ? { applyScope: formulaApplyScope } : {}),
        };
      case ColumnType.STATUS:
        return { options: statusOptions, ...(defaultStatusId ? { defaultStatusId } : {}) };
      case ColumnType.DROPDOWN:
        return { options: dropdownOptions, multiple: dropdownMultiple };
      case ColumnType.HOURS_LOG:
        return { ...(subitemsOnly ? { subitemsOnly: true } : {}) };
      default:
        return column.settings;
    }
  };

  /** Saves the column, backfilling the "Subitems only" mirror column into every existing
   *  subitem group when that box was just checked. `legacyAction` is only meaningful on that
   *  path: unset the first time through (to discover items-with-subitems that already hold
   *  their own logged hours and pause for the admin's choice via legacyConfirm), then 'keep'
   *  (do nothing — their old entries simply add into the parent's now-merged total) or 'clear'
   *  (wipe those entries first) once the admin has answered. */
  const performSave = async (legacyAction?: 'keep' | 'clear') => {
    setError('');
    setIsBackfilling(true);
    try {
      if (!isPersonal && turningOnSubitemsOnly && boardId) {
        const groups = await wm.listAllSubitemGroups(boardId);

        if (!legacyAction && !legacyConfirm) {
          const parentItemIds = [...new Set(groups.map((g) => g.parentItemId).filter((id): id is string => !!id))];
          const parentItems = await Promise.all(parentItemIds.map((id) => wm.getItem(id)));
          const affected = parentItems.filter((it) => {
            const v = it.values[column.id];
            return Array.isArray(v) && v.length > 0;
          });
          if (affected.length > 0) {
            setLegacyConfirm({ items: affected });
            setIsBackfilling(false);
            return;
          }
        }

        if (legacyAction === 'clear' && legacyConfirm) {
          await Promise.all(
            legacyConfirm.items.map((item) => wm.updateItem(item.id, { values: { [column.id]: [] } })),
          );
        }

        const existingSubitemColumns = await wm.listAllSubitemColumns(boardId);
        const mirroredGroupIds = new Set(
          existingSubitemColumns
            .filter((c) => c.type === ColumnType.HOURS_LOG && (c.settings as HoursLogColumnSettings).mirroredFromColumnId === column.id)
            .map((c) => c.parentGroupId),
        );
        await Promise.all(
          groups
            .filter((g) => !mirroredGroupIds.has(g.id))
            .map((g) =>
              wm.createColumn(boardId, {
                name: column.name,
                type: ColumnType.HOURS_LOG,
                settings: { mirroredFromColumnId: column.id },
                parentGroupId: g.id,
              }),
            ),
        );
      }

      if (isPersonal) {
        await updatePersonalColumn({ id: column.id, patch: { settings: buildSettings() } });
      } else {
        await updateBoardColumn({
          id: column.id,
          patch: { settings: buildSettings(), ...(showVisibility ? { visibility } : {}) },
        });
      }
      setLegacyConfirm(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration.');
    } finally {
      setIsBackfilling(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (column.type === ColumnType.STATUS && statusOptions.length === 0) {
      setError('Status column requires at least one option.');
      return;
    }
    void performSave();
  };

  const TITLES: Partial<Record<ColumnType, string>> = {
    [ColumnType.TEXT]: 'Text Settings',
    [ColumnType.NUMBER]: 'Number Settings',
    [ColumnType.STATUS]: 'Status Settings',
    [ColumnType.DROPDOWN]: 'Dropdown Settings',
    [ColumnType.SIMPLE_FORMULA]: 'Formula Settings',
    [ColumnType.HOURS_LOG]: 'Hours Log Settings',
  };

  const modalRoot = document.getElementById('modal-root');
  if (!modalRoot) return null;

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-col-config-title"
    >
      <div ref={dialogRef} className="bg-white rounded-xl shadow-xl w-full max-h-[90vh] flex flex-col" style={{ maxWidth: '32rem' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
              <FiSettings className="text-indigo-600" size={16} aria-hidden="true" />
            </div>
            <div>
              <h2 id="edit-col-config-title" className="text-base font-semibold text-gray-800">
                Settings
              </h2>
              <p className="text-xs text-gray-400">{column.name} · {TITLES[column.type] ?? 'Column Settings'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors rounded-md p-1"
            aria-label="Close dialog"
            data-modal-escape
          >
            <FiX size={16} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} noValidate className="flex flex-col min-h-0 flex-1">
          <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">

            {/* VISIBILITY */}
            {showVisibility && (
              <div className="space-y-2">
                <label htmlFor="edit-col-visibility" className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <FiShield size={12} className="text-gray-400" aria-hidden="true" />
                  Visibility
                </label>
                <select
                  id="edit-col-visibility"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as ColumnVisibility)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {COLUMN_VISIBILITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500">
                  {COLUMN_VISIBILITY_OPTIONS.find((o) => o.value === visibility)?.desc}
                  {' — hidden from viewers without access, but formulas can still reference this column.'}
                </p>
              </div>
            )}

            {/* TEXT */}
            {column.type === ColumnType.TEXT && (
              <div className="space-y-3">
                <div className="flex items-end gap-4">
                  <div className="flex-1">
                    <label htmlFor="edit-text-maxlen" className="block text-xs text-gray-600 mb-1">
                      Max Length
                    </label>
                    <input
                      id="edit-text-maxlen"
                      type="number"
                      value={maxLength}
                      onChange={(e) => setMaxLength(e.target.value)}
                      placeholder="Unlimited"
                      min={1}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer pb-1.5">
                    <input
                      type="checkbox"
                      checked={richText}
                      onChange={(e) => setRichText(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      aria-label="Edit as rich text in a sidebar"
                    />
                    Rich text
                  </label>
                </div>
              </div>
            )}

            {/* NUMBER */}
            {column.type === ColumnType.NUMBER && (
              <div className="space-y-3">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label htmlFor="edit-num-unit" className="block text-xs text-gray-600 mb-1">
                      Unit
                    </label>
                    <input
                      id="edit-num-unit"
                      type="text"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      placeholder="e.g. $, %, kg"
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="w-32">
                    <label htmlFor="edit-num-precision" className="block text-xs text-gray-600 mb-1">
                      Decimal Places
                    </label>
                    <input
                      id="edit-num-precision"
                      type="number"
                      value={precision}
                      onChange={(e) => setPrecision(e.target.value)}
                      placeholder="0"
                      min={0}
                      max={10}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* SIMPLE_FORMULA */}
            {column.type === ColumnType.SIMPLE_FORMULA && (
              <div className="space-y-3">
                <div>
                  <label htmlFor="edit-formula-unit" className="block text-xs text-gray-600 mb-1">
                    Unit
                  </label>
                  <input
                    id="edit-formula-unit"
                    type="text"
                    value={formulaUnit}
                    onChange={(e) => setFormulaUnit(e.target.value)}
                    placeholder="e.g. $, %, kg"
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                {formulaUnit === '%' && (
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formulaPercentMultiply}
                      onChange={(e) => setFormulaPercentMultiply(e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      aria-label="Multiply value by 100 for percentage display"
                    />
                    Multiply by 100 (e.g. 0.42 → 42%)
                  </label>
                )}
                {/* Only shown once the "apply to all / just this cell" question has been answered
                    at least once for this column — before that, the question modal is what sets
                    it, not this toggle. */}
                {formulaSettings.applyScope && (
                  <div>
                    <label htmlFor="edit-formula-scope" className="block text-xs text-gray-600 mb-1">
                      New formulas apply to
                    </label>
                    <select
                      id="edit-formula-scope"
                      value={formulaApplyScope}
                      onChange={(e) => setFormulaApplyScope(e.target.value as 'all' | 'perCell')}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="perCell">Just the cell being edited</option>
                      <option value="all">All cells in this column</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      Controls whether recording a new formula in this column updates every cell or only the one being edited.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* STATUS */}
            {column.type === ColumnType.STATUS && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Status Options</p>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={statusOptions.map((o) => o.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                      {statusOptions.map((opt, idx) => (
                        <SortableStatusOption
                          key={opt.id}
                          opt={opt}
                          idx={idx}
                          openColorPickerIdx={openColorPickerIdx}
                          colorPickerRefs={colorPickerRefs}
                          onColorPickerToggle={(i) => setOpenColorPickerIdx(openColorPickerIdx === i ? null : i)}
                          onUpdateOption={updateStatusOption}
                          onRemoveOption={removeStatusOption}
                          usedColors={statusOptions.map((o) => o.color)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
                <button
                  type="button"
                  onClick={addStatusOption}
                  className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 mt-1"
                  aria-label="Add status option"
                >
                  <FiPlus size={13} aria-hidden="true" />
                  Add Option
                </button>
                {statusOptions.length > 0 && (
                  <div className="pt-2 border-t border-gray-100 mt-2">
                    <label htmlFor="edit-default-status" className="block text-xs text-gray-600 mb-1">
                      Default status for new items
                    </label>
                    <select
                      id="edit-default-status"
                      value={defaultStatusId}
                      onChange={(e) => setDefaultStatusId(e.target.value)}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      aria-label="Default status for new items"
                    >
                      <option value="">None</option>
                      {statusOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* DROPDOWN */}
            {column.type === ColumnType.DROPDOWN && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Dropdown Options</p>
                {dropdownOptions.map((opt, idx) => (
                  <div key={opt.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={opt.label}
                      onChange={(e) => updateDropdownOption(idx, e.target.value)}
                      className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      aria-label={`Label for option ${idx + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() => removeDropdownOption(idx)}
                      className="text-gray-400 hover:text-red-500 transition-colors p-1 flex-shrink-0"
                      aria-label={`Remove option ${opt.label}`}
                    >
                      <FiTrash2 size={13} aria-hidden="true" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addDropdownOption}
                  className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 mt-1"
                  aria-label="Add dropdown option"
                >
                  <FiPlus size={13} aria-hidden="true" />
                  Add Option
                </button>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mt-1">
                  <input
                    type="checkbox"
                    checked={dropdownMultiple}
                    onChange={(e) => setDropdownMultiple(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    aria-label="Allow multiple selections"
                  />
                  Allow multiple selections
                </label>
              </div>
            )}

            {/* HOURS_LOG */}
            {showSubitemsOnly && (
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={subitemsOnly}
                    onChange={(e) => setSubitemsOnly(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    aria-label="Subitems only"
                  />
                  Subitems only
                </label>
                <p className="text-xs text-gray-500">
                  When an item has subitems, this column is auto-added to them and the item's own
                  cell shows only their total — hours can no longer be logged on the item directly.
                  Saving adds it to every existing subitem group too, not just new ones.
                </p>
              </div>
            )}

            {error && (
              <p className="text-xs text-red-600" role="alert">{error}</p>
            )}
          </div>

          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
              aria-label="Cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-60"
              aria-label="Save configuration"
            >
              {isPending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>

      {legacyConfirm && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="legacy-hours-title"
        >
          <div className="bg-white rounded-xl shadow-xl w-full p-5 space-y-3" style={{ maxWidth: '26rem' }}>
            <h2 id="legacy-hours-title" className="text-sm font-semibold text-gray-800">
              {legacyConfirm.items.length} item{legacyConfirm.items.length !== 1 ? 's' : ''} already {legacyConfirm.items.length !== 1 ? 'have' : 'has'} logged hours
            </h2>
            <p className="text-xs text-gray-500">
              {legacyConfirm.items.length !== 1 ? 'These items' : 'This item'} already {legacyConfirm.items.length !== 1 ? 'have' : 'has'} subitems and hours
              logged directly on {legacyConfirm.items.length !== 1 ? 'them' : 'it'}. What should happen to those entries? Either way, logging directly on
              the item will be blocked going forward.
            </p>
            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => void performSave('keep')}
                disabled={isPending}
                className="w-full text-left px-3 py-2 text-sm border border-gray-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50 transition-colors disabled:opacity-60"
                aria-label="Keep existing logged hours and merge them into the subitems total"
              >
                <span className="font-medium text-gray-800">Keep and merge</span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  Existing entries stay and add into the item's total alongside its subitems.
                </span>
              </button>
              <button
                type="button"
                onClick={() => void performSave('clear')}
                disabled={isPending}
                className="w-full text-left px-3 py-2 text-sm border border-gray-200 rounded-lg hover:border-red-300 hover:bg-red-50 transition-colors disabled:opacity-60"
                aria-label="Clear existing logged hours"
              >
                <span className="font-medium text-gray-800">Clear them</span>
                <span className="block text-xs text-gray-500 mt-0.5">
                  Removes those entries — only the subitems' hours will count from now on.
                </span>
              </button>
            </div>
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setLegacyConfirm(null)}
                disabled={isPending}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors disabled:opacity-60"
                aria-label="Cancel"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    modalRoot,
  );
};

export default EditColumnConfigModal;
