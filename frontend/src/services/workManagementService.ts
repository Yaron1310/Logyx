import type { Board, Group, Item, Column, ColumnType, ColumnSettings, ColumnVisibility, PaginatedResponse, DashboardParams, DashboardSummary, TimeRangeDependency, BoardMember, BoardRole, ChatMessage, Webhook, WebhookNameMode, CustomDashboard, CustomDashboardDataPoint, Form, FormField, FormAnswerValue, ItemFormEntry, FormResults, FileAttachment } from '../types';
import { fetchWithAuth } from './authFetch';

// ─── BOARDS ──────────────────────────────────────────────────────────────────

export interface CreateBoardData {
  name: string;
  description?: string;
  workspaceId?: string;
  order?: number;
  isTemplate?: boolean;
  templateId?: string;
  templateMode?: DuplicateMode;
}

export interface UpdateBoardData {
  name?: string;
  description?: string;
  order?: number;
  workspaceId?: string;
}

export const createBoard = (data: CreateBoardData): Promise<Board> =>
  fetchWithAuth('/api/boards', { method: 'POST', body: JSON.stringify(data) });

export const listBoards = (workspaceId?: string, includeArchived = false): Promise<Board[]> => {
  const params = new URLSearchParams();
  if (workspaceId) params.set('workspaceId', workspaceId);
  if (includeArchived) params.set('includeArchived', 'true');
  const qs = params.toString();
  return fetchWithAuth(`/api/boards${qs ? `?${qs}` : ''}`);
};

export const getBoard = (id: string): Promise<Board> =>
  fetchWithAuth(`/api/boards/${id}`);

