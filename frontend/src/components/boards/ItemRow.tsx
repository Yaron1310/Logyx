import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FiMenu, FiArchive, FiRotateCcw, FiTrash2, FiMessageSquare, FiFileText, FiEdit2, FiChevronRight } from 'react-icons/fi';
import SubitemGroup from './SubitemGroup';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useColumns } from '../../hooks/queries/useColumnQueries';
import { useArchiveItem, useRestoreItem, useUpdateItem } from '../../hooks/queries/useItemQueries';
import { useSubitemGroup } from '../../hooks/queries/useGroupQueries';
import { useAuthSession } from '../../hooks/useAuthSession';
import { useUndo } from '../../contexts/UndoContext';
import { useBoardMembers } from '../../hooks/queries/useBoardMemberQueries';
import { UserRole, BoardRole } from '../../types';
import { formatItemName } from '../../utils/formatItemName';
import type { Item } from '../../types';
import { ColumnCell } from './cells';
import { DRAG_HANDLE_WIDTH } from '../../utils/columnWidths';
import { ITEM_COL_ID } from './ColumnHeader';
import { useBoardRender } from '../../contexts/BoardRenderContext';
import { getUnreadCount } from './ItemChatModal';
import { useColumnVisibilityTier, canSeeColumn } from '../../hooks/useColumnVisibility';

interface ItemRowProps {
  item: Item;
  onOpenDetail: (item: Item) => void;
  groupColor?: string;
  /** Extra cells rendered before this item's board columns (used by Personal Hub for cross-group personal columns). */
  leadingExtraCells?: React.ReactNode;
  /** Extra cells appended after this item's board columns (used by Personal Hub for board-only personal columns). */
  extraCells?: React.ReactNode;
  /** Personal Hub only: when expanding subitems, only show ones this user is assigned to. */
  subitemAssigneeFilterId?: string;
  /**
   * Personal Hub only: stretch the row to this width so its sticky item cell stays
   * pinned across the full horizontal scroll range even when this board has fewer
   * columns than the widest board on the page. The extra space past this row's own
   * cells is filled with a grey spacer. Omitted on a normal board, where every group
   * shares the same columns and the rows are already uniform width.
   */
  groupMinWidth?: number;
}

