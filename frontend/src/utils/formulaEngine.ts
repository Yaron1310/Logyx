/**
 * Safe arithmetic formula evaluator.
 * Supports:
 *   - numeric literals, +, -, *, /, ()
 *   - legacy positional cell references: {C3} (absolute), {C} (row-relative), {42} (literal)
 *   - stable ID references: {ref:<kind>:<boardId>:<columnId>:<row>}
 *       kind = 'b' (board item.values) | 'p' (personal-hub value store)
 *       row  = '@'        → relative to the current row (same board only)
 *            = <itemId>   → a specific item (required for cross-board references)
 * No eval() — uses a recursive-descent parser.
 *
 * Examples: "{B2} * {C2} + 10", "{ref:b:brd_1:col_9:@} * {ref:b:brd_2:col_3:itm_7}"
 */

import { ColumnType } from '../types';
import type { HoursLogEntry } from '../types';
import { formulaRefLog, sameColumnTrace } from './formulaDebug';
import { sumHoursLogMinutes } from './hoursLog';

export type ColumnValues = Record<string, number | null | undefined>;

/** Minimal shapes — real board Item[]/Column[] satisfy these structurally, and so do
 *  Personal Hub's pseudo-rows (items backed by personalItemValues instead of item.values).
 *  `id` is optional but required to resolve absolute ID refs ({ref:...:<itemId>}) locally;
 *  `groupId` is required to resolve group-summary refs. */
export interface FormulaRow { id?: string; groupId?: string; values: Record<string, unknown> }
/** `settings` carries a SIMPLE_FORMULA column's `defaultFormula` so a reference to another
 *  formula cell can be evaluated to its live value. Real Column objects satisfy this. */
export interface FormulaColumn { id: string; type: ColumnType; settings?: unknown }

/** Aggregate functions supported by group-summary references. */
export type SummaryCalc = 'sum' | 'avg' | 'median' | 'min' | 'max' | 'count';

/** A structured, stable-ID cell reference. */
export interface CellRef {
  /** Value source: board item.values ('b'), personal-hub value store ('p'), or the org-wide
   *  running total of a Personal Hub template column across every user ('ph'). */
  kind: 'b' | 'p' | 'ph';
  boardId: string;
  /** For 'ph' refs, this holds the template column's stable id instead of a real columnId. */
  columnId: string;
  /** null → relative to the current row (only valid for same-board refs); otherwise a specific item id.
   *  Always null for 'ph' refs — the total isn't tied to any row. */
  itemId: string | null;
  /** When set, this is a group-summary reference: aggregate `columnId` across `groupId` with `agg`. */
  agg?: SummaryCalc;
  groupId?: string;
  /** 'ph' refs only: 'global' (default) sums the column across every user's Personal Hub,
   *  regardless of item. 'item' scopes the sum to only the values entered against the same
   *  item as the row the formula is evaluated for (relative — like `itemId: null` for 'b'/'p'). */
  phScope?: 'global' | 'item';
  /** 'p' refs only: whose Personal Hub this points at. Absent means the viewer's own — the
   *  original reading, and still what a reference picked from your own hub records, so existing
   *  formulas keep working untouched. Set when the reference was picked while viewing someone
   *  else's hub (admins only), where "the viewer's hub" would name a different set of columns
   *  entirely and could never match. */
  ownerId?: string;
}

/** Stable key identifying the DOM cell a ref points at (a specific item's cell, or a group
 *  summary cell). Used to tag insertable/summary cells with `data-formula-cell-key` so hovering
 *  a ref token in the recording bar can highlight the exact source cell if it's on screen. */
export function formulaRefDomKey(ref: CellRef, currentItemId: string | null = null): string | null {
  if (ref.kind === 'ph') return `ph:${ref.columnId}`;
  if (ref.agg) return `${ref.kind}:${ref.boardId}:agg:${ref.groupId ?? ''}:${ref.columnId}:${ref.agg}`;
  const itemId = ref.itemId ?? currentItemId;
  if (!itemId) return null;
  return `${ref.kind}:${ref.boardId}:${itemId}:${ref.columnId}`;
}

