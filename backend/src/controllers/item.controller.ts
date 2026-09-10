import type { Request, Response } from 'express';
import * as logger from 'firebase-functions/logger';
import admin from 'firebase-admin';
import { db, storage, querySnapshotToArray, snapshotToData } from '../services/firestore.service.js';
import { itemsCollection, columnsCollection, boardMembersCollection, notificationsCollection, usersCollection, boardsCollection, organizationsCollection } from '../db/collections.js';
import { JwtUserPayload, DBItem, DBColumn, DBUser, DBBoard, DBBoardMember, ColumnType, NotificationType } from '../types/index.js';
import { sanitizeText } from '../utils/sanitizer.js';
import { logAudit, logAuditAndCheckAnomaly, getClientIp } from '../services/audit.service.js';
import {
  assertItemAccess,
  canAccessItem,
  validateItemOwnershipChain,
} from '../utils/workManagementAuth.js';
import { validateColumnValue } from '../utils/columnValidator.js';
import { ALLOWED_ATTACHMENT_MIME_TYPES, buildContentDisposition } from '../utils/allowedFileTypes.js';
import { parsePaginationParams, applyPagination, buildPaginatedResult } from '../utils/pagination.js';
import { touchBoardVersion } from '../services/boardVersion.service.js';
import { sendItemAssignmentEmail } from '../services/email.service.js';

function isAuthError(err: unknown): err is { status: number; message: string } {
  return typeof err === 'object' && err !== null && 'status' in err && 'message' in err;
}

/**
 * Validates column values against their column definitions.
 * Returns an error message string if validation fails, null if all valid.
 */
async function validateItemValues(
  workspaceId: string,
  boardId: string,
  values: Record<string, unknown>,
): Promise<string | null> {
  const columnIds = Object.keys(values);
  if (columnIds.length === 0) return null;

  // Firestore 'in' operator supports up to 30 values
  const batchIds = columnIds.slice(0, 30);
  const columnsSnap = await columnsCollection(workspaceId, boardId)
    .where(admin.firestore.FieldPath.documentId(), 'in', batchIds)
    .get();

  const columnMap = new Map<string, DBColumn>();
  for (const doc of columnsSnap.docs) {
    columnMap.set(doc.id, doc.data() as DBColumn);
  }

  for (const columnId of batchIds) {
    const column = columnMap.get(columnId);
    if (!column) {
      return `Column "${columnId}" not found in this board.`;
    }
    const result = validateColumnValue(column, values[columnId]);
    if (!result.valid) return result.error ?? `Invalid value for column "${columnId}".`;
  }

  return null;
}

/**
 * Scans new column values and computes mirrored top-level fields:
 *   STATUS  → item.status (first STATUS column found)
 *   PERSON  → item.assignees (first PERSON column found)
 *   DATE    → item.dueDate (first DATE column found)
 */
async function computeMirroredFields(
  workspaceId: string,
  boardId: string,
  values: Record<string, unknown>,
): Promise<{ status?: string; assignees?: string[]; dueDate?: unknown }> {
  const mirrors: { status?: string; assignees?: string[]; dueDate?: unknown } = {};
  const columnIds = Object.keys(values);
  if (columnIds.length === 0) return mirrors;

  const batchIds = columnIds.slice(0, 30);
  const columnsSnap = await columnsCollection(workspaceId, boardId)
    .where(admin.firestore.FieldPath.documentId(), 'in', batchIds)
    .get();

  for (const doc of columnsSnap.docs) {
    const col = doc.data() as DBColumn;
    const value = values[col.id];
    if (value === undefined || value === null) continue;

    if (col.type === ColumnType.STATUS && mirrors.status === undefined && typeof value === 'string') {
      mirrors.status = value;
    } else if (col.type === ColumnType.PERSON && mirrors.assignees === undefined && Array.isArray(value)) {
      mirrors.assignees = value as string[];
    } else if (col.type === ColumnType.DATE && mirrors.dueDate === undefined) {
      mirrors.dueDate = value;
    }
  }

  return mirrors;
}

