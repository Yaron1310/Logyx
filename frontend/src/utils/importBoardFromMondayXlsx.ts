// Import path for Monday.com board exports (.xlsx). These are structured very
// differently from this app's own export (see importBoardFromXlsx.ts):
//  - No color/fill styling is used at all — everything is plain text, so
//    header rows, group rows, and STATUS-like columns must be detected from
//    literal markers and value shape rather than cell fills.
//  - Subitems appear twice: as comma-joined rollup columns on the parent's
//    own row ("Subitems", "Subitems Timeline", "Subitems Status" — ignored,
//    they can't be split back apart reliably), and as a real nested table
//    directly under the parent item (a "Subitems" sub-header row followed by
//    one row per subitem, each with its own column set). Only the latter is
//    imported.
//
// Row shapes, in order, per group:
//   <group name>                                  (col A only)
//   Name | Subitems | Subitems Timeline | Subitems Status | <board columns...>   ← header row
//   <parent item name> | <rollup text...> | <board column values...>            ← item row
//   Subitems | Name | <subitem columns...>                                      ← subitem header (only if the item above has subitems)
//   (blank) | <subitem name> | <subitem column values...>                       ← subitem row (repeats)
//   ...
//   (blank col A, blank col B)                                                  ← group-end marker row
//   (fully blank row)                                                           ← spacer

import { ColumnType } from '../types';
import type { StatusOption } from '../types';
import * as wm from '../services/workManagementService';
import {
  cellToText,
  cellToDateIso,
  isUrlLike,
  isNumberLike,
  labelToOptionId,
  type RawCell,
  type ImportResult,
} from './importBoardFromXlsx';

// A literal "null" is how Monday serializes an unset Formula-type value —
// treat it as empty everywhere, not as the text "null".
function mText(val: RawCell): string {
  const text = cellToText(val).trim();
  return text.toLowerCase() === 'null' ? '' : text;
}

function textRow(rows: RawCell[][], idx: number): string[] {
  const row = rows[idx] ?? [];
  return row.map((c) => mText(c));
}

// ── Column spec ───────────────────────────────────────────────────────────────

interface ColumnSpec {
  name: string;
  type: ColumnType;
  /** Indices into the raw row's values-after-the-name-column slice. */
  rawIndices: number[];
}

const START_SUFFIX = ' - Start';
const END_SUFFIX = ' - End';
const PERSON_HEADERS = new Set(['owner', 'assignee', 'design owner', 'person', 'people', 'user']);
const ROLLUP_HEADERS = new Set(['subitems', 'subitems timeline', 'subitems status']);

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

// ── STATUS/DROPDOWN detection from value shape (no color to go on) ──────────

interface StatusColInfo {
  options: StatusOption[];
  labelToId: Map<string, string>;
}

const STATUS_PALETTE = [
  '#6366f1', '#22c55e', '#f97316', '#ef4444', '#0ea5e9',
  '#a855f7', '#eab308', '#94a3b8', '#ec4899', '#14b8a6',
];
const FORCED_STATUS_HEADERS = new Set(['status', 'priority']);
const MAX_STATUS_DISTINCT = 8;
const MAX_STATUS_VALUE_LEN = 40;

function buildStatusInfo(labelsInOrder: string[]): StatusColInfo {
  const options: StatusOption[] = [];
  const labelToId = new Map<string, string>();
  labelsInOrder.forEach((label, idx) => {
    if (labelToId.has(label)) return;
    const id = labelToOptionId(label) || `opt_${idx}`;
    options.push({ id, label, color: STATUS_PALETTE[idx % STATUS_PALETTE.length] });
    labelToId.set(label, id);
  });
  return { options, labelToId };
}

// Decides a spec's final type from its collected non-empty text values.
// TIME_RANGE and PERSON specs are already fixed by header shape and are left alone.
function classifySpec(
  spec: ColumnSpec,
  values: string[],
): { type: ColumnType; statusInfo?: StatusColInfo } {
  if (spec.type === ColumnType.TIME_RANGE || spec.type === ColumnType.PERSON) return { type: spec.type };

  const nonEmpty = values.filter((v) => v);
  if (!nonEmpty.length) return { type: ColumnType.TEXT };

  const distinctInOrder: string[] = [];
  for (const v of nonEmpty) if (!distinctInOrder.includes(v)) distinctInOrder.push(v);

  const forced = FORCED_STATUS_HEADERS.has(spec.name.toLowerCase());
  const looksLikeStatusShape =
    nonEmpty.every((v) => v.length <= MAX_STATUS_VALUE_LEN) &&
    !nonEmpty.every(isNumberLike) &&
    !nonEmpty.every(isUrlLike);

  if (forced || (distinctInOrder.length <= MAX_STATUS_DISTINCT && looksLikeStatusShape)) {
    return { type: ColumnType.STATUS, statusInfo: buildStatusInfo(distinctInOrder) };
  }
  if (nonEmpty.every(isUrlLike)) return { type: ColumnType.LINK };
  if (nonEmpty.every(isNumberLike)) return { type: ColumnType.NUMBER };
  return { type: ColumnType.TEXT };
}

