/** Background-owned signup attempts. Content scripts never write login history. */
import { browser } from 'wxt/browser';
import { tSync } from '@/utils/i18n/i18n-background.js';
import { LOCKS, withLock } from '@/utils/mutex.js';
import { createBrowserNotification } from '@/utils/notifications/notification-permission.js';
import { getStoredEmailsForAddress } from '@/utils/storage/storage-keys.js';
import { arrayOrEmpty } from '@/utils/storage/storage-shape-guards.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import type { Address, CredentialsHistoryItem, Email } from '@/utils/types.js';
import { domainsShareSiteBoundary, normalizeDomain } from '@/utils/validation.js';
import type { SignupAttemptRef, SignupProgress } from './signup-state.js';

export type SignupOutcomeStatus =
  | 'pending_submit'
  | 'submitted'
  | 'verified'
  | 'undetected'
  | 'failed';
export interface SignupCaller {
  tabId: number;
  frameId: number;
  host: string;
  url: string;
}
interface VerificationBinding {
  tabId: number;
  host: string;
  urlHash: string;
}
interface SignupAttempt extends SignupAttemptRef {
  tabId: number;
  frameId: number;
  startedAt: number;
  updatedAt: number;
  verification?: VerificationBinding;
}
const KEY = 'signupAttempts_v1';
export const SIGNUP_ATTEMPT_TTL_MS = 2 * 60 * 60_000;
const MAX_ATTEMPTS = 30;
const ATTEMPT_LOCK = 'signup_attempts_lock';

async function loadAttempts(): Promise<{ attempts: SignupAttempt[]; session: boolean }> {
  let raw: unknown;
  let session = true;
  try {
    raw = (await browser.storage.session.get(KEY))[KEY];
  } catch {
    session = false;
    raw = (await browser.storage.local.get(KEY))[KEY];
  }
  const now = Date.now();
  const attempts = arrayOrEmpty<SignupAttempt>(raw)
    .filter(
      (a) =>
        a &&
        typeof a.id === 'string' &&
        typeof a.credentialId === 'string' &&
        typeof a.domain === 'string' &&
        typeof a.email === 'string' &&
        typeof a.submitted === 'boolean' &&
        Number.isInteger(a.tabId) &&
        Number.isInteger(a.frameId) &&
        Number.isFinite(a.updatedAt) &&
        Number.isFinite(a.startedAt) &&
        a.startedAt <= now &&
        Number.isFinite(a.expiresAt) &&
        a.expiresAt > now &&
        a.expiresAt <= a.startedAt + SIGNUP_ATTEMPT_TTL_MS
    )
    .slice(-MAX_ATTEMPTS);
  return { attempts, session };
}
async function saveAttempts(state: Awaited<ReturnType<typeof loadAttempts>>): Promise<void> {
  const payload = { [KEY]: state.attempts.slice(-MAX_ATTEMPTS) };
  if (state.session) await writeWithRetry(payload, { area: browser.storage.session });
  else await writeWithRetry(payload);
}
function publicAttempt(a: SignupAttempt): SignupAttemptRef {
  return {
    id: a.id,
    credentialId: a.credentialId,
    domain: a.domain,
    email: a.email,
    submitted: a.submitted,
    expiresAt: a.expiresAt,
  };
}
async function urlHash(url: string): Promise<string> {
  const canonical = new URL(url);
  canonical.hash = '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical.href));
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}
async function isCaller(a: SignupAttempt, caller: SignupCaller): Promise<boolean> {
  if (
    a.tabId === caller.tabId &&
    a.frameId === caller.frameId &&
    (a.domain === normalizeDomain(caller.host) ||
      (a.submitted && domainsShareSiteBoundary(a.domain, caller.host)))
  )
    return true;
  return (
    !!a.verification &&
    a.verification.tabId === caller.tabId &&
    caller.frameId === 0 &&
    a.verification.host === normalizeDomain(caller.host) &&
    a.verification.urlHash === (await urlHash(caller.url))
  );
}

