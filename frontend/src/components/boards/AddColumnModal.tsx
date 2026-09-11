import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import {
  FiX, FiColumns, FiPlus, FiTrash2,
  FiType, FiHash, FiCalendar, FiClock,
  FiFlag, FiUser, FiChevronDown, FiCheckSquare, FiTag,
  FiMail, FiPhone, FiMapPin, FiZap, FiLink, FiShield, FiWatch, FiPaperclip,
} from 'react-icons/fi';
import { useCreateColumn, useColumns, useSubitemColumns, useReorderColumns, useDeleteColumn } from '../../hooks/queries/useColumnQueries';
import { useCreatePersonalColumn, usePersonalColumns, useReorderPersonalColumns, useDeletePersonalColumn, useUpdatePersonalItemValue } from '../../hooks/queries/usePersonalHubQueries';
import { useUpdateItem } from '../../hooks/queries/useItemQueries';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../hooks/queries/queryKeys';
import { ColumnType } from '../../types';
import { calculateColumnWidth } from '../../utils/columnWidths';
import type { StatusOption, DropdownOption, PersonalColumnScope, PersonalColumn, ColumnVisibility, ColumnSettings, Item, PaginatedResponse } from '../../types';
import { COLUMN_VISIBILITY_OPTIONS, DEFAULT_COLUMN_VISIBILITY } from '../../utils/columnVisibilityOptions';
import { canConvertColumnValue, convertColumnValue } from '../../utils/columnTypeConversion';
import { useFocusTrap } from '../../hooks/useFocusTrap';

function isNonEmptyValue(val: unknown): boolean {
  return val !== undefined && val !== null && val !== '' && !(Array.isArray(val) && val.length === 0);
}

/** Board items (optionally scoped to one subitem group) that currently hold a value for
 *  `columnId` — used both to decide whether a "change type" needs a data-loss/convert choice
 *  and, when converting, as the source rows to migrate. */
function collectBoardItemsWithValue(qc: QueryClient, columnId: string, groupId?: string): Item[] {
  const cached = qc.getQueriesData<PaginatedResponse<Item> | Item>({ queryKey: ['items'] });
  const byId = new Map<string, Item>();
  for (const [, data] of cached) {
    if (!data) continue;
    const items: Item[] =
      typeof data === 'object' && data !== null && 'data' in data && Array.isArray((data as PaginatedResponse<Item>).data)
        ? (data as PaginatedResponse<Item>).data
        : typeof data === 'object' && data !== null && 'values' in data
        ? [data as Item]
        : [];
    for (const item of items) {
      if (groupId && item.groupId !== groupId) continue;
      if (isNonEmptyValue(item.values?.[columnId])) byId.set(item.id, item);
    }
  }
  return Array.from(byId.values());
}

/** Personal Hub item values (keyed by itemId) currently holding a value for `columnId`. */
function collectPersonalValuesForColumn(qc: QueryClient, columnId: string): Map<string, unknown> {
  const cached = qc.getQueriesData<Record<string, Record<string, unknown>>>({ queryKey: queryKeys.personalHub.itemValuesRoot });
  const map = new Map<string, unknown>();
  for (const [, data] of cached) {
    if (!data) continue;
    for (const [itemId, values] of Object.entries(data)) {
      const val = values?.[columnId];
      if (isNonEmptyValue(val)) map.set(itemId, val);
    }
  }
  return map;
}

interface AddColumnModalProps {
  /** Real board columns require boardId. Personal columns with scope 'all' don't belong to any single board. */
  boardId?: string;
  onClose: () => void;
  insertAfterColumnId?: string;
  insertBeforeColumnId?: string;
  parentGroupId?: string;
  /**
   * When set, this column is deleted only after the new column is successfully
   * created and positioned in its place — i.e. "Change column type". Nothing is
   * deleted if the user cancels the modal. Not applicable in personal mode.
   */
  replaceColumnId?: string;
  /** The type the replaced column currently has — lets this modal offer to convert its existing
   *  values to whatever new type the user picks, when that conversion is meaningful (e.g. NUMBER
   *  -> TEXT), instead of always warning that the data will be deleted. */
  replaceColumnType?: ColumnType;
  /**
   * 'board' (default) creates a real column on the source board. 'personal' creates
   * a user-owned Personal Hub column instead — same type picker and settings UI,
   * different destination. 'template' doesn't persist anything itself — it just
   * reports the column def back to the caller via onSave (used by the Personal Hub
   * template editor, which stages edits locally and saves them all at once).
   * Requires personalScope (and boardId when personalScope is 'board').
   */
  mode?: 'board' | 'personal' | 'template';
  personalScope?: PersonalColumnScope;
  /** Personal mode only: whose hub this column belongs to — undefined for your own. */
  personalOwnerId?: string;
  /** template mode only: receives the built column def instead of any backend call. */
  onSave?: (column: { name: string; type: ColumnType; settings: ColumnSettings }) => void;
}