// ---------------------------------------------------------------------------
// Notification helpers (fire-and-forget)
// ---------------------------------------------------------------------------

function extractMentions(text: string): string[] {
  const matches = text.match(/@[a-zA-Z0-9_-]+/g) ?? [];
  return matches.map((m) => m.slice(1));
}

async function getActorName(actorId: string): Promise<string> {
  const doc = await usersCollection.doc(actorId).get();
  return doc.exists ? (doc.data() as DBUser).name : actorId;
}

async function getBoardName(orgId: string, boardId: string): Promise<string> {
  const doc = await boardsCollection(orgId).doc(boardId).get();
  return doc.exists ? (doc.data() as DBBoard).name : boardId;
}

async function getOrganizationName(orgId: string): Promise<string> {
  const doc = await organizationsCollection.doc(orgId).get();
  return doc.exists ? (doc.data()?.name || 'Logyx') : 'Logyx';
}

function triggerItemNotifications(
  orgId: string,
  actorId: string,
  actorName: string,
  item: DBItem,
  boardName: string,
  previousAssignees: string[],
): void {
  const timestamp = admin.firestore.FieldValue.serverTimestamp();

  // Assignment notifications: newly added assignees (not self)
  const currentAssignees = item.assignees ?? [];
  const addedAssignees = currentAssignees.filter(
    (id) => !previousAssignees.includes(id) && id !== actorId,
  );
  for (const recipientId of addedAssignees) {
    void notificationsCollection(orgId).add({
      recipientId,
      actorId,
      actorName,
      type: 'assignment' as NotificationType,
      resourceType: 'item',
      resourceId: item.id,
      resourceName: item.name,
      boardId: item.boardId,
      boardName,
      read: false,
      workspaceId: orgId,
      createdAt: timestamp,
    }).catch((err) => logger.warn('Failed to create assignment notification:', err));

    // Email the newly assigned user (fire-and-forget; does not block the response)
    void (async () => {
      try {
        const userDoc = await usersCollection.doc(recipientId).get();
        if (!userDoc.exists) return;
        const recipient = userDoc.data() as DBUser;
        if (!recipient.email) return;
        const organizationName = await getOrganizationName(orgId);
        await sendItemAssignmentEmail(recipient.email, recipient.name ?? recipient.email, actorName, item.name, boardName, organizationName);
      } catch (err) {
        logger.warn('Failed to send assignment email:', err);
      }
    })();
  }

  // Mention notifications: @userId patterns in name and text column values
  const mentionedIds = new Set<string>();
  for (const id of extractMentions(item.name)) mentionedIds.add(id);
  for (const v of Object.values(item.values)) {
    if (typeof v === 'string') {
      for (const id of extractMentions(v)) mentionedIds.add(id);
    }
  }
  for (const recipientId of mentionedIds) {
    if (recipientId === actorId) continue;
    void notificationsCollection(orgId).add({
      recipientId,
      actorId,
      actorName,
      type: 'mention' as NotificationType,
      resourceType: 'item',
      resourceId: item.id,
      resourceName: item.name,
      boardId: item.boardId,
      boardName,
      read: false,
      workspaceId: orgId,
      createdAt: timestamp,
    }).catch((err) => logger.warn('Failed to create mention notification:', err));
  }
}

