import { withLock } from '@/utils/mutex.js';
import type { EmailStorageMetadata } from '@/utils/storage/storage-keys.js';
import {
  archivedEmailsByAddressKey,
  asEmailBag,
  getEmailMaps,
  getEmailStorageMetadata,
  isBooleanRecord,
  recomputeEmailStorageMetadata,
  resolveBagKey,
  setLogicalEmailMapsUnlockedForLockedCaller,
  storedEmailsByAddressKey,
} from '@/utils/storage/storage-keys.js';
import { removeAreaOf, removeWithRetry, writeWithRetry } from '@/utils/storage/storage-write.js';
import { markAddressMutation } from '@/utils/storage/undo-generation.js';
import type { Address, Email } from '@/utils/types.js';

export interface StorageSnapshot {
  addresses?: Address[];
  storedEmails?: Record<string, Email[]>;
  archivedEmails?: Record<string, Email[]>;
  readEmails?: Record<string, boolean>;
  starredEmails?: string[];
  seenEmailIds?: Record<string, string[]>;
  lastMessageTimestamps?: Record<string, number>;
}

export const SNAPSHOT_KEYS = [
  'addresses',
  'readEmails',
  'starredEmails',
  'seenEmailIds',
  'lastMessageTimestamps',
] as const;

// ──────────────────────────────────────────────────────────────────────────────
// Replace-mode import undo
// ─────────────────────────────────────────────────────────────────────────────
// A REPLACE import rebuilds `emailStorageAddressIndex` from ONLY the imported
// addresses and permanently drops (a) the index entries and (b) the ID-keyed
// stored/archived bags of every mailbox that left the index - including
// evicted archived-address-overflow mailboxes, whose Offline Saved mail
// becomes unreachable afterwards when `persistImportedEmailBags` prunes their
// orphan bag keys. This captures the exact pre-import surface so the UI can
// offer a true one-shot undo (the delete-undo in this file cannot help: it
// restores live-list addresses + logical maps only, and the import even owed
// those bags gone at the physical-key level).

export interface ImportUndoSnapshot {
  capturedAt: number;
  addresses?: Address[];
  activeAddressId?: string;
  emailStorageAddressIndex?: Record<string, string>;
  archivedAddressOverflow?: Address[];
  /** Raw ID-keyed stored bags (live + overflow mailboxes, pre-import). */
  storedEmailsById?: Record<string, unknown>;
  /** Raw ID-keyed archived bags (live + overflow mailboxes, pre-import). */
  archivedEmailsById?: Record<string, unknown>;
  /** Raw per-address metadata map, pre-import (badge fast-path counts). */
  emailStorageMetadata?: Record<string, EmailStorageMetadata>;
}

/** Storage key holding the most recent replace-import undo snapshot. */
export const IMPORT_UNDO_KEY = 'pendingImportUndo';

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAddressArray(value: unknown): value is Address[] {
  return Array.isArray(value);
}

/**
 * Capture the pre-import state a replace-mode address import can destroy.
 * Bag values are stored RAW (exactly as persisted) so the undo restore is
 * byte-faithful - no logical-map re-derivation. The index's ids cover BOTH
 * live mailboxes and evicted archived-overflow mailboxes (overflow ids keep
 * their index entries), so overflow mail is captured too.
 */
export async function captureImportUndoSnapshot(ext: Browser): Promise<ImportUndoSnapshot> {
  const result = (await ext.storage.local.get([
    'addresses',
    'activeAddressId',
    'emailStorageAddressIndex',
    'archivedAddressOverflow',
    'emailStorageMetadata',
  ])) as Record<string, unknown>;

  let storedEmailsById: Record<string, unknown> | undefined;
  let archivedEmailsById: Record<string, unknown> | undefined;
  const index = isStringRecord(result.emailStorageAddressIndex)
    ? result.emailStorageAddressIndex
    : undefined;
  if (index) {
    const ids = Object.keys(index);
    if (ids.length > 0) {
      const bagKeys = ids.flatMap((id) => [
        storedEmailsByAddressKey(id),
        archivedEmailsByAddressKey(id),
      ]);
      const bags = (await ext.storage.local.get(bagKeys)) as Record<string, unknown>;
      storedEmailsById = {};
      archivedEmailsById = {};
      for (const id of ids) {
        const storedKey = storedEmailsByAddressKey(id);
        const archivedKey = archivedEmailsByAddressKey(id);
        if (storedKey in bags) storedEmailsById[id] = bags[storedKey];
        if (archivedKey in bags) archivedEmailsById[id] = bags[archivedKey];
      }
    }
  }

  return {
    capturedAt: Date.now(),
    addresses: isAddressArray(result.addresses) ? result.addresses : undefined,
    activeAddressId:
      typeof result.activeAddressId === 'string' ? result.activeAddressId : undefined,
    emailStorageAddressIndex: index,
    archivedAddressOverflow: isAddressArray(result.archivedAddressOverflow)
      ? result.archivedAddressOverflow
      : undefined,
    storedEmailsById,
    archivedEmailsById,
    emailStorageMetadata:
      result.emailStorageMetadata && typeof result.emailStorageMetadata === 'object'
        ? { ...(result.emailStorageMetadata as Record<string, EmailStorageMetadata>) }
        : undefined,
  };
}

