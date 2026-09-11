import React from 'react';
import ReactDOM from 'react-dom';
import { FiX, FiRotateCcw, FiLoader, FiInbox, FiAlertCircle } from 'react-icons/fi';
import { useArchivedGroups, useGroups, useRestoreGroup } from '../../hooks/queries/useGroupQueries';
import { useItems, useRestoreItem } from '../../hooks/queries/useItemQueries';

interface BoardArchiveModalProps {
  boardId: string;
  onClose: () => void;
}

const BoardArchiveModal: React.FC<BoardArchiveModalProps> = ({ boardId, onClose }) => {
  const { data: archivedGroups = [], isLoading: groupsLoading, isError: groupsErrored, refetch: refetchGroups } = useArchivedGroups(boardId);
  const { data: activeGroups = [] } = useGroups(boardId);

  const { data: archivedItems = [], isLoading: itemsLoading, isError: itemsErrored, refetch: refetchItems } = useItems(
    { boardId, includeArchived: true, limit: 500 },
    !!boardId,
    (page) => page.data.filter((i) => i.isArchived),
  );

  // Build group name lookup from both active and archived groups
  const groupNameById = React.useMemo(() => {
    const map: Record<string, string> = {};
    activeGroups.forEach((g) => { map[g.id] = g.name; });
    archivedGroups.forEach((g) => { map[g.id] = g.name; });
    return map;
  }, [activeGroups, archivedGroups]);

  const { mutateAsync: restoreGroup } = useRestoreGroup();
  const { mutateAsync: restoreItem } = useRestoreItem();

  const [restoringGroupId, setRestoringGroupId] = React.useState<string | null>(null);
  const [restoringItemId, setRestoringItemId] = React.useState<string | null>(null);

  const handleRestoreGroup = async (groupId: string) => {
    setRestoringGroupId(groupId);
    await restoreGroup({ boardId, groupId }).catch(() => {});
    setRestoringGroupId(null);
  };

  const handleRestoreItem = async (itemId: string) => {
    setRestoringItemId(itemId);
    await restoreItem(itemId).catch(() => {});
    setRestoringItemId(null);
  };

  const isLoading = groupsLoading || itemsLoading;
  const isErrored = groupsErrored || itemsErrored;
  const isEmpty = archivedGroups.length === 0 && archivedItems.length === 0;

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Archived items"
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800">Archived</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close archive modal"
          >
            <FiX size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {isLoading ? (
            <div className="flex justify-center py-12" role="status" aria-label="Loading archived items">
              <FiLoader className="animate-spin text-indigo-500" size={24} aria-hidden="true" />
            </div>
          ) : isErrored ? (
            <div className="flex flex-col items-center py-12 text-red-500 gap-3" role="alert">
              <FiAlertCircle size={32} aria-hidden="true" />
              <p className="text-sm text-center">Couldn't load archived items. Please try again.</p>
              <button
                type="button"
                onClick={() => { void refetchGroups(); void refetchItems(); }}
                className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : isEmpty ? (
            <div className="flex flex-col items-center py-12 text-gray-400 gap-2">
              <FiInbox size={32} aria-hidden="true" />
              <p className="text-sm">Nothing archived yet.</p>
            </div>
          ) : (
            <>
              {/* Archived Groups */}
              {archivedGroups.length > 0 && (
                <section aria-label="Archived groups">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Groups
                  </h3>
                  <ul className="space-y-2">
                    {archivedGroups.map((group) => (
                      <li
                        key={group.id}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-3 h-3 rounded-sm flex-shrink-0"
                            style={{ backgroundColor: group.color ?? '#6366f1' }}
                            aria-hidden="true"
                          />
                          <span className="text-sm font-medium text-gray-700 truncate">{group.name}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleRestoreGroup(group.id)}
                          disabled={!!restoringGroupId}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors disabled:opacity-50 flex-shrink-0 ml-3"
                          aria-label={`Restore group ${group.name}`}
                        >
                          {restoringGroupId === group.id ? (
                            <FiLoader className="animate-spin" size={12} aria-hidden="true" />
                          ) : (
                            <FiRotateCcw size={12} aria-hidden="true" />
                          )}
                          Restore
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Archived Items */}
              {archivedItems.length > 0 && (
                <section aria-label="Archived items">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Items
                  </h3>
                  <ul className="space-y-2">
                    {archivedItems.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-700 truncate">{item.name}</p>
                          {groupNameById[item.groupId] && (
                            <p className="text-xs text-gray-400 truncate mt-0.5">
                              {groupNameById[item.groupId]}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleRestoreItem(item.id)}
                          disabled={!!restoringItemId}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors disabled:opacity-50 flex-shrink-0 ml-3"
                          aria-label={`Restore item ${item.name}`}
                        >
                          {restoringItemId === item.id ? (
                            <FiLoader className="animate-spin" size={12} aria-hidden="true" />
                          ) : (
                            <FiRotateCcw size={12} aria-hidden="true" />
                          )}
                          Restore
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.getElementById('modal-root')!,
  );
};

export default BoardArchiveModal;