export const updateBoard = (id: string, patch: UpdateBoardData): Promise<Board> =>
  fetchWithAuth(`/api/boards/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const archiveBoard = (id: string): Promise<void> =>
  fetchWithAuth(`/api/boards/${id}/archive`, { method: 'PATCH' });

export const restoreBoard = (id: string): Promise<Board> =>
  fetchWithAuth(`/api/boards/${id}/restore`, { method: 'PATCH' });

export const deleteBoard = (id: string): Promise<null> =>
  fetchWithAuth(`/api/boards/${id}`, { method: 'DELETE' });

export type DuplicateMode = 'columns_only' | 'columns_groups' | 'columns_groups_items' | 'full';

export const duplicateBoard = (id: string, mode: DuplicateMode = 'full'): Promise<Board> =>
  fetchWithAuth(`/api/boards/${id}/duplicate`, { method: 'POST', body: JSON.stringify({ mode }) });

export const saveAsBoardTemplate = (id: string, name?: string, mode: DuplicateMode = 'full'): Promise<Board> =>
  fetchWithAuth(`/api/boards/${id}/save-as-template`, { method: 'POST', body: JSON.stringify({ name, mode }) });

export const listTemplates = (): Promise<Board[]> =>
  fetchWithAuth('/api/boards?isTemplate=true');

export const listArchivedTemplates = (): Promise<Board[]> =>
  fetchWithAuth('/api/boards?isTemplate=true&includeArchived=true');

export const getBoardVersion = (id: string): Promise<{ lastUpdatedAt: string | null }> =>
  fetchWithAuth(`/api/boards/${id}/version`);

export interface ReorderBoardItem {
  id: string;
  order: number;
}

export const reorderBoards = (workspaceId: string, order: ReorderBoardItem[]): Promise<void> =>
  fetchWithAuth('/api/boards/reorder', { method: 'PATCH', body: JSON.stringify({ workspaceId, order }) });

// ─── GROUPS ──────────────────────────────────────────────────────────────────

export interface CreateGroupData {
  name: string;
  color?: string;
  order?: number;
  parentItemId?: string;
}

export interface UpdateGroupData {
  name?: string;
  color?: string;
  isCollapsed?: boolean;
  order?: number;
  summaryCumulative?: Record<string, boolean>;
}

export interface ReorderGroupItem {
  id: string;
  order: number;
}

export const listGroups = (boardId: string, includeArchived = false, parentItemId?: string): Promise<Group[]> => {
  const params = new URLSearchParams();
  if (includeArchived) params.set('includeArchived', 'true');
  if (parentItemId) params.set('parentItemId', parentItemId);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchWithAuth(`/api/boards/${boardId}/groups${qs}`);
};

export const getGroup = (boardId: string, groupId: string): Promise<Group> =>
  fetchWithAuth(`/api/boards/${boardId}/groups/${groupId}`);

export const createGroup = (boardId: string, data: CreateGroupData): Promise<Group> =>
  fetchWithAuth(`/api/boards/${boardId}/groups`, { method: 'POST', body: JSON.stringify(data) });

export const updateGroup = (boardId: string, groupId: string, patch: UpdateGroupData): Promise<Group> =>
  fetchWithAuth(`/api/boards/${boardId}/groups/${groupId}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteGroup = (boardId: string, groupId: string): Promise<null> =>
  fetchWithAuth(`/api/boards/${boardId}/groups/${groupId}`, { method: 'DELETE' });

export const archiveGroup = (boardId: string, groupId: string): Promise<void> =>
  fetchWithAuth(`/api/boards/${boardId}/groups/${groupId}/archive`, { method: 'PATCH' });

export const restoreGroup = (boardId: string, groupId: string): Promise<Group> =>
  fetchWithAuth(`/api/boards/${boardId}/groups/${groupId}/restore`, { method: 'PATCH' });

export type DuplicateGroupMode = 'with_data' | 'without_data' | 'empty';

export const duplicateGroup = (boardId: string, groupId: string, mode: DuplicateGroupMode): Promise<Group> =>
  fetchWithAuth(`/api/boards/${boardId}/groups/${groupId}/duplicate`, {
    method: 'POST',
    body: JSON.stringify({ mode }),
  });

export const reorderGroups = (boardId: string, order: ReorderGroupItem[]): Promise<void> =>
  fetchWithAuth(`/api/boards/${boardId}/groups/reorder`, { method: 'PATCH', body: JSON.stringify({ order }) });

// Bulk-sets a PERSON column to the same users on every item in the group at once — the group
// context menu's "Assign users" action — instead of doing it item by item.
export const assignGroupUsers = (
  boardId: string,
  groupId: string,
  columnId: string,
  userIds: string[],
): Promise<{ group: Group; itemCount: number }> =>
  fetchWithAuth(`/api/boards/${boardId}/groups/${groupId}/assign-users`, {
    method: 'POST',
    body: JSON.stringify({ columnId, userIds }),
  });

// ─── ITEMS ────────────────────────────────────────────────────────────────────

export interface CreateItemData {
  name: string;
  workspaceId: string;
  boardId: string;
  groupId: string;
  order?: number;
  values?: Record<string, unknown>;
  assignees?: string[];
  status?: string;
  dueDate?: string;
}

export interface UpdateItemData {
  name?: string;
  groupId?: string;
  order?: number;
  values?: Record<string, unknown>;
  assignees?: string[];
  status?: string;
  dueDate?: string;
  dependencies?: TimeRangeDependency[];
}

export interface ListItemsParams {
  boardId?: string;
  groupId?: string;
  workspaceId?: string;
  assignee?: string;
  status?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
  includeArchived?: boolean;
  cursor?: string;
  limit?: number;
}

export interface ReorderItemUpdate {
  id: string;
  groupId: string;
  order: number;
}

export const createItem = (data: CreateItemData): Promise<Item> =>
  fetchWithAuth('/api/items', { method: 'POST', body: JSON.stringify(data) });

export const listItems = (params: ListItemsParams = {}): Promise<PaginatedResponse<Item>> => {
  const p = new URLSearchParams();
  if (params.boardId) p.set('boardId', params.boardId);
  if (params.groupId) p.set('groupId', params.groupId);
  if (params.workspaceId) p.set('workspaceId', params.workspaceId);
  if (params.assignee) p.set('assignee', params.assignee);
  if (params.status) p.set('status', params.status);
  if (params.dueDateFrom) p.set('dueDateFrom', params.dueDateFrom);
  if (params.dueDateTo) p.set('dueDateTo', params.dueDateTo);
  if (params.includeArchived) p.set('includeArchived', 'true');
  if (params.cursor) p.set('cursor', params.cursor);
  if (params.limit) p.set('limit', String(params.limit));
  const qs = p.toString();
  return fetchWithAuth(`/api/items${qs ? `?${qs}` : ''}`);
};

export const getItem = (id: string): Promise<Item> =>
  fetchWithAuth(`/api/items/${id}`);

export const updateItem = (id: string, patch: UpdateItemData): Promise<Item> =>
  fetchWithAuth(`/api/items/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const reorderItems = (updates: ReorderItemUpdate[]): Promise<void> =>
  fetchWithAuth('/api/items/reorder', { method: 'PATCH', body: JSON.stringify({ updates }) });

// Uploads one file for a FILES column. Same raw-binary + header convention as the item chat's
// file upload (see uploadFileToBackend below) — X-Column-Id additionally tells the backend which
// FILES column this belongs to. Returns the full attachment (including uploader identity/time);
// the caller appends it to the column's current array and PATCHes the item as usual.
export const uploadItemFile = (itemId: string, columnId: string, file: File): Promise<FileAttachment> =>
  fetchWithAuth(`/api/items/${itemId}/files`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type,
      'X-Filename': encodeURIComponent(file.name),
      'X-Column-Id': columnId,
    },
    body: file,
  }) as Promise<FileAttachment>;

export const archiveItem = (id: string): Promise<void> =>
  fetchWithAuth(`/api/items/${id}/archive`, { method: 'PATCH' });

export const restoreItem = (id: string): Promise<Item> =>
  fetchWithAuth(`/api/items/${id}/restore`, { method: 'PATCH' });

export const deleteItem = (id: string): Promise<null> =>
  fetchWithAuth(`/api/items/${id}`, { method: 'DELETE' });

// ─── COLUMNS ─────────────────────────────────────────────────────────────────

export interface CreateColumnData {
  name: string;
  type: ColumnType;
  settings?: ColumnSettings;
  parentGroupId?: string;
  width?: number;
  visibility?: ColumnVisibility;
}

export interface UpdateColumnData {
  name?: string;
  settings?: ColumnSettings;
  summaryConfig?: { calc: string; unit: string; unitAlign: 'left' | 'right' } | null;
  boardSummaryConfig?: { calc: string; unit: string; unitAlign: 'left' | 'right' } | null;
  width?: number;
  visibility?: ColumnVisibility;
}

export interface ReorderColumnItem {
  id: string;
  order: number;
}

export const listColumns = (boardId: string, parentGroupId?: string): Promise<Column[]> => {
  const qs = parentGroupId ? `?parentGroupId=${encodeURIComponent(parentGroupId)}` : '';
  return fetchWithAuth(`/api/boards/${boardId}/columns${qs}`);
};

export const getColumn = (boardId: string, id: string): Promise<Column> =>
  fetchWithAuth(`/api/boards/${boardId}/columns/${id}`);

export const createColumn = (boardId: string, data: CreateColumnData): Promise<Column> =>
  fetchWithAuth(`/api/boards/${boardId}/columns`, {
    method: 'POST',
    // clientRequestId lets the backend distinguish a genuine retry of this exact
    // request from a legitimate second column sharing the same name/type (e.g.
    // several "Status" columns created back-to-back during an xlsx import).
    body: JSON.stringify({ ...data, clientRequestId: crypto.randomUUID() }),
  });

export const updateColumn = (boardId: string, id: string, patch: UpdateColumnData): Promise<Column> =>
  fetchWithAuth(`/api/boards/${boardId}/columns/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const reorderColumns = (boardId: string, order: ReorderColumnItem[]): Promise<void> =>
  fetchWithAuth(`/api/boards/${boardId}/columns/reorder`, { method: 'PATCH', body: JSON.stringify({ order }) });

export const deleteColumn = (boardId: string, id: string): Promise<null> =>
  fetchWithAuth(`/api/boards/${boardId}/columns/${id}`, { method: 'DELETE' });

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

export interface DashboardPaginationParams {
  cursor?: string;
  limit?: number;
}

const buildDashboardQs = (params: DashboardParams): string => {
  const p = new URLSearchParams();
  if (params.workspaceId) p.set('workspaceId', params.workspaceId);
  if (params.boardIds?.length) p.set('boardIds', params.boardIds.join(','));
  if (params.assigneeId) p.set('assigneeId', params.assigneeId);
  if (params.dueDateFrom) p.set('dueDateFrom', params.dueDateFrom);
  if (params.dueDateTo) p.set('dueDateTo', params.dueDateTo);
  return p.toString();
};

export const getDashboardSummary = (params: DashboardParams = {}): Promise<DashboardSummary> => {
  const qs = buildDashboardQs(params);
  return fetchWithAuth(`/api/dashboard/summary${qs ? `?${qs}` : ''}`);
};

export const getDashboardOverdue = (
  params: DashboardParams & DashboardPaginationParams = {},
): Promise<PaginatedResponse<Item>> => {
  const p = new URLSearchParams(buildDashboardQs(params));
  if (params.cursor) p.set('cursor', params.cursor);
  if (params.limit) p.set('limit', String(params.limit));
  const qs = p.toString();
  return fetchWithAuth(`/api/dashboard/overdue${qs ? `?${qs}` : ''}`);
};

// ─── BOARD MEMBERS ───────────────────────────────────────────────────────────

export interface BoardParticipant {
  id: string;
  name: string;
  email: string;
  profileImageUrl?: string;
  role?: string;
}

export const getBoardMembers = (boardId: string): Promise<BoardMember[]> =>
  fetchWithAuth(`/api/boards/${boardId}/members`);

/** Board members + workspace/org admins. With `includeWorkspaceMembers` the result widens to
 *  everyone who can see the board, including plain members of the board's workspace. */
export const getBoardParticipants = (boardId: string, includeWorkspaceMembers = false): Promise<BoardParticipant[]> =>
  fetchWithAuth(`/api/boards/${boardId}/participants${includeWorkspaceMembers ? '?includeWorkspaceMembers=true' : ''}`);

export const addBoardMember = (boardId: string, userId: string, role: BoardRole): Promise<BoardMember> =>
  fetchWithAuth(`/api/boards/${boardId}/members`, { method: 'POST', body: JSON.stringify({ userId, role }) });

export const removeBoardMember = (boardId: string, userId: string): Promise<null> =>
  fetchWithAuth(`/api/boards/${boardId}/members/${userId}`, { method: 'DELETE' });

// ─── BOARD VIEW INVITES (public read-only share links) ──────────────────────

export interface BoardViewInvite {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export const getBoardViewInvites = (boardId: string): Promise<BoardViewInvite[]> =>
  fetchWithAuth(`/api/boards/${boardId}/view-invites`);

export const createBoardViewInvite = (boardId: string, email: string, expirationDays: number): Promise<{ message: string }> =>
  fetchWithAuth(`/api/boards/${boardId}/view-invites`, { method: 'POST', body: JSON.stringify({ email, expirationDays }) });

export const revokeBoardViewInvite = (boardId: string, inviteId: string): Promise<{ message: string }> =>
  fetchWithAuth(`/api/boards/${boardId}/view-invites/${inviteId}`, { method: 'DELETE' });

// ─── ITEM CHAT ────────────────────────────────────────────────────────────────

export const listChatMessages = (itemId: string): Promise<ChatMessage[]> =>
  fetchWithAuth(`/api/items/${itemId}/chat`);

async function uploadFileToBackend(
  itemId: string,
  file: File,
): Promise<{ url: string; name: string; mimeType: string; size: number }> {
  return fetchWithAuth(`/api/items/${itemId}/chat/file`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type,
      'X-Filename': encodeURIComponent(file.name),
    },
    body: file,
  }) as Promise<{ url: string; name: string; mimeType: string; size: number }>;
}

export const postChatMessage = async (
  itemId: string,
  text: string,
  files?: File[],
  mentionedUserIds?: string[],
): Promise<ChatMessage> => {
  const attachments =
    files && files.length > 0
      ? await Promise.all(files.map((f) => uploadFileToBackend(itemId, f)))
      : [];

  return fetchWithAuth(`/api/items/${itemId}/chat`, {
    method: 'POST',
    body: JSON.stringify({ text, attachments, mentionedUserIds: mentionedUserIds ?? [] }),
  });
};

export const updateChatMessage = (itemId: string, messageId: string, text: string): Promise<ChatMessage> =>
  fetchWithAuth(`/api/items/${itemId}/chat/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ text }),
  });

export const deleteChatMessage = (itemId: string, messageId: string): Promise<void> =>
  fetchWithAuth(`/api/items/${itemId}/chat/${messageId}`, { method: 'DELETE' });


// ─── WEBHOOKS ─────────────────────────────────────────────────────────────────

export interface WebhookFieldMappingInput {
  position: number;
  columnId: string;
}

export interface CreateWebhookData {
  insertPosition: 'top' | 'bottom';
  allowedOrigins: string[];
  fieldMap?: WebhookFieldMappingInput[];
  nameMode?: WebhookNameMode;
  nameFieldPosition?: number | null;
}

export interface UpdateWebhookData {
  fieldMap: WebhookFieldMappingInput[];
  nameMode: WebhookNameMode;
  nameFieldPosition: number | null;
  allowedOrigins?: string[];
}

export const getGroupWebhook = async (boardId: string, groupId: string): Promise<Webhook | null> => {
  try {
    return await fetchWithAuth(`/api/boards/${boardId}/groups/${groupId}/webhook`);
  } catch (err: unknown) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
};

export const createGroupWebhook = (
  boardId: string,
  groupId: string,
  data: CreateWebhookData,
): Promise<Webhook> =>
  fetchWithAuth(`/api/boards/${boardId}/groups/${groupId}/webhook`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateGroupWebhook = (
  boardId: string,
  groupId: string,
  data: UpdateWebhookData,
): Promise<Webhook> =>
  fetchWithAuth(`/api/boards/${boardId}/groups/${groupId}/webhook`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const revokeGroupWebhook = (boardId: string, groupId: string): Promise<void> =>
  fetchWithAuth(`/api/boards/${boardId}/groups/${groupId}/webhook`, { method: 'DELETE' });

// ─── CUSTOM DASHBOARDS ────────────────────────────────────────────────────────

export interface CreateCustomDashboardData {
  name: string;
  chartType: CustomDashboard['chartType'];
  config: CustomDashboard['config'];
  visibility: CustomDashboard['visibility'];
  /** When set, creates a personal dashboard owned by that user (Personal Hub). */
  ownerUserId?: string;
}

export interface UpdateCustomDashboardData {
  name?: string;
  chartType?: CustomDashboard['chartType'];
  config?: CustomDashboard['config'];
  visibility?: CustomDashboard['visibility'];
}

export const listCustomDashboards = (includeArchived = false, ownerUserId?: string): Promise<CustomDashboard[]> => {
  const params = new URLSearchParams();
  if (includeArchived) params.set('includeArchived', 'true');
  if (ownerUserId) params.set('ownerUserId', ownerUserId);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return fetchWithAuth(`/api/custom-dashboards${qs}`);
};

export const createCustomDashboard = (data: CreateCustomDashboardData): Promise<CustomDashboard> =>
  fetchWithAuth('/api/custom-dashboards', { method: 'POST', body: JSON.stringify(data) });

export const updateCustomDashboard = (id: string, patch: UpdateCustomDashboardData): Promise<CustomDashboard> =>
  fetchWithAuth(`/api/custom-dashboards/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

export const deleteCustomDashboard = (id: string): Promise<null> =>
  fetchWithAuth(`/api/custom-dashboards/${id}`, { method: 'DELETE' });

export const archiveCustomDashboard = (id: string): Promise<null> =>
  fetchWithAuth(`/api/custom-dashboards/${id}/archive`, { method: 'PATCH' });

export const restoreCustomDashboard = (id: string): Promise<CustomDashboard> =>
  fetchWithAuth(`/api/custom-dashboards/${id}/restore`, { method: 'PATCH' });

export const getCustomDashboardData = (
  id: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<CustomDashboardDataPoint[]> => {
  const p = new URLSearchParams();
  if (dateFrom) p.set('dateFrom', dateFrom);
  if (dateTo) p.set('dateTo', dateTo);
  const qs = p.toString();
  return fetchWithAuth(`/api/custom-dashboards/${id}/data${qs ? `?${qs}` : ''}`);
};

// ─── FORMS ────────────────────────────────────────────────────────────────────

export interface CreateFormData {
  name: string;
  description?: string;
  fields: FormField[];
}

export interface UpdateFormData {
  name?: string;
  description?: string;
  fields?: FormField[];
}

export const listForms = (includeArchived = false): Promise<Form[]> =>
  fetchWithAuth(`/api/forms${includeArchived ? '?includeArchived=true' : ''}`);

export const getForm = (id: string): Promise<Form> =>
  fetchWithAuth(`/api/forms/${id}`);

export const createForm = (data: CreateFormData): Promise<Form> =>
  fetchWithAuth('/api/forms', { method: 'POST', body: JSON.stringify(data) });

export const updateForm = (id: string, patch: UpdateFormData): Promise<Form> =>
  fetchWithAuth(`/api/forms/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });

/**
 * `confirm: true` must be passed once the caller has shown the attached-items
 * warning and the user chose to proceed — otherwise, if the form is currently
 * attached to any item, the backend responds 409 with `attachedItems` instead
 * of archiving.
 */
export const archiveForm = (id: string, confirm = false): Promise<null> =>
  fetchWithAuth(`/api/forms/${id}/archive`, { method: 'PATCH', body: JSON.stringify({ confirm }) });

export const restoreForm = (id: string): Promise<Form> =>
  fetchWithAuth(`/api/forms/${id}/restore`, { method: 'PATCH' });

export const deleteForm = (id: string): Promise<null> =>
  fetchWithAuth(`/api/forms/${id}`, { method: 'DELETE' });

/** Every answer set collected for a form, across all items. Admin-only. */
export const getFormResults = (id: string): Promise<FormResults> =>
  fetchWithAuth(`/api/forms/${id}/responses`);

// --- Forms attached to an item ---

export const listItemForms = (itemId: string): Promise<ItemFormEntry[]> =>
  fetchWithAuth(`/api/items/${itemId}/forms`);

export const attachFormToItem = (itemId: string, formId: string): Promise<ItemFormEntry> =>
  fetchWithAuth(`/api/items/${itemId}/forms`, { method: 'POST', body: JSON.stringify({ formId }) });

export const saveItemFormResponse = (
  itemId: string,
  formId: string,
  values: Record<string, FormAnswerValue>,
  submit = false,
): Promise<ItemFormEntry> =>
  fetchWithAuth(`/api/items/${itemId}/forms/${formId}`, {
    method: 'PATCH',
    body: JSON.stringify({ values, submit }),
  });

export const detachFormFromItem = (itemId: string, formId: string): Promise<null> =>
  fetchWithAuth(`/api/items/${itemId}/forms/${formId}`, { method: 'DELETE' });
