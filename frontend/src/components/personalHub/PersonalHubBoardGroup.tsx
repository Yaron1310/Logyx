import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { FiLoader, FiExternalLink } from 'react-icons/fi';
import { useBoard } from '../../hooks/queries/useBoardQueries';
import { useColumns } from '../../hooks/queries/useColumnQueries';
import { usePersonalColumns, usePersonalItemValues, useUpdatePersonalColumn } from '../../hooks/queries/usePersonalHubQueries';
import { queryKeys } from '../../hooks/queries/queryKeys';
import * as wm from '../../services/workManagementService';
import { BoardRenderProvider } from '../../contexts/BoardRenderContext';
import { DependencyProvider } from '../../contexts/DependencyContext';
import { COLUMN_TYPE_ICONS } from '../boards/ColumnHeader';
import { calculateColumnWidth } from '../../utils/columnWidths';
import { makePersonalFormulaEvaluator } from '../../utils/personalHubGrid';
import ItemRow from '../boards/ItemRow';
import GroupSummaryRow, { SummaryCell } from '../boards/GroupSummaryRow';
import type { SummaryColumn, CellConfig } from '../boards/GroupSummaryRow';
import PersonalColumnCell from './PersonalColumnCell';
import { PERSONAL_COL_WIDTH } from './constants';
import { ColumnType } from '../../types';
import type { BoardView } from '../../contexts/BoardRenderContext';
import type { PersonalGridContext } from './cells/types';
import type { Group, Item, PersonalColumn } from '../../types';

interface Props {
  boardId: string;
  items: Item[];
  /** Whether the viewer can edit this hub — true for the owner, and also true for an
   *  org/system admin viewing someone else's hub (full edit ability, same as the owner). */
  isOwn: boolean;
  /**
   * Whose personal columns/values to load. `undefined` = the logged-in user's own
   * hub; set to another user's id when an admin is viewing/editing their hub.
   */
  ownerUserId?: string;
  boardView: BoardView;
  onOpenDetail: (item: Item) => void;
  onOpenChat: (item: Item) => void;
  onOpenForms: (item: Item) => void;
  onBoardResolved?: (boardId: string, name: string) => void;
  /**
   * Page-wide grid context for cross-group ("all groups") personal columns —
   * spans every board group's rows so a formula in any group can address a
   * Number cell in any other group's table. Falls back to this group's own
   * rows only if not provided.
   */
  crossGroupGridContext?: PersonalGridContext;
  /** Reports this group's resolved display rows + values up to the page once settled. */
  onRowsResolved?: (boardId: string, itemIds: string[], values: Record<string, Record<string, unknown>>) => void;
  /**
   * When a promoted parent item is expanded, only show subitems this user is
   * assigned to — not every subitem under that host, which is what the real
   * board's SubitemGroup shows by default.
   */
  subitemAssigneeFilterId?: string;
  /**
   * The page's uniform board width — the widest board group on the page. Every group's
   * rows are stretched to this so their sticky item cell stays pinned across the full
   * horizontal scroll even when this board has fewer columns; the space past this
   * board's own cells is filled grey. Undefined until measured (first paint).
   */
  groupMinWidth?: number;
}

/** Always plain — the interactive rename/settings/delete menu lives only in the page-level header. */
const PersonalColumnHeaderLabel: React.FC<{ col: PersonalColumn }> = ({ col }) => (
  <div
    role="columnheader"
    style={{ width: `${PERSONAL_COL_WIDTH}px` }}
    className={`flex flex-shrink-0 items-center justify-center gap-1.5 px-3 py-2 border-r border-[#d2d2d4] text-sm font-semibold text-indigo-600 ${col.fromTemplate ? 'bg-[#fff0de80]' : 'bg-indigo-50/50'}`}
    title={`${col.name} (personal column${col.fromTemplate ? ', from the org template' : ''})`}
  >
    <span className="text-indigo-400 flex-shrink-0">{COLUMN_TYPE_ICONS[col.type]}</span>
    <span className="truncate">{col.name}</span>
  </div>
);

