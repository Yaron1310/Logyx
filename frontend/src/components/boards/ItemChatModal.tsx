import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FiX, FiSend, FiPaperclip, FiDownload, FiImage, FiFile, FiTrash2, FiAtSign, FiCheck, FiEdit2 } from 'react-icons/fi';
import { useQueryClient } from '@tanstack/react-query';
import { useChatMessages, usePostChatMessage, useUpdateChatMessage, useDeleteChatMessage } from '../../hooks/queries/useItemChatQueries';
import { useBoardParticipants } from '../../hooks/queries/useBoardMemberQueries';
import { useAuthSession } from '../../hooks/useAuthSession';
import { useChatSnapshot } from '../../hooks/useChatSnapshot';
import { markChatSeen } from '../../services/geminiService';
import type { Item, ChatMessage, ChatAttachment } from '../../types';
import type { BoardParticipant } from '../../services/workManagementService';

// Stable colour palette — one colour per unique authorId
const AUTHOR_COLORS = [
  'bg-indigo-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-violet-500',
  'bg-orange-500',
  'bg-teal-500',
];

function authorColor(authorId: string, allIds: string[]): string {
  const idx = allIds.indexOf(authorId);
  return AUTHOR_COLORS[(idx < 0 ? 0 : idx) % AUTHOR_COLORS.length];
}

function formatTime(ts: Date | string): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts: Date | string): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d.getTime())) return '';
  const today = new Date();
  if (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  ) {
    return 'Today';
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function isImage(attachment: ChatAttachment): boolean {
  return attachment.mimeType.startsWith('image/');
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

function renderTextWithLinks(text: string, isMine: boolean): React.ReactNode {
  const parts = text.split(URL_REGEX);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className={isMine ? 'underline opacity-80 hover:opacity-100' : 'text-indigo-600 underline hover:text-indigo-800'}
        aria-label={`Link: ${part}`}
      >
        {part}
      </a>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    ),
  );
}

export function getUnreadCount(userId: string, item: Item): number {
  const total = item.chatMessageCount ?? 0;
  const seen = item.chatSeenBy?.[userId] ?? 0;
  return Math.max(0, total - seen);
}

/** True when the item has at least one chat message but the given user has read all of them —
 *  used to show a neutral "has messages" indicator instead of no badge at all. */
export function hasReadMessages(userId: string, item: Item): boolean {
  const total = item.chatMessageCount ?? 0;
  return total > 0 && getUnreadCount(userId, item) === 0;
}

interface ItemChatModalProps {
  item: Item;
  onClose: () => void;
}

