import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useColumns, useReorderColumns, useDeleteColumn, useUpdateColumn } from '../../hooks/queries/useColumnQueries';
import { ColumnType } from '../../types';
import type { Column, NumberColumnSettings } from '../../types';
import {
  FiType, FiHash, FiCalendar, FiFlag, FiUser, FiChevronDown,
  FiCheckSquare, FiTag, FiClock, FiMail, FiPhone, FiMapPin,
  FiZap, FiLink, FiPlus, FiArrowUp, FiArrowDown, FiLoader, FiMenu, FiMoreVertical, FiTrash2, FiSettings, FiEdit2, FiRefreshCw, FiWatch,
} from 'react-icons/fi';
import { calculateColumnWidth, COLUMN_TYPE_MIN_WIDTHS } from '../../utils/columnWidths';
import { useColumnVisibilityTier, canSeeColumn } from '../../hooks/useColumnVisibility';
import AddColumnModal from './AddColumnModal';
import EditColumnConfigModal from './EditColumnConfigModal';
import type { BoardView } from '../../contexts/BoardRenderContext';

export const ITEM_COL_ID = '__item_name__';
const DEFAULT_ITEM_COL_WIDTH = 298;
const ITEM_COL_MIN_WIDTH = 150;
const COL_MIN_WIDTH = 80;
const COL_MAX_WIDTH = 1000;

interface SortState {
  columnId: string;
  direction: 'asc' | 'desc';
}

interface ColumnHeaderProps {
  boardId: string;
  canManage: boolean;
  onSortChange?: (sort: SortState | null) => void;
  onAddColumn?: () => void;
  boardView?: BoardView;
  columnWidths: Record<string, number>;
  onWidthChange: (columnId: string, width: number) => void;
}

export const COLUMN_TYPE_ICONS: Record<ColumnType, React.ReactNode> = {
  [ColumnType.TEXT]:           <FiType size={13} aria-hidden="true" />,
  [ColumnType.NUMBER]:         <FiHash size={13} aria-hidden="true" />,
  [ColumnType.DATE]:           <FiCalendar size={13} aria-hidden="true" />,
  [ColumnType.STATUS]:         <FiFlag size={13} aria-hidden="true" />,
  [ColumnType.PERSON]:         <FiUser size={13} aria-hidden="true" />,
  [ColumnType.DROPDOWN]:       <FiChevronDown size={13} aria-hidden="true" />,
  [ColumnType.CHECKBOX]:       <FiCheckSquare size={13} aria-hidden="true" />,
  [ColumnType.TAGS]:           <FiTag size={13} aria-hidden="true" />,
  [ColumnType.TIME]:           <FiClock size={13} aria-hidden="true" />,
  [ColumnType.EMAIL]:          <FiMail size={13} aria-hidden="true" />,
  [ColumnType.PHONE]:          <FiPhone size={13} aria-hidden="true" />,
  [ColumnType.LOCATION]:       <FiMapPin size={13} aria-hidden="true" />,
  [ColumnType.LINK]:           <FiLink size={13} aria-hidden="true" />,
  [ColumnType.TIME_RANGE]: (
    <span className="flex items-center gap-[2px]" aria-hidden="true">
      <svg width="9" height="9" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="3" width="12" height="10" rx="1.5" /><line x1="1" y1="6.5" x2="13" y2="6.5" /><line x1="4" y1="1" x2="4" y2="4" /><line x1="10" y1="1" x2="10" y2="4" />
      </svg>
      <svg width="6" height="6" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="1" y1="5" x2="9" y2="5" /><polyline points="6 2 9 5 6 8" />
      </svg>
      <svg width="9" height="9" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="3" width="12" height="10" rx="1.5" /><line x1="1" y1="6.5" x2="13" y2="6.5" /><line x1="4" y1="1" x2="4" y2="4" /><line x1="10" y1="1" x2="10" y2="4" />
      </svg>
    </span>
  ),
  [ColumnType.SIMPLE_FORMULA]: <FiZap size={13} aria-hidden="true" />,
  [ColumnType.HOURS_LOG]:      <FiWatch size={13} aria-hidden="true" />,
};