// ---------------------------------------------------------------------------
// POST /items
// ---------------------------------------------------------------------------
export const createItem = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const {
    name,
    workspaceId,
    boardId,
    groupId,
    order,
    values,
    assignees,
    status,
    dueDate,
  } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ message: 'Item name is required.' });
  }
  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ message: 'workspaceId is required.' });
  }
  if (!boardId || typeof boardId !== 'string') {
    return res.status(400).json({ message: 'boardId is required.' });
  }
  if (!groupId || typeof groupId !== 'string') {
    return res.status(400).json({ message: 'groupId is required.' });
  }

  try {
    // Validate the full ownership chain (org → board → workspace → group)
    const chain = await validateItemOwnershipChain(user.orgId, workspaceId, boardId, groupId);
    if (!chain.valid) return res.status(400).json({ message: chain.error });

    // Validate column values if provided
    const normalizedValues: Record<string, unknown> = values && typeof values === 'object' ? values : {};
    if (Object.keys(normalizedValues).length > 0) {
      const valError = await validateItemValues(user.orgId, boardId, normalizedValues);
      if (valError) return res.status(400).json({ message: valError });
    }

    // Compute mirrored fields from column values
    const mirrored = await computeMirroredFields(user.orgId, boardId, normalizedValues);

    // Fetch board membership for calling user
    const memberDoc = await boardMembersCollection(user.orgId, boardId).doc(user.id).get();
    const memberData = memberDoc.exists ? memberDoc.data() as DBBoardMember : null;

    // Build a provisional item to check create permission
    const provisionalItem: DBItem = {
      id: '',
      workspaceId,
      boardId,
      groupId,
      name: sanitizeText(name),
      order: typeof order === 'number' ? order : 0,
      createdBy: user.id,
      isArchived: false,
      values: normalizedValues,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    assertItemAccess(user, provisionalItem, 'create', memberData);

    // Auto-calculate order if not provided
    let itemOrder = typeof order === 'number' ? order : null;
    if (itemOrder === null) {
      const countSnap = await itemsCollection(user.orgId)
        .where('boardId', '==', boardId)
        .where('groupId', '==', groupId)
        .count()
        .get();
      itemOrder = countSnap.data().count;
    }

    const docRef = itemsCollection(user.orgId).doc();
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const itemData: Record<string, unknown> = {
      id: docRef.id,
      workspaceId,
      boardId,
      groupId,
      name: sanitizeText(name),
      order: itemOrder,
      createdBy: user.id,
      isArchived: false,
      values: normalizedValues,
      // Explicit top-level fields take precedence over mirrored ones
      status: status ?? mirrored.status ?? null,
      assignees: assignees ?? mirrored.assignees ?? [],
      dueDate: dueDate ?? mirrored.dueDate ?? null,
      lastAssignedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await docRef.set(itemData);
    touchBoardVersion(user.orgId, boardId);

    const created = snapshotToData<DBItem>(await docRef.get())!;

    void logAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'CREATE',
      resourceType: 'item',
      resourceId: docRef.id,
      workspaceId: user.orgId,
      orgId: user.orgId,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    // Trigger assignment & mention notifications (fire-and-forget)
    void (async () => {
      const boardName = (chain.board as { name?: string })?.name ?? boardId;
      const actorName = await getActorName(user.id);
      triggerItemNotifications(user.orgId, user.id, actorName, created, boardName, []);
    })();

    res.status(201).json(created);
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error('Error creating item:', err);
    res.status(500).json({ message: 'Failed to create item.' });
  }
};

// ---------------------------------------------------------------------------
// GET /items
// ---------------------------------------------------------------------------
export const getItems = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const {
    boardId,
    groupId,
    workspaceId,
    assignee,
    status,
    dueDateFrom,
    dueDateTo,
    includeArchived,
  } = req.query;

  try {
    let query: admin.firestore.Query = itemsCollection(user.orgId);

    // Tenant isolation is implicit via itemsCollection(user.orgId)

    if (boardId && typeof boardId === 'string') {
      query = query.where('boardId', '==', boardId);
    }
    if (groupId && typeof groupId === 'string') {
      query = query.where('groupId', '==', groupId);
    }
    if (workspaceId && typeof workspaceId === 'string') {
      query = query.where('workspaceId', '==', workspaceId);
    }
    if (assignee && typeof assignee === 'string') {
      query = query.where('assignees', 'array-contains', assignee);
    }
    if (status && typeof status === 'string') {
      query = query.where('status', '==', status);
    }
    if (dueDateFrom && typeof dueDateFrom === 'string') {
      const from = new Date(dueDateFrom);
      if (!isNaN(from.getTime())) query = query.where('dueDate', '>=', from);
    }
    if (dueDateTo && typeof dueDateTo === 'string') {
      const to = new Date(dueDateTo);
      if (!isNaN(to.getTime())) query = query.where('dueDate', '<=', to);
    }
    if (includeArchived !== 'true') {
      query = query.where('isArchived', '==', false);
    }

    query = query.orderBy('order');

    const paginationParams = parsePaginationParams(req);

    // When fetching a specific group, include total count so the UI can display "Page X of Y"
    let totalCount: number | undefined;
    if (groupId && typeof groupId === 'string') {
      const countSnap = await query.count().get();
      totalCount = countSnap.data().count;
    }

    const { paginatedQuery, limit } = await applyPagination(
      query,
      itemsCollection(user.orgId),
      paginationParams,
    );

    const snapshot = await paginatedQuery.get();
    const rawItems = querySnapshotToArray<DBItem>(snapshot);
    const allItems = rawItems.filter((item) => canAccessItem(user, item, 'read'));

    // Debug: log when items are filtered out so we can diagnose access issues
    if (rawItems.length !== allItems.length) {
      const passedItems = allItems.map(i => ({
        id: i.id,
        boardId: i.boardId,
        workspaceId: i.workspaceId,
        assignees: i.assignees ?? [],
        createdBy: i.createdBy,
      }));
      const filteredItems = rawItems.filter(i => !allItems.includes(i)).map(i => ({
        id: i.id,
        boardId: i.boardId,
        workspaceId: i.workspaceId,
        assignees: i.assignees ?? [],
        createdBy: i.createdBy,
      }));
      logger.warn('[getItems] canAccessItem filtered items', {
        userId: user.id,
        userRole: user.role,
        selectedWorkspaceId: user.selectedWorkspaceId,
        workspacePermissions: user.workspacePermissions,
        boardIds: user.boardIds,
        orgId: user.orgId,
        boardId: boardId ?? null,
        rawCount: rawItems.length,
        passedCount: allItems.length,
        passedItems,
        filteredItems,
      });
    }

    const result = buildPaginatedResult(allItems, limit);
    if (totalCount !== undefined) result.total = totalCount;

    void logAuditAndCheckAnomaly({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'READ',
      resourceType: 'item',
      resourceId: 'list',
      workspaceId: user.orgId,
      orgId: user.orgId,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    res.json(result);
  } catch (err: unknown) {
    logger.error('Error fetching items:', err);
    res.status(500).json({ message: 'Failed to fetch items.' });
  }
};

// ---------------------------------------------------------------------------
// GET /items/:id
// ---------------------------------------------------------------------------
export const getItemById = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const { id } = req.params;

  try {
    const doc = await itemsCollection(user.orgId).doc(id).get();
    if (!doc.exists) return res.status(404).json({ message: 'Item not found.' });

    const item = snapshotToData<DBItem>(doc)!;
    assertItemAccess(user, item, 'read');

    void logAuditAndCheckAnomaly({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'READ',
      resourceType: 'item',
      resourceId: id,
      workspaceId: user.orgId,
      orgId: user.orgId,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    res.json(item);
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error(`Error fetching item ${req.params.id}:`, err);
    res.status(500).json({ message: 'Failed to fetch item.' });
  }
};

// ---------------------------------------------------------------------------
// PATCH /items/reorder   (must be registered BEFORE /:id to avoid route conflict)
// ---------------------------------------------------------------------------
export const reorderItems = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const { updates } = req.body;

  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ message: 'updates must be a non-empty array of { id, groupId, order }.' });
  }

  try {
    // Fetch all items in parallel and verify access
    const fetchResults = await Promise.all(
      (updates as { id: string; groupId: string; order: number }[]).map((u) =>
        itemsCollection(user.orgId).doc(u.id).get(),
      ),
    );

    // Fetch board membership once using the first item's boardId (all items typically on same board)
    const firstDoc = fetchResults[0];
    const firstItem = firstDoc.exists ? snapshotToData<DBItem>(firstDoc) : null;
    const reorderMemberDoc = firstItem
      ? await boardMembersCollection(user.orgId, firstItem.boardId).doc(user.id).get()
      : null;
    const reorderMemberData = reorderMemberDoc?.exists ? reorderMemberDoc.data() as DBBoardMember : null;

    const batch = db.batch();
    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    for (let i = 0; i < updates.length; i++) {
      const u = updates[i] as { id: string; groupId: string; order: number };
      if (typeof u.id !== 'string' || typeof u.order !== 'number') {
        return res.status(400).json({ message: 'Each entry must have id (string) and order (number).' });
      }
      const doc = fetchResults[i];
      if (!doc.exists) return res.status(404).json({ message: `Item "${u.id}" not found.` });

      const item = snapshotToData<DBItem>(doc)!;
      assertItemAccess(user, item, 'update', reorderMemberData);

      const updateData: Record<string, unknown> = { order: u.order, updatedAt: timestamp };
      if (typeof u.groupId === 'string') updateData.groupId = u.groupId;
      batch.update(itemsCollection(user.orgId).doc(u.id), updateData);
    }

    await batch.commit();

    if (firstItem) touchBoardVersion(user.orgId, firstItem.boardId);

    res.json({ message: 'Items reordered.' });
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error('Error reordering items:', err);
    res.status(500).json({ message: 'Failed to reorder items.' });
  }
};

