import type { Browser } from 'wxt/browser';
import type { Account, Email } from '@/utils/types.js';

export interface StorageSnapshot {
  inboxes?: Account[];
  storedEmails?: Record<string, Email[]>;
  archivedEmails?: Record<string, Email[]>;
  readEmails?: Record<string, boolean>;
  starredEmails?: string[];
  seenEmailIds?: Record<string, string[]>;
  lastMessageTimestamps?: Record<string, number>;
}

export const SNAPSHOT_KEYS = [
  'inboxes',
  'storedEmails',
  'archivedEmails',
  'readEmails',
  'starredEmails',
  'seenEmailIds',
  'lastMessageTimestamps',
] as const;

export async function captureStorageSnapshot(ext: Browser): Promise<StorageSnapshot> {
  const result = await ext.storage.local.get(SNAPSHOT_KEYS);
  return result as unknown as StorageSnapshot;
}

export async function restoreStorageSnapshot(
  ext: Browser,
  snapshot: StorageSnapshot,
  deletedInboxes: Account[]
): Promise<void> {
  const current = (await ext.storage.local.get([
    'inboxes',
    'storedEmails',
    'archivedEmails',
    'seenEmailIds',
    'lastMessageTimestamps',
  ])) as {
    inboxes?: Account[];
    storedEmails?: Record<string, Email[]>;
    archivedEmails?: Record<string, Email[]>;
    seenEmailIds?: Record<string, string[]>;
    lastMessageTimestamps?: Record<string, number>;
  };

  const restoredInboxes = [...(current.inboxes || [])];
  for (const inbox of deletedInboxes) {
    if (!restoredInboxes.some((existing) => existing.id === inbox.id)) {
      restoredInboxes.push(inbox);
    }
  }

  const storedEmails = current.storedEmails || {};
  const archivedEmails = current.archivedEmails || {};
  const seenEmailIds = current.seenEmailIds || {};
  const lastMessageTimestamps = current.lastMessageTimestamps || {};

  for (const inbox of deletedInboxes) {
    if (snapshot.storedEmails?.[inbox.address]) {
      storedEmails[inbox.address] = snapshot.storedEmails[inbox.address];
    }
    if (snapshot.archivedEmails?.[inbox.address]) {
      archivedEmails[inbox.address] = snapshot.archivedEmails[inbox.address];
    }
    if (snapshot.seenEmailIds?.[inbox.address]) {
      seenEmailIds[inbox.address] = snapshot.seenEmailIds[inbox.address];
    }
    if (snapshot.lastMessageTimestamps?.[inbox.id] !== undefined) {
      lastMessageTimestamps[inbox.id] = snapshot.lastMessageTimestamps[inbox.id];
    }
  }

  await ext.storage.local.set({
    inboxes: restoredInboxes,
    storedEmails,
    archivedEmails,
    readEmails: snapshot.readEmails || {},
    starredEmails: snapshot.starredEmails || [],
    seenEmailIds,
    lastMessageTimestamps,
  });
}
