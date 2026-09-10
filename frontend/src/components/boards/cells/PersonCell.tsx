import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useUpdateItem } from '../../../hooks/queries/useItemQueries';
import { useUndo } from '../../../contexts/UndoContext';
import { useUsersQuery } from '../../../hooks/queries/useUserQueries';
import { useBoardParticipants } from '../../../hooks/queries/useBoardMemberQueries';
import { useAuthSession } from '../../../hooks/useAuthSession';
import { useBoardRender } from '../../../contexts/BoardRenderContext';
import { UserRole } from '../../../types';
import type { Item, Column, PersonColumnSettings, User } from '../../../types';
import CellWrapper from './CellWrapper';
import { FiUser } from 'react-icons/fi';
import { useFlippedPosition } from '../../../hooks/useFlippedPosition';
import { Avatar, avatarColor } from '../Avatar';

interface Props { item: Item; column: Column }

interface TooltipAnchor { centerX: number; top: number; bottom: number }

const TOOLTIP_W = 220;
const TOOLTIP_H = 152;
const GAP = 0;

const ProfileTooltip: React.FC<{
  user: User;
  anchor: TooltipAnchor;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  canViewPersonalHub: boolean;
  onViewPersonalHub: () => void;
}> = ({ user, anchor, onMouseEnter, onMouseLeave, canViewPersonalHub, onViewPersonalHub }) => {
  const [imgError, setImgError] = useState(false);
  const [copied, setCopied] = useState(false);

  const showAbove = anchor.top > TOOLTIP_H;
  const top = showAbove ? anchor.top : anchor.bottom;
  const left = Math.max(8, Math.min(anchor.centerX - TOOLTIP_W / 2, window.innerWidth - TOOLTIP_W - 8));

  const copyEmail = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(user.email).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      role="tooltip"
      aria-label={`${user.name}'s profile`}
      className="fixed z-[200] bg-white rounded-xl shadow-xl border border-gray-100 p-4 flex flex-col items-center gap-3 pointer-events-auto"
      style={{ top, left, width: TOOLTIP_W, transform: showAbove ? 'translateY(-100%)' : undefined }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {user.profileImageUrl && !imgError ? (
        <img
          className="h-16 w-16 rounded-full object-cover border-4 border-white shadow"
          src={user.profileImageUrl}
          alt={user.name}
          onError={() => setImgError(true)}
        />
      ) : (
        <div
          className={`h-16 w-16 rounded-full flex items-center justify-center text-2xl text-white font-semibold border-4 border-white shadow ${avatarColor(user.id)}`}
          aria-label={user.name}
        >
          {user.name?.[0]?.toUpperCase() ?? '?'}
        </div>
      )}
      <div className="flex flex-col items-center gap-1 text-center w-full">
        <span className="text-gray-900 font-semibold text-sm">{user.name}</span>
        <div className="flex items-center gap-1.5 justify-center">
          <span className="text-gray-500 text-xs truncate max-w-[152px]">{user.email}</span>
          <button
            type="button"
            onClick={copyEmail}
            aria-label={copied ? 'Email copied' : 'Copy email address'}
            className="flex-shrink-0 text-gray-400 hover:text-indigo-600 transition-colors"
          >
            {copied ? (
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-none stroke-green-500 stroke-2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-none stroke-current stroke-2">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            )}
          </button>
        </div>
        {canViewPersonalHub && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onViewPersonalHub(); }}
            className="mt-1 flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
            aria-label={`Go to ${user.name}'s Personal Hub`}
          >
            <FiUser size={12} aria-hidden="true" />
            View Personal Hub
          </button>
        )}
      </div>
    </div>
  );
};

interface PersonPickerMenuProps {
  anchorEl: HTMLElement | null;
  column: Column;
  search: string;
  setSearch: (v: string) => void;
  filtered: User[];
  selected: string[];
  multiple: boolean;
  toggle: (userId: string) => void;
  onClose: () => void;
  /** "Only people with access to this board" filter — hidden when the board's viewer list
   *  isn't available (e.g. it failed to load), since it then has nothing to filter by. */
  boardMembersOnly: boolean;
  setBoardMembersOnly: (v: boolean) => void;
  canFilterByBoardAccess: boolean;
}

const PICKER_W = 224; // w-56

