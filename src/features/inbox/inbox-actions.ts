import type { browser } from 'wxt/browser';
import { ApiError } from '@/utils/errors.js';
import { logDebug, logError } from '@/utils/logger.js';
import { formatDate, formatTimeLeft, getEmailStatus, timeAgo } from '@/utils/time.js';
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
      received: 0,
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
      const { readEmails = {} } = (await ext.storage.local.get(['readEmails'])) as {
        readEmails?: Record<string, boolean>;
      };
      const emails = msgs.map((m: Email) => ({
        id: m.id,
        from:
          (m as Email & { from_address?: string }).from_address ||
          m.from ||
          m.from_name ||
          'Unknown',
        from_name:
          m.from_name || (m as Email & { from_address?: string }).from_address || m.from || '',
        subject: m.subject || 'No Subject',
        time: timeAgo(m.received_at),
        isOtp: !!m.otp,
        otp: m.otp || null,
        body: m.body_plain || (m.body_html || '').replace(/<[^>]*>/g, ''),
        body_html: m.body_html,
        unread: !readEmails[m.id],
        received_at: m.received_at,
        local_only: m.local_only,
      }));
      // Force a new array reference to trigger Svelte reactivity
      setters.setEmails([...emails]);

      const latestOtpMsg = msgs
        .filter((m: Email) => m.otp)
        .sort((a: Email, b: Email) => b.received_at - a.received_at)[0];
      logDebug(`[inbox-actions] latestOtpMsg: ${JSON.stringify(latestOtpMsg)}`);
      if (latestOtpMsg) {
        setters.setLatestOtp(latestOtpMsg.otp);
        setters.setLatestOtpSender(latestOtpMsg.from || '');
        setters.setLatestOtpSenderName(latestOtpMsg.from_name || '');
        logDebug(
          `[inbox-actions] Set OTP - from: ${latestOtpMsg.from}, from_name: ${latestOtpMsg.from_name}`
        );
        setters.setOtpContext(
          [
            latestOtpMsg.from_name ? `From: ${latestOtpMsg.from_name}` : '',
            timeAgo(latestOtpMsg.received_at),
          ]
            .filter(Boolean)
            .join(' | ')
        );
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

export function copyEmail(selectedEmail: string, showToast: (message: string) => void) {
  navigator.clipboard.writeText(selectedEmail);
  showToast('Email copied to clipboard');
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
      setters.setShowToast('New inbox created', 'success');
    } else throw new ApiError(response?.error || 'Failed to create inbox', { response });
  } catch (e: unknown) {
    logError('createInbox error:', undefined, e instanceof Error ? e : new Error(String(e)));
    setters.setShowToast('Failed to create inbox', 'error');
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
      setters.setShowToast('Inbox refreshed', 'success');
    }
  } catch (e: unknown) {
    logError('refreshInbox error:', undefined, e instanceof Error ? e : new Error(String(e)));
    setters.setShowToast('Failed to refresh inbox', 'error');
  } finally {
    setters.setLoading(false);
  }
}

export function copyOtp(latestOtp: string, showToast: (message: string) => void) {
  if (latestOtp && latestOtp !== '------') {
    navigator.clipboard.writeText(latestOtp);
    showToast('OTP copied to clipboard');
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
  setters.setShowToast(`Notifications ${newEnabled ? 'enabled' : 'disabled'}`, 'success');
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
  setters.setShowToast(`Sound notifications ${newEnabled ? 'enabled' : 'disabled'}`, 'success');
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
  setters.setShowToast('Expiry warning threshold updated', 'success');
}

export async function autofillForm(
  ext: typeof browser,
  selectedEmail: string,
  showToast: (message: string, type: 'success' | 'error' | 'warning') => void
) {
  ext.tabs
    .query({ active: true, currentWindow: true })
    .then(([tab]: Array<{ id?: number }>) => {
      if (tab?.id) {
        ext.tabs
          .sendMessage(tab.id, { action: 'startSignup', email: selectedEmail })
          .then(() => showToast('Autofill started', 'success'))
          .catch(() => showToast('Failed to start autofill (content script not loaded)', 'error'));
      } else {
        showToast('No active tab found', 'error');
      }
    })
    .catch(() => showToast('Failed to start autofill', 'error'));
}
