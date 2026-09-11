import type { Request, Response } from 'express';
import * as logger from 'firebase-functions/logger';
import admin from 'firebase-admin';
import { db, storage, snapshotToData, querySnapshotToArray } from '../services/firestore.service.js';
import { itemsCollection, itemChatMessagesCollection, boardMembersCollection, usersCollection, columnsCollection, organizationsCollection } from '../db/collections.js';
import { JwtUserPayload, DBItem, DBUser, DBBoardMember, DBChatMessage, DBChatAttachment, DBColumn, ColumnType } from '../types/index.js';
import { assertItemAccess } from '../utils/workManagementAuth.js';
import { sendChatMentionEmail } from '../services/email.service.js';
import { ALLOWED_ATTACHMENT_MIME_TYPES, buildContentDisposition } from '../utils/allowedFileTypes.js';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

function isAuthError(err: unknown): err is { status: number; message: string } {
  return typeof err === 'object' && err !== null && 'status' in err && 'message' in err;
}

// ---------------------------------------------------------------------------
// GET /items/:itemId/chat
// ---------------------------------------------------------------------------
export const getChatMessages = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const id = req.params.itemId ?? req.params.id;

  try {
    const doc = await itemsCollection(user.orgId).doc(id).get();
    if (!doc.exists) return res.status(404).json({ message: 'Item not found.' });

    const item = snapshotToData<DBItem>(doc)!;
    const memberDoc = await boardMembersCollection(user.orgId, item.boardId).doc(user.id).get();
    const memberData = memberDoc.exists ? (memberDoc.data() as DBBoardMember) : null;
    assertItemAccess(user, item, 'read', memberData);

    const snap = await itemChatMessagesCollection(user.orgId, id)
      .orderBy('createdAt', 'asc')
      .get();

    res.json(querySnapshotToArray<DBChatMessage>(snap));
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error(`Error fetching chat for item ${req.params.itemId ?? req.params.id}:`, err);
    res.status(500).json({ message: 'Failed to fetch chat messages.' });
  }
};

// ---------------------------------------------------------------------------
// POST /items/:itemId/chat/file
//
// Receives a single file as raw binary (express.raw() in the route).
// Content-Type header = the file's MIME type.
// X-Filename header   = URL-encoded original filename.
//
// Uses the same file.save() + public:true pattern as profile image uploads —
// no signed URL or extra IAM permissions required.
// ---------------------------------------------------------------------------
export const uploadChatFile = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const id = req.params.itemId ?? req.params.id;
  const mimeType = (req.headers['content-type'] || '').split(';')[0].trim();
  const rawFilename = req.headers['x-filename'];
  const filename = typeof rawFilename === 'string'
    ? decodeURIComponent(rawFilename).trim()
    : 'file';

  if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)) {
    return res.status(400).json({ message: `File type not allowed: ${mimeType}` });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ message: 'No file data received.' });
  }
  if (req.body.length > MAX_FILE_SIZE_BYTES) {
    return res.status(400).json({ message: 'File exceeds the 10 MB limit.' });
  }

  try {
    const doc = await itemsCollection(user.orgId).doc(id).get();
    if (!doc.exists) return res.status(404).json({ message: 'Item not found.' });

    const item = snapshotToData<DBItem>(doc)!;
    const memberDoc = await boardMembersCollection(user.orgId, item.boardId).doc(user.id).get();
    const memberData = memberDoc.exists ? (memberDoc.data() as DBBoardMember) : null;
    assertItemAccess(user, item, 'update', memberData);

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'file';
    const uniqueId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const storagePath = `chatFiles/${user.orgId}/${id}/${uniqueId}_${safeName}`;
    const storageFile = storage.bucket().file(storagePath);

    await storageFile.save(req.body, {
      metadata: { contentType: mimeType, contentDisposition: buildContentDisposition(filename) },
      public: true,
    });

    res.status(201).json({
      url: storageFile.publicUrl(),
      name: filename,
      mimeType,
      size: req.body.length,
    });
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error(`Error uploading chat file for item ${id}:`, err);
    res.status(500).json({ message: 'Failed to upload file.' });
  }
};

