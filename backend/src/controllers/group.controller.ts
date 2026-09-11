import type { Request, Response } from 'express';
import * as logger from 'firebase-functions/logger';
import admin from 'firebase-admin';
import { db, querySnapshotToArray, snapshotToData } from '../services/firestore.service.js';
import { boardsCollection, groupsCollection, boardMembersCollection, itemsCollection, columnsCollection, usersCollection } from '../db/collections.js';
import { JwtUserPayload, DBBoard, DBGroup, DBBoardMember, DBItem, DBColumn, DBUser, ColumnType } from '../types/index.js';
import { sanitizeText } from '../utils/sanitizer.js';
import { logAudit, getClientIp } from '../services/audit.service.js';
import {
  assertBoardAccess,
  assertGroupAccess,
  validateGroupOwnershipChain,
} from '../utils/workManagementAuth.js';
import { touchBoardVersion } from '../services/boardVersion.service.js';
import { revokeWebhookForGroup } from '../services/webhook.service.js';
import { sendBulkAssignmentEmail } from '../services/email.service.js';
import { getActorName, getBoardName, getOrganizationName } from '../utils/notificationHelpers.js';

function isAuthError(err: unknown): err is { status: number; message: string } {
  return typeof err === 'object' && err !== null && 'status' in err && 'message' in err;
}

// Firestore 'in' queries cap at 30 values — chunk larger id lists into multiple queries.
function chunk<T>(arr: T[], size = 30): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// GET /boards/:boardId/groups
// ---------------------------------------------------------------------------
export const getGroups = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const { boardId } = req.params;
  const { includeArchived, parentItemId } = req.query;

  try {
    const boardDoc = await boardsCollection(user.orgId).doc(boardId).get();
    if (!boardDoc.exists) return res.status(404).json({ message: 'Board not found.' });

    const board = snapshotToData<DBBoard>(boardDoc)!;
    assertBoardAccess(user, board, 'read');

    const snapshot = await groupsCollection(user.orgId, boardId).orderBy('order').get();
    const allGroups = querySnapshotToArray<DBGroup>(snapshot);

    let groups = allGroups;

    if (parentItemId && typeof parentItemId === 'string') {
      // Return only subitem groups for the given parent item
      groups = allGroups.filter((g) => g.parentItemId === parentItemId);
    } else {
      // Default: return only top-level groups (no parentItemId), optionally filtered by archive status
      groups = allGroups.filter((g) => !g.parentItemId);
      if (includeArchived !== 'true') {
        groups = groups.filter((g) => !g.isArchived);
      }
    }

    res.json(groups);
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error(`Error fetching groups for board ${req.params.boardId}:`, err);
    res.status(500).json({ message: 'Failed to fetch groups.' });
  }
};

// ---------------------------------------------------------------------------
// GET /boards/:boardId/groups/:groupId
// ---------------------------------------------------------------------------
export const getGroupById = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const { boardId, groupId } = req.params;

  try {
    const boardDoc = await boardsCollection(user.orgId).doc(boardId).get();
    if (!boardDoc.exists) return res.status(404).json({ message: 'Board not found.' });
    const board = snapshotToData<DBBoard>(boardDoc)!;

    const groupDoc = await groupsCollection(user.orgId, boardId).doc(groupId).get();
    if (!groupDoc.exists) return res.status(404).json({ message: 'Group not found.' });
    const group = snapshotToData<DBGroup>(groupDoc)!;

    const memberDoc = await boardMembersCollection(user.orgId, boardId).doc(user.id).get();
    const memberData = memberDoc.exists ? memberDoc.data() as DBBoardMember : null;
    assertGroupAccess(user, group, 'read', board.createdBy, memberData, board.workspaceId);

    res.json(group);
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error(`Error fetching group ${req.params.groupId}:`, err);
    res.status(500).json({ message: 'Failed to fetch group.' });
  }
};

