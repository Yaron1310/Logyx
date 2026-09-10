// Shared MIME allow-list for user-uploaded attachments (item chat files, FILES column uploads).
// Keeping this in one place means loosening/tightening what's accepted only has to happen once.
export const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
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

/**
 * Builds a Content-Disposition header value that makes the browser use the file's original
 * name — for both an inline preview (PDF/image) and a forced download (xlsx, docx, ...) — instead
 * of falling back to the storage object's key (which carries our uniqueness prefix, e.g.
 * "1699999999xyz_report.xlsx"). "inline" still lets previewable types open in a tab; types with
 * no built-in viewer download regardless of disposition, but keep the right filename.
 */
export function buildContentDisposition(filename: string): string {
  // RFC 5987: an ASCII-safe fallback for older clients, plus the real (possibly non-ASCII) name
  // via filename* for everything else.
  const asciiFallback = (filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'") || 'file');
  return `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
