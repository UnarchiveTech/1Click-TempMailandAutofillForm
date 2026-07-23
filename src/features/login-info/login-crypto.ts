/**
 * Shared credential decryption helpers for the saved-login "loginInfo" store.
 *
 * Used by both the UI layer (`login-actions.ts`) and the background runtime
 * message handler (`message-handler.ts` → `findReusableIdentity`). Lives here
 * rather than in `login-actions.ts` so the background service worker doesn't
 * import a UI feature module.
 */

import { browser } from 'wxt/browser';
import { decrypt } from '@/utils/crypto.js';
import { logError } from '@/utils/logger.js';
import type { CredentialsHistoryItem } from '@/utils/types.js';

/**
 * Decrypt the password field of each login entry for display / replay.
 *
 * Falls back to the raw stored value when decryption fails (e.g. the entry was
 * stored as plaintext before encryption was added, or the session encryption
 * key was regenerated after a browser restart). Entries whose password
 * decrypts to garbage (post-restart) are still returned so callers can decide
 * whether to offer them.
 */
export async function decryptCredentials(
  logins: CredentialsHistoryItem[]
): Promise<CredentialsHistoryItem[]> {
  const result: CredentialsHistoryItem[] = [];
  for (const item of logins) {
    let password = item.password;
    if (password) {
      try {
        password = await decrypt(password);
      } catch {
        // Not encrypted (legacy plaintext) or decryption failed - keep as-is
      }
    }
    result.push({ ...item, password });
  }
  return result;
}

/**
 * The decrypted credential bundle returned to the content script for replay.
 * Only the fields needed to fill a form are included - no `inboxId` /
 * `identityId` / `timestamp` metadata leaks to the content script.
 */
export interface ReusableCredential {
  email: string;
  password: string;
  username?: string | null;
  name?: string | null;
  phone?: string | null;
  website?: string | null;
}

export type AutofillLoginPreference = 'recent' | 'listOrder';

function normalizeDomain(d: string): string {
  return (d || '').toLowerCase().replace(/^www\./, '');
}

/**
 * Find a saved login for a domain (optionally scoped to inboxId).
 * Preference:
 *  - `recent` — highest timestamp (default)
 *  - `listOrder` — first match in loginInfo array (user drag-priority order)
 */
function credentialFromItem(match: CredentialsHistoryItem): ReusableCredential {
  return {
    email: match.email || '',
    password: match.password || '',
    username: match.username ?? null,
    name: match.name ?? null,
    phone: match.phone ?? null,
    website: match.website ?? null,
  };
}

function domainMatchesHost(itemDomain: string, want: string): boolean {
  const itemDom = normalizeDomain(itemDomain);
  if (!itemDom || !want) return false;
  return itemDom === want || itemDom.endsWith(`.${want}`) || want.endsWith(`.${itemDom}`);
}

export async function findReusableIdentityForDomain(
  domain: string,
  inboxId: string
): Promise<ReusableCredential | null> {
  const result = await findSiteReplayForDomain(domain, inboxId);
  return result.credential;
}

/**
 * Full site replay package: last disposable identity used on this domain.
 * Prefer site-profile email/inbox, then same-inbox logins, then any domain match.
 */
export async function findSiteReplayForDomain(
  domain: string,
  inboxId?: string | null
): Promise<{
  credential: ReusableCredential | null;
  lastEmail?: string;
  lastInboxId?: string;
  lastIdentityId?: string;
  fromSiteProfile: boolean;
}> {
  try {
    const want = normalizeDomain(domain);
    if (!want) {
      return { credential: null, fromSiteProfile: false };
    }

    let profileLastEmail: string | undefined;
    let profileLastInboxId: string | undefined;
    let profileLastIdentityId: string | undefined;
    try {
      const { getSiteProfile } = await import('@/features/intelligence/storage.js');
      const profile = await getSiteProfile(want);
      if (profile) {
        profileLastEmail = profile.lastEmail;
        profileLastInboxId = profile.lastInboxId;
        profileLastIdentityId = profile.lastIdentityId;
      }
    } catch {
      /* intelligence optional */
    }

    const { loginInfo = [], autofillLoginPreference = 'recent' } = (await browser.storage.local.get(
      ['loginInfo', 'autofillLoginPreference']
    )) as {
      loginInfo?: CredentialsHistoryItem[];
      autofillLoginPreference?: AutofillLoginPreference;
    };

    const decrypted = await decryptCredentials(loginInfo);
    const domainMatches = decrypted.filter((item) => {
      if (!item.password || looksLikeCiphertext(item.password)) return false;
      return domainMatchesHost(item.domain || '', want);
    });

    if (domainMatches.length === 0) {
      return {
        credential: null,
        lastEmail: profileLastEmail,
        lastInboxId: profileLastInboxId,
        lastIdentityId: profileLastIdentityId,
        fromSiteProfile: !!(profileLastEmail || profileLastInboxId),
      };
    }

    // Priority pools: profile email → same inbox → profile inbox → any
    const profileEmailLower = (profileLastEmail || '').toLowerCase();
    const byEmail = profileEmailLower
      ? domainMatches.filter((i) => (i.email || '').toLowerCase() === profileEmailLower)
      : [];
    const sameInbox = inboxId ? domainMatches.filter((i) => i.inboxId === inboxId) : [];
    const byProfileInbox = profileLastInboxId
      ? domainMatches.filter((i) => i.inboxId === profileLastInboxId)
      : [];

    const pool =
      byEmail.length > 0
        ? byEmail
        : sameInbox.length > 0
          ? sameInbox
          : byProfileInbox.length > 0
            ? byProfileInbox
            : domainMatches;

    let match: CredentialsHistoryItem | undefined;
    if (autofillLoginPreference === 'listOrder') {
      match = pool[0];
    } else {
      match = [...pool].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
    }

    if (!match?.password) {
      return {
        credential: null,
        lastEmail: profileLastEmail,
        lastInboxId: profileLastInboxId,
        lastIdentityId: profileLastIdentityId,
        fromSiteProfile: !!(profileLastEmail || profileLastInboxId),
      };
    }

    return {
      credential: credentialFromItem(match),
      lastEmail: match.email || profileLastEmail,
      lastInboxId: match.inboxId || profileLastInboxId,
      lastIdentityId: match.identityId || profileLastIdentityId,
      fromSiteProfile: !!(profileLastEmail || profileLastInboxId),
    };
  } catch (e) {
    logError(
      'findSiteReplayForDomain error:',
      undefined,
      e instanceof Error ? e : new Error(String(e))
    );
    return { credential: null, fromSiteProfile: false };
  }
}

/**
 * Detect whether a string is likely undecrypted base64 ciphertext rather than
 * a real password. Real passwords typically contain spaces, mixed case, or
 * punctuation; AES-GCM base64 output is a contiguous run of base64 chars
 * (A-Za-z0-9+/=) with no spaces and is usually >40 chars for our payload size.
 */
function looksLikeCiphertext(value: string): boolean {
  if (!value || value.length < 28) return false;
  const isBase64Only = /^[A-Za-z0-9+/=_-]+$/.test(value);
  if (!isBase64Only) return false;

  try {
    const binary = atob(value);
    // User passwords (even base64-encoded strings) consist of printable ASCII (32-126, \t, \n, \r).
    // Decoded AES-GCM ciphertext contains raw random binary bytes (<32 or >126).
    for (let i = 0; i < binary.length; i++) {
      const code = binary.charCodeAt(i);
      if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code > 126) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}
