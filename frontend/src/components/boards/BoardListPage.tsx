import React from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useBoards, useArchiveBoard, useRestoreBoard, useDeleteBoard, useDuplicateBoard, useSaveAsBoardTemplate, useUpdateBoard, useReorderBoards } from '../../hooks/queries/useBoardQueries';
import { useWorkspacesQuery } from '../../hooks/queries/useOrganizationQueries';
import { useCustomDashboards } from '../../hooks/queries/useCustomDashboardQueries';
import { useAuthSession } from '../../hooks/useAuthSession';
import { UserRole, Board, CustomDashboard } from '../../types';
import {
  FiLayout, FiPlus, FiArchive, FiArrowLeft, FiX,
  FiRotateCcw, FiLoader, FiInbox, FiDownload, FiMoreVertical, FiMenu,
} from 'react-icons/fi';
import ReactDOM from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import CreateBoardModal from './CreateBoardModal';
import EditBoardModal from './EditBoardModal';
import BoardContextMenu from './BoardContextMenu';
import DuplicateOptionsModal from './DuplicateOptionsModal';
import { importBoardFromXlsx } from '../../utils/importBoardFromXlsx';
import type { DuplicateMode } from '../../services/workManagementService';

const OverflowText: React.FC<{ text: string; className: string }> = ({ text, className }) => {
  const ref = React.useRef<HTMLParagraphElement>(null);
  const [clipped, setClipped] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setClipped(el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  return (
    <div className="relative">
      <p
        ref={ref}
        className={className}
        onMouseEnter={() => clipped && setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >{text}</p>
      {clipped && hovered && (
        <div className="absolute left-0 top-full mt-1 z-50 max-w-xs bg-gray-100 text-gray-700 border border-gray-200 text-xs rounded px-2 py-1 shadow-md pointer-events-none whitespace-pre-wrap break-words">
          {text}
        </div>
      )}
    </div>
  );
};

interface SortableBoardCardProps {
  board: Board;
  canReorder: boolean;
  children: React.ReactNode;
}

const SortableBoardCard: React.FC<SortableBoardCardProps> = ({ board, canReorder, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: board.id,
    disabled: !canReorder,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="relative"
    >
      {canReorder && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-2 left-2 z-10 p-1 text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab touch-none"
          aria-label={`Reorder board ${board.name}`}
        >
          <FiMenu size={14} aria-hidden="true" />
        </button>
      )}
      {children}
    </div>
  );
};

const BoardListPage: React.FC = () => {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation();
  const { user } = useAuthSession();
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = React.useState(false);

  React.useEffect(() => {
    if (searchParams.get('newBoard') === 'true') {
      setShowCreateModal(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);
  const [renamingBoardId, setRenamingBoardId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  const renameInputRef = React.useRef<HTMLInputElement>(null);
  React.useLayoutEffect(() => {
    if (renamingBoardId !== null) {
      const el = renameInputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }
  }, [renamingBoardId]);
  const [showArchiveModal, setShowArchiveModal] = React.useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  const [duplicateTargetId, setDuplicateTargetId] = React.useState<string | null>(null);
  const [templateTargetId, setTemplateTargetId] = React.useState<string | null>(null);
  const [isImporting, setIsImporting] = React.useState(false);
  const [importError, setImportError] = React.useState<string | null>(null);
  const importInputRef = React.useRef<HTMLInputElement>(null);

  // Context menu state
  const [menuBoardId, setMenuBoardId] = React.useState<string | null>(null);
  const [menuTriggerRect, setMenuTriggerRect] = React.useState<DOMRect | null>(null);
  const [editingBoard, setEditingBoard] = React.useState<Board | null>(null);

  const handleImportClick = () => {
    setImportError(null);
    importInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !workspaceId) return;
    e.target.value = '';

    setIsImporting(true);
    setImportError(null);
    try {
      const result = await importBoardFromXlsx(file, workspaceId);
      await queryClient.invalidateQueries({ queryKey: ['boards'] });
      navigate(`/boards/${result.boardId}`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed. Please check the file format.');
    } finally {
      setIsImporting(false);
    }
  };

  const { data: allWorkspaces = [] } = useWorkspacesQuery();
  const currentWorkspace = allWorkspaces.find((w) => w.id === workspaceId);
  const workspaceName = currentWorkspace?.name ?? 'Boards';

  const { data: allDashboards = [] } = useCustomDashboards(false);

  const getDashboardsUsingBoard = React.useCallback((boardId: string): CustomDashboard[] => {
    return allDashboards.filter((d) => {
      if (d.config.type === 'metric') return d.config.metrics.some((m) => m.boardId === boardId);
      if (d.config.type === 'timeseries') {
        const cfg = d.config;
        return cfg.boardId === boardId || (cfg.series ?? []).some((s) => s.boardId === boardId);
      }
      return (d.config as { boardId: string }).boardId === boardId;
    });
  }, [allDashboards]);

  const { data: boards = [], isLoading, error } = useBoards(workspaceId, false, !!workspaceId);
  const { data: archivedBoards = [], isLoading: archivedLoading, refetch: refetchArchived } = useBoards(
    workspaceId,
    true,
    showArchiveModal && !!workspaceId,
  );

  const { mutateAsync: archiveBoard } = useArchiveBoard();
  const { mutateAsync: restoreBoard } = useRestoreBoard();
  const { mutateAsync: deleteBoard } = useDeleteBoard();
  const { mutateAsync: duplicateBoard } = useDuplicateBoard();
  const { mutateAsync: saveAsTemplate } = useSaveAsBoardTemplate();
  const { mutateAsync: updateBoard } = useUpdateBoard();
  const { mutateAsync: reorderBoards } = useReorderBoards();

  const [localBoards, setLocalBoards] = React.useState<Board[]>(boards);
  React.useEffect(() => { setLocalBoards(boards); }, [boards]);

  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const canReorderBoards =
    user?.role === UserRole.ORGANIZATION_ADMIN || user?.role === UserRole.SYSTEM_ADMIN;

  const handleBoardDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !workspaceId) return;
    const oldIndex = localBoards.findIndex((b) => b.id === active.id);
    const newIndex = localBoards.findIndex((b) => b.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(localBoards, oldIndex, newIndex);
    setLocalBoards(reordered);
    void reorderBoards({
      workspaceId,
      order: reordered.map((b, idx) => ({ id: b.id, order: idx })),
    }).catch(() => setLocalBoards(boards));
  };

  const [actioningId, setActioningId] = React.useState<string | null>(null);
  const [restoringId, setRestoringId] = React.useState<string | null>(null);

  const onlyArchived = React.useMemo(
    () => archivedBoards.filter((b) => b.isArchived),
    [archivedBoards],
  );

  const handleArchive = async (id: string) => {
    setActioningId(id);
    setMenuBoardId(null);
    await archiveBoard(id).catch(() => {});
    setActioningId(null);
  };

  const handleDelete = async (id: string) => {
    setActioningId(id);
    setConfirmDeleteId(null);
    await deleteBoard(id).catch(() => {});
    setActioningId(null);
  };

  const handleRenameStart = (board: Board) => {
    setMenuBoardId(null);
    setRenamingBoardId(board.id);
    setRenameValue(board.name);
  };

  const handleRenameSubmit = async (id: string) => {
    const trimmed = renameValue.trim();
    setRenamingBoardId(null);
    if (trimmed && trimmed !== boards.find((b) => b.id === id)?.name) {
      await updateBoard({ id, patch: { name: trimmed } }).catch(() => {});
    }
  };

  const handleDuplicate = async (mode: DuplicateMode) => {
    if (!duplicateTargetId) return;
    const id = duplicateTargetId;
    setDuplicateTargetId(null);
    await duplicateBoard({ id, mode }).catch(() => {});
  };

  const handleSaveAsTemplate = async (mode: DuplicateMode) => {
    if (!templateTargetId) return;
    const id = templateTargetId;
    setTemplateTargetId(null);
    await saveAsTemplate({ id, mode }).catch(() => {});
    navigate('/admin/templates');
  };

  const handleRestore = async (id: string) => {
    setRestoringId(id);
    await restoreBoard(id).catch(() => {});
    setRestoringId(null);
    void refetchArchived();
  };

  const canManageBoards =
    user?.role === UserRole.WORKSPACE_ADMIN ||
    user?.role === UserRole.ORGANIZATION_ADMIN ||
    user?.role === UserRole.SYSTEM_ADMIN;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64" role="status" aria-label="Loading boards">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6" role="alert">
        <p className="text-red-600">Failed to load boards.</p>
      </div>
    );
  }

  const menuBoard = menuBoardId ? boards.find((b) => b.id === menuBoardId) : null;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-4">
        <button
          type="button"
          onClick={() => navigate('/WorkHubs')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          aria-label={`Back to ${t('layout.workspaces').toLowerCase()}`}
        >
          <FiArrowLeft size={15} aria-hidden="true" />
          {t('layout.workspaces')}
        </button>
      </div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">{workspaceName}</h1>
        <div className="flex items-center gap-3">
          {canManageBoards && (
            <button
              onClick={() => setShowArchiveModal(true)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              aria-label="View archived boards"
            >
              <FiArchive size={14} aria-hidden="true" />
              Archived
            </button>
          )}
          {canManageBoards && (
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
                aria-label="Import board from Excel file"
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
          {canManageBoards && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
              aria-label="Create new board"
            >
              <FiPlus size={16} aria-hidden="true" />
              New Board
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

      {localBoards.length === 0 ? (
        <p className="text-gray-500">No boards yet.</p>
      ) : (
        <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleBoardDragEnd}>
        <SortableContext items={localBoards.map((b) => b.id)} strategy={verticalListSortingStrategy}>
        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          role="list"
          aria-label="Boards"
        >
          {localBoards.map((board) => (
            <SortableBoardCard key={board.id} board={board} canReorder={canReorderBoards}>
            <div
              role="listitem"
              className="group relative flex items-start gap-4 p-5 bg-white rounded-xl shadow-sm border border-gray-200 hover:shadow-md hover:border-indigo-300 transition-all cursor-pointer"
              onClick={() => renamingBoardId !== board.id && navigate(`/boards/${board.id}`)}
              aria-label={`Open board ${board.name}`}
            >
              <div className="flex-shrink-0 w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center">
                <FiLayout className="text-indigo-500" size={20} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                {renamingBoardId === board.id ? (
                  <input
                    ref={renameInputRef}
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => { void handleRenameSubmit(board.id); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { void handleRenameSubmit(board.id); }
                      if (e.key === 'Escape') { setRenamingBoardId(null); }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full font-semibold text-gray-800 border border-indigo-400 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    aria-label={`Rename board ${board.name}`}
                  />
                ) : (
                  <p className="font-semibold break-words text-gray-800">{board.name}</p>
                )}
                {board.description && (
                  <OverflowText
                    text={board.description}
                    className="text-sm text-gray-500 mt-1 line-clamp-2"
                  />
                )}
              </div>

              {/* 3-dot context menu trigger */}
              {canManageBoards && (
                <div
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => e.stopPropagation()}
                >
                  {actioningId === board.id ? (
                    <FiLoader className="animate-spin text-gray-400 m-1.5" size={16} aria-hidden="true" />
                  ) : (
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
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
                  )}
                </div>
              )}
            </div>
            </SortableBoardCard>
          ))}
        </div>
        </SortableContext>
        </DndContext>
      )}

      {/* Context menu */}
      {menuBoard && menuTriggerRect && (
        <BoardContextMenu
          boardId={menuBoard.id}
          boardName={menuBoard.name}
          triggerRect={menuTriggerRect}
          workspaces={allWorkspaces.filter((w) => !w.isPersonal && !w.isTemplates)}
          currentWorkspaceId={workspaceId ?? ''}
          canManage={canManageBoards}
          onClose={() => { setMenuBoardId(null); setMenuTriggerRect(null); }}
          onOpenNewTab={() => window.open(`/boards/${menuBoard.id}`, '_blank')}
          onEdit={() => { setMenuBoardId(null); setMenuTriggerRect(null); setEditingBoard(menuBoard); }}
          onRename={() => handleRenameStart(menuBoard)}
          onMove={(wsId) => void updateBoard({ id: menuBoard.id, patch: { workspaceId: wsId } })}
          onDuplicate={() => { setMenuBoardId(null); setDuplicateTargetId(menuBoard.id); }}
          onSaveAsTemplate={() => { setMenuBoardId(null); setTemplateTargetId(menuBoard.id); }}
          onArchive={() => void handleArchive(menuBoard.id)}
          onDelete={() => setConfirmDeleteId(menuBoard.id)}
        />
      )}

      {/* Delete confirmation dialog */}
      {confirmDeleteId && ReactDOM.createPortal(
        (() => {
          const affectedDashboards = getDashboardsUsingBoard(confirmDeleteId);
          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
              role="dialog"
              aria-modal="true"
              aria-label="Confirm delete board"
            >
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
                <h3 className="text-base font-semibold text-gray-800 mb-2">Delete board?</h3>
                {affectedDashboards.length > 0 ? (
                  <div className="mb-5">
                    <p className="text-sm text-gray-600 mb-2">
                      This board is the data source for{' '}
                      <strong>{affectedDashboards.length} dashboard{affectedDashboards.length > 1 ? 's' : ''}</strong>.
                      Deleting it will leave {affectedDashboards.length > 1 ? 'those dashboards' : 'that dashboard'} without a data source.
                    </p>
                    <ul className="text-sm text-gray-500 list-disc list-inside space-y-0.5 mb-2">
                      {affectedDashboards.map((d) => (
                        <li key={d.id}>{d.name}</li>
                      ))}
                    </ul>
                    <p className="text-xs text-amber-600 font-medium">This action cannot be undone.</p>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 mb-5">This action cannot be undone.</p>
                )}
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
                    aria-label="Confirm delete board"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          );
        })(),
        document.getElementById('modal-root')!,
      )}

      {showCreateModal && (
        <CreateBoardModal
          workspaceId={workspaceId}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {editingBoard && (
        <EditBoardModal
          board={editingBoard}
          onClose={() => setEditingBoard(null)}
        />
      )}

      {duplicateTargetId && (
        <DuplicateOptionsModal
          title="Duplicate board"
          confirmLabel="Duplicate"
          onConfirm={(mode) => { void handleDuplicate(mode); }}
          onClose={() => setDuplicateTargetId(null)}
        />
      )}

      {templateTargetId && (
        <DuplicateOptionsModal
          title="Save as template"
          confirmLabel="Save"
          onConfirm={(mode) => { void handleSaveAsTemplate(mode); }}
          onClose={() => setTemplateTargetId(null)}
        />
      )}

      {/* Archived boards modal */}
      {showArchiveModal && ReactDOM.createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Archived boards"
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800">Archived Boards</h2>
              <button
                type="button"
                onClick={() => setShowArchiveModal(false)}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                aria-label="Close archived boards"
              >
                <FiX size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {archivedLoading ? (
                <div className="flex justify-center py-12" role="status" aria-label="Loading">
                  <FiLoader className="animate-spin text-indigo-500" size={24} aria-hidden="true" />
                </div>
              ) : onlyArchived.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-gray-400 gap-2">
                  <FiInbox size={32} aria-hidden="true" />
                  <p className="text-sm">No archived boards.</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {onlyArchived.map((board) => (
                    <li
                      key={board.id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex-shrink-0 w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center">
                          <FiLayout className="text-gray-400" size={16} aria-hidden="true" />
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
                        aria-label={`Restore board ${board.name}`}
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

export default BoardListPage;
