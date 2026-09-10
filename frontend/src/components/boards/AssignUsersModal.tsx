import React, { useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { FiX, FiUserPlus, FiLoader } from 'react-icons/fi';
import { useUsersQuery } from '../../hooks/queries/useUserQueries';
import { useBoardParticipants } from '../../hooks/queries/useBoardMemberQueries';
import { useAssignGroupUsers } from '../../hooks/queries/useGroupQueries';
import type { Column, User } from '../../types';
import { Avatar } from './Avatar';

interface AssignUsersModalProps {
  boardId: string;
  groupId: string;
  groupName: string;
  /** Every PERSON column on the board — the admin picks which one to bulk-set when there's more
   *  than one (Owner, Assignee, ...); skipped straight to the picker when there's only one. */
  personColumns: Column[];
  initialColumnId?: string;
  initialUserIds?: string[];
  onClose: () => void;
}

const AssignUsersModal: React.FC<AssignUsersModalProps> = ({
  boardId, groupId, groupName, personColumns, initialColumnId, initialUserIds, onClose,
}) => {
  const [columnId, setColumnId] = useState(
    () => (initialColumnId && personColumns.some((c) => c.id === initialColumnId) ? initialColumnId : personColumns[0]?.id ?? ''),
  );
  const [selected, setSelected] = useState<string[]>(initialUserIds ?? []);
  const [search, setSearch] = useState('');
  const [boardMembersOnly, setBoardMembersOnly] = useState(true);
  const [error, setError] = useState('');

  const { data: allUsers = [] } = useUsersQuery({ limit: 200 });
  const { data: boardParticipants, isSuccess: participantsLoaded } = useBoardParticipants(boardId, true, true);
  const { mutateAsync: assignGroupUsers, isPending } = useAssignGroupUsers();

  const boardUserIds = useMemo(() => new Set((boardParticipants ?? []).map((p) => p.id)), [boardParticipants]);
  const candidates = boardMembersOnly && participantsLoaded
    ? allUsers.filter((u) => boardUserIds.has(u.id) || selected.includes(u.id))
    : allUsers;
  const filtered = candidates.filter((u) => typeof u.name === 'string' && u.name.toLowerCase().includes(search.toLowerCase()));
  const selectedUsers = allUsers.filter((u) => selected.includes(u.id));

  const toggle = (userId: string) => {
    setSelected((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  };

  const handleSubmit = async () => {
    if (!columnId) {
      setError('Pick a Person column first.');
      return;
    }
    setError('');
    try {
      await assignGroupUsers({ boardId, groupId, columnId, userIds: selected });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign users.');
    }
  };

  const modalRoot = document.getElementById('modal-root');
  if (!modalRoot) return null;

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assign-users-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <FiUserPlus className="text-indigo-600" size={16} aria-hidden="true" />
            <h2 id="assign-users-title" className="text-base font-semibold text-gray-800 truncate max-w-[220px]">
              Assign users — {groupName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
            aria-label="Close"
          >
            <FiX size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto flex-1">
          {personColumns.length > 1 && (
            <div>
              <label htmlFor="assign-users-column" className="block text-xs font-medium text-gray-500 mb-1">
                Person column
              </label>
              <select
                id="assign-users-column"
                value={columnId}
                onChange={(e) => setColumnId(e.target.value)}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {personColumns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          {selectedUsers.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {selectedUsers.map((u) => (
                <span key={u.id} className="flex items-center gap-1 pl-1 pr-2 py-0.5 bg-indigo-50 rounded-full">
                  <Avatar user={u} size="h-5 w-5" textSize="text-[9px]" />
                  <span className="text-xs text-indigo-700">{u.name}</span>
                </span>
              ))}
            </div>
          )}

          <div>
            <input
              type="search"
              value={search}
              placeholder="Search people..."
              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded outline-none focus:border-indigo-400"
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search people"
            />
            {participantsLoaded && (
              <label className="flex items-center gap-1.5 mt-2 text-[11px] text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={boardMembersOnly}
                  onChange={(e) => setBoardMembersOnly(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  aria-label="Show only people with access to this board"
                />
                Only people with board access
              </label>
            )}
          </div>

          <ul className="max-h-52 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50" role="listbox" aria-multiselectable="true">
            {filtered.map((u: User) => {
              const isChecked = selected.includes(u.id);
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isChecked}
                    onClick={() => toggle(u.id)}
                    className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-gray-50 ${isChecked ? 'bg-indigo-50' : ''}`}
                  >
                    <Avatar user={u} size="h-6 w-6" textSize="text-xs" />
                    <span className="truncate flex-1">{u.name}</span>
                    {isChecked && <span className="text-indigo-600 text-xs">✓</span>}
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-xs text-gray-400">
                {boardMembersOnly && participantsLoaded ? 'No users with board access found' : 'No users found'}
              </li>
            )}
          </ul>

          {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 px-5 py-3 border-t border-gray-100 bg-gray-50 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isPending || !columnId}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-60"
          >
            {isPending && <FiLoader className="animate-spin" size={13} aria-hidden="true" />}
            {isPending ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      </div>
    </div>,
    modalRoot,
  );
};

export default AssignUsersModal;
