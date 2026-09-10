import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthSession } from '../../hooks/useAuthSession';
import {
  useBoardTemplates,
  useArchivedBoardTemplates,
  useDeleteBoard,
  useDuplicateBoard,
  useUpdateBoard,
  useRestoreBoard,
} from '../../hooks/queries/useBoardQueries';
import { useWorkspacesQuery } from '../../hooks/queries/useOrganizationQueries';
import { UserRole, Board } from '../../types';
import {
  FiBookmark, FiMoreVertical, FiPlus, FiArchive, FiDownload, FiLoader,
  FiX, FiInbox, FiRotateCcw, FiLayout, FiUser,
} from 'react-icons/fi';
import ReactDOM from 'react-dom';
import BoardContextMenu from './BoardContextMenu';
import EditBoardModal from './EditBoardModal';
import CreateBoardModal from './CreateBoardModal';
import DuplicateOptionsModal from './DuplicateOptionsModal';
import { importBoardFromXlsx } from '../../utils/importBoardFromXlsx';
import type { DuplicateMode } from '../../services/workManagementService';

const TemplatesPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthSession();
  const queryClient = useQueryClient();
  const { data: templates = [], isLoading } = useBoardTemplates();
  const { data: allWorkspaces = [] } = useWorkspacesQuery();
  const { mutateAsync: deleteBoard } = useDeleteBoard();
  const { mutateAsync: duplicateBoard } = useDuplicateBoard();
  const { mutateAsync: updateBoard } = useUpdateBoard();
  const { mutateAsync: restoreBoard } = useRestoreBoard();

  const [menuBoardId, setMenuBoardId] = React.useState<string | null>(null);
  const [menuTriggerRect, setMenuTriggerRect] = React.useState<DOMRect | null>(null);
  const [editingBoard, setEditingBoard] = React.useState<Board | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  const [duplicateTargetId, setDuplicateTargetId] = React.useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = React.useState(false);
  const [showArchiveModal, setShowArchiveModal] = React.useState(false);
  const [restoringId, setRestoringId] = React.useState<string | null>(null);
  const [isImporting, setIsImporting] = React.useState(false);
  const [importError, setImportError] = React.useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const { data: archivedTemplates = [], isLoading: archivedLoading, refetch: refetchArchived } =
    useArchivedBoardTemplates(showArchiveModal);

  const canManage =
    user?.role === UserRole.WORKSPACE_ADMIN ||
    user?.role === UserRole.ORGANIZATION_ADMIN ||
    user?.role === UserRole.SYSTEM_ADMIN;

  const menuBoard = menuBoardId ? templates.find((b) => b.id === menuBoardId) : null;

  const handleDelete = async (id: string) => {
    setConfirmDeleteId(null);
    await deleteBoard(id).catch(() => {});
  };

  const handleDuplicate = async (mode: DuplicateMode) => {
    if (!duplicateTargetId) return;
    const id = duplicateTargetId;
    setDuplicateTargetId(null);
    await duplicateBoard({ id, mode }).catch(() => {});
  };

  const handleRestore = async (id: string) => {
    setRestoringId(id);
    await restoreBoard(id).catch(() => {});
    setRestoringId(null);
    void refetchArchived();
  };

  const handleImportClick = () => {
    setImportError(null);
    importInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const firstRealWorkspace = allWorkspaces.find((w) => !w.isPersonal);
    if (!firstRealWorkspace) {
      setImportError('No WorkHub available for import.');
      return;
    }

    setIsImporting(true);
    setImportError(null);
    try {
      const result = await importBoardFromXlsx(file, firstRealWorkspace.id);
      await queryClient.invalidateQueries({ queryKey: ['boards'] });
      navigate(`/boards/${result.boardId}`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed. Please check the file format.');
    } finally {
      setIsImporting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64" role="status" aria-label="Loading templates">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Templates</h1>
          <p className="text-sm text-gray-500 mt-1">Reusable board templates for your organization</p>
        </div>
        <div className="flex items-center gap-3">
          {canManage && (
            <button
              type="button"
              onClick={() => setShowArchiveModal(true)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              aria-label="View archived templates"
            >
              <FiArchive size={14} aria-hidden="true" />
              Archived
            </button>
          )}
          {canManage && (
            <>
              <input
                ref={importInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                aria-hidden="true"
                onChange={(e) => { void handleImportFile(e); }}
              />
              <button
                type="button"
                onClick={handleImportClick}
                disabled={isImporting}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                aria-label="Import template from Excel file"
              >
                {isImporting ? (
                  <FiLoader size={16} className="animate-spin" aria-hidden="true" />
                ) : (
                  <FiDownload size={16} aria-hidden="true" />
                )}
                {isImporting ? 'Importing…' : 'Import'}
              </button>
            </>
          )}
          {user?.role === UserRole.ORGANIZATION_ADMIN && (
            <button
              type="button"
              onClick={() => navigate('/admin/templates/personal-hub')}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors"
              aria-label="Edit Personal Hub default template"
            >
              <FiUser size={16} aria-hidden="true" />
              Personal Hub Template
            </button>
          )}
          {canManage && (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
              aria-label="Create new template"
            >
              <FiPlus size={16} aria-hidden="true" />
              New Template
            </button>
          )}
        </div>
      </div>

      {importError && (
        <div
          className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700"
          role="alert"
        >
          {importError}
        </div>
      )}

      {templates.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-gray-400 gap-3">
          <FiBookmark size={40} aria-hidden="true" />
          <p className="text-base">No templates yet.</p>
          <p className="text-sm text-center max-w-sm">
            Save any board as a template using the 3-dot menu on a board card, or create a new template above.
          </p>
        </div>
      ) : (
        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          role="list"
          aria-label="Board templates"
        >
          {templates.map((board) => (
            <div
              key={board.id}
              role="listitem"
              className="group relative flex items-start gap-4 p-5 bg-white rounded-xl shadow-sm border border-gray-200 hover:shadow-md hover:border-indigo-300 transition-all cursor-pointer"
              onClick={() => navigate(`/boards/${board.id}`)}
              aria-label={`Open template ${board.name}`}
            >
              <div className="flex-shrink-0 w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center">
                <FiBookmark className="text-amber-500" size={20} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1 pr-10">
                <p className="font-semibold truncate text-gray-800">{board.name}</p>
                {board.description && (
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">{board.description}</p>
                )}
              </div>

              {canManage && (
                <div
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                      if (menuBoardId === board.id) {
                        setMenuBoardId(null);
                        setMenuTriggerRect(null);
                      } else {
                        setMenuBoardId(board.id);
                        setMenuTriggerRect(rect);
                      }
                    }}
                    className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    aria-label={`More options for ${board.name}`}
                    aria-haspopup="true"
                    aria-expanded={menuBoardId === board.id}
                  >
                    <FiMoreVertical size={16} aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {menuBoard && menuTriggerRect && (
        <BoardContextMenu
          boardId={menuBoard.id}
          boardName={menuBoard.name}
          triggerRect={menuTriggerRect}
          workspaces={allWorkspaces.filter((w) => !w.isPersonal && !w.isTemplates)}
          currentWorkspaceId={menuBoard.workspaceId}
          canManage={canManage}
          isTemplate={true}
          onClose={() => { setMenuBoardId(null); setMenuTriggerRect(null); }}
          onOpenNewTab={() => window.open(`/boards/${menuBoard.id}`, '_blank')}
          onEdit={() => { setMenuBoardId(null); setMenuTriggerRect(null); setEditingBoard(menuBoard); }}
          onRename={() => setEditingBoard(menuBoard)}
          onMove={(wsId) => void updateBoard({ id: menuBoard.id, patch: { workspaceId: wsId } })}
          onDuplicate={() => { setMenuBoardId(null); setDuplicateTargetId(menuBoard.id); }}
          onSaveAsTemplate={() => {}}
          onArchive={() => {}}
          onDelete={() => setConfirmDeleteId(menuBoard.id)}
        />
      )}

      {editingBoard && (
        <EditBoardModal
          board={editingBoard}
          onClose={() => setEditingBoard(null)}
        />
      )}

      {showCreateModal && (
        <CreateBoardModal
          isTemplate={true}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {duplicateTargetId && (
        <DuplicateOptionsModal
          title="Duplicate template"
          confirmLabel="Duplicate"
          onConfirm={(mode) => { void handleDuplicate(mode); }}
          onClose={() => setDuplicateTargetId(null)}
        />
      )}

      {confirmDeleteId && ReactDOM.createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm delete template"
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-gray-800 mb-2">Delete template?</h3>
            <p className="text-sm text-gray-500 mb-5">This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                aria-label="Cancel delete"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(confirmDeleteId)}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
                aria-label="Confirm delete template"
              >
                Delete
              </button>
            </div>
          </div>
        </div>,
        document.getElementById('modal-root')!,
      )}

      {showArchiveModal && ReactDOM.createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Archived templates"
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800">Archived Templates</h2>
              <button
                type="button"
                onClick={() => setShowArchiveModal(false)}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                aria-label="Close archived templates"
              >
                <FiX size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {archivedLoading ? (
                <div className="flex justify-center py-12" role="status" aria-label="Loading">
                  <FiLoader className="animate-spin text-indigo-500" size={24} aria-hidden="true" />
                </div>
              ) : archivedTemplates.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-gray-400 gap-2">
                  <FiInbox size={32} aria-hidden="true" />
                  <p className="text-sm">No archived templates.</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {archivedTemplates.map((board) => (
                    <li
                      key={board.id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex-shrink-0 w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center">
                          <FiLayout className="text-amber-400" size={16} aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-700 truncate">{board.name}</p>
                          {board.description && (
                            <p className="text-xs text-gray-400 truncate">{board.description}</p>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleRestore(board.id)}
                        disabled={!!restoringId}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors disabled:opacity-50 flex-shrink-0 ml-3"
                        aria-label={`Restore template ${board.name}`}
                      >
                        {restoringId === board.id ? (
                          <FiLoader className="animate-spin" size={12} aria-hidden="true" />
                        ) : (
                          <FiRotateCcw size={12} aria-hidden="true" />
                        )}
                        Restore
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="px-5 py-3 border-t border-gray-200 flex justify-end">
              <button
                type="button"
                onClick={() => setShowArchiveModal(false)}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.getElementById('modal-root')!,
      )}
    </div>
  );
};

export default TemplatesPage;