// ---------------------------------------------------------------------------
// POST /items/:itemId/chat
//
// JSON body: { text: string, attachments?: [{ url, name, mimeType, size }] }
// Files are already in Storage at this point — this endpoint only writes
// metadata to Firestore.
// ---------------------------------------------------------------------------
export const postChatMessage = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const id = req.params.itemId ?? req.params.id;
  const text: string = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  const rawAttachments: DBChatAttachment[] = Array.isArray(req.body.attachments)
    ? req.body.attachments
    : [];
  const mentionedUserIds: string[] = Array.isArray(req.body.mentionedUserIds)
    ? req.body.mentionedUserIds.filter((v: unknown) => typeof v === 'string')
    : [];

  if (!text && rawAttachments.length === 0) {
    return res.status(400).json({ message: 'Message must contain text or at least one attachment.' });
  }
  if (text.length > 4000) {
    return res.status(400).json({ message: 'Message text must be 4000 characters or fewer.' });
  }
  if (rawAttachments.length > 5) {
    return res.status(400).json({ message: 'Maximum 5 attachments per message.' });
  }

  try {
    const doc = await itemsCollection(user.orgId).doc(id).get();
    if (!doc.exists) return res.status(404).json({ message: 'Item not found.' });

    const item = snapshotToData<DBItem>(doc)!;
    const memberDoc = await boardMembersCollection(user.orgId, item.boardId).doc(user.id).get();
    const memberData = memberDoc.exists ? (memberDoc.data() as DBBoardMember) : null;
    assertItemAccess(user, item, 'update', memberData);

    const authorDoc = await usersCollection.doc(user.id).get();
    const authorData = authorDoc.exists ? (authorDoc.data() as DBUser) : null;

    const messageRef = itemChatMessagesCollection(user.orgId, id).doc();
    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    const messageData: Record<string, unknown> = {
      id: messageRef.id,
      itemId: id,
      authorId: user.id,
      authorName: authorData?.name ?? user.id,
      authorProfileImageUrl: authorData?.profileImageUrl ?? '',
      text,
      attachments: rawAttachments,
      createdAt: timestamp,
    };

    const batch = db.batch();
    batch.set(messageRef, messageData);
    batch.update(itemsCollection(user.orgId).doc(id), {
      chatMessageCount: admin.firestore.FieldValue.increment(1),
      chatLastMessageAt: timestamp,
    });
    await batch.commit();

    const created = snapshotToData<DBChatMessage>(await messageRef.get())!;
    res.status(201).json(created);

    // Fire-and-forget email notifications
    void sendChatNotifications(
      user.id,
      user.orgId,
      item,
      text || '[attachment]',
      authorData?.name ?? user.id,
      mentionedUserIds,
    );
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error(`Error posting chat message for item ${req.params.itemId ?? req.params.id}:`, err);
    res.status(500).json({ message: 'Failed to post chat message.' });
  }
};

async function sendChatNotifications(
  senderId: string,
  orgId: string,
  item: DBItem,
  messageText: string,
  senderName: string,
  mentionedUserIds: string[],
): Promise<void> {
  try {
    // Find users assigned via person-type columns
    const columnsSnap = await columnsCollection(orgId, item.boardId)
      .where('type', '==', ColumnType.PERSON)
      .get();

    const assignedUserIds = new Set<string>();
    for (const colDoc of columnsSnap.docs) {
      const col = colDoc.data() as DBColumn;
      const val = item.values[col.id];
      if (Array.isArray(val)) {
        val.forEach((uid) => typeof uid === 'string' && assignedUserIds.add(uid));
      } else if (typeof val === 'string' && val) {
        assignedUserIds.add(val);
      }
    }

    const mentionedSet = new Set(mentionedUserIds.filter((uid) => uid !== senderId));
    // Assigned users that were NOT already @mentioned (to avoid duplicate emails)
    const assignedOnlyIds = [...assignedUserIds].filter(
      (uid) => uid !== senderId && !mentionedSet.has(uid),
    );

    const allRecipientIds = [...mentionedSet, ...assignedOnlyIds];
    if (allRecipientIds.length === 0) return;

    const organizationDoc = await organizationsCollection.doc(orgId).get();
    const organizationName = organizationDoc.exists ? (organizationDoc.data()?.name || 'Logyx') : 'Logyx';

    const userDocs = await Promise.all(allRecipientIds.map((uid) => usersCollection.doc(uid).get()));

    await Promise.all(
      userDocs.map(async (userDoc) => {
        if (!userDoc.exists) return;
        const userData = userDoc.data() as DBUser;
        if (!userData.email) return;

        const pref = userData.notificationPreference ?? 'all';
        const isMentioned = mentionedSet.has(userDoc.id);

        if (pref === 'none') return;
        if (pref === 'mentions_only' && !isMentioned) return;

        await sendChatMentionEmail(
          userData.email,
          userData.name ?? '',
          senderName,
          item.name,
          messageText,
          isMentioned ? 'mention' : 'assigned',
          organizationName,
        );
      }),
    );
  } catch (err) {
    logger.error('Error sending chat notifications:', err);
  }
}