const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  [ColumnType.TEXT]:           'Text',
  [ColumnType.NUMBER]:         'Number',
  [ColumnType.DATE]:           'Date',
  [ColumnType.STATUS]:         'Status',
  [ColumnType.PERSON]:         'Person',
  [ColumnType.DROPDOWN]:       'Dropdown',
  [ColumnType.CHECKBOX]:       'Checkbox',
  [ColumnType.TAGS]:           'Tags',
  [ColumnType.TIME]:           'Time',
  [ColumnType.EMAIL]:          'Email',
  [ColumnType.PHONE]:          'Phone',
  [ColumnType.LOCATION]:       'Location',
  [ColumnType.LINK]:           'Link',
  [ColumnType.TIME_RANGE]:     'Time Range',
  [ColumnType.SIMPLE_FORMULA]: 'Formula',
  [ColumnType.HOURS_LOG]:      'Hours Log',
};

// ---------------------------------------------------------------------------
// Resize handle — shared between item col and dynamic cols
// ---------------------------------------------------------------------------

interface ResizeHandleProps {
  onResizeStart: (e: React.MouseEvent) => void;
}

const ResizeHandle: React.FC<ResizeHandleProps> = ({ onResizeStart }) => (
  <div
    role="separator"
    aria-label="Drag to resize column"
    aria-orientation="vertical"
    onMouseDown={onResizeStart}
    className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-indigo-400/30 active:bg-indigo-400/50 z-10 select-none"
  />
);

// ---------------------------------------------------------------------------
// ColumnHeaderCell
// ---------------------------------------------------------------------------

interface ColumnHeaderCellProps {
  column: Column;
  sort: SortState | null;
  onSort: (col: Column) => void;
  canManage: boolean;
  boardId: string;
  boardView?: BoardView;
  currentWidth: number;
  onWidthCommit: (width: number) => void;
  onSwapCommitted: (replaceColumnId: string) => void;
}