// ---------------------------------------------------------------------------
// POST /boards/:boardId/groups
// ---------------------------------------------------------------------------
export const createGroup = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const { boardId } = req.params;
  const { name, color, order, parentItemId } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ message: 'Group name is required.' });
  }

  try {
    // Validate the board exists in this org
    const chain = await validateGroupOwnershipChain(user.orgId, boardId);
    if (!chain.valid) return res.status(400).json({ message: chain.error });

    const boardDoc = await boardsCollection(user.orgId).doc(boardId).get();
    const board = snapshotToData<DBBoard>(boardDoc)!;

    const memberDoc = await boardMembersCollection(user.orgId, boardId).doc(user.id).get();
    const memberData = memberDoc.exists ? memberDoc.data() as DBBoardMember : null;

    // Build a provisional group to check permission before writing
    const provisionalGroup: DBGroup = {
      id: '',
      workspaceId: user.orgId,
      boardId,
      name: sanitizeText(name),
      color: color ?? null,
      order: typeof order === 'number' ? order : 0,
      isCollapsed: false,
      parentItemId: parentItemId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    assertGroupAccess(user, provisionalGroup, 'create', board.createdBy, memberData, board.workspaceId);

    // Auto-calculate order if not provided
    let groupOrder = typeof order === 'number' ? order : null;
    if (groupOrder === null) {
      const countSnap = await groupsCollection(user.orgId, boardId).count().get();
      groupOrder = countSnap.data().count;
    }

    const docRef = groupsCollection(user.orgId, boardId).doc();
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    await docRef.set({
      id: docRef.id,
      workspaceId: user.orgId,
      boardId,
      name: sanitizeText(name),
      color: color ?? null,
      order: groupOrder,
      isCollapsed: false,
      ...(parentItemId ? { parentItemId } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const created = snapshotToData<DBGroup>(await docRef.get());
    touchBoardVersion(user.orgId, boardId);

    void logAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'CREATE',
      resourceType: 'group',
      resourceId: docRef.id,
      workspaceId: user.orgId,
      orgId: user.orgId,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    res.status(201).json(created);
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error(`Error creating group for board ${req.params.boardId}:`, err);
    res.status(500).json({ message: 'Failed to create group.' });
  }
};

// ---------------------------------------------------------------------------
// PATCH /boards/:boardId/groups/reorder   (must be registered BEFORE /:groupId)
// ---------------------------------------------------------------------------
export const reorderGroups = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const { boardId } = req.params;
  const { order } = req.body;

  if (!Array.isArray(order) || order.length === 0) {
    return res.status(400).json({ message: 'order must be a non-empty array of { id, order } objects.' });
  }

  try {
    const boardDoc = await boardsCollection(user.orgId).doc(boardId).get();
    if (!boardDoc.exists) return res.status(404).json({ message: 'Board not found.' });
    const board = snapshotToData<DBBoard>(boardDoc)!;

    const memberDoc = await boardMembersCollection(user.orgId, boardId).doc(user.id).get();
    const memberData = memberDoc.exists ? memberDoc.data() as DBBoardMember : null;
    assertBoardAccess(user, board, 'update', memberData);

    const batch = db.batch();
    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    for (const item of order as { id: string; order: number }[]) {
      if (typeof item.id !== 'string' || typeof item.order !== 'number') {
        return res.status(400).json({ message: 'Each entry must have id (string) and order (number).' });
      }
      const ref = groupsCollection(user.orgId, boardId).doc(item.id);
      batch.update(ref, { order: item.order, updatedAt: timestamp });
    }
    await batch.commit();
    touchBoardVersion(user.orgId, boardId);

    res.json({ message: 'Groups reordered.' });
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error(`Error reordering groups for board ${req.params.boardId}:`, err);
    res.status(500).json({ message: 'Failed to reorder groups.' });
  }
};

// ---------------------------------------------------------------------------
// PATCH /boards/:boardId/groups/:groupId
// ---------------------------------------------------------------------------
export const updateGroup = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const { boardId, groupId } = req.params;
  const { name, color, isCollapsed, order, summaryCumulative } = req.body;

  try {
    const boardDoc = await boardsCollection(user.orgId).doc(boardId).get();
    if (!boardDoc.exists) return res.status(404).json({ message: 'Board not found.' });
    const board = snapshotToData<DBBoard>(boardDoc)!;

    const groupDoc = await groupsCollection(user.orgId, boardId).doc(groupId).get();
    if (!groupDoc.exists) return res.status(404).json({ message: 'Group not found.' });
    const group = snapshotToData<DBGroup>(groupDoc)!;

    const memberDoc = await boardMembersCollection(user.orgId, boardId).doc(user.id).get();
    const memberData = memberDoc.exists ? memberDoc.data() as DBBoardMember : null;
    assertGroupAccess(user, group, 'update', board.createdBy, memberData, board.workspaceId);

    const updateData: Record<string, unknown> = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (name !== undefined) updateData.name = sanitizeText(String(name));
    if (color !== undefined) updateData.color = color;
    if (isCollapsed !== undefined) updateData.isCollapsed = Boolean(isCollapsed);
    if (order !== undefined) updateData.order = Number(order);
    if (summaryCumulative !== undefined && summaryCumulative !== null && typeof summaryCumulative === 'object' && !Array.isArray(summaryCumulative)) {
      const sanitized: Record<string, boolean> = {};
      for (const [colId, val] of Object.entries(summaryCumulative as Record<string, unknown>)) {
        sanitized[colId] = val === true;
      }
      updateData.summaryCumulative = sanitized;
    }

    await groupsCollection(user.orgId, boardId).doc(groupId).update(updateData);
    touchBoardVersion(user.orgId, boardId);
    const updated = snapshotToData<DBGroup>(
      await groupsCollection(user.orgId, boardId).doc(groupId).get(),
    );

    void logAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'UPDATE',
      resourceType: 'group',
      resourceId: groupId,
      workspaceId: user.orgId,
      orgId: user.orgId,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    res.json(updated);
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error(`Error updating group ${req.params.groupId}:`, err);
    res.status(500).json({ message: 'Failed to update group.' });
  }
};

// ---------------------------------------------------------------------------
// DELETE /boards/:boardId/groups/:groupId
// ---------------------------------------------------------------------------
export const deleteGroup = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const { boardId, groupId } = req.params;

  try {
    const boardDoc = await boardsCollection(user.orgId).doc(boardId).get();
    if (!boardDoc.exists) return res.status(404).json({ message: 'Board not found.' });
    const board = snapshotToData<DBBoard>(boardDoc)!;

    const groupDoc = await groupsCollection(user.orgId, boardId).doc(groupId).get();
    if (!groupDoc.exists) return res.status(404).json({ message: 'Group not found.' });
    const group = snapshotToData<DBGroup>(groupDoc)!;

    const memberDoc = await boardMembersCollection(user.orgId, boardId).doc(user.id).get();
    const memberData = memberDoc.exists ? memberDoc.data() as DBBoardMember : null;
    assertGroupAccess(user, group, 'delete', board.createdBy, memberData, board.workspaceId);

    await groupsCollection(user.orgId, boardId).doc(groupId).delete();
    touchBoardVersion(user.orgId, boardId);
    void revokeWebhookForGroup(user.orgId, groupId);

    void logAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'DELETE',
      resourceType: 'group',
      resourceId: groupId,
      workspaceId: user.orgId,
      orgId: user.orgId,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    res.status(204).send();
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error(`Error deleting group ${req.params.groupId}:`, err);
    res.status(500).json({ message: 'Failed to delete group.' });
  }
};

