/**
 * Shared stale-generation guard for every undo offer that restores a STORAGE
 * SNAPSHOT of a whole surface - delete-undo, import-undo, the domain-switch
 * undo. All three answer the same question, so all three read one stored token:
 *
 *   "is the state this snapshot describes still the newest state?"
 *
 * Deleting an inbox offers a 10-second Undo that does not reverse a diff - it
 * restores the storage snapshot captured BEFORE the delete. Same for a
 * replace-mode import (`restoreImportUndo`) and the MailProviderView
 * domain-switch undo (a pre-switch `domainIndex_*` snapshot). Restoring a
 * snapshot of a surface is only meaningful while the state it describes is
 * still the state on screen; ten seconds is long enough for the user to move
 * on, and a stale undo then silently walks newer work back.
 *
 * So every mutation that LANDS on the address/mail surface marks a new
 * revision here (`markAddressMutation()`), and an undo carries the revision it
 * was created under and refuses to run once `isUndoCurrent()` says a newer one
 * exists - replacing its success story with `toasts.undoSuperseded` (or its
 * flow-specific equivalent) instead of writing a stale picture into storage.
 *
 * One persisted token for every flow across popup, side panel and app
 * contexts, in both directions: a bulk delete invalidates a pending import
 * undo, an import invalidates a pending delete undo, a domain switch
 * invalidates both - and each of those undos invalidates the others.
 *
 * Unique tokens avoid equal per-context counters. Callers await the marker
 * write before offering undo and re-read storage before restoring. A storage
 * read failure fails closed. This is not an atomic cross-context transaction
 * around a multi-key restore; that storage ownership limitation remains.
 *
 * Two deliberate limits, stated so neither is mistaken for coverage:
 *
 * - Only a mutation that SUCCEEDED marks a revision. A rejected delete
 *   (stale id, failed request) changes nothing, so it must not invalidate an
 *   undo that still describes the truth.
 * - The revision tracks surface-level lifecycle mutations, not every storage
 *   write. A delete undo therefore still restores the pre-delete mail/read
 *   picture for the mailbox it undoes - that IS the undo's semantics - while
 *   `restoreStorageSnapshot` additionally refuses to touch a mailbox whose
 *   address another (newer) record now owns.
 */
import { logError } from '@/utils/logger.js';
import { resolveLocalArea, type StorageWriteArea, writeWithRetry } from './storage-write.js';

/** Internal persistent marker, shared by popup, side panel and app contexts. */
export const UNDO_GENERATION_KEY = '_undo_generation';

/**
 * Mark a surface-level mutation as landed (delete, archive, unarchive,
 * restore, replace-import, domain switch - single or bulk) and return the
 * revision an undo offered from here must carry.
 */
export async function markAddressMutation(area?: StorageWriteArea): Promise<string> {
  const token = crypto.randomUUID();
  await writeWithRetry({ [UNDO_GENERATION_KEY]: token }, { area });
  return token;
}

/** Is an undo created under `issued` still describing the newest lifecycle state? */
export async function isUndoCurrent(issued: string): Promise<boolean> {
  if (!issued) return false;
  try {
    const current = await resolveLocalArea().get([UNDO_GENERATION_KEY]);
    return current[UNDO_GENERATION_KEY] === issued;
  } catch (error) {
    logError('Failed to verify shared undo generation', error);
    return false;
  }
}

/** Test hook: clear the shared marker in the test's isolated storage area. */
export async function __resetUndoGenerationForTests(): Promise<void> {
  await writeWithRetry({ [UNDO_GENERATION_KEY]: null });
}