const ColumnHeaderCell: React.FC<ColumnHeaderCellProps> = ({
  column, sort, onSort, canManage, boardId, boardView, currentWidth, onWidthCommit, onSwapCommitted,
}) => {
  const isActive = sort?.columnId === column.id;
  const icon = COLUMN_TYPE_ICONS[column.type];
  const label = COLUMN_TYPE_LABELS[column.type];
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(column.name);
  const [showAddColumnModal, setShowAddColumnModal] = useState(false);
  const [showEditConfigModal, setShowEditConfigModal] = useState(false);
  const [insertPosition, setInsertPosition] = useState<'left' | 'right' | null>(null);

  // Every board column type is configurable now — at minimum it always has the Visibility
  // control, plus type-specific settings (unit, options, etc.) where applicable.
  const isConfigurable = true;
  // Number columns with a configured unit show it next to the name, e.g. "Income %".
  const numberUnit = column.type === ColumnType.NUMBER
    ? (column.settings as NumberColumnSettings)?.unit
    : undefined;
  const displayName = numberUnit ? `${column.name} ${numberUnit}` : column.name;
  const [resizingWidth, setResizingWidth] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const { mutateAsync: deleteColumn, isPending: isDeleting } = useDeleteColumn(boardId);
  const { mutateAsync: updateColumn, isPending: isUpdating } = useUpdateColumn(boardId);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: column.id,
    data: { type: 'column' as const, column },
    disabled: !canManage,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const minWidth = COLUMN_TYPE_MIN_WIDTHS[column.type] ?? COL_MIN_WIDTH;
  const displayWidth = resizingWidth ?? currentWidth;

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const handleDelete = async () => {
    await deleteColumn(column.id);
    setMenuOpen(false);
    setConfirmDelete(false);
  };

  const handleRename = async () => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === column.name) {
      setIsRenaming(false);
      setNewName(column.name);
      return;
    }
    await updateColumn({ id: column.id, patch: { name: trimmed } });
    setIsRenaming(false);
    setMenuOpen(false);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void handleRename();
    if (e.key === 'Escape') {
      setIsRenaming(false);
      setNewName(column.name);
    }
  };

  useEffect(() => {
    if (isRenaming) renameInputRef.current?.select();
  }, [isRenaming]);

  const handleAddColumn = (position: 'left' | 'right') => {
    setInsertPosition(position);
    setShowAddColumnModal(true);
    setMenuOpen(false);
  };

  // Nothing is deleted here — the old column is only removed once the user finishes
  // configuring its replacement in the AddColumnModal opened by the parent (ColumnHeader).
  // Cancelling that modal leaves the original column untouched. Whether the new type can
  // even carry the old data over is only knowable once the user picks it there, so any
  // data-loss / convert-or-discard decision is asked inside that modal, not here.
  const handleSwapType = () => {
    setMenuOpen(false);
    onSwapCommitted(column.id);
  };

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = currentWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (me: MouseEvent) => {
      const next = Math.max(minWidth, Math.min(COL_MAX_WIDTH, startWidth + (me.clientX - startX)));
      setResizingWidth(next);
    };

    const onMouseUp = (me: MouseEvent) => {
      const final = Math.max(minWidth, Math.min(COL_MAX_WIDTH, startWidth + (me.clientX - startX)));
      setResizingWidth(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onWidthCommit(final);
      void updateColumn({ id: column.id, patch: { width: final } });
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [currentWidth, minWidth, onWidthCommit, updateColumn, column.id]);

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, width: `${displayWidth}px` }}
      role="columnheader"
      className={`relative flex flex-shrink-0 items-center px-3 py-2 border-r border-[#d2d2d4] last:border-r-0 group${isDragging ? ' bg-indigo-50' : ''}`}
    >
      {/* Drag handle */}
      {canManage && (
        <span
          className="opacity-0 group-hover:opacity-100 text-gray-600 cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
          aria-label={`Drag to reorder ${column.name} column`}
          aria-grabbed={isDragging}
          {...attributes}
          {...listeners}
        >
          <FiMenu size={12} aria-hidden="true" />
        </span>
      )}

      {/* Center: icon + name */}
      <div className="flex flex-1 items-center justify-center gap-1.5 min-w-0 px-1">
        <span className="text-gray-400 flex-shrink-0" title={label}>
          {icon}
        </span>
        <span className="text-sm font-semibold text-gray-600 truncate">
          {displayName}
        </span>
      </div>

      {/* Right: sort + 3-dots */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={() => onSort(column)}
          className={`opacity-0 group-hover:opacity-100 transition-opacity rounded-full p-1 ${
            isActive
              ? '!opacity-100 text-indigo-600 bg-indigo-100'
              : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
          }`}
          aria-label={
            isActive
              ? `Sorted by ${column.name} ${sort?.direction === 'asc' ? 'ascending' : 'descending'}. Click to reverse.`
              : `Sort by ${column.name}`
          }
          aria-pressed={isActive}
        >
          {isActive && sort?.direction === 'desc' ? (
            <FiArrowDown size={12} aria-hidden="true" />
          ) : (
            <FiArrowUp size={12} aria-hidden="true" />
          )}
        </button>

        {/* Options menu */}
        {canManage && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-600 rounded p-0.5 flex items-center justify-center"
              aria-label={`Options for ${column.name} column`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <FiMoreVertical size={12} aria-hidden="true" />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1"
                aria-label="Column actions"
              >
                {isRenaming ? (
                  <div className="px-3 py-2 space-y-2">
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onBlur={() => void handleRename()}
                      onKeyDown={handleRenameKeyDown}
                      disabled={isUpdating}
                      className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      aria-label="Column name"
                    />
                  </div>
                ) : confirmDelete ? (
                  <div className="px-3 py-2 space-y-1">
                    <p className="text-xs text-red-600">Delete this column?</p>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => void handleDelete()}
                        disabled={isDeleting}
                        className="flex-1 px-2 py-1 text-xs text-white bg-red-500 rounded hover:bg-red-600 transition-colors disabled:opacity-60"
                        aria-label="Confirm delete"
                      >
                        {isDeleting ? '…' : 'Delete'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="flex-1 px-2 py-1 text-xs text-gray-600 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
                        aria-label="Cancel"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => setIsRenaming(true)}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
                      aria-label="Rename column"
                    >
                      <FiEdit2 size={12} aria-hidden="true" />
                      Edit name
                    </button>
                    {isConfigurable && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { setShowEditConfigModal(true); setMenuOpen(false); }}
                        className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
                        aria-label="Edit column configuration"
                      >
                        <FiSettings size={12} aria-hidden="true" />
                        Settings
                      </button>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => handleAddColumn('left')}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
                      aria-label="Add column to the left"
                    >
                      <FiPlus size={12} aria-hidden="true" />
                      Add left
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => handleAddColumn('right')}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
                      aria-label="Add column to the right"
                    >
                      <FiPlus size={12} aria-hidden="true" />
                      Add right
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleSwapType}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
                      aria-label="Change column type"
                    >
                      <FiRefreshCw size={12} aria-hidden="true" />
                      Change type
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => setConfirmDelete(true)}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors"
                      aria-label="Delete column"
                    >
                      <FiTrash2 size={12} aria-hidden="true" />
                      Delete
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <ResizeHandle onResizeStart={handleResizeStart} />

      {/* Add column modal - rendered here for insertion positioning */}
      {showAddColumnModal && (
        <AddColumnModal
          boardId={boardId}
          onClose={() => {
            setShowAddColumnModal(false);
            setInsertPosition(null);
          }}
          insertAfterColumnId={insertPosition === 'right' ? column.id : undefined}
          insertBeforeColumnId={insertPosition === 'left' ? column.id : undefined}
        />
      )}

      {/* Edit column configuration modal */}
      {showEditConfigModal && (
        <EditColumnConfigModal
          boardId={boardId}
          column={column}
          onClose={() => setShowEditConfigModal(false)}
        />
      )}

    </div>
  );
};

