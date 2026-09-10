
import admin from 'firebase-admin';

// --- HIERARCHY & TENANCY ---

export interface DBOrganization {
  id: string;
  name: string;
  createdAt: admin.firestore.Timestamp | Date | any;
}

export interface DBWorkspace {
  id: string;
  name: string;
  orgId: string;
  color?: string;
  createdAt: admin.firestore.Timestamp | Date | any;
  updatedAt?: admin.firestore.Timestamp | Date | any;
  isPersonal?: boolean;
  isTemplates?: boolean;
  status?: 'active' | 'archived';
}

export interface DBOrganizationSettings {
  id: string;
  sidebarColor: string;
  enableSidebarGradient?: boolean;
  sidebarHueRotation?: number;
  sidebarGradientHeight?: number;
  sidebarGradientMaskOpacity?: number;
  appName: string;
  logoUrl: string;
  description?: string;
  contactEmail?: string;
  contactPhone?: string;
  website?: string;
  socialMedia?: {
    twitter?: string;
    linkedin?: string;
    facebook?: string;
    instagram?: string;
  };
  apiKey?: string;
  updatedAt: admin.firestore.Timestamp | Date | any;
  displayNameColor?: string;
  sidebarLinkColor?: string;
  logoCircle?: boolean;
  personalHubTemplate?: PersonalHubTemplate;
}

// --- Personal Hub default template — org-admin-configured "all groups" columns that get
// copied into a user's own personalColumns the first time they have none. Never rendered
// with groups/items/data itself — it's a column-schema list only. ---
export interface PersonalHubTemplateColumn {
  id: string;
  name: string;
  type: ColumnType;
  settings: ColumnSettings;
  order: number;
}

export interface PersonalHubTemplate {
  columns: PersonalHubTemplateColumn[];
  updatedAt: admin.firestore.Timestamp | Date | any;
}

// Org-wide running total for one Personal Hub template NUMBER column, summed live across every
// user's materialized copy of it. Updated by delta whenever a user edits their value (see
// updatePersonalItemValue) — never recomputed from scratch, so it stays cheap at any org size.
// `frozen: true` once the admin removes the column from the template: the total stops moving and
// holds at its last value instead of erroring out or silently resuming.
export interface DBPersonalHubTemplateTotal {
  id: string; // == templateColumnId
  templateColumnId: string;
  total: number;
  frozen: boolean;
  updatedAt: admin.firestore.Timestamp | Date | any;
}

export interface DBSystemSettings {
  id?: string;
}

export interface DBTutorialSettings {
  id?: string;
}

export enum UserRole {
  REGULAR_USER = 'regular_user',
  ORG_EDITOR = 'org_editor',
  WORKSPACE_ADMIN = 'workspace_admin',
  ORGANIZATION_ADMIN = 'org_admin',
  SYSTEM_ADMIN = 'system_admin',
}

export interface DBUser {
  id: string;
  email: string;
  name: string;
  passwordHash?: string;
  profileImageUrl?: string;
  googleId?: string;
  microsoftId?: string;
  status: 'pending' | 'active' | 'disabled' | 'pending_setup';
  emailVerified?: boolean;
  createdAt: admin.firestore.Timestamp | Date | any;
  preferredLanguage?: string;
  passwordResetId?: string;
  failedLoginAttempts?: number;
  lockoutUntil?: admin.firestore.Timestamp | Date | null | any;
  primaryOrganizationId?: string;
  defaultWorkspaceId?: string;
  preferences?: {
    darkContrast?: boolean;
  };
  notificationPreference?: 'all' | 'mentions_only' | 'none';
  forceLogoutAt?: admin.firestore.Timestamp | Date | null;
}

export interface DBMembership {
  id: string;
  userId: string;
  entityId: string;
  entityType: 'workspace' | 'workspace';
  role: UserRole;
  orgId: string;
  permissions?: 'edit' | 'read_only';
  boardOnlyAccess?: boolean;
  boardIds?: string[];
  createdAt: admin.firestore.Timestamp | Date | any;
  // Denormalized user fields for list views
  userName?: string;
  userEmail?: string;
  userProfileImageUrl?: string;
  userStatus?: string;
  userCreatedAt?: admin.firestore.Timestamp | Date | any;
  userHasPassword?: boolean;
}