const ItemRowInner: React.FC<ItemRowProps> = ({ item, onOpenDetail, groupColor, leadingExtraCells, extraCells, subitemAssigneeFilterId, groupMinWidth }) => {
  const { user, isPublicView, selectedWorkspace } = useAuthSession();
  const { data: columns = [] } = useColumns(item.boardId);
  const viewerTier = useColumnVisibilityTier(item.boardId);
  const visibleColumns = columns.filter((col) => canSeeColumn(col, viewerTier));
  const { boardView, columnWidths, openChat, openForms } = useBoardRender();
  const itemSectionWidth = (columnWidths[ITEM_COL_ID] ?? 298) - 16;

  const { mutateAsync: archiveItem, isPending: isArchiving } = useArchiveItem();
  const { mutateAsync: restoreItem, isPending: isRestoring } = useRestoreItem();
  const { push: pushUndo } = useUndo();
  const { data: boardMembers = [] } = useBoardMembers(item.boardId);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(item.name);
  const [subitemsOpen, setSubitemsOpen] = useState(false);
  const { data: subitemGroup } = useSubitemGroup(item.boardId, item.id);
  const inputRef = useRef<HTMLInputElement>(null);
  const { mutateAsync: updateItem } = useUpdateItem();

  useEffect(() => { setNameValue(item.name); }, [item.name]);

  useEffect(() => {
    if (editingName) inputRef.current?.select();
  }, [editingName]);

  const commitName = useCallback(async () => {
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === item.name) {
      setNameValue(item.name);
      setEditingName(false);
      return;
    }
    setEditingName(false);
    await updateItem({ id: item.id, patch: { name: trimmed } });
  }, [nameValue, item.name, item.id, updateItem]);

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commitName(); }
    if (e.key === 'Escape') { setNameValue(item.name); setEditingName(false); }
  };

  const unreadCount = user ? getUnreadCount(user.id, item) : 0;
  const formSubmitted = item.formSubmitted === true;
  const formAttached = (item.formResponseCount ?? 0) > 0;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    data: { type: 'item' as const, item },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(groupMinWidth ? { minWidth: `${groupMinWidth}px` } : {}),
  };

  const myBoardRole = boardMembers.find((m) => m.userId === user?.id)?.role;
  const isBoardEditor = myBoardRole === BoardRole.EDITOR || myBoardRole === BoardRole.ADMIN;
  // Mirrors the backend's effectiveBoardRole: a regular workspace member whose workspace
  // permission isn't read-only is an editor on every board in that workspace, even without
  // an explicit board-member row.
  const isWorkspaceEditor = user?.role === UserRole.REGULAR_USER && selectedWorkspace?.workspacePermissions !== 'read_only';

  // Groups/columns-equivalent rights for the subitem table's own column management — structural,
  // board-wide changes restricted to workspace-admin+/org-editor only. Deliberately excludes
  // both an explicit board-member editor row and workspace-level "edit" permission, matching
  // BoardViewPage's canManageStructure for top-level groups/columns.
  const canManageColumns =
    user?.role === UserRole.WORKSPACE_ADMIN ||
    user?.role === UserRole.ORG_EDITOR ||
    user?.role === UserRole.ORGANIZATION_ADMIN ||
    user?.role === UserRole.SYSTEM_ADMIN;

  // Board-wide item/subitem creation rights — same bar the backend requires to create subitems
  // (not scoped to this particular item); any editor-tier user, including an explicit board
  // editor row or workspace-level "edit" permission.
  const isBoardManager = canManageColumns || isBoardEditor || isWorkspaceEditor;

  const canManage =
    isBoardManager ||
    item.createdBy === user?.id ||
    (item.assignees ?? []).includes(user?.id ?? '');

  const handleArchive = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await archiveItem(item.id);
  };

  const handleRestore = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await restoreItem(item.id);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(true);
  };

  const handleDeleteConfirm = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const itemId = item.id;
    const itemName = item.name;
    await archiveItem(itemId);
    pushUndo({
      label: `Deleted item "${itemName}"`,
      undo: () => { void restoreItem(itemId); },
      persist: { type: 'restoreItem', itemId },
    });
  };

  const handleDeleteCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  };

  return (
    <>
    <div
      ref={setNodeRef}
      role="row"
      style={style}
      className={`flex flex-nowrap items-stretch group border-b border-[#d2d2d4] last:border-b-0 hover:bg-indigo-50/40 transition-colors w-max ${
        item.isArchived ? 'opacity-60' : ''
      } bg-white ${isDragging ? 'shadow-md opacity-50 z-10' : ''}`}
    >
      {/* Left section — drag handle, item name, and row actions */}
      <div
        className={`flex flex-shrink-0 items-stretch ${boardView !== 'rows' ? 'border-r border-[#d2d2d4]' : ''} sticky left-4 z-[1] bg-white group-hover:bg-indigo-50`}
        style={{ width: `${itemSectionWidth}px`, ...(groupColor ? { borderLeft: `4px solid ${groupColor}` } : {}) }}
      >
        {/* Drag handle — reordering isn't possible in the public read-only view, so it's
            never shown there at all rather than just being visually inert on hover. */}
        {!isPublicView && (
          <div
            className={`flex items-center justify-center ${DRAG_HANDLE_WIDTH} opacity-0 group-hover:opacity-40 cursor-grab active:cursor-grabbing text-gray-400 flex-shrink-0 touch-none`}
            aria-label="Drag to reorder item"
            aria-grabbed={isDragging}
            {...attributes}
            {...listeners}
          >
            <FiMenu size={13} aria-hidden="true" />
          </div>
        )}

        {/* Subitems expand toggle — in the public view, only show it when subitems actually
            exist (no way to create the first one there anyway, so an empty hover-reveal
            toggle would be a dead end). The real board keeps the hover-to-create affordance. */}
        {(!isPublicView || subitemGroup) && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setSubitemsOpen((o) => !o); }}
            style={(subitemsOpen || subitemGroup) && groupColor ? { color: groupColor } : undefined}
            className={`flex items-center justify-center w-5 flex-shrink-0 transition-all ${subitemsOpen ? 'opacity-100' : subitemGroup ? 'opacity-60' : 'opacity-0 group-hover:opacity-100 text-gray-400 hover:text-indigo-600'}`}
            aria-label={subitemsOpen ? `Collapse subitems for ${item.name}` : `Expand subitems for ${item.name}`}
            aria-expanded={subitemsOpen}
          >
            <FiChevronRight
              size={13}
              aria-hidden="true"
              className={`transition-transform duration-150 ${subitemsOpen ? 'rotate-90' : ''}`}
            />
          </button>
        )}

        {/* Item name */}
        <div
          role="gridcell"
          className="flex items-center flex-1 min-w-0 pl-3 py-2 group-hover:pr-3"
        >
          {editingName && canManage ? (
            <input
              ref={inputRef}
              value={nameValue}
              onChange={e => setNameValue(e.target.value)}
              onBlur={commitName}
              onKeyDown={handleNameKeyDown}
              onClick={e => e.stopPropagation()}
              className="w-full text-sm font-medium text-gray-800 bg-white border border-indigo-400 rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-indigo-400"
              aria-label="Edit item name"
            />
          ) : (
            <div
              className="flex items-center gap-1 flex-1 min-w-0 cursor-text group/name"
              onClick={() => canManage ? setEditingName(true) : onOpenDetail(item)}
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') canManage ? setEditingName(true) : onOpenDetail(item); }}
              aria-label={canManage ? `Edit name of ${item.name}` : `Open details for ${item.name}`}
            >
              <span className="text-sm font-medium text-gray-800 truncate">{formatItemName(item.name)}</span>
              {item.isArchived && (
                <span className="ml-2 text-xs text-gray-400 flex-shrink-0">(archived)</span>
              )}
              {canManage && (
                <FiEdit2
                  size={10}
                  aria-hidden="true"
                  className="flex-shrink-0 text-gray-400 w-0 overflow-hidden group-hover:w-auto ml-0 group-hover:ml-1 transition-all"
                />
              )}
            </div>
          )}
        </div>

        {/* Row actions — hidden until hover */}
        <div
          className="flex items-center gap-2 flex-shrink-0 w-0 overflow-hidden group-hover:w-auto group-hover:overflow-visible transition-all duration-150"
          role="gridcell"
          aria-label="Row actions"
        >
          {canManage && (
            <>
              {confirmDelete ? (
                <>
                  <button
                    type="button"
                    onClick={handleDeleteConfirm}
                    disabled={isArchiving}
                    className="px-1.5 py-0.5 text-xs text-white bg-red-500 rounded hover:bg-red-600 transition-colors disabled:opacity-60"
                    aria-label="Confirm delete"
                  >
                    {isArchiving ? '…' : 'Del'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteCancel}
                    className="px-1.5 py-0.5 text-xs text-gray-500 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
                    aria-label="Cancel"
                  >
                    ✕
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-0.5">
                  {item.isArchived ? (
                    <button
                      type="button"
                      onClick={handleRestore}
                      disabled={isRestoring}
                      className="flex items-center justify-center w-6 h-6 text-green-600 hover:bg-green-50 rounded transition-colors disabled:opacity-60"
                      aria-label={`Restore item ${item.name}`}
                    >
                      <FiRotateCcw size={13} aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleArchive}
                      disabled={isArchiving}
                      className="flex items-center justify-center w-6 h-6 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors disabled:opacity-60"
                      aria-label={`Archive item ${item.name}`}
                    >
                      <FiArchive size={13} aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleDeleteClick}
                    className="flex items-center justify-center w-6 h-6 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                    aria-label={`Delete item ${item.name}`}
                  >
                    <FiTrash2 size={13} aria-hidden="true" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Forms + chat — hidden in the public view, where neither is available */}
        {!isPublicView && (
          <div className="flex items-center pr-1.5 flex-shrink-0" role="gridcell">
            {/* Form — visible on row hover, but stays visible once a form is attached
                (same as the always-on chat icon); once submitted the icon turns blue
                instead of showing a dot */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openForms(item); }}
              className={`relative flex items-center justify-center w-6 h-6 rounded transition-all ${
                formSubmitted
                  ? 'text-blue-600 hover:bg-indigo-50'
                  : `text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 ${
                      formAttached ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                    }`
              }`}
              aria-label={`Open form for ${item.name}${formSubmitted ? ' (submitted)' : ''}`}
            >
              <FiFileText size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openChat(item); }}
              className="relative flex items-center justify-center w-6 h-6 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
              aria-label={`Open chat for ${item.name}`}
            >
              <FiMessageSquare size={16} aria-hidden="true" />
              {unreadCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 flex items-center justify-center min-w-[14px] h-[14px] px-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full leading-none"
                  aria-label={`${unreadCount} unread message${unreadCount !== 1 ? 's' : ''}`}
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
          </div>
        )}
      </div>

      {leadingExtraCells}

      {/* Dynamic column cells */}
      {visibleColumns.map((col) => (
        <ColumnCell key={col.id} item={item} column={col} groupColor={groupColor} />
      ))}

      {extraCells}

      {/* Grey filler so this row reaches the page's uniform board width — keeps the
          sticky item cell pinned across the full scroll even on narrow boards. */}
      {groupMinWidth ? <div className="flex-1 bg-gray-100" aria-hidden="true" /> : null}

    </div>
    {subitemsOpen && (
      <SubitemGroup
        boardId={item.boardId}
        workspaceId={item.workspaceId}
        parentItemId={item.id}
        groupColor={groupColor}
        onEmpty={() => setSubitemsOpen(false)}
        filterAssigneeId={subitemAssigneeFilterId}
        canManageItems={isBoardManager}
        canManageColumns={canManageColumns}
      />
    )}
    </>
  );
};

const ItemRow = React.memo(ItemRowInner);
export default ItemRow;