/**
 * Restore a replace-import undo snapshot: addresses, active selection, the
 * full address index (re-linking live AND overflow bags), the overflow list,
 * and every captured ID-keyed bag. Also does the reverse of the import's
 * orphan sweep - bag keys for ids that the import ADDED (not in the snapshot
 * index) are removed so the undo is exact, not just additive.
 */
export async function restoreImportUndoSnapshot(
  ext: Browser,
  snapshot: ImportUndoSnapshot
): Promise<void> {
  await withLock('emails_storage_lock', async () => {
    const rawIndex = (await ext.storage.local.get(['emailStorageAddressIndex']))
      .emailStorageAddressIndex;
    const snapshotIndex = isStringRecord(snapshot.emailStorageAddressIndex)
      ? snapshot.emailStorageAddressIndex
      : {};
    const snapshotIds = new Set(Object.keys(snapshotIndex));
    if (isStringRecord(rawIndex)) {
      const extraIds = Object.keys(rawIndex).filter((id) => !snapshotIds.has(id));
      if (extraIds.length > 0) {
        const extraKeys = extraIds.flatMap((id) => [
          storedEmailsByAddressKey(id),
          archivedEmailsByAddressKey(id),
        ]);
        // Retried like every other write in this restore. This is the one
        // sweep the import relies on to drop the bag bytes it ADDED, and the
        // undo is single-shot (the snapshot is consumed), so nothing revisits
        // these keys later - a transient failure here would leave them behind
        // permanently.
        await removeWithRetry(extraKeys, removeAreaOf(ext));
      }
    }

    const patch: Record<string, unknown> = {};
    if (snapshot.addresses !== undefined) patch.addresses = snapshot.addresses;
    if (snapshot.activeAddressId !== undefined) patch.activeAddressId = snapshot.activeAddressId;
    if (snapshot.emailStorageAddressIndex !== undefined)
      patch.emailStorageAddressIndex = snapshot.emailStorageAddressIndex;
    if (snapshot.archivedAddressOverflow !== undefined)
      patch.archivedAddressOverflow = snapshot.archivedAddressOverflow;
    if (Object.keys(patch).length > 0) await writeWithRetry(patch, { area: ext.storage.local });

    const bagPatch: Record<string, unknown> = {};
    for (const [id, bag] of Object.entries(snapshot.storedEmailsById || {})) {
      bagPatch[storedEmailsByAddressKey(id)] = bag;
    }
    for (const [id, bag] of Object.entries(snapshot.archivedEmailsById || {})) {
      bagPatch[archivedEmailsByAddressKey(id)] = bag;
    }
    if (Object.keys(bagPatch).length > 0)
      await writeWithRetry(bagPatch, { area: ext.storage.local });

    if (snapshot.emailStorageMetadata !== undefined) {
      // Byte-faithful metadata restore: the captured map IS the pre-import
      // state, so the badge fast path returns to exactly what it was before
      // the import - no recomputation. Only prune defensive stragglers for
      // ids this undo removed (the captured map is pre-import, so there
      // should be none).
      const metadata = { ...snapshot.emailStorageMetadata };
      for (const id of Object.keys(metadata)) {
        if (!snapshotIds.has(id)) delete metadata[id];
      }
      await writeWithRetry({ emailStorageMetadata: metadata }, { area: ext.storage.local });
    } else {
      // Older snapshots (captured before the metadata field existed) fall
      // back to recomputing from the RESTORED physical surface so the badge
      // fast path still converges instead of keeping post-import counts or
      // phantom entries for ids the import added.
      const snapshotBagKeys = [...snapshotIds].flatMap((id) => [
        storedEmailsByAddressKey(id),
        archivedEmailsByAddressKey(id),
      ]);
      const [metadata, bags, readResult] = await Promise.all([
        getEmailStorageMetadata(),
        snapshotBagKeys.length > 0 ? ext.storage.local.get(snapshotBagKeys) : Promise.resolve({}),
        ext.storage.local.get(['readEmails']),
      ]);
      const readEmails = isBooleanRecord(readResult.readEmails) ? readResult.readEmails : {};
      for (const [id, address] of Object.entries(snapshotIndex)) {
        const storedBag = asEmailBag(bags[storedEmailsByAddressKey(id)]);
        const archivedBag = asEmailBag(bags[archivedEmailsByAddressKey(id)]);
        if (storedBag.length === 0 && archivedBag.length === 0) {
          // Both bags are gone - the entry is dead weight for the badge fast
          // path, so prune it (absent entry = zero unread contribution).
          delete metadata[id];
          continue;
        }
        metadata[id] = recomputeEmailStorageMetadata(
          metadata[id],
          storedBag,
          archivedBag,
          readEmails,
          address
        );
      }
      // Metadata for ids the import added and this undo removed is
      // unreachable dead weight - prune it (mirrors the extra-key sweep).
      for (const id of Object.keys(metadata)) {
        if (!snapshotIds.has(id)) delete metadata[id];
      }
      await writeWithRetry({ emailStorageMetadata: metadata }, { area: ext.storage.local });
    }
  });
}

