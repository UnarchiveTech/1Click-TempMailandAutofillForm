/**
 * Shared normalization for saved login credentials.
 *
 * Lives here - outside the background bundle - so content-script fallback
 * paths (form-filler's direct `setStorageViaBg` write when the RPC fails)
 * apply exactly the same caps and the https-only `policyUrls` filter as the
 * background `saveLoginCredential` handler. A hostile page cannot stuff
 * storage.local (DoS) or persist a javascript:/data: URL that later flows
 * into tabs.create / window.open in the extension UI.
 */

import type { CredentialsHistoryItem } from '@/utils/types.js';

const SIGNUP_STATUS_VALUES = new Set<CredentialsHistoryItem['signupStatus']>([
  'pending_submit',
  'submitted',
  'verified',
  'undetected',
  'failed',
]);

const MAX_CREDENTIAL_FIELD_LEN = 512;
const MAX_POLICY_URL_LEN = 2048;
const MAX_FILLED_FIELD_LEN = 128;
const MAX_POLICY_URLS = 20;
const MAX_FILLED_FIELDS = 50;

/**
 * Whitelist credential fields persisted from content-script autofill.
 *
 * Defense-in-depth: the content script is the only legitimate sender, but the
 * persisted values include page-controlled inputs (policy URLs harvested from
 * the page, hostname). Cap every string and re-filter policyUrls to http(s)
 * so a hostile page cannot persist anything beyond the allowlist.
 */
export function normalizeSavedLoginCredential(
  raw: Record<string, unknown>
): CredentialsHistoryItem | null {
  const domain = String(raw.domain || raw.site || raw.website || '')
    .trim()
    .slice(0, MAX_CREDENTIAL_FIELD_LEN);
  const emailOrUsername = String(raw.email || raw.username || '')
    .trim()
    .slice(0, MAX_CREDENTIAL_FIELD_LEN);
  if (!domain || !emailOrUsername) return null;

  const credential: CredentialsHistoryItem = {
    domain: domain.toLowerCase(),
    timestamp:
      typeof raw.timestamp === 'number' && Number.isFinite(raw.timestamp)
        ? raw.timestamp
        : Date.now(),
    email: raw.email != null ? String(raw.email).slice(0, MAX_CREDENTIAL_FIELD_LEN) : null,
    username: raw.username != null ? String(raw.username).slice(0, MAX_CREDENTIAL_FIELD_LEN) : null,
  };

  for (const key of [
    'id',
    'name',
    'phone',
    'website',
    'password',
    'addressId',
    'identityId',
  ] as const) {
    if (typeof raw[key] === 'string' && raw[key]) {
      credential[key] = raw[key].slice(0, MAX_CREDENTIAL_FIELD_LEN);
    }
  }
  for (const key of ['country', 'gender', 'dateOfBirth', 'pin'] as const) {
    if (typeof raw[key] === 'string') {
      credential[key] = raw[key].slice(0, MAX_CREDENTIAL_FIELD_LEN);
    }
  }
  if (Array.isArray(raw.policyUrls)) {
    credential.policyUrls = raw.policyUrls
      .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u.trim()))
      .map((u) => u.trim().slice(0, MAX_POLICY_URL_LEN))
      .slice(0, MAX_POLICY_URLS);
  }
  if (Array.isArray(raw.filledFields)) {
    credential.filledFields = raw.filledFields
      .filter((f): f is string => typeof f === 'string')
      .map((f) => f.slice(0, MAX_FILLED_FIELD_LEN))
      .slice(0, MAX_FILLED_FIELDS);
  }
  if (
    typeof raw.signupStatus === 'string' &&
    SIGNUP_STATUS_VALUES.has(raw.signupStatus as CredentialsHistoryItem['signupStatus'])
  ) {
    credential.signupStatus = raw.signupStatus as CredentialsHistoryItem['signupStatus'];
  }
  if (typeof raw.verified === 'boolean') credential.verified = raw.verified;
  if (typeof raw.verifiedAt === 'number' && Number.isFinite(raw.verifiedAt)) {
    credential.verifiedAt = raw.verifiedAt;
  }
  if (typeof raw.submittedAt === 'number' && Number.isFinite(raw.submittedAt)) {
    credential.submittedAt = raw.submittedAt;
  }
  return credential;
}
