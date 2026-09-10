import {
  ColumnType,
  DBColumn,
  StatusColumnSettings,
  DropdownColumnSettings,
  TextColumnSettings,
  NumberColumnSettings,
} from '../types/index.js';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates a column value against the column's type and settings.
 * Called by item controllers before writing to Firestore.
 */
export function validateColumnValue(column: DBColumn, value: unknown): ValidationResult {
  // null/undefined means "clear the value" — always allowed
  if (value === null || value === undefined) {
    return { valid: true };
  }

  switch (column.type) {
    case ColumnType.TEXT: {
      if (typeof value !== 'string') return { valid: false, error: `Column "${column.name}": value must be a string.` };
      const settings = column.settings as TextColumnSettings;
      if (settings.maxLength !== undefined && value.length > settings.maxLength) {
        return { valid: false, error: `Column "${column.name}": value exceeds maxLength of ${settings.maxLength}.` };
      }
      return { valid: true };
    }

    case ColumnType.NUMBER: {
      if (typeof value !== 'number' || isNaN(value)) {
        return { valid: false, error: `Column "${column.name}": value must be a number.` };
      }
      const settings = column.settings as NumberColumnSettings;
      if (settings.precision !== undefined) {
        const factor = Math.pow(10, settings.precision);
        if (Math.round(value * factor) / factor !== value) {
          return { valid: false, error: `Column "${column.name}": value exceeds precision of ${settings.precision} decimal places.` };
        }
      }
      return { valid: true };
    }

    case ColumnType.DATE: {
      // Accept Firestore Timestamp objects, JS Dates, or ISO strings
      const isTimestamp = typeof value === 'object' && value !== null && 'toDate' in value;
      const isDate = value instanceof Date;
      const isIsoString = typeof value === 'string' && !isNaN(Date.parse(value));
      if (!isTimestamp && !isDate && !isIsoString) {
        return { valid: false, error: `Column "${column.name}": value must be a valid date.` };
      }
      return { valid: true };
    }

    case ColumnType.STATUS: {
      if (typeof value !== 'string') return { valid: false, error: `Column "${column.name}": value must be a string optionId.` };
      const settings = column.settings as StatusColumnSettings;
      const validIds = settings.options.map((o) => o.id);
      if (!validIds.includes(value)) {
        return { valid: false, error: `Column "${column.name}": "${value}" is not a valid option. Valid options: ${validIds.join(', ')}.` };
      }
      return { valid: true };
    }

    case ColumnType.PERSON: {
      if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
        return { valid: false, error: `Column "${column.name}": value must be an array of user ID strings.` };
      }
      return { valid: true };
    }

    case ColumnType.DROPDOWN: {
      const settings = column.settings as DropdownColumnSettings;
      const validIds = settings.options.map((o) => o.id);
      if (settings.multiple) {
        if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
          return { valid: false, error: `Column "${column.name}": value must be an array of option ID strings.` };
        }
        const invalid = (value as string[]).filter((v) => !validIds.includes(v));
        if (invalid.length > 0) {
          return { valid: false, error: `Column "${column.name}": invalid option IDs: ${invalid.join(', ')}.` };
        }
      } else {
        // Accept arrays (frontend format) or plain strings (legacy)
        if (Array.isArray(value)) {
          if (!value.every((v) => typeof v === 'string')) {
            return { valid: false, error: `Column "${column.name}": value must be an array of option ID strings.` };
          }
          const invalid = (value as string[]).filter((v) => !validIds.includes(v));
          if (invalid.length > 0) {
            return { valid: false, error: `Column "${column.name}": invalid option IDs: ${invalid.join(', ')}.` };
          }
        } else {
          if (typeof value !== 'string') return { valid: false, error: `Column "${column.name}": value must be a string optionId.` };
          if (!validIds.includes(value)) {
            return { valid: false, error: `Column "${column.name}": "${value}" is not a valid option.` };
          }
        }
      }
      return { valid: true };
    }

    case ColumnType.CHECKBOX: {
      if (typeof value !== 'boolean') return { valid: false, error: `Column "${column.name}": value must be a boolean.` };
      return { valid: true };
    }

    case ColumnType.TAGS: {
      if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
        return { valid: false, error: `Column "${column.name}": value must be an array of strings.` };
      }
      return { valid: true };
    }

    case ColumnType.TIME: {
      if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) {
        return { valid: false, error: `Column "${column.name}": value must be a time string in "HH:mm" format.` };
      }
      return { valid: true };
    }

    case ColumnType.EMAIL: {
      if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return { valid: false, error: `Column "${column.name}": value must be a valid email address.` };
      }
      return { valid: true };
    }

    case ColumnType.PHONE: {
      if (typeof value !== 'string' || value.trim().length === 0) {
        return { valid: false, error: `Column "${column.name}": value must be a non-empty phone string.` };
      }
      return { valid: true };
    }

    case ColumnType.LOCATION: {
      if (
        typeof value !== 'object' ||
        value === null ||
        typeof (value as Record<string, unknown>).address !== 'string'
      ) {
        return { valid: false, error: `Column "${column.name}": value must be an object with an "address" string field.` };
      }
      return { valid: true };
    }

    case ColumnType.TIME_RANGE: {
      const v = value as Record<string, unknown>;
      if (typeof value !== 'object' || value === null || !('start' in v) || !('end' in v)) {
        return { valid: false, error: `Column "${column.name}": value must be an object with "start" and "end" fields.` };
      }
      return { valid: true };
    }

    case ColumnType.LINK: {
      if (typeof value !== 'string') {
        return { valid: false, error: `Column "${column.name}": value must be a URL string.` };
      }
      return { valid: true };
    }

    case ColumnType.SIMPLE_FORMULA: {
      // Per-cell formula overrides are stored as strings; the result is computed client-side.
      if (typeof value !== 'string') {
        return { valid: false, error: `Column "${column.name}": formula override must be a string expression.` };
      }
      return { valid: true };
    }

    case ColumnType.HOURS_LOG: {
      if (!Array.isArray(value)) {
        return { valid: false, error: `Column "${column.name}": value must be an array of logged-hours entries.` };
      }
      for (const entry of value) {
        const e = entry as Record<string, unknown>;
        if (
          typeof e !== 'object' || e === null ||
          typeof e.id !== 'string' ||
          typeof e.minutes !== 'number' || isNaN(e.minutes) || e.minutes <= 0 ||
          typeof e.loggedAt !== 'string' || isNaN(Date.parse(e.loggedAt))
        ) {
          return { valid: false, error: `Column "${column.name}": each entry must have id (string), minutes (positive number), and loggedAt (ISO date string).` };
        }
      }
      return { valid: true };
    }

    default:
      return { valid: false, error: `Unknown column type.` };
  }
}
