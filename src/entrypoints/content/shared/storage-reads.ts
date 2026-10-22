/**
 * Guarded accessors for the SINGLE-KEY storage values content scripts read.
 *
 * Every one of these values arrives through the content bridge as untrusted
 * data (see `address-liveness.ts` for the full contract): the whole value can
 * be a non-object (quota-truncated write, writer bug, sync conflict, hand-edited
 * database), a hand-written field can be the wrong type, and a destructuring
 * default (`{ passwordSettings = {} }`) does NOT cover `null` - it applies only
 * to `undefined`, so `passwordSettings.useCustom` threw a TypeError on a stored
 * `null`. Before this module each call site carried its own inline type
 * assertion plus its own default, and the sites disagreed: `passwordSettings`
 * and `nameSettings` dereferenced the value unchecked, `otpOptInList` trusted a
 * non-array through `.some`, and `customPassword` was read on a content side
 * that never receives it.
 *
 * The rules, in one place:
 *   - a corrupt single-key value degrades to its "unset" shape - never a throw
 *   - a FLAG is only "off" when storage explicitly says so (an unset or corrupt
 *     flag keeps the shipped default)
 *   - a soft string (`selectedProvider`) is '' when it is absent or garbage, so
 *     the background resolves its configured default instead of receiving junk
 *   - text fields are trimmed, so a whitespace-only name is absent rather than
 *     filled into a host-page input
 *   - `customPassword` is NEVER surfaced: content receives `hasCustomPassword`
 *     (the background redacts the ciphertext out of the read) and asks the
 *     background to decrypt. Both signals are folded into one boolean so a
 *     legacy/unredacted read cannot drift from the redacted one.
 *
 * The generic shape guards live in `storage-shape-guards.ts` and are shared with
 * the app-side consumers; the bridge (`content-bg-bridge.ts`) is the transport.
 * This module is the content-side policy on top of both - call sites read a
 * value through it instead of asserting a shape of their own.
 */

import { getStorageViaBg } from '@/utils/content/content-bg-bridge.js';
import { arrayOrEmpty, isObjectRecord } from '@/utils/storage/storage-shape-guards.js';
import type { CredentialsHistoryItem } from '@/utils/types.js';

/**
 * The content-script view of `passwordSettings`: whether the user chose a custom
 * password, and whether one EXISTS. Deliberately NOT the settings record - the
 * ciphertext never crosses into a web page, so there is no field here to leak
 * it; the fill path calls `decryptStoredCustomPasswordViaBg` instead.
 */
export interface CustomPasswordSettings {
  /** The user asked for a custom password (only a real boolean counts). */
  useCustom: boolean;
  /** A stored custom password exists - plaintext legacy or encrypted. */
  hasCustomPassword: boolean;
}

/** Read `passwordSettings`, guarded. A corrupt record reads as "no custom password". */
export async function readPasswordSettings(): Promise<CustomPasswordSettings> {
  const stored = (await getStorageViaBg(['passwordSettings'])).passwordSettings;
  const settings = isObjectRecord(stored) ? stored : {};
  return {
    useCustom: settings.useCustom === true,
    hasCustomPassword:
      settings.hasCustomPassword === true ||
      (typeof settings.customPassword === 'string' && settings.customPassword.length > 0),
  };
}

/**
 * The content-script view of `nameSettings`: the user's custom first/last name
 * when they set one. Absent/garbage reads as empty strings, and the values are
 * trimmed - a whitespace-only name is not a name, and an untrimmed one would be
 * typed verbatim into a host-page field.
 */
export interface CustomNameSettings {
  useCustom: boolean;
  firstName: string;
  lastName: string;
}

/** Read `nameSettings`, guarded. A corrupt record reads as "no custom name". */
export async function readNameSettings(): Promise<CustomNameSettings> {
  const stored = (await getStorageViaBg(['nameSettings'])).nameSettings;
  const settings = isObjectRecord(stored) ? stored : {};
  return {
    useCustom: settings.useCustom === true,
    firstName: typeof settings.firstName === 'string' ? settings.firstName.trim() : '',
    lastName: typeof settings.lastName === 'string' ? settings.lastName.trim() : '',
  };
}

/**
 * Read `loginInfo`, guarded. A corrupt (non-array) list is the EMPTY list, never
 * a throw at the first `.filter`/`.find`. Individual entries are left as stored -
 * the consumers (`findUnusedLiveAddress`, `isEmailUsedInLoginEntries`) already
 * guard each entry, and the background redacts `password` out of content reads.
 */
export async function readLoginInfo(): Promise<CredentialsHistoryItem[]> {
  return arrayOrEmpty<CredentialsHistoryItem>((await getStorageViaBg(['loginInfo'])).loginInfo);
}

/**
 * Read `selectedProvider`, guarded. Returns '' when unset or garbage: the create
 * paths pass this through as `provider`, and every consumer treats '' exactly
 * like absent (`provider: '' || resolveDefault()`), so junk storage falls back to
 * the configured default instead of naming a provider id that cannot resolve.
 */
export async function readSelectedProvider(): Promise<string> {
  const stored = (await getStorageViaBg(['selectedProvider'])).selectedProvider;
  return typeof stored === 'string' ? stored.trim() : '';
}

/**
 * Read `autofillFeatureEnabled`, guarded. The feature ships ON, so only an
 * explicit `false` disables it - an unset or corrupt value (including a bridge
 * failure, which resolves to `{}`) keeps autofill working. Total: it cannot
 * throw, so callers need no try/catch of their own.
 */
export async function readAutofillFeatureEnabled(): Promise<boolean> {
  return (await getStorageViaBg(['autofillFeatureEnabled'])).autofillFeatureEnabled !== false;
}

/**
 * Read `otpOptInList`, guarded. A corrupt (non-array) list is the EMPTY list -
 * that is "not opted in", the default, so a corrupt write can never authorize
 * an OTP fill. Non-string entries are dropped: the list is matched against a
 * hostname, and an entry that is not a domain string can never match anyway.
 */
export async function readOtpOptInList(): Promise<string[]> {
  const stored = (await getStorageViaBg(['otpOptInList'])).otpOptInList;
  return arrayOrEmpty<unknown>(stored).filter(
    (entry): entry is string => typeof entry === 'string'
  );
}