// ---------------------------------------------------------------------------
// PATCH /items/:id
// ---------------------------------------------------------------------------
export const updateItem = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const { id } = req.params;
  const { name, groupId, order, values, assignees, status, dueDate, dependencies } = req.body;

  try {
    const doc = await itemsCollection(user.orgId).doc(id).get();
    if (!doc.exists) return res.status(404).json({ message: 'Item not found.' });

    const item = snapshotToData<DBItem>(doc)!;

    const memberDoc = await boardMembersCollection(user.orgId, item.boardId).doc(user.id).get();
    const memberData = memberDoc.exists ? memberDoc.data() as DBBoardMember : null;
    assertItemAccess(user, item, 'update', memberData);

    // If groupId is changing, re-validate the ownership chain
    if (groupId !== undefined && groupId !== item.groupId) {
      const chain = await validateItemOwnershipChain(
        user.orgId,
        item.workspaceId,
        item.boardId,
        groupId,
      );
      if (!chain.valid) return res.status(400).json({ message: chain.error });
    }

    // Validate column values if provided
    const normalizedValues: Record<string, unknown> =
      values && typeof values === 'object' ? values : {};
    if (Object.keys(normalizedValues).length > 0) {
      const valError = await validateItemValues(user.orgId, item.boardId, normalizedValues);
      if (valError) return res.status(400).json({ message: valError });
    }

    // Compute mirrored fields for any new column values
    const mirrored = await computeMirroredFields(user.orgId, item.boardId, normalizedValues);

    const updateData: Record<string, unknown> = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (name !== undefined) updateData.name = sanitizeText(String(name));
    if (groupId !== undefined) updateData.groupId = groupId;
    if (order !== undefined) updateData.order = Number(order);

    // Merge new column values into existing ones
    if (Object.keys(normalizedValues).length > 0) {
      for (const [key, val] of Object.entries(normalizedValues)) {
        updateData[`values.${key}`] = val;
      }
    }

    // Top-level mirror fields: explicit body fields take precedence over auto-mirrored
    if (status !== undefined) updateData.status = status;
    else if (mirrored.status !== undefined) updateData.status = mirrored.status;

    if (assignees !== undefined) updateData.assignees = assignees;
    else if (mirrored.assignees !== undefined) updateData.assignees = mirrored.assignees;

    if (dueDate !== undefined) updateData.dueDate = dueDate;
    else if (mirrored.dueDate !== undefined) updateData.dueDate = mirrored.dueDate;

    if (Array.isArray(dependencies)) updateData.dependencies = dependencies;

    const previousAssignees = item.assignees ?? [];
    const nextAssignees = (updateData.assignees as string[] | undefined) ?? previousAssignees;
    const hasNewAssignee = nextAssignees.some((uid) => !previousAssignees.includes(uid));
    if (hasNewAssignee) updateData.lastAssignedAt = admin.firestore.FieldValue.serverTimestamp();

    await itemsCollection(user.orgId).doc(id).update(updateData);
    touchBoardVersion(user.orgId, item.boardId);
    const updated = snapshotToData<DBItem>(await itemsCollection(user.orgId).doc(id).get())!;

    void logAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'UPDATE',
      resourceType: 'item',
      resourceId: id,
      workspaceId: user.orgId,
      orgId: user.orgId,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    // Trigger assignment & mention notifications (fire-and-forget)
    void (async () => {
      const [actorName, boardName] = await Promise.all([
        getActorName(user.id),
        getBoardName(user.orgId, item.boardId),
      ]);
      triggerItemNotifications(user.orgId, user.id, actorName, updated, boardName, previousAssignees);
    })();

    res.json(updated);
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error(`Error updating item ${req.params.id}:`, err);
    res.status(500).json({ message: 'Failed to update item.' });
  }
};

