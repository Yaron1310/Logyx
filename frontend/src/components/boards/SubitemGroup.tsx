import React, { useState, useRef, useEffect } from 'react';
import { FiPlus, FiLoader, FiTrash2, FiMessageSquare, FiFileText, FiMoreVertical, FiEdit2, FiSettings, FiRefreshCw } from 'react-icons/fi';
import AddColumnModal from './AddColumnModal';
import EditColumnConfigModal from './EditColumnConfigModal';
import { useQueryClient } from '@tanstack/react-query';
import { useColumns, useSubitemColumns, useDeleteColumn, useUpdateColumn } from '../../hooks/queries/useColumnQueries';
import { useSubitemGroup, useDeleteGroup } from '../../hooks/queries/useGroupQueries';
import { useGroupItems, useCreateItem, useArchiveItem, useUpdateItem } from '../../hooks/queries/useItemQueries';
import { useCreateColumn } from '../../hooks/queries/useColumnQueries';
import { useCreateGroup } from '../../hooks/queries/useGroupQueries';
import { queryKeys } from '../../hooks/queries/queryKeys';
import { useAuthSession } from '../../hooks/useAuthSession';
import { useBoardRender } from '../../contexts/BoardRenderContext';
import { ColumnType } from '../../types';
import type { Column, HoursLogColumnSettings, Item } from '../../types';
import { COLUMN_TYPE_ICONS } from './ColumnHeader';
import { ColumnCell } from './cells';
import { getUnreadCount, hasReadMessages } from './ItemChatModal';
import { calculateColumnWidth } from '../../utils/columnWidths';
import FlippedMenu from '../common/FlippedMenu';
import { usePersonalItemValues } from '../../hooks/queries/usePersonalHubQueries';
import PersonalColumnCell from '../personalHub/PersonalColumnCell';
import type { PersonalColumn } from '../../types';

const CONFIGURABLE_TYPES = [ColumnType.TEXT, ColumnType.NUMBER, ColumnType.STATUS, ColumnType.DROPDOWN, ColumnType.SIMPLE_FORMULA];

const DEFAULT_STATUS_OPTIONS = [
  { id: 'todo', label: 'To Do', color: '#94a3b8' },
  { id: 'inprogress', label: 'In Progress', color: '#6366f1' },
  { id: 'done', label: 'Done', color: '#22c55e' },
];

interface SubitemGroupProps {
  boardId: string;
  workspaceId: string;
  parentItemId: string;
  groupColor?: string;
  onEmpty?: () => void;
  /** Personal Hub only: when set, only render subitems this user is assigned to. */
  filterAssigneeId?: string;
  /** Personal Hub only: HOURS_LOG personal columns marked "Subitems only", overlaid onto
   *  subitem rows this user (personalOwnerId) is assigned to — attached in the Personal Hub
   *  view only, not part of the board's own subitem columns. */
  personalOverlayColumns?: PersonalColumn[];
  /** Whose personal columns/values personalOverlayColumns belongs to — undefined for your own. */
  personalOwnerId?: string;
  /** Whether the viewer owns personalOwnerId's hub (vs. an admin viewing someone else's) —
   *  gates whether the overlaid personal subitem cells are editable. */
  personalEditable?: boolean;
  /** Gates "Add subitem" — also true for workspace-level "edit" users. */
  canManageItems: boolean;
  /** Gates "Add subitem column" and the per-column manage menu — structural, board-editor-only
   *  (does NOT include workspace-level "edit" users, same as top-level board columns). */
  canManageColumns: boolean;
}

const DEFAULT_LOCAL_COLUMNS: Column[] = [
  { id: '__local_person__', boardId: '', name: 'Person', type: ColumnType.PERSON, settings: { multiple: true } } as Column,
  { id: '__local_status__', boardId: '', name: 'Status', type: ColumnType.STATUS, settings: { options: DEFAULT_STATUS_OPTIONS } } as Column,
  { id: '__local_date__', boardId: '', name: 'Date', type: ColumnType.DATE, settings: {} } as Column,
];

let pendingIdCounter = 0;
const nextPendingId = (prefix: string) => `${prefix}-${Date.now()}-${++pendingIdCounter}`;

