import ExcelJS from 'exceljs';
import { ColumnType } from '../types';
import type { StatusOption } from '../types';
import * as wm from '../services/workManagementService';
import { getUsers } from '../services/geminiService';
import type { User } from '../types';

export interface ImportResult {
  boardId: string;
  boardName: string;
  groupCount: number;
  itemCount: number;
  subitemCount?: number;
  warnings?: string[];
}

// ── Raw cell value helpers ────────────────────────────────────────────────────
// (a subset of these is also used by importBoardFromMondayXlsx.ts, which parses
// a differently-structured export from Monday.com rather than this app's own.)

export type RawCell = ExcelJS.CellValue | null | undefined;

export function cellToText(val: RawCell): string {
  if (val == null) return '';
  if (val instanceof Date) return val.toLocaleDateString();
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if ('error' in obj) return '';
    if ('richText' in obj) {
      return (obj.richText as Array<{ text: string }>).map((r) => r.text).join('');
    }
    if ('result' in obj) return cellToText(obj.result as RawCell);
    if ('text' in obj) return String(obj.text);
    return String(val);
  }
  return String(val);
}

// Returns an ISO date string (YYYY-MM-DD) for date cells, empty string otherwise.
export function cellToDateIso(val: RawCell): string {
  if (val == null) return '';
  if (val instanceof Date) return val.toISOString().split('T')[0];
  const text = cellToText(val).trim();
  if (!text) return '';
  // Try YYYY-MM-DD first, then common locale formats like DD/MM/YYYY
  const iso = new Date(text);
  if (!isNaN(iso.getTime())) return iso.toISOString().split('T')[0];
  // DD/MM/YYYY → YYYY-MM-DD
  const parts = text.split('/');
  if (parts.length === 3) {
    const [d, m, y] = parts;
    const parsed = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
  }
  return text; // keep as-is if unparseable
}

export function parseRows(sheet: ExcelJS.Worksheet): RawCell[][] {
  const rows: RawCell[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const vals = (row.values as RawCell[]) || [];
    const cells: RawCell[] = [];
    for (let i = 1; i < vals.length; i++) cells.push(vals[i] ?? null);
    rows.push(cells);
  });
  return rows;
}

// Converts ExcelJS ARGB string (e.g. "FF6366F1") to a CSS hex color ("#6366f1").
function argbToHex(argb: string | undefined): string | undefined {
  if (!argb || argb.length < 8) return undefined;
  return `#${argb.slice(2).toLowerCase()}`;
}

// Header row background color used by the source app (the row directly below
// a group name, containing "Name" + column headers).
const HEADER_GRAY_HEX = 'D6D6D6';

// Returns true if the cell has a solid fill matching the header gray used to
// mark the header row (the row right below a group name).
function isHeaderGrayCell(cell: ExcelJS.Cell): boolean {
  const fill = cell.fill;
  if (!fill || fill.type !== 'pattern' || fill.pattern === 'none') return false;
  const argb = (fill as ExcelJS.FillPattern).fgColor?.argb;
  if (!argb || argb.length < 8) return false;
  return argb.slice(2).toUpperCase() === HEADER_GRAY_HEX;
}

// Scans column A starting at `fromRowIndex` (0-based, into `rows`) for the
// first gray header cell. Returns its row index, or -1 if none found.
function findFirstHeaderGrayRow(sheet: ExcelJS.Worksheet, fromRowIndex: number, maxRowIndex: number): number {
  for (let r = fromRowIndex; r <= maxRowIndex; r++) {
    // rows array is 0-indexed; sheet rows are 1-indexed.
    if (isHeaderGrayCell(sheet.getRow(r + 1).getCell(1))) return r;
  }
  return -1;
}

// Returns the ARGB string if the cell has a solid colored fill that looks like
// a status indicator (excludes white, near-white, light-gray row stripes, and
// the light header background used by this app's export).
function getCellStatusArgb(cell: ExcelJS.Cell): string | null {
  const fill = cell.fill;
  if (!fill || fill.type !== 'pattern' || fill.pattern === 'none') return null;
  const argb = (fill as ExcelJS.FillPattern).fgColor?.argb;
  if (!argb || argb.length < 8) return null;
  const hex = argb.slice(2).toUpperCase();
  // Skip transparent / white / alternating-row gray / header gray / empty-status placeholder gray
  const excluded = new Set(['FFFFFF', 'EFEFEF', 'D9D9D9', 'C4C4C4', '000000']);
  if (excluded.has(hex)) return null;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (r * 299 + g * 587 + b * 114) / 1000;
  if (luminance > 230) return null; // very light = not a status color
  return argb;
}