// ---------------------------------------------------------------------------
// DELETE /items/:itemId/chat/:messageId
// Only the original author may delete their own message.
// ---------------------------------------------------------------------------
export const deleteChatMessage = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const itemId = req.params.itemId ?? req.params.id;
  const messageId = req.params.messageId;

  try {
    const itemDoc = await itemsCollection(user.orgId).doc(itemId).get();
    if (!itemDoc.exists) return res.status(404).json({ message: 'Item not found.' });

    const item = snapshotToData<DBItem>(itemDoc)!;
    const memberDoc = await boardMembersCollection(user.orgId, item.boardId).doc(user.id).get();
    const memberData = memberDoc.exists ? (memberDoc.data() as DBBoardMember) : null;
    assertItemAccess(user, item, 'read', memberData);

    const msgRef = itemChatMessagesCollection(user.orgId, itemId).doc(messageId);
    const msgDoc = await msgRef.get();
    if (!msgDoc.exists) return res.status(404).json({ message: 'Message not found.' });

    const msg = snapshotToData<DBChatMessage>(msgDoc)!;
    if (msg.authorId !== user.id) {
      return res.status(403).json({ message: 'You can only delete your own messages.' });
    }

    const batch = db.batch();
    batch.delete(msgRef);
    batch.update(itemsCollection(user.orgId).doc(itemId), {
      chatMessageCount: admin.firestore.FieldValue.increment(-1),
    });
    await batch.commit();

    res.status(200).json({ deleted: true });
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error(`Error deleting chat message ${messageId} for item ${itemId}:`, err);
    res.status(500).json({ message: 'Failed to delete message.' });
  }
};

// ---------------------------------------------------------------------------
// PATCH /items/:itemId/chat/:messageId
// Only the original author may edit their own message.
// ---------------------------------------------------------------------------
export const editChatMessage = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const itemId = req.params.itemId ?? req.params.id;
  const messageId = req.params.messageId;
  const text = typeof req.body.text === 'string' ? req.body.text.trim() : null;

  if (!text) return res.status(400).json({ message: 'Message text is required.' });

  try {
    const itemDoc = await itemsCollection(user.orgId).doc(itemId).get();
    if (!itemDoc.exists) return res.status(404).json({ message: 'Item not found.' });

    const item = snapshotToData<DBItem>(itemDoc)!;
    const memberDoc = await boardMembersCollection(user.orgId, item.boardId).doc(user.id).get();
    const memberData = memberDoc.exists ? (memberDoc.data() as DBBoardMember) : null;
    assertItemAccess(user, item, 'read', memberData);

    const msgRef = itemChatMessagesCollection(user.orgId, itemId).doc(messageId);
    const msgDoc = await msgRef.get();
    if (!msgDoc.exists) return res.status(404).json({ message: 'Message not found.' });

    const msg = snapshotToData<DBChatMessage>(msgDoc)!;
    if (msg.authorId !== user.id) {
      return res.status(403).json({ message: 'You can only edit your own messages.' });
    }

    await msgRef.update({ text, editedAt: admin.firestore.FieldValue.serverTimestamp() });

    const updated = snapshotToData<DBChatMessage>(await msgRef.get())!;
    res.status(200).json(updated);
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error(`Error editing chat message ${messageId} for item ${itemId}:`, err);
    res.status(500).json({ message: 'Failed to edit message.' });
  }
};

// ---------------------------------------------------------------------------
// POST /items/:itemId/chat/seen
// Records that the current user has seen all messages up to the item's
// current chatMessageCount, enabling cross-device unread badge accuracy.
// ---------------------------------------------------------------------------
export const markChatSeen = async (req: Request, res: Response) => {
  const user = req.user as JwtUserPayload;
  const id = req.params.itemId ?? req.params.id;

  try {
    const doc = await itemsCollection(user.orgId).doc(id).get();
    if (!doc.exists) return res.status(404).json({ message: 'Item not found.' });

    const item = snapshotToData<DBItem>(doc)!;
    const memberDoc = await boardMembersCollection(user.orgId, item.boardId).doc(user.id).get();
    const memberData = memberDoc.exists ? (memberDoc.data() as DBBoardMember) : null;
    assertItemAccess(user, item, 'read', memberData);

    const seenCount = item.chatMessageCount ?? 0;
    await itemsCollection(user.orgId).doc(id).update({
      [`chatSeenBy.${user.id}`]: seenCount,
    });

    res.json({ seenCount });
  } catch (err: unknown) {
    if (isAuthError(err)) return res.status(err.status).json({ message: err.message });
    logger.error(`Error marking chat seen for item ${id}:`, err);
    res.status(500).json({ message: 'Failed to mark chat as seen.' });
  }
};