export async function beginSignupAttempt(
  credentialId: string,
  caller: SignupCaller
): Promise<SignupAttemptRef | null> {
  return withLock(ATTEMPT_LOCK, async () => {
    const state = await loadAttempts();
    return withLock(LOCKS.LOGIN_INFO, async () => {
      const stored = await browser.storage.local.get('loginInfo');
      const records = arrayOrEmpty<CredentialsHistoryItem>(stored.loginInfo);
      const credential = records.find(
        (c) => c.id === credentialId && normalizeDomain(c.domain) === normalizeDomain(caller.host)
      );
      const now = Date.now();
      if (
        !credential ||
        credential.verified ||
        credential.signupStatus === 'verified' ||
        !credential.email ||
        !Number.isFinite(credential.timestamp) ||
        credential.timestamp > now ||
        now - credential.timestamp > 5 * 60_000
      )
        return null;
      const existing = state.attempts.find(
        (a) =>
          a.credentialId === credentialId &&
          a.tabId === caller.tabId &&
          a.frameId === caller.frameId &&
          a.domain === normalizeDomain(caller.host)
      );
      if (existing) return publicAttempt(existing);
      const attempt: SignupAttempt = {
        id: crypto.randomUUID(),
        credentialId,
        domain: normalizeDomain(caller.host),
        email: credential.email,
        tabId: caller.tabId,
        frameId: caller.frameId,
        submitted: false,
        startedAt: now,
        updatedAt: now,
        expiresAt: now + SIGNUP_ATTEMPT_TTL_MS,
      };
      await writeWithRetry({
        loginInfo: records.map((c) =>
          c.id === credentialId ? { ...c, signupAttemptId: attempt.id } : c
        ),
      });
      state.attempts.push(attempt);
      await saveAttempts(state);
      return publicAttempt(attempt);
    });
  });
}
export async function getSignupAttempt(caller: SignupCaller): Promise<SignupAttemptRef | null> {
  const state = await loadAttempts();
  const { loginInfo } = await browser.storage.local.get('loginInfo');
  const credentials = arrayOrEmpty<CredentialsHistoryItem>(loginInfo);
  for (const attempt of [...state.attempts].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (
      credentials.some(
        (c) =>
          c.id === attempt.credentialId &&
          c.signupAttemptId === attempt.id &&
          c.email === attempt.email &&
          normalizeDomain(c.domain) === attempt.domain
      ) &&
      (await isCaller(attempt, caller))
    )
      return publicAttempt(attempt);
  }
  return null;
}

export async function reportSignupProgress(
  attemptId: string,
  progress: SignupProgress,
  caller: SignupCaller
): Promise<boolean> {
  return withLock(ATTEMPT_LOCK, async () => {
    const state = await loadAttempts();
    const attempt = state.attempts.find((a) => a.id === attemptId);
    if (!attempt || !(await isCaller(attempt, caller))) return false;
    if (progress === 'submitted') {
      if (caller.tabId !== attempt.tabId || caller.frameId !== attempt.frameId) return false;
    } else if (!attempt.submitted) return false;
    let notify = false;
    const updated = await withLock(LOCKS.LOGIN_INFO, async () => {
      const stored = await browser.storage.local.get(['loginInfo', 'notificationSettings']);
      const records = arrayOrEmpty<CredentialsHistoryItem>(stored.loginInfo);
      const index = records.findIndex(
        (c) =>
          c.id === attempt.credentialId &&
          c.signupAttemptId === attempt.id &&
          normalizeDomain(c.domain) === attempt.domain &&
          c.email === attempt.email
      );
      if (index < 0) return false;
      const current = records[index];
      const next = { ...current };
      const now = Date.now();
      if (progress === 'submitted') {
        attempt.submitted = true;
        next.submittedAt ??= now;
        if (!next.verified) next.signupStatus = 'submitted';
      } else if (progress === 'created' || progress === 'email_confirmed') {
        next.signupStatus = 'verified';
        next.verified = true;
        next.verifiedAt ??= now;
      } else if (progress === 'failed' && !next.verified) next.signupStatus = 'failed';
      if (progress === 'verification_pending' && next.emailVerificationStatus !== 'confirmed')
        next.emailVerificationStatus = 'pending';
      if (progress === 'email_confirmed') {
        next.emailVerificationStatus = 'confirmed';
        next.emailVerifiedAt ??= now;
        if (!next.verificationNotifiedAt) {
          next.verificationNotifiedAt = now;
          const settings = stored.notificationSettings as { enabled?: boolean } | undefined;
          notify = settings?.enabled !== false;
        }
      }
      records[index] = next;
      if (JSON.stringify(current) !== JSON.stringify(next))
        await writeWithRetry({ loginInfo: records });
      return true;
    });
    if (!updated) return false;
    attempt.updatedAt = Date.now();
    await saveAttempts(state);
    if (notify)
      createBrowserNotification(`signup-confirmed:${attempt.credentialId}`, {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: tSync('notifications.signupConfirmedTitle'),
        message: tSync('notifications.signupConfirmedMessage', { domain: attempt.domain }),
      });
    return true;
  });
}