// ---------------------------------------------------------------------------
// PATCH /items/:id/archive
// ---------------------------------------------------------------------------
export const archiveItem = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const { id } = req.params;

  try {
    const doc = await itemsCollection(user.orgId).doc(id).get();
    if (!doc.exists) return res.status(404).json({ message: 'Item not found.' });

    const item = snapshotToData<DBItem>(doc)!;
    const memberDoc = await boardMembersCollection(user.orgId, item.boardId).doc(user.id).get();
    const memberData = memberDoc.exists ? memberDoc.data() as DBBoardMember : null;
    assertItemAccess(user, item, 'archive', memberData);

    await itemsCollection(user.orgId).doc(id).update({
      isArchived: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    touchBoardVersion(user.orgId, item.boardId);

    void logAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'UPDATE',
      resourceType: 'item',
      resourceId: id,
      workspaceId: user.orgId,
      orgId: user.orgId,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    res.json({ message: 'Item archived.' });
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error(`Error archiving item ${req.params.id}:`, err);
    res.status(500).json({ message: 'Failed to archive item.' });
  }
};

// ---------------------------------------------------------------------------
// PATCH /items/:id/restore
// ---------------------------------------------------------------------------
export const restoreItem = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const { id } = req.params;

  try {
    const doc = await itemsCollection(user.orgId).doc(id).get();
    if (!doc.exists) return res.status(404).json({ message: 'Item not found.' });

    const item = snapshotToData<DBItem>(doc)!;
    const memberDoc = await boardMembersCollection(user.orgId, item.boardId).doc(user.id).get();
    const memberData = memberDoc.exists ? memberDoc.data() as DBBoardMember : null;
    assertItemAccess(user, item, 'archive', memberData);

    await itemsCollection(user.orgId).doc(id).update({
      isArchived: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    touchBoardVersion(user.orgId, item.boardId);

    void logAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'UPDATE',
      resourceType: 'item',
      resourceId: id,
      workspaceId: user.orgId,
      orgId: user.orgId,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    res.json(snapshotToData<DBItem>(await itemsCollection(user.orgId).doc(id).get()));
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error(`Error restoring item ${req.params.id}:`, err);
    res.status(500).json({ message: 'Failed to restore item.' });
  }
};

// ---------------------------------------------------------------------------
// DELETE /items/:id   (hard-delete — WORKSPACE_ADMIN+ only)
// ---------------------------------------------------------------------------
export const deleteItem = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const { id } = req.params;

  try {
    const doc = await itemsCollection(user.orgId).doc(id).get();
    if (!doc.exists) return res.status(404).json({ message: 'Item not found.' });

    const item = snapshotToData<DBItem>(doc)!;
    const memberDoc = await boardMembersCollection(user.orgId, item.boardId).doc(user.id).get();
    const memberData = memberDoc.exists ? memberDoc.data() as DBBoardMember : null;
    assertItemAccess(user, item, 'delete', memberData);

    await itemsCollection(user.orgId).doc(id).delete();
    touchBoardVersion(user.orgId, item.boardId);

    void logAudit({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'DELETE',
      resourceType: 'item',
      resourceId: id,
      workspaceId: user.orgId,
      orgId: user.orgId,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] as string | undefined,
    });

    res.status(204).send();
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error(`Error deleting item ${req.params.id}:`, err);
    res.status(500).json({ message: 'Failed to delete item.' });
  }
};