// ---------------------------------------------------------------------------
// PATCH /boards/:boardId/groups/:groupId/archive
// ---------------------------------------------------------------------------
export const archiveGroup = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const { boardId, groupId } = req.params;

  try {
    const boardDoc = await boardsCollection(user.orgId).doc(boardId).get();
    if (!boardDoc.exists) return res.status(404).json({ message: 'Board not found.' });
    const board = snapshotToData<DBBoard>(boardDoc)!;

    const groupDoc = await groupsCollection(user.orgId, boardId).doc(groupId).get();
    if (!groupDoc.exists) return res.status(404).json({ message: 'Group not found.' });
    const group = snapshotToData<DBGroup>(groupDoc)!;

    const memberDoc = await boardMembersCollection(user.orgId, boardId).doc(user.id).get();
    const memberData = memberDoc.exists ? memberDoc.data() as DBBoardMember : null;
    assertGroupAccess(user, group, 'archive', board.createdBy, memberData, board.workspaceId);

    await groupsCollection(user.orgId, boardId).doc(groupId).update({
      isArchived: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    touchBoardVersion(user.orgId, boardId);
    void revokeWebhookForGroup(user.orgId, groupId);

    void logAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'UPDATE',
      resourceType: 'group',
      resourceId: groupId,
      workspaceId: user.orgId,
      orgId: user.orgId,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    res.json({ message: 'Group archived.' });
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error(`Error archiving group ${req.params.groupId}:`, err);
    res.status(500).json({ message: 'Failed to archive group.' });
  }
};

// ---------------------------------------------------------------------------
// PATCH /boards/:boardId/groups/:groupId/restore
// ---------------------------------------------------------------------------
export const restoreGroup = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const { boardId, groupId } = req.params;

  try {
    const boardDoc = await boardsCollection(user.orgId).doc(boardId).get();
    if (!boardDoc.exists) return res.status(404).json({ message: 'Board not found.' });
    const board = snapshotToData<DBBoard>(boardDoc)!;

    const groupDoc = await groupsCollection(user.orgId, boardId).doc(groupId).get();
    if (!groupDoc.exists) return res.status(404).json({ message: 'Group not found.' });
    const group = snapshotToData<DBGroup>(groupDoc)!;

    const memberDoc = await boardMembersCollection(user.orgId, boardId).doc(user.id).get();
    const memberData = memberDoc.exists ? memberDoc.data() as DBBoardMember : null;
    assertGroupAccess(user, group, 'archive', board.createdBy, memberData, board.workspaceId);

    await groupsCollection(user.orgId, boardId).doc(groupId).update({
      isArchived: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    touchBoardVersion(user.orgId, boardId);

    void logAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'UPDATE',
      resourceType: 'group',
      resourceId: groupId,
      workspaceId: user.orgId,
      orgId: user.orgId,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    const updated = snapshotToData<DBGroup>(await groupsCollection(user.orgId, boardId).doc(groupId).get());
    res.json(updated);
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error(`Error restoring group ${req.params.groupId}:`, err);
    res.status(500).json({ message: 'Failed to restore group.' });
  }
};

// ---------------------------------------------------------------------------
// POST /boards/:boardId/groups/:groupId/duplicate
// body: { mode: 'with_data' | 'without_data' | 'empty' }
//   with_data    — copy items and their column values
//   without_data — copy items (rows), but with empty column values
//   empty        — don't copy any items, just the (empty) group itself
// ---------------------------------------------------------------------------
export const duplicateGroup = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const { boardId, groupId } = req.params;
  const mode = req.body?.mode === 'with_data' || req.body?.mode === 'without_data' ? req.body.mode : 'empty';
  const copyItems = mode === 'with_data' || mode === 'without_data';

  try {
    const boardDoc = await boardsCollection(user.orgId).doc(boardId).get();
    if (!boardDoc.exists) return res.status(404).json({ message: 'Board not found.' });
    const board = snapshotToData<DBBoard>(boardDoc)!;

    const groupDoc = await groupsCollection(user.orgId, boardId).doc(groupId).get();
    if (!groupDoc.exists) return res.status(404).json({ message: 'Group not found.' });
    const group = snapshotToData<DBGroup>(groupDoc)!;

    const memberDoc = await boardMembersCollection(user.orgId, boardId).doc(user.id).get();
    const memberData = memberDoc.exists ? memberDoc.data() as DBBoardMember : null;
    assertGroupAccess(user, group, 'create', board.createdBy, memberData, board.workspaceId);

    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const newGroupRef = groupsCollection(user.orgId, boardId).doc();
    await newGroupRef.set({
      id: newGroupRef.id,
      workspaceId: group.workspaceId,
      boardId,
      name: `${group.name} (copy)`,
      color: group.color ?? null,
      // Sits immediately after the source group without renumbering any others.
      order: (typeof group.order === 'number' ? group.order : 0) + 0.5,
      isCollapsed: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    if (copyItems) {
      const itemsSnap = await itemsCollection(user.orgId)
        .where('boardId', '==', boardId)
        .where('groupId', '==', groupId)
        .where('isArchived', '==', false)
        .get();

      if (!itemsSnap.empty) {
        const BATCH_SIZE = 400;
        let batch = db.batch();
        let count = 0;

        for (const itemDoc of itemsSnap.docs) {
          const itemData = snapshotToData<DBItem>(itemDoc)!;
          const newItemRef = itemsCollection(user.orgId).doc();
          batch.set(newItemRef, {
            ...itemData,
            id: newItemRef.id,
            groupId: newGroupRef.id,
            createdBy: user.id,
            chatMessageCount: 0,
            chatLastMessageAt: null,
            chatSeenBy: {},
            createdAt: timestamp,
            updatedAt: timestamp,
            ...(mode === 'without_data' ? { values: {}, status: null, assignees: [], dueDate: null } : {}),
          });
          count++;
          if (count % BATCH_SIZE === 0) {
            await batch.commit();
            batch = db.batch();
          }
        }
        if (count % BATCH_SIZE !== 0) await batch.commit();
      }
    }

    touchBoardVersion(user.orgId, boardId);

    void logAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'CREATE',
      resourceType: 'group',
      resourceId: newGroupRef.id,
      workspaceId: user.orgId,
      orgId: user.orgId,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    const created = snapshotToData<DBGroup>(await newGroupRef.get());
    res.status(201).json(created);
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error(`Error duplicating group ${req.params.groupId}:`, err);
    res.status(500).json({ message: 'Failed to duplicate group.' });
  }
};

/** A batch target: an item document ref plus which PERSON column id(s) on it to write. */
interface AssignTarget {
  ref: FirebaseFirestore.DocumentReference;
  data: DBItem;
  columnIds: string[];
}

/** Finds every subitem beneath the given top-level item ids, paired with whichever PERSON
 *  column(s) exist on their own subitem group (subitem columns are scoped per parent item via
 *  parentGroupId, not shared board-wide, so this is looked up group by group). Items with no
 *  subitems, or whose subitem group has no PERSON column, contribute nothing. */
async function findSubitemTargets(orgId: string, boardId: string, topItemIds: string[]): Promise<AssignTarget[]> {
  if (topItemIds.length === 0) return [];

  const subitemGroupDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (const idChunk of chunk(topItemIds)) {
    const snap = await groupsCollection(orgId, boardId).where('parentItemId', 'in', idChunk).get();
    subitemGroupDocs.push(...snap.docs);
  }
  const subitemGroupIds = subitemGroupDocs.map((d) => d.id);
  if (subitemGroupIds.length === 0) return [];

  const personColumnIdsByGroup = new Map<string, string[]>();
  for (const idChunk of chunk(subitemGroupIds)) {
    const snap = await columnsCollection(orgId, boardId).where('parentGroupId', 'in', idChunk).get();
    for (const doc of snap.docs) {
      const col = doc.data() as DBColumn;
      if (col.type !== ColumnType.PERSON || !col.parentGroupId) continue;
      const list = personColumnIdsByGroup.get(col.parentGroupId) ?? [];
      list.push(col.id);
      personColumnIdsByGroup.set(col.parentGroupId, list);
    }
  }
  const groupIdsWithPerson = [...personColumnIdsByGroup.keys()];
  if (groupIdsWithPerson.length === 0) return [];

  const targets: AssignTarget[] = [];
  for (const idChunk of chunk(groupIdsWithPerson)) {
    const snap = await itemsCollection(orgId)
      .where('boardId', '==', boardId)
      .where('groupId', 'in', idChunk)
      .where('isArchived', '==', false)
      .get();
    for (const doc of snap.docs) {
      const data = doc.data() as DBItem;
      const columnIds = personColumnIdsByGroup.get(data.groupId) ?? [];
      if (columnIds.length > 0) targets.push({ ref: doc.ref, data, columnIds });
    }
  }
  return targets;
}

// ---------------------------------------------------------------------------
// POST /boards/:boardId/groups/:groupId/assign-users
//
// Bulk-sets a PERSON column to the same list of users on every (non-archived) item currently in
// this group, AND on the equivalent PERSON column(s) of each of those items' subitems — the
// "assign a user to a whole group at once" action from the group's context menu, instead of
// doing it item by item (and subitem by subitem). Also records the action under
// assignedByColumn on the group itself purely so the group title row can keep showing who was
// bulk-assigned via which column; that record is a snapshot of this action, not a live rollup of
// each item's current value (an item can still be edited individually afterward without it
// changing what the header shows).
// ---------------------------------------------------------------------------
export const assignGroupUsers = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const { boardId, groupId } = req.params;
  const { columnId, userIds } = req.body;

  if (typeof columnId !== 'string' || !columnId) {
    return res.status(400).json({ message: 'columnId is required.' });
  }
  if (!Array.isArray(userIds) || !userIds.every((v) => typeof v === 'string')) {
    return res.status(400).json({ message: 'userIds must be an array of user id strings.' });
  }

  try {
    const boardDoc = await boardsCollection(user.orgId).doc(boardId).get();
    if (!boardDoc.exists) return res.status(404).json({ message: 'Board not found.' });
    const board = snapshotToData<DBBoard>(boardDoc)!;

    const groupDoc = await groupsCollection(user.orgId, boardId).doc(groupId).get();
    if (!groupDoc.exists) return res.status(404).json({ message: 'Group not found.' });
    const group = snapshotToData<DBGroup>(groupDoc)!;

    const memberDoc = await boardMembersCollection(user.orgId, boardId).doc(user.id).get();
    const memberData = memberDoc.exists ? memberDoc.data() as DBBoardMember : null;
    assertGroupAccess(user, group, 'update', board.createdBy, memberData, board.workspaceId);

    const colDoc = await columnsCollection(user.orgId, boardId).doc(columnId).get();
    if (!colDoc.exists) return res.status(404).json({ message: 'Column not found.' });
    const column = snapshotToData<DBColumn>(colDoc)!;
    if (column.type !== ColumnType.PERSON) {
      return res.status(400).json({ message: `Column "${column.name}" is not a Person column.` });
    }

    const itemsSnap = await itemsCollection(user.orgId)
      .where('boardId', '==', boardId)
      .where('groupId', '==', groupId)
      .where('isArchived', '==', false)
      .get();

    const topTargets: AssignTarget[] = itemsSnap.docs.map((doc) => ({
      ref: doc.ref,
      data: doc.data() as DBItem,
      columnIds: [columnId],
    }));
    const subitemTargets = await findSubitemTargets(user.orgId, boardId, itemsSnap.docs.map((d) => d.id));
    const allTargets = [...topTargets, ...subitemTargets];

    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    if (allTargets.length > 0) {
      const BATCH_SIZE = 400;
      let batch = db.batch();
      let count = 0;
      for (const { ref, data, columnIds } of allTargets) {
        // Mirror the same top-level fields a single-item PATCH computes for a PERSON column
        // edit (see item.controller.ts's computeMirroredFields) — Personal Hub finds a user's
        // items via `assignees array-contains` and orders them by lastAssignedAt, neither of
        // which lives under `values`, so writing only values.<columnId> here (as this endpoint
        // originally did) assigned the column but left it invisible in the assignee's hub.
        const previousAssignees = data.assignees ?? [];
        const hasNewAssignee = userIds.some((uid: string) => !previousAssignees.includes(uid));
        const patch: Record<string, unknown> = {
          assignees: userIds,
          updatedAt: timestamp,
          ...(hasNewAssignee ? { lastAssignedAt: timestamp } : {}),
        };
        for (const cid of columnIds) patch[`values.${cid}`] = userIds;
        batch.update(ref, patch);
        count++;
        if (count % BATCH_SIZE === 0) {
          await batch.commit();
          batch = db.batch();
        }
      }
      if (count % BATCH_SIZE !== 0) await batch.commit();
    }

    // Users newly added by this action, judged against this column's *previous* bulk-assign
    // record (not each item's own prior assignees — this is a group-level action, so it gets one
    // notification per newly-added person regardless of how many items/subitems they landed on).
    const previousForColumn = group.assignedByColumn?.[columnId] ?? [];
    const newAssignees = userIds.filter((uid: string) => !previousForColumn.includes(uid) && uid !== user.id);

    const nextAssignedByColumn = { ...(group.assignedByColumn ?? {}) };
    if (userIds.length > 0) nextAssignedByColumn[columnId] = userIds;
    else delete nextAssignedByColumn[columnId];

    await groupsCollection(user.orgId, boardId).doc(groupId).update({
      assignedByColumn: nextAssignedByColumn,
      updatedAt: timestamp,
    });

    touchBoardVersion(user.orgId, boardId);

    void logAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'UPDATE',
      resourceType: 'group',
      resourceId: groupId,
      workspaceId: user.orgId,
      orgId: user.orgId,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    const itemCount = allTargets.length;

    // Email newly-added assignees (fire-and-forget; does not block the response).
    if (newAssignees.length > 0) {
      void (async () => {
        try {
          const [actorName, boardName, organizationName] = await Promise.all([
            getActorName(user.id),
            getBoardName(user.orgId, boardId),
            getOrganizationName(user.orgId),
          ]);
          await Promise.all(newAssignees.map(async (recipientId: string) => {
            const userDoc = await usersCollection.doc(recipientId).get();
            if (!userDoc.exists) return;
            const recipient = userDoc.data() as DBUser;
            if (!recipient.email) return;
            await sendBulkAssignmentEmail(recipient.email, recipient.name ?? recipient.email, actorName, group.name, boardName, itemCount, organizationName);
          }));
        } catch (err) {
          logger.warn('Failed to send bulk assignment email(s):', err);
        }
      })();
    }

    const updated = snapshotToData<DBGroup>(
      await groupsCollection(user.orgId, boardId).doc(groupId).get(),
    );
    res.json({ group: updated, itemCount });
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error(`Error assigning users for group ${req.params.groupId}:`, err);
    res.status(500).json({ message: 'Failed to assign users.' });
  }
};

// ---------------------------------------------------------------------------
// POST /boards/:boardId/groups/:groupId/unassign-user
//
// Removes one user from one or more PERSON columns' bulk-assigned list, for every item and
// subitem currently in the group — the inverse of assign-users. Only removes that one user's id
// from the existing array on each item (not a full replace), so anyone else already assigned
// via that column stays assigned.
// ---------------------------------------------------------------------------
export const unassignGroupUser = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const { boardId, groupId } = req.params;
  const { userId, columnIds } = req.body;

  if (typeof userId !== 'string' || !userId) {
    return res.status(400).json({ message: 'userId is required.' });
  }
  if (!Array.isArray(columnIds) || columnIds.length === 0 || !columnIds.every((v) => typeof v === 'string')) {
    return res.status(400).json({ message: 'columnIds must be a non-empty array of column id strings.' });
  }

  try {
    const boardDoc = await boardsCollection(user.orgId).doc(boardId).get();
    if (!boardDoc.exists) return res.status(404).json({ message: 'Board not found.' });
    const board = snapshotToData<DBBoard>(boardDoc)!;

    const groupDoc = await groupsCollection(user.orgId, boardId).doc(groupId).get();
    if (!groupDoc.exists) return res.status(404).json({ message: 'Group not found.' });
    const group = snapshotToData<DBGroup>(groupDoc)!;

    const memberDoc = await boardMembersCollection(user.orgId, boardId).doc(user.id).get();
    const memberData = memberDoc.exists ? memberDoc.data() as DBBoardMember : null;
    assertGroupAccess(user, group, 'update', board.createdBy, memberData, board.workspaceId);

    // Validate every requested column is actually a PERSON column on this board — otherwise a
    // bad id here would overwrite some other column's value with `[]` below (Array.isArray on a
    // non-array value just yields the empty-array fallback, then gets written straight back).
    const requestedColumnIds = [...new Set(columnIds as string[])];
    const columnIdSet = new Set<string>();
    for (const idChunk of chunk(requestedColumnIds)) {
      const snap = await columnsCollection(user.orgId, boardId).where(admin.firestore.FieldPath.documentId(), 'in', idChunk).get();
      for (const doc of snap.docs) {
        if ((doc.data() as DBColumn).type === ColumnType.PERSON) columnIdSet.add(doc.id);
      }
    }
    if (columnIdSet.size === 0) {
      return res.status(400).json({ message: 'None of the given columnIds are Person columns on this board.' });
    }

    const itemsSnap = await itemsCollection(user.orgId)
      .where('boardId', '==', boardId)
      .where('groupId', '==', groupId)
      .where('isArchived', '==', false)
      .get();

    const topTargets: AssignTarget[] = itemsSnap.docs
      .map((doc) => ({ ref: doc.ref, data: doc.data() as DBItem, columnIds: [...columnIdSet] }));
    const subitemTargetsAll = await findSubitemTargets(user.orgId, boardId, itemsSnap.docs.map((d) => d.id));
    // Only touch a subitem's columns that are actually named in this removal request.
    const subitemTargets = subitemTargetsAll
      .map((t) => ({ ...t, columnIds: t.columnIds.filter((cid) => columnIdSet.has(cid)) }))
      .filter((t) => t.columnIds.length > 0);
    const allTargets = [...topTargets, ...subitemTargets];

    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    if (allTargets.length > 0) {
      const BATCH_SIZE = 400;
      let batch = db.batch();
      let count = 0;
      for (const { ref, data, columnIds: targetColumnIds } of allTargets) {
        const patch: Record<string, unknown> = { updatedAt: timestamp };
        let touchedAssignees = false;
        for (const cid of targetColumnIds) {
          const current = Array.isArray(data.values?.[cid]) ? (data.values[cid] as string[]) : [];
          if (!current.includes(userId)) continue;
          patch[`values.${cid}`] = current.filter((id) => id !== userId);
          touchedAssignees = true;
        }
        if (!touchedAssignees) continue;
        // The top-level `assignees` mirror only ever reflects one column at a time (whichever
        // was written most recently — see computeMirroredFields), so only clear this user out of
        // it when they're the one currently mirrored there; leave it alone otherwise.
        if ((data.assignees ?? []).includes(userId)) {
          patch.assignees = (data.assignees ?? []).filter((id) => id !== userId);
        }
        batch.update(ref, patch);
        count++;
        if (count % BATCH_SIZE === 0) {
          await batch.commit();
          batch = db.batch();
        }
      }
      if (count % BATCH_SIZE !== 0) await batch.commit();
    }

    const nextAssignedByColumn = { ...(group.assignedByColumn ?? {}) };
    for (const cid of columnIdSet) {
      const remaining = (nextAssignedByColumn[cid] ?? []).filter((id) => id !== userId);
      if (remaining.length > 0) nextAssignedByColumn[cid] = remaining;
      else delete nextAssignedByColumn[cid];
    }

    await groupsCollection(user.orgId, boardId).doc(groupId).update({
      assignedByColumn: nextAssignedByColumn,
      updatedAt: timestamp,
    });

    touchBoardVersion(user.orgId, boardId);

    void logAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'UPDATE',
      resourceType: 'group',
      resourceId: groupId,
      workspaceId: user.orgId,
      orgId: user.orgId,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    const updated = snapshotToData<DBGroup>(
      await groupsCollection(user.orgId, boardId).doc(groupId).get(),
    );
    res.json({ group: updated });
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error(`Error removing user for group ${req.params.groupId}:`, err);
    res.status(500).json({ message: 'Failed to remove user.' });
  }
};