const SubitemColumnHeader: React.FC<{
  col: Column;
  boardId: string;
  subitemGroupId: string;
  colWidth: number;
  canManage: boolean;
  onSwapCommitted: (replaceColumnId: string, replaceColumnType: ColumnType) => void;
}> = ({ col, boardId, subitemGroupId, colWidth, canManage, onSwapCommitted }) => {
  const qc = useQueryClient();
  const { mutateAsync: deleteColumn, isPending: isDeleting } = useDeleteColumn(boardId);
  const { mutateAsync: updateColumn, isPending: isUpdating } = useUpdateColumn(boardId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(col.name);
  const [showAddColumnModal, setShowAddColumnModal] = useState(false);
  const [showEditConfigModal, setShowEditConfigModal] = useState(false);
  const [insertPosition, setInsertPosition] = useState<'left' | 'right' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const isConfigurable = CONFIGURABLE_TYPES.includes(col.type);
  const subitemColumnsKey = queryKeys.columns.subitem(boardId, subitemGroupId);

  useEffect(() => { setNewName(col.name); }, [col.name]);
  useEffect(() => { if (isRenaming) renameInputRef.current?.select(); }, [isRenaming]);

  const handleRename = async () => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === col.name) { setIsRenaming(false); setNewName(col.name); return; }
    await updateColumn({ id: col.id, patch: { name: trimmed } });
    await qc.invalidateQueries({ queryKey: subitemColumnsKey });
    setIsRenaming(false);
    setMenuOpen(false);
  };

  const handleDelete = async () => {
    await deleteColumn(col.id);
    await qc.invalidateQueries({ queryKey: subitemColumnsKey });
    setMenuOpen(false);
    setConfirmDelete(false);
  };

  const handleAddColumn = (position: 'left' | 'right') => {
    setInsertPosition(position);
    setShowAddColumnModal(true);
    setMenuOpen(false);
  };

  // Nothing is deleted here — the old column is only removed once the user finishes
  // configuring its replacement in the AddColumnModal opened by the parent (SubitemGroup).
  // Cancelling that modal leaves the original column untouched. Whether the new type can
  // even carry the old data over is only knowable once the user picks it there, so any
  // data-loss / convert-or-discard decision is asked inside that modal, not here.
  const handleSwapType = () => {
    setMenuOpen(false);
    onSwapCommitted(col.id, col.type);
  };

  return (
    <div
      role="columnheader"
      style={{ width: `${colWidth}px`, minWidth: `${colWidth}px` }}
      className="relative flex flex-shrink-0 items-center justify-center gap-1 px-2 py-1.5 border-r border-[#e5e7eb] text-xs font-semibold text-gray-500 group/hdr"
    >
      <span className="text-gray-400 flex-shrink-0">{COLUMN_TYPE_ICONS[col.type]}</span>
      <span className="truncate">{col.name}</span>

      {canManage && (
      <div className="relative ml-auto flex-shrink-0" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="opacity-0 group-hover/hdr:opacity-100 transition-opacity text-gray-400 hover:text-gray-600 rounded p-0.5 flex items-center justify-center"
          aria-label={`Options for ${col.name} column`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <FiMoreVertical size={11} aria-hidden="true" />
        </button>

        {menuOpen && (
          <FlippedMenu
            anchorEl={menuRef.current}
            width={160}
            onClose={() => setMenuOpen(false)}
            role="menu"
            className="w-40 bg-white border border-gray-200 rounded-lg shadow-lg py-1"
            aria-label="Column actions"
          >
            {isRenaming ? (
              <div className="px-3 py-2">
                <input
                  ref={renameInputRef}
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onBlur={() => void handleRename()}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleRename(); if (e.key === 'Escape') { setIsRenaming(false); setNewName(col.name); } }}
                  disabled={isUpdating}
                  className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  aria-label="Column name"
                />
              </div>
            ) : confirmDelete ? (
              <div className="px-3 py-2 space-y-1">
                <p className="text-xs text-red-600">Delete this column?</p>
                <div className="flex gap-1">
                  <button type="button" onClick={() => void handleDelete()} disabled={isDeleting}
                    className="flex-1 px-2 py-1 text-xs text-white bg-red-500 rounded hover:bg-red-600 disabled:opacity-60" aria-label="Confirm delete">
                    {isDeleting ? '…' : 'Delete'}
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(false)}
                    className="flex-1 px-2 py-1 text-xs text-gray-600 bg-gray-100 rounded hover:bg-gray-200" aria-label="Cancel">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button type="button" role="menuitem" onClick={() => setIsRenaming(true)}
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors" aria-label="Rename column">
                  <FiEdit2 size={11} aria-hidden="true" /> Edit name
                </button>
                {isConfigurable && (
                  <button type="button" role="menuitem" onClick={() => { setShowEditConfigModal(true); setMenuOpen(false); }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors" aria-label="Edit column configuration">
                    <FiSettings size={11} aria-hidden="true" /> Settings
                  </button>
                )}
                <button type="button" role="menuitem" onClick={() => handleAddColumn('left')}
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors" aria-label="Add column to the left">
                  <FiPlus size={11} aria-hidden="true" /> Add left
                </button>
                <button type="button" role="menuitem" onClick={() => handleAddColumn('right')}
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors" aria-label="Add column to the right">
                  <FiPlus size={11} aria-hidden="true" /> Add right
                </button>
                <button type="button" role="menuitem" onClick={handleSwapType}
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors" aria-label="Change column type">
                  <FiRefreshCw size={11} aria-hidden="true" /> Change type
                </button>
                <button type="button" role="menuitem" onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors" aria-label="Delete column">
                  <FiTrash2 size={11} aria-hidden="true" /> Delete
                </button>
              </>
            )}
          </FlippedMenu>
        )}
      </div>
      )}

      {showAddColumnModal && (
        <AddColumnModal
          boardId={boardId}
          parentGroupId={subitemGroupId}
          onClose={() => { setShowAddColumnModal(false); setInsertPosition(null); }}
          insertAfterColumnId={insertPosition === 'right' ? col.id : undefined}
          insertBeforeColumnId={insertPosition === 'left' ? col.id : undefined}
        />
      )}

      {showEditConfigModal && (
        <EditColumnConfigModal
          boardId={boardId}
          column={col}
          onClose={() => { setShowEditConfigModal(false); void qc.invalidateQueries({ queryKey: subitemColumnsKey }); }}
        />
      )}

    </div>
  );
};