/** UI-only: bind a fresh stored confirmation mail to its new tab, before navigation. */
export async function openSignupVerificationLink(url: string, addressId?: string): Promise<void> {
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password)
    throw new Error('invalid-url');
  let candidate: SignupAttempt | undefined;
  if (addressId && target.protocol === 'https:') {
    const { addresses } = await browser.storage.local.get('addresses');
    const address = arrayOrEmpty<Address>(addresses).find((a) => a.id === addressId);
    if (address) {
      const messages = await getStoredEmailsForAddress(addressId, address.address);
      const message = messages.find((m) => m.magicLinks?.some((link) => link.url === target.href));
      if (message) candidate = await findVerificationAttempt(message, address.address);
    }
  }
  if (!candidate) {
    await browser.tabs.create({ url: target.href });
    return;
  }
  const tab = await browser.tabs.create({ url: 'about:blank' });
  if (tab.id === undefined) throw new Error('operation-failed');
  const tabId = tab.id;
  await withLock(ATTEMPT_LOCK, async () => {
    const state = await loadAttempts();
    const attempt = state.attempts.find((a) => a.id === candidate?.id);
    if (attempt) {
      attempt.verification = {
        tabId,
        host: normalizeDomain(target.hostname),
        urlHash: await urlHash(target.href),
      };
      await saveAttempts(state);
    }
  });
  await browser.tabs.update(tabId, { url: target.href });
}
async function findVerificationAttempt(
  message: Email,
  email: string
): Promise<SignupAttempt | undefined> {
  const from = /@([^<>\s]+)>?$/.exec(message.from || '')?.[1] || '';
  const received = Number(message.received_at || message.stored_at);
  const at = received < 1e12 ? received * 1000 : received;
  if (!Number.isFinite(at)) return undefined;
  const state = await loadAttempts();
  const { loginInfo } = await browser.storage.local.get('loginInfo');
  const credentials = arrayOrEmpty<CredentialsHistoryItem>(loginInfo);
  const candidates = state.attempts.filter(
    (a) =>
      a.submitted &&
      a.email.toLowerCase() === email.toLowerCase() &&
      at >= a.startedAt - 60_000 &&
      at <= Date.now() + 60_000 &&
      domainsShareSiteBoundary(from, a.domain) &&
      credentials.some(
        (c) =>
          c.id === a.credentialId &&
          c.signupAttemptId === a.id &&
          c.email === a.email &&
          normalizeDomain(c.domain) === a.domain
      )
  );
  const named = candidates.filter((a) => {
    const credential = credentials.find(
      (c) => c.id === a.credentialId && c.signupAttemptId === a.id
    );
    return (
      !!credential?.username &&
      (message.body_plain || message.body_html || '').includes(credential.username)
    );
  });
  return named.length === 1 ? named[0] : candidates.length === 1 ? candidates[0] : undefined;
}
