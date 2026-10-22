import { browser } from 'wxt/browser';
import { displayLabels } from '@/features/address/display-labels.js';
import { saveLastGoodSnapshot } from '@/utils/activity/action-history.js';
import { getLifecycleStatus, isLive } from '@/utils/address/address-status.js';
import { copyToClipboardAndSchedulePurge } from '@/utils/clipboard/clipboard.js';
import { extractLatestOtp, mapEmailsForDisplay } from '@/utils/email/email-mapper.js';
import { ApiError } from '@/utils/errors.js';
import { t } from '@/utils/i18n/i18n-utils.js';
import { logError } from '@/utils/logger.js';
import { LOCKS, withLock } from '@/utils/mutex.js';
import { isOtpCacheFresh } from '@/utils/otp/otp-cache.js';
import { parseSearchShortcuts } from '@/utils/search/search-shortcuts.js';
import {
  awaitStoredObjectChain,
  parseBooleanRecord,
  parseStringList,
  updateStoredObject,
} from '@/utils/storage/rmw.js';
import {
  filterPersistedAddresses,
  getEmailMaps,
  getStoredEmailsForAddress,
  getStoredEmailsMap,
  parseNotificationSettings,
  resolveBagKey,
  setEmailReadState,
  setLogicalEmailMapsUnlockedForLockedCaller,
} from '@/utils/storage/storage-keys.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { toMs } from '@/utils/time/time.js';
import { formatDate, formatDurationLeft } from '@/utils/time/time-format.js';
import type { Address, Email } from '@/utils/types.js';
import { findAddressByEmail } from './mailbox-read-state.js';

export interface AddressState {
  accounts: Address[];
  allAddresses: Address[];
  emails: Email[];
  latestOtp: string;
  latestOtpSender: string;
  latestOtpSenderName: string;
  otpContext: string;
  selectedEmail: string;
  loading: boolean;
  loadingAddresses: boolean;
  loadingEmails: boolean;
  notificationsEnabled: boolean;
}

export interface AddressSetters {
  setAddresses: (accounts: Address[]) => void;
  setAllAddresses: (allAddresses: Address[]) => void;
  setEmails: (emails: Email[]) => void;
  setLatestOtp: (otp: string) => void;
  setLatestOtpSender: (sender: string) => void;
  setLatestOtpSenderName: (name: string) => void;
  setOtpContext: (context: string) => void;
  setSelectedEmail: (email: string) => void;
  setLoading: (loading: boolean) => void;
  setLoadingAddresses: (loading: boolean) => void;
  setLoadingEmails: (loading: boolean) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setSoundEnabled: (soundEnabled: boolean) => void;
  setExpiryWarningThreshold: (expiryWarningThreshold: number) => void;
  setShowToast: (message: string, type: 'success' | 'error' | 'warning') => void;
}

export interface LoadAddressesOptions {
  /** Skip the broad stored-email read during the first UI bootstrap. */
  deferEmailCounts?: boolean;
}

