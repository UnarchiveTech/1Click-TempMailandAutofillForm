import type { browser } from 'wxt/browser';
import { saveLastGoodSnapshot } from '@/utils/action-history.js';
import { copyToClipboardAndSchedulePurge } from '@/utils/clipboard.js';
import { OTP_CLIPBOARD_CLEAR_MS } from '@/utils/constants.js';
import { extractLatestOtp, mapEmailsForDisplay } from '@/utils/email-mapper.js';
import { ApiError } from '@/utils/errors.js';
import { t } from '@/utils/i18n-utils.js';
import { logError } from '@/utils/logger.js';
import { withLock } from '@/utils/mutex.js';
import { getStoredEmailsMap } from '@/utils/storage-keys.js';
import { formatDate, formatTimeLeft, getEmailStatus } from '@/utils/time.js';
import type { Account, Email, NotificationSettings } from '@/utils/types.js';

export interface InboxState {
  accounts: Account[];
  allInboxes: Account[];
  emails: Email[];
  latestOtp: string;
  latestOtpSender: string;
  latestOtpSenderName: string;
  otpContext: string;
  selectedEmail: string;
  loading: boolean;
  loadingInboxes: boolean;
  loadingEmails: boolean;
  notificationsEnabled: boolean;
}

export interface InboxSetters {
  setAccounts: (accounts: Account[]) => void;
  setAllInboxes: (allInboxes: Account[]) => void;
  setEmails: (emails: Email[]) => void;
  setLatestOtp: (otp: string) => void;
  setLatestOtpSender: (sender: string) => void;
  setLatestOtpSenderName: (name: string) => void;
  setOtpContext: (context: string) => void;
  setSelectedEmail: (email: string) => void;
  setLoading: (loading: boolean) => void;
  setLoadingInboxes: (loading: boolean) => void;
  setLoadingEmails: (loading: boolean) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setSoundEnabled: (soundEnabled: boolean) => void;
  setExpiryWarningThreshold: (expiryWarningThreshold: number) => void;
  setShowToast: (message: string, type: 'success' | 'error' | 'warning') => void;
}

