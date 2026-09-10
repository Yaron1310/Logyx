import React from 'react';
import { ColumnType } from '../../../types';
import type { Item, Column } from '../../../types';
import TextCell from './TextCell';
import NumberCell from './NumberCell';
import DateCell from './DateCell';
import StatusCell from './StatusCell';
import PersonCell from './PersonCell';
import DropdownCell from './DropdownCell';
import CheckboxCell from './CheckboxCell';
import TagsCell from './TagsCell';
import TimeCell from './TimeCell';
import EmailCell from './EmailCell';
import PhoneCell from './PhoneCell';
import LocationCell from './LocationCell';
import TimeRangeCell from './TimeRangeCell';
import SimpleFormulaCell from './SimpleFormulaCell';
import LinkCell from './LinkCell';
import HoursLogCell from './HoursLogCell';

interface ColumnCellProps {
  item: Item;
  column: Column;
  groupColor?: string;
}

const ColumnCellInner: React.FC<ColumnCellProps> = ({ item, column, groupColor }) => {
  switch (column.type) {
    case ColumnType.TEXT:          return <TextCell item={item} column={column} />;
    case ColumnType.NUMBER:        return <NumberCell item={item} column={column} />;
    case ColumnType.DATE:          return <DateCell item={item} column={column} />;
    case ColumnType.STATUS:        return <StatusCell item={item} column={column} />;
    case ColumnType.PERSON:        return <PersonCell item={item} column={column} />;
    case ColumnType.DROPDOWN:      return <DropdownCell item={item} column={column} />;
    case ColumnType.CHECKBOX:      return <CheckboxCell item={item} column={column} />;
    case ColumnType.TAGS:          return <TagsCell item={item} column={column} />;
    case ColumnType.TIME:          return <TimeCell item={item} column={column} />;
    case ColumnType.EMAIL:         return <EmailCell item={item} column={column} />;
    case ColumnType.PHONE:         return <PhoneCell item={item} column={column} />;
    case ColumnType.LOCATION:      return <LocationCell item={item} column={column} />;
    case ColumnType.TIME_RANGE:    return <TimeRangeCell item={item} column={column} groupColor={groupColor} />;
    case ColumnType.SIMPLE_FORMULA: return <SimpleFormulaCell item={item} column={column} />;
    case ColumnType.LINK:          return <LinkCell item={item} column={column} />;
    case ColumnType.HOURS_LOG:     return <HoursLogCell item={item} column={column} />;
    default:                       return <TextCell item={item} column={column} />;
  }
};

const ColumnCell = React.memo(ColumnCellInner);
export default ColumnCell;