// ---------------------------------------------------------------------------
// POST /items/:id/files
//
// Uploads one attachment for a FILES column. Same raw-binary + header
// convention as the item chat's file upload (see itemChat.controller.ts):
// the body is the file's bytes, Content-Type is its MIME type, X-Filename
// carries the URL-encoded original filename, and X-Column-Id names which
// FILES column this upload belongs to (there is no JSON body to carry it in).
//
// Returns the full attachment metadata (including uploader identity/time) —
// the frontend appends it to the column's existing array and PATCHes the
// item's values as usual, the same read-append-write flow already used for
// HOURS_LOG entries.
// ---------------------------------------------------------------------------
const MAX_ITEM_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

export const uploadItemFile = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const id = req.params.id;
  const columnId = req.headers['x-column-id'];
  const mimeType = (req.headers['content-type'] || '').split(';')[0].trim();
  const rawFilename = req.headers['x-filename'];
  const filename = typeof rawFilename === 'string'
    ? decodeURIComponent(rawFilename).trim()
    : 'file';

  if (typeof columnId !== 'string' || !columnId) {
    return res.status(400).json({ message: 'X-Column-Id header is required.' });
  }
  if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)) {
    return res.status(400).json({ message: `File type not allowed: ${mimeType}` });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ message: 'No file data received.' });
  }
  if (req.body.length > MAX_ITEM_FILE_SIZE_BYTES) {
    return res.status(400).json({ message: 'File exceeds the 20 MB limit.' });
  }

  try {
    const doc = await itemsCollection(user.orgId).doc(id).get();
    if (!doc.exists) return res.status(404).json({ message: 'Item not found.' });

    const item = snapshotToData<DBItem>(doc)!;
    const memberDoc = await boardMembersCollection(user.orgId, item.boardId).doc(user.id).get();
    const memberData = memberDoc.exists ? memberDoc.data() as DBBoardMember : null;
    assertItemAccess(user, item, 'update', memberData);

    const colDoc = await columnsCollection(user.orgId, item.boardId).doc(columnId).get();
    if (!colDoc.exists) return res.status(404).json({ message: 'Column not found.' });
    const column = snapshotToData<DBColumn>(colDoc)!;
    if (column.type !== ColumnType.FILES) {
      return res.status(400).json({ message: `Column "${column.name}" is not a Files column.` });
    }

    const authorDoc = await usersCollection.doc(user.id).get();
    const authorData = authorDoc.exists ? authorDoc.data() as DBUser : null;

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'file';
    const uniqueId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const storagePath = `itemFiles/${user.orgId}/${id}/${columnId}/${uniqueId}_${safeName}`;
    const storageFile = storage.bucket().file(storagePath);

    await storageFile.save(req.body, {
      metadata: { contentType: mimeType, contentDisposition: buildContentDisposition(filename) },
      public: true,
    });

    res.status(201).json({
      id: uniqueId,
      url: storageFile.publicUrl(),
      name: filename,
      mimeType,
      size: req.body.length,
      uploadedBy: user.id,
      uploadedByName: authorData?.name ?? user.id,
      uploadedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error(`Error uploading file for item ${id}:`, err);
    res.status(500).json({ message: 'Failed to upload file.' });
  }
};