export const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  [ColumnType.TEXT]: 'Text',
  [ColumnType.NUMBER]: 'Number',
  [ColumnType.DATE]: 'Date',
  [ColumnType.STATUS]: 'Status',
  [ColumnType.PERSON]: 'Person',
  [ColumnType.DROPDOWN]: 'Dropdown',
  [ColumnType.CHECKBOX]: 'Checkbox',
  [ColumnType.TAGS]: 'Tags',
  [ColumnType.TIME]: 'Time',
  [ColumnType.EMAIL]: 'Email',
  [ColumnType.PHONE]: 'Phone',
  [ColumnType.LOCATION]: 'Location',
  [ColumnType.LINK]: 'Link',
  [ColumnType.TIME_RANGE]: 'Time Range',
  [ColumnType.SIMPLE_FORMULA]: 'Formula',
  [ColumnType.HOURS_LOG]: 'Hours Log',
  [ColumnType.FILES]: 'Files',
};

const COLUMN_TYPE_ICONS: Record<ColumnType, React.ReactNode> = {
  [ColumnType.TEXT]: <FiType size={16} aria-hidden="true" />,
  [ColumnType.NUMBER]: <FiHash size={16} aria-hidden="true" />,
  [ColumnType.DATE]: <FiCalendar size={16} aria-hidden="true" />,
  [ColumnType.TIME]: <FiClock size={16} aria-hidden="true" />,
  [ColumnType.TIME_RANGE]: (
    <span className="flex items-center gap-[2px]" aria-hidden="true">
      <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="3" width="12" height="10" rx="1.5" /><line x1="1" y1="6.5" x2="13" y2="6.5" /><line x1="4" y1="1" x2="4" y2="4" /><line x1="10" y1="1" x2="10" y2="4" />
      </svg>
      <svg width="7" height="7" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="1" y1="5" x2="9" y2="5" /><polyline points="6 2 9 5 6 8" />
      </svg>
      <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="3" width="12" height="10" rx="1.5" /><line x1="1" y1="6.5" x2="13" y2="6.5" /><line x1="4" y1="1" x2="4" y2="4" /><line x1="10" y1="1" x2="10" y2="4" />
      </svg>
    </span>
  ),
  [ColumnType.STATUS]: <FiFlag size={16} aria-hidden="true" />,
  [ColumnType.DROPDOWN]: <FiChevronDown size={16} aria-hidden="true" />,
  [ColumnType.CHECKBOX]: <FiCheckSquare size={16} aria-hidden="true" />,
  [ColumnType.PERSON]: <FiUser size={16} aria-hidden="true" />,
  [ColumnType.EMAIL]: <FiMail size={16} aria-hidden="true" />,
  [ColumnType.PHONE]: <FiPhone size={16} aria-hidden="true" />,
  [ColumnType.TAGS]: <FiTag size={16} aria-hidden="true" />,
  [ColumnType.LOCATION]: <FiMapPin size={16} aria-hidden="true" />,
  [ColumnType.LINK]: <FiLink size={16} aria-hidden="true" />,
  [ColumnType.SIMPLE_FORMULA]: <FiZap size={16} aria-hidden="true" />,
  [ColumnType.HOURS_LOG]: <FiWatch size={16} aria-hidden="true" />,
  [ColumnType.FILES]: <FiPaperclip size={16} aria-hidden="true" />,
};

type GroupStyle = {
  dot: string;
  unselectedBg: string;
  unselectedBorder: string;
  unselectedText: string;
  unselectedIcon: string;
  selectedBg: string;
  selectedBorder: string;
  selectedText: string;
  selectedIcon: string;
  hoverBg: string;
  hoverBorder: string;
  hoverText: string;
};

