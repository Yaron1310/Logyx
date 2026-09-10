// Shared lookups for notification/email senders across controllers (item assignment,
// bulk group assignment, ...) — kept in one place so the display names they use stay
// consistent instead of drifting between per-item and bulk code paths.
import { usersCollection, boardsCollection, organizationsCollection } from '../db/collections.js';
import { DBUser, DBBoard } from '../types/index.js';

export async function getActorName(actorId: string): Promise<string> {
  const doc = await usersCollection.doc(actorId).get();
  return doc.exists ? (doc.data() as DBUser).name : actorId;
}

export async function getBoardName(orgId: string, boardId: string): Promise<string> {
  const doc = await boardsCollection(orgId).doc(boardId).get();
  return doc.exists ? (doc.data() as DBBoard).name : boardId;
}

export async function getOrganizationName(orgId: string): Promise<string> {
  const doc = await organizationsCollection.doc(orgId).get();
  return doc.exists ? (doc.data()?.name || 'Logyx') : 'Logyx';
}
