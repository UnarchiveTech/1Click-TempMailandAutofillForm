/**
 * webmcp/tools.ts - Background implementations for the WebMCP tools exposed
 * by the 1Click page script (webmcp-page.unlisted.ts).
 *
 * 1Click analog of `calculator-webmcp/background.js`: all privileged logic
 * lives here (storage, provider API calls, inbox creation). The page script
 * never performs these actions itself - it only forwards requests through the
 * content-script bridge, which arrives here as a `webmcpTool` message.
 *
 * Security notes (mirroring calculator-webmcp README § Security):
 * - The page script cannot call chrome.* APIs; the bridge validates message
 *   shape before forwarding; the background re-validates tool names + args.
 * - `create_temp_email` and `burn_inbox` are the side-effecting tools. They
 *   are intentionally NOT marked read-only in the page script, so agents
 *   prompt the user before invoking them, and each is rate-limited per tab so
 *   a misbehaving page cannot spam mailbox creation or deletion. (The
 *   extension's stricter gesture-token flow - `createAddressWithGesture` -
 *   remains the path for content-script-driven creates; WebMCP agents go
 *   through these tools instead.)
 */

import { browser } from 'wxt/browser';
import { createDemoAddress, isDemoMode } from '@/features/demo/demo-mode.js';
import { getActiveAddressMeta } from '@/features/intelligence/active-inbox-meta.js';
import { isWebmcpAccessAllowed } from '@/utils/browser/webmcp-access.js';
import { extractLatestOtp } from '@/utils/email/email-mapper.js';
import { logError } from '@/utils/logger.js';
import { withLock } from '@/utils/mutex.js';
import { isOtpCacheFresh } from '@/utils/otp/otp-cache.js';
import { isRealOtp } from '@/utils/otp/otp-code.js';
import {
  getAddresses,
  getArchivedEmailsMap,
  getStoredEmailsForAddress,
  getStoredEmailsMap,
} from '@/utils/storage/storage-keys.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { toMs } from '@/utils/time/time.js';
import type { Address, Email, EmailFilters } from '@/utils/types.js';
import {
  consumePendingGestureToken,
  validateAndConsumeGestureToken,
} from '@/utils/ui/gesture-token.js';
import { checkNewEmails, createAddress, deleteAddress } from '../address/address-manager.js';
import { storeNewMessages } from '../address/email-storage.js';