const GROUP_STYLES: Record<string, GroupStyle> = {
  Inputs: {
    dot: 'bg-blue-500',
    unselectedBg: 'bg-blue-50',
    unselectedBorder: 'border-blue-200',
    unselectedText: 'text-blue-600',
    unselectedIcon: 'text-blue-500',
    selectedBg: 'bg-blue-50',
    selectedBorder: 'border-blue-500',
    selectedText: 'text-blue-700',
    selectedIcon: 'text-blue-600',
    hoverBg: 'hover:bg-blue-100',
    hoverBorder: 'hover:border-blue-400',
    hoverText: 'hover:text-blue-800',
  },
  Time: {
    dot: 'bg-violet-500',
    unselectedBg: 'bg-violet-50',
    unselectedBorder: 'border-violet-200',
    unselectedText: 'text-violet-600',
    unselectedIcon: 'text-violet-500',
    selectedBg: 'bg-violet-50',
    selectedBorder: 'border-violet-500',
    selectedText: 'text-violet-700',
    selectedIcon: 'text-violet-600',
    hoverBg: 'hover:bg-violet-100',
    hoverBorder: 'hover:border-violet-400',
    hoverText: 'hover:text-violet-800',
  },
  Selection: {
    dot: 'bg-teal-500',
    unselectedBg: 'bg-teal-50',
    unselectedBorder: 'border-teal-200',
    unselectedText: 'text-teal-600',
    unselectedIcon: 'text-teal-500',
    selectedBg: 'bg-teal-50',
    selectedBorder: 'border-teal-500',
    selectedText: 'text-teal-700',
    selectedIcon: 'text-teal-600',
    hoverBg: 'hover:bg-teal-100',
    hoverBorder: 'hover:border-teal-400',
    hoverText: 'hover:text-teal-800',
  },
  Information: {
    dot: 'bg-orange-500',
    unselectedBg: 'bg-orange-50',
    unselectedBorder: 'border-orange-200',
    unselectedText: 'text-orange-600',
    unselectedIcon: 'text-orange-500',
    selectedBg: 'bg-orange-50',
    selectedBorder: 'border-orange-500',
    selectedText: 'text-orange-700',
    selectedIcon: 'text-orange-600',
    hoverBg: 'hover:bg-orange-100',
    hoverBorder: 'hover:border-orange-400',
    hoverText: 'hover:text-orange-800',
  },
  Calculation: {
    dot: 'bg-yellow-500',
    unselectedBg: 'bg-yellow-50',
    unselectedBorder: 'border-yellow-200',
    unselectedText: 'text-yellow-600',
    unselectedIcon: 'text-yellow-500',
    selectedBg: 'bg-yellow-50',
    selectedBorder: 'border-yellow-500',
    selectedText: 'text-yellow-700',
    selectedIcon: 'text-yellow-600',
    hoverBg: 'hover:bg-yellow-100',
    hoverBorder: 'hover:border-yellow-400',
    hoverText: 'hover:text-yellow-800',
  },
};

const COLUMN_TYPE_GROUPS: { label: string; types: ColumnType[] }[] = [
  { label: 'Inputs', types: [ColumnType.TEXT, ColumnType.NUMBER] },
  { label: 'Time', types: [ColumnType.DATE, ColumnType.TIME, ColumnType.TIME_RANGE, ColumnType.HOURS_LOG] },
  { label: 'Selection', types: [ColumnType.STATUS, ColumnType.DROPDOWN, ColumnType.CHECKBOX, ColumnType.TAGS] },
  { label: 'Information', types: [ColumnType.EMAIL, ColumnType.PHONE, ColumnType.PERSON, ColumnType.LOCATION, ColumnType.LINK, ColumnType.FILES] },
  { label: 'Calculation', types: [ColumnType.SIMPLE_FORMULA] },
];

const BUTTON_DISPLAY_ORDER = ['Inputs', 'Selection', 'Time', 'Calculation', 'Information'];

const TYPE_TO_GROUP: Record<ColumnType, string> = {} as Record<ColumnType, string>;
COLUMN_TYPE_GROUPS.forEach(({ label, types }) => {
  types.forEach((t) => { TYPE_TO_GROUP[t] = label; });
});

// FILES has no Personal Hub cell implementation yet — hide it outside real board columns
// rather than let it fall back to a plain text cell there.
const BOARD_ONLY_TYPES = new Set<ColumnType>([ColumnType.FILES]);

const DEFAULT_COLUMN_TYPE = ColumnType.TEXT;

const STATUS_PALETTE = [
  '#6B7280', '#10B981', '#F59E0B', '#EF4444',
  '#3B82F6', '#8B5CF6', '#EC4899', '#14B8A6',
];

