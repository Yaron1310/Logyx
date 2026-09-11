import React, { useState, useRef, useEffect } from 'react';
import { FiX, FiArchive, FiRotateCcw, FiTrash2, FiLoader, FiMessageSquare, FiFileText } from 'react-icons/fi';
import { useColumns } from '../../hooks/queries/useColumnQueries';
import { useItem, useUpdateItem, useArchiveItem, useRestoreItem, useDeleteItem } from '../../hooks/queries/useItemQueries';
import { useUndo } from '../../contexts/UndoContext';
import { useAuthSession } from '../../hooks/useAuthSession';
import { UserRole } from '../../types';
import type { Item } from '../../types';
import { ColumnCell } from './cells';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { formatItemName } from '../../utils/formatItemName';
import { getUnreadCount, hasReadMessages } from './ItemChatModal';
import { useBoardRender } from '../../contexts/BoardRenderContext';

interface ItemDetailPanelProps {
  item: Item;
  onClose: () => void;
}

const ItemDetailPanel: React.FC<ItemDetailPanelProps> = ({ item: initialItem, onClose }) => {
  const { user, isPublicView } = useAuthSession();
  const { openChat, openForms } = useBoardRender();
  const { data: columns = [] } = useColumns(initialItem.boardId);
  const { data: liveItem } = useItem(initialItem.id);
  const item = liveItem ?? initialItem;

  const { mutateAsync: updateItem, isPending: isSaving } = useUpdateItem();
  const { mutateAsync: archiveItem, isPending: isArchiving } = useArchiveItem();
  const { mutateAsync: restoreItem, isPending: isRestoring } = useRestoreItem();
  const { mutateAsync: deleteItem, isPending: isDeleting } = useDeleteItem();
  const { push: pushUndo } = useUndo();

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(item.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const unreadCount = user ? getUnreadCount(user.id, item) : 0;
  const readMessages = user ? hasReadMessages(user.id, item) : false;
  const formSubmitted = item.formSubmitted === true;
  const nameInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);

  const canManage =
    user?.role === UserRole.WORKSPACE_ADMIN ||
    user?.role === UserRole.ORG_EDITOR ||
    user?.role === UserRole.ORGANIZATION_ADMIN ||
    user?.role === UserRole.SYSTEM_ADMIN ||
    item.createdBy === user?.id ||
    (item.assignees ?? []).includes(user?.id ?? '');

  const canDelete =
    user?.role === UserRole.WORKSPACE_ADMIN ||
    user?.role === UserRole.ORG_EDITOR ||
    user?.role === UserRole.ORGANIZATION_ADMIN ||
    user?.role === UserRole.SYSTEM_ADMIN;

  useEffect(() => {
    setNameValue(item.name);
  }, [item.name]);

  useEffect(() => {
    if (editingName) nameInputRef.current?.select();
  }, [editingName]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !editingName) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, editingName]);

  const commitNameEdit = async () => {
    setEditingName(false);
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === item.name) return;
    const prevName = item.name;
    pushUndo({ label: `Renamed "${prevName}" to "${trimmed}"`, undo: () => { void updateItem({ id: item.id, patch: { name: prevName } }); } });
    await updateItem({ id: item.id, patch: { name: trimmed } }).catch(() => {
      setNameValue(item.name);
    });
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void commitNameEdit();
    if (e.key === 'Escape') {
      setEditingName(false);
      setNameValue(item.name);
    }
  };

  const handleArchive = async () => {
    await archiveItem(item.id);
  };

  const handleRestore = async () => {
    await restoreItem(item.id);
  };

  const handleDelete = async () => {
    await deleteItem(item.id);
    onClose();
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[10100] bg-black/20"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-detail-title"
        className="fixed right-0 top-0 bottom-0 z-[10150] w-full max-w-md bg-white shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex-1 min-w-0">
            {editingName && canManage ? (
              <input
                ref={nameInputRef}
                type="text"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onBlur={() => void commitNameEdit()}
                onKeyDown={handleNameKeyDown}
                disabled={isSaving}
                className="text-base font-semibold text-gray-800 bg-transparent border-b-2 border-indigo-500 outline-none w-full"
                aria-label="Edit item name"
              />
            ) : (
              <h2
                id="item-detail-title"
                className={`text-base font-semibold text-gray-800 truncate ${canManage ? 'cursor-pointer hover:text-indigo-600 transition-colors' : ''}`}
                onClick={() => canManage && setEditingName(true)}
                title={canManage ? 'Click to rename' : undefined}
              >
                {formatItemName(item.name)}
                {item.isArchived && (
                  <span className="ml-2 text-xs font-normal text-gray-400">(archived)</span>
                )}
              </h2>
            )}
          </div>
          {/* Forms and chat aren't available in the public read-only view — the row's own
              buttons are hidden there too, and this panel is the fallback a viewer lands on. */}
          {!isPublicView && (
          <>
          <button
            type="button"
            onClick={() => openForms(item)}
            className="relative flex items-center justify-center p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors flex-shrink-0"
            aria-label={`Open form for ${item.name}${formSubmitted ? ' (submitted)' : ''}`}
          >
            <FiFileText size={16} aria-hidden="true" />
            {formSubmitted && (
              <span
                className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full"
                aria-hidden="true"
              />
            )}
          </button>
          <button
            type="button"
            onClick={() => openChat(item)}
            className="relative flex items-center justify-center p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors flex-shrink-0"
            aria-label={`Open chat for ${item.name}`}
          >
            <FiMessageSquare size={16} aria-hidden="true" />
            {unreadCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[14px] h-[14px] px-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full leading-none"
                aria-label={`${unreadCount} unread message${unreadCount !== 1 ? 's' : ''}`}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
            {unreadCount === 0 && readMessages && (
              <span
                className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-gray-300 rounded-full"
                aria-label="This item has messages, all read"
              />
            )}
          </button>
          </>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors rounded-md p-1 flex-shrink-0"
            aria-label="Close item detail panel"
          >
            <FiX size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Column values */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {columns.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No columns defined.</p>
          ) : (
            <div role="grid" aria-label={`Fields for ${item.name}`} className="divide-y divide-gray-50">
              {columns.map((col) => (
                <div key={col.id} role="row" className="flex items-stretch min-h-[40px]">
                  <div
                    role="rowheader"
                    className="flex items-center w-36 flex-shrink-0 text-xs font-medium text-gray-500 pr-3 py-2"
                  >
                    {col.name}
                  </div>
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <ColumnCell item={item} column={col} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer actions */}
        {canManage && (
          <div className="flex items-center gap-2 px-5 py-4 border-t border-gray-200 flex-shrink-0 bg-gray-50">
            {confirmDelete ? (
              <>
                <span className="text-sm text-red-600 flex-1">Delete this item?</span>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={isDeleting}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors disabled:opacity-60"
                  aria-label="Confirm delete item"
                >
                  {isDeleting ? (
                    <FiLoader className="animate-spin" size={13} aria-hidden="true" />
                  ) : (
                    'Delete'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  aria-label="Cancel delete"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                {item.isArchived ? (
                  <button
                    type="button"
                    onClick={() => void handleRestore()}
                    disabled={isRestoring}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors disabled:opacity-60"
                    aria-label="Restore item"
                  >
                    <FiRotateCcw size={13} aria-hidden="true" />
                    Restore
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleArchive()}
                    disabled={isArchiving}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-60"
                    aria-label="Archive item"
                  >
                    <FiArchive size={13} aria-hidden="true" />
                    Archive
                  </button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors ml-auto"
                    aria-label="Delete item"
                  >
                    <FiTrash2 size={13} aria-hidden="true" />
                    Delete
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

    </>
  );
};

export default ItemDetailPanel;
