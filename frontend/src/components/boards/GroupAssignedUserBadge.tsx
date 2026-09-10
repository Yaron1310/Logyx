import React, { useEffect, useRef, useState } from 'react';
import { useUnassignGroupUser } from '../../hooks/queries/useGroupQueries';
import type { Column, User } from '../../types';
import { Avatar } from './Avatar';

interface Props {
  user: User;
  boardId: string;
  groupId: string;
  /** Every PERSON column this user is currently recorded under in the group's bulk-assign
   *  record — hovering offers to remove them from any subset of just these, not every Person
   *  column on the board. */
  columnsForUser: Column[];
}

/** One avatar in the group title row's bulk-assignment badge. Hovering it reveals a small
 *  "Remove" control — a checklist of the columns this user is assigned via when there's more
 *  than one, otherwise a single confirm button. */
const GroupAssignedUserBadge: React.FC<Props> = ({ user, boardId, groupId, columnsForUser }) => {
  const [open, setOpen] = useState(false);
  const [selectedColumnIds, setSelectedColumnIds] = useState<string[]>(() => columnsForUser.map((c) => c.id));
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { mutateAsync: unassignGroupUser, isPending } = useUnassignGroupUser();

  // Keep the checklist in sync if the underlying assignment changes while closed.
  useEffect(() => {
    if (!open) setSelectedColumnIds(columnsForUser.map((c) => c.id));
  }, [columnsForUser, open]);

  const scheduleClose = () => { closeTimer.current = setTimeout(() => setOpen(false), 150); };
  const cancelClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current); };

  const toggleColumn = (columnId: string) => {
    setSelectedColumnIds((prev) => (prev.includes(columnId) ? prev.filter((id) => id !== columnId) : [...prev, columnId]));
  };

  const handleRemove = async () => {
    if (selectedColumnIds.length === 0) return;
    await unassignGroupUser({ boardId, groupId, userId: user.id, columnIds: selectedColumnIds });
    setOpen(false);
  };

  return (
    <div
      className="relative"
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}
    >
      <Avatar user={user} size="h-6 w-6" textSize="text-[10px]" />
      {open && (
        <div
          className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-30 bg-white border border-gray-200 rounded-lg shadow-lg p-2 w-48"
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          role="dialog"
          aria-label={`Remove ${user.name} from this group's assignment`}
        >
          <p className="text-xs font-medium text-gray-700 mb-1.5 truncate">{user.name}</p>
          {columnsForUser.length > 1 && (
            <div className="space-y-1 mb-2">
              {columnsForUser.map((c) => (
                <label key={c.id} className="flex items-center gap-1.5 text-[11px] text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedColumnIds.includes(c.id)}
                    onChange={() => toggleColumn(c.id)}
                    className="w-3 h-3 rounded border-gray-300 text-red-600 focus:ring-red-500"
                    aria-label={`Remove from ${c.name}`}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => void handleRemove()}
            disabled={isPending || selectedColumnIds.length === 0}
            className="w-full text-xs text-red-600 hover:bg-red-50 rounded px-2 py-1 transition-colors disabled:opacity-50"
            aria-label={`Remove ${user.name} from ${columnsForUser.length > 1 ? 'selected columns' : columnsForUser[0]?.name ?? 'this group'}`}
          >
            {isPending ? 'Removing…' : columnsForUser.length > 1 ? 'Remove from selected' : 'Remove'}
          </button>
        </div>
      )}
    </div>
  );
};

export default GroupAssignedUserBadge;