/**
 * Restore the most recent replace-import undo snapshot (single-shot: the
 * stored snapshot is consumed). Returns true when an undo was available.
 */
export async function restoreImportUndo(ext: Browser): Promise<boolean> {
  const res = (await ext.storage.local.get([IMPORT_UNDO_KEY])) as {
    [IMPORT_UNDO_KEY]?: ImportUndoSnapshot;
  };
  const snapshot = res[IMPORT_UNDO_KEY];
  if (!snapshot || typeof snapshot !== 'object' || snapshot.capturedAt === undefined) return false;
  await restoreImportUndoSnapshot(ext, snapshot);
  await ext.storage.local.remove(IMPORT_UNDO_KEY);
  // The restore LANDED - it rebuilt the whole address/mail surface. Mark it so
  // any undo (a delete-undo, another import's) offered before this restore ran
  // cannot clobber the just-restored state with its own older snapshot.
  await markAddressMutation();
  return true;
}

export async function captureStorageSnapshot(ext: Browser): Promise<StorageSnapshot> {
  const result = await ext.storage.local.get(SNAPSHOT_KEYS);
  // Only snapshot email bags for addresses currently in the live list.
  // Deleted addresses (captured before the delete) are included because
  // they're still in `addresses` at capture time; non-live archived-overflow
  // bags are omitted to keep snapshots bounded.
  const liveAddrs = new Set(
    ((result.addresses as Address[] | undefined) || [])
      .map((r) => (r.address || '').toLowerCase())
      .filter(Boolean)
  );
  const logical = await getEmailMaps();
  const storedEmailsFiltered: Record<string, Email[]> = {};
  const archivedEmailsFiltered: Record<string, Email[]> = {};
  for (const [addr, msgs] of Object.entries(logical.storedEmails)) {
    if (liveAddrs.has(addr.toLowerCase())) storedEmailsFiltered[addr] = msgs;
  }
  for (const [addr, msgs] of Object.entries(logical.archivedEmails)) {
    if (liveAddrs.has(addr.toLowerCase())) archivedEmailsFiltered[addr] = msgs;
  }
  return {
    ...(result as unknown as StorageSnapshot),
    storedEmails: storedEmailsFiltered,
    archivedEmails: archivedEmailsFiltered,
  };
}

