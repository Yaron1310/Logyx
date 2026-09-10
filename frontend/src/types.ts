export enum UserRole {
  REGULAR_USER = 'regular_user',
  ORG_EDITOR = 'org_editor',
  WORKSPACE_ADMIN = 'workspace_admin',
  ORGANIZATION_ADMIN = 'org_admin',
  SYSTEM_ADMIN = 'system_admin',
}

export interface WorkHub {
  id: string;
  name: string;
  orgId: string;
  color?: string;
  organizationName?: string;
  isPersonal?: boolean;
  isTemplates?: boolean;
  status?: 'active' | 'archived';
  workspacePermissions?: 'edit' | 'read_only';
}

export interface OrganizationSettings {
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
  displayNameColor?: string;
  sidebarLinkColor?: string;
  logoCircle?: boolean;
  bridgeEnabled?: boolean;
  bridgeSecretKey?: string;
  /** Array of day-of-week indices that are working days (0=Sun, 1=Mon, …, 6=Sat). Defaults to Mon–Fri [1,2,3,4,5]. */
  workingDays?: number[];
}

export interface EmailTemplate {
  id: string;
  name: string;
  description: string;
  subject: string;
  html: string;
  variables: string[];
  updatedAt?: string | Date | any;
  updatedBy?: string;
}

export interface SystemSettings {
  id?: string;
  oneTimeTokensPerLesson: number;
  oneTimeGeneralTokens: number;
  subscriptionMonthlyLimit: number;
  globalSystemPrompt?: string;
}

export interface TutorialLink {
  enabled: boolean;
  videoUrl: string;
}

export interface TutorialSettings {
  theme?: TutorialLink;
  workspaces?: TutorialLink;
  users?: TutorialLink;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  dbRoles?: {
    systemAdmin?: boolean;
    organizationAdmin?: string[];
    workspaceAdmin?: string[];
  };
  status: 'pending' | 'active' | 'disabled' | 'pending_setup';
  workspaces: Pick<Workspace, 'id' | 'name' | 'orgId' | 'organizationName' | 'isPersonal'>[];
  profileImageUrl?: string;
  preferredLanguage?: string;
  hasPassword?: boolean;
  preferences?: {
    darkContrast?: boolean;
  };
  notificationPreference?: 'all' | 'mentions_only' | 'none';
  tokenUsage?: {
    used: number;
    limit: number | null;
  };
  workspaceId?: string;
  workspaceName?: string;
  allAcademies?: Workspace[];
}


export interface Part {
  text: string;
}

export interface Content {
  role: 'user' | 'model';
  parts: Part[];
}

export interface Message {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: Date;
  isError?: boolean;
}

export type ExtractedFactors = { [key: string]: string };

export interface PreApprovedUser {
  id: string;
  email: string;
  workspaceId: string;
  addedBy: string;
  createdAt: Date;
}

export interface TokenUsageData {
  [id: string]: {
    used: number;
    limit: number | null;
  };
}

// --- Pagination ---

export interface PaginatedResponse<T> {
    data: T[];
    cursor: string | null;
    hasMore: boolean;
    total?: number;
}

export type SystemPrompts = {
    chatSystemPrompt: string;
};
export type ThemeSettings = Pick<OrganizationSettings, 'sidebarColor' | 'appName' | 'logoUrl'>;

// =============================================================================
// PHASE 4 — WORK MANAGEMENT DATA MODEL
// =============================================================================

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
  /** When true, the cell opens a sidebar with a rich-text (HTML) editor instead of inline plain-text editing. */
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
  unit?: string;
  /** Only meaningful when unit === '%'. Multiplies the evaluated result by 100 before display
   *  (e.g. a formula returning 0.42 shows as "42%" instead of "0.42%"). Defaults to true (on)
   *  whenever unit is '%' and this is unset — so existing percent-unit columns keep working. */
  percentAutoMultiply?: boolean;
  /** Remembered answer to "apply to all cells / just this cell", asked once per column the first
   *  time it gets a formula. 'all' keeps every cell on the shared defaultFormula; 'perCell' lets
   *  each cell hold its own override. Admins can change it later from the column's edit settings. */
  applyScope?: 'all' | 'perCell';
}

export type LinkColumnSettings = Record<string, never>;

export type HoursLogColumnSettings = Record<string, never>;

export type FilesColumnSettings = Record<string, never>;