const renderPersonalCells = (
  columns: PersonalColumn[],
  item: Item,
  personalValuesByItem: Record<string, Record<string, unknown>>,
  isOwn: boolean,
  gridContext: PersonalGridContext,
  ownerUserId?: string,
): React.ReactNode =>
  columns.length === 0 ? null : (
    <>
      {columns.map((col) => (
        <div
          key={col.id}
          role="gridcell"
          style={{ width: `${PERSONAL_COL_WIDTH}px` }}
          className="flex flex-shrink-0 items-center justify-center border-r border-[#d2d2d4] last:border-r-0"
        >
          <PersonalColumnCell
            column={col}
            itemId={item.id}
            itemName={item.name}
            value={personalValuesByItem[item.id]?.[col.id]}
            editable={isOwn}
            gridContext={gridContext}
            userId={ownerUserId}
          />
        </div>
      ))}
    </>
  );

/**
 * Renders one board's assigned items as a "group" in the Personal Hub — the
 * board name stands in for the group name, and each board keeps its own
 * column set since items here come from different boards.
 *
 * Source-board columns are the real, live item data — edits here save
 * straight back to the source board (same permission rules as viewing that
 * board directly), and stay exactly as fetched — no column management here.
 * Cross-group personal columns (managed from the page-level header) are
 * woven in before them, on the left, and are editable by the hub's owner or
 * an org/system admin viewing/editing that owner's hub.
 *
 * Subitems the user is assigned to are never shown as their own row here —
 * their hosting (parent) item is shown instead, exactly as on the source
 * board, and the user expands its chevron to reach the assigned subitem via
 * the real SubitemGroup panel (same one the source board uses).
 */
