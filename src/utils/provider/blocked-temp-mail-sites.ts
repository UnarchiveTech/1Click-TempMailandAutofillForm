/**
 * Sites known to reject disposable / temporary email domains.
 * Shared by content disposable-detector and Mail Provider settings UI.
 *
 * Curated list of popular services that block temp-mail providers on signup.
 * Users can still exclude additional sites via the autofill blocklist.
 */
export const BLOCKED_TEMP_MAIL_SITES: readonly string[] = [
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'reddit.com',
  'netflix.com',
  'spotify.com',
  'amazon.com',
  'amazon.co.uk',
  'whatsapp.com',
  'telegram.org',
  'discord.com',
  'twitch.tv',
  'github.com',
  'linkedin.com',
  'pinterest.com',
  'tiktok.com',
  'snapchat.com',
] as const;

import { getRootDomain } from '@/utils/security/root-domain.js';

/** Set form for O(1) hostname checks in content scripts */
export const BLOCKED_TEMP_MAIL_SITE_SET = new Set(BLOCKED_TEMP_MAIL_SITES);

/**
 * Check if hostname (or a parent domain) is known to reject disposable email.
 * Returns the matched root domain, or null.
 */
export function getBlockedTempMailSite(hostname: string): string | null {
  const host = (hostname || '').toLowerCase().replace(/^www\./, '');
  if (!host) return null;
  if (BLOCKED_TEMP_MAIL_SITE_SET.has(host)) return host;
  const root = getRootDomain(host);
  if (root && BLOCKED_TEMP_MAIL_SITE_SET.has(root)) return root;
  const parts = host.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    if (BLOCKED_TEMP_MAIL_SITE_SET.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Sentinel preferredEmail value: pick any random live (active) mailbox at fill time.
 * Empty/null means "use the currently selected mailbox". The built-in default
 * identity uses the empty value; this sentinel remains an explicit option for
 * user-created identities.
 */
export const PREFERRED_EMAIL_RANDOM_ACTIVE = '__random_active__' as const;

export function isRandomActivePreferredEmail(value: string | null | undefined): boolean {
  if (value == null || value === '') return false;
  return value === PREFERRED_EMAIL_RANDOM_ACTIVE;
}