// Fallback options for a STATUS column whose source had no status ever set
// (every cell was the empty-status placeholder gray). Mirrors the default
// options used elsewhere in the app when creating a fresh STATUS column.
const DEFAULT_STATUS_OPTIONS: StatusOption[] = [
  { id: 'todo', label: 'To Do', color: '#94a3b8' },
  { id: 'inprogress', label: 'In Progress', color: '#6366f1' },
  { id: 'done', label: 'Done', color: '#22c55e' },
];

const EMPTY_STATUS_PLACEHOLDER_HEX = 'C4C4C4';

// Returns true if the cell's fill is the "no status set" placeholder gray
// (used by source boards to mark a STATUS cell with no option selected).
function isEmptyStatusPlaceholderCell(cell: ExcelJS.Cell): boolean {
  const fill = cell.fill;
  if (!fill || fill.type !== 'pattern' || fill.pattern === 'none') return false;
  const argb = (fill as ExcelJS.FillPattern).fgColor?.argb;
  if (!argb || argb.length < 8) return false;
  return argb.slice(2).toUpperCase() === EMPTY_STATUS_PLACEHOLDER_HEX;
}

// Returns true if the cell's font color is white (or near-white).
// Status cells in this app's export always use white text, so this is the
// most reliable signal that a column is a STATUS column.
function cellHasWhiteText(cell: ExcelJS.Cell): boolean {
  const argb = cell.font?.color?.argb;
  if (!argb || argb.length < 8) return false;
  const hex = argb.slice(2).toUpperCase();
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (r * 299 + g * 587 + b * 114) / 1000;
  return luminance > 200; // white or near-white font
}

// ── Column spec ───────────────────────────────────────────────────────────────

interface ColumnSpec {
  name: string;
  type: ColumnType;
  /** Indices into the item's rawCells array (0 = first column after Name). */
  rawIndices: number[];
}

const START_SUFFIX = ' - Start';
const END_SUFFIX = ' - End';
const PERSON_HEADERS = new Set(['person', 'people', 'user']);

export function isUrlLike(text: string): boolean {
  return /^https?:\/\//i.test(text) || /^www\./i.test(text);
}

// Matches plain numbers, optionally negative, with an optional decimal part
// and optional thousands separators (e.g. "1,234.5", "-42", "3.14").
export function isNumberLike(text: string): boolean {
  return /^-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(text) || /^-?\d+(\.\d+)?$/.test(text);
}

function buildColumnSpecs(headers: string[]): ColumnSpec[] {
  const specs: ColumnSpec[] = [];
  let i = 0;
  while (i < headers.length) {
    const h = headers[i];
    if (i + 1 < headers.length && h.endsWith(START_SUFFIX)) {
      const base = h.slice(0, -START_SUFFIX.length);
      if (headers[i + 1] === `${base}${END_SUFFIX}`) {
        specs.push({ name: base, type: ColumnType.TIME_RANGE, rawIndices: [i, i + 1] });
        i += 2;
        continue;
      }
    }
    if (PERSON_HEADERS.has(h.toLowerCase())) {
      specs.push({ name: h, type: ColumnType.PERSON, rawIndices: [i] });
    } else {
      specs.push({ name: h, type: ColumnType.TEXT, rawIndices: [i] });
    }
    i++;
  }
  return specs;
}

// Builds a stable option id from a label string.
export function labelToOptionId(label: string): string {
  const slug = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  return slug || `opt_${Math.random().toString(36).slice(2, 7)}`;
}

// Fetches all users for a workspace and returns a case-insensitive name → id map.
export async function buildUserNameMap(workspaceId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let cursor: string | null = null;
  do {
    const page = await getUsers({ workspaceId, limit: 200, ...(cursor ? { cursor } : {}) });
    for (const u of page.data as User[]) {
      if (u.name) map.set(u.name.toLowerCase().trim(), u.id);
    }
    cursor = page.cursor;
  } while (cursor);
  return map;
}

// ── Main export ───────────────────────────────────────────────────────────────