const PersonPickerMenu: React.FC<PersonPickerMenuProps> = ({
  anchorEl, column, search, setSearch, filtered, selected, multiple, toggle, onClose,
  boardMembersOnly, setBoardMembersOnly, canFilterByBoardAccess,
}) => {
  const anchorRect = anchorEl?.getBoundingClientRect() ?? null;
  const { ref: menuRef, style: menuPos } = useFlippedPosition<HTMLDivElement>(anchorRect, PICKER_W);

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} aria-hidden="true" />
      <div
        ref={menuRef}
        style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 9999 }}
        className="bg-white border border-gray-200 rounded shadow-lg w-56"
        role="listbox"
        aria-label={`Select ${column.name}`}
        aria-multiselectable={multiple}
      >
        <div className="p-2 border-b border-gray-100">
          <input
            type="search"
            value={search}
            autoFocus
            placeholder="Search people..."
            className="w-full px-2 py-1 text-sm border border-gray-200 rounded outline-none focus:border-indigo-400"
            onChange={(e) => setSearch(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            aria-label="Search people"
          />
          {canFilterByBoardAccess && (
            <label
              className="flex items-center gap-1.5 mt-2 text-[11px] text-gray-600 cursor-pointer"
              onClick={(e) => e.stopPropagation()}
            >
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
        <ul className="max-h-48 overflow-y-auto py-1">
          {filtered.map((u) => {
            const isChecked = selected.includes(u.id);
            return (
              <li key={u.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isChecked}
                  className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-gray-50 ${isChecked ? 'bg-indigo-50' : ''}`}
                  onClick={(e) => { e.stopPropagation(); toggle(u.id); }}
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
              {boardMembersOnly && canFilterByBoardAccess ? 'No users with board access found' : 'No users found'}
            </li>
          )}
        </ul>
      </div>
    </>,
    document.body,
  );
};

const PersonCellInner: React.FC<Props> = ({ item, column }) => {
  const selected = (item.values[column.id] ?? []) as string[];
  const settings = column.settings as PersonColumnSettings;
  const multiple = settings?.multiple ?? true;
  const { mutate } = useUpdateItem();
  const { push: pushUndo } = useUndo();
  const [search, setSearch] = useState('');
  const [hoveredUser, setHoveredUser] = useState<User | null>(null);
  const [tooltipAnchor, setTooltipAnchor] = useState<TooltipAnchor | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { isBoardReadOnly } = useBoardRender();
  const { data: allUsers = [] } = useUsersQuery({ limit: 200 }, !isBoardReadOnly);
  const { user: authUser } = useAuthSession();
  const [boardMembersOnly, setBoardMembersOnly] = useState(true);
  const boardId = column.boardId || item.boardId;
  // Everyone who can see this board: explicit board members, workspace members,
  // org editors and admins. Used to keep the picker to people who could actually
  // act on what they're assigned to.
  const { data: boardParticipants, isSuccess: participantsLoaded } = useBoardParticipants(
    boardId ?? '',
    !isBoardReadOnly && !!boardId,
    true,
  );
  const navigate = useNavigate();
  const isOrgAdmin = authUser?.role === UserRole.ORGANIZATION_ADMIN || authUser?.role === UserRole.SYSTEM_ADMIN;

  const goToPersonalHub = (targetUserId: string) => {
    if (authUser?.id === targetUserId) {
      navigate('/personal-hub');
    } else {
      navigate(`/admin/users/${targetUserId}/personal-hub`);
    }
  };

  const selectedUsers = allUsers.filter((u) => selected.includes(u.id));

  const boardUserIds = useMemo(
    () => new Set((boardParticipants ?? []).map((p) => p.id)),
    [boardParticipants],
  );
  // Already-assigned people always stay listed, even without board access — otherwise
  // they couldn't be unassigned from here.
  const candidates = boardMembersOnly && participantsLoaded
    ? allUsers.filter((u) => boardUserIds.has(u.id) || selected.includes(u.id))
    : allUsers;
  const filtered = candidates.filter((u) => typeof u.name === 'string' && u.name.toLowerCase().includes(search.toLowerCase()));

  const toggle = (userId: string, stopEdit: () => void) => {
    const prev = selected;
    let next: string[];
    if (selected.includes(userId)) {
      next = selected.filter((id) => id !== userId);
    } else {
      next = multiple ? [...selected, userId] : [userId];
    }
    pushUndo({ label: `Changed "${column.name}" on "${item.name}"`, undo: () => mutate({ id: item.id, patch: { values: { [column.id]: prev } } }) });
    mutate({ id: item.id, patch: { values: { [column.id]: next } } });
    if (!multiple) stopEdit();
  };

  const openTooltip = (user: User, e: React.MouseEvent<HTMLElement>) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltipAnchor({ centerX: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom });
    setHoveredUser(user);
  };

  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => {
      setHoveredUser(null);
      setTooltipAnchor(null);
    }, 150);
  };

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };

  const anchorRef = useRef<HTMLDivElement>(null);

  return (
    <>
      {hoveredUser && tooltipAnchor && (
        <ProfileTooltip
          user={hoveredUser}
          anchor={tooltipAnchor}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          canViewPersonalHub={authUser?.id === hoveredUser.id || isOrgAdmin}
          onViewPersonalHub={() => goToPersonalHub(hoveredUser.id)}
        />
      )}
      <CellWrapper column={column}>
        {(isEditing, stopEdit) => (
          <>
            <div ref={anchorRef} className="px-2 py-[2px] w-full flex items-center justify-center">
              {selectedUsers.length > 0 ? (
                <div className="flex items-center -space-x-1.5">
                  {selectedUsers.slice(0, 3).map((u) => (
                    <div
                      key={u.id}
                      role="img"
                      aria-label={u.name}
                      className="cursor-default"
                      onMouseEnter={(e) => openTooltip(u, e)}
                      onMouseLeave={scheduleClose}
                    >
                      <Avatar user={u} />
                    </div>
                  ))}
                  {selectedUsers.length > 3 && (
                    <div className="h-9 w-9 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-600 border-2 border-gray-300 flex-shrink-0">
                      +{selectedUsers.length - 3}
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-gray-300 text-xs">—</span>
              )}
            </div>

            {isEditing && (
              <PersonPickerMenu
                anchorEl={anchorRef.current}
                column={column}
                search={search}
                setSearch={setSearch}
                filtered={filtered}
                selected={selected}
                multiple={multiple}
                toggle={(userId) => toggle(userId, stopEdit)}
                onClose={stopEdit}
                boardMembersOnly={boardMembersOnly}
                setBoardMembersOnly={setBoardMembersOnly}
                canFilterByBoardAccess={participantsLoaded}
              />
            )}
          </>
        )}
      </CellWrapper>
    </>
  );
};

const PersonCell = React.memo(PersonCellInner);
export default PersonCell;