export async function loadAddresses(
  ext: typeof browser,
  setters: AddressSetters,
  skipEmailSelection = false,
  options: LoadAddressesOptions = {}
) {
  setters.setLoadingAddresses(true);
  try {
    const result = await ext.storage.local.get(['addresses', 'activeAddressId']);
    const addresses = filterPersistedAddresses(result.addresses);
    const activeId =
      typeof result.activeAddressId === 'string' ? result.activeAddressId : undefined;
    const now = Date.now();

    // The initial shell only needs address metadata and the selected address.
    // Reading every mailbox is deferred until after the active mailbox paints.
    const storedEmailsMap = options.deferEmailCounts ? null : await getStoredEmailsMap();

    // Spread the raw stored inbox and override only the UI-computed fields.
    // A field whitelist here silently dropped `instanceUrl` (provider pill /
    // open-in-provider), `tags` (Addresses tag rows), and the renewal-failure
    // counters (AddressView failure banner) from every account in the UI.
    const allAddresses = await Promise.all(
      addresses.map(async (record: Address) => {
        const expiresAt = record.expiresAt || 0;
        const remaining = expiresAt - now;
        let expiry: string;
        if (!expiresAt || remaining <= 0) {
          expiry = await t('time.expired');
        } else {
          const duration = formatDurationLeft(remaining);
          const time = duration || (await t('time.expired'));
          expiry = (await t(record.autoExtend ? 'address.autoRenewIn' : 'address.expiresIn', {
            time,
          })) as string;
        }

        // Derive lastUsed from the latest stored email for this address when
        // available; fall back to createdAt when the mailbox is empty or the
        // initial shell deferred the email bag read.
        let lastUsed: string;
        if (storedEmailsMap) {
          const bag = storedEmailsMap[resolveBagKey(storedEmailsMap, record.address)] || [];
          if (bag.length > 0) {
            const latestMs = bag.reduce(
              (max, email) =>
                Math.max(
                  max,
                  toMs((email as unknown as { received_at?: number }).received_at || 0)
                ),
              0
            );
            lastUsed = latestMs ? formatDate(latestMs) : formatDate(record.createdAt);
          } else {
            lastUsed = formatDate(record.createdAt);
          }
        } else {
          lastUsed = formatDate(record.createdAt);
        }

        return {
          ...record,
          status: getLifecycleStatus(record),
          expiry,
          created: formatDate(record.createdAt),
          lastUsed,
          received: storedEmailsMap
            ? (storedEmailsMap[resolveBagKey(storedEmailsMap, record.address)] || []).length
            : 0,
          tag: record.tag || '',
          accountStatus: record.accountStatus || 'active',
        };
      })
    );

    setters.setAllAddresses(allAddresses);
    setters.setAddresses(
      allAddresses.filter(
        (record: Address) =>
          record.accountStatus !== 'archived' && record.accountStatus !== 'deleted'
      )
    );

    // Snapshot after successful load so ErrorBoundary can revert. During the
    // first bootstrap this would re-read the entire legacy storedEmails map and
    // defeat the active-first gate, so the deferred path skips the snapshot;
    // subsequent mutations still create the normal last-good snapshot.
    if (!options.deferEmailCounts) {
      try {
        void saveLastGoodSnapshot(ext, 'loadAddresses');
      } catch {
        /* ignore */
      }
    }

    if (!skipEmailSelection) {
      const activeById = allAddresses.find((a) => a.id === activeId);
      if (activeById) {
        setters.setSelectedEmail(activeById.address);
      } else {
        // Fallback after import / missing activeAddressId - prefer first live address.
        // isLive() checks accountStatus (excludes archived/deleted) AND expiresAt (excludes expired).
        const firstLive = allAddresses.find((a) => isLive(a));
        const fallback = firstLive || allAddresses[0];
        if (fallback?.address) {
          setters.setSelectedEmail(fallback.address);
          if (fallback.id) {
            try {
              await writeWithRetry({ activeAddressId: fallback.id });
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
  } catch (e: unknown) {
    logError('loadAddresses error:', undefined, e instanceof Error ? e : new Error(String(e)));
  } finally {
    setters.setLoadingAddresses(false);
  }
}

/**
 * True if we should still apply this checkMessages result.
 * - If activeAddressId is unset, allow (first paint / import).
 * - If set, must match the inbox we requested (blocks stale prev/next races).
 */
async function isStillActiveAddress(ext: typeof browser, addressId: string): Promise<boolean> {
  try {
    const { activeAddressId } = (await ext.storage.local.get(['activeAddressId'])) as {
      activeAddressId?: string;
    };
    return !activeAddressId || activeAddressId === addressId;
  } catch {
    /* ignore */
    return true;
  }
}

/** Monotonic token so stale prev/next checkMessages cannot apply after a newer switch. */
let checkMessagesGeneration = 0;
const activeMailboxCache = new Map<
  string,
  { address: string; messages: Email[]; savedAt: number }
>();
const ACTIVE_MAILBOX_CACHE_LIMIT = 6;
const ACTIVE_MAILBOX_CACHE_TTL_MS = 5 * 60 * 1000;
const mailboxPrefetches = new Map<string, Promise<void>>();
const providerRefreshes = new Map<string, Promise<unknown>>();
const READ_STATE_FLUSH_MS = 75;
/**
 * Pending read-state mutations, applied in order at flush time.
 *
 * Ops (not snapshots) are queued so concurrent callers can never fork: the
 * append below is fully synchronous - there is no `await` gap between two
 * callers' reads of shared state, which is exactly how the old snapshot
 * version lost updates when two fire-and-forget `persistEmailRead` calls
 * overlapped (both saw `pendingReadState === null`, both read storage, last
 * writer won). The flush reads the CURRENT map once and replays every op, so
 * writes that landed through any other path in the meantime survive too.
 */
export interface QueuedReadStateOp {
  emailId: string;
  casings: Array<string | undefined>;
  read: boolean;
}
let pendingReadOps: QueuedReadStateOp[] = [];
let readStateFlushTimer: ReturnType<typeof setTimeout> | null = null;
// One drain at a time preserves operation order across failures and retries.
// Cleared after settlement; failed operations remain pending for the next flush.
let readStateFlushPromise: Promise<void> | null = null;

/**
 * Drain the pending op list: read the CURRENT map, replay every op onto it,
 * and write the result whole. Runs INSIDE the `readEmails` update chain
 * (updateStoredObject), so a flush never reads the map from before a previous
 * write landed - the intra-queue fork that the old read-then-join order
 * allowed (two overlapping flushes both read pre-write state, both wrote, one
 * replay was lost).
 */
function drainReadStateOps(): Promise<void> {
  const ops = pendingReadOps;
  pendingReadOps = [];
  if (ops.length === 0) return Promise.resolve();
  return updateStoredObject(
    'readEmails',
    (current) => {
      for (const op of ops) setEmailReadState(current, op.emailId, op.casings, op.read);
      return current;
    },
    parseBooleanRecord
  ).then(
    () => undefined,
    (error: unknown) => {
      pendingReadOps = [...ops, ...pendingReadOps];
      throw error;
    }
  );
}

/**
 * Drain the pending op list (or, when the queue is empty, just join the
 * `readEmails` chain) and resolve once the write for THIS drain has landed.
 */
export async function flushQueuedEmailReadState(): Promise<void> {
  if (readStateFlushTimer) {
    clearTimeout(readStateFlushTimer);
    readStateFlushTimer = null;
  }
  if (readStateFlushPromise) return readStateFlushPromise;
  const flush = async () => {
    do {
      await drainReadStateOps();
      await awaitStoredObjectChain('readEmails');
    } while (pendingReadOps.length > 0);
  };
  const task = flush();
  readStateFlushPromise = task;
  try {
    await task;
  } catch (error: unknown) {
    logError(
      'Failed to persist email read state',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  } finally {
    if (readStateFlushPromise === task) readStateFlushPromise = null;
  }
}

/** Arm (or re-arm) the debounced flush. Fully synchronous by design. */
function armReadStateFlush(): void {
  if (readStateFlushTimer) clearTimeout(readStateFlushTimer);
  readStateFlushTimer = setTimeout(() => {
    readStateFlushTimer = null;
    void flushQueuedEmailReadState().catch(() => {
      // The flush logs the error and retains the operations for a later retry.
    });
  }, READ_STATE_FLUSH_MS);
}

/** Test hook: drop any armed flush timer (chains live in @/utils/storage/rmw). */
export function __clearReadStateFlushTimerForTests(): void {
  if (readStateFlushTimer) {
    clearTimeout(readStateFlushTimer);
    readStateFlushTimer = null;
  }
}

export function queueEmailReadState(
  emailId: string,
  casings: Array<string | undefined>,
  read: boolean
): Promise<void> {
  pendingReadOps.push({ emailId, casings, read });
  armReadStateFlush();
  return Promise.resolve();
}

/**
 * Batch variant: one storage read at flush time instead of one per email.
 * Bulk mark-all paths must use this - N single queues would each have issued
 * their own storage read under the old design.
 */
export function queueEmailReadStates(ops: QueuedReadStateOp[]): void {
  if (ops.length === 0) return;
  pendingReadOps.push(...ops);
  armReadStateFlush();
}

/**
 * Rewrite queued casings from one inbox address to another (case-insensitive
 * full-address match; bare-id entries carry no address and are left alone).
 * A domain change must call this BEFORE the flush lands, or the flush would
 * re-plant old-domain keys after the stored map was migrated.
 */
export function remapQueuedReadStateInbox(fromAddr: string, toAddr: string): void {
  const from = (fromAddr || '').trim().toLowerCase();
  const to = (toAddr || '').trim();
  if (!from || !to || from === to.toLowerCase()) return;
  for (const op of pendingReadOps) {
    op.casings = op.casings.map((casing) =>
      casing && casing.trim().toLowerCase() === from ? to : casing
    );
  }
}

function cacheMailbox(addressId: string, address: string, messages: Email[]): void {
  if (!addressId) return;
  activeMailboxCache.delete(addressId);
  activeMailboxCache.set(addressId, {
    address,
    messages: messages.map((message) => ({ ...message })),
    savedAt: Date.now(),
  });
  while (activeMailboxCache.size > ACTIVE_MAILBOX_CACHE_LIMIT) {
    const oldest = activeMailboxCache.keys().next().value;
    if (!oldest) break;
    activeMailboxCache.delete(oldest);
  }
}

function cachedMailbox(addressId: string, address: string): Email[] | undefined {
  const entry = activeMailboxCache.get(addressId);
  if (!entry || Date.now() - entry.savedAt > ACTIVE_MAILBOX_CACHE_TTL_MS) {
    if (entry) activeMailboxCache.delete(addressId);
    return undefined;
  }
  if (entry.address.toLowerCase() !== address.toLowerCase()) return undefined;
  activeMailboxCache.delete(addressId);
  activeMailboxCache.set(addressId, entry);
  return entry.messages.map((message) => ({ ...message }));
}

function invalidateMailboxCache(addressId?: string): void {
  if (addressId) activeMailboxCache.delete(addressId);
  else activeMailboxCache.clear();
}

async function prefetchMailbox(
  _ext: typeof browser,
  account: Address,
  generation: number
): Promise<void> {
  if (!account.id || !account.address || generation !== checkMessagesGeneration) return;
  if (cachedMailbox(account.id, account.address)) return;
  const existing = mailboxPrefetches.get(account.id);
  if (existing) return existing;

  const request = (async () => {
    try {
      const messages = await getStoredEmailsForAddress(account.id, account.address);
      if (generation !== checkMessagesGeneration) return;
      cacheMailbox(account.id, account.address, messages);
    } catch (error) {
      logError(
        'Mailbox prefetch failed',
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
    } finally {
      mailboxPrefetches.delete(account.id);
    }
  })();
  mailboxPrefetches.set(account.id, request);
  return request;
}

function prefetchAdjacentMailboxes(
  ext: typeof browser,
  accounts: Address[],
  addressId: string,
  generation: number
): void {
  const index = accounts.findIndex((account) => account.id === addressId);
  if (index < 0) return;
  for (const adjacent of [accounts[index - 1], accounts[index + 1]]) {
    if (adjacent) void prefetchMailbox(ext, adjacent, generation);
  }
}

let cacheListenerRegistered = false;
function registerMailboxCacheInvalidation(): void {
  if (cacheListenerRegistered || typeof browser?.storage?.onChanged?.addListener !== 'function')
    return;
  cacheListenerRegistered = true;
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (
      Object.keys(changes).some(
        (key) =>
          key.startsWith('storedEmailsByAddress_') ||
          key.startsWith('archivedEmailsByAddress_') ||
          key === 'emailStorageAddressIndex' ||
          key === 'readEmails'
      )
    ) {
      invalidateMailboxCache();
    }
  });
}
registerMailboxCacheInvalidation();

/** Move/merge email bags when an inbox address domain changes. */
export async function migrateEmailBags(
  _ext: typeof browser,
  fromAddr: string,
  toAddr: string,
  addressCommit?: { addresses: Address[]; activeAddressId?: string }
): Promise<void> {
  if (!fromAddr || !toAddr || fromAddr === toAddr) return;
  if (fromAddr.toLowerCase() === toAddr.toLowerCase()) return;
  try {
    await withLock(LOCKS.EMAILS_STORAGE, async () => {
      const { storedEmails = {}, archivedEmails = {} } = await getEmailMaps();

      const mergeMove = (bags: Record<string, Email[]>) => {
        let sourceKey = fromAddr;
        if (!bags[sourceKey]?.length) {
          const fl = fromAddr.toLowerCase();
          for (const k of Object.keys(bags)) {
            if (k.toLowerCase() === fl) {
              sourceKey = k;
              break;
            }
          }
        }
        const src = bags[sourceKey] || [];
        if (!src.length) return bags;
        const dest = bags[toAddr] || [];
        const byId = new Map<string, Email>();
        for (const e of dest) byId.set(e.id, e);
        for (const e of src) {
          byId.set(e.id, { ...e, original_inbox: toAddr });
        }
        const next = { ...bags, [toAddr]: Array.from(byId.values()) };
        if (sourceKey !== toAddr) delete next[sourceKey];
        return next;
      };

      await setLogicalEmailMapsUnlockedForLockedCaller(
        mergeMove(storedEmails),
        mergeMove(archivedEmails),
        addressCommit
      );
    });
  } catch (e) {
    logError('migrateEmailBags error:', undefined, e instanceof Error ? e : new Error(String(e)));
    throw e;
  }
  // These address-prefixed keys are separate RMW stores, so remap them only
  // after the address + mail bags have committed. A failure here cannot make
  // the renamed mailbox disappear; log it for diagnosis and leave the mail
  // transaction intact.
  try {
    await remapReadAndStarKeysForDomainChange(fromAddr, toAddr);
  } catch (e) {
    logError(
      'migrateEmailBags read/star remap failed:',
      undefined,
      e instanceof Error ? e : new Error(String(e))
    );
  }
  invalidateMailboxCache();
}

/**
 * Rewrite read-state and star keys from one inbox address to another.
 * Keys carry the address as a prefix (`{casing}_{id}` for read state,
 * `{addrLower}_{id}` for stars), matched case-insensitively on the full
 * address plus the `_` terminator so `old@x.com` can never prefix-match
 * `old@x.com.evil`. Legacy bare ids carry no address and are unattributable,
 * so they are left alone. Collisions merge read-wins: the same message cannot
 * become unread by moving. Queued (unflushed) ops are remapped first so a
 * later flush cannot re-plant old-domain keys.
 */
async function remapReadAndStarKeysForDomainChange(
  fromAddr: string,
  toAddr: string
): Promise<void> {
  const from = (fromAddr || '').trim().toLowerCase();
  const to = (toAddr || '').trim();
  if (!from || !to || from === to.toLowerCase()) return;
  remapQueuedReadStateInbox(fromAddr, toAddr);
  const prefix = `${from}_`;
  const toLower = to.toLowerCase();
  // Both writes join their key's update chain: a concurrent flush or toggle
  // that lands between our read and write is replayed onto, not clobbered by,
  // the remap. Remaps run only on domain change, so always writing is cheap.
  await updateStoredObject<Record<string, boolean>>(
    'readEmails',
    (current) => {
      const next: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(current)) {
        if (key.toLowerCase().startsWith(prefix)) {
          const remapped = `${to}_${key.slice(prefix.length)}`;
          next[remapped] = next[remapped] || value;
        } else {
          next[key] = key in next ? next[key] || value : value;
        }
      }
      return next;
    },
    parseBooleanRecord
  );
  await updateStoredObject<string[]>(
    'starredEmails',
    (current) => {
      const next = current.map((key) =>
        key.toLowerCase().startsWith(prefix) ? `${toLower}_${key.slice(prefix.length)}` : key
      );
      return next.some((key, index) => key !== current[index])
        ? Array.from(new Set(next))
        : current;
    },
    parseStringList
  );
}

export async function checkMessages(
  ext: typeof browser,
  addressId: string,
  searchQuery: string,
  otpOnly: boolean,
  setters: AddressSetters
) {
  const generation = ++checkMessagesGeneration;
  // Soft loading only - never blank an already-visible list during prev/next
  setters.setLoadingEmails(true);
  try {
    const {
      readEmails = {},
      addresses = [],
      latestOtp,
      demoMode = false,
    } = (await ext.storage.local.get(['readEmails', 'addresses', 'latestOtp', 'demoMode'])) as {
      readEmails?: Record<string, boolean>;
      addresses?: Address[];
      latestOtp?: {
        otp: string;
        sender: string;
        senderName: string;
        context: string;
        recipient?: string;
        received_at?: number;
      };
      demoMode?: boolean;
    };
    if (generation !== checkMessagesGeneration) return;
    if (!(await isStillActiveAddress(ext, addressId))) {
      return;
    }

    const record = addresses.find((i) => i.id === addressId);
    const addr = record?.address || '';
    const addrLower = addr.toLowerCase();
    // Read only the selected mailbox from the current address-ID store.
    const stored =
      cachedMailbox(addressId, addr) || (await getStoredEmailsForAddress(addressId, addr));

    // Demo mode: never call real providers - paint isolated storage bags only
    let response: { success?: boolean; messages?: Email[] } | null = null;
    if (demoMode || record?.provider === 'demo') {
      response = { success: true, messages: stored };
    } else {
      const refreshKey = `${addressId}:${searchQuery}:${otpOnly ? 'otp' : 'all'}`;
      const existingRefresh = providerRefreshes.get(refreshKey);
      const refreshRequest =
        existingRefresh ||
        ext.runtime.sendMessage({
          type: 'checkEmails',
          addressId,
          // Strip shortcut tokens (is:otp, !from:x, …) - the background filter
          // only understands free-text + hasOTP.
          filters: { searchQuery: parseSearchShortcuts(searchQuery).searchQuery, hasOTP: otpOnly },
        });
      if (!existingRefresh) {
        providerRefreshes.set(refreshKey, refreshRequest);
        void refreshRequest.then(
          () => providerRefreshes.delete(refreshKey),
          () => providerRefreshes.delete(refreshKey)
        );
      }
      response = (await refreshRequest) as {
        success?: boolean;
        messages?: Email[];
      };
      // Drop stale responses when user already switched accounts (prev/next spam)
      if (generation !== checkMessagesGeneration) return;
      if (!(await isStillActiveAddress(ext, addressId))) {
        return;
      }
    }

    let msgs = (response?.success ? (response.messages as Email[]) : null) || [];
    if (!response?.success) {
      // Network/API failure: always fall back to exact storage bag
      msgs = stored;
    }

    // Prefer exact bag as base so lists never go empty when storage has mail.
    // Overlay API rows for same ids ONLY when they belong to this address.
    // Never merge another mailbox's bag (same provider id across addresses).
    // Multi-domain: same local-part under a different domain still counts as this mailbox.
    const addrLocal = addrLower.split('@')[0] || '';
    const sameMailbox = (ownRaw: string) => {
      const own = (ownRaw || '').toLowerCase().trim();
      if (!own || !addrLower) return true;
      if (own === addrLower) return true;
      const ownLocal = own.split('@')[0] || '';
      return !!addrLocal && ownLocal === addrLocal;
    };
    const byId = new Map<string, Email>();
    for (const s of stored) {
      const own = (s.original_inbox || addr || '').toLowerCase().trim();
      if (!sameMailbox(own)) continue;
      byId.set(s.id, { ...s, original_inbox: addr || s.original_inbox });
    }
    // Fresh API results for THIS inbox session - force stamp, never inherit foreign original_inbox
    if (response?.success && Array.isArray(response.messages)) {
      for (const m of response.messages as Email[]) {
        const own = (m.original_inbox || '').toLowerCase().trim();
        if (own && !sameMailbox(own)) continue;
        byId.set(m.id, { ...m, original_inbox: addr });
      }
    }
    msgs = Array.from(byId.values()).sort((a, b) => b.received_at - a.received_at);
    cacheMailbox(addressId, addr, msgs);
    if (generation === checkMessagesGeneration) {
      prefetchAdjacentMailboxes(
        ext,
        addresses.filter((candidate) => isLive(candidate)),
        addressId,
        generation
      );
    }

    // Never paint empty over a known stored bag (API flake / filter race)
    if (msgs.length === 0 && stored.length > 0) {
      msgs = stored.map((s) => ({ ...s, original_inbox: addr || s.original_inbox }));
    }

    if (generation !== checkMessagesGeneration) return;
    if (!(await isStillActiveAddress(ext, addressId))) return;

    const emails = mapEmailsForDisplay(msgs, readEmails, addr, { labels: await displayLabels() });
    // Force a new array reference to trigger Svelte reactivity
    setters.setEmails([...emails]);

    const latestRecipient = latestOtp?.recipient?.trim().toLowerCase();
    const otpResult =
      latestOtp?.otp && latestRecipient === addrLower && isOtpCacheFresh(latestOtp)
        ? latestOtp
        : extractLatestOtp({ [addr || addressId]: msgs }, 'address-actions');
    if (otpResult) {
      setters.setLatestOtp(otpResult.otp);
      setters.setLatestOtpSender(otpResult.sender);
      setters.setLatestOtpSenderName(otpResult.senderName);
      setters.setOtpContext(otpResult.context);
    } else {
      setters.setLatestOtp('------');
      setters.setLatestOtpSender('');
      setters.setLatestOtpSenderName('');
      setters.setOtpContext('');
    }
  } catch (e: unknown) {
    logError('checkMessages error:', undefined, e instanceof Error ? e : new Error(String(e)));
    // Fallback: show stored mails so prev/next never blank the list after a network error
    try {
      if (generation !== checkMessagesGeneration) return;
      if (!(await isStillActiveAddress(ext, addressId))) return;
      const { addresses = [], readEmails = {} } = (await ext.storage.local.get([
        'addresses',
        'readEmails',
      ])) as {
        addresses?: Address[];
        readEmails?: Record<string, boolean>;
      };
      const record = addresses.find((i) => i.id === addressId);
      if (record?.address) {
        const msgs =
          cachedMailbox(addressId, record.address) ||
          (await getStoredEmailsForAddress(addressId, record.address));
        const emails = mapEmailsForDisplay(msgs, readEmails, record.address, {
          labels: await displayLabels(),
        });
        if (generation !== checkMessagesGeneration) return;
        setters.setEmails([...emails]);
      }
    } catch {
      /* ignore fallback errors */
    }
  } finally {
    // Only clear loading for the latest request
    if (generation === checkMessagesGeneration) {
      setters.setLoadingEmails(false);
    }
  }
}

export async function selectAddress(
  ext: typeof browser,
  address: string,
  state: AddressState,
  setters: AddressSetters
) {
  const addrNorm = (address || '').trim();
  setters.setSelectedEmail(addrNorm);

  // Prefer finding by address in live list, then all addresses (case-insensitive)
  const acct = findAddressByEmail(state.accounts, state.allAddresses, addrNorm);

  if (acct) {
    // Commit active id FIRST so concurrent checkMessages race guards work correctly
    await writeWithRetry({ activeAddressId: acct.id });

    // Optimistic: paint this address's stored bag immediately so prev/next never
    // shows the previous inbox's mails or an empty flash while network runs.
    try {
      const { readEmails = {} } = (await ext.storage.local.get(['readEmails'])) as {
        readEmails?: Record<string, boolean>;
      };
      const accountAddress = acct.address || addrNorm;
      const bag =
        cachedMailbox(acct.id, accountAddress) ||
        (await getStoredEmailsForAddress(acct.id, accountAddress));
      setters.setEmails([
        ...mapEmailsForDisplay(bag, readEmails, accountAddress, { labels: await displayLabels() }),
      ]);
      if (bag.length === 0) {
        setters.setLatestOtp('------');
        setters.setLatestOtpSender('');
        setters.setLatestOtpSenderName('');
        setters.setOtpContext('');
      }
    } catch {
      /* network path will fill */
    }

    // Soft load - avoid full-page loading flag that can fight list paint
    try {
      await checkMessages(ext, acct.id, '', false, setters);
    } catch (e) {
      logError('selectAddress checkMessages failed', e);
      // Last resort: re-paint storage bag so list never stays blank after a failed fetch
      try {
        const { readEmails = {} } = (await ext.storage.local.get(['readEmails'])) as {
          readEmails?: Record<string, boolean>;
        };
        const accountAddress = acct.address || addrNorm;
        const bag =
          cachedMailbox(acct.id, accountAddress) ||
          (await getStoredEmailsForAddress(acct.id, accountAddress));
        if (bag.length > 0) {
          setters.setEmails([
            ...mapEmailsForDisplay(bag, readEmails, acct.address || addrNorm, {
              labels: await displayLabels(),
            }),
          ]);
        }
      } catch {
        /* ignore */
      }
    }
  } else {
    // Still try storage by address even if account not in memory lists
    try {
      const { readEmails = {} } = (await ext.storage.local.get(['readEmails'])) as {
        readEmails?: Record<string, boolean>;
      };
      const bag = await getStoredEmailsForAddress(undefined, addrNorm);
      setters.setEmails([
        ...mapEmailsForDisplay(bag, readEmails, addrNorm, { labels: await displayLabels() }),
      ]);
    } catch {
      /* ignore */
      setters.setEmails([]);
    }
    setters.setLatestOtp('------');
    setters.setOtpContext('');
  }
}

export async function copyEmail(selectedEmail: string, showToast: (message: string) => void) {
  try {
    await copyToClipboardAndSchedulePurge(selectedEmail);
    showToast(await t('toasts.emailCopiedToClipboard'));
  } catch (error) {
    logError(
      'Failed to copy email',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

export type CreateAddressOptions = {
  /** Skip automatic success toast (caller shows a contextual one). */
  skipToast?: boolean;
};

export async function createAddress(
  ext: typeof browser,
  setters: AddressSetters,
  provider?: string,
  instanceId?: string,
  emailUser?: string,
  options?: CreateAddressOptions
): Promise<string | null> {
  setters.setLoading(true);
  try {
    // Demo isolation: never hit real providers
    try {
      const { isDemoMode, createDemoAddress } = await import('@/features/demo/demo-mode.js');
      if (await isDemoMode(ext)) {
        const addr = await createDemoAddress(ext, emailUser);
        if (addr) {
          setters.setEmails([]);
          setters.setLatestOtp('------');
          setters.setSelectedEmail(addr);
          await loadAddresses(ext, setters, true);
          if (!options?.skipToast) {
            setters.setShowToast(await t('toasts.newAddressCreated'), 'success');
          }
          return addr;
        }
        setters.setShowToast(await t('toasts.importFailed'), 'error');
        return null;
      }
    } catch {
      /* fall through */
    }
    const response = await ext.runtime.sendMessage({
      type: 'createAddress',
      provider,
      instanceId,
      emailUser,
    });
    if (response?.success) {
      const newAddress = response.inbox as Address;
      setters.setEmails([]);
      setters.setLatestOtp('------');
      setters.setOtpContext('');
      const addr = newAddress.address;
      setters.setSelectedEmail(addr);
      await writeWithRetry({ activeAddressId: newAddress.id, onboardingComplete: true });
      await loadAddresses(ext, setters, true);
      // Re-read storage in case background normalized address/domain
      const { addresses = [], activeAddressId } = (await ext.storage.local.get([
        'addresses',
        'activeAddressId',
      ])) as { addresses?: Address[]; activeAddressId?: string };
      const active =
        addresses.find((i) => i.id === (activeAddressId || newAddress.id)) ||
        addresses.find((i) => i.id === newAddress.id) ||
        newAddress;
      const finalAddr = active.address || addr;
      setters.setSelectedEmail(finalAddr);
      await checkMessages(ext, active.id || newAddress.id, '', false, setters);
      if (!options?.skipToast) {
        setters.setShowToast(await t('toasts.newAddressCreated'), 'success');
      }
      return finalAddr;
    } else {
      const errPayload = response?.error;
      const ctx =
        typeof errPayload === 'object' && errPayload !== null
          ? (errPayload as Record<string, unknown>)
          : { message: String(errPayload || 'Failed to create inbox') };

      // Duplicate username - live
      if (ctx.reason === 'duplicate_live') {
        const addr = String(ctx.address || emailUser || '');
        setters.setShowToast(
          (await t('toasts.addressUsernameExists', { address: addr })) as string,
          'warning'
        );
        return null;
      }

      // Duplicate inactive - try unarchive and/or renew automatically when possible
      if (ctx.reason === 'duplicate_inactive') {
        const canUnarchive = !!ctx.canUnarchive && !!ctx.archivedAddressId;
        const canRenew = !!ctx.canRenew && !!ctx.expiredAddressId;
        let recovered = false;

        if (canUnarchive) {
          try {
            await ext.runtime.sendMessage({
              type: 'unarchiveAddress',
              addressId: ctx.archivedAddressId,
            });
            recovered = true;
          } catch {
            /* continue */
          }
        }
        if (canRenew) {
          try {
            const renewRes = await ext.runtime.sendMessage({
              type: 'renewAddress',
              addressId: ctx.expiredAddressId || ctx.addressId,
            });
            if (renewRes?.success) recovered = true;
          } catch {
            /* continue */
          }
        }

        await loadAddresses(ext, setters, true);
        if (recovered) {
          const { addresses = [] } = (await ext.storage.local.get(['addresses'])) as {
            addresses?: Address[];
          };
          const targetId = String(
            ctx.expiredAddressId || ctx.archivedAddressId || ctx.addressId || ''
          );
          const recoveredAddress =
            addresses.find((i) => i.id === targetId) ||
            addresses.find(
              (i) =>
                (i.address || '').split('@')[0].toLowerCase() ===
                String(emailUser || '')
                  .trim()
                  .toLowerCase()
            );
          if (recoveredAddress) {
            setters.setSelectedEmail(recoveredAddress.address);
            await writeWithRetry({ activeAddressId: recoveredAddress.id });
            await checkMessages(ext, recoveredAddress.id, '', false, setters);
          }
          setters.setShowToast(
            (await t('toasts.addressRecoveredExisting', {
              address: String(ctx.address || ''),
            })) as string,
            'success'
          );
          return String(ctx.address || '');
        } else {
          setters.setShowToast(
            (await t('toasts.addressUsernameInactive', {
              address: String(ctx.address || emailUser || ''),
            })) as string,
            'warning'
          );
        }
        return null;
      }

      throw new ApiError(
        typeof errPayload === 'string'
          ? errPayload
          : String(ctx.message || 'Failed to create inbox'),
        { response }
      );
    }
  } catch (e: unknown) {
    logError('createAddress error:', undefined, e instanceof Error ? e : new Error(String(e)));
    setters.setShowToast(await t('toasts.addressCreateFailed'), 'error');
    return null;
  } finally {
    setters.setLoading(false);
  }
}

export async function refreshMailbox(
  ext: typeof browser,
  setters: AddressSetters,
  activeAddressId?: string
) {
  if (activeAddressId) invalidateMailboxCache(activeAddressId);
  setters.setLoading(true);
  try {
    if (activeAddressId) {
      await checkMessages(ext, activeAddressId, '', false, setters);
      const { addresses = [] } = (await ext.storage.local.get(['addresses'])) as {
        addresses?: Address[];
      };
      const refreshedAddress = addresses.find((address) => address.id === activeAddressId);
      if (refreshedAddress?.mailboxRefreshFailure) {
        setters.setShowToast(await t('inbox.refreshHealth.title'), 'warning');
      } else if (
        refreshedAddress &&
        refreshedAddress.expiresAt > 0 &&
        Date.now() >= refreshedAddress.expiresAt &&
        refreshedAddress.accountStatus !== 'archived' &&
        refreshedAddress.accountStatus !== 'deleted'
      ) {
        setters.setShowToast(await t('inbox.refreshHealth.expiredTitle'), 'warning');
      } else {
        setters.setShowToast(await t('toasts.mailboxRefreshed'), 'success');
      }
    }
  } catch (e: unknown) {
    logError('refreshMailbox error:', undefined, e instanceof Error ? e : new Error(String(e)));
    setters.setShowToast(await t('toasts.mailboxRefreshFailed'), 'error');
  } finally {
    setters.setLoading(false);
  }
}

export async function copyOtp(latestOtp: string, showToast: (message: string) => void) {
  if (latestOtp && latestOtp !== '------') {
    try {
      const ok = await copyToClipboardAndSchedulePurge(latestOtp);
      showToast(await t(ok ? 'inbox.otpCopied' : 'inbox.copyFailed'));
    } catch (error) {
      logError(
        'Failed to copy OTP',
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
      showToast(await t('inbox.copyFailed'));
    }
  }
}

export async function toggleNotifications(currentEnabled: boolean, setters: AddressSetters) {
  const newEnabled = !currentEnabled;
  setters.setNotificationsEnabled(newEnabled);
  // Serialized RMW: the whole-key write this replaces rebuilt the record from a
  // read taken before it, so a sound preference (or the expiry warning
  // threshold) changed in the settings view in that window was reverted. The
  // updater patches ONLY `enabled` against the record storage last held, and
  // the parser supplies the same defaults every reader falls back to.
  await updateStoredObject(
    'notificationSettings',
    (current) => ({ ...current, enabled: newEnabled }),
    parseNotificationSettings
  );
  setters.setShowToast(
    await t('toasts.notificationsToggled', { state: newEnabled ? 'enabled' : 'disabled' }),
    'success'
  );
}

export async function autofillForm(
  ext: typeof browser,
  selectedEmail: string,
  showToast: (message: string, type: 'success' | 'error' | 'warning') => void
) {
  try {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      showToast(await t('toasts.noActiveTabFound'), 'error');
      return;
    }
    let result: { success?: boolean; reason?: string; error?: string } | undefined;
    try {
      result = await ext.tabs.sendMessage(tab.id, { type: 'startSignup', email: selectedEmail });
    } catch (error) {
      logError('Could not reach the autofill content script', error);
      showToast(await t('toasts.autofillFailedNoContentScript'), 'error');
      return;
    }
    if (result?.success === true) {
      showToast(await t('toasts.autofillStarted'), 'success');
    } else if (
      result?.reason === 'verification_required' ||
      result?.error === 'verification_required'
    ) {
      showToast(await t('contentAutofill.humanVerificationRequired'), 'warning');
    } else if (result?.reason === 'blocked' || result?.error === 'autofill_blocked') {
      showToast(await t('contentAutofill.siteBlocked'), 'warning');
    } else if (result?.reason === 'address_expired' || result?.error === 'address_expired') {
      showToast(await t('contentAutofill.addressExpired'), 'warning');
    } else if (result?.error === 'no_form' || result?.reason === 'no_compatible_fields') {
      showToast(await t('contentAutofill.noCompatibleFields'), 'warning');
    } else {
      showToast(await t('toasts.autofillFailed'), 'error');
    }
  } catch (error) {
    logError('Autofill request failed', error);
    showToast(await t('toasts.autofillFailed'), 'error');
  }
}

type EmailLocalAction = 'archive' | 'delete' | 'restore';

export async function applyEmailLocalAction(
  _ext: typeof browser,
  emails: Email[],
  action: EmailLocalAction
): Promise<{ updated: number; notFound: number; updatedKeys: string[] }> {
  if (emails.length === 0) return { updated: 0, notFound: 0, updatedKeys: [] };
  return withLock('emails_storage_lock', async () => {
    const { storedEmails = {}, archivedEmails = {} } = await getEmailMaps();
    const now = Date.now();
    let updated = 0;
    let notFound = 0;
    const updatedKeys = new Set<string>();

    for (const email of emails) {
      const rawAddr = email.original_inbox || (email as Email & { address?: string }).address || '';
      const normAddr = rawAddr.toLowerCase();

      const mutateInMap = (map: Record<string, Email[]>): string | null => {
        for (const [key, list] of Object.entries(map)) {
          if (normAddr && key.toLowerCase() !== normAddr) continue;
          if (!Array.isArray(list)) continue;
          const idx = list.findIndex((e) => e.id === email.id);
          if (idx !== -1) {
            const target = { ...list[idx] } as Email & Record<string, unknown>;
            if (action === 'archive') {
              target.local_archived = true;
              target.local_archived_at = now;
            } else if (action === 'delete') {
              target.local_deleted = true;
              target.local_deleted_at = now;
            } else {
              delete target.local_archived;
              delete target.local_archived_at;
              delete target.local_deleted;
              delete target.local_deleted_at;
            }
            list[idx] = target as Email;
            return `${key.toLowerCase()}\u0000${email.id}`;
          }
        }
        // Search across other keys only when the row carried no address. If
        // it named an address and that bag no longer contains this ID, a
        // same-ID message from another inbox must not be mutated by accident.
        if (normAddr) return null;
        for (const [key, list] of Object.entries(map)) {
          if (!Array.isArray(list)) continue;
          const idx = list.findIndex((e) => e.id === email.id);
          if (idx !== -1) {
            const target = { ...list[idx], original_inbox: key } as Email & Record<string, unknown>;
            if (action === 'archive') {
              target.local_archived = true;
              target.local_archived_at = now;
            } else if (action === 'delete') {
              target.local_deleted = true;
              target.local_deleted_at = now;
            } else {
              delete target.local_archived;
              delete target.local_archived_at;
              delete target.local_deleted;
              delete target.local_deleted_at;
            }
            list[idx] = target as Email;
            return `${key.toLowerCase()}\u0000${email.id}`;
          }
        }
        return null;
      };

      const foundInStored = mutateInMap(storedEmails);
      const foundInArchived = !foundInStored ? mutateInMap(archivedEmails) : null;

      if (foundInStored || foundInArchived) {
        updated++;
        updatedKeys.add(foundInStored || foundInArchived || '');
        // Include the caller's row key as well as the actual storage key. A
        // stale address alias can resolve through a bag key and should still
        // update the row the user acted on.
        if (normAddr) updatedKeys.add(`${normAddr}\u0000${email.id}`);
      } else {
        notFound++;
      }
    }

    if (updated > 0) {
      await setLogicalEmailMapsUnlockedForLockedCaller(storedEmails, archivedEmails);
      invalidateMailboxCache();
    }
    return { updated, notFound, updatedKeys: [...updatedKeys] };
  });
}