export async function restoreStorageSnapshot(
  ext: Browser,
  snapshot: StorageSnapshot,
  deletedAddresses: Address[]
): Promise<void> {
  await withLock('emails_storage_lock', async () => {
    const current = (await ext.storage.local.get([
      'addresses',
      'readEmails',
      'starredEmails',
      'seenEmailIds',
      'lastMessageTimestamps',
    ])) as {
      addresses?: Address[];
      storedEmails?: Record<string, Email[]>;
      archivedEmails?: Record<string, Email[]>;
      readEmails?: Record<string, boolean>;
      starredEmails?: string[];
      seenEmailIds?: Record<string, string[]>;
      lastMessageTimestamps?: Record<string, number>;
    };

    // A record that already owns this mailbox's ADDRESS is newer than the
    // delete being undone: reconnecting, re-creating or backup-restoring that
    // address puts a live record - and a live bag - at the same bag key. The
    // snapshot's bags for that address are the pre-delete mail, so writing them
    // back would replace the new mailbox's messages with the old ones. Such a
    // record is left exactly as the newer operation left it.
    const ownedAddresses = new Set(
      (current.addresses || [])
        .map((existing) => (existing.address || '').toLowerCase())
        .filter(Boolean)
    );
    const restorable = deletedAddresses.filter(
      (record) => !ownedAddresses.has((record.address || '').toLowerCase())
    );
    if (restorable.length === 0) return;

    const restoredAddresses = [...(current.addresses || [])];
    for (const record of restorable) {
      if (!restoredAddresses.some((existing) => existing.id === record.id)) {
        restoredAddresses.push(record);
      }
    }

    const logicalCurrent = await getEmailMaps();
    const storedEmails = logicalCurrent.storedEmails || {};
    const archivedEmails = logicalCurrent.archivedEmails || {};
    const seenEmailIds = current.seenEmailIds || {};
    // Timestamp restores are merged under their own lock at commit time. The
    // email lock protects the mailbox snapshot, but polling side effects update
    // this independent whole-map key under last_message_timestamps_lock.
    const restoredTimestamps: Record<string, number> = {};

    for (const record of restorable) {
      // Case-insensitive key resolution on BOTH sides: find the snapshot bag
      // under its stored casing and write it into the canonical existing key,
      // so a re-cased address never re-creates a duplicate bag on restore.
      const snapStoredKey = resolveBagKey(snapshot.storedEmails || {}, record.address);
      const snapArchivedKey = resolveBagKey(snapshot.archivedEmails || {}, record.address);
      const snapSeenKey = resolveBagKey(snapshot.seenEmailIds || {}, record.address);
      if (snapshot.storedEmails?.[snapStoredKey]) {
        storedEmails[resolveBagKey(storedEmails, record.address)] =
          snapshot.storedEmails[snapStoredKey];
      }
      if (snapshot.archivedEmails?.[snapArchivedKey]) {
        archivedEmails[resolveBagKey(archivedEmails, record.address)] =
          snapshot.archivedEmails[snapArchivedKey];
      }
      if (snapshot.seenEmailIds?.[snapSeenKey]) {
        seenEmailIds[resolveBagKey(seenEmailIds, record.address)] =
          snapshot.seenEmailIds[snapSeenKey];
      }
      if (snapshot.lastMessageTimestamps?.[record.id] !== undefined) {
        restoredTimestamps[record.id] = snapshot.lastMessageTimestamps[record.id];
      }
    }

    // Merge mailbox-scoped state: restore the deleted addresses' snapshot
    // entries WITHOUT clobbering read/star changes that happened in other
    // (non-deleted) addresses between the delete and the undo.
    const readEmails = { ...(current.readEmails || {}) };
    if (snapshot.readEmails) {
      const deletedReadKeys = new Set<string>();
      for (const record of restorable) {
        const prefix = `${record.address}_`.toLowerCase();
        for (const key of Object.keys(snapshot.readEmails)) {
          // Compound read-state keys are address + '_' + email id. Address
          // casing may drift between deletion and undo, so compare the prefix
          // case-insensitively while preserving the original key for restore.
          if (key.toLowerCase().startsWith(prefix)) deletedReadKeys.add(key);
        }
      }
      for (const [k, v] of Object.entries(snapshot.readEmails)) {
        if (deletedReadKeys.has(k)) readEmails[k] = v;
      }
    }
    // Restore stars only for the deleted addresses' emails - never resurrect
    // stars that were intentionally removed on other mailboxes between the
    // delete and the undo. Star keys are compound (`{address}_{emailId}`),
    // so we must match against both the bare id (legacy) and the compound form
    // for the deleted address.
    const deletedEmailIds = new Set<string>();
    for (const record of restorable) {
      const addrLower = (record.address || '').toLowerCase();
      const snapStoredKey2 = resolveBagKey(snapshot.storedEmails || {}, record.address);
      const snapArchivedKey2 = resolveBagKey(snapshot.archivedEmails || {}, record.address);
      for (const email of snapshot.storedEmails?.[snapStoredKey2] || []) {
        if (email?.id) {
          deletedEmailIds.add(email.id);
          if (addrLower) deletedEmailIds.add(`${addrLower}_${email.id}`);
        }
      }
      for (const email of snapshot.archivedEmails?.[snapArchivedKey2] || []) {
        if (email?.id) {
          deletedEmailIds.add(email.id);
          if (addrLower) deletedEmailIds.add(`${addrLower}_${email.id}`);
        }
      }
    }
    const snapshotStarsForDeleted = (snapshot.starredEmails || []).filter((id) =>
      deletedEmailIds.has(id)
    );
    const starredEmails = Array.from(
      new Set([...(current.starredEmails || []), ...snapshotStarsForDeleted])
    );

    await writeWithRetry(
      {
        addresses: restoredAddresses,
        readEmails,
        starredEmails,
        seenEmailIds,
      },
      { area: ext.storage.local }
    );
    await withLock('last_message_timestamps_lock', async () => {
      const latest = (await ext.storage.local.get(['lastMessageTimestamps'])) as {
        lastMessageTimestamps?: Record<string, number>;
      };
      const lastMessageTimestamps = latest.lastMessageTimestamps || {};
      Object.assign(lastMessageTimestamps, restoredTimestamps);
      await writeWithRetry({ lastMessageTimestamps }, { area: ext.storage.local });
    });
    await setLogicalEmailMapsUnlockedForLockedCaller(storedEmails, archivedEmails);
  });
}
