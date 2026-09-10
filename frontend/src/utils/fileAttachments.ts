/** Shared helpers for FILES-column attachments (frontend display only — the upload allow-list
 *  itself is enforced server-side in backend/src/utils/allowedFileTypes.ts). */

// Mirrors backend/src/utils/allowedFileTypes.ts — kept here only for immediate client-side
// feedback before an upload attempt; the backend is the actual source of truth.
export const ALLOWED_FILE_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
]);

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB, mirrors the backend cap

export function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/** Short, human label for a mime type — used in the hover preview card. Kept to the same
 *  two-tier "doc vs image" granularity the cell icon uses, not a full per-format breakdown. */
export function fileKindLabel(mimeType: string): string {
  if (isImageMime(mimeType)) return 'Image';
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType.includes('word')) return 'Word document';
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return 'Excel spreadsheet';
  if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return 'PowerPoint';
  if (mimeType === 'text/csv') return 'CSV';
  if (mimeType === 'text/plain') return 'Text file';
  return 'Document';
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Formats an ISO timestamp as "dd.mm.yyyy HH:MM" for the hover preview card. */
export function formatUploadedAt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