// ── Parsed structures ─────────────────────────────────────────────────────────

interface ParsedSubitem {
  name: string;
  /** Raw cells for this subitem row, starting at column B ("Name") onward. */
  rawValues: RawCell[];
}

interface ParsedItem {
  name: string;
  /** Raw cells for this item row, starting at column B (first data column) onward. */
  rawValues: RawCell[];
  subitems: ParsedSubitem[];
}

interface ParsedGroup {
  name: string;
  items: ParsedItem[];
}

// ── Main parse + import ───────────────────────────────────────────────────────

export async function importMondayRows(
  rows: RawCell[][],
  workspaceId: string,
  userNameMap: Map<string, string>,
): Promise<ImportResult> {
  const boardName = cellToText(rows[0]?.[0]).trim() || 'Imported Board';

  const parsedGroups: ParsedGroup[] = [];
  let boardColumnSpecs: ColumnSpec[] | null = null;
  let subitemColumnSpecs: ColumnSpec[] | null = null;

  // Collected raw text values per spec, across the whole file, used to classify
  // STATUS/NUMBER/LINK columns after parsing (mirrors the two-phase approach
  // used for this app's own export format, just without fill-color signals).
  let boardColVals: string[][] = [];
  let subitemColVals: string[][] = [];

  let cursor = 1; // row 0 is the board name
  while (cursor < rows.length) {
    const row0 = textRow(rows, cursor);
    if (!row0[0]) { cursor++; continue; } // spacer

    const nextRow = textRow(rows, cursor + 1);
    if (nextRow[0] !== 'Name') { cursor++; continue; } // not a group-name row; skip defensively

    const groupName = row0[0];
    cursor++; // now at header row

    const headerRow = textRow(rows, cursor);
    cursor++;
    if (!boardColumnSpecs) {
      boardColumnSpecs = buildColumnSpecs(headerRow.slice(1));
      boardColVals = boardColumnSpecs.map(() => []);
    }

    const items: ParsedItem[] = [];
    while (cursor < rows.length) {
      const r = textRow(rows, cursor);
      if (!r[0]) break; // group-end marker row

      const rawValues = (rows[cursor] ?? []).slice(1);
      boardColumnSpecs.forEach((spec, si) => {
        if (ROLLUP_HEADERS.has(spec.name.toLowerCase())) return;
        const text = mText(rawValues[spec.rawIndices[0]]);
        if (text) boardColVals[si].push(text);
      });

      const itemName = r[0];
      cursor++;

      const subitems: ParsedSubitem[] = [];
      const peek = textRow(rows, cursor);
      if (peek[0] === 'Subitems' && peek[1] === 'Name') {
        if (!subitemColumnSpecs) {
          subitemColumnSpecs = buildColumnSpecs(peek.slice(2));
          subitemColVals = subitemColumnSpecs.map(() => []);
        }
        cursor++; // past subitem header row

        while (cursor < rows.length) {
          const sr = textRow(rows, cursor);
          if (sr[0]) break; // next parent item
          if (!sr[1]) break; // group-end marker row
          const subRawValues = (rows[cursor] ?? []).slice(2);
          subitemColumnSpecs.forEach((spec, si) => {
            const text = mText(subRawValues[spec.rawIndices[0]]);
            if (text) subitemColVals[si].push(text);
          });
          subitems.push({ name: sr[1], rawValues: subRawValues });
          cursor++;
        }
      }

      items.push({ name: itemName, rawValues, subitems });
    }

    parsedGroups.push({ name: groupName, items });
    cursor++; // skip the group-end marker row; any spacer row is skipped by the outer loop
  }

  if (!boardColumnSpecs) throw new Error('No header row found in file.');
  if (!parsedGroups.length) throw new Error('No groups found in file.');

  // ── Classify column types now that all values are collected ────────────────

  const classifiedBoardSpecs = boardColumnSpecs
    .filter((spec) => !ROLLUP_HEADERS.has(spec.name.toLowerCase()))
    .map((spec) => {
      const si = boardColumnSpecs!.indexOf(spec);
      const { type, statusInfo } = classifySpec(spec, boardColVals[si]);
      return { spec: { ...spec, type }, statusInfo };
    });

  const classifiedSubitemSpecs = (subitemColumnSpecs ?? []).map((spec, si) => {
    const { type, statusInfo } = classifySpec(spec, subitemColVals[si]);
    return { spec: { ...spec, type }, statusInfo };
  });

  const warnings: string[] = [
    'Status/priority-like columns were rebuilt from the values present in this file — ' +
      "an option that no item currently uses (e.g. a status nobody had selected) can't be recovered from an export and will be missing.",
  ];

  // ── Create board + board-level columns ──────────────────────────────────────

  const board = await wm.createBoard({ name: boardName, workspaceId });

  const createdBoardCols: Array<{ id: string; spec: ColumnSpec; statusInfo?: StatusColInfo }> = [];
  for (const { spec, statusInfo } of classifiedBoardSpecs) {
    const col = await wm.createColumn(board.id, {
      name: spec.name,
      type: spec.type,
      ...(statusInfo ? { settings: { options: statusInfo.options } } : {}),
    });
    createdBoardCols.push({ id: col.id, spec, statusInfo });
  }
  if (createdBoardCols.length > 0) {
    await wm.reorderColumns(board.id, createdBoardCols.map((c, i) => ({ id: c.id, order: i })));
  }

  // ── Value mapping (shared shape for board items and subitems) ──────────────

  function mapValues(
    rawValues: RawCell[],
    cols: Array<{ id: string; spec: ColumnSpec; statusInfo?: StatusColInfo }>,
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const { id, spec, statusInfo } of cols) {
      if (spec.type === ColumnType.TIME_RANGE) {
        const startIso = cellToDateIso(rawValues[spec.rawIndices[0]]);
        const endIso = cellToDateIso(rawValues[spec.rawIndices[1]]);
        if (startIso || endIso) {
          const startMs = startIso ? new Date(startIso).getTime() : NaN;
          const endMs = endIso ? new Date(endIso).getTime() : NaN;
          const durMs = endMs - startMs;
          const durationDays = !isNaN(durMs) && durMs >= 0 ? Math.round(durMs / 86_400_000) + 1 : undefined;
          values[id] = { start: startIso, end: endIso, ...(durationDays !== undefined ? { durationDays } : {}) };
        }
      } else if (spec.type === ColumnType.STATUS && statusInfo) {
        const text = mText(rawValues[spec.rawIndices[0]]);
        const optionId = text ? statusInfo.labelToId.get(text) : undefined;
        if (optionId) values[id] = optionId;
      } else if (spec.type === ColumnType.PERSON) {
        const text = mText(rawValues[spec.rawIndices[0]]);
        if (text) {
          const ids = text.split(',').map((n) => userNameMap.get(n.toLowerCase().trim())).filter((v): v is string => !!v);
          if (ids.length) values[id] = ids;
        }
      } else if (spec.type === ColumnType.NUMBER) {
        const text = mText(rawValues[spec.rawIndices[0]]);
        if (text) {
          const num = Number(text.replace(/,/g, ''));
          if (!isNaN(num)) values[id] = num;
        }
      } else {
        const text = mText(rawValues[spec.rawIndices[0]]);
        if (text) values[id] = text;
      }
    }
    return values;
  }

  // ── Create groups, items, and (per item) subitem groups/columns/items ──────

  let totalItems = 0;
  let totalSubitems = 0;

  for (let gi = 0; gi < parsedGroups.length; gi++) {
    const pg = parsedGroups[gi];
    const group = await wm.createGroup(board.id, { name: pg.name, order: gi });

    for (let ii = 0; ii < pg.items.length; ii++) {
      const item = pg.items[ii];
      const item_ = await wm.createItem({
        name: item.name,
        workspaceId,
        boardId: board.id,
        groupId: group.id,
        order: ii,
        values: mapValues(item.rawValues, createdBoardCols),
      });
      totalItems++;

      if (item.subitems.length) {
        const subitemGroup = await wm.createGroup(board.id, {
          name: 'Subitems',
          order: 0,
          parentItemId: item_.id,
        });

        const createdSubitemCols: Array<{ id: string; spec: ColumnSpec; statusInfo?: StatusColInfo }> = [];
        for (const { spec, statusInfo } of classifiedSubitemSpecs) {
          const col = await wm.createColumn(board.id, {
            name: spec.name,
            type: spec.type,
            parentGroupId: subitemGroup.id,
            ...(statusInfo ? { settings: { options: statusInfo.options } } : {}),
          });
          createdSubitemCols.push({ id: col.id, spec, statusInfo });
        }
        if (createdSubitemCols.length > 0) {
          await wm.reorderColumns(board.id, createdSubitemCols.map((c, i) => ({ id: c.id, order: i })));
        }

        for (let si = 0; si < item.subitems.length; si++) {
          const sub = item.subitems[si];
          await wm.createItem({
            name: sub.name,
            workspaceId,
            boardId: board.id,
            groupId: subitemGroup.id,
            order: si,
            values: mapValues(sub.rawValues, createdSubitemCols),
          });
          totalSubitems++;
        }
      }
    }
  }

  return {
    boardId: board.id,
    boardName: board.name,
    groupCount: parsedGroups.length,
    itemCount: totalItems,
    subitemCount: totalSubitems,
    warnings,
  };
}