const SubitemRow: React.FC<{
  item: Item;
  columns: Column[];
  canManageItems: boolean;
  personalOverlayColumns?: PersonalColumn[];
  personalOwnerId?: string;
  personalEditable?: boolean;
  personalValues?: Record<string, unknown>;
}> = ({ item, columns, canManageItems, personalOverlayColumns = [], personalOwnerId, personalEditable, personalValues }) => {
  const { user, isPublicView } = useAuthSession();
  const { openChat, openForms } = useBoardRender();
  const { mutateAsync: archiveItem } = useArchiveItem();
  const { mutateAsync: updateItem } = useUpdateItem();
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(item.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setNameValue(item.name); }, [item.name]);
  useEffect(() => { if (editingName) inputRef.current?.select(); }, [editingName]);

  const commitName = async () => {
    const trimmed = nameValue.trim();
    setEditingName(false);
    if (!trimmed || trimmed === item.name) { setNameValue(item.name); return; }
    await updateItem({ id: item.id, patch: { name: trimmed } });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); void commitName(); }
    if (e.key === 'Escape') { setNameValue(item.name); setEditingName(false); }
  };

  const unreadCount = user ? getUnreadCount(user.id, item) : 0;
  const readMessages = user ? hasReadMessages(user.id, item) : false;
  const formSubmitted = item.formSubmitted === true;

  // Mirrors ItemRow's gating for top-level rows, and the backend's own split: renaming is
  // open to editor-tier users plus the subitem's creator/assignees, while archiving needs
  // editor tier. A read-only viewer (public link included) is none of those, so the row
  // renders as plain text with no actions.
  const canRename =
    canManageItems ||
    item.createdBy === user?.id ||
    (item.assignees ?? []).includes(user?.id ?? '');

  return (
    <div
      role="row"
      className="flex flex-nowrap items-stretch border-b border-[#e5e7eb] hover:bg-indigo-50/30 transition-colors group bg-white"
    >
      {/* Name cell — fixed 220px to match header */}
      <div
        className="flex items-center px-3 py-1.5 min-w-0 flex-shrink-0 gap-1 border-r border-[#e5e7eb]"
        style={{ width: '220px', minWidth: '220px' }}
        role="gridcell"
      >
        {editingName && canRename ? (
          <input
            ref={inputRef}
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={() => void commitName()}
            onKeyDown={handleKeyDown}
            className="flex-1 text-xs text-gray-700 bg-white border border-indigo-400 rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-indigo-400"
            aria-label="Edit subitem name"
          />
        ) : (
          <span
            className={`text-xs text-gray-700 truncate flex-1 ${canRename ? 'cursor-text' : ''}`}
            onClick={canRename ? () => setEditingName(true) : undefined}
          >
            {item.name}
          </span>
        )}

        {/* Form + chat — neither is available in the public read-only view */}
        {!isPublicView && (
        <>
        {/* Form button */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); openForms(item); }}
          className={`relative flex items-center justify-center w-5 h-5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors flex-shrink-0 ${
            formSubmitted ? '' : 'opacity-0 group-hover:opacity-100'
          }`}
          aria-label={`Open form for ${item.name}${formSubmitted ? ' (submitted)' : ''}`}
        >
          <FiFileText size={12} aria-hidden="true" />
          {formSubmitted && (
            <span
              className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-red-500 rounded-full"
              aria-hidden="true"
            />
          )}
        </button>

        {/* Chat button */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); openChat(item); }}
          className="relative flex items-center justify-center w-5 h-5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100"
          aria-label={`Open chat for ${item.name}`}
        >
          <FiMessageSquare size={12} aria-hidden="true" />
          {unreadCount > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[10px] h-[10px] px-0.5 bg-red-500 text-white text-[7px] font-bold rounded-full leading-none"
              aria-label={`${unreadCount} unread`}
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
          {unreadCount === 0 && readMessages && (
            <span
              className="absolute -top-0.5 rounded-full"
              style={{ backgroundColor: '#bfc2c6', width: '0.6rem', height: '0.6rem', right: 0, left: 0 }}
              aria-label="This item has messages, all read"
            />
          )}
        </button>
        </>
        )}

        {/* Delete button — archiving is editor-tier only, matching the backend */}
        {canManageItems && (
        <button
          type="button"
          onClick={() => void archiveItem(item.id)}
          className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-5 h-5 text-gray-400 hover:text-red-500 rounded transition-all flex-shrink-0"
          aria-label={`Delete subitem ${item.name}`}
        >
          <FiTrash2 size={11} aria-hidden="true" />
        </button>
        )}
      </div>

      {/* Dynamic column cells — width is controlled by ColumnCell internally */}
      {columns.map((col) => (
        <ColumnCell key={col.id} item={item} column={col} />
      ))}
      {/* Personal Hub only — columns attached here for the viewer, not part of the board */}
      {personalOverlayColumns.map((col) => {
        const colWidth = calculateColumnWidth(col.name, col.type);
        return (
          <div
            key={col.id}
            role="gridcell"
            style={{ width: `${colWidth}px`, minWidth: `${colWidth}px` }}
            className="flex flex-shrink-0 items-center justify-center border-r border-[#e5e7eb] bg-indigo-50/30"
          >
            <PersonalColumnCell
              column={col}
              itemId={item.id}
              itemName={item.name}
              value={personalValues?.[col.id]}
              editable={!!personalEditable}
              userId={personalOwnerId}
              itemBoardId={item.boardId}
            />
          </div>
        );
      })}
      {/* Sentinel: prevents CSS last:border-r-0 from hiding the last cell's right border */}
      <div className="w-0 flex-shrink-0" aria-hidden="true" />
    </div>
  );
};