// Detects a Monday.com board export: its header row always starts with the
// literal columns "Name", "Subitems" (a rollup/mirror column this app's own
// export never produces). Scanned across the first few rows since row 1 is
// the board name and row 2 the first group name, not the header itself.
function isMondayFormat(rows: RawCell[][]): boolean {
  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    const row = rows[r] ?? [];
    if (cellToText(row[0]).trim() === 'Name' && cellToText(row[1]).trim() === 'Subitems') return true;
  }
  return false;
}

export async function importBoardFromXlsx(
  file: File,
  workspaceId: string,
): Promise<ImportResult> {
  const userNameMap = await buildUserNameMap(workspaceId);

  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('No worksheet found in file.');

  const rows = parseRows(sheet);

  if (isMondayFormat(rows)) {
    const { importMondayRows } = await import('./importBoardFromMondayXlsx');
    return importMondayRows(rows, workspaceId, userNameMap);
  }

  // Row 1: board name
  const boardName = cellToText(rows[0]?.[0]).trim() || 'Imported Board';

  // Detect whether a description exists by locating the first group's header
  // row (the gray row directly below the first group name) in column A. The
  // row directly above that gray header row is always the first group name —
  // its position varies depending on whether a description row is present.
  const firstHeaderRow = findFirstHeaderGrayRow(sheet, 1, rows.length - 1);
  const firstGroupNameRow = firstHeaderRow >= 0 ? firstHeaderRow - 1 : 1;

  let cursor = 1;
  let description: string | undefined;
  if (firstGroupNameRow > 1) {
    const possibleDesc = cellToText(rows[cursor]?.[0]).trim();
    if (possibleDesc) description = possibleDesc;
    cursor = firstGroupNameRow;
  }

  // ── Parse group blocks ─────────────────────────────────────────────────────

  interface ParsedItem {
    name: string;
    rawCells: RawCell[];
    // Per-column ARGB fill color (null if no colored fill). Indexed parallel to
    // rawCells.slice(1) — i.e. cellArgbs[0] corresponds to the first data column.
    cellArgbs: (string | null)[];
  }

  interface ParsedGroup {
    name: string;
    color?: string;
    items: ParsedItem[];
  }

  const parsedGroups: ParsedGroup[] = [];
  let columnSpecs: ColumnSpec[] = [];

  // colorMap[specIndex] maps ARGB → first label seen for that color.
  // Populated while scanning item rows; used after scanning to build STATUS options.
  let colorMap: Map<string, string>[] = [];
  // colHasWhiteText[specIndex] — true if any item cell in this column had white text.
  // White text is the reliable indicator that a column is a STATUS column.
  let colHasWhiteText: boolean[] = [];
  // colHasEmptyStatusPlaceholder[specIndex] — true if any item cell in this column
  // used the "no status set" placeholder gray. A column made up entirely of such
  // cells (no status ever selected) has no colored options to detect, but is
  // still a STATUS column — it must not be downgraded to TEXT.
  let colHasEmptyStatusPlaceholder: boolean[] = [];
  // colAllValuesUrlLike[specIndex] — true if every non-empty TEXT cell in this column looks like a URL.
  let colAllValuesUrlLike: boolean[] = [];
  // colAllValuesNumberLike[specIndex] — true if every non-empty TEXT cell in this column looks like a plain number.
  let colAllValuesNumberLike: boolean[] = [];
  let colHasAnyValue: boolean[] = [];

  while (cursor < rows.length) {
    const groupName = cellToText(rows[cursor]?.[0]).trim();
    if (!groupName) { cursor++; continue; }
    // Read the font color from the original sheet cell (cursor is 0-indexed; sheet rows are 1-indexed)
    const groupColor = argbToHex(sheet.getRow(cursor + 1).getCell(1).font?.color?.argb);
    cursor++;

    // Headers row: cell 0 = "Name", cells 1+ = column names
    const headerRow = rows[cursor] ?? [];
    cursor++;
    const headerNames = headerRow.slice(1).map((c) => cellToText(c).trim()).filter(Boolean);
    if (!columnSpecs.length && headerNames.length) {
      columnSpecs = buildColumnSpecs(headerNames);
      colorMap = columnSpecs.map(() => new Map<string, string>());
      colHasWhiteText = columnSpecs.map(() => false);
      colHasEmptyStatusPlaceholder = columnSpecs.map(() => false);
      colAllValuesUrlLike = columnSpecs.map(() => true);
      colAllValuesNumberLike = columnSpecs.map(() => true);
      colHasAnyValue = columnSpecs.map(() => false);
    }

    // Item rows until empty row
    const items: ParsedItem[] = [];
    while (cursor < rows.length) {
      const itemName = cellToText(rows[cursor]?.[0]).trim();
      if (!itemName) break;

      const rawCells = rows[cursor] ?? [];
      // rows[cursor] → sheet row cursor+1 (1-indexed).
      // Data columns start at sheet column 2 (column A is item name).
      const sheetRow = sheet.getRow(cursor + 1);
      const cellArgbs: (string | null)[] = columnSpecs.map((spec) => {
        // spec.rawIndices[0] is 0-based index into rawCells.slice(1),
        // so sheet column index = spec.rawIndices[0] + 2.
        const cell = sheetRow.getCell(spec.rawIndices[0] + 2);
        return getCellStatusArgb(cell);
      });

      // Populate colorMap, colHasWhiteText, and URL tracking for each column
      columnSpecs.forEach((spec, si) => {
        const sheetCell = sheetRow.getCell(spec.rawIndices[0] + 2);
        if (cellHasWhiteText(sheetCell)) colHasWhiteText[si] = true;
        if (isEmptyStatusPlaceholderCell(sheetCell)) colHasEmptyStatusPlaceholder[si] = true;
        const argb = cellArgbs[si];
        if (argb && !colorMap[si].has(argb)) {
          const label = cellToText(rawCells[spec.rawIndices[0] + 1]).trim();
          // A colored cell with no text is an unset/empty status, not a real option.
          if (label) colorMap[si].set(argb, label);
        }
        if (spec.type === ColumnType.TEXT) {
          const text = cellToText(rawCells[spec.rawIndices[0] + 1]).trim();
          if (text) {
            colHasAnyValue[si] = true;
            if (!isUrlLike(text)) colAllValuesUrlLike[si] = false;
            if (!isNumberLike(text)) colAllValuesNumberLike[si] = false;
          }
        }
      });

      items.push({ name: itemName, rawCells, cellArgbs });
      cursor++;
    }
    cursor++; // skip empty spacer

    parsedGroups.push({ name: groupName, color: groupColor, items });
  }

  if (!parsedGroups.length) throw new Error('No groups found in file.');

  // ── Detect STATUS columns and build their options ─────────────────────────
  // A column is STATUS if at least one cell has a recognisable colored fill.
  // TIME_RANGE columns are never re-typed (they were explicitly detected by header).

  interface StatusColInfo {
    options: StatusOption[];
    argbToOptionId: Map<string, string>;
  }

  const statusInfoBySpec: (StatusColInfo | null)[] = columnSpecs.map((spec, si) => {
    if (spec.type === ColumnType.TIME_RANGE) return null;
    if (!colHasWhiteText[si] && !colHasEmptyStatusPlaceholder[si]) return null;

    const options: StatusOption[] = [];
    const argbToOptionId = new Map<string, string>();

    for (const [argb, label] of colorMap[si].entries()) {
      const id = labelToOptionId(label) || `opt_${options.length}`;
      const color = `#${argb.slice(2).toLowerCase()}`;
      options.push({ id, label, color });
      argbToOptionId.set(argb, id);
    }

    // A column flagged by white text but with no surviving colored options and
    // no empty-status placeholder cells (e.g. only stray white text elsewhere)
    // isn't a real STATUS column.
    if (!options.length && !colHasEmptyStatusPlaceholder[si]) return null;

    // Every item had no status set (all cells were the empty-status placeholder),
    // so no real options were detected. The backend requires STATUS columns to
    // have a non-empty options list, so seed it with sensible defaults — the
    // imported items themselves stay unset since argbToOptionId has no entries.
    if (!options.length) options.push(...DEFAULT_STATUS_OPTIONS);

    return { options, argbToOptionId };
  });

  // Promote TEXT columns whose every non-empty value looks like a URL to LINK.
  columnSpecs.forEach((spec, si) => {
    if (spec.type === ColumnType.TEXT && colHasAnyValue[si] && colAllValuesUrlLike[si]) {
      columnSpecs[si] = { ...spec, type: ColumnType.LINK };
    }
  });

  // Promote remaining TEXT columns whose every non-empty value looks like a plain number to NUMBER.
  columnSpecs.forEach((spec, si) => {
    if (spec.type === ColumnType.TEXT && colHasAnyValue[si] && colAllValuesNumberLike[si]) {
      columnSpecs[si] = { ...spec, type: ColumnType.NUMBER };
    }
  });

  // ── Create board ───────────────────────────────────────────────────────────
  const board = await wm.createBoard({ name: boardName, description, workspaceId });

  // ── Create columns and fix ordering ───────────────────────────────────────
  const createdCols: Array<{ id: string; spec: ColumnSpec; statusInfo: StatusColInfo | null }> = [];
  for (let si = 0; si < columnSpecs.length; si++) {
    const spec = columnSpecs[si];
    const statusInfo = statusInfoBySpec[si];

    const colType = statusInfo ? ColumnType.STATUS : spec.type;
    const settings = statusInfo ? { options: statusInfo.options } : undefined;

    const col = await wm.createColumn(board.id, {
      name: spec.name,
      type: colType,
      ...(settings ? { settings } : {}),
    });
    createdCols.push({ id: col.id, spec: { ...spec, type: colType }, statusInfo });
  }
  if (createdCols.length > 0) {
    await wm.reorderColumns(board.id, createdCols.map((c, i) => ({ id: c.id, order: i })));
  }

  // ── Create groups and items ────────────────────────────────────────────────
  let totalItems = 0;
  for (let gi = 0; gi < parsedGroups.length; gi++) {
    const pg = parsedGroups[gi];
    const group = await wm.createGroup(board.id, { name: pg.name, order: gi, color: pg.color });

    for (let ii = 0; ii < pg.items.length; ii++) {
      const item = pg.items[ii];
      // rawCells[0] = item name, rawCells[1+] = column values
      const rawValues = item.rawCells.slice(1);

      const values: Record<string, unknown> = {};
      for (let ci = 0; ci < createdCols.length; ci++) {
        const { id, spec, statusInfo } = createdCols[ci];

        if (spec.type === ColumnType.TIME_RANGE) {
          const startIso = cellToDateIso(rawValues[spec.rawIndices[0]]);
          const endIso = cellToDateIso(rawValues[spec.rawIndices[1]]);
          if (startIso || endIso) {
            const startMs = startIso ? new Date(startIso).getTime() : NaN;
            const endMs = endIso ? new Date(endIso).getTime() : NaN;
            const durMs = endMs - startMs;
            // Inclusive day count: same-day span is 1 day, start → start+1 day is 2, etc.
            const durationDays = !isNaN(durMs) && durMs >= 0 ? Math.round(durMs / 86_400_000) + 1 : undefined;
            values[id] = { start: startIso, end: endIso, ...(durationDays !== undefined ? { durationDays } : {}) };
          }
        } else if (statusInfo) {
          // Match by fill color first (most reliable), then fall back to text label match.
          const argb = item.cellArgbs[ci];
          let optionId: string | undefined;
          if (argb) {
            optionId = statusInfo.argbToOptionId.get(argb);
          }
          if (!optionId) {
            const label = cellToText(rawValues[spec.rawIndices[0]]).trim();
            optionId = statusInfo.options.find((o) => o.label === label)?.id;
          }
          if (optionId) values[id] = optionId;
        } else if (spec.type === ColumnType.PERSON) {
          const text = cellToText(rawValues[spec.rawIndices[0]]).trim();
          if (text) {
            const ids = text.split(',').map((n) => userNameMap.get(n.toLowerCase().trim())).filter((id): id is string => !!id);
            if (ids.length) values[id] = ids;
          }
        } else if (spec.type === ColumnType.NUMBER) {
          const text = cellToText(rawValues[spec.rawIndices[0]]).trim();
          if (text) {
            const num = Number(text.replace(/,/g, ''));
            if (!isNaN(num)) values[id] = num;
          }
        } else {
          const text = cellToText(rawValues[spec.rawIndices[0]]).trim();
          if (text) values[id] = text;
        }
      }

      await wm.createItem({
        name: item.name,
        workspaceId,
        boardId: board.id,
        groupId: group.id,
        order: ii,
        values,
      });
      totalItems++;
    }
  }

  return {
    boardId: board.id,
    boardName: board.name,
    groupCount: parsedGroups.length,
    itemCount: totalItems,
  };
}