function parseTimeToMinutes(time: string): number | null {
  const m = time.match(/^(\d+):(\d{2})$/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

function timeRangeIntervals(
  rows: FormulaRow[],
  columnId: string,
  getVal: (r: FormulaRow, c: string) => unknown,
): { s: number; e: number }[] {
  return rows
    .map((r) => {
      const v = getVal(r, columnId) as { start?: string; end?: string } | null | undefined;
      if (!v?.start || !v?.end) return null;
      const s = new Date(v.start).getTime();
      const e = new Date(v.end).getTime();
      return isNaN(s) || isNaN(e) ? null : { s, e };
    })
    .filter((x): x is { s: number; e: number } => x !== null);
}

/** Total unique calendar days covered by a set of intervals (union). */
function mergedDays(intervals: { s: number; e: number }[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a.s - b.s);
  let total = 0;
  let curS = sorted[0].s;
  let curE = sorted[0].e;
  for (let i = 1; i < sorted.length; i++) {
    const { s, e } = sorted[i];
    if (s <= curE) { if (e > curE) curE = e; }
    else { total += Math.round((curE - curS) / 86_400_000) + 1; curS = s; curE = e; }
  }
  return total + Math.round((curE - curS) / 86_400_000) + 1;
}

/**
 * Numeric group-summary matching GroupSummaryRow's aggregation, for any column type:
 * count works for every type; NUMBER/TIME/TIME_RANGE/HOURS_LOG produce numeric aggregates.
 * Returns null for combinations with no numeric meaning (e.g. avg of a text column).
 *
 * SIMPLE_FORMULA columns hold formula text, not values, so they can only be aggregated when the
 * caller supplies `evalRow` — a per-row evaluator producing that cell's live computed value (null
 * for rows with no formula, which are excluded, exactly as the rendered summary cell does). The
 * caller owns the cycle guard that keeps a formula aggregating its own column from recursing.
 */
export function computeSummaryNumeric(
  rows: FormulaRow[],
  type: ColumnType,
  columnId: string,
  calc: SummaryCalc,
  getVal: (r: FormulaRow, c: string) => unknown = (r, c) => r.values[c],
  evalRow?: (r: FormulaRow) => number | null,
): number | null {
  if (type === ColumnType.SIMPLE_FORMULA) {
    if (!evalRow) return null;
    const vals = rows.map((r) => evalRow(r)).filter((n): n is number => n !== null && !isNaN(n));
    return aggregateSummary(vals, calc);
  }
  if (calc === 'count') {
    if (type === ColumnType.CHECKBOX) return rows.filter((r) => Boolean(getVal(r, columnId))).length;
    return rows.filter((r) => {
      const v = getVal(r, columnId);
      if (v == null || v === '') return false;
      if (Array.isArray(v)) return v.length > 0;
      return true;
    }).length;
  }
  if (type === ColumnType.NUMBER) {
    const vals = rows
      .map((r) => getVal(r, columnId))
      .filter((v) => v != null && v !== '')
      .map((v) => Number(v))
      .filter((n) => !isNaN(n));
    return aggregateSummary(vals, calc);
  }
  if (type === ColumnType.TIME) {
    const vals = rows
      .map((r) => parseTimeToMinutes((getVal(r, columnId) as string) ?? ''))
      .filter((n): n is number => n !== null);
    return aggregateSummary(vals, calc);
  }
  if (type === ColumnType.TIME_RANGE) {
    const iv = timeRangeIntervals(rows, columnId, getVal);
    if (calc === 'sum') return iv.length ? mergedDays(iv) : null;
    const days = iv.map(({ s, e }) => Math.max(1, Math.round((e - s) / 86_400_000) + 1));
    return aggregateSummary(days, calc);
  }
  if (type === ColumnType.HOURS_LOG) {
    // Per-row totals in decimal hours — same unit as a direct single-cell HOURS_LOG reference
    // (see resolveLocalById), so {ref} * hourlyRate behaves the same whether it names one cell
    // or a group total.
    const vals = rows
      .map((r) => {
        const entries = getVal(r, columnId);
        if (!Array.isArray(entries) || entries.length === 0) return null;
        return sumHoursLogMinutes(entries as HoursLogEntry[]) / 60;
      })
      .filter((n): n is number => n !== null);
    return aggregateSummary(vals, calc);
  }
  return null;
}

/** Aggregate a list of numbers. Returns null when there is nothing to aggregate (except count → 0). */
export function aggregateSummary(vals: number[], calc: SummaryCalc): number | null {
  if (calc === 'count') return vals.length;
  if (vals.length === 0) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  switch (calc) {
    case 'sum': return sum;
    case 'avg': return sum / vals.length;
    case 'min': return Math.min(...vals);
    case 'max': return Math.max(...vals);
    case 'median': {
      const s = [...vals].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
    default: return null;
  }
}

export interface FormulaContext {
  allItems: FormulaRow[];
  columns: FormulaColumn[];
  /** 0-based index of the current item in allItems — required for relative {C}/{ref:...:@} refs */
  currentRowIndex?: number;
  /** Board the formula lives on — lets the engine resolve same-board ID refs from `allItems`/`columns`
   *  directly and tell same-board refs apart from foreign ones. */
  homeBoardId?: string;
  /** False when `allItems` is a filtered subset of the home board's groups (e.g. Personal Hub's
   *  assignee-scoped rows) rather than the complete board. A same-board group-summary ref can't
   *  be aggregated locally in that case — it must fall through to `resolveRef`, which loads the
   *  full source board. Defaults to true (a regular board render always carries every item). */
  groupsComplete?: boolean;
  /** Names the screen doing the evaluating, for tracing only — the recording bar and a saved cell
   *  run the same code over the same reference and can otherwise only be told apart by reading a
   *  stack trace. */
  traceLabel?: string;
  /** Whose Personal Hub the rows in `allItems` belong to, when they are hub rows at all. Absent
   *  means the viewer's own hub (or a plain board). A personal ref only resolves from these rows
   *  when its owner matches — otherwise it names a different person's columns and has to be
   *  loaded rather than read from what happens to be on screen. */
  hubOwnerId?: string;
  /** Resolver for refs the engine cannot satisfy locally (foreign boards, personal-hub, etc.).
   *  Return a number, `null` if the target is known but empty/non-numeric (contributes 0), or
   *  `undefined` if it cannot be resolved yet (data still loading, or the target no longer exists).
   *
   *  `forItemId` is the row currently being evaluated, which is NOT always the row the caller was
   *  built for: reading another cell's value evaluates that cell's formula, and a reference meaning
   *  "this row" inside it means THAT row. Callers must honour it over their own row, or such a
   *  reference silently answers for the wrong row. */
  resolveRef?: (ref: CellRef, forItemId?: string | null) => number | null | undefined;
  /** Called for every ref the engine could not resolve — lets the caller drive loading/error UI. */
  onUnresolvedRef?: (ref: CellRef) => void;
  /** Formula cells currently being evaluated (keyed `columnId@itemId`) — breaks reference cycles
   *  when one formula references another. Managed by the engine; callers leave it unset. */
  evaluating?: Set<string>;
  /** Group-summary results already computed during this top-level evaluation, keyed by the ref's
   *  serialized form. A summary doesn't depend on which row is asking, so one evaluation can reuse
   *  it — which is what keeps a chain of formula columns that aggregate each other from costing a
   *  full re-aggregation per row at every level. Managed by the engine; callers leave it unset. */
  summaryCache?: Map<string, number>;
  /** Set by the engine whenever a cycle guard truncated part of the current computation. Results
   *  produced under a truncation depend on where the cycle happened to close, so they are left out
   *  of `summaryCache` instead of being reused in a context that wouldn't have truncated.
   *  Managed by the engine; callers leave it unset. */
  cycleFlag?: { hit: boolean };
}

/** Sentinel `groupId` for a board-total (footer) summary ref — aggregates every item on the
 *  board rather than one group. Kept distinct from `undefined` (which means "no group ref at
 *  all") so a board-total ref round-trips through `serializeRef`/`parseRefToken` like any other. */
export const BOARD_TOTAL_GROUP_ID = '*';

/** Sentinel `groupId` for a summary picked from a Personal Hub board group. Those footers total
 *  the rows that hub shows for one board — items assigned to its owner, drawn from several groups
 *  of the source board at once — so neither a single group nor the whole board describes them.
 *  Resolving one means loading that owner's assigned items, which only the foreign resolver can
 *  do; the engine leaves it alone. */
export const HUB_ROWS_GROUP_ID = '~';

/** Parse the inner text of a `{ref:...}` token into a CellRef, or null if malformed.
 *  boardId/columnId/itemId are generated IDs (UUIDs / Firestore auto-ids) and never contain ':'. */
export function parseRefToken(inner: string): CellRef | null {
  const trimmed = inner.trim();
  if (!trimmed.startsWith('ref:')) return null;
  const parts = trimmed.split(':');
  // A 6th part is the Personal Hub owner, present only on references picked from someone else's
  // hub. Everything written before that stays exactly 5 parts and parses as it always did.
  if (parts.length !== 5 && parts.length !== 6) return null;
  const [, kind, boardId, columnId, row, owner] = parts;
  if (kind !== 'b' && kind !== 'p' && kind !== 'ph') return null;
  const ownerId = owner || undefined;
  // boardId may be empty for Personal Hub "all-groups" columns (no single owning board) and is
  // always empty for 'ph' refs (an org-wide total isn't tied to any board);
  // 'p'/'ph' refs resolve by itemId+columnId (or just columnId, for 'ph') regardless of board.
  if (!columnId || !row) return null;
  // 'ph' refs repurpose the row slot for phScope instead of an item id — they never have a real
  // item (that's the whole point of "global"), and "item"-scoped ones resolve relative to
  // whatever row the formula is being evaluated for, same idea as itemId: null for 'b'/'p'.
  if (kind === 'ph') {
    return { kind, boardId: '', columnId, itemId: null, phScope: row === 'item' ? 'item' : 'global' };
  }
  // Group-summary refs encode the row slot as `sum#<agg>#<groupId>` (Firestore ids carry no ':'/'#').
  if (row.startsWith('sum#')) {
    const [, agg, groupId] = row.split('#');
    return { kind, boardId, columnId, itemId: null, agg: agg as SummaryCalc, groupId: groupId || undefined, ownerId };
  }
  return { kind, boardId, columnId, itemId: row === '@' ? null : row, ownerId };
}

/** Serialize a CellRef back into its `{ref:...}` token form. */
export function serializeRef(ref: CellRef): string {
  if (ref.kind === 'ph') {
    return `{ref:ph::${ref.columnId}:${ref.phScope === 'item' ? 'item' : '@'}}`;
  }
  const row = ref.agg ? `sum#${ref.agg}#${ref.groupId ?? ''}` : (ref.itemId ?? '@');
  // The owner is meaningful on a personal reference (whose hub) and on a hub-rows summary (whose
  // assigned rows). On an ordinary board cell it means nothing, so it is left off entirely.
  const carriesOwner = ref.kind === 'p' || (ref.kind === 'b' && ref.groupId === HUB_ROWS_GROUP_ID);
  const owner = carriesOwner && ref.ownerId ? `:${ref.ownerId}` : '';
  return `{ref:${ref.kind}:${ref.boardId}:${ref.columnId}:${row}${owner}}`;
}

class FormulaParser {
  private pos = 0;
  private input: string;
  private values: ColumnValues;
  private context?: FormulaContext;

  constructor(input: string, values: ColumnValues, context?: FormulaContext) {
    this.input = input.trim();
    this.values = values;
    this.context = context;
  }

  parse(): number | null {
    if (!this.input) return null;
    const result = this.parseExpr();
    this.skipWs();
    if (this.pos < this.input.length) return null;
    return result;
  }

  private skipWs() {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) this.pos++;
  }

  private parseExpr(): number {
    let left = this.parseTerm();
    this.skipWs();
    while (this.pos < this.input.length && (this.input[this.pos] === '+' || this.input[this.pos] === '-')) {
      const op = this.input[this.pos++];
      const right = this.parseTerm();
      left = op === '+' ? left + right : left - right;
      this.skipWs();
    }
    return left;
  }

  private parseTerm(): number {
    let left = this.parseUnary();
    this.skipWs();
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch === '*' || ch === '/') {
        this.pos++;
        const right = this.parseUnary();
        left = ch === '*' ? left * right : right !== 0 ? left / right : 0;
      } else if (ch === '{' || ch === '(' || /[\d.]/.test(ch)) {
        // Implicit multiplication: two operands adjacent with no operator between them mean ×
        // (e.g. a clicked cell value {20} immediately followed by a typed 2 → 20 × 2 = 40).
        // A bare number like "202" is still a single literal — the boundary only appears at a
        // `{…}` token or parenthesis, never inside a run of digits.
        const right = this.parseUnary();
        left = left * right;
      } else {
        break;
      }
      this.skipWs();
    }
    return left;
  }

  private parseUnary(): number {
    this.skipWs();
    if (this.pos < this.input.length && this.input[this.pos] === '-') {
      this.pos++;
      return -this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    this.skipWs();
    if (this.pos >= this.input.length) return 0;

    if (this.input[this.pos] === '(') {
      this.pos++;
      const val = this.parseExpr();
      this.skipWs();
      if (this.input[this.pos] === ')') this.pos++;
      return val;
    }

    // {…} — ID ref like {ref:b:...}, positional cell ref like {C3}, or numeric literal like {42}
    if (this.input[this.pos] === '{') {
      this.pos++;
      const start = this.pos;
      while (this.pos < this.input.length && this.input[this.pos] !== '}') this.pos++;
      const name = this.input.slice(start, this.pos);
      if (this.input[this.pos] === '}') this.pos++;

      const trimmed = name.trim();

      // Stable ID reference: {ref:<kind>:<boardId>:<columnId>:<row>}
      if (trimmed.startsWith('ref:')) {
        const ref = parseRefToken(trimmed);
        if (!ref) return 0;
        return this.resolveStructuredRef(ref);
      }

      // Numeric literal: {42}
      const asNum = Number(trimmed);
      if (trimmed !== '' && !isNaN(asNum)) return asNum;

      // Legacy positional cell reference: {C3} (absolute) or {C} (relative to current row)
      if (this.context && /^[A-Z]+\d*$/i.test(trimmed)) {
        return this.resolveCellRef(trimmed);
      }

      // Fall back: treat as column name (legacy, no longer emitted)
      const v = this.values[trimmed];
      return v != null && !isNaN(Number(v)) ? Number(v) : 0;
    }

    // Number literal
    const numMatch = this.input.slice(this.pos).match(/^(\d+\.?\d*|\.\d+)/);
    if (numMatch) {
      this.pos += numMatch[0].length;
      return parseFloat(numMatch[0]);
    }

    return 0;
  }

  /** Resolve a stable-ID ref: same-board refs are satisfied from local context; anything
   *  else is delegated to context.resolveRef. Unresolved refs contribute 0 and are reported. */
  private resolveStructuredRef(ref: CellRef): number {
    const ctx = this.context;
    // Same-board refs (either kind) resolve from local context: on a regular board `allItems`
    // carry item.values; in the Personal Hub the pseudo-rows carry personalItemValues.
    // A cross-group personal grid spans every board, so it names none — and its refs are
    // serialized with that same empty board. For 'p' refs, then, "home" is the two matching
    // exactly, empty included; requiring a non-empty board id would strand every cross-group
    // personal reference, leaving it to a resolver that can't see the grid it came from.
    const isHome = ref.kind === 'p'
      ? !!ctx && ref.boardId === (ctx.homeBoardId ?? '') && (ref.ownerId ?? '') === (ctx.hubOwnerId ?? '')
      : !!ctx?.homeBoardId && ref.boardId === ctx.homeBoardId;
    // A whole-hub personal total spans every board, so it names no board for homeBoardId to
    // match — but a cross-group personal grid holds exactly those rows, so resolve it right here
    // when the column belongs to this grid. Board-scoped personal summaries deliberately do NOT
    // qualify: `allItems` would be every board's rows, not the one board asked for, so they go
    // through isHome (the board-scoped grid) or fall through to the resolver.
    const isLocalPersonalSummary =
      ref.kind === 'p' && !!ref.agg && ref.groupId === BOARD_TOTAL_GROUP_ID &&
      (ref.ownerId ?? '') === (ctx?.hubOwnerId ?? '') &&
      !!ctx?.columns.some((c) => c.id === ref.columnId);

    if (ref.kind === 'b' && !ref.agg) {
      sameColumnTrace('1. engine sees reference', {
        where: ctx?.traceLabel ?? '(unlabelled)',
        token: serializeRef(ref),
        isHome,
        homeBoardId: ctx?.homeBoardId,
        rowsOnScreen: ctx?.allItems.length,
        hasLoader: !!ctx?.resolveRef,
      });
    }

    if (isHome || isLocalPersonalSummary) {
      const local = this.resolveLocalById(ref);
      if (local !== undefined) return local;
      formulaRefLog(serializeRef(ref), 'unresolved',
        'not answerable from the rows on screen — handing it to the loader',
        { homeBoardId: ctx?.homeBoardId, rowsOnScreen: ctx?.allItems.length });
    }

    if (ctx?.resolveRef) {
      // The row being evaluated right now — which differs from the caller's own row whenever this
      // evaluation descended into another cell's formula.
      const currentRowId = ctx.currentRowIndex !== undefined
        ? ctx.allItems[ctx.currentRowIndex]?.id
        : undefined;
      const v = ctx.resolveRef(ref, currentRowId);
      if (v !== undefined) return v ?? 0;
    }

    ctx?.onUnresolvedRef?.(ref);
    return 0;
  }

  /** Resolve a same-board ID ref from allItems/columns. Returns undefined when it cannot be
   *  satisfied locally (unknown column/item, non-number column, or missing row id for absolute refs). */
  private resolveLocalById(ref: CellRef): number | undefined {
    const ctx = this.context;
    if (!ctx) return undefined;

    if (ref.agg) return ctx.groupsComplete === false ? undefined : this.resolveLocalSummary(ref);

    const col = ctx.columns.find((c) => c.id === ref.columnId);
    if (!col) {
      sameColumnTrace('2. HANDS TO LOADER — that column is not among the columns on screen', {
        wantedColumnId: ref.columnId, columnsOnScreen: ctx.columns.length,
      });
      return undefined;
    }
    sameColumnTrace('2. found the column', { columnId: col.id, type: col.type });
    // A reference to another formula cell resolves to its live computed value.
    if (col.type === ColumnType.SIMPLE_FORMULA) return this.resolveLocalFormula(ref, col);
    if (col.type !== ColumnType.NUMBER && col.type !== ColumnType.HOURS_LOG) {
      sameColumnTrace('3. HANDS TO LOADER — column is neither a number nor a formula', { type: col.type });
      return undefined;
    }

    let item: FormulaRow | undefined;
    if (ref.itemId === null) {
      if (ctx.currentRowIndex === undefined) return undefined;
      item = ctx.allItems[ctx.currentRowIndex];
    } else {
      item = ctx.allItems.find((it) => it.id === ref.itemId);
    }
    if (!item) return undefined;

    const val = item.values[col.id];
    // An HOURS_LOG cell's numeric value is its running total, in decimal hours (e.g. 16:15 -> 16.25)
    // — the natural unit for a formula like {ref} * hourlyRate.
    if (col.type === ColumnType.HOURS_LOG) {
      return sumHoursLogMinutes(Array.isArray(val) ? (val as HoursLogEntry[]) : []) / 60;
    }
    return val != null && !isNaN(Number(val)) ? Number(val) : 0;
  }

  /** Resolve a reference to another SIMPLE_FORMULA cell to its live value by evaluating that
   *  cell's formula in the referenced row's context. `context.evaluating` tracks the formula
   *  cells on the current evaluation stack so a reference cycle (A → B → A) is broken by
   *  contributing 0 at the point it closes, instead of recursing forever. */
  private resolveLocalFormula(ref: CellRef, col: FormulaColumn): number | undefined {
    const ctx = this.context;
    if (!ctx) return undefined;

    let idx: number;
    if (ref.itemId === null) {
      if (ctx.currentRowIndex === undefined) {
        sameColumnTrace('3. GIVES UP — relative reference with no current row', { columnId: col.id });
        return undefined;
      }
      idx = ctx.currentRowIndex;
    } else {
      idx = ctx.allItems.findIndex((it) => it.id === ref.itemId);
      if (idx < 0) {
        sameColumnTrace('3. HANDS TO LOADER — that row is not among the rows on screen', {
          wantedItemId: ref.itemId, rowsOnScreen: ctx.allItems.length,
        });
        return undefined;
      }
    }
    const item = ctx.allItems[idx];
    if (!item) {
      sameColumnTrace('3. HANDS TO LOADER — no row at that position', { idx });
      return undefined;
    }

    // The cell's own override formula (a string in values) or the column's default.
    const stored = item.values[col.id];
    const settings = col.settings as { defaultFormula?: string } | undefined;
    const formula = typeof stored === 'string' ? stored : (settings?.defaultFormula ?? '');
    sameColumnTrace('3. found the referenced cell', {
      itemId: item.id,
      rowIndex: idx,
      storedType: typeof stored,
      storedValue: stored,
      columnDefault: settings?.defaultFormula ?? '(none)',
      formulaItWillUse: formula || '(empty)',
    });
    if (!formula.trim()) {
      sameColumnTrace('4. RETURNS 0 — that cell has no formula of its own and the column has no default', {
        itemId: item.id, columnId: col.id,
      });
      return 0;
    }

    const key = `${col.id}@${item.id ?? idx}`;
    const evaluating = ctx.evaluating ?? new Set<string>();
    if (evaluating.has(key)) {
      this.markCycle();
      formulaRefLog(serializeRef(ref), 'empty',
        'circular: that formula cell is already being computed further up this same evaluation',
        { columnId: col.id, itemId: item.id, alreadyEvaluating: [...evaluating] });
      return 0; // cycle — stop here
    }
    const nextEvaluating = new Set(evaluating);
    nextEvaluating.add(key);

    const r = evaluateFormula(formula, {}, { ...ctx, currentRowIndex: idx, evaluating: nextEvaluating });
    sameColumnTrace('4. evaluated that cell', { itemId: item.id, result: r, returning: r ?? 0 });
    return r ?? 0;
  }

  /** Aggregate a column across one group from local context. */
  private resolveLocalSummary(ref: CellRef): number | undefined {
    const ctx = this.context;
    if (!ctx || !ref.agg) return undefined;
    // A hub-rows summary depends on who is assigned what, which isn't in this context.
    if (ref.groupId === HUB_ROWS_GROUP_ID) return undefined;
    const col = ctx.columns.find((c) => c.id === ref.columnId);
    if (!col) return undefined;

    const cacheKey = serializeRef(ref);
    const cached = ctx.summaryCache?.get(cacheKey);
    if (cached !== undefined) return cached;

    // Board summaries aggregate one group; a board-total ref (BOARD_TOTAL_GROUP_ID) aggregates
    // every item on the board; Personal Hub summaries aggregate the whole table (its rows are
    // already the one board's items — personal rows carry no board groupId).
    const rows =
      ref.kind === 'p' || ref.groupId === BOARD_TOTAL_GROUP_ID
        ? ctx.allItems
        : ctx.allItems.filter((it) => it.groupId === ref.groupId);

    if (col.type !== ColumnType.SIMPLE_FORMULA) {
      const plain = computeSummaryNumeric(rows, col.type, col.id, ref.agg) ?? 0;
      ctx.summaryCache?.set(cacheKey, plain);
      return plain;
    }

    // Aggregating a formula column means evaluating every row's formula. That can loop back
    // here — a formula cell whose own column is the one being aggregated, directly or through
    // another formula. So the summary itself joins the `evaluating` guard set: re-entering the
    // same summary while it is being computed contributes 0 and the chain terminates, the same
    // way a cell-to-cell reference cycle is broken in resolveLocalFormula.
    const summaryKey = `agg@${cacheKey}`;
    const evaluating = ctx.evaluating ?? new Set<string>();
    if (evaluating.has(summaryKey)) {
      this.markCycle();
      return 0;
    }
    const guard = new Set(evaluating);
    guard.add(summaryKey);

    // Only a cycle-free result is worth remembering: one produced under a truncation reflects
    // where that cycle closed, which a later caller outside the cycle wouldn't reproduce.
    const flag = ctx.cycleFlag;
    const outerHit = flag?.hit ?? false;
    if (flag) flag.hit = false;

    const result = computeSummaryNumeric(rows, col.type, col.id, ref.agg, undefined, (row) =>
      this.evaluateRowFormula(col, row, guard),
    ) ?? 0;

    if (flag) {
      if (!flag.hit) ctx.summaryCache?.set(cacheKey, result);
      flag.hit = flag.hit || outerHit;
    }
    return result;
  }

  /** Records that a cycle guard truncated the computation in progress — see FormulaContext.cycleFlag. */
  private markCycle() {
    if (this.context?.cycleFlag) this.context.cycleFlag.hit = true;
  }

  /** Live value of one row's cell in a SIMPLE_FORMULA column, or null when that row has no
   *  formula at all (so it stays out of an aggregate rather than counting as 0). `evaluating`
   *  carries the cycle guard down from the caller. */
  private evaluateRowFormula(col: FormulaColumn, row: FormulaRow, evaluating: Set<string>): number | null {
    const ctx = this.context;
    if (!ctx) return null;

    const stored = row.values[col.id];
    const settings = col.settings as { defaultFormula?: string } | undefined;
    const formula = typeof stored === 'string' ? stored : (settings?.defaultFormula ?? '');
    if (!formula.trim()) return null;

    const idx = ctx.allItems.indexOf(row);
    const key = `${col.id}@${row.id ?? idx}`;
    if (evaluating.has(key)) { this.markCycle(); return 0; } // cycle — stop here
    const nextEvaluating = new Set(evaluating);
    nextEvaluating.add(key);

    return evaluateFormula(formula, {}, {
      ...ctx,
      currentRowIndex: idx >= 0 ? idx : undefined,
      evaluating: nextEvaluating,
    });
  }

  private resolveCellRef(cellRef: string): number {
    if (!this.context) return 0;

    // {C3} = absolute (column C, row 3); {C} = relative (column C, current row)
    const absMatch = cellRef.match(/^([A-Z]+)(\d+)$/i);
    const relMatch = !absMatch ? cellRef.match(/^([A-Z]+)$/i) : null;
    if (!absMatch && !relMatch) return 0;

    const colLetter = (absMatch ? absMatch[1] : relMatch![1]).toUpperCase();
    const colIndex = this.colLetterToIndex(colLetter);
    if (colIndex < 0 || colIndex >= this.context.columns.length + 1) return 0;
    if (colIndex === 0) return 0; // Column A is the Name — not numeric

    let rowIndex: number;
    if (absMatch) {
      rowIndex = parseInt(absMatch[2], 10) - 1; // 1-based → 0-based
    } else {
      if (this.context.currentRowIndex === undefined) return 0;
      rowIndex = this.context.currentRowIndex;
    }
    if (rowIndex < 0 || rowIndex >= this.context.allItems.length) return 0;

    const item = this.context.allItems[rowIndex];
    if (!item) return 0;

    // Column B is columns[0], Column C is columns[1], etc.
    const col = this.context.columns[colIndex - 1];
    if (!col || col.type !== ColumnType.NUMBER) return 0;

    const val = item.values[col.id];
    return val != null && !isNaN(Number(val)) ? Number(val) : 0;
  }

  private colLetterToIndex(letter: string): number {
    let index = 0;
    for (let i = 0; i < letter.length; i++) {
      index = index * 26 + (letter.charCodeAt(i) - 64); // A=1, B=2, ..., Z=26
    }
    return index - 1; // Convert to 0-based
  }
}

export function evaluateFormula(
  formula: string,
  columnValues: ColumnValues,
  context?: FormulaContext,
): number | null {
  if (!formula || !formula.trim()) return null;
  try {
    // The summary memo and its cycle flag live for one top-level evaluation: created here when a
    // caller supplies neither, and carried down untouched by the engine's own nested evaluations
    // (which spread the context they were given).
    const ctx: FormulaContext | undefined = context && {
      ...context,
      summaryCache: context.summaryCache ?? new Map<string, number>(),
      cycleFlag: context.cycleFlag ?? { hit: false },
    };
    const parser = new FormulaParser(formula, columnValues, ctx);
    const result = parser.parse();
    if (result === null || !isFinite(result) || isNaN(result)) return null;
    return result;
  } catch {
    return null;
  }
}

/** All stable-ID references in a formula (legacy positional refs are not returned — they carry
 *  no board/column/item identity). Used for foreign-data loading and dependency tracking. */
export function extractRefs(formula: string): CellRef[] {
  const refs: CellRef[] = [];
  const re = /\{(ref:[^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula)) !== null) {
    const ref = parseRefToken(m[1]);
    if (ref) refs.push(ref);
  }
  return refs;
}

/** References that may need a fetch beyond the local `allItems`/`visibleItems` array: cross-board
 *  refs always do, and same-board refs are included too, because a same-board ref can point at a
 *  subitem — `allItems` is built from a board's top-level items only, so subitem rows aren't in it.
 *  `resolveStructuredRef` always tries local resolution first, so requesting this fetch for a
 *  same-board ref that *does* resolve locally is just unused fallback data, never a correctness issue. */
export function extractForeignRefs(formula: string): CellRef[] {
  return extractRefs(formula);
}

/** Convert a legacy positional formula ({C3}/{C}) into stable-ID refs. Runs on the origin
 *  board at edit-start, where column order + item order are known. Idempotent: existing
 *  {ref:...} tokens, numeric literals, and unconvertible tokens are left untouched.
 *  Column letters map A=Name, B=columns[0], C=columns[1], …; row numbers are 1-based into `items`. */
export function convertLegacyToIdRefs(
  formula: string,
  opts: { boardId: string; kind?: 'b' | 'p'; columns: { id: string }[]; items: { id: string }[] },
): string {
  const { boardId, kind = 'b', columns, items } = opts;
  const colIdForLetter = (letter: string): string | null => {
    let idx = 0;
    for (let i = 0; i < letter.length; i++) idx = idx * 26 + (letter.toUpperCase().charCodeAt(i) - 64);
    // idx is 1-based (A=1). Column A is the Name; B(=2)→columns[0], so columns[idx-2].
    const colArrIndex = idx - 2;
    if (colArrIndex < 0 || colArrIndex >= columns.length) return null;
    return columns[colArrIndex].id;
  };

  return formula.replace(/\{([^}]*)\}/g, (whole, inner: string) => {
    const t = inner.trim();
    if (t.startsWith('ref:')) return whole; // already an ID ref
    if (t !== '' && !isNaN(Number(t))) return whole; // numeric literal

    const abs = t.match(/^([A-Za-z]+)(\d+)$/); // {C3}
    if (abs) {
      const colId = colIdForLetter(abs[1]);
      const item = items[parseInt(abs[2], 10) - 1];
      if (colId && item) return serializeRef({ kind, boardId, columnId: colId, itemId: item.id });
      return whole;
    }
    const rel = t.match(/^([A-Za-z]+)$/); // {C} — relative to current row
    if (rel) {
      const colId = colIdForLetter(rel[1]);
      if (colId) return serializeRef({ kind, boardId, columnId: colId, itemId: null });
      return whole;
    }
    return whole;
  });
}