export interface DBPreapprovedUser {
  id: string;
  email: string;
  workspaceId: string;
  orgId: string;
  addedBy: string;
  permissions?: 'edit' | 'read_only';
  boardOnlyAccess?: boolean;
  boardIds?: string[];
  allWorkspaces?: boolean;
  createdAt: admin.firestore.Timestamp | Date | any;
}

export interface DBUserAccessStatus {
  id: string;
  workspaceId: string;
  hasAccess: boolean;
  updatedAt: admin.firestore.Timestamp | Date | any;
}

// --- JWT PAYLOADS ---

export interface JwtUserPayload {
  id: string;
  role: UserRole;
  selectedWorkspaceId: string;
  orgId: string;
  workspacePermissions?: 'edit' | 'read_only';
  boardIds?: string[];
}

export interface JwtMultiOrgPayload {
  id: string;
  action: 'select-workspace' | 'workspace-setup';
}

export interface JwtApprovalPayload {
  userId: string;
  action: 'approve_user';
}

export interface JwtVerificationPayload {
  userId: string;
  action: 'verify_email' | 'verify_organization_admin';
}

export interface JwtPasswordResetPayload {
  userId: string;
  resetId: string;
  action: 'reset_password';
}

// --- BOARD VIEW INVITES (public, read-only, per-email magic link) ---

// Firestore doc ID is the sha256 hash of the plaintext invite token — mirrors
// the webhook token pattern (backend/src/controllers/webhook.controller.ts):
// only the hash is ever stored, the plaintext exists solely in the emailed link.
export interface DBBoardViewInvite {
  orgId: string;
  boardId: string;
  boardName: string;
  workspaceId: string;
  email: string;
  invitedBy: string;
  createdAt: admin.firestore.Timestamp | Date | any;
  expiresAt: admin.firestore.Timestamp | Date | any;
  revokedAt: admin.firestore.Timestamp | Date | any | null;
}

// --- REFRESH TOKENS ---

// Firestore doc ID is the sha256 hash of the plaintext refresh token — the
// plaintext is never stored, only its hash, so a Firestore read alone can't
// yield a usable token.
export interface DBRefreshToken {
  userId: string;
  workspaceId: string;
  role: UserRole;
  createdAt: admin.firestore.Timestamp | Date | any;
  expiresAt: admin.firestore.Timestamp | Date | any;
  revokedAt: admin.firestore.Timestamp | Date | any | null;
}

// --- PAGINATION ---

export interface PaginatedResponse<T> {
  data: T[];
  cursor: string | null;
  hasMore: boolean;
  total?: number;
}

declare global {
  namespace Express {
    interface User extends Partial<DBUser>, Partial<JwtUserPayload>, Partial<JwtMultiOrgPayload> {}
    interface Request {
      orgId?: string;
    }
  }
}

// --- PHASE 4: WORK MANAGEMENT DATA MODEL ---

export enum ColumnType {
  TEXT = 'text',
  NUMBER = 'number',
  DATE = 'date',
  STATUS = 'status',
  PERSON = 'person',
  DROPDOWN = 'dropdown',
  CHECKBOX = 'checkbox',
  TAGS = 'tags',
  TIME = 'time',
  EMAIL = 'email',
  PHONE = 'phone',
  LOCATION = 'location',
  LINK = 'link',
  TIME_RANGE = 'time_range',
  SIMPLE_FORMULA = 'simple_formula',
  HOURS_LOG = 'hours_log',
  FILES = 'files',
}

// --- Column settings per type ---

export interface TextColumnSettings {
  maxLength?: number;
  richText?: boolean;
}

export interface NumberColumnSettings {
  precision?: number;
  unit?: string;
  summary?: 'sum' | 'avg' | 'min' | 'max' | 'count';
}

export interface DateColumnSettings {
  includeTime?: boolean;
}

export interface StatusOption {
  id: string;
  label: string;
  color: string;
}

export interface StatusColumnSettings {
  options: StatusOption[];
  defaultStatusId?: string;
}

export interface PersonColumnSettings {
  multiple: boolean;
}

export interface DropdownOption {
  id: string;
  label: string;
}

export interface DropdownColumnSettings {
  options: DropdownOption[];
  multiple: boolean;
}

export interface TagsColumnSettings {
  allowCustom: boolean;
}

export interface SimpleFormulaColumnSettings {
  defaultFormula: string; // e.g. "{Price} * {Qty}" — evaluated client-side
}