export async function loadInboxes(
  ext: typeof browser,
  setters: InboxSetters,
  skipEmailSelection = false
) {
  setters.setLoadingInboxes(true);
  try {
    const result = (await ext.storage.local.get(['inboxes', 'activeInboxId'])) as {
      inboxes?: Account[];
      activeInboxId?: string;
    };
    const inboxes = result.inboxes || [];
    const activeId = result.activeInboxId;
    const now = Date.now();

    const storedEmailsMap = await getStoredEmailsMap();

    const allInboxes = inboxes.map((inbox: Account) => ({
      id: inbox.id,
      address: inbox.address,
      provider: inbox.provider,
      status: getEmailStatus(inbox),
      autoExtend: inbox.autoExtend || false,
      expiry: inbox.autoExtend
        ? `Auto renew in ${formatTimeLeft((inbox.expiresAt || 0) - now)}`
        : (inbox.expiresAt || 0) > now
          ? `Expires in ${formatTimeLeft(inbox.expiresAt - now)}`
          : 'Expired',
      created: formatDate(inbox.createdAt),
      lastUsed: formatDate(inbox.createdAt),
      received: (storedEmailsMap[inbox.address] || []).length,
      expiresAt: inbox.expiresAt,
      sidToken: inbox.sidToken,
      token: inbox.token,
      tag: inbox.tag || '',
      tagColor: inbox.tagColor,
      accountStatus: inbox.accountStatus || 'active',
      createdAt: inbox.createdAt,
      renewalCount: (inbox as Account & { renewalCount?: number }).renewalCount,
      emailUser: inbox.emailUser,
    }));

    setters.setAllInboxes(allInboxes);
    setters.setAccounts(
      allInboxes.filter(
        (inbox: Account) => inbox.accountStatus !== 'archived' && inbox.accountStatus !== 'deleted'
      )
    );

    // Snapshot after successful load so ErrorBoundary can revert
    try {
      void saveLastGoodSnapshot(ext, 'loadInboxes');
    } catch {
      /* ignore */
    }

    if (!skipEmailSelection) {
      const activeById = allInboxes.find((a) => a.id === activeId);
      if (activeById) {
        setters.setSelectedEmail(activeById.address);
      } else {
        // Fallback after import / missing activeInboxId - prefer first live (non-archived/deleted)
        const firstLive = allInboxes.find(
          (a) => a.accountStatus !== 'archived' && a.accountStatus !== 'deleted'
        );
        const fallback = firstLive || allInboxes[0];
        if (fallback?.address) {
          setters.setSelectedEmail(fallback.address);
          if (fallback.id) {
            try {
              await ext.storage.local.set({ activeInboxId: fallback.id });
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
  } catch (e: unknown) {
    logError('loadInboxes error:', undefined, e instanceof Error ? e : new Error(String(e)));
  } finally {
    setters.setLoadingInboxes(false);
  }
}

/**
 * True if we should still apply this checkMessages result.
 * - If activeInboxId is unset, allow (first paint / import).
 * - If set, must match the inbox we requested (blocks stale prev/next races).
 */
async function isStillActiveInbox(ext: typeof browser, inboxId: string): Promise<boolean> {
  try {
    const { activeInboxId } = (await ext.storage.local.get(['activeInboxId'])) as {
      activeInboxId?: string;
    };
    return !activeInboxId || activeInboxId === inboxId;
  } catch {
    return true;
  }
}

/** Monotonic token so stale prev/next checkMessages cannot apply after a newer switch. */
let checkMessagesGeneration = 0;

/**
 * Resolve stored mail bag for an address.
 * Exact → case-insensitive → same local-part aliases (multi-domain).
 * Never merges bags from different usernames.
 */
function resolveStoredBag(
  storedEmails: Record<string, Email[]>,
  addr: string,
  aliases: string[] = []
): Email[] {
  if (!addr) return [];
  if (storedEmails[addr]?.length) return storedEmails[addr] || [];
  const lower = addr.toLowerCase();
  for (const [k, list] of Object.entries(storedEmails)) {
    if (k.toLowerCase() === lower && list?.length) return list || [];
  }
  const tryKeys = [addr, ...aliases].filter(Boolean);
  for (const key of tryKeys) {
    if (storedEmails[key]?.length) return storedEmails[key] || [];
    const kl = key.toLowerCase();
    for (const [k, list] of Object.entries(storedEmails)) {
      if (k.toLowerCase() === kl && list?.length) return list || [];
    }
  }
  // Same local-part only (multi-domain: user@grr.la ↔ user@guerrillamail.com)
  const local = addr.split('@')[0]?.toLowerCase();
  if (local) {
    const candidates: Email[][] = [];
    for (const [k, list] of Object.entries(storedEmails)) {
      if (!list?.length) continue;
      if (k.split('@')[0]?.toLowerCase() === local) candidates.push(list);
    }
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      for (const list of candidates) {
        const stamped = list.filter(
          (e) => (e.original_inbox || '').toLowerCase() === lower || !e.original_inbox
        );
        if (stamped.length) return stamped;
      }
      return candidates[0];
    }
  }
  return [];
}

/** Move/merge email bags when an inbox address domain changes. */
export async function migrateEmailBags(
  ext: typeof browser,
  fromAddr: string,
  toAddr: string
): Promise<void> {
  if (!fromAddr || !toAddr || fromAddr === toAddr) return;
  if (fromAddr.toLowerCase() === toAddr.toLowerCase()) return;
  try {
    const { storedEmails = {}, archivedEmails = {} } = (await ext.storage.local.get([
      'storedEmails',
      'archivedEmails',
    ])) as {
      storedEmails?: Record<string, Email[]>;
      archivedEmails?: Record<string, Email[]>;
    };

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

    await ext.storage.local.set({
      storedEmails: mergeMove(storedEmails),
      archivedEmails: mergeMove(archivedEmails),
    });
  } catch (e) {
    logError('migrateEmailBags error:', undefined, e instanceof Error ? e : new Error(String(e)));
  }
}

export async function checkMessages(
  ext: typeof browser,
  inboxId: string,
  searchQuery: string,
  otpOnly: boolean,
  setters: InboxSetters
) {
  const generation = ++checkMessagesGeneration;
  // Soft loading only - never blank an already-visible list during prev/next
  setters.setLoadingEmails(true);
  try {
    const {
      readEmails = {},
      inboxes = [],
      latestOtp,
      storedEmails = {},
      demoMode = false,
    } = (await ext.storage.local.get([
      'readEmails',
      'inboxes',
      'latestOtp',
      'storedEmails',
      'demoMode',
    ])) as {
      readEmails?: Record<string, boolean>;
      inboxes?: Account[];
      latestOtp?: { otp: string; sender: string; senderName: string; context: string };
      storedEmails?: Record<string, Email[]>;
      demoMode?: boolean;
    };
    if (generation !== checkMessagesGeneration) return;
    if (!(await isStillActiveInbox(ext, inboxId))) {
      return;
    }

    const inbox = inboxes.find((i) => i.id === inboxId);
    const addr = inbox?.address || '';
    const addrLower = addr.toLowerCase();
    const stored = resolveStoredBag(storedEmails, addr);

    // Demo mode: never call real providers — paint isolated storage bags only
    let response: { success?: boolean; messages?: Email[] } | null = null;
    if (demoMode || inbox?.provider === 'demo') {
      response = { success: true, messages: stored };
    } else {
      response = await ext.runtime.sendMessage({
        type: 'checkEmails',
        inboxId,
        filters: { searchQuery: searchQuery.trim(), hasOTP: otpOnly },
      });
      // Drop stale responses when user already switched accounts (prev/next spam)
      if (generation !== checkMessagesGeneration) return;
      if (!(await isStillActiveInbox(ext, inboxId))) {
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

    // Never paint empty over a known stored bag (API flake / filter race)
    if (msgs.length === 0 && stored.length > 0) {
      msgs = stored.map((s) => ({ ...s, original_inbox: addr || s.original_inbox }));
    }

    if (generation !== checkMessagesGeneration) return;
    if (!(await isStillActiveInbox(ext, inboxId))) return;

    const emails = mapEmailsForDisplay(msgs, readEmails, addr);
    // Force a new array reference to trigger Svelte reactivity
    setters.setEmails([...emails]);

    const storageForOtp = { _temp: msgs } as Record<string, Email[]>;
    const otpResult = latestOtp || extractLatestOtp(storageForOtp, 'inbox-actions');
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
      if (!(await isStillActiveInbox(ext, inboxId))) return;
      const {
        inboxes = [],
        storedEmails = {},
        readEmails = {},
      } = (await ext.storage.local.get(['inboxes', 'storedEmails', 'readEmails'])) as {
        inboxes?: Account[];
        storedEmails?: Record<string, Email[]>;
        readEmails?: Record<string, boolean>;
      };
      const inbox = inboxes.find((i) => i.id === inboxId);
      if (inbox?.address) {
        const msgs = resolveStoredBag(storedEmails, inbox.address);
        const emails = mapEmailsForDisplay(msgs, readEmails, inbox.address);
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

export async function selectAccount(
  ext: typeof browser,
  address: string,
  state: InboxState,
  setters: InboxSetters
) {
  const addrNorm = (address || '').trim();
  setters.setSelectedEmail(addrNorm);

  // Prefer finding by address in live list, then all inboxes (case-insensitive)
  const lower = addrNorm.toLowerCase();
  const acct =
    state.accounts.find((a) => (a.address || '').toLowerCase() === lower) ||
    state.allInboxes.find((a) => (a.address || '').toLowerCase() === lower) ||
    state.accounts.find((a) => a.address === addrNorm) ||
    state.allInboxes.find((a) => a.address === addrNorm);

  if (acct) {
    // Commit active id FIRST so concurrent checkMessages race guards work correctly
    await ext.storage.local.set({ activeInboxId: acct.id });

    // Optimistic: paint this address's stored bag immediately so prev/next never
    // shows the previous inbox's mails or an empty flash while network runs.
    try {
      const { storedEmails = {}, readEmails = {} } = (await ext.storage.local.get([
        'storedEmails',
        'readEmails',
      ])) as {
        storedEmails?: Record<string, Email[]>;
        readEmails?: Record<string, boolean>;
      };
      const bag = resolveStoredBag(storedEmails, acct.address || addrNorm);
      setters.setEmails([...mapEmailsForDisplay(bag, readEmails, acct.address || addrNorm)]);
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
      logError('selectAccount checkMessages failed', e);
      // Last resort: re-paint storage bag so list never stays blank after a failed fetch
      try {
        const { storedEmails = {}, readEmails = {} } = (await ext.storage.local.get([
          'storedEmails',
          'readEmails',
        ])) as {
          storedEmails?: Record<string, Email[]>;
          readEmails?: Record<string, boolean>;
        };
        const bag = resolveStoredBag(storedEmails, acct.address || addrNorm);
        if (bag.length > 0) {
          setters.setEmails([...mapEmailsForDisplay(bag, readEmails, acct.address || addrNorm)]);
        }
      } catch {
        /* ignore */
      }
    }
  } else {
    // Still try storage by address even if account not in memory lists
    try {
      const { storedEmails = {}, readEmails = {} } = (await ext.storage.local.get([
        'storedEmails',
        'readEmails',
      ])) as {
        storedEmails?: Record<string, Email[]>;
        readEmails?: Record<string, boolean>;
      };
      const bag = resolveStoredBag(storedEmails, addrNorm);
      setters.setEmails([...mapEmailsForDisplay(bag, readEmails, addrNorm)]);
    } catch {
      setters.setEmails([]);
    }
    setters.setLatestOtp('------');
    setters.setOtpContext('');
  }
}

export async function copyEmail(selectedEmail: string, showToast: (message: string) => void) {
  try {
    await navigator.clipboard.writeText(selectedEmail);
    showToast(await t('toasts.emailCopiedToClipboard'));
  } catch (error) {
    logError(
      'Failed to copy email',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

export type CreateInboxOptions = {
  /** Skip automatic success toast (caller shows a contextual one). */
  skipToast?: boolean;
};

export async function createInbox(
  ext: typeof browser,
  setters: InboxSetters,
  provider?: string,
  instanceId?: string,
  emailUser?: string,
  options?: CreateInboxOptions
): Promise<string | null> {
  setters.setLoading(true);
  try {
    // Demo isolation: never hit real providers
    try {
      const { isDemoMode, createDemoInbox } = await import('@/features/demo/demo-mode.js');
      if (await isDemoMode(ext)) {
        const addr = await createDemoInbox(ext, emailUser);
        if (addr) {
          setters.setEmails([]);
          setters.setLatestOtp('------');
          setters.setSelectedEmail(addr);
          await loadInboxes(ext, setters, true);
          if (!options?.skipToast) {
            setters.setShowToast(await t('toasts.newInboxCreated'), 'success');
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
      type: 'createInbox',
      provider,
      instanceId,
      emailUser,
    });
    if (response?.success) {
      const newInbox = response.inbox as Account;
      setters.setEmails([]);
      setters.setLatestOtp('------');
      setters.setOtpContext('');
      const addr = newInbox.address;
      setters.setSelectedEmail(addr);
      await ext.storage.local.set({ activeInboxId: newInbox.id, onboardingComplete: true });
      await loadInboxes(ext, setters, true);
      // Re-read storage in case background normalized address/domain
      const { inboxes = [], activeInboxId } = (await ext.storage.local.get([
        'inboxes',
        'activeInboxId',
      ])) as { inboxes?: Account[]; activeInboxId?: string };
      const active =
        inboxes.find((i) => i.id === (activeInboxId || newInbox.id)) ||
        inboxes.find((i) => i.id === newInbox.id) ||
        newInbox;
      const finalAddr = active.address || addr;
      setters.setSelectedEmail(finalAddr);
      await checkMessages(ext, active.id || newInbox.id, '', false, setters);
      if (!options?.skipToast) {
        setters.setShowToast(await t('toasts.newInboxCreated'), 'success');
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
          (await t('toasts.inboxUsernameExists', { values: { address: addr } as never })) as string,
          'warning'
        );
        return null;
      }

      // Duplicate inactive - try unarchive and/or renew automatically when possible
      if (ctx.reason === 'duplicate_inactive') {
        const canUnarchive = !!ctx.canUnarchive && !!ctx.archivedInboxId;
        const canRenew = !!ctx.canRenew && !!ctx.expiredInboxId;
        let recovered = false;

        if (canUnarchive) {
          try {
            await ext.runtime.sendMessage({
              type: 'unarchiveInbox',
              inboxId: ctx.archivedInboxId,
            });
            recovered = true;
          } catch {
            /* continue */
          }
        }
        if (canRenew) {
          try {
            const renewRes = await ext.runtime.sendMessage({
              type: 'renewInbox',
              inboxId: ctx.expiredInboxId || ctx.inboxId,
            });
            if (renewRes?.success) recovered = true;
          } catch {
            /* continue */
          }
        }

        await loadInboxes(ext, setters, true);
        if (recovered) {
          const { inboxes = [] } = (await ext.storage.local.get(['inboxes'])) as {
            inboxes?: Account[];
          };
          const targetId = String(ctx.expiredInboxId || ctx.archivedInboxId || ctx.inboxId || '');
          const recoveredInbox =
            inboxes.find((i) => i.id === targetId) ||
            inboxes.find(
              (i) =>
                (i.address || '').split('@')[0].toLowerCase() ===
                String(emailUser || '')
                  .trim()
                  .toLowerCase()
            );
          if (recoveredInbox) {
            setters.setSelectedEmail(recoveredInbox.address);
            await ext.storage.local.set({ activeInboxId: recoveredInbox.id });
            await checkMessages(ext, recoveredInbox.id, '', false, setters);
          }
          setters.setShowToast(
            (await t('toasts.inboxRecoveredExisting', {
              values: { address: String(ctx.address || '') } as never,
            })) as string,
            'success'
          );
          return String(ctx.address || '');
        } else {
          setters.setShowToast(
            (await t('toasts.inboxUsernameInactive', {
              values: { address: String(ctx.address || emailUser || '') } as never,
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
    logError('createInbox error:', undefined, e instanceof Error ? e : new Error(String(e)));
    setters.setShowToast(await t('toasts.inboxCreateFailed'), 'error');
    return null;
  } finally {
    setters.setLoading(false);
  }
}

export async function refreshInbox(
  ext: typeof browser,
  setters: InboxSetters,
  activeInboxId?: string
) {
  setters.setLoading(true);
  try {
    if (activeInboxId) {
      await checkMessages(ext, activeInboxId, '', false, setters);
      setters.setShowToast(await t('toasts.inboxRefreshed'), 'success');
    }
  } catch (e: unknown) {
    logError('refreshInbox error:', undefined, e instanceof Error ? e : new Error(String(e)));
    setters.setShowToast(await t('toasts.inboxRefreshFailed'), 'error');
  } finally {
    setters.setLoading(false);
  }
}

export async function copyOtp(latestOtp: string, showToast: (message: string) => void) {
  if (latestOtp && latestOtp !== '------') {
    try {
      await copyToClipboardAndSchedulePurge(latestOtp, OTP_CLIPBOARD_CLEAR_MS);
      showToast(await t('inbox.otpCopied'));
    } catch (error) {
      logError(
        'Failed to copy OTP',
        undefined,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
}

export async function toggleNotifications(
  ext: typeof browser,
  currentEnabled: boolean,
  setters: InboxSetters
) {
  const newEnabled = !currentEnabled;
  setters.setNotificationsEnabled(newEnabled);
  const currentSettings = (await ext.storage.local.get(['notificationSettings'])) as {
    notificationSettings?: NotificationSettings;
  };
  await ext.storage.local.set({
    notificationSettings: {
      enabled: newEnabled,
      soundEnabled: currentSettings.notificationSettings?.soundEnabled ?? true,
      expiryWarningThreshold:
        currentSettings.notificationSettings?.expiryWarningThreshold ?? 60 * 60 * 1000,
    },
  });
  setters.setShowToast(
    await t('toasts.notificationsToggled', { state: newEnabled ? 'enabled' : 'disabled' }),
    'success'
  );
}

export async function toggleSoundNotifications(
  ext: typeof browser,
  currentEnabled: boolean,
  setters: InboxSetters
) {
  const newEnabled = !currentEnabled;
  const currentSettings = (await ext.storage.local.get(['notificationSettings'])) as {
    notificationSettings?: NotificationSettings;
  };
  await ext.storage.local.set({
    notificationSettings: {
      enabled: currentSettings.notificationSettings?.enabled ?? true,
      soundEnabled: newEnabled,
      expiryWarningThreshold:
        currentSettings.notificationSettings?.expiryWarningThreshold ?? 60 * 60 * 1000,
    },
  });
  setters.setShowToast(
    await t('toasts.soundNotificationsToggled', { state: newEnabled ? 'enabled' : 'disabled' }),
    'success'
  );
}

export async function setExpiryWarningThreshold(
  ext: typeof browser,
  threshold: number,
  setters: InboxSetters
) {
  const currentSettings = (await ext.storage.local.get(['notificationSettings'])) as {
    notificationSettings?: NotificationSettings;
  };
  await ext.storage.local.set({
    notificationSettings: {
      enabled: currentSettings.notificationSettings?.enabled ?? true,
      soundEnabled: currentSettings.notificationSettings?.soundEnabled ?? true,
      expiryWarningThreshold: threshold,
    },
  });
  setters.setExpiryWarningThreshold(threshold);
  setters.setShowToast(await t('toasts.expiryWarningThresholdUpdated'), 'success');
}

export async function autofillForm(
  ext: typeof browser,
  selectedEmail: string,
  showToast: (message: string, type: 'success' | 'error' | 'warning') => void
) {
  ext.tabs
    .query({ active: true, currentWindow: true })
    .then(async ([tab]: Array<{ id?: number }>) => {
      if (tab?.id) {
        ext.tabs
          .sendMessage(tab.id, { action: 'startSignup', email: selectedEmail })
          .then(async () => showToast(await t('toasts.autofillStarted'), 'success'))
          .catch(async () => showToast(await t('toasts.autofillFailedNoContentScript'), 'error'));
      } else {
        showToast(await t('toasts.noActiveTabFound'), 'error');
      }
    })
    .catch(async () => showToast(await t('toasts.autofillFailed'), 'error'));
}

type EmailLocalAction = 'archive' | 'delete' | 'restore';

export async function applyEmailLocalAction(
  ext: typeof browser,
  emails: Email[],
  action: EmailLocalAction
): Promise<{ updated: number; notFound: number }> {
  if (emails.length === 0) return { updated: 0, notFound: 0 };
  return withLock('stored_emails_lock', async () => {
    const storedEmails = await getStoredEmailsMap();
    const now = Date.now();
    let updated = 0;
    let notFound = 0;

    for (const email of emails) {
      let addr = email.original_inbox;
      let list = addr ? storedEmails[addr] : undefined;
      let idx = list ? list.findIndex((e: Email) => e.id === email.id) : -1;

      // Fallback: search all inboxes for the email by id (covers older stored
      // emails that were stored before storeNewMessages stamped original_inbox).
      if (idx === -1) {
        for (const [candidateAddr, candidateList] of Object.entries(storedEmails)) {
          const candidateIdx = (candidateList as Email[]).findIndex((e) => e.id === email.id);
          if (candidateIdx !== -1) {
            addr = candidateAddr;
            list = candidateList as Email[];
            idx = candidateIdx;
            // Stamp original_inbox on the stored copy so future lookups are fast
            (list[idx] as Email & Record<string, unknown>).original_inbox = candidateAddr;
            break;
          }
        }
      }

      if (idx === -1 || !list || !addr) {
        notFound++;
        continue;
      }

      const target = list[idx] as Email & Record<string, unknown>;
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
      updated++;
    }

    if (updated > 0) {
      await ext.storage.local.set({ storedEmails });
    }
    return { updated, notFound };
  });
}