/**
 * True when a formula still addresses a cell by absolute grid position ({C3}) rather than by
 * stable id. Those only mean the right cell if the rows are in exactly the order the formula was
 * written against, so a caller reproducing a table from scratch (rather than reading the one on
 * screen) should decline to evaluate them instead of risking a plausible-looking wrong number.
 * Row-relative positions ({C}) are unaffected — they resolve within whichever row is being
 * evaluated, whatever the order.
 */
export function hasAbsolutePositionalRefs(formula: string): boolean {
  const re = /\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula)) !== null) {
    if (/^[A-Za-z]+\d+$/.test(m[1].trim())) return true;
  }
  return false;
}

/** Relativize same-board refs (itemId → '@') so a formula can serve as a column-wide default,
 *  matching the legacy makeRelativeFormula behavior. Foreign refs stay absolute.
 *
 *  `selfColumnId` is the column the formula is becoming the default for. A reference into that
 *  same column must NOT be relativized: "that cell" would turn into "this row's cell", which is
 *  the cell being computed — every row would reference itself, the cycle guard would break it,
 *  and the term would silently contribute 0. Such a reference stays pointed at the exact cell
 *  that was picked. */
export function makeRelativeIdFormula(formula: string, homeBoardId: string, selfColumnId?: string): string {
  return formula.replace(/\{(ref:[^}]*)\}/g, (whole, inner: string) => {
    const ref = parseRefToken(inner);
    if (!ref) return whole;
    if (selfColumnId && ref.columnId === selfColumnId && !ref.agg) return whole;
    // Make same-table references row-relative so the formula fills down correctly. This applies
    // to board ('b') and Personal Hub ('p') cells alike — a personal same-table ref is home when
    // its boardId matches. Cross-board/foreign refs (different boardId) and group-summary refs
    // (already row-agnostic) are left untouched. resolveLocalById handles relative refs of either
    // kind identically via currentRowIndex, so this is safe.
    if (!ref.agg && ref.boardId === homeBoardId) {
      return serializeRef({ ...ref, itemId: null });
    }
    return whole;
  });
}

export function extractColumnRefs(formula: string): string[] {
  const refs: string[] = [];
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula)) !== null) {
    refs.push(m[1]);
  }
  return refs;
}