export type ColumnSettings =
  | TextColumnSettings
  | NumberColumnSettings
  | DateColumnSettings
  | StatusColumnSettings
  | PersonColumnSettings
  | DropdownColumnSettings
  | TagsColumnSettings
  | SimpleFormulaColumnSettings
  | Record<string, never>; // for types with no settings (checkbox, email, phone, location, time, time_range)

/**
 * Who can see a column client-side, most → least restrictive. Purely a render gate the frontend
 * enforces — never affects formula evaluation (which always resolves refs against every column
 * regardless of viewer). Missing/undefined means 'view_users' (visible to everyone) for backward
 * compatibility with columns created before this field existed.
 */
export type ColumnVisibility = 'org_admins' | 'edit_members' | 'org_users' | 'view_users';

export interface DBColumn {
  id: string;
  boardId: string;
  name: string;
  type: ColumnType;
  settings: ColumnSettings;
  visibility?: ColumnVisibility;
  /** Client-generated idempotency key used to dedupe retried create requests. Not exposed in UI. */
  clientRequestId?: string;
  summaryConfig?: {
    calc: string;
    unit: string;
    unitAlign: 'left' | 'right';
    cumulative?: boolean;
  };
  /** Independent config for the board-wide total footer (separate from the per-group summaryConfig). */
  boardSummaryConfig?: {
    calc: string;
    unit: string;
    unitAlign: 'left' | 'right';
  };
  width?: number;
  parentGroupId?: string | null;
  createdAt: admin.firestore.Timestamp | Date | any;
  updatedAt: admin.firestore.Timestamp | Date | any;
}

// --- Personal Hub columns — user-owned columns overlaid on top of items the
// user is assigned to, scoped to a single source board or to every board
// shown in that user's Personal Hub. Never attached to a real Board, so they
// can never be picked up as a source board by anyone's Personal Hub query. ---

export interface DBPersonalColumn {
  id: string;
  orgId: string;
  userId: string;
  name: string;
  type: ColumnType;
  settings: ColumnSettings;
  summaryConfig?: {
    calc: string;
    unit: string;
    unitAlign: 'left' | 'right';
    cumulative?: boolean;
  };
  /** Independent config for the page-wide total footer (separate from the per-group summaryConfig). */
  boardSummaryConfig?: {
    calc: string;
    unit: string;
    unitAlign: 'left' | 'right';
  };
  scope: 'board' | 'all';
  boardId?: string; // required when scope === 'board'
  /** Set when this column was materialized from the org's Personal Hub template — the user
   *  can edit it freely but cannot delete it (only columns they created themselves). */
  fromTemplate?: boolean;
  /** The template column this was materialized from — stable across every user's own copy
   *  (which each get their own columnId), so their values can all feed the same org-wide
   *  running total (DBPersonalHubTemplateTotal). Only set alongside fromTemplate. */
  templateColumnId?: string;
  width?: number;
  /** Per-board cumulative summary scope (boardId -> include board groups above), independent per board group. */
  summaryCumulativeByBoard?: Record<string, boolean>;
  order: number;
  createdAt: admin.firestore.Timestamp | Date | any;
  updatedAt: admin.firestore.Timestamp | Date | any;
}

// One doc per (userId, itemId) holding that user's personal-column values for that item.
export interface DBPersonalItemValue {
  id: string; // `${userId}_${itemId}`
  orgId: string;
  userId: string;
  itemId: string;
  values: Record<string, unknown>;
  updatedAt: admin.firestore.Timestamp | Date | any;
}

// --- Column value types (stored inside Item.values) ---

export interface LocationValue {
  address: string;
}

export interface TimeRangeValue {
  start: admin.firestore.Timestamp | Date | any;
  end: admin.firestore.Timestamp | Date | any;
  durationDays?: number;
}

// --- Cell Dependencies ---

export interface TimeRangeDependency {
  id: string;
  sourceItemId: string;
  sourceColumnId: string;
  targetItemId: string;
  targetColumnId: string;
  offsetDays: number;
  /**
   * Snapshot of the target's time-range value captured when this dependency
   * was created. "Revert to original dates" restores this so a manual edit
   * made while the dependency was active does not survive removal/re-creation.
   */
  originalValue?: TimeRangeValue | null;
}

export interface DependencyRule {
  id: string;
  sourceColumnId: string;
  targetColumnId: string;
  offsetDays: number;
}

// The dynamic map stored in an Item document
export type ColumnValueMap = Record<string, unknown>;

