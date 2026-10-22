/**
 * Shared credential decryption helpers for the saved-login "loginInfo" store.
 *
 * Used by both the UI layer (`login-actions.ts`) and the background runtime
 * message handler (`message-handler.ts` → `findSiteReplay`). Lives here
 * rather than in `login-actions.ts` so the background service worker doesn't
 * import a UI feature module.
 */

import { browser } from 'wxt/browser';
import { getSiteProfile } from '@/features/intelligence/storage.js';
import { logError, logWarn } from '@/utils/logger.js';
import { decrypt, looksLikeCiphertext } from '@/utils/security/crypto.js';
import { arrayOrEmpty, hasLiveExpiry } from '@/utils/storage/storage-shape-guards.js';
import { isVaultLocked } from '@/utils/storage/vault-lock.js';
import type { CredentialsHistoryItem } from '@/utils/types.js';
import { isPublicSuffix, normalizeDomain } from '@/utils/validation.js';

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
  let stripped = 0;
  for (const item of logins) {
    let password = item.password;
    let passwordNeedsReentry = false;
    if (password) {
      try {
        password = await decrypt(password);
      } catch {
        // Decryption failed. Two cases:
        //  1. Legacy plaintext (saved before encryption existed) - keep as-is.
        //  2. Encrypted value whose key is gone (key rotation / vault reset) -
        //     the raw base64 blob is NOT a usable password. Never leak it as a
        //     password: strip it so autofill replay skips this entry instead of
        //     filling ciphertext into a real site's password field.
        if (looksLikeCiphertext(password)) {
          password = undefined;
          passwordNeedsReentry = true;
        }
        // else: plaintext password that happens to be short - keep as-is.
      }
    }
    // passwordNeedsReentry is display-only (never persisted / exported) so the
    // UI can badge entries whose secret no longer decrypts instead of silently
    // dropping the row. The encrypted blob itself stays in storage untouched.
    result.push({ ...item, password, ...(passwordNeedsReentry ? { passwordNeedsReentry } : {}) });
    if (passwordNeedsReentry) stripped += 1;
  }
  if (stripped > 0) {
    logWarn('Credential password decryption failed; marked for re-entry', { count: stripped });
  }
  return result;
}

/**
 * The decrypted credential bundle returned to the content script for replay.
 * Only the fields needed to fill a form are included - no `addressId` /
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

export { isPublicSuffix, normalizeDomain };

/**
 * Find a saved login for a domain (optionally scoped to addressId).
 * Preference:
 *  - `recent` - highest timestamp (default)
 *  - `listOrder` - first match in loginInfo array (user drag-priority order)
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

export function domainMatchesHost(itemDomain: string, want: string): boolean {
  const itemDom = normalizeDomain(itemDomain);
  const wantDom = normalizeDomain(want);
  if (!itemDom || !wantDom) return false;
  if (itemDom === wantDom) return true;
  // A saved parent credential may flow down to its subdomains, but a subdomain
  // credential must never flow upward to its parent or across shared hosts.
  return !isPublicSuffix(itemDom) && wantDom.endsWith(`.${itemDom}`);
}

/** Return the saved credential used on a site, optionally scoped to one inbox. */
export async function findReusableCredentialForDomain(
  domain: string,
  addressId: string
): Promise<ReusableCredential | null> {
  const result = await findSiteReplayForDomain(domain, addressId);
  return result.credential;
}

/**
 * Full site replay package: last disposable identity used on this domain.
 * Prefer site-profile email/inbox, then same-inbox logins, then any domain match.
 *
 * Two correctness guards:
 *  - INBOX LIVENESS: a saved login whose inbox was deleted/expired/archived is
 *    never offered for replay - the address can no longer receive mail, so
 *    replaying it would silently lock the user out of future OTP recovery.
 *  - VAULT LOCK: when the vault is password/biometric-locked the stored
 *    passwords can't be decrypted. Instead of silently returning "no replay",
 *    `vaultLocked` is set so the UI can tell the user to unlock.
 */