const ItemChatModal: React.FC<ItemChatModalProps> = ({ item, onClose }) => {
  const boardId = item.boardId;
  const { user, selectedWorkspace } = useAuthSession();
  const qc = useQueryClient();
  useChatSnapshot(item.id, selectedWorkspace?.orgId);
  const { data: messages = [], isLoading } = useChatMessages(item.id);
  const { mutateAsync: postMessage, isPending: isSending } = usePostChatMessage(item.id);
  const { mutateAsync: updateMessage, isPending: isUpdating } = useUpdateChatMessage(item.id);
  const { mutate: deleteMessage } = useDeleteChatMessage(item.id);
  const { data: allParticipants = [] } = useBoardParticipants(boardId);

  // Active participants only (backend already filters, but guard here too)
  const participants = allParticipants.filter((p) => p.id !== user?.id);

  const [text, setText] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingMsg, setEditingMsg] = useState<ChatMessage | null>(null);

  // Mention state — multi-select, dropdown stays open
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionedUsers, setMentionedUsers] = useState<BoardParticipant[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionDropdownRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);

  // Derive stable list of unique author IDs for colour mapping
  const authorIds = Array.from(new Set(messages.map((m) => m.authorId)));

  // Participants filtered by current mention query
  const filteredParticipants = participants.filter(
    (p) => mentionQuery === '' || p.name.toLowerCase().includes(mentionQuery.toLowerCase()),
  );

  // Mark messages as seen; invalidate items cache so the badge clears immediately
  useEffect(() => {
    if (!user || !messages.length) return;
    void markChatSeen(item.id).then(() => {
      void qc.invalidateQueries({ queryKey: ['items'] });
    });
  }, [user, item.id, messages.length, qc]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messages.length === 0) return;
    const container = messagesContainerRef.current;
    if (!container) return;
    const frame = requestAnimationFrame(() => {
      if (!initialScrollDone.current) {
        container.scrollTop = container.scrollHeight;
        initialScrollDone.current = true;
      } else {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [messages.length]);

  // Close mention dropdown when clicking outside
  useEffect(() => {
    if (!mentionOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        mentionDropdownRef.current &&
        !mentionDropdownRef.current.contains(e.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        setMentionOpen(false);
        setMentionQuery('');
        // Remove trailing @ from text if nothing was selected yet
        setText((prev) => prev.replace(/@\w*$/, '').replace(/@$/, ''));
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [mentionOpen]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);

    const cursor = e.target.selectionStart ?? val.length;
    const textBefore = val.slice(0, cursor);
    const match = textBefore.match(/@(\w*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setMentionOpen(true);
    } else if (mentionOpen) {
      // user deleted past the @, close dropdown
      setMentionOpen(false);
      setMentionQuery('');
    }
  };

  const toggleMentionUser = useCallback((participant: BoardParticipant) => {
    setMentionedUsers((prev) => {
      const already = prev.some((u) => u.id === participant.id);
      if (already) return prev.filter((u) => u.id !== participant.id);
      return [...prev, participant];
    });
    // Keep the textarea focused so user can continue typing
    textareaRef.current?.focus();
  }, []);

  const closeMentionDropdown = useCallback(() => {
    // Strip the trailing @query from text when closing
    setText((prev) => {
      const match = prev.match(/@\w*$/);
      return match ? prev.slice(0, prev.length - match[0].length).trimEnd() : prev;
    });
    setMentionOpen(false);
    setMentionQuery('');
    textareaRef.current?.focus();
  }, []);

  const removeMentionedUser = (id: string) =>
    setMentionedUsers((prev) => prev.filter((u) => u.id !== id));

  const startEdit = useCallback((msg: ChatMessage) => {
    setEditingMsg(msg);
    setText(msg.text);
    setConfirmDeleteId(null);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingMsg(null);
    setText('');
    textareaRef.current?.focus();
  }, []);

  const handleSend = useCallback(async () => {
    const isSubmitting = isSending || isUpdating;
    if (editingMsg) {
      if (!text.trim() || isSubmitting) return;
      await updateMessage({ id: editingMsg.id, text: text.trim() });
      setEditingMsg(null);
      setText('');
      return;
    }
    if ((!text.trim() && pendingFiles.length === 0) || isSubmitting) return;
    const payload = {
      text: text.trim(),
      files: pendingFiles.length > 0 ? pendingFiles : undefined,
      mentionedUserIds: mentionedUsers.map((u) => u.id),
    };
    setText('');
    setPendingFiles([]);
    setMentionedUsers([]);
    setMentionOpen(false);
    await postMessage(payload);
  }, [text, pendingFiles, isSending, isUpdating, postMessage, updateMessage, mentionedUsers, editingMsg]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && mentionOpen) {
      e.preventDefault();
      closeMentionDropdown();
      return;
    }
    if (e.key === 'Escape' && editingMsg) {
      e.preventDefault();
      cancelEdit();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !mentionOpen) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(e.target.files ?? []);
    setPendingFiles((prev) => [...prev, ...chosen].slice(0, 5));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    setPendingFiles((prev) => [...prev, ...dropped].slice(0, 5));
  };

  const removeFile = (idx: number) =>
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));

  // Group messages by date for date separators
  type MessageGroup = { date: string; messages: ChatMessage[] };
  const groups: MessageGroup[] = [];
  for (const msg of messages) {
    const d = formatDate(msg.createdAt);
    if (!groups.length || groups[groups.length - 1].date !== d) {
      groups.push({ date: d, messages: [msg] });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
  }

  return (
    <div
      className="fixed right-0 top-0 bottom-0 z-[10200] w-full max-w-[45rem] bg-white shadow-2xl flex flex-col"
      role="region"
      aria-label={`Chat for ${item.name}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-indigo-600 text-white flex-shrink-0">
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold truncate">{item.name}</span>
            <span className="text-xs text-indigo-200">{messages.length} message{messages.length !== 1 ? 's' : ''}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-2 flex-shrink-0 p-1.5 rounded-full hover:bg-indigo-500 transition-colors"
            aria-label="Close chat"
          >
            <FiX size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Messages area */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-1 bg-gray-50">
          {isLoading && (
            <div className="text-center text-sm text-gray-400 py-8">Loading messages…</div>
          )}
          {!isLoading && messages.length === 0 && (
            <div className="text-center text-sm text-gray-400 py-8">
              No messages yet. Be the first to say something!
            </div>
          )}
          {groups.map((group) => (
            <div key={group.date}>
              {/* Date separator */}
              <div className="flex items-center gap-2 my-3">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400 font-medium">{group.date}</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>

              {group.messages.map((msg, i) => {
                const isMine = msg.authorId === user?.id;
                const color = authorColor(msg.authorId, authorIds);
                const prevMsg = i > 0 ? group.messages[i - 1] : null;
                const showAvatar = !prevMsg || prevMsg.authorId !== msg.authorId;

                return (
                  <div
                    key={msg.id}
                    className={`flex items-end gap-2 mb-1 group/msg ${isMine ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    {/* Avatar */}
                    <div className={`w-7 h-7 flex-shrink-0 ${showAvatar ? 'visible' : 'invisible'}`}>
                      {msg.authorProfileImageUrl ? (
                        <img
                          src={msg.authorProfileImageUrl}
                          alt={msg.authorName}
                          className="w-7 h-7 rounded-full object-cover"
                        />
                      ) : (
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold ${color}`}
                          aria-label={msg.authorName}
                        >
                          {msg.authorName.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>

                    {/* Bubble */}
                    <div className={`max-w-[75%] min-w-0 ${isMine ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
                      {showAvatar && !isMine && (
                        <span className="text-xs text-gray-500 ml-1">{msg.authorName}</span>
                      )}
                      <div
                        className={`px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${
                          isMine
                            ? 'bg-indigo-600 text-white rounded-br-sm'
                            : 'bg-white text-gray-800 shadow-sm rounded-bl-sm border border-gray-100'
                        }`}
                      >
                        {msg.text && <p>{renderTextWithLinks(msg.text, isMine)}</p>}
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className={`mt-1.5 space-y-1 ${msg.text ? 'pt-1.5 border-t border-white/20' : ''}`}>
                            {msg.attachments.map((att, ai) => (
                              <AttachmentPreview key={ai} attachment={att} isMine={isMine} />
                            ))}
                          </div>
                        )}
                      </div>
                      <span className={`text-[10px] text-gray-400 mx-1 ${isMine ? 'text-right' : 'text-left'}`}>
                        {formatTime(msg.createdAt)}{msg.editedAt && ' · edited'}
                      </span>
                    </div>

                    {/* Edit + Delete — only for own messages, visible on hover */}
                    {isMine && (
                      <div className="flex-shrink-0 flex flex-col gap-0.5 self-center opacity-0 group-hover/msg:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => startEdit(msg)}
                          className="p-1 text-gray-500 hover:text-indigo-600 rounded transition-colors"
                          aria-label="Edit message"
                        >
                          <FiEdit2 size={13} aria-hidden="true" />
                        </button>
                        {confirmDeleteId === msg.id ? (
                          <div className="flex gap-0.5">
                            <button
                              type="button"
                              onClick={() => { deleteMessage(msg.id); setConfirmDeleteId(null); }}
                              className="p-1 text-red-500 hover:text-red-700 rounded transition-colors"
                              aria-label="Confirm delete"
                            >
                              <FiCheck size={13} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="p-1 text-gray-500 hover:text-gray-700 rounded transition-colors"
                              aria-label="Cancel delete"
                            >
                              <FiX size={13} aria-hidden="true" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(msg.id)}
                            className="p-1 text-gray-500 hover:text-red-500 rounded transition-colors"
                            aria-label="Delete message"
                          >
                            <FiTrash2 size={13} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Drag overlay */}
        {dragOver && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-indigo-600/20 border-2 border-dashed border-indigo-500 rounded-2xl pointer-events-none">
            <span className="text-indigo-700 font-semibold text-sm">Drop files to attach</span>
          </div>
        )}

        {/* @mention panel — multi-select, stays open, sits above all input bars */}
        {mentionOpen && (
          <div
            ref={mentionDropdownRef}
            className="flex-shrink-0 bg-white border-t border-gray-200 shadow-inner z-20"
            role="dialog"
            aria-label="Select members to mention"
          >
            <div className="flex items-center justify-between px-3 pt-2 pb-1">
              <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">
                Mention members {mentionedUsers.length > 0 && `(${mentionedUsers.length} selected)`}
              </span>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); closeMentionDropdown(); }}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-1"
                aria-label="Close mention picker"
              >
                Done
              </button>
            </div>

            {/* Search filter */}
            {participants.length > 5 && (
              <div className="px-3 pb-1">
                <input
                  type="text"
                  value={mentionQuery}
                  onChange={(e) => setMentionQuery(e.target.value)}
                  placeholder="Filter members…"
                  className="w-full text-xs px-2 py-1 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  aria-label="Filter members"
                />
              </div>
            )}

            <ul className="max-h-44 overflow-y-auto" role="listbox" aria-multiselectable="true">
              {filteredParticipants.length === 0 ? (
                <li className="px-3 py-3 text-xs text-gray-400 text-center">No members match</li>
              ) : (
                filteredParticipants.map((p) => {
                  const checked = mentionedUsers.some((u) => u.id === p.id);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={checked}
                        onMouseDown={(e) => { e.preventDefault(); toggleMentionUser(p); }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                          checked ? 'bg-indigo-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        {/* Checkbox visual */}
                        <span
                          className={`w-4 h-4 flex-shrink-0 rounded border flex items-center justify-center transition-colors ${
                            checked ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'
                          }`}
                          aria-hidden="true"
                        >
                          {checked && <FiCheck size={10} className="text-white" />}
                        </span>

                        {p.profileImageUrl ? (
                          <img src={p.profileImageUrl} alt={p.name} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0" aria-hidden="true">
                            {p.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className="text-sm text-gray-800 truncate font-medium">{p.name}</span>
                        <span className="text-xs text-gray-400 truncate ml-auto">{p.email}</span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        )}

        {/* Pending file chips */}
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 py-2 border-t border-gray-200 bg-white">
            {pendingFiles.map((f, i) => (
              <span
                key={i}
                className="flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs rounded-full border border-indigo-200"
              >
                {f.type.startsWith('image/') ? <FiImage size={11} aria-hidden="true" /> : <FiFile size={11} aria-hidden="true" />}
                <span className="max-w-[120px] truncate">{f.name}</span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="ml-0.5 text-indigo-400 hover:text-indigo-600"
                  aria-label={`Remove ${f.name}`}
                >
                  <FiX size={10} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Mentioned user chips */}
        {mentionedUsers.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 py-1.5 bg-indigo-50 border-t border-indigo-100">
            <span className="text-[10px] text-indigo-400 self-center font-medium mr-0.5 flex items-center gap-0.5">
              <FiAtSign size={10} aria-hidden="true" /> Notifying:
            </span>
            {mentionedUsers.map((u) => (
              <span
                key={u.id}
                className="flex items-center gap-1 px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded-full border border-indigo-200"
              >
                {u.name}
                <button
                  type="button"
                  onClick={() => removeMentionedUser(u.id)}
                  className="ml-0.5 text-indigo-400 hover:text-indigo-600"
                  aria-label={`Remove mention of ${u.name}`}
                >
                  <FiX size={10} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Edit mode banner */}
        {editingMsg && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 border-t border-indigo-100 flex-shrink-0">
            <FiEdit2 size={12} className="text-indigo-500 flex-shrink-0" aria-hidden="true" />
            <span className="text-xs text-indigo-600 flex-1 truncate">Editing message</span>
            <button
              type="button"
              onClick={cancelEdit}
              className="text-indigo-400 hover:text-indigo-600 transition-colors"
              aria-label="Cancel edit"
            >
              <FiX size={14} aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Input area */}
        <div className="flex items-end gap-2 px-3 py-2.5 border-t border-gray-200 bg-white flex-shrink-0">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex-shrink-0 p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors"
            aria-label="Attach file"
            disabled={pendingFiles.length >= 5}
          >
            <FiPaperclip size={18} aria-hidden="true" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
            className="hidden"
            aria-hidden="true"
            onChange={handleFileChange}
          />
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder="Type a message… (@ to mention, Enter to send)"
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent min-h-[38px] max-h-[100px] overflow-y-auto"
            style={{ lineHeight: '1.4' }}
            aria-label="Message input"
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={isSending || isUpdating || (!text.trim() && pendingFiles.length === 0)}
            className="flex-shrink-0 p-2 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label={editingMsg ? 'Save edit' : 'Send message'}
          >
            <FiSend size={16} aria-hidden="true" />
          </button>
        </div>
    </div>
  );
};

interface AttachmentPreviewProps {
  attachment: ChatAttachment;
  isMine: boolean;
}

const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({ attachment, isMine }) => {
  if (isImage(attachment)) {
    return (
      <a href={attachment.url} target="_blank" rel="noopener noreferrer" aria-label={`View image ${attachment.name}`}>
        <img
          src={attachment.url}
          alt={attachment.name}
          className="max-w-[200px] max-h-[150px] rounded-lg object-cover cursor-pointer hover:opacity-90 transition-opacity"
        />
      </a>
    );
  }

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      download={attachment.name}
      aria-label={`Download ${attachment.name}`}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors ${
        isMine
          ? 'bg-white/20 hover:bg-white/30 text-white'
          : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
      }`}
    >
      <FiFile size={14} aria-hidden="true" className="flex-shrink-0" />
      <div className="flex flex-col min-w-0">
        <span className="font-medium truncate max-w-[140px]">{attachment.name}</span>
        <span className="opacity-70">{humanSize(attachment.size)}</span>
      </div>
      <FiDownload size={12} aria-hidden="true" className="flex-shrink-0 ml-1" />
    </a>
  );
};

export default ItemChatModal;
