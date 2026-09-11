import React from 'react';
import { ColumnType } from '../../types';
import type { PersonalColumn } from '../../types';
import type { PersonalGridContext } from './cells/types';
import PersonalTextCell from './cells/PersonalTextCell';
import PersonalNumberCell from './cells/PersonalNumberCell';
import PersonalDateCell from './cells/PersonalDateCell';
import PersonalStatusCell from './cells/PersonalStatusCell';
import PersonalPersonCell from './cells/PersonalPersonCell';
import PersonalDropdownCell from './cells/PersonalDropdownCell';
import PersonalCheckboxCell from './cells/PersonalCheckboxCell';
import PersonalTagsCell from './cells/PersonalTagsCell';
import PersonalTimeCell from './cells/PersonalTimeCell';
import PersonalEmailCell from './cells/PersonalEmailCell';
import PersonalPhoneCell from './cells/PersonalPhoneCell';
import PersonalLocationCell from './cells/PersonalLocationCell';
import PersonalLinkCell from './cells/PersonalLinkCell';
import PersonalTimeRangeCell from './cells/PersonalTimeRangeCell';
import PersonalFormulaCell from './cells/PersonalFormulaCell';
import PersonalHoursLogCell from './cells/PersonalHoursLogCell';

interface Props {
  column: PersonalColumn;
  itemId: string;
  itemName?: string;
  value: unknown;
  editable: boolean;
  /** Only needed by Number (as a formula click-target) and Simple Formula cells. */
  gridContext?: PersonalGridContext;
  /** Whose hub this cell belongs to — undefined for your own; set when an admin is editing another user's Personal Hub. */
  userId?: string;
  /** The board this row's underlying item actually belongs to — see PersonalCellProps. */
  itemBoardId?: string;
}

/**
 * Dispatches to the same visual/interaction design as the real board's
 * per-type cells (ColumnCell → StatusCell/DropdownCell/PersonCell/etc.),
 * just reading/writing personalItemValues instead of item.values. The real
 * cell components can't be reused directly — they're hard-wired to
 * useUpdateItem(), which writes straight into the shared Item document, and
 * personal-column values are deliberately kept private to the hub owner in
 * a separate store. So each case here is a UI-identical copy wired to the
 * personal-hub storage/mutations instead.
 *
 * Simple Formula uses the same {ColumnLetter}{RowNumber} addressing as the
 * real board's formula grid, scoped to the table it's rendered in (a board
 * group's list of cross-group or board-only personal columns) — any cell,
 * any row, not just the same row as the formula.
 */
const PersonalColumnCell: React.FC<Props> = ({ column, itemId, itemName, value, editable, gridContext, userId, itemBoardId }) => {
  const props = { column, itemId, itemName: itemName ?? '', value, editable, userId, itemBoardId };

  switch (column.type) {
    case ColumnType.TEXT: return <PersonalTextCell {...props} />;
    case ColumnType.NUMBER: return <PersonalNumberCell {...props} gridContext={gridContext} />;
    case ColumnType.DATE: return <PersonalDateCell {...props} />;
    case ColumnType.STATUS: return <PersonalStatusCell {...props} />;
    case ColumnType.PERSON: return <PersonalPersonCell {...props} />;
    case ColumnType.DROPDOWN: return <PersonalDropdownCell {...props} />;
    case ColumnType.CHECKBOX: return <PersonalCheckboxCell {...props} />;
    case ColumnType.TAGS: return <PersonalTagsCell {...props} />;
    case ColumnType.TIME: return <PersonalTimeCell {...props} />;
    case ColumnType.EMAIL: return <PersonalEmailCell {...props} />;
    case ColumnType.PHONE: return <PersonalPhoneCell {...props} />;
    case ColumnType.LOCATION: return <PersonalLocationCell {...props} />;
    case ColumnType.LINK: return <PersonalLinkCell {...props} />;
    case ColumnType.TIME_RANGE: return <PersonalTimeRangeCell {...props} />;
    case ColumnType.SIMPLE_FORMULA:
      return <PersonalFormulaCell {...props} gridContext={gridContext ?? { rowOrder: [itemId], columns: [], valuesByItem: {} }} />;
    case ColumnType.HOURS_LOG: return <PersonalHoursLogCell {...props} gridContext={gridContext} />;
    default:
      return <PersonalTextCell {...props} />;
  }
};

export default PersonalColumnCell;
