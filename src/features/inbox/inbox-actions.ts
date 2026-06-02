import type { browser } from 'wxt/browser';
import { extractLatestOtp, mapEmailsForDisplay } from '@/utils/email-mapper.js';
import { ApiError } from '@/utils/errors.js';
import { t } from '@/utils/i18n-utils.js';
import { logError } from '@/utils/logger.js';
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
    }));

    setters.setAllInboxes(allInboxes);
    setters.setAccounts(
      allInboxes.filter(
        (inbox: Account) => inbox.accountStatus !== 'archived' && inbox.accountStatus !== 'deleted'
      )
    );

    if (!skipEmailSelection) {
      const activeById = allInboxes.find((a) => a.id === activeId);
      if (activeById) {
        setters.setSelectedEmail(activeById.address);
      }
    }
  } catch (e: unknown) {
    logError('loadInboxes error:', undefined, e instanceof Error ? e : new Error(String(e)));
  } finally {
    setters.setLoadingInboxes(false);
  }
}

export async function checkMessages(
  ext: typeof browser,
  inboxId: string,
  searchQuery: string,
  otpOnly: boolean,
  setters: InboxSetters
) {
  setters.setLoadingEmails(true);
  try {
    const response = await ext.runtime.sendMessage({
      type: 'checkEmails',
      inboxId,
      filters: { searchQuery: searchQuery.trim(), hasOTP: otpOnly },
    });
    if (response?.success) {
      const msgs = response.messages || [];
      const { readEmails = {}, inboxes = [] } = (await ext.storage.local.get([
        'readEmails',
        'inboxes',
      ])) as {
        readEmails?: Record<string, boolean>;
        inboxes?: Account[];
      };
      const inbox = inboxes.find((i) => i.id === inboxId);
      const emails = mapEmailsForDisplay(msgs, readEmails, inbox?.address || '');
      // Force a new array reference to trigger Svelte reactivity
      setters.setEmails([...emails]);

      const storageForOtp = { _temp: msgs } as Record<string, Email[]>;
      const otpResult = extractLatestOtp(storageForOtp, 'inbox-actions');
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
    }
  } catch (e: unknown) {
    logError('checkMessages error:', undefined, e instanceof Error ? e : new Error(String(e)));
  } finally {
    setters.setLoadingEmails(false);
  }
}

export async function selectAccount(
  ext: typeof browser,
  address: string,
  state: InboxState,
  setters: InboxSetters
) {
  setters.setSelectedEmail(address);
  setters.setEmails([]);
  setters.setLatestOtp('------');
  setters.setOtpContext('');
  const acct =
    state.accounts.find((a) => a.address === address) ||
    state.allInboxes.find((a) => a.address === address);
  if (acct) {
    await ext.storage.local.set({ activeInboxId: acct.id });
    setters.setLoading(true);
    await checkMessages(ext, acct.id, '', false, setters);
    setters.setLoading(false);
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

export async function createInbox(
  ext: typeof browser,
  setters: InboxSetters,
  provider?: string,
  instanceId?: string,
  emailUser?: string
) {
  setters.setLoading(true);
  try {
    const response = await ext.runtime.sendMessage({
      type: 'createInbox',
      provider,
      instanceId,
      emailUser,
    });
    if (response?.success) {
      const newInbox = response.inbox;
      setters.setEmails([]);
      setters.setLatestOtp('------');
      setters.setOtpContext('');
      setters.setSelectedEmail(newInbox.address);
      await ext.storage.local.set({ activeInboxId: newInbox.id });
      await loadInboxes(ext, setters, true);
      setters.setSelectedEmail(newInbox.address);
      await checkMessages(ext, newInbox.id, '', false, setters);
      setters.setShowToast(await t('toasts.newInboxCreated'), 'success');
    } else throw new ApiError(response?.error || 'Failed to create inbox', { response });
  } catch (e: unknown) {
    logError('createInbox error:', undefined, e instanceof Error ? e : new Error(String(e)));
    setters.setShowToast(await t('toasts.inboxCreateFailed'), 'error');
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
      await navigator.clipboard.writeText(latestOtp);
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
}