// ---------------------------------------------------------------------------
// ColumnHeader
// ---------------------------------------------------------------------------

const ColumnHeader: React.FC<ColumnHeaderProps> = ({
  boardId, canManage, onSortChange, onAddColumn, boardView, columnWidths, onWidthChange,
}) => {
  const { data: columns = [], isLoading } = useColumns(boardId);
  const viewerTier = useColumnVisibilityTier(boardId);
  const { mutateAsync: reorderColumns } = useReorderColumns(boardId);
  const [sort, setSort] = useState<SortState | null>(null);
  const [localColumns, setLocalColumns] = useState<Column[]>([]);
  const [activeColumn, setActiveColumn] = useState<Column | null>(null);
  const serverColumnsRef = useRef<Column[]>([]);
  const [swapAddModal, setSwapAddModal] = useState<{ replaceColumnId: string; replaceColumnType: ColumnType } | null>(null);

  // Item column resize state
  const [itemResizingWidth, setItemResizingWidth] = useState<number | null>(null);

  useEffect(() => {
    if (JSON.stringify(columns) !== JSON.stringify(serverColumnsRef.current)) {
      setLocalColumns(columns);
      serverColumnsRef.current = columns;
    }
  }, [columns]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const handleSort = (col: Column) => {
    setSort((prev) => {
      if (prev?.columnId === col.id) {
        if (prev.direction === 'asc') {
          const next: SortState = { columnId: col.id, direction: 'desc' };
          onSortChange?.(next);
          return next;
        }
        onSortChange?.(null);
        return null;
      }
      const next: SortState = { columnId: col.id, direction: 'asc' };
      onSortChange?.(next);
      return next;
    });
  };

  const handleItemSort = () => {
    setSort((prev) => {
      if (prev?.columnId === ITEM_COL_ID) {
        if (prev.direction === 'asc') {
          const next: SortState = { columnId: ITEM_COL_ID, direction: 'desc' };
          onSortChange?.(next);
          return next;
        }
        onSortChange?.(null);
        return null;
      }
      const next: SortState = { columnId: ITEM_COL_ID, direction: 'asc' };
      onSortChange?.(next);
      return next;
    });
  };

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as { type: string; column?: Column } | undefined;
    if (data?.column) setActiveColumn(data.column);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveColumn(null);
    if (!over || active.id === over.id) return;

    const oldIndex = localColumns.findIndex((c) => c.id === active.id);
    const newIndex = localColumns.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

    const newColumns = arrayMove(localColumns, oldIndex, newIndex);
    setLocalColumns(newColumns);

    const orderUpdates = newColumns.map((c, i) => ({ id: c.id, order: i }));
    reorderColumns(orderUpdates).catch(() => {
      setLocalColumns(serverColumnsRef.current);
    });
  };

  const handleItemResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = columnWidths[ITEM_COL_ID] ?? DEFAULT_ITEM_COL_WIDTH;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (me: MouseEvent) => {
      const next = Math.max(ITEM_COL_MIN_WIDTH, Math.min(COL_MAX_WIDTH, startWidth + (me.clientX - startX)));
      setItemResizingWidth(next);
    };

    const onMouseUp = (me: MouseEvent) => {
      const final = Math.max(ITEM_COL_MIN_WIDTH, Math.min(COL_MAX_WIDTH, startWidth + (me.clientX - startX)));
      setItemResizingWidth(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onWidthChange(ITEM_COL_ID, final);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [columnWidths, onWidthChange]);

  // Hidden columns stay in localColumns (needed for correct drag-reorder index math and the
  // reorder mutation payload) but are excluded from what's actually rendered/draggable.
  const visibleColumns = localColumns.filter((col) => canSeeColumn(col, viewerTier));
  const columnIds = visibleColumns.map((c) => c.id);

  const itemColWidth = itemResizingWidth ?? (columnWidths[ITEM_COL_ID] ?? DEFAULT_ITEM_COL_WIDTH);
  const isItemSortActive = sort?.columnId === ITEM_COL_ID;

  if (isLoading) {
    return (
      <div
        className="flex items-center px-6 py-2 bg-gray-50 border-b border-gray-200"
        role="row"
        aria-label="Loading columns"
      >
        <FiLoader className="animate-spin text-gray-400" size={14} aria-hidden="true" />
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div
        className="sticky top-0 z-[21] flex flex-nowrap items-stretch bg-gray-50 border-b border-[#d2d2d4] select-none w-max"
        role="row"
        aria-label="Column headers"
      >
        {/* Item name column — fixed, sortable, resizable */}
        <div
          role="columnheader"
          style={{ width: `${itemColWidth}px` }}
          className="relative flex flex-shrink-0 items-center px-4 py-2 border-r border-[#d2d2d4] text-sm font-semibold text-gray-600 bg-gray-50 sticky left-0 z-[1] group"
        >
          <span className="flex-1 truncate">Item</span>

          <button
            type="button"
            onClick={handleItemSort}
            className={`opacity-0 group-hover:opacity-100 transition-opacity rounded-full p-1 ml-1 flex-shrink-0 ${
              isItemSortActive
                ? '!opacity-100 text-indigo-600 bg-indigo-100'
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
            }`}
            aria-label={
              isItemSortActive
                ? `Sorted by Item name ${sort?.direction === 'asc' ? 'ascending' : 'descending'}. Click to reverse.`
                : 'Sort by Item name'
            }
            aria-pressed={isItemSortActive}
          >
            {isItemSortActive && sort?.direction === 'desc' ? (
              <FiArrowDown size={12} aria-hidden="true" />
            ) : (
              <FiArrowUp size={12} aria-hidden="true" />
            )}
          </button>

          <ResizeHandle onResizeStart={handleItemResizeStart} />
        </div>

        {/* Dynamic sortable columns */}
        <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
          {visibleColumns.map((col) => {
            const colWidth = columnWidths[col.id] ?? col.width ?? calculateColumnWidth(col.name, col.type);
            return (
              <ColumnHeaderCell
                key={col.id}
                column={col}
                sort={sort}
                onSort={handleSort}
                canManage={canManage}
                boardId={boardId}
                boardView={boardView}
                currentWidth={colWidth}
                onWidthCommit={(w) => onWidthChange(col.id, w)}
                onSwapCommitted={(replaceColumnId) => setSwapAddModal({ replaceColumnId, replaceColumnType: col.type })}
              />
            );
          })}
        </SortableContext>

        {/* Add column button */}
        {canManage && (
          <div role="columnheader" className="flex items-center px-2 py-2">
            <button
              type="button"
              className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
              aria-label="Add new column"
              onClick={onAddColumn}
              title="Add column"
            >
              <FiPlus size={13} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* Drag overlay for column preview */}
      <DragOverlay>
        {activeColumn && (
          <div
            role="columnheader"
            className="flex items-center gap-1.5 min-w-[120px] px-3 py-2 bg-white border border-indigo-300 shadow-lg rounded text-xs font-semibold text-gray-600 cursor-grabbing"
            aria-hidden="true"
          >
            <span className="text-gray-400 flex-shrink-0">
              {COLUMN_TYPE_ICONS[activeColumn.type]}
            </span>
            {activeColumn.name}
          </div>
        )}
      </DragOverlay>

      {/* Change type — replacement column modal, rendered here (not per-cell) so it
          survives once the swap actually deletes the old column's cell. The old
          column itself is only deleted once the new one is created (or never, if
          this modal is cancelled). */}
      {swapAddModal && (
        <AddColumnModal
          boardId={boardId}
          onClose={() => setSwapAddModal(null)}
          replaceColumnId={swapAddModal.replaceColumnId}
          replaceColumnType={swapAddModal.replaceColumnType}
        />
      )}
    </DndContext>
  );
};

export default ColumnHeader;
