import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiPlus, FiTrash2, FiLoader, FiAlertCircle, FiArrowUp, FiArrowDown, FiUser, FiHash, FiSettings } from 'react-icons/fi';
import * as apiService from '../../services/geminiService';
import AddColumnModal, { COLUMN_TYPE_LABELS } from '../boards/AddColumnModal';
import { useFormulaRecording } from '../../contexts/FormulaRecordingContext';
import TemplateTotalScopeModal from '../formula/TemplateTotalScopeModal';
import { formulaRefDomKey } from '../../utils/formulaEngine';
import { ColumnType } from '../../types';
import type { HoursLogColumnSettings, PersonalHubTemplateColumn } from '../../types';

/** Org-admin editor for the Personal Hub default template: an "all groups" column-schema
 *  list only — no groups, items, or data. Materialized into a user's own Personal Hub
 *  (as non-deletable columns) the first time they have none. Every add/remove/reorder
 *  persists immediately — there's no separate save step. */
const PersonalHubTemplatePage: React.FC = () => {
  const navigate = useNavigate();
  const { isRecording, insertRef } = useFormulaRecording();

  const [columns, setColumns] = useState<PersonalHubTemplateColumn[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [isPersisting, setIsPersisting] = useState(false);
  const [persistError, setPersistError] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [filterModalCol, setFilterModalCol] = useState<PersonalHubTemplateColumn | null>(null);
  const [settingsModalCol, setSettingsModalCol] = useState<PersonalHubTemplateColumn | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { columns: loaded } = await apiService.getPersonalHubTemplate();
        if (!cancelled) setColumns([...loaded].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load the Personal Hub template.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /** Applies a local edit to `columns`, then immediately persists the resulting list.
   *  Reverts to the last-saved list if the save fails, so the UI never shows an edit
   *  that didn't actually make it to the server. */
  const commit = async (next: PersonalHubTemplateColumn[]) => {
    const previous = columns;
    setColumns(next);
    setIsPersisting(true);
    setPersistError('');
    try {
      const { columns: saved } = await apiService.updatePersonalHubTemplate(next);
      setColumns([...saved].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
    } catch (err) {
      setColumns(previous);
      setPersistError(err instanceof Error ? err.message : 'Failed to save the change.');
    } finally {
      setIsPersisting(false);
    }
  };

  const handleAdd = (col: { name: string; type: ColumnType; settings: PersonalHubTemplateColumn['settings'] }) => {
    void commit([
      ...columns,
      { id: `new_${Date.now()}_${Math.random().toString(36).slice(2)}`, name: col.name, type: col.type, settings: col.settings, order: columns.length },
    ]);
  };

  const handleRemove = (id: string) => {
    void commit(columns.filter((c) => c.id !== id).map((c, i) => ({ ...c, order: i })));
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= columns.length) return;
    const next = [...columns];
    [next[index], next[target]] = [next[target], next[index]];
    void commit(next.map((c, i) => ({ ...c, order: i })));
  };

  const toggleSubitemsOnly = (col: PersonalHubTemplateColumn, value: boolean) => {
    const settings: HoursLogColumnSettings = { ...(col.settings as HoursLogColumnSettings), subitemsOnly: value };
    void commit(columns.map((c) => (c.id === col.id ? { ...c, settings } : c)));
    setSettingsModalCol(null);
  };

  const chooseFilterScope = (scope: 'item' | 'global') => {
    if (filterModalCol) {
      insertRef({ kind: 'ph', boardId: '', columnId: filterModalCol.id, itemId: null, phScope: scope });
    }
    setFilterModalCol(null);
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <button
        type="button"
        onClick={() => navigate('/admin/templates')}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors mb-4"
        aria-label="Back to Templates"
      >
        <FiArrowLeft size={14} aria-hidden="true" />
        Back to Templates
      </button>

      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center">
            <FiUser className="text-indigo-600" size={20} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Personal Hub Template</h1>
            <p className="text-sm text-gray-500 mt-1">
              Columns every user's Personal Hub starts with. No groups or data here — only "all groups" columns.
              Changes save automatically.
            </p>
          </div>
        </div>
        {isPersisting && (
          <span className="flex items-center gap-1.5 text-xs text-gray-400 flex-shrink-0 mt-1" role="status">
            <FiLoader size={13} className="animate-spin" aria-hidden="true" />
            Saving…
          </span>
        )}
      </div>

      {loadError && (
        <div className="mt-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700" role="alert">
          {loadError}
        </div>
      )}

      {persistError && (
        <div className="mt-4 flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700" role="alert">
          <FiAlertCircle size={15} aria-hidden="true" />
          {persistError}
        </div>
      )}

      {isRecording && (
        <div className="mt-4 flex items-center gap-2 px-4 py-3 bg-indigo-50 border border-indigo-200 rounded-lg text-sm text-indigo-700" role="status">
          <FiHash size={15} aria-hidden="true" />
          Recording a formula — click a Number column below to insert its running total across every user's Personal Hub.
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <FiLoader size={24} className="animate-spin" aria-hidden="true" />
        </div>
      ) : (
        <div className="mt-6 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          {columns.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-gray-400 gap-2">
              <p className="text-sm">No template columns yet.</p>
              <p className="text-xs text-center max-w-sm">
                Add columns below — every user's Personal Hub will start with them, ready to fill in with their own data.
              </p>
            </div>
          ) : (
            <ul role="list" aria-label="Personal Hub template columns" className="divide-y divide-gray-100">
              {columns.map((col, i) => {
                const canInsert = isRecording && col.type === ColumnType.NUMBER;
                const handleInsert = () => setFilterModalCol(col);
                return (
                  <li
                    key={col.id}
                    data-formula-cell-key={formulaRefDomKey({ kind: 'ph', boardId: '', columnId: col.id, itemId: null })}
                    className={`flex items-center gap-3 px-4 py-3 ${canInsert ? 'cursor-pointer hover:bg-indigo-50 transition-colors' : ''}`}
                    onClick={canInsert ? handleInsert : undefined}
                  >
                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); move(i, -1); }}
                        disabled={i === 0 || isPersisting}
                        className="text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed p-0.5"
                        aria-label={`Move ${col.name} up`}
                      >
                        <FiArrowUp size={13} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); move(i, 1); }}
                        disabled={i === columns.length - 1 || isPersisting}
                        className="text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed p-0.5"
                        aria-label={`Move ${col.name} down`}
                      >
                        <FiArrowDown size={13} aria-hidden="true" />
                      </button>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate">{col.name}</p>
                      <p className="text-xs text-gray-500">{COLUMN_TYPE_LABELS[col.type]}</p>
                    </div>
                    {canInsert && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleInsert(); }}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 transition-colors"
                        aria-label={`Insert running total of ${col.name}`}
                      >
                        <FiHash size={12} aria-hidden="true" />
                        Insert total
                      </button>
                    )}
                    {col.type === ColumnType.HOURS_LOG && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setSettingsModalCol(col); }}
                        disabled={isPersisting}
                        className="text-gray-400 hover:text-gray-700 transition-colors p-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
                        aria-label={`Settings for ${col.name}`}
                      >
                        <FiSettings size={15} aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleRemove(col.id); }}
                      disabled={isPersisting}
                      className="text-gray-400 hover:text-red-500 transition-colors p-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label={`Remove ${col.name} from template`}
                    >
                      <FiTrash2 size={15} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              disabled={isPersisting}
              className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Add a template column"
            >
              <FiPlus size={15} aria-hidden="true" />
              Add Column
            </button>
          </div>
        </div>
      )}

      {showAddModal && (
        <AddColumnModal mode="template" onSave={handleAdd} onClose={() => setShowAddModal(false)} />
      )}

      {filterModalCol && (
        <TemplateTotalScopeModal
          columnName={filterModalCol.name}
          onChoose={chooseFilterScope}
          onCancel={() => setFilterModalCol(null)}
        />
      )}

      {settingsModalCol && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="hours-log-settings-title"
          onClick={() => setSettingsModalCol(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full p-5 space-y-3"
            style={{ maxWidth: '24rem' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="hours-log-settings-title" className="text-sm font-semibold text-gray-800">
              {settingsModalCol.name} · Hours Log Settings
            </h2>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={(settingsModalCol.settings as HoursLogColumnSettings).subitemsOnly ?? false}
                onChange={(e) => toggleSubitemsOnly(settingsModalCol, e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                aria-label="Subitems only"
              />
              Subitems only
            </label>
            <p className="text-xs text-gray-500">
              When a user has subitems assigned to them under an item, this column is shown on
              those subitems too, and the item's own cell shows only their total.
            </p>
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setSettingsModalCol(null)}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
                aria-label="Close"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PersonalHubTemplatePage;