const AddColumnModal: React.FC<AddColumnModalProps> = ({ boardId, onClose, insertAfterColumnId, insertBeforeColumnId, parentGroupId, replaceColumnId, replaceColumnType, mode = 'board', personalScope, personalOwnerId, onSave }) => {
  const isPersonal = mode === 'personal';
  const isTemplate = mode === 'template';
  const qc = useQueryClient();
  const { mutateAsync: createColumn, isPending: isPendingBoard } = useCreateColumn(boardId ?? '');
  const { mutateAsync: createPersonalColumn, isPending: isPendingPersonal } = useCreatePersonalColumn(personalOwnerId);
  const isPending = isPersonal ? isPendingPersonal : isPendingBoard;
  const { mutateAsync: deleteColumn } = useDeleteColumn(boardId ?? '');
  const { mutateAsync: updateItem } = useUpdateItem();
  const { mutateAsync: updatePersonalItemValue } = useUpdatePersonalItemValue(personalOwnerId);
  const { data: boardColumns = [] } = useColumns(boardId ?? '', !isPersonal && !parentGroupId && !!boardId);
  const { data: subitemColumns = [] } = useSubitemColumns(boardId ?? '', parentGroupId ?? '', !isPersonal && !!parentGroupId);
  const allColumns = parentGroupId ? subitemColumns : boardColumns;
  const { mutateAsync: reorderColumns } = useReorderColumns(boardId ?? '');

  const { data: allPersonalColumns = [] } = usePersonalColumns(personalOwnerId, isPersonal);
  const personalAllScopeColumns = allPersonalColumns.filter((c: PersonalColumn) => c.scope === 'all');
  const { mutateAsync: reorderPersonalColumns } = useReorderPersonalColumns(personalOwnerId);
  const { mutateAsync: deletePersonalColumnMutation } = useDeletePersonalColumn(personalOwnerId);

  const trackedColumns = isPersonal ? personalAllScopeColumns : allColumns;
  const previousColumnsRef = useRef<string[]>([]);
  const hasSubmittedRef = useRef(false);
  const isSubmittingRef = useRef(false);

  // Keep tracking the "before" snapshot up until submit — if the column list hadn't
  // finished loading yet when this modal mounted, a one-time snapshot would freeze at
  // [] and make every existing column look "new" once data arrived, corrupting the
  // insert-position logic below.
  useEffect(() => {
    if (!hasSubmittedRef.current) previousColumnsRef.current = trackedColumns.map(c => c.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackedColumns.map(c => c.id).join(',')]);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  const [name, setName] = useState(COLUMN_TYPE_LABELS[DEFAULT_COLUMN_TYPE]);
  const [type, setType] = useState<ColumnType>(DEFAULT_COLUMN_TYPE);
  const [error, setError] = useState('');

  // The name field is pre-filled with the selected type's label ("Status", "Number", …) and
  // keeps following the type picker until the user types a name of their own. Emptying the
  // field counts as "not customised", so the suggestion comes back on the next type change.
  const hasCustomNameRef = useRef(false);

  const handleNameChange = (value: string) => {
    hasCustomNameRef.current = value.trim() !== '';
    setName(value);
  };

  const handleTypeChange = (nextType: ColumnType) => {
    setType(nextType);
    if (!hasCustomNameRef.current) setName(COLUMN_TYPE_LABELS[nextType]);
  };

  // "Change type" data handling — computed once (the cache won't meaningfully change while this
  // modal is open) so re-renders while picking a type/name don't keep re-scanning every item.
  const [replaceHasData] = useState(() => {
    if (!replaceColumnId) return false;
    return isPersonal
      ? collectPersonalValuesForColumn(qc, replaceColumnId).size > 0
      : collectBoardItemsWithValue(qc, replaceColumnId, parentGroupId).length > 0;
  });
  const [dataAction, setDataAction] = useState<'convert' | 'discard'>('convert');
  const canConvertData = !!replaceColumnType && canConvertColumnValue(replaceColumnType, type);

  // TEXT
  const [maxLength, setMaxLength] = useState('');
  const [richText, setRichText] = useState(false);

  // NUMBER
  const [unit, setUnit] = useState('');
  const [precision, setPrecision] = useState('');

  // SIMPLE_FORMULA
  const [formulaUnit, setFormulaUnit] = useState('');
  const [formulaPercentMultiply, setFormulaPercentMultiply] = useState(true);

  // DATE
  const [includeTime, setIncludeTime] = useState(false);

  // STATUS
  const [statusOptions, setStatusOptions] = useState<StatusOption[]>([
    { id: 'todo', label: 'To Do', color: '#6B7280' },
    { id: 'in_progress', label: 'In Progress', color: '#3B82F6' },
    { id: 'done', label: 'Done', color: '#10B981' },
  ]);
  const [defaultStatusId, setDefaultStatusId] = useState('');

  // PERSON
  const [personMultiple, setPersonMultiple] = useState(true);

  // DROPDOWN
  const [dropdownOptions, setDropdownOptions] = useState<DropdownOption[]>([]);
  const [dropdownMultiple, setDropdownMultiple] = useState(false);

  // TAGS
  const [allowCustom, setAllowCustom] = useState(true);

  // VISIBILITY (board columns only)
  const [visibility, setVisibility] = useState<ColumnVisibility>(DEFAULT_COLUMN_VISIBILITY);

  const addStatusOption = () => {
    const id = `opt_${Date.now()}`;
    const color = STATUS_PALETTE[statusOptions.length % STATUS_PALETTE.length];
    setStatusOptions((prev) => [...prev, { id, label: 'New Option', color }]);
  };

  const updateStatusOption = (idx: number, field: 'label' | 'color', value: string) => {
    setStatusOptions((prev) => prev.map((opt, i) => (i === idx ? { ...opt, [field]: value } : opt)));
  };

  const removeStatusOption = (idx: number) => {
    setStatusOptions((prev) => prev.filter((_, i) => i !== idx));
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
    switch (type) {
      case ColumnType.TEXT:
        return { ...(maxLength ? { maxLength: parseInt(maxLength, 10) } : {}), richText };
      case ColumnType.NUMBER:
        return { ...(unit ? { unit } : {}), ...(precision ? { precision: parseInt(precision, 10) } : {}) };
      case ColumnType.DATE:
        return { includeTime };
      case ColumnType.STATUS:
        return { options: statusOptions, ...(defaultStatusId ? { defaultStatusId } : {}) };
      case ColumnType.PERSON:
        return { multiple: personMultiple };
      case ColumnType.DROPDOWN:
        return { options: dropdownOptions, multiple: dropdownMultiple };
      case ColumnType.TAGS:
        return { allowCustom };
      case ColumnType.SIMPLE_FORMULA:
        return {
          defaultFormula: '',
          ...(formulaUnit ? { unit: formulaUnit } : {}),
          ...(formulaUnit === '%' ? { percentAutoMultiply: formulaPercentMultiply } : {}),
        };
      default:
        return {};
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || isPending) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Column name is required.');
      return;
    }
    if (type === ColumnType.STATUS && statusOptions.length === 0) {
      setError('Status column requires at least one option.');
      return;
    }

    setError('');
    hasSubmittedRef.current = true;
    isSubmittingRef.current = true;

    if (isTemplate) {
      onSave?.({ name: trimmedName, type, settings: buildSettings() });
      isSubmittingRef.current = false;
      onClose();
      return;
    }

    if (isPersonal) {
      if (!personalScope || (personalScope === 'board' && !boardId)) { isSubmittingRef.current = false; return; }
      try {
        await createPersonalColumn({
          name: trimmedName,
          type,
          settings: buildSettings(),
          scope: personalScope,
          ...(personalScope === 'board' ? { boardId } : {}),
        });

        if (personalScope === 'all') {
          await qc.refetchQueries({ queryKey: queryKeys.personalHub.columnsRoot });
          const rawColumns = (qc.getQueryData(queryKeys.personalHub.columns(personalOwnerId)) as PersonalColumn[] | undefined) ?? [];
          const updatedColumns = [...rawColumns]
            .filter((c) => c.scope === 'all')
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

          const effectiveInsertBefore = replaceColumnId ?? insertBeforeColumnId;
          let newColumnId: string | undefined;

          if (updatedColumns.length > 0) {
            newColumnId = updatedColumns.find((col) => !previousColumnsRef.current.includes(col.id))?.id;

            if (newColumnId) {
              let targetIndex = updatedColumns.length - 1;

              if (insertAfterColumnId) {
                const afterIdx = updatedColumns.findIndex((c) => c.id === insertAfterColumnId);
                if (afterIdx !== -1) targetIndex = afterIdx + 1;
              } else if (effectiveInsertBefore) {
                const beforeIdx = updatedColumns.findIndex((c) => c.id === effectiveInsertBefore);
                if (beforeIdx !== -1) targetIndex = beforeIdx;
              }

              const currentIndex = updatedColumns.findIndex((c) => c.id === newColumnId);
              if (currentIndex !== -1) {
                const reordered = updatedColumns.filter((c) => c.id !== newColumnId && c.id !== replaceColumnId);
                let insertAt: number;
                if (replaceColumnId) {
                  const replaceIdx = updatedColumns.findIndex((c) => c.id === replaceColumnId);
                  insertAt = updatedColumns.slice(0, replaceIdx).filter((c) => c.id !== newColumnId).length;
                } else {
                  insertAt = Math.min(targetIndex, reordered.length);
                }
                reordered.splice(Math.max(insertAt, 0), 0, updatedColumns[currentIndex]);
                const finalOrder = reordered.map((col, idx) => ({ id: col.id, order: idx }));
                await reorderPersonalColumns(finalOrder);
              }
            }
          }

          if (replaceColumnId) {
            if (newColumnId && replaceColumnType && dataAction === 'convert' && canConvertColumnValue(replaceColumnType, type)) {
              const values = collectPersonalValuesForColumn(qc, replaceColumnId);
              await Promise.all(Array.from(values.entries()).map(([itemId, raw]) => {
                const converted = convertColumnValue(replaceColumnType, type, raw);
                return converted === undefined ? Promise.resolve() : updatePersonalItemValue({ itemId, columnId: newColumnId as string, value: converted });
              }));
            }
            await deletePersonalColumnMutation(replaceColumnId);
          }
        }

        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create column.');
      } finally {
        isSubmittingRef.current = false;
      }
      return;
    }

    if (!boardId) { isSubmittingRef.current = false; return; }
    const scopedQueryKey = parentGroupId
      ? queryKeys.columns.subitem(boardId, parentGroupId)
      : queryKeys.columns.board(boardId);
    try {
      await createColumn({
        name: trimmedName,
        type,
        settings: buildSettings(),
        width: calculateColumnWidth(trimmedName, type),
        visibility,
        ...(parentGroupId ? { parentGroupId } : {}),
      });

      await qc.refetchQueries({ queryKey: scopedQueryKey });
      const rawColumns = qc.getQueryData(scopedQueryKey) as any[] ?? [];

      const updatedColumns = [...rawColumns].sort((a: any, b: any) => {
        const aOrder = typeof a.order === 'number' ? a.order : Infinity;
        const bOrder = typeof b.order === 'number' ? b.order : Infinity;
        if (aOrder !== bOrder) return aOrder - bOrder;
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return aTime - bTime;
      });

      const effectiveInsertBefore = replaceColumnId ?? insertBeforeColumnId;
      let newColumnId: string | undefined;

      if (updatedColumns.length > 0) {
        newColumnId = updatedColumns.find(col => !previousColumnsRef.current.includes(col.id))?.id;

        if (newColumnId) {
          let targetIndex = updatedColumns.length - 1;

          if (insertAfterColumnId) {
            const afterIdx = updatedColumns.findIndex(c => c.id === insertAfterColumnId);
            if (afterIdx !== -1) targetIndex = afterIdx + 1;
          } else if (effectiveInsertBefore) {
            const beforeIdx = updatedColumns.findIndex(c => c.id === effectiveInsertBefore);
            if (beforeIdx !== -1) targetIndex = beforeIdx;
          }

          const currentIndex = updatedColumns.findIndex(c => c.id === newColumnId);
          if (currentIndex !== -1) {
            // Exclude the column being replaced from the reordered list entirely — its
            // slot is taken over by the new column, and it gets deleted right after.
            const reordered = updatedColumns.filter(c => c.id !== newColumnId && c.id !== replaceColumnId);
            let insertAt: number;
            if (replaceColumnId) {
              // Count columns (excluding the new one) that precede the column being
              // replaced — that's exactly where the new column should land.
              const replaceIdx = updatedColumns.findIndex(c => c.id === replaceColumnId);
              insertAt = updatedColumns.slice(0, replaceIdx).filter(c => c.id !== newColumnId).length;
            } else {
              insertAt = Math.min(targetIndex, reordered.length);
            }
            reordered.splice(Math.max(insertAt, 0), 0, updatedColumns[currentIndex]);
            const finalOrder = reordered.map((col, idx) => ({ id: col.id, order: idx }));
            await reorderColumns(finalOrder);
            if (parentGroupId) await qc.invalidateQueries({ queryKey: scopedQueryKey });
          }
        }
      }

      if (replaceColumnId) {
        if (newColumnId && replaceColumnType && dataAction === 'convert' && canConvertColumnValue(replaceColumnType, type)) {
          const items = collectBoardItemsWithValue(qc, replaceColumnId, parentGroupId);
          await Promise.all(items.map((item) => {
            const converted = convertColumnValue(replaceColumnType, type, item.values[replaceColumnId]);
            return converted === undefined ? Promise.resolve() : updateItem({ id: item.id, patch: { values: { [newColumnId as string]: converted } } });
          }));
        }
        await deleteColumn(replaceColumnId);
        await qc.invalidateQueries({ queryKey: scopedQueryKey });
        await qc.invalidateQueries({ queryKey: ['items'] });
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create column.');
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const modalRoot = document.getElementById('modal-root');
  if (!modalRoot) return null;

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-column-title"
    >
      <div ref={dialogRef} className="bg-white rounded-xl shadow-xl w-full max-h-[90vh] flex flex-col" style={{ maxWidth: '40rem' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
              <FiColumns className="text-indigo-600" size={16} aria-hidden="true" />
            </div>
            <h2 id="add-column-title" className="text-lg font-semibold text-gray-800">
              Add Column
            </h2>
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
          <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1">

            {/* Section 1: Column Type */}
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-3">Select column type</p>
              <div className="flex flex-wrap gap-6" role="group" aria-label="Column type selector">
                {BUTTON_DISPLAY_ORDER.map((groupLabel) => {
                  const groupData = COLUMN_TYPE_GROUPS.find(g => g.label === groupLabel);
                  if (!groupData) return null;
                  const { label } = groupData;
                  const types = mode === 'board' ? groupData.types : groupData.types.filter((t) => !BOARD_ONLY_TYPES.has(t));
                  if (types.length === 0) return null;
                  const s = GROUP_STYLES[label];
                  const isInformationGroup = label === 'Information';

                  return (
                    <div key={label} className={isInformationGroup ? 'w-full' : ''}>
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} aria-hidden="true" />
                        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">{label}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {types.map((ct) => {
                          const isSelected = type === ct;
                          return (
                            <button
                              key={ct}
                              type="button"
                              onClick={() => handleTypeChange(ct)}
                              aria-pressed={isSelected}
                              aria-label={`${COLUMN_TYPE_LABELS[ct]} column type`}
                              className={[
                                'flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 transition-all duration-150',
                                'w-[76px] h-[50px] px-1',
                                isSelected
                                  ? `${s.selectedBg} ${s.selectedBorder} ${s.selectedText}`
                                  : `${s.unselectedBg} ${s.unselectedBorder} ${s.unselectedText} ${s.hoverBg} ${s.hoverBorder} ${s.hoverText}`,
                              ].join(' ')}
                            >
                              <span className={isSelected ? s.selectedIcon : s.unselectedIcon}>
                                {COLUMN_TYPE_ICONS[ct]}
                              </span>
                              <span className="text-[11px] font-medium leading-tight text-center">
                                {COLUMN_TYPE_LABELS[ct]}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Change-type data handling — only relevant once a replaced column with existing
                data is switching to a genuinely different type. */}
            {replaceColumnId && replaceColumnType && replaceHasData && replaceColumnType !== type && (
              <div className="pt-1 border-t border-gray-100">
                {canConvertData ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Existing data</p>
                    <p className="text-xs text-gray-600">
                      This column already has data, and {COLUMN_TYPE_LABELS[replaceColumnType]} values can carry over to {COLUMN_TYPE_LABELS[type]}. What should happen to it?
                    </p>
                    <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                      <input
                        type="radio"
                        name="replace-data-action"
                        checked={dataAction === 'convert'}
                        onChange={() => setDataAction('convert')}
                        className="mt-0.5"
                        aria-label="Convert existing values to the new type"
                      />
                      Convert existing values to the new type
                    </label>
                    <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                      <input
                        type="radio"
                        name="replace-data-action"
                        checked={dataAction === 'discard'}
                        onChange={() => setDataAction('discard')}
                        className="mt-0.5"
                        aria-label="Start empty and discard existing values"
                      />
                      Start empty (existing data will be permanently deleted)
                    </label>
                  </div>
                ) : (
                  <p className="text-xs text-red-600" role="alert">
                    This column contains data that will be <strong>permanently deleted</strong> when you change its type. This action cannot be undone.
                  </p>
                )}
              </div>
            )}

            {/* Section 2: Name */}
            <div className="pt-1 border-t border-gray-100">
              <label htmlFor="col-name" className="block text-sm font-semibold text-gray-700 mb-2">
                Column name <span aria-hidden="true" className="text-red-500">*</span>
              </label>
              <input
                id="col-name"
                type="text"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. Priority"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                aria-required="true"
                aria-describedby={error ? 'col-error' : undefined}
              />
            </div>

            {/* Section 3: Type-specific settings */}

            {/* TEXT settings */}
            {type === ColumnType.TEXT && (
              <div className="space-y-3 pt-1 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Text Settings</p>
                <div className="flex items-end gap-4">
                  <div className="flex-1">
                    <label htmlFor="text-maxlen" className="block text-xs text-gray-600 mb-1">
                      Max Length
                    </label>
                    <input
                      id="text-maxlen"
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

            {/* NUMBER settings */}
            {type === ColumnType.NUMBER && (
              <div className="space-y-3 pt-1 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Number Settings</p>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label htmlFor="num-unit" className="block text-xs text-gray-600 mb-1">
                      Unit
                    </label>
                    <input
                      id="num-unit"
                      type="text"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      placeholder="e.g. $, %, kg"
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="w-32">
                    <label htmlFor="num-precision" className="block text-xs text-gray-600 mb-1">
                      Decimal Places
                    </label>
                    <input
                      id="num-precision"
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

            {/* SIMPLE_FORMULA settings */}
            {type === ColumnType.SIMPLE_FORMULA && (
              <div className="space-y-3 pt-1 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Formula Settings</p>
                <div>
                  <label htmlFor="formula-unit" className="block text-xs text-gray-600 mb-1">
                    Unit
                  </label>
                  <input
                    id="formula-unit"
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
              </div>
            )}

            {/* DATE settings */}
            {type === ColumnType.DATE && (
              <div className="pt-1 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Date Settings</p>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeTime}
                    onChange={(e) => setIncludeTime(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    aria-label="Include time in date"
                  />
                  Include time
                </label>
              </div>
            )}

            {/* STATUS settings */}
            {type === ColumnType.STATUS && (
              <div className="space-y-2 pt-1 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Status Options</p>
                {statusOptions.map((opt, idx) => (
                  <div key={opt.id} className="flex items-center gap-2">
                    <input
                      type="color"
                      value={opt.color}
                      onChange={(e) => updateStatusOption(idx, 'color', e.target.value)}
                      className="w-7 h-7 rounded border border-gray-300 cursor-pointer p-0.5 flex-shrink-0"
                      aria-label={`Color for option ${opt.label}`}
                    />
                    <input
                      type="text"
                      value={opt.label}
                      onChange={(e) => updateStatusOption(idx, 'label', e.target.value)}
                      className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      aria-label={`Label for option ${idx + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() => removeStatusOption(idx)}
                      className="text-gray-400 hover:text-red-500 transition-colors p-1 flex-shrink-0"
                      aria-label={`Remove option ${opt.label}`}
                    >
                      <FiTrash2 size={13} aria-hidden="true" />
                    </button>
                  </div>
                ))}
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
                    <label htmlFor="default-status" className="block text-xs text-gray-600 mb-1">
                      Default status for new items
                    </label>
                    <select
                      id="default-status"
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

            {/* PERSON settings */}
            {type === ColumnType.PERSON && (
              <div className="pt-1 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Person Settings</p>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={personMultiple}
                    onChange={(e) => setPersonMultiple(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    aria-label="Allow multiple assignees"
                  />
                  Allow multiple people
                </label>
              </div>
            )}

            {/* DROPDOWN settings */}
            {type === ColumnType.DROPDOWN && (
              <div className="space-y-2 pt-1 border-t border-gray-100">
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

            {/* TAGS settings */}
            {type === ColumnType.TAGS && (
              <div className="pt-1 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Tags Settings</p>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowCustom}
                    onChange={(e) => setAllowCustom(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    aria-label="Allow custom tags"
                  />
                  Allow custom tags
                </label>
              </div>
            )}

            {/* VISIBILITY (board columns only — personal columns and subitem columns are always
                private/scoped to their owner, so the setting wouldn't mean anything there) */}
            {mode === 'board' && !parentGroupId && (
              <div className="pt-1 border-t border-gray-100">
                <label htmlFor="col-visibility" className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 mb-2">
                  <FiShield size={14} className="text-gray-400" aria-hidden="true" />
                  Visibility
                </label>
                <select
                  id="col-visibility"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as ColumnVisibility)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {COLUMN_VISIBILITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {COLUMN_VISIBILITY_OPTIONS.find((o) => o.value === visibility)?.desc}
                  {' — hidden from viewers without access, but formulas can still reference this column.'}
                </p>
              </div>
            )}

            {error && (
              <p id="col-error" className="text-xs text-red-600" role="alert">
                {error}
              </p>
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
              disabled={!isTemplate && isPending}
              className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-60"
              aria-label="Create column"
            >
              {!isTemplate && isPending ? 'Creating…' : 'Create Column'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    modalRoot
  );
};

export default AddColumnModal;