// --- Board ---

export interface DBBoard {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  order: number;
  createdBy: string;
  isArchived?: boolean;
  isTemplate?: boolean;
  dependencyRules?: DependencyRule[];
  createdAt: admin.firestore.Timestamp | Date | any;
  updatedAt: admin.firestore.Timestamp | Date | any;
}

// --- Group ---

export interface DBGroup {
  id: string;
  workspaceId: string;
  boardId: string;
  name: string;
  color?: string;
  order: number;
  isCollapsed?: boolean;
  isArchived?: boolean;
  parentItemId?: string | null;
  /** Per-column cumulative summary scope (columnId -> include groups above), independent per group. */
  summaryCumulative?: Record<string, boolean>;
  /** Last bulk "Assign users" action on this group — a record of that action for the group title
   *  row to display, not a live rollup of what each item currently holds (an item can be edited
   *  individually afterward without this changing). */
  assignedUserIds?: string[];
  /** The PERSON column assignedUserIds was written to, so re-opening "Assign users" can default
   *  back to the same column. */
  assignedColumnId?: string;
  createdAt: admin.firestore.Timestamp | Date | any;
  updatedAt: admin.firestore.Timestamp | Date | any;
}

// --- Item (flat, stored at workspace level) ---

export interface DBItem {
  id: string;
  workspaceId: string;
  boardId: string;
  groupId: string;
  name: string;
  order: number;
  createdBy: string;
  isArchived?: boolean;
  // Indexed top-level fields (mirrored from values for Firestore querying)
  status?: string;          // mirrors values[statusColumnId]
  assignees?: string[];     // mirrors values[personColumnId] — userIds
  dueDate?: admin.firestore.Timestamp | Date | any; // mirrors values[dateColumnId]
  // Last time `assignees` changed — used to sort the Personal Hub (newest first)
  lastAssignedAt?: admin.firestore.Timestamp | Date | any;
  dependencies?: TimeRangeDependency[];
  // Chat denormalized counters (updated on each new chat message)
  chatMessageCount?: number;
  chatLastMessageAt?: admin.firestore.Timestamp | Date | any;
  // Per-user seen counts for unread badge: { [userId]: seenCount }
  chatSeenBy?: Record<string, number>;
  // Forms denormalized state. An item holds at most one form; formSubmitted flips
  // true once its answers are submitted and drives the row's red marker.
  formResponseCount?: number;
  formSubmitted?: boolean;
  // Dynamic column values
  values: ColumnValueMap;
  createdAt: admin.firestore.Timestamp | Date | any;
  updatedAt: admin.firestore.Timestamp | Date | any;
}

// --- Chat Message ---

export interface DBChatMessage {
  id: string;
  itemId: string;
  authorId: string;
  authorName: string;
  authorProfileImageUrl?: string;
  text: string;
  attachments?: DBChatAttachment[];
  createdAt: admin.firestore.Timestamp | Date | any;
  editedAt?: admin.firestore.Timestamp | Date | any;
}

export interface DBChatAttachment {
  url: string;
  name: string;
  mimeType: string;
  size: number;
}

// --- FILES column ---

export interface DBFileAttachment {
  id: string;
  url: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedByName: string;
  /** ISO timestamp string — stored as plain text (not a Firestore Timestamp) since this lives
   *  nested inside an item.values array rather than as its own document field. */
  uploadedAt: string;
}

// --- CUSTOM DASHBOARDS ---

export type CustomDashboardChartType =
  | 'pie'
  | 'bar_vertical'
  | 'bar_horizontal'
  | 'radar'
  | 'line'
  | 'number';

export type CustomDashboardVisibility = 'admins_only' | 'all';
export type MetricAggregation = 'COUNT' | 'SUM' | 'AVERAGE' | 'MIN' | 'MAX';
export type YAxisAggregation = 'COUNT' | 'SUM' | 'AVERAGE';
export type TimeAxisGrouping = 'day' | 'week' | 'month';
export type DateFormat = 'auto' | 'dmy' | 'mdy';

export const ITEM_NAME_COLUMN_ID = '__item_name__';

export interface DBMetricEntry {
  boardId: string;
  groupId?: string;
  aggregation: MetricAggregation;
  columnId?: string;
  label: string;
}

export interface DBMetricConfig {
  type: 'metric';
  timeAxisColumnId?: string;
  dateFormat?: DateFormat;
  metrics: DBMetricEntry[];
}