export type ColumnSettings =
  | TextColumnSettings
  | NumberColumnSettings
  | DateColumnSettings
  | StatusColumnSettings
  | PersonColumnSettings
  | DropdownColumnSettings
  | TagsColumnSettings
  | SimpleFormulaColumnSettings
  | LinkColumnSettings
  | HoursLogColumnSettings
  | FilesColumnSettings
  | Record<string, never>;

// --- Column definition ---

/**
 * Who can see a column (header + cells) in the board grid, ordered most → least restrictive.
 * Purely a client-side render gate — it never affects formula evaluation, which always resolves
 * refs against every column regardless of the viewer's tier. Missing/undefined means
 * 'view_users' (visible to everyone, including public view-link viewers) for backward
 * compatibility with columns created before this field existed.
 */
export type ColumnVisibility = 'org_admins' | 'edit_members' | 'org_users' | 'view_users';

export interface Column {
  id: string;
  boardId: string;
  name: string;
  type: ColumnType;
  settings: ColumnSettings;
  visibility?: ColumnVisibility;
  summaryConfig?: {
    calc: string;
    unit: string;
    unitAlign: 'left' | 'right';
    /** When true, each group's summary includes items from all groups above it (running total). */
    cumulative?: boolean;
  };
  /** Independent config for the board-wide total footer (separate from the per-group summaryConfig). */
  boardSummaryConfig?: {
    calc: string;
    unit: string;
    unitAlign: 'left' | 'right';
  };
  width?: number;
  parentGroupId?: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

// --- Column value types (stored inside Item.values) ---

export interface LocationValue {
  address: string;
}

/** One logged entry on an HOURS_LOG cell — a duration the out-source employee worked, plus
 *  when it was logged (shown in the entry list, never editable after the fact). */
export interface HoursLogEntry {
  id: string;
  /** Duration in minutes, always a multiple of 15 (the picker only offers :00/:15/:30/:45). */
  minutes: number;
  /** ISO timestamp of when this entry was added. */
  loggedAt: string;
}

/** One uploaded file on a FILES cell. */
export interface FileAttachment {
  id: string;
  url: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedByName: string;
  /** ISO timestamp of when this file was uploaded. */
  uploadedAt: string;
}

export interface TimeRangeValue {
  start: Date | string;
  end: Date | string;
  /** Stored duration in days — preserved so dependency shifts don't alter task length */
  durationDays?: number;
}

// --- Cell Dependencies ---

export interface TimeRangeDependency {
  /** Unique ID for this dependency link */
  id: string;
  /** Item that must finish first (the source / predecessor) */
  sourceItemId: string;
  sourceColumnId: string;
  /** Item that starts after (the dependent / successor) */
  targetItemId: string;
  targetColumnId: string;
  /** Days gap between source.end and target.start (default 0) */
  offsetDays: number;
  /**
   * Snapshot of the target's time-range value taken when this dependency was
   * created. "Revert to original dates" restores this, so a manual edit made
   * while the dependency was active does not survive removal/re-creation.
   */
  originalValue?: TimeRangeValue | null;
}

/** Board-level rule: "in every row, targetColumnId depends on sourceColumnId" */
export interface DependencyRule {
  id: string;
  sourceColumnId: string;
  targetColumnId: string;
  offsetDays: number;
}

export type ColumnValueMap = Record<string, unknown>;

// --- Board ---

export interface Board {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  order: number;
  createdBy: string;
  isArchived?: boolean;
  isTemplate?: boolean;
  /** Column-level dependency rules that apply to every item on this board */
  dependencyRules?: DependencyRule[];
  createdAt: Date | string;
  updatedAt: Date | string;
}

// --- Group ---

export interface Group {
  id: string;
  workspaceId: string;
  boardId: string;
  name: string;
  color?: string;
  order: number;
  isCollapsed?: boolean;
  isArchived?: boolean;
  parentItemId?: string;
  /** Per-column cumulative summary scope (columnId -> include groups above), independent per group. */
  summaryCumulative?: Record<string, boolean>;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface WebhookFieldMapping {
  position: number;
  columnId: string;
}

export type WebhookNameMode = 'field' | 'timestamp' | 'sequence' | 'sequence-timestamp';

export interface Webhook {
  id: string;
  orgId: string;
  workspaceId: string;
  boardId: string;
  groupId: string;
  insertPosition: 'top' | 'bottom';
  allowedOrigins: string[];
  status: 'active' | 'revoked';
  createdBy: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  lastUsedAt?: Date | string;
  useCount: number;
  fieldMap: WebhookFieldMapping[];
  nameMode: WebhookNameMode;
  nameFieldPosition: number | null;
  secret?: string;
}

// --- Item (flat, stored at WorkHub level) ---

export interface Item {
  id: string;
  workspaceId: string;
  boardId: string;
  groupId: string;
  name: string;
  order: number;
  createdBy: string;
  isArchived?: boolean;
  // Indexed top-level fields (mirrored from values for querying/filtering)
  status?: string;
  assignees?: string[];
  dueDate?: Date | string;
  // Last time this item's assignees changed — used to sort the Personal Hub (newest first)
  lastAssignedAt?: Date | string;
  // Cell dependency links — stored on the target item (the dependent one)
  dependencies?: TimeRangeDependency[];
  // Chat denormalized counters
  chatMessageCount?: number;
  chatLastMessageAt?: Date | string;
  chatSeenBy?: Record<string, number>;
  // Forms state. An item holds at most one form; formSubmitted flips true once its
  // answers are submitted and drives the red marker on the row's form icon.
  formResponseCount?: number;
  formSubmitted?: boolean;
  // Dynamic column values
  values: ColumnValueMap;
  createdAt: Date | string;
  updatedAt: Date | string;
}

// --- Chat ---

export interface ChatAttachment {
  url: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  itemId: string;
  authorId: string;
  authorName: string;
  authorProfileImageUrl?: string;
  text: string;
  attachments?: ChatAttachment[];
  createdAt: Date | string;
  editedAt?: Date | string;
}

// =============================================================================
// PHASE 8 — DASHBOARD TYPES
// =============================================================================

export interface DashboardParams {
  workspaceId?: string;
  boardIds?: string[];
  assigneeId?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
}

export interface StatusDistributionEntry {
  statusId: string;
  label: string;
  color: string;
  count: number;
}

export interface WorkloadByPersonEntry {
  userId: string;
  name: string;
  profileImageUrl?: string;
  count: number;
}

export interface ItemsByBoardEntry {
  boardId: string;
  name: string;
  count: number;
}

export interface DashboardSummary {
  statusDistribution: StatusDistributionEntry[];
  overdue: { count: number; items: Item[] };
  workloadByPerson: WorkloadByPersonEntry[];
  itemsByBoard: ItemsByBoardEntry[];
  summary: {
    total: number;
    completed: number;
    completionRate: number;
    archived: number;
  };
  truncated: boolean;
}

// =============================================================================
// PHASE 8b — CUSTOM DASHBOARDS
// =============================================================================

export const ITEM_NAME_COLUMN_ID = '__item_name__';

export type ChartType =
  | 'pie'
  | 'bar_vertical'
  | 'bar_horizontal'
  | 'radar'
  | 'line'
  | 'number';

export type MetricAggregation = 'COUNT' | 'SUM' | 'AVERAGE' | 'MIN' | 'MAX';
export type YAxisAggregation = 'COUNT' | 'SUM' | 'AVERAGE';
export type TimeAxisGrouping = 'day' | 'week' | 'month';
export type DashboardVisibility = 'admins_only' | 'all';
export type DateFormat = 'auto' | 'dmy' | 'mdy';

export interface MetricEntry {
  boardId: string;
  groupId?: string;
  aggregation: MetricAggregation;
  columnId?: string;
  label: string;
}

export interface MetricConfig {
  type: 'metric';
  timeAxisColumnId?: string;
  dateFormat?: DateFormat;
  metrics: MetricEntry[];
}

export interface CategoryConfig {
  type: 'category';
  boardId: string;
  groupId?: string;
  groupByColumnId: string;
  yAxisAggregation?: MetricAggregation;  // defaults to COUNT if absent
  yAxisColumnId?: string;                 // required when yAxisAggregation !== COUNT
  timeAxisColumnId?: string;
  dateFormat?: DateFormat;
}

export interface LineSeriesConfig {
  boardId: string;
  groupId?: string;
  xAxisColumnId: string;
  xAxisGrouping: TimeAxisGrouping;
  yAxisAggregation: YAxisAggregation;
  yAxisColumnId?: string;
  dateFormat?: DateFormat;
  label: string;
}

export interface TimeSeriesConfig {
  type: 'timeseries';
  boardId: string;
  groupId?: string;
  xAxisColumnId: string;
  xAxisGrouping: TimeAxisGrouping;
  yAxisAggregation: YAxisAggregation;
  yAxisColumnId?: string;
  dateFormat?: DateFormat;
  series?: LineSeriesConfig[];
}

export type CustomDashboardConfig = MetricConfig | CategoryConfig | TimeSeriesConfig;

export interface CustomDashboard {
  id: string;
  name: string;
  chartType: ChartType;
  config: CustomDashboardConfig;
  visibility: DashboardVisibility;
  /** When set, a personal dashboard owned by that user (shown only in their Personal Hub). */
  ownerUserId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  isArchived?: boolean;
}

export interface CustomDashboardDataPoint {
  label: string;
  value: number;
  [key: string]: number | string;
}

// =============================================================================
// PHASE 9 — PERMISSIONS & NOTIFICATIONS
// =============================================================================

export enum BoardRole {
  VIEWER = 'viewer',
  EDITOR = 'editor',
  ADMIN  = 'admin',
}

export interface BoardMember {
  userId: string;
  boardId: string;
  workspaceId: string;
  role: BoardRole;
  addedBy: string;
  createdAt: Date | string;
  userName?: string;
  userEmail?: string;
  userProfileImageUrl?: string;
}

export interface BoardPermissionsWorkspace {
  id: string;
  name: string;
  isMember: boolean;
  permissions: 'edit' | 'read_only' | 'admin';
  boards: Array<{
    id: string;
    name: string;
    isMember: boolean;
    role: BoardRole | null;
  }>;
}

// =============================================================================
// PERSONAL HUB — user-owned columns overlaid on top of assigned items
// =============================================================================

export type PersonalColumnScope = 'board' | 'all';

export interface PersonalColumn {
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
    /** When true, each group's summary includes items from all groups above it (running total). */
    cumulative?: boolean;
  };
  /** Independent config for the page-wide total footer (separate from the per-group summaryConfig). */
  boardSummaryConfig?: {
    calc: string;
    unit: string;
    unitAlign: 'left' | 'right';
  };
  scope: PersonalColumnScope;
  boardId?: string;
  /** Set when this column was materialized from the org's Personal Hub template — editable,
   *  but the user cannot delete it (only columns they created themselves). */
  fromTemplate?: boolean;
  /** The template column this one was materialized from. Also the id the org-wide running total
   *  is kept under, so a formula anywhere can reference that total ('ph' refs). */
  templateColumnId?: string;
  width?: number;
  /** Per-board cumulative summary scope (boardId -> include board groups above), independent per board group. */
  summaryCumulativeByBoard?: Record<string, boolean>;
  order: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/** One column definition in the org admin's Personal Hub default template — "all groups"
 *  columns only, no groups/items/data. Materialized into a user's own personalColumns
 *  (scope 'all', fromTemplate: true) the first time they have none. */
export interface PersonalHubTemplateColumn {
  id: string;
  name: string;
  type: ColumnType;
  settings: ColumnSettings;
  order: number;
}

export type NotificationType = 'assignment' | 'mention';

export interface Notification {
  id: string;
  type: NotificationType;
  actorName: string;
  resourceName: string;
  boardName: string;
  boardId: string;
  resourceId: string;
  read: boolean;
  createdAt: Date | string;
}

// =============================================================================
// FORMS
// =============================================================================

/** Input kinds available in the Forms builder. */
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

export interface FormFieldOption {
  id: string;
  label: string;
}

export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  /** Only for dropdown / single_select / multi_select. */
  options?: FormFieldOption[];
  /**
   * Optional column type this field's answers should sync to. A form is shared
   * across boards, so this names a column *type* rather than one specific column
   * id — on submit, the backend finds the first column of this type on the
   * item's own board (if any) and writes the answer there too.
   */
  linkedColumnType?: ColumnType;
}

export interface Form {
  id: string;
  name: string;
  description?: string;
  fields: FormField[];
  createdBy: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  isArchived?: boolean;
}

/** A single answer. Arrays only come from multi_select fields. */
export type FormAnswerValue = string | number | boolean | string[] | null;

/** A form attached to an item, together with the answers filled in on it. */
export interface FormResponse {
  id: string;
  itemId: string;
  formId: string;
  formName: string;
  values: Record<string, FormAnswerValue>;
  attachedBy: string;
  attachedAt: Date | string;
  submittedBy?: string;
  submittedByName?: string;
  submittedAt?: Date | string;
  updatedAt: Date | string;
}

/** One entry in an item's form sidebar. `form` is null when the definition was deleted. */
export interface ItemFormEntry {
  response: FormResponse;
  form: Form | null;
}

/** One collected answer set, as shown on the Forms page results modal. */
export interface FormResponseRow {
  response: FormResponse;
  itemId: string;
  /** Null when the item was deleted after the form was filled in. */
  itemName: string | null;
}

export interface FormResults {
  form: Form;
  responses: FormResponseRow[];
  /** True when the org has more responses than the endpoint's page limit. */
  truncated: boolean;
}