export async function findSiteReplayForDomain(
  domain: string,
  addressId?: string | null
): Promise<{
  credential: ReusableCredential | null;
  lastEmail?: string;
  lastAddressId?: string;
  lastIdentityId?: string;
  fromSiteProfile: boolean;
  /** True when a replay exists but the vault is locked (secrets undecryptable). */
  vaultLocked?: boolean;
  /** True when saved logins exist for this domain (decryptable or not). */
  hasSavedLogin?: boolean;
}> {
  try {
    const want = normalizeDomain(domain);
    if (!want) {
      return { credential: null, fromSiteProfile: false };
    }

    let profileLastEmail: string | undefined;
    let profileLastAddressId: string | undefined;
    let profileLastIdentityId: string | undefined;
    try {
      const profile = await getSiteProfile(want);
      if (profile) {
        profileLastEmail = profile.lastEmail;
        profileLastAddressId = profile.lastAddressId;
        profileLastIdentityId = profile.lastIdentityId;
      }
    } catch {
      /* intelligence optional */
    }

    // Shared shape guards (storage-shape-guards.ts): a corrupt non-array or a
    // garbage-entry list degrades to empty instead of throwing, and a
    // string-timestamp expiry reads as DEAD (string <= number compared as NaN,
    // which the old inline filter silently treated as live).
    const { addresses: rawAddresses } = (await browser.storage.local.get(['addresses'])) as {
      addresses?: unknown;
    };
    const addresses = arrayOrEmpty<Record<string, unknown>>(rawAddresses);
    const now = Date.now();
    const liveAddressIds = new Set(
      addresses
        .filter(
          (i) =>
            i.accountStatus !== 'archived' &&
            i.accountStatus !== 'deleted' &&
            hasLiveExpiry(i.expiresAt, now)
        )
        .map((i) => i.id)
    );
    // The profile's remembered inbox gets the SAME liveness filter as the
    // credential pool below: the site profile never forgets an address on its
    // own (deletion does purge it, but expired/archived inboxes stay), and the
    // content script switches the ACTIVE inbox to `lastAddressId` when it
    // differs - a dead id here would silently re-point the active mailbox at
    // an inbox that can never receive an OTP again.
    if (profileLastAddressId && !liveAddressIds.has(profileLastAddressId)) {
      profileLastAddressId = undefined;
    }
    const isAddressLive = (item: CredentialsHistoryItem): boolean =>
      !item.addressId || liveAddressIds.has(item.addressId);

    const { loginInfo: rawLoginInfo, autofillLoginPreference = 'recent' } =
      (await browser.storage.local.get(['loginInfo', 'autofillLoginPreference'])) as {
        loginInfo?: unknown;
        autofillLoginPreference?: AutofillLoginPreference;
      };
    const loginInfo = arrayOrEmpty<CredentialsHistoryItem>(rawLoginInfo);

    // Inbox liveness (already computed above): a credential whose mailbox is
    // gone can never receive an OTP again - offering it for replay is a dead
    // end, so drop those entries.

    // Vault locked: raw entries exist for this domain but passwords can't be
    // decrypted. Surface it instead of silently claiming "no replay".
    const vaultLocked = await isVaultLocked().catch(() => false);
    const rawDomainMatches = loginInfo.filter((item) => domainMatchesHost(item.domain || '', want));
    const hasSavedLogin =
      rawDomainMatches.some((item) => !!item.password) &&
      rawDomainMatches.some((item) => isAddressLive(item));
    if (vaultLocked && hasSavedLogin) {
      return {
        credential: null,
        lastEmail: profileLastEmail,
        lastAddressId: profileLastAddressId,
        lastIdentityId: profileLastIdentityId,
        fromSiteProfile: !!(profileLastEmail || profileLastAddressId),
        vaultLocked: true,
        hasSavedLogin: true,
      };
    }

    // Filter metadata before decrypting: opening one login page must not
    // decrypt every saved password, nor passwords tied to unavailable inboxes.
    // The original list order is retained for the user's list-order preference.
    const decrypted = await decryptCredentials(rawDomainMatches.filter(isAddressLive));
    const domainMatches = decrypted.filter((item) => {
      if (!item.password || looksLikeCiphertext(item.password)) return false;
      if (!domainMatchesHost(item.domain || '', want)) return false;
      return isAddressLive(item);
    });

    if (domainMatches.length === 0) {
      return {
        credential: null,
        lastEmail: profileLastEmail,
        lastAddressId: profileLastAddressId,
        lastIdentityId: profileLastIdentityId,
        fromSiteProfile: !!(profileLastEmail || profileLastAddressId),
        vaultLocked: false,
        hasSavedLogin: rawDomainMatches.length > 0,
      };
    }

    // Priority pools: profile email → same inbox → profile inbox → any
    const profileEmailLower = (profileLastEmail || '').toLowerCase();
    const byEmail = profileEmailLower
      ? domainMatches.filter((i) => (i.email || '').toLowerCase() === profileEmailLower)
      : [];
    const sameAddress = addressId ? domainMatches.filter((i) => i.addressId === addressId) : [];
    const byProfileAddress = profileLastAddressId
      ? domainMatches.filter((i) => i.addressId === profileLastAddressId)
      : [];

    const pool =
      byEmail.length > 0
        ? byEmail
        : sameAddress.length > 0
          ? sameAddress
          : byProfileAddress.length > 0
            ? byProfileAddress
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
        lastAddressId: profileLastAddressId,
        lastIdentityId: profileLastIdentityId,
        fromSiteProfile: !!(profileLastEmail || profileLastAddressId),
        vaultLocked: false,
        hasSavedLogin: true,
      };
    }

    return {
      credential: credentialFromItem(match),
      lastEmail: match.email || profileLastEmail,
      lastAddressId: match.addressId || profileLastAddressId,
      lastIdentityId: match.identityId || profileLastIdentityId,
      fromSiteProfile: !!(profileLastEmail || profileLastAddressId),
      vaultLocked: false,
      hasSavedLogin: true,
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

/** Re-exported from crypto.ts so existing importers keep working. */
export { looksLikeCiphertext };
