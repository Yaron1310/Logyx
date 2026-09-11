import type { PersonalColumn } from '../../../types';

export interface PersonalCellProps {
  column: PersonalColumn;
  itemId: string;
  itemName: string;
  value: unknown;
  editable: boolean;
  /** Whose hub this cell belongs to — undefined for your own; set when an admin is editing another user's Personal Hub. */
  userId?: string;
  /** The board this row's underlying item actually belongs to (distinct from gridContext.boardId,
   *  which addresses the whole table and may be empty/different for cross-group columns). Only
   *  used by HOURS_LOG's "Subitems only" rollup, to look up the item's real subitem group. */
  itemBoardId?: string;
}

/**
 * Shared addressing context for Simple Formula support: the ordered list of
 * items and columns rendered together in one table (a board group's
 * cross-group or board-only personal columns), so cells can be addressed by
 * {ColumnLetter}{RowNumber} exactly like the real board's formula grid —
 * any cell, any row, not just the same row as the formula.
 */
export interface PersonalGridContext {
  /** Ordered item ids as rendered in this table — row 1 is rowOrder[0], etc. */
  rowOrder: string[];
  /** Ordered sibling columns in this same list — column B is columns[0], etc. */
  columns: PersonalColumn[];
  /** itemId -> (columnId -> value) for every row in rowOrder. */
  valuesByItem: Record<string, Record<string, unknown>>;
  /** Board this personal table belongs to; used to build stable cross-board formula refs.
   *  May be empty for page-wide (cross-group) contexts that span multiple boards. */
  boardId?: string;
  /** Whose hub these rows belong to — undefined for your own, set when an admin is viewing
   *  someone else's. Stamped onto references picked here so they keep naming that person's
   *  columns wherever the formula is later evaluated. */
  ownerId?: string;
}