export interface DBCategoryConfig {
  type: 'category';
  boardId: string;
  groupId?: string;
  groupByColumnId: string;
  yAxisAggregation?: MetricAggregation;  // defaults to COUNT if absent
  yAxisColumnId?: string;                 // required when yAxisAggregation !== COUNT
  timeAxisColumnId?: string;
  dateFormat?: DateFormat;
}

export interface DBLineSeriesConfig {
  boardId: string;
  groupId?: string;
  xAxisColumnId: string;
  xAxisGrouping: TimeAxisGrouping;
  yAxisAggregation: YAxisAggregation;
  yAxisColumnId?: string;
  dateFormat?: DateFormat;
  label: string;
}

export interface DBTimeSeriesConfig {
  type: 'timeseries';
  boardId: string;
  groupId?: string;
  xAxisColumnId: string;
  xAxisGrouping: TimeAxisGrouping;
  yAxisAggregation: YAxisAggregation;
  yAxisColumnId?: string;
  dateFormat?: DateFormat;
  series?: DBLineSeriesConfig[];
}

export type DBCustomDashboardConfig =
  | DBMetricConfig
  | DBCategoryConfig
  | DBTimeSeriesConfig;

export interface DBCustomDashboard {
  id: string;
  name: string;
  chartType: CustomDashboardChartType;
  config: DBCustomDashboardConfig;
  visibility: CustomDashboardVisibility;
  /**
   * When set, this is a PERSONAL dashboard owned by that user — shown only in
   * that user's Personal Hub (to the owner and to admins viewing their hub),
   * never on the org-wide /dashboard. When absent, it's an org dashboard.
   */
  ownerUserId?: string;
  createdBy: string;
  createdAt: admin.firestore.Timestamp | Date | any;
  updatedAt: admin.firestore.Timestamp | Date | any;
  isArchived?: boolean;
}

// --- AUDIT LOGGING ---

export type AuditAction = 'CREATE' | 'READ' | 'UPDATE' | 'DELETE' | 'ANOMALY';
export type AuditResourceType =
  | 'user'
  | 'workspace'
  | 'board'
  | 'group'
  | 'item'
  | 'column'
  | 'form';

export interface DBAuditLog {
  id: string;
  actorUserId: string;
  actorRole: UserRole;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string;
  workspaceId?: string;
  orgId?: string;
  changes?: { before: unknown; after: unknown };
  ipAddress?: string;
  userAgent?: string;
  details?: string;
  timestamp: admin.firestore.Timestamp | Date | any;
  expiresAt: admin.firestore.Timestamp | Date | any;
}

// --- PHASE 8: DASHBOARD ---

export interface DashboardStatusDistribution {
  statusId: string;
  label: string;
  color: string;
  count: number;
}

export interface DashboardWorkloadPerson {
  userId: string;
  name: string;
  profileImageUrl?: string;
  count: number;
}

export interface DashboardBoardCount {
  boardId: string;
  name: string;
  count: number;
}

export interface DashboardSummaryStats {
  total: number;
  completed: number;
  completionRate: number;
  archived: number;
}

export interface DashboardSummaryResponse {
  statusDistribution: DashboardStatusDistribution[];
  overdue: { count: number; items: DBItem[] };
  workloadByPerson: DashboardWorkloadPerson[];
  itemsByBoard: DashboardBoardCount[];
  summary: DashboardSummaryStats;
  truncated: boolean;
}

export interface DBEmailTemplate {
  id: string;
  name: string;
  description: string;
  subject: string;
  html: string;
  variables: string[];
  updatedAt: admin.firestore.Timestamp | Date | any;
  updatedBy?: string;
}

// --- WEBHOOKS ---

export interface DBWebhook {
  id: string;
  orgId: string;
  workspaceId: string;
  boardId: string;
  groupId: string;
  tokenHash: string;
  insertPosition: 'top' | 'bottom';
  allowedOrigins: string[];
  status: 'active' | 'revoked';
  createdBy: string;
  createdAt: admin.firestore.Timestamp | Date | any;
  updatedAt: admin.firestore.Timestamp | Date | any;
  lastUsedAt?: admin.firestore.Timestamp | Date | any;
  useCount: number;
  /** Position-based column mapping. position is 1-based (field 1 = first field in body). */
  fieldMap: Array<{ position: number; columnId: string }>;
  /**
   * How the item name is derived:
   *   'field'              — extract from nameFieldPosition (default)
   *   'timestamp'          — dd/mm/yyyy hh:mm of the moment the request arrives
   *   'sequence'           — sequential integer (1, 2, 3…) based on item count in the group
   *   'sequence-timestamp' — combined: "1.  dd/mm/yyyy hh:mm"
   */
  nameMode: 'field' | 'timestamp' | 'sequence' | 'sequence-timestamp';
  /** Which 1-based field position provides the item name when nameMode === 'field'. */
  nameFieldPosition: number | null;
}

