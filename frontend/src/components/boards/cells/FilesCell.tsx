import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FiFileText, FiPlus, FiTrash2, FiUpload } from 'react-icons/fi';
import { useUpdateItem } from '../../../hooks/queries/useItemQueries';
import { useUndo } from '../../../contexts/UndoContext';
import { useBoardRender } from '../../../contexts/BoardRenderContext';
import * as wm from '../../../services/workManagementService';
import {
  ALLOWED_FILE_MIME_TYPES, MAX_FILE_SIZE_BYTES,
  fileKindLabel, formatFileSize, formatUploadedAt, isImageMime,
} from '../../../utils/fileAttachments';
import type { Item, Column, FileAttachment } from '../../../types';
import CellWrapper from './CellWrapper';

interface Props { item: Item; column: Column }

const ICON_SIZE = 22;

// ---------------------------------------------------------------------------
// Hover preview card
// ---------------------------------------------------------------------------

interface PreviewCardProps {
  anchorEl: HTMLElement | null;
  file: FileAttachment;
  canDelete: boolean;
  onRemove: () => void;
  onClose: () => void;
}

const PreviewCard: React.FC<PreviewCardProps> = ({ anchorEl, file, canDelete, onRemove, onClose }) => {
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    let top = r.bottom + 6;
    let left = r.left;
    const w = 220;
    const h = isImageMime(file.mimeType) ? 260 : 140;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8);
    setPos({ top, left });
  }, [anchorEl, file.mimeType]);

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 10002, width: 220 }}
      className="bg-white border border-gray-200 rounded-xl shadow-2xl p-3 pointer-events-auto"
      onMouseEnter={() => { /* keep open while hovered */ }}
      onMouseLeave={onClose}
      role="tooltip"
    >
      {isImageMime(file.mimeType) && (
        <img
          src={file.url}
          alt={file.name}
          className="w-full h-32 object-cover rounded-lg mb-2 bg-gray-50"
        />
      )}
      <p className="text-xs font-semibold text-gray-800 break-words leading-snug">{file.name}</p>
      <p className="text-[11px] text-gray-500 mt-1">{fileKindLabel(file.mimeType)} · {formatFileSize(file.size)}</p>
      <p className="text-[11px] text-gray-400 mt-1">
        Uploaded by {file.uploadedByName}<br />{formatUploadedAt(file.uploadedAt)}
      </p>
      {canDelete && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="flex items-center gap-1 mt-2 pt-2 border-t border-gray-100 text-[11px] text-red-500 hover:text-red-700 transition-colors"
          aria-label={`Remove file ${file.name}`}
        >
          <FiTrash2 size={11} aria-hidden="true" />
          Remove
        </button>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// One file icon (image thumbnail or generic document icon)
// ---------------------------------------------------------------------------

interface FileIconProps {
  file: FileAttachment;
  canDelete: boolean;
  onRemove: (id: string) => void;
}

const FileIcon: React.FC<FileIconProps> = ({ file, canDelete, onRemove }) => {
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setHovered(false), 100);
  };
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        className="w-[22px] h-[22px] flex-shrink-0 rounded overflow-hidden border border-gray-200 bg-white flex items-center justify-center hover:ring-2 hover:ring-indigo-300 transition-shadow"
        style={{ width: ICON_SIZE, height: ICON_SIZE }}
        onClick={(e) => { e.stopPropagation(); window.open(file.url, '_blank', 'noopener,noreferrer'); }}
        onMouseEnter={() => { cancelClose(); setHovered(true); }}
        onMouseLeave={scheduleClose}
        aria-label={`Open ${file.name} (${fileKindLabel(file.mimeType)}, ${formatFileSize(file.size)}, uploaded by ${file.uploadedByName})`}
        title={file.name}
      >
        {isImageMime(file.mimeType) ? (
          <img src={file.url} alt="" className="w-full h-full object-cover" />
        ) : (
          <FiFileText size={13} className="text-gray-500" aria-hidden="true" />
        )}
      </button>
      {hovered && createPortal(
        <div onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
          <PreviewCard
            anchorEl={ref.current}
            file={file}
            canDelete={canDelete}
            onRemove={() => { onRemove(file.id); setHovered(false); }}
            onClose={scheduleClose}
          />
        </div>,
        document.body,
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const FilesCellInner: React.FC<Props> = ({ item, column }) => {
  const rawValue = (item.values[column.id] as FileAttachment[] | null | undefined) ?? [];
  const { mutate } = useUpdateItem();
  const { push: pushUndo } = useUndo();
  const { isBoardReadOnly } = useBoardRender();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const commitFiles = (next: FileAttachment[], label: string) => {
    pushUndo({ label, undo: () => mutate({ id: item.id, patch: { values: { [column.id]: rawValue } } }) });
    mutate({ id: item.id, patch: { values: { [column.id]: next } } });
  };

  const removeFile = (id: string) => {
    commitFiles(rawValue.filter((f) => f.id !== id), `Removed a file on "${item.name}"`);
  };

  const openPicker = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isBoardReadOnly || isUploading) return;
    inputRef.current?.click();
  };

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    const files = Array.from(fileList);
    const rejected = files.filter((f) => !ALLOWED_FILE_MIME_TYPES.has(f.type) || f.size > MAX_FILE_SIZE_BYTES);
    const accepted = files.filter((f) => ALLOWED_FILE_MIME_TYPES.has(f.type) && f.size <= MAX_FILE_SIZE_BYTES);
    if (rejected.length > 0) {
      setError(`${rejected.length} file(s) skipped — unsupported type or over 20 MB.`);
    }
    if (accepted.length === 0) return;

    setIsUploading(true);
    try {
      const uploaded = await Promise.all(accepted.map((f) => wm.uploadItemFile(item.id, column.id, f)));
      commitFiles([...rawValue, ...uploaded], `Added ${uploaded.length} file${uploaded.length === 1 ? '' : 's'} on "${item.name}"`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <CellWrapper column={column} isReadOnly={isBoardReadOnly}>
      {() => (
        <div
          className="flex items-center gap-1 flex-wrap px-2 py-1 w-full h-full min-h-[32px] cursor-pointer"
          onClick={rawValue.length === 0 ? openPicker : undefined}
          role="group"
          aria-label={`${column.name}: ${rawValue.length} file${rawValue.length === 1 ? '' : 's'}`}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={Array.from(ALLOWED_FILE_MIME_TYPES).join(',')}
            className="hidden"
            aria-hidden="true"
            onChange={(e) => { void handleFilesSelected(e.target.files); e.target.value = ''; }}
          />

          {rawValue.length === 0 && !isBoardReadOnly && !isUploading && (
            <span className="flex items-center gap-1 text-gray-300 text-xs italic">
              <FiUpload size={12} aria-hidden="true" /> Upload
            </span>
          )}

          {rawValue.map((file) => (
            <FileIcon key={file.id} file={file} canDelete={!isBoardReadOnly} onRemove={removeFile} />
          ))}

          {rawValue.length > 0 && !isBoardReadOnly && (
            <button
              type="button"
              onClick={openPicker}
              disabled={isUploading}
              className="w-[22px] h-[22px] flex-shrink-0 rounded border border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors disabled:opacity-50"
              aria-label="Add another file"
              title="Add another file"
            >
              <FiPlus size={12} aria-hidden="true" />
            </button>
          )}

          {isUploading && <span className="text-[11px] text-gray-400">Uploading…</span>}
          {error && <span className="text-[11px] text-red-500 w-full" role="alert">{error}</span>}
        </div>
      )}
    </CellWrapper>
  );
};

const FilesCell = React.memo(FilesCellInner);
export default FilesCell;