export interface WebmcpToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/** True when a plain JSON-serializable object (tool args). */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Clamp a positive integer arg to [min, max]; fallback when missing/invalid. */
function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function receivedAtOrNull(timestamp: number): string | null {
  const ms = toMs(timestamp);
  if (!ms || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * Match a sender query against a From field. If the query contains '@' it is
 * treated as an exact email address; otherwise it is treated as a bare domain.
 * Supports From fields in both `user@x.com` and `"Name <user@x.com>"` forms.
 */
function senderMatches(query: string, from: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const raw = from.trim().toLowerCase();
  if (!raw) return false;
  // Extract the bare address from the From field (may include display name)
  const match = /<([^>]+)>/.exec(raw);
  const addr = match ? match[1].trim() : raw;
  if (q.includes('@')) {
    // Exact email address match
    return addr === q;
  }
  // A domain query is exact or a parent-domain suffix. A bare brand token must
  // match a complete label; substring matching lets `mail.com` match
  // `notmail.com` and `example.com.evil`.
  const at = addr.lastIndexOf('@');
  const domain = (at === -1 ? addr : addr.slice(at + 1)).replace(/\.$/, '');
  if (q.includes('.')) return domain === q || domain.endsWith(`.${q}`);
  return domain.split('.').includes(q);
}

function sameAddress(left: string | undefined, right: string | undefined): boolean {
  return !!left && !!right && left.trim().toLowerCase() === right.trim().toLowerCase();
}

function emailAccessDenied(): WebmcpToolResult {
  return {
    success: false,
    error:
      'WebMCP access is not enabled for this website. Enable email access for this domain first.',
  };
}

/** Compact email listing (keeps tool output well under Chrome's ~1.5K budget). */
function compactEmail(email: Email): Record<string, unknown> {
  const preview = String(email.body_plain || email.body || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return {
    id: email.id,
    from: email.from || '',
    fromName: email.from_name || '',
    subject: email.subject || '',
    receivedAt: receivedAtOrNull(email.received_at || 0),
    hasOtp: isRealOtp(email.otp),
    preview,
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

async function getActiveEmail(): Promise<WebmcpToolResult> {
  const meta = await getActiveAddressMeta();
  if (!meta.addressId || !meta.address) {
    return {
      success: false,
      error: 'No active temporary inbox. Create one with create_temp_email.',
    };
  }
  const addresses = await getAddresses();
  const record = addresses.find((i) => i.id === meta.addressId);
  return {
    success: true,
    result: {
      address: meta.address,
      addressId: meta.addressId,
      provider: meta.provider || null,
      providerDisplay: meta.providerDisplay || null,
      expiresAt: record?.expiresAt ?? null,
      accountStatus: record?.accountStatus ?? null,
      // Non-sensitive; lets agents tell a third-party instance from the
      // provider's own (e.g. Burner on Alphac vs burner.kiwi).
      instanceUrl: record?.instanceUrl ?? null,
    },
  };
}

/**
 * Per-tab rate limit for `create_temp_email` (ms). A malicious page driving
 * the bridge cannot spam mailbox creation faster than this.
 */
const CREATE_COOLDOWN_MS = 10_000;
const lastCreateByTab = new Map<number, number>();
let lastCreateGlobal = 0;

/** Per-tab rate limit for `burn_inbox` (ms), mirroring `create_temp_email`. */
const BURN_COOLDOWN_MS = 10_000;
const lastBurnByTab = new Map<number, number>();
let lastBurnGlobal = 0;

type CooldownAction = 'create' | 'burn';

/** Atomically check and reserve a cooldown before any awaited side effect. */
async function reserveCooldown(
  action: CooldownAction,
  senderTabId: number | undefined
): Promise<{ reservedAt: number; waitMs: number }> {
  const duration = action === 'create' ? CREATE_COOLDOWN_MS : BURN_COOLDOWN_MS;
  return withLock(`webmcp_${action}_cooldown_lock`, async () => {
    const globalLast = action === 'create' ? lastCreateGlobal : lastBurnGlobal;
    const byTab = action === 'create' ? lastCreateByTab : lastBurnByTab;
    const now = Date.now();
    // Successful calls leave their per-tab timestamp behind. Retire expired
    // entries on the next reservation so opening many short-lived tabs cannot
    // grow this service-worker cache for its entire lifetime.
    for (const [tabId, reservedAt] of byTab) {
      if (now >= reservedAt && now - reservedAt >= duration) byTab.delete(tabId);
    }
    const globalWait = duration - (now - globalLast);
    const tabWait =
      senderTabId === undefined ? 0 : duration - (now - (byTab.get(senderTabId) ?? 0));
    const waitMs = Math.max(globalWait, tabWait, 0);
    if (waitMs > 0) return { reservedAt: 0, waitMs };

    if (action === 'create') lastCreateGlobal = now;
    else lastBurnGlobal = now;
    if (senderTabId !== undefined) byTab.set(senderTabId, now);
    return { reservedAt: now, waitMs: 0 };
  });
}

/** Release a reservation when the request fails its gesture gate. */
async function releaseCooldownReservation(
  action: CooldownAction,
  senderTabId: number | undefined,
  reservedAt: number
): Promise<void> {
  await withLock(`webmcp_${action}_cooldown_lock`, async () => {
    const byTab = action === 'create' ? lastCreateByTab : lastBurnByTab;
    if (action === 'create' && lastCreateGlobal === reservedAt) lastCreateGlobal = 0;
    if (action === 'burn' && lastBurnGlobal === reservedAt) lastBurnGlobal = 0;
    if (senderTabId !== undefined && byTab.get(senderTabId) === reservedAt) {
      byTab.delete(senderTabId);
    }
  });
}

export function _resetWebmcpRateLimitsForTest(): void {
  lastCreateByTab.clear();
  lastCreateGlobal = 0;
  lastBurnByTab.clear();
  lastBurnGlobal = 0;
}

async function burnAddress(
  args: Record<string, unknown>,
  senderTabId?: number,
  senderTabUrl?: string
): Promise<WebmcpToolResult> {
  // Require page authorization for destructive operations, matching the
  // authorization boundary used by every read-based tool. A page that is not
  // opted into email access must never create or destroy a temporary mailbox.

  // Reserve atomically before the gesture gate so a parallel call cannot
  // consume a second token and start another deletion before this one finishes.
  const cooldown = await reserveCooldown('burn', senderTabId);
  if (cooldown.waitMs > 0) {
    return {
      success: false,
      error: `Please wait ${Math.ceil(cooldown.waitMs / 1000)}s before burning another inbox.`,
    };
  }

  // Gesture gate: burning the active inbox is destructive and must be tied to
  // an explicit user interaction in the extension UI (popup / sidepanel / app),
  // mirroring createAddressWithGesture. A page that is merely opted-in must not
  // be able to burn the inbox on cooldown alone; the "ask the user" annotation
  // only binds well-behaved agents. Extension-internal callers (no tab URL) are
  // trusted - they are the extension's own pages, not a web page via WebMCP -
  // so the gate only applies to page-context callers (tabUrl present).
  const host = getHostnameFromUrl(senderTabUrl);
  if (host) {
    let hasValidGesture = false;
    const explicitToken =
      typeof args.gestureToken === 'string' ? (args.gestureToken as string).trim() : '';
    if (explicitToken) {
      hasValidGesture = await validateAndConsumeGestureToken(
        explicitToken,
        'burn-inbox',
        senderTabId ?? -1
      );
    } else {
      const pending =
        senderTabId == null ? null : await consumePendingGestureToken('burn-inbox', senderTabId);
      if (pending) {
        hasValidGesture = await validateAndConsumeGestureToken(
          pending,
          'burn-inbox',
          senderTabId ?? -1
        );
      }
    }
    if (!hasValidGesture) {
      await releaseCooldownReservation('burn', senderTabId, cooldown.reservedAt);
      // A background-opened tab does not authorize deletion. The user must
      // perform the destructive action in the extension UI.
      try {
        const { openExtensionUiInternal } = await import('../runtime/message-handler.js');
        await openExtensionUiInternal(
          {
            type: 'openExtensionUi',
            reason: 'burn-inbox',
            hint: 'burn-inbox',
          } as unknown as import('@/utils/types.js').RuntimeMessage,
          senderTabId == null ? {} : { gestureTabId: senderTabId }
        );
      } catch {
        /* best-effort - the instructive error below is sufficient */
      }
      return {
        success: false,
        error:
          'Burning an inbox requires confirmation in the extension UI. Open the extension and delete the inbox there.',
      };
    }
  }

  const meta = await getActiveAddressMeta();
  if (!meta.addressId || !meta.address) {
    return { success: false, error: 'No active temporary inbox to burn.' };
  }

  const deleted = await deleteAddress(meta.addressId, false);
  if (!deleted.success) {
    const detail = deleted.error && !deleted.error.startsWith('errors.') ? deleted.error : '';
    return { success: false, error: detail || 'Failed to delete the active inbox.' };
  }

  // The burned inbox can no longer be the active one (guard against a race
  // where another path already switched to a different inbox).
  const { activeAddressId } = (await browser.storage.local.get('activeAddressId')) as {
    activeAddressId?: string;
  };
  if (activeAddressId === meta.addressId) {
    await browser.storage.local.remove('activeAddressId');
  }
  return {
    success: true,
    result: { address: meta.address, addressId: meta.addressId },
  };
}

async function createTempEmail(
  args: Record<string, unknown>,
  senderTabId?: number,
  senderTabUrl?: string
): Promise<WebmcpToolResult> {
  // Require page authorization for account-changing operations, same as burn_inbox.

  // Reserve atomically before the gesture gate so parallel requests cannot
  // all pass a read-only cooldown check and create several inboxes at once.
  const cooldown = await reserveCooldown('create', senderTabId);
  if (cooldown.waitMs > 0) {
    return {
      success: false,
      error: `Please wait ${Math.ceil(cooldown.waitMs / 1000)}s before creating another inbox.`,
    };
  }

  // Gesture gate: creating an inbox is a side-effecting operation and must be
  // tied to an explicit user interaction in the extension UI (popup /
  // sidepanel / app), mirroring burn_inbox. A page that is merely opted-in
  // must not be able to mint mailboxes on cooldown alone - that spams the
  // provider API and pollutes the address list; the "ask the user"
  // annotation only binds well-behaved agents. Extension-internal callers
  // (no tab URL) are trusted - they are the extension's own pages, not a web
  // page via WebMCP - so the gate only applies to page-context callers.
  const host = getHostnameFromUrl(senderTabUrl);
  if (host) {
    let hasValidGesture = false;
    const explicitToken =
      typeof args.gestureToken === 'string' ? (args.gestureToken as string).trim() : '';
    if (explicitToken) {
      hasValidGesture = await validateAndConsumeGestureToken(
        explicitToken,
        'create-inbox',
        senderTabId ?? -1
      );
    } else {
      const pending =
        senderTabId == null ? null : await consumePendingGestureToken('create-inbox', senderTabId);
      if (pending) {
        hasValidGesture = await validateAndConsumeGestureToken(
          pending,
          'create-inbox',
          senderTabId ?? -1
        );
      }
    }
    if (!hasValidGesture) {
      await releaseCooldownReservation('create', senderTabId, cooldown.reservedAt);
      // A background-opened tab does not authorize creation. The user must
      // perform this account-changing action in the extension UI.
      try {
        const { openExtensionUiInternal } = await import('../runtime/message-handler.js');
        await openExtensionUiInternal(
          {
            type: 'openExtensionUi',
            reason: 'create-inbox',
            hint: 'create-inbox',
          } as unknown as import('@/utils/types.js').RuntimeMessage,
          senderTabId == null ? {} : { gestureTabId: senderTabId }
        );
      } catch {
        /* best-effort - the instructive error below is sufficient */
      }
      return {
        success: false,
        error:
          'Creating an inbox requires confirmation in the extension UI. Open the extension and create the inbox there.',
      };
    }
  }

  // Demo mode must remain offline for WebMCP as it is for extension UI paths.
  if (await isDemoMode(browser)) {
    const address = await createDemoAddress(browser);
    if (!address) return { success: false, error: 'Demo inbox limit reached.' };
    const demoAddresses = await getAddresses();
    const record = demoAddresses.find((item) => item.address === address);
    if (!record) return { success: false, error: 'Failed to create demo inbox.' };
    await writeWithRetry({ activeAddressId: record.id });
    return {
      success: true,
      result: { address: record.address, addressId: record.id, provider: 'demo' },
    };
  }

  // Same path as the "quick generate" keyboard shortcut (createAddress() with
  // no args uses the user's selected provider).
  let record: Address;
  try {
    record = await createAddress();
  } catch (error: unknown) {
    // A provider failure is an expected tool outcome, not an unexpected
    // dispatch exception. Return useful agent-facing English while keeping
    // provider URLs and credential-like values out of the page context.
    await releaseCooldownReservation('create', senderTabId, cooldown.reservedAt);
    logError('WebMCP inbox creation failed:', error);
    const detail = error instanceof Error ? error.message.trim() : '';
    const safeDetail = detail
      .replace(/https?:\/\/[^\s"'<>]+/gi, '[provider URL]')
      .replace(
        /(authorization|access[_ -]?token|refresh[_ -]?token|api[_ -]?key|password|secret)\b\s*[:=]\s*[^\s,;]+/gi,
        '$1=[redacted]'
      )
      .replace(/[\r\n\t]+/g, ' ')
      .slice(0, 240);
    return {
      success: false,
      error: safeDetail
        ? `Inbox creation failed: ${safeDetail}`
        : 'The selected provider could not create an inbox. Check the provider connection and try again.',
    };
  }

  // Make the fresh mailbox the active one so subsequent reads target it.
  await writeWithRetry({ activeAddressId: record.id });
  return {
    success: true,
    result: {
      address: record.address,
      addressId: record.id,
      provider: record.provider ?? null,
      expiresAt: record.expiresAt ?? null,
      accountStatus: record.accountStatus ?? null,
    },
  };
}

/**
 * Resolve messages for a WebMCP read tool. Demo inboxes (global demoMode, or
 * an address whose provider is `demo`) serve the stored bag only and never
 * touch real providers - mirroring the checkEmails / checkEmailsBulk handlers
 * in message-handler.ts. Returns whether the demo path was taken so callers
 * can skip live-only side effects (e.g. persisting API messages).
 */
async function fetchInboxMessages(
  addressId: string,
  filters?: EmailFilters
): Promise<{ messages: Email[]; demo: boolean }> {
  const { demoMode, addresses = [] } = (await browser.storage.local.get([
    'demoMode',
    'addresses',
  ])) as {
    demoMode?: boolean;
    addresses?: Address[];
  };
  const demoAddress = addresses.find((i) => i.id === addressId);
  if (demoMode || demoAddress?.provider === 'demo') {
    const bag = await getStoredEmailsForAddress(addressId, demoAddress?.address || '');
    return { messages: bag, demo: true };
  }
  return { messages: await checkNewEmails(addressId, filters), demo: false };
}

async function getLatestEmails(args: Record<string, unknown>): Promise<WebmcpToolResult> {
  const meta = await getActiveAddressMeta();
  if (!meta.addressId) {
    return {
      success: false,
      error: 'No active temporary inbox. Create one with create_temp_email.',
    };
  }

  const limit = clampInt(args.limit, 5, 1, 10);
  const { messages, demo } = await fetchInboxMessages(meta.addressId);

  // Persist freshly-fetched API messages (same as the UI `checkEmails` path).
  if (!demo) {
    const addresses = await getAddresses();
    const record = addresses.find((i) => i.id === meta.addressId);
    if (record) {
      const apiMsgs = messages.filter((m) => !m.local_only);
      if (apiMsgs.length > 0) {
        await storeNewMessages(record.address, apiMsgs);
      }
    }
  }

  const emails = messages
    .slice()
    .sort((a, b) => (b.received_at || 0) - (a.received_at || 0))
    .slice(0, limit)
    .map(compactEmail);

  return { success: true, result: { count: emails.length, emails } };
}

async function getOtpFrom(
  args: Record<string, unknown>,
  senderTabUrl?: string
): Promise<WebmcpToolResult> {
  const sender = typeof args.sender === 'string' ? args.sender.trim().toLowerCase() : '';
  if (!sender) {
    return { success: false, error: 'sender is required (a string).' };
  }

  const meta = await getActiveAddressMeta();
  const callerHost = getHostnameFromUrl(senderTabUrl);
  if (!meta.address && callerHost) {
    return {
      success: false,
      error: `No OTP found from a sender matching "${sender}": no active temporary inbox.`,
    };
  }

  const latestOtp = await getLatestOtpCache();
  const storedEmails = await getStoredEmailsMap();
  const activeStoredEmails = filterStoredEmailsForCaller(
    storedEmails,
    callerHost,
    meta.address ?? undefined
  );

  // Fast path: use the cached OTP only when it is explicitly addressed to the
  // active inbox AND still fresh (same staleness guard as the copy-latest-otp
  // shortcut): the cache is not cleared by expiry-archiving, deletion or
  // eviction, so without the age bound this path would serve a code whose
  // message no longer exists. Fall through to the inbox scan instead.
  if (
    latestOtp?.otp &&
    isOtpCacheFresh(latestOtp) &&
    sameAddress(latestOtp.recipient, meta.address ?? undefined)
  ) {
    const cachedFrom = senderMatches(sender, latestOtp.sender || '');
    if (cachedFrom) {
      return {
        success: true,
        result: {
          otp: latestOtp.otp,
          sender: latestOtp.sender || '',
          senderName: latestOtp.senderName || '',
          subject: undefined,
          receivedAt: latestOtp.received_at ? receivedAtOrNull(latestOtp.received_at) : null,
          address: undefined,
        },
      };
    }
  }

  // Otherwise scan only the active inbox for the newest matching message.
  let best: Email | null = null;
  let bestAddress = '';
  for (const [address, list] of Object.entries(activeStoredEmails)) {
    for (const m of list) {
      if (!isRealOtp(m.otp)) continue;
      // Match the parsed From address only. Concatenating `from_name` here
      // turns `user@example.com Display Name` into a malformed address and
      // makes the domain comparison reject otherwise valid senders.
      if (!senderMatches(sender, m.from || '')) continue;
      if (!best || m.received_at > best.received_at) {
        best = m;
        bestAddress = address;
      }
    }
  }

  if (!best) {
    return {
      success: false,
      error: `No OTP found from a sender matching "${sender}". Try get_latest_emails first, or wait for the email to arrive.`,
    };
  }

  return {
    success: true,
    result: {
      otp: best.otp,
      sender: best.from || '',
      senderName: best.from_name || '',
      subject: best.subject || '',
      receivedAt: receivedAtOrNull(best.received_at || 0),
      address: bestAddress,
    },
  };
}

async function listAddresses(senderTabUrl?: string): Promise<WebmcpToolResult> {
  const addresses = await getAddresses();
  const meta = await getActiveAddressMeta();
  const callerHost = getHostnameFromUrl(senderTabUrl);
  // Page agents may inspect only the inbox already visible to that site.
  // Extension-internal callers have no page host and retain the full listing.
  const visibleAddresses = callerHost
    ? addresses.filter((item) =>
        isVisibleInboxForCaller(item.address, callerHost, meta.address ?? undefined)
      )
    : addresses;
  const now = Date.now();
  const list = visibleAddresses.map((i) => ({
    id: i.id,
    address: i.address,
    provider: i.provider ?? null,
    status:
      i.accountStatus === 'archived' || i.accountStatus === 'deleted'
        ? i.accountStatus
        : i.expiresAt > 0 && i.expiresAt <= now
          ? 'expired'
          : 'active',
    createdAt: i.createdAt ? new Date(i.createdAt).toISOString() : null,
    expiresAt: i.expiresAt ? new Date(i.expiresAt).toISOString() : null,
    autoExtend: Boolean(i.autoExtend),
    isActive: i.id === meta.addressId,
    // Non-sensitive instance info (never tokens) - see get_active_email.
    instanceUrl: i.instanceUrl ?? null,
  }));
  return { success: true, result: { count: list.length, addresses: list } };
}

/**
 * Full email body cap. The list tools only expose 120-char previews; this
 * tool exists to hand agents the real content, but still bounds it so a
 * newsletter cannot blow Chrome's output budget.
 */
const EMAIL_BODY_CAP = 10_000;

async function getEmail(
  args: Record<string, unknown>,
  senderTabUrl?: string
): Promise<WebmcpToolResult> {
  // Deny before looking up ids or inbox contents so an opted-out page cannot
  // distinguish a real mailbox message from a missing one by error response.

  const emailId = typeof args.emailId === 'string' ? args.emailId.trim() : '';
  if (!emailId) {
    return { success: false, error: 'emailId is required (a string).' };
  }
  const address = typeof args.address === 'string' ? args.address.trim() : undefined;

  const [storedEmails, archivedEmails, meta] = await Promise.all([
    getStoredEmailsMap(),
    getArchivedEmailsMap(),
    getActiveAddressMeta(),
  ]);
  const callerHost = getHostnameFromUrl(senderTabUrl);

  if (!meta.address && callerHost) {
    return {
      success: false,
      error: 'No active temporary inbox. Create one with create_temp_email.',
    };
  }
  if (callerHost && address && !sameAddress(address, meta.address ?? undefined)) {
    return { success: false, error: 'Only the active temporary inbox can be read by this tool.' };
  }

  // Email IDs are not globally unique (providers reuse them), so collect only
  // matches from the active inbox. A page must never select another mailbox.
  const candidates: Array<{ address: string; email: Email }> = [];
  for (const [address, list] of Object.entries(storedEmails)) {
    if (!isVisibleInboxForCaller(address, callerHost, meta.address ?? undefined)) continue;
    for (const email of list) {
      if (email.id === emailId) candidates.push({ address, email });
    }
  }
  for (const [address, list] of Object.entries(archivedEmails)) {
    if (callerHost && !sameAddress(address, meta.address ?? undefined)) continue;
    for (const email of list) {
      if (email.id === emailId) candidates.push({ address, email });
    }
  }
  if (candidates.length === 0) {
    return { success: false, error: `No stored email found with id "${emailId}".` };
  }

  // When caller supplies an address or meta has one, require an exact match.
  // Never fall back to candidates[0] when IDs collide across mailboxes - that
  // would leak a message from a different mailbox to the caller.
  let pick: { address: string; email: Email } | undefined;
  if (address) {
    pick = candidates.find((c) => sameAddress(c.address, address)) ?? undefined;
  } else if (meta.address) {
    pick = candidates.find((c) => sameAddress(c.address, meta.address ?? undefined)) ?? undefined;
  } else {
    pick = candidates.reduce((a, b) => (b.email.received_at > a.email.received_at ? b : a));
  }
  if (!pick) {
    return { success: false, error: `Email "${emailId}" not found for the requested address.` };
  }
  const email = pick.email;
  const body = String(email.body_plain || email.body || '')
    .replace(/\r\n/g, '\n')
    .trim();
  const bodyTruncated = body.length > EMAIL_BODY_CAP;
  return {
    success: true,
    result: {
      id: email.id,
      address: pick.address,
      from: email.from || '',
      fromName: email.from_name || '',
      subject: email.subject || '',
      receivedAt: receivedAtOrNull(email.received_at || 0),
      hasOtp: isRealOtp(email.otp),
      otp: isRealOtp(email.otp) ? email.otp : undefined,
      hasAttachment: Boolean(email.hasAttachment) || (email.attachments?.length ?? 0) > 0,
      attachments:
        email.attachments?.map((a) => ({ filename: a.filename, mimeType: a.mimeType })) ?? [],
      magicLinks: email.magicLinks?.map((m) => ({ url: m.url, label: m.label ?? undefined })) ?? [],
      body: bodyTruncated ? body.slice(0, EMAIL_BODY_CAP) : body,
      bodyTruncated,
    },
  };
}

async function searchEmails(args: Record<string, unknown>): Promise<WebmcpToolResult> {
  const meta = await getActiveAddressMeta();
  if (!meta.addressId) {
    return {
      success: false,
      error: 'No active temporary inbox. Create one with create_temp_email.',
    };
  }

  const query = typeof args.query === 'string' ? args.query.trim() : undefined;
  const senderDomain = typeof args.senderDomain === 'string' ? args.senderDomain.trim() : undefined;
  const recipient = typeof args.recipient === 'string' ? args.recipient.trim() : undefined;
  const hasOtp = args.hasOtp === true || args.hasOtp === 'true';
  const limit = clampInt(args.limit, 10, 1, 20);

  const filters: EmailFilters = {};
  if (query) filters.searchQuery = query;
  if (senderDomain) filters.senderDomain = senderDomain;
  if (recipient) filters.recipient = recipient;
  if (hasOtp) filters.hasOTP = true;

  // checkNewEmails applies filterMessages to the merged (API + stored) list.
  const { messages } = await fetchInboxMessages(meta.addressId, filters);
  const emails = messages
    .slice()
    .sort((a, b) => (b.received_at || 0) - (a.received_at || 0))
    .slice(0, limit)
    .map(compactEmail);

  return {
    success: true,
    result: {
      query: query ?? null,
      hasOtp,
      senderDomain: senderDomain ?? null,
      recipient: recipient ?? null,
      count: emails.length,
      emails,
    },
  };
}

function getHostnameFromUrl(rawUrl?: string): string | null {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isVisibleInboxForCaller(
  address: string,
  callerHost: string | null,
  activeAddress: string | undefined
): boolean {
  return !callerHost || sameAddress(address, activeAddress);
}

interface LatestOtpCacheRecord {
  otp?: string;
  sender?: string;
  senderName?: string;
  received_at?: number;
  recipient?: string;
}

async function getLatestOtpCache(): Promise<LatestOtpCacheRecord | undefined> {
  const { latestOtp } = (await browser.storage.local.get(['latestOtp'])) as {
    latestOtp?: LatestOtpCacheRecord;
  };
  return latestOtp;
}

function filterStoredEmailsForCaller(
  storedEmails: Record<string, Email[]>,
  callerHost: string | null,
  activeAddress: string | undefined
): Record<string, Email[]> {
  const activeStoredEmails: Record<string, Email[]> = {};
  for (const [address, list] of Object.entries(storedEmails)) {
    if (isVisibleInboxForCaller(address, callerHost, activeAddress)) {
      activeStoredEmails[address] = list;
    }
  }
  return activeStoredEmails;
}

async function getLatestOtp(senderTabUrl?: string): Promise<WebmcpToolResult> {
  const latestOtp = await getLatestOtpCache();
  const storedEmails = await getStoredEmailsMap();
  const meta = await getActiveAddressMeta();
  const callerHost = getHostnameFromUrl(senderTabUrl);
  if (!meta.address && callerHost) {
    return { success: false, error: 'No OTP received yet: no active temporary inbox.' };
  }

  const activeStoredEmails = filterStoredEmailsForCaller(
    storedEmails,
    callerHost,
    meta.address ?? undefined
  );

  // Only trust the cache when it belongs to the active inbox and is still
  // fresh. The global cache can be stale, sourced from another inbox, or -
  // because nothing clears it on expiry-archiving/deletion/eviction - a code
  // whose message no longer exists. Always require the recipient to match the
  // active address when one exists, and apply the same age bound as the
  // copy-latest-otp shortcut before the cached code is served.
  if (
    latestOtp?.otp &&
    isOtpCacheFresh(latestOtp) &&
    sameAddress(latestOtp.recipient, meta.address ?? undefined)
  ) {
    return {
      success: true,
      result: {
        otp: latestOtp.otp,
        sender: latestOtp.sender || '',
        senderName: latestOtp.senderName || '',
        receivedAt: latestOtp.received_at ? receivedAtOrNull(latestOtp.received_at) : null,
      },
    };
  }

  const fromEmails = extractLatestOtp(activeStoredEmails, callerHost || undefined);
  if (fromEmails?.otp) {
    return {
      success: true,
      result: {
        otp: fromEmails.otp,
        sender: fromEmails.sender,
        senderName: fromEmails.senderName,
        receivedAt: null,
      },
    };
  }

  return {
    success: false,
    error: 'No OTP received yet, or this website is not authorized to read it.',
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const TOOL_IMPL: Record<
  string,
  (
    args: Record<string, unknown>,
    senderTabId?: number,
    senderTabUrl?: string
  ) => Promise<WebmcpToolResult>
> = {
  get_active_email: () => getActiveEmail(),
  create_temp_email: (args, senderTabId, senderTabUrl) =>
    createTempEmail(args, senderTabId, senderTabUrl),
  get_latest_emails: (args) => getLatestEmails(args),
  get_latest_otp: (_args, _senderTabId, senderTabUrl) => getLatestOtp(senderTabUrl),
  get_otp_from: (args, _senderTabId, senderTabUrl) => getOtpFrom(args, senderTabUrl),
  search_emails: (args) => searchEmails(args),
  list_addresses: (_args, _senderTabId, senderTabUrl) => listAddresses(senderTabUrl),
  get_email: (args, _senderTabId, senderTabUrl) => getEmail(args, senderTabUrl),
  burn_inbox: (args, senderTabId, senderTabUrl) => burnAddress(args, senderTabId, senderTabUrl),
};

/**
 * Entry point called by the `webmcpTool` runtime-message handler.
 * Validates the tool name + args shape, then dispatches.
 */
export async function handleWebmcpTool(
  tool: string,
  rawArgs: unknown,
  senderTabId?: number,
  senderTabUrl?: string
): Promise<WebmcpToolResult> {
  const impl = TOOL_IMPL[tool];
  if (!impl) {
    return {
      success: false,
      error: `Unknown WebMCP tool "${tool}". Supported: ${Object.keys(TOOL_IMPL).join(', ')}.`,
    };
  }
  if (rawArgs !== undefined && !isPlainRecord(rawArgs)) {
    return { success: false, error: 'Tool args must be a JSON object.' };
  }
  try {
    // Every tool shares this gate. Internal extension calls omit page context;
    // the runtime handler requires a real tab before dispatching page requests.
    if (senderTabUrl !== undefined && !(await isWebmcpAccessAllowed(senderTabId, senderTabUrl)))
      return emailAccessDenied();
    return await impl(rawArgs ?? {}, senderTabId, senderTabUrl);
  } catch (err) {
    // Explicit tool errors above are safe, actionable agent-facing responses.
    // Unexpected exception details can contain provider URLs or other internal
    // data, so keep those in extension logs only.
    logError('WebMCP tool failed unexpectedly:', err);
    return { success: false, error: 'The extension could not complete this request.' };
  }
}