const SubitemGroup: React.FC<SubitemGroupProps> = ({ boardId, workspaceId, parentItemId, groupColor, onEmpty, filterAssigneeId, personalOverlayColumns = [], personalOwnerId, personalEditable, canManageItems, canManageColumns }) => {
  const { user } = useAuthSession();
  const { columnWidths } = useBoardRender();
  const qc = useQueryClient();
  const [isInitializing, setIsInitializing] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  // Deferred auto-focus: set during initialize(), consumed once isLoading turns false
  const [pendingAutoFocus, setPendingAutoFocus] = useState(false);
  const addItemInputRef = useRef<HTMLInputElement>(null);
  const shouldFocusOnMount = useRef(false);
  const [showAddColModal, setShowAddColModal] = useState(false);
  const [swapAddModal, setSwapAddModal] = useState<{ replaceColumnId: string; replaceColumnType: ColumnType } | null>(null);
  const [showQuickAddCol, setShowQuickAddCol] = useState(false);
  const [quickColName, setQuickColName] = useState('');
  const [quickColType, setQuickColType] = useState<ColumnType>(ColumnType.TEXT);

  // Optimistic-update bookkeeping: items/columns queued while the group (and its
  // default columns) are still being created in the background, remembered in
  // the order they happen so they can be replayed once the real IDs exist.
  const [pendingItems, setPendingItems] = useState<{ tempId: string; name: string }[]>([]);
  const [pendingColumns, setPendingColumns] = useState<{ tempId: string; name: string; type: ColumnType }[]>([]);
  const groupPromiseRef = useRef<Promise<{ id: string }> | null>(null);

  const { mutateAsync: createGroup } = useCreateGroup();
  const { mutateAsync: createColumn } = useCreateColumn(boardId);
  const { mutateAsync: createItem, isPending: isCreatingItem } = useCreateItem();
  const { mutateAsync: deleteColumn } = useDeleteColumn(boardId);
  const { mutateAsync: deleteGroup } = useDeleteGroup();

  const { data: subitemGroup, isLoading: groupLoading } = useSubitemGroup(boardId, parentItemId);
  const { data: boardColumns = [] } = useColumns(boardId);

  const { data: columns = [], isLoading: columnsLoading } = useSubitemColumns(
    boardId,
    subitemGroup?.id ?? '',
    !!subitemGroup,
  );

  const { data: itemsPage, isFetching: itemsFetching } = useGroupItems(
    subitemGroup?.id ?? '',
    undefined,
    200,
    !!subitemGroup,
  );

  const realItems = itemsPage?.data ?? [];
  // Only affects what's rendered below — group emptiness/creation logic still
  // uses the unfiltered `realItems`, since the underlying subitems group itself
  // isn't scoped to this user.
  const displayedItems = filterAssigneeId
    ? realItems.filter((item) => (item.assignees ?? []).includes(filterAssigneeId))
    : realItems;

  // Personal Hub only — bulk-fetch the viewer's personal values for the overlaid subitem
  // columns, once for the whole panel (same store the overlay cells write back to).
  const { data: personalValuesByItem = {} } = usePersonalItemValues(
    displayedItems.map((i) => i.id),
    personalOwnerId,
    personalOverlayColumns.length > 0 && displayedItems.length > 0,
  );

  // Set once teardown starts and never reset — prevents the auto-init effect below
  // from racing a just-emptied group back into existence in the brief window
  // between the group query resolving to null and the panel actually unmounting.
  const isClosingRef = useRef(false);

  const initialize = (): Promise<{ id: string }> => {
    if (groupPromiseRef.current) return groupPromiseRef.current;
    const p = (async () => {
      setIsInitializing(true);
      try {
        const group = await createGroup({
          boardId,
          data: { name: 'Subitems', color: groupColor ?? '#94a3b8', parentItemId },
        });

        await createColumn({ name: 'Person', type: ColumnType.PERSON, settings: { multiple: true }, parentGroupId: group.id });
        await createColumn({ name: 'Status', type: ColumnType.STATUS, settings: { options: DEFAULT_STATUS_OPTIONS }, parentGroupId: group.id });
        await createColumn({ name: 'Date', type: ColumnType.DATE, settings: {}, parentGroupId: group.id });

        // Any top-level HOURS_LOG column marked "Subitems only" gets auto-added here too, so
        // a brand-new subitem group starts with it already present.
        const mirroredHoursLogColumns = boardColumns.filter(
          (col) => col.type === ColumnType.HOURS_LOG && (col.settings as HoursLogColumnSettings).subitemsOnly,
        );
        for (const col of mirroredHoursLogColumns) {
          await createColumn({
            name: col.name,
            type: ColumnType.HOURS_LOG,
            settings: { mirroredFromColumnId: col.id },
            parentGroupId: group.id,
          });
        }

        await qc.invalidateQueries({ queryKey: queryKeys.groups.subitem(boardId, parentItemId) });
        await qc.invalidateQueries({ queryKey: queryKeys.columns.subitem(boardId, group.id) });

        return group;
      } finally {
        setIsInitializing(false);
      }
    })();
    groupPromiseRef.current = p;
    return p;
  };

  // Auto-initialize on first render if no subitem group exists yet
  useEffect(() => {
    if (!groupLoading && subitemGroup === null && !isClosingRef.current) {
      shouldFocusOnMount.current = true;
      setPendingAutoFocus(true);
      void initialize();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupLoading, subitemGroup]);

  // Resolves once the real subitem group exists — creates it (idempotently) if needed.
  const ensureGroupReady = (): Promise<{ id: string }> => {
    if (subitemGroup) return Promise.resolve(subitemGroup);
    return initialize();
  };

  const isLoading = groupLoading;

  // Open and focus the add-item input once loading settles (after first-time initialization)
  useEffect(() => {
    if (!isLoading && pendingAutoFocus) {
      setPendingAutoFocus(false);
      setAddingItem(true);
    }
  }, [isLoading, pendingAutoFocus]);

  // No explicit focus effect needed — the input uses autoFocus and a ref callback

  const isSubmittingItemRef = useRef(false);
  const handleAddItem = async () => {
    const trimmed = newItemName.trim();
    if (!trimmed || !user || isSubmittingItemRef.current) return;
    isSubmittingItemRef.current = true;
    setTimeout(() => { isSubmittingItemRef.current = false; }, 0);
    setNewItemName('');
    setAddingItem(false);

    const tempId = nextPendingId('item');
    setPendingItems((prev) => [...prev, { tempId, name: trimmed }]);
    try {
      const group = await ensureGroupReady();
      await createItem({ name: trimmed, workspaceId, boardId, groupId: group.id });
      await qc.invalidateQueries({ queryKey: queryKeys.items.group(group.id, undefined, 200) });
    } finally {
      setPendingItems((prev) => prev.filter((p) => p.tempId !== tempId));
    }
  };

  const handleAddItemKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void handleAddItem();
    if (e.key === 'Escape') { setAddingItem(false); setNewItemName(''); }
  };

  const handleQuickAddColumn = async () => {
    const trimmed = quickColName.trim() || quickColType;
    const type = quickColType;
    const tempId = nextPendingId('col');
    setPendingColumns((prev) => [...prev, { tempId, name: trimmed, type }]);
    setShowQuickAddCol(false);
    setQuickColName('');
    setQuickColType(ColumnType.TEXT);
    try {
      const group = await ensureGroupReady();
      await createColumn({
        name: trimmed,
        type,
        settings: type === ColumnType.STATUS ? { options: DEFAULT_STATUS_OPTIONS } : {},
        parentGroupId: group.id,
      });
      await qc.invalidateQueries({ queryKey: queryKeys.columns.subitem(boardId, group.id) });
    } finally {
      setPendingColumns((prev) => prev.filter((c) => c.tempId !== tempId));
    }
  };

  // Auto-teardown: whenever the subitem group has no rows left (and isn't in the
  // middle of being created / getting its first row added), delete the group and
  // its columns and collapse the panel — this also cleans up any empty group left
  // over from a session before this behavior existed.
  const isTearingDownRef = useRef(false);
  useEffect(() => {
    if (!subitemGroup || itemsFetching || columnsLoading) return;
    if (isInitializing || pendingAutoFocus || addingItem) return;
    if (isTearingDownRef.current) return;
    const total = realItems.length + pendingItems.length;
    if (total !== 0) return;

    isTearingDownRef.current = true;
    isClosingRef.current = true;
    void (async () => {
      try {
        await Promise.all(columns.map((c) => deleteColumn(c.id)));
        await deleteGroup({ boardId, groupId: subitemGroup.id });
        await qc.invalidateQueries({ queryKey: queryKeys.groups.subitem(boardId, parentItemId) });
        onEmpty?.();
      } finally {
        isTearingDownRef.current = false;
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realItems.length, pendingItems.length, subitemGroup, itemsFetching, columnsLoading, isInitializing, pendingAutoFocus, addingItem]);

  const pendingColumnPlaceholders: Column[] = pendingColumns.map((c) => ({
    id: c.tempId, boardId, name: c.name, type: c.type, settings: {},
  } as Column));

  const NAME_COL_WIDTH = 220;

  return (
    // No overflow-hidden — lets cell menus (person picker, status, etc.) escape the container.
    // position:relative + z-index ensures this panel stacks above the board rows below it.
    <div
      className="relative z-[50] ml-8 mt-2 mb-1 border border-[#e5e7eb] rounded-lg bg-white shadow-sm"
      role="region"
      aria-label="Subitems"
    >
      {/* Column header row */}
      <div
        className="flex flex-nowrap items-stretch border-b border-[#e5e7eb] bg-gray-50 rounded-t-lg"
        role="row"
      >
        <div
          className="flex-shrink-0 px-3 py-1.5 text-xs font-semibold text-gray-500 border-r border-[#e5e7eb]"
          style={{ width: `${NAME_COL_WIDTH}px`, minWidth: `${NAME_COL_WIDTH}px` }}
          role="columnheader"
        >
          Subitem
        </div>
        {subitemGroup
          ? columns.map((col) => {
              const colWidth = columnWidths[col.id] ?? col.width ?? calculateColumnWidth(col.name, col.type);
              return (
                <SubitemColumnHeader
                  key={col.id}
                  col={col}
                  boardId={boardId}
                  subitemGroupId={subitemGroup.id}
                  colWidth={colWidth}
                  canManage={canManageColumns}
                  onSwapCommitted={(replaceColumnId, replaceColumnType) => setSwapAddModal({ replaceColumnId, replaceColumnType })}
                />
              );
            })
          : DEFAULT_LOCAL_COLUMNS.map((col) => {
              const colWidth = calculateColumnWidth(col.name, col.type);
              return (
                <div
                  key={col.id}
                  role="columnheader"
                  style={{ width: `${colWidth}px`, minWidth: `${colWidth}px` }}
                  className="flex flex-shrink-0 items-center justify-center gap-1 px-2 py-1.5 border-r border-[#e5e7eb] text-xs font-semibold text-gray-400"
                >
                  <span className="flex-shrink-0">{COLUMN_TYPE_ICONS[col.type]}</span>
                  <span className="truncate">{col.name}</span>
                </div>
              );
            })}

        {/* Personal Hub only — columns attached here for the viewer, not part of the board */}
        {personalOverlayColumns.map((col) => {
          const colWidth = calculateColumnWidth(col.name, col.type);
          return (
            <div
              key={col.id}
              role="columnheader"
              style={{ width: `${colWidth}px`, minWidth: `${colWidth}px` }}
              className="flex flex-shrink-0 items-center justify-center gap-1 px-2 py-1.5 border-r border-[#e5e7eb] bg-indigo-50/50 text-xs font-semibold text-indigo-600"
              title={`${col.name} (your personal column)`}
            >
              <span className="text-indigo-400 flex-shrink-0">{COLUMN_TYPE_ICONS[col.type]}</span>
              <span className="truncate">{col.name}</span>
            </div>
          );
        })}

        {pendingColumnPlaceholders.map((col) => {
          const colWidth = calculateColumnWidth(col.name, col.type);
          return (
            <div
              key={col.id}
              role="columnheader"
              style={{ width: `${colWidth}px`, minWidth: `${colWidth}px` }}
              className="flex flex-shrink-0 items-center justify-center gap-1 px-2 py-1.5 border-r border-[#e5e7eb] text-xs font-semibold text-gray-400 opacity-60"
            >
              <FiLoader size={11} className="animate-spin flex-shrink-0" aria-hidden="true" />
              <span className="truncate">{col.name}</span>
            </div>
          );
        })}

        {/* Add column button */}
        {canManageColumns && (
        <div className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => (subitemGroup ? setShowAddColModal(true) : setShowQuickAddCol((o) => !o))}
            className="flex items-center justify-center w-8 h-full text-gray-400 hover:text-indigo-600 hover:bg-indigo-50/50 transition-colors"
            aria-label="Add subitem column"
          >
            <FiPlus size={13} aria-hidden="true" />
          </button>

          {/* Lightweight quick-add used only while the group is still being created in the background */}
          {showQuickAddCol && !subitemGroup && (
            <>
              <div className="fixed inset-0 z-[9990]" onClick={() => setShowQuickAddCol(false)} aria-hidden="true" />
              <div className="absolute top-full right-0 mt-1 z-[9991] bg-white border border-gray-200 rounded-lg shadow-lg p-3 w-52 flex flex-col gap-2">
                <input
                  autoFocus
                  type="text"
                  value={quickColName}
                  onChange={(e) => setQuickColName(e.target.value)}
                  placeholder="Column name…"
                  className="w-full text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  aria-label="New column name"
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleQuickAddColumn(); if (e.key === 'Escape') setShowQuickAddCol(false); }}
                />
                <select
                  value={quickColType}
                  onChange={(e) => setQuickColType(e.target.value as ColumnType)}
                  className="w-full text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
                  aria-label="Column type"
                >
                  {Object.values(ColumnType).map((t) => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()}</option>
                  ))}
                </select>
                <div className="flex justify-end gap-1">
                  <button type="button" onClick={() => setShowQuickAddCol(false)} className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700" aria-label="Cancel">
                    Cancel
                  </button>
                  <button type="button" onClick={() => void handleQuickAddColumn()} className="px-2 py-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium" aria-label="Create column">
                    Add
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        )}
      </div>

      {showAddColModal && subitemGroup && (
        <AddColumnModal
          boardId={boardId}
          parentGroupId={subitemGroup.id}
          onClose={() => setShowAddColModal(false)}
        />
      )}

      {/* Change type — replacement column modal, rendered here (not inside the per-column
          header) since the deleted column's header unmounts as soon as it's removed. The
          old column is only deleted once its replacement is created (or never, if this
          modal is cancelled). */}
      {swapAddModal && subitemGroup && (
        <AddColumnModal
          boardId={boardId}
          parentGroupId={subitemGroup.id}
          onClose={() => setSwapAddModal(null)}
          replaceColumnId={swapAddModal.replaceColumnId}
          replaceColumnType={swapAddModal.replaceColumnType}
        />
      )}

      {/* Item rows */}
      <div role="rowgroup">
        {itemsFetching && realItems.length === 0 && pendingItems.length === 0 ? (
          <div className="px-3 py-2 text-xs text-gray-400 flex items-center gap-1">
            <FiLoader size={10} className="animate-spin" aria-hidden="true" /> Loading…
          </div>
        ) : (
          <>
            {displayedItems.map((item) => (
              <SubitemRow
                key={item.id}
                item={item}
                columns={columns}
                canManageItems={canManageItems}
                personalOverlayColumns={personalOverlayColumns}
                personalOwnerId={personalOwnerId}
                personalEditable={personalEditable}
                personalValues={personalValuesByItem[item.id]}
              />
            ))}
            {pendingItems.map((p) => (
              <div key={p.tempId} role="row" className="flex items-center gap-2 border-b border-[#e5e7eb] px-3 py-1.5 opacity-60">
                <FiLoader size={10} className="animate-spin flex-shrink-0 text-indigo-400" aria-hidden="true" />
                <span className="text-xs text-gray-500 truncate">{p.name}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Add subitem row */}
      {canManageItems && (
      <div className="px-3 py-1.5 rounded-b-lg">
        {addingItem ? (
          <div className="flex items-center gap-2">
            <input
              ref={(el) => {
                addItemInputRef.current = el;
                if (el && shouldFocusOnMount.current) {
                  shouldFocusOnMount.current = false;
                  el.focus();
                }
              }}
              autoFocus
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={handleAddItemKeyDown}
              onBlur={() => { if (newItemName.trim()) void handleAddItem(); else setAddingItem(false); }}
              placeholder="Subitem name… (Enter to save)"
              disabled={isCreatingItem}
              className="flex-1 text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
              aria-label="New subitem name"
            />
            {isCreatingItem && <FiLoader size={11} className="animate-spin text-indigo-500" aria-hidden="true" />}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingItem(true)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-600 transition-colors"
            aria-label="Add subitem"
          >
            <FiPlus size={12} aria-hidden="true" />
            Add subitem
          </button>
        )}
      </div>
      )}
    </div>
  );
};

export default SubitemGroup;
