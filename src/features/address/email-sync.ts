import { displayLabels } from '@/features/address/display-labels.js';
import { extractLatestOtp, mapEmailsForDisplay } from '@/utils/email/email-mapper.js';
import { loadProviderConfig } from '@/utils/email/email-service.js';
import { logError } from '@/utils/logger.js';
import { isOtpCacheFresh } from '@/utils/otp/otp-cache.js';
import { getStoredEmailsForAddress } from '@/utils/storage/storage-keys.js';
import type { Address, Email } from '@/utils/types.js';

export interface EmailSyncDeps {
  ext: Browser;
  /** Current selected address - read at start, checked for staleness before applying */
  getSelectedEmail: () => string;
  getDisplayedEmail: () => string;
  getAllAddresses: () => Address[];
  getEmails: () => Email[];
  context: string;
  /** Direct mutation callbacks */
  setAllStoredEmails: (v: Record<string, Email[]>) => void;
  setEmails: (v: Email[]) => void;
  setLatestOtp: (v: string) => void;
  setLatestOtpSender: (v: string) => void;
  setLatestOtpSenderName: (v: string) => void;
  setOtpContext: (v: string) => void;
  refreshUnreadCounts: () => Promise<boolean>;
}

export type EmailSyncReason = 'change' | 'poll' | 'initial';

export interface EmailSyncController {
  sync: (reason: EmailSyncReason) => Promise<void>;
  cancel: () => void;
}

/**
 * Serializes the logical freshness of a mounted UI without blocking storage
 * reads. A slower poll/change read must not overwrite a newer result, and a
 * teardown must invalidate any in-flight refresh before it can publish state.
 */
export function createEmailSyncController(deps: EmailSyncDeps): EmailSyncController {
  let generation = 0;
  return {
    sync: (reason) => {
      const requestGeneration = ++generation;
      return syncEmailsFromStorage(deps, reason, () => requestGeneration === generation);
    },
    cancel: () => {
      generation += 1;
    },
  };
}

export async function syncEmailsFromStorage(
  deps: EmailSyncDeps,
  reason: EmailSyncReason,
  isCurrent: () => boolean = () => true
): Promise<void> {
  const selectedEmail = deps.getSelectedEmail();
  if (!selectedEmail || (document.hidden && reason !== 'initial')) return;
  const forAddress = selectedEmail;
  const displayedEmail = deps.getDisplayedEmail();
  const forAlias = displayedEmail && displayedEmail !== selectedEmail ? displayedEmail : undefined;

  try {
    const {
      readEmails = {},
      latestOtp,
      activeAddressId,
    } = (await deps.ext.storage.local.get(['readEmails', 'latestOtp', 'activeAddressId'])) as {
      readEmails?: Record<string, boolean>;
      latestOtp?: {
        otp: string;
        sender: string;
        senderName: string;
        context: string;
        recipient?: string;
        received_at?: number;
      };
      activeAddressId?: string;
    };
    if (!isCurrent() || deps.getSelectedEmail() !== forAddress) return;
    if (activeAddressId) {
      const acct = deps.getAllAddresses().find((a) => a.id === activeAddressId);
      if (acct?.address && acct.address !== forAddress && acct.address !== forAlias) {
        return;
      }
    }

    const allAddresses = deps.getAllAddresses();
    const activeRecord =
      (activeAddressId && allAddresses.find((a) => a.id === activeAddressId)) ||
      allAddresses.find((a) => (a.address || '').toLowerCase() === forAddress.toLowerCase());
    const addressEmails = await getStoredEmailsForAddress(activeRecord?.id, forAddress);
    if (!isCurrent() || deps.getSelectedEmail() !== forAddress) return;
    const key = activeRecord?.address || forAddress;

    if (reason === 'initial') {
      if (!isCurrent()) return;
      deps.setAllStoredEmails({ [key]: addressEmails });
    } else {
      await deps.refreshUnreadCounts();
      if (!isCurrent()) return;
    }

    const emails = deps.getEmails();
    if (addressEmails.length === 0 && emails.length > 0 && deps.getSelectedEmail() === forAddress) {
      const addrLower = forAddress.toLowerCase();
      const belongs = emails.every((e) => {
        const own = (e.original_inbox || '').toLowerCase();
        return !own || own === addrLower;
      });
      if (belongs) return;
    }

    if (!isCurrent() || deps.getSelectedEmail() !== forAddress) return;

    let retentionMs: number | undefined;
    try {
      const acct = allAddresses.find((a) => a.address === key || a.address === forAddress);
      if (acct?.provider)
        retentionMs = loadProviderConfig(acct.provider).expiry?.messageRetentionDuration;
    } catch {
      /* ignore */
    }

    if (!isCurrent() || deps.getSelectedEmail() !== forAddress) return;
    deps.setEmails([
      ...mapEmailsForDisplay(addressEmails, readEmails, key || forAddress, {
        labels: await displayLabels(),
        messageRetentionMs: retentionMs,
      }),
    ]);
    const latestRecipient = latestOtp?.recipient?.trim().toLowerCase();
    const isSelectedRecipient = [key, forAddress, forAlias]
      .filter((address): address is string => !!address)
      .some((address) => address.trim().toLowerCase() === latestRecipient);
    const otpResult =
      latestOtp?.otp && isSelectedRecipient && isOtpCacheFresh(latestOtp)
        ? latestOtp
        : extractLatestOtp({ [key]: addressEmails }, deps.context);
    if (!isCurrent()) return;
    if (otpResult) {
      deps.setLatestOtp(otpResult.otp);
      deps.setLatestOtpSender(otpResult.sender);
      deps.setLatestOtpSenderName(otpResult.senderName);
      deps.setOtpContext(otpResult.context);
    } else if (reason === 'change') {
      deps.setLatestOtp('------');
      deps.setLatestOtpSender('');
      deps.setLatestOtpSenderName('');
      deps.setOtpContext('');
    }
  } catch (e) {
    logError(`Error syncing emails from storage (${reason})`, e);
  }
}