const PersonalHubBoardGroup: React.FC<Props> = ({ boardId, items, isOwn, ownerUserId, boardView, onOpenDetail, onOpenChat, onOpenForms, onBoardResolved, crossGroupGridContext: pageCrossGroupGridContext, onRowsResolved, subitemAssigneeFilterId, groupMinWidth }) => {
  const navigate = useNavigate();
  const { mutate: updatePersonalColumn } = useUpdatePersonalColumn(ownerUserId);
  const { data: board, isLoading: boardLoading, isError: boardError } = useBoard(boardId);

  React.useEffect(() => {
    if (board) onBoardResolved?.(boardId, board.name);
  }, [board, boardId, onBoardResolved]);

  // Don't fire columns/groups lookups until the board itself has resolved — for
  // orphaned items (pointing at a hard-deleted board), the board fetch 404s and
  // this group renders nothing anyway, so there's no point also firing (and
  // console-logging) doomed columns/groups requests for it.
  const { data: columns = [] } = useColumns(boardId, !!board);
  const { data: allPersonalColumns = [] } = usePersonalColumns(ownerUserId);

  const crossGroupColumns = useMemo(
    () => allPersonalColumns.filter((c) => c.scope === 'all'),
    [allPersonalColumns],
  );
  const boardOnlyColumns = useMemo(
    () => allPersonalColumns.filter((c) => c.scope === 'board' && c.boardId === boardId),
    [allPersonalColumns, boardId],
  );

  // Resolve each assigned item's group so subitems can be swapped out for their hosting item,
  // and so displayed items can be sub-divided by their real source-board group (below).
  // Gated on the board having resolved — see the useColumns note above.
  const groupResults = useQueries({
    queries: items.map((item) => ({
      queryKey: queryKeys.groups.one(boardId, item.groupId),
      queryFn: () => wm.getGroup(boardId, item.groupId),
      staleTime: 2 * 60 * 1000,
      enabled: !!board,
    })),
  });
  const groupsSettled = groupResults.every((r) => !r.isLoading);

  const { topLevelItems, parentItemIds, topLevelItemGroupById } = useMemo(() => {
    const top: Item[] = [];
    const parentIds = new Set<string>();
    const groupById = new Map<string, Group>();
    items.forEach((item, i) => {
      const group = groupResults[i]?.data;
      const groupErrored = groupResults[i]?.isError;
      if (group?.parentItemId && !groupErrored) {
        parentIds.add(group.parentItemId);
      } else {
        top.push(item);
        if (group) groupById.set(item.id, group);
      }
    });
    return { topLevelItems: top, parentItemIds: [...parentIds], topLevelItemGroupById: groupById };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, groupResults.map((r) => r.data).join(','), groupResults.map((r) => r.isError).join(',')]);

  const parentItemResults = useQueries({
    queries: parentItemIds.map((id) => ({
      queryKey: queryKeys.items.one(id),
      queryFn: () => wm.getItem(id),
      staleTime: 60 * 1000,
    })),
  });
  const parentItemsSettled = parentItemResults.every((r) => !r.isLoading);

  // A promoted subitem's parent is always itself a top-level item, but we only fetched the
  // Item above — its Group (needed for grouping/sub-header display) is a further lookup.
  const parentGroupResults = useQueries({
    queries: parentItemResults.map((r) => ({
      queryKey: queryKeys.groups.one(boardId, r.data?.groupId ?? ''),
      queryFn: () => wm.getGroup(boardId, r.data!.groupId),
      staleTime: 2 * 60 * 1000,
      enabled: !!r.data?.groupId,
    })),
  });
  const parentGroupsSettled = parentGroupResults.every((r, i) => !parentItemResults[i].data || !r.isLoading);

  const itemGroupById = useMemo(() => {
    const map = new Map(topLevelItemGroupById);
    parentItemResults.forEach((r, i) => {
      const parent = r.data;
      const group = parentGroupResults[i]?.data;
      if (parent && group) map.set(parent.id, group);
    });
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topLevelItemGroupById, parentItemResults.map((r) => r.data?.id).join(','), parentGroupResults.map((r) => r.data?.id).join(',')]);

  // Sub-divide this board's items by their real source-board group — a group of one's own
  // header only earns its keep once there's more than one to tell apart; a single-group board
  // renders its items flat, same as before this feature existed. Ordered by the source group's
  // own `order`, and each cluster's items by their own `order`, so this matches the row order
  // on the real board; items whose group couldn't be resolved (rare — a deleted group) land in
  // a trailing "Other" bucket rather than disappearing.
  const { displayItems, groupedClusters } = useMemo(() => {
    const existingIds = new Set(topLevelItems.map((i) => i.id));
    const resolvedParents = parentItemResults
      .map((r) => r.data)
      .filter((p): p is Item => !!p && !existingIds.has(p.id));
    const flat = [...topLevelItems, ...resolvedParents];

    const byGroupId = new Map<string, { group: Group; items: Item[] }>();
    const otherItems: Item[] = [];
    for (const item of flat) {
      const group = itemGroupById.get(item.id);
      if (!group) { otherItems.push(item); continue; }
      const entry = byGroupId.get(group.id) ?? { group, items: [] };
      entry.items.push(item);
      byGroupId.set(group.id, entry);
    }
    for (const entry of byGroupId.values()) entry.items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const clusters: { group: Group | null; items: Item[] }[] = [...byGroupId.values()]
      .sort((a, b) => (a.group.order ?? 0) - (b.group.order ?? 0));
    if (otherItems.length > 0) clusters.push({ group: null, items: otherItems });

    const totalGroups = clusters.length;
    return {
      displayItems: totalGroups > 1 ? clusters.flatMap((c) => c.items) : flat,
      // Only worth a sub-header once there's more than one group to distinguish.
      groupedClusters: totalGroups > 1 ? clusters : null,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topLevelItems, parentItemResults.map((r) => r.data?.id).join(','), itemGroupById]);

  const itemIds = useMemo(() => items.map((i) => i.id), [items]);
  const displayItemIds = useMemo(() => displayItems.map((i) => i.id), [displayItems]);
  // Personal-column values are keyed by item — fetch for both the directly assigned
  // items and any hosting items we promoted into view.
  // Load for the hub's owner (self, or the user an admin is viewing). Fetch in both
  // cases — the admin needs to see the owner's values; `editable={isOwn}` keeps it read-only.
  const { data: personalValuesByItem = {} } = usePersonalItemValues([...new Set([...itemIds, ...displayItemIds])], ownerUserId);

  // Cross-group columns get a real spreadsheet-style grid — every displayed row across
  // EVERY board group is addressable ({B3} etc.), matching the real board's formula
  // behavior. The page assembles this across all groups; fall back to this group's own
  // rows only if the page hasn't wired it up.
  const localCrossGroupGridContext = useMemo<PersonalGridContext>(
    () => ({ rowOrder: displayItemIds, columns: crossGroupColumns, valuesByItem: personalValuesByItem, boardId, ownerId: ownerUserId }),
    [displayItemIds, crossGroupColumns, personalValuesByItem, boardId, ownerUserId],
  );
  const crossGroupGridContext = pageCrossGroupGridContext ?? localCrossGroupGridContext;
  const boardOnlyGridContext = useMemo<PersonalGridContext>(
    () => ({ rowOrder: displayItemIds, columns: boardOnlyColumns, valuesByItem: personalValuesByItem, boardId, ownerId: ownerUserId }),
    [displayItemIds, boardOnlyColumns, personalValuesByItem, boardId, ownerUserId],
  );

  // For cumulative cross-group summaries: rows from every board group above this one.
  // The page-wide grid's rowOrder is all groups' rows in display order, so anything
  // before this group's first row is "above". Values live in the same page-wide grid,
  // so lightweight {id}-only pseudo-items are enough for the summary aggregation.
  const crossGroupItemsAbove = useMemo<Item[]>(() => {
    if (displayItemIds.length === 0) return [];
    const start = crossGroupGridContext.rowOrder.indexOf(displayItemIds[0]);
    if (start <= 0) return [];
    return crossGroupGridContext.rowOrder.slice(0, start).map((id) => ({ id } as Item));
  }, [crossGroupGridContext, displayItemIds]);

  const stillResolving = !groupsSettled || !parentItemsSettled || !parentGroupsSettled;

  React.useEffect(() => {
    if (!stillResolving) onRowsResolved?.(boardId, displayItemIds, personalValuesByItem);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, displayItemIds.join(','), personalValuesByItem, stillResolving, onRowsResolved]);

  const itemSectionWidth = 298 - 16;

  // The source board no longer exists (or is no longer accessible) — its items are
  // orphaned, so there's nothing meaningful to render for this group.
  if (boardError) return null;

  if (boardLoading || !board) {
    return (
      <div className="flex items-center justify-center py-6" role="status" aria-label={`Loading board ${boardId}`}>
        <FiLoader className="animate-spin text-indigo-400" size={18} aria-hidden="true" />
      </div>
    );
  }

  return (
    <div
      className="flex flex-col pt-8"
      aria-label={`Board group: ${board.name}`}
      // Match the board's uniform width so the sticky board-name below has room to stay
      // pinned across the full scroll. Without this the group root is only viewport-wide
      // (the table overflows it), so the name scrolls away once you pass that width.
      style={groupMinWidth ? { minWidth: `${groupMinWidth}px` } : undefined}
    >
      <div className="sticky left-4 w-fit flex items-center gap-2 pb-2 z-[2]">
        <h2 className="text-xl font-bold truncate max-w-[280px] text-indigo-700">{board.name}</h2>
        <span className="text-sm text-gray-400 flex-shrink-0" aria-label={`${items.length} items`}>
          {items.length}
        </span>
        <button
          type="button"
          onClick={() => navigate(`/boards/${boardId}`)}
          className="flex items-center justify-center w-6 h-6 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors flex-shrink-0"
          aria-label={`Go to the ${board.name} board`}
          title="Go to source board"
        >
          <FiExternalLink size={14} aria-hidden="true" />
        </button>
      </div>

      <section
        className="rounded-lg border border-gray-200 bg-white w-max shadow-md"
        aria-label={`Items assigned to you on board ${board.name}`}
      >
        <div
          data-phub-row=""
          className="flex flex-nowrap items-stretch border-b border-[#d2d2d4] bg-gray-50 w-max rounded-t-lg"
          role="row"
          aria-label={`Column headers for ${board.name}`}
          style={groupMinWidth ? { minWidth: `${groupMinWidth}px` } : undefined}
        >
          <div
            className="flex-shrink-0 border-r border-[#d2d2d4] sticky left-4 bg-gray-50 z-[1] rounded-tl-lg"
            style={{ width: `${itemSectionWidth}px`, borderLeft: '4px solid #6366f1' }}
          />
          {crossGroupColumns.map((col) => (
            <PersonalColumnHeaderLabel key={col.id} col={col} />
          ))}
          {columns.map((col) => (
            <div
              key={col.id}
              role="columnheader"
              style={{ width: `${col.width ?? calculateColumnWidth(col.name, col.type)}px` }}
              className="flex flex-shrink-0 items-center justify-center gap-1.5 px-3 py-2 border-r border-[#d2d2d4] text-sm font-semibold text-gray-600"
              title={col.name}
            >
              <span className="text-gray-400 flex-shrink-0">{COLUMN_TYPE_ICONS[col.type]}</span>
              <span className="truncate">{col.name}</span>
            </div>
          ))}
          {boardOnlyColumns.map((col) => (
            <PersonalColumnHeaderLabel key={col.id} col={col} />
          ))}
          {/* Grey filler to the page's uniform board width — see ItemRow's groupMinWidth. */}
          {groupMinWidth ? <div className="flex-1 bg-gray-100 rounded-tr-lg" aria-hidden="true" /> : null}
        </div>

        <BoardRenderProvider visibleItems={displayItems} columns={columns} boardView={boardView} openChat={onOpenChat} openForms={onOpenForms} groupsComplete={false}>
          <DependencyProvider items={displayItems}>
          <DndContext onDragEnd={() => {}}>
            <div role="rowgroup" aria-label={`Items assigned to you in ${board.name}`} className="w-max">
              {stillResolving ? (
                <div className="flex items-center justify-center py-4" role="status" aria-label="Resolving items">
                  <FiLoader className="animate-spin text-indigo-400" size={16} aria-hidden="true" />
                </div>
              ) : displayItems.length === 0 ? (
                <div className="px-4 py-4 text-xs text-gray-400 italic">No assigned items on this board.</div>
              ) : (
                <SortableContext items={displayItemIds} strategy={verticalListSortingStrategy}>
                  {groupedClusters ? groupedClusters.map(({ group, items: clusterItems }) => (
                    <div key={group?.id ?? '__other__'}>
                      {/* Sub-division within this board group — the source-board group each
                          item actually belongs to. Only rendered once there's more than one
                          to tell apart (see groupedClusters above); a single-group board
                          stays exactly as it looked before this existed. Full-width row (not
                          just the sticky label) so the top/bottom border spans the table like
                          every other row, instead of stopping short at the label's own width. */}
                      <div
                        role="row"
                        aria-label={`Sub-group: ${group?.name ?? 'Other'}, ${clusterItems.length} items`}
                        className="w-max border-t border-b border-[#d2d2d4] bg-gray-50/60"
                        style={groupMinWidth ? { minWidth: `${groupMinWidth}px` } : undefined}
                      >
                      <div className="sticky left-4 w-fit flex items-center gap-1.5 py-1.5 pl-1">
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          aria-hidden="true"
                          style={{ backgroundColor: group?.color || '#9ca3af' }}
                        />
                        <h3 className="text-xs font-semibold truncate max-w-[220px]" style={{ color: group?.color || '#6b7280' }}>
                          {group?.name ?? 'Other'}
                        </h3>
                        <span className="text-[11px] text-gray-400" aria-hidden="true">{clusterItems.length}</span>
                      </div>
                      </div>
                      {clusterItems.map((item) => (
                        <ItemRow
                          key={item.id}
                          item={item}
                          onOpenDetail={onOpenDetail}
                          groupColor={group?.color || '#6366f1'}
                          leadingExtraCells={renderPersonalCells(crossGroupColumns, item, personalValuesByItem, isOwn, crossGroupGridContext, ownerUserId)}
                          extraCells={renderPersonalCells(boardOnlyColumns, item, personalValuesByItem, isOwn, boardOnlyGridContext, ownerUserId)}
                          subitemAssigneeFilterId={subitemAssigneeFilterId}
                          groupMinWidth={groupMinWidth}
                        />
                      ))}
                    </div>
                  )) : displayItems.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      onOpenDetail={onOpenDetail}
                      groupColor="#6366f1"
                      leadingExtraCells={renderPersonalCells(crossGroupColumns, item, personalValuesByItem, isOwn, crossGroupGridContext, ownerUserId)}
                      extraCells={renderPersonalCells(boardOnlyColumns, item, personalValuesByItem, isOwn, boardOnlyGridContext, ownerUserId)}
                      subitemAssigneeFilterId={subitemAssigneeFilterId}
                      groupMinWidth={groupMinWidth}
                    />
                  ))}
                </SortableContext>
              )}
            </div>
          </DndContext>

          {/* Sum / average summary row — same component, same per-column config, as a
              normal board group. The source-column summaries persist to the shared
              Column doc (reflecting on the source board, like any other edit here);
              the personal cross-group / board-only column summaries are woven in
              around them with the same SummaryCell, computed client-side over the
              personal values and persisted to the personal column. */}
          {!stillResolving && (
            <GroupSummaryRow
              items={displayItems}
              columns={columns}
              hubRows
              hubOwnerId={ownerUserId}
              minWidth={groupMinWidth}
              leadingExtraCells={crossGroupColumns.length > 0
                ? crossGroupColumns.map((col) => (
                    <SummaryCell
                      key={col.id}
                      col={col as unknown as SummaryColumn}
                      items={displayItems}
                      itemsAbove={crossGroupItemsAbove}
                      numberCols={[]}
                      widthOverride={PERSONAL_COL_WIDTH}
                      personalOwnerId={ownerUserId}
                      // Page-wide value source so both this group's rows and rows from
                      // groups above (cumulative scope) resolve.
                      getValue={(item) => crossGroupGridContext.valuesByItem[item.id]?.[col.id]}
                      evalFormula={col.type === ColumnType.SIMPLE_FORMULA ? makePersonalFormulaEvaluator(col, crossGroupGridContext) : undefined}
                      onPersist={(c: CellConfig) => { if (isOwn) updatePersonalColumn({ id: col.id, patch: { summaryConfig: c } }); }}
                      cumulative={col.summaryCumulativeByBoard?.[boardId] ?? false}
                      onCumulativeChange={isOwn ? (b) => updatePersonalColumn({ id: col.id, patch: { summaryCumulativeByBoard: { ...(col.summaryCumulativeByBoard ?? {}), [boardId]: b } } }) : undefined}
                    />
                  ))
                : undefined}
              trailingExtraCells={boardOnlyColumns.length > 0
                ? boardOnlyColumns.map((col) => (
                    <SummaryCell
                      key={col.id}
                      col={col as unknown as SummaryColumn}
                      items={displayItems}
                      numberCols={[]}
                      widthOverride={PERSONAL_COL_WIDTH}
                      personalOwnerId={ownerUserId}
                      getValue={(item) => personalValuesByItem[item.id]?.[col.id]}
                      evalFormula={col.type === ColumnType.SIMPLE_FORMULA ? makePersonalFormulaEvaluator(col, boardOnlyGridContext) : undefined}
                      onPersist={(c: CellConfig) => { if (isOwn) updatePersonalColumn({ id: col.id, patch: { summaryConfig: c } }); }}
                      cumulative={col.summaryCumulativeByBoard?.[boardId] ?? false}
                      onCumulativeChange={isOwn ? (b) => updatePersonalColumn({ id: col.id, patch: { summaryCumulativeByBoard: { ...(col.summaryCumulativeByBoard ?? {}), [boardId]: b } } }) : undefined}
                    />
                  ))
                : undefined}
            />
          )}
          </DependencyProvider>
        </BoardRenderProvider>
      </section>
    </div>
  );
};

export default PersonalHubBoardGroup;