// --- PHASE 9: PERMISSIONS & NOTIFICATIONS ---

export enum BoardRole {
  VIEWER = 'viewer',
  EDITOR = 'editor',
  ADMIN  = 'admin',
}

export interface DBBoardMember {
  userId: string;
  boardId: string;
  workspaceId: string;
  role: BoardRole;
  addedBy: string;
  createdAt: admin.firestore.Timestamp;
  // Denormalized user info (written on add)
  userName?: string;
  userEmail?: string;
  userProfileImageUrl?: string;
}

export type NotificationType = 'assignment' | 'mention';

export interface DBNotification {
  id: string;
  workspaceId: string;
  recipientId: string;
  actorId: string;
  actorName: string;
  type: NotificationType;
  resourceType: 'item';
  resourceId: string;
  resourceName: string;
  boardId: string;
  boardName: string;
  read: boolean;
  createdAt: admin.firestore.Timestamp;
}

// --- FORMS ---

/**
 * Field types supported by the Forms builder.
 *   short_text   — single-line text input
 *   long_text    — multi-line textarea
 *   number       — numeric input
 *   date         — date picker
 *   email/phone  — validated single-line inputs
 *   dropdown     — <select> with one chosen option
 *   single_select — radio list (exactly one option)
 *   multi_select  — checkbox list (zero or more options)
 *   checkbox     — a single yes/no toggle
 */
export enum FormFieldType {
  SHORT_TEXT    = 'short_text',
  LONG_TEXT     = 'long_text',
  NUMBER        = 'number',
  DATE          = 'date',
  EMAIL         = 'email',
  PHONE         = 'phone',
  DROPDOWN      = 'dropdown',
  SINGLE_SELECT = 'single_select',
  MULTI_SELECT  = 'multi_select',
  CHECKBOX      = 'checkbox',
}

export interface DBFormFieldOption {
  id: string;
  label: string;
}

export interface DBFormField {
  id: string;
  type: FormFieldType;
  label: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  /** Only for dropdown / single_select / multi_select. */
  options?: DBFormFieldOption[];
  /**
   * Optional column type this field's answers should sync to. A form is shared
   * across boards, so this names a column *type* rather than one specific column
   * id — on submit, we find the first column of this type on the item's own
   * board (if any) and write the answer there too.
   */
  linkedColumnType?: ColumnType;
}

/**
 * A form definition, stored org-wide:
 * /organizations/{orgId}/forms/{formId}
 */
export interface DBForm {
  id: string;
  name: string;
  description?: string;
  fields: DBFormField[];
  createdBy: string;
  createdAt: admin.firestore.Timestamp | Date | any;
  updatedAt: admin.firestore.Timestamp | Date | any;
  isArchived?: boolean;
}

/** A single answer value. Arrays are only produced by multi_select fields. */
export type FormAnswerValue = string | number | boolean | string[] | null;

/**
 * A form attached to (and filled in on) an item. One doc per (item, form),
 * keyed by formId:
 * /organizations/{orgId}/items/{itemId}/formResponses/{formId}
 */
export interface DBFormResponse {
  id: string;
  itemId: string;
  formId: string;
  /** Denormalized so the sidebar can label a response without a form fetch. */
  formName: string;
  values: Record<string, FormAnswerValue>;
  attachedBy: string;
  attachedAt: admin.firestore.Timestamp | Date | any;
  submittedBy?: string;
  submittedByName?: string;
  submittedAt?: admin.firestore.Timestamp | Date | any;
  updatedAt: admin.firestore.Timestamp | Date | any;
  /**
   * Set when a submitted form is removed from its item. The response document is kept
   * (rather than deleted) so its answers still show up in the form's results, but it no
   * longer counts as "attached" — listItemForms and attachFormToItem both ignore it.
   */
  detachedAt?: admin.firestore.Timestamp | Date | any;
}
