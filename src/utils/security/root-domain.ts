/**
 * Lightweight root-domain extraction (replaces tldts to keep bundles small).
 * Single source of truth for getRootDomain / getDomainName.
 * Used by favicon.ts, blocked-temp-mail-sites.ts, and content scripts.
 */

/** Curated public suffixes and shared-host boundaries used by credential matching. */
export const PUBLIC_SUFFIXES: ReadonlySet<string> = new Set([
  // Shared / multi-tenant hosting where third parties get subdomains
  'github.io',
  'gitlab.io',
  'pages.dev',
  'web.app',
  'firebaseapp.com',
  'appspot.com',
  'vercel.app',
  'netlify.app',
  'herokuapp.com',
  'onrender.com',
  'glitch.me',
  'repl.co',
  'surge.sh',
  'workers.dev',
  'pages.gitee.io',
  'azurewebsites.net',
  'cloudfront.net',
  's3.amazonaws.com',
  'pythonanywhere.com',
  'streamlit.app',
  'huggingface.co',
  'codepen.io',
  // Common multi-label public suffixes (country/community TLDs)
  'co.uk',
  'org.uk',
  'me.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'net.nz',
  'org.nz',
  'co.jp',
  'ne.jp',
  'or.jp',
  'com.br',
  'com.mx',
  'com.ar',
  'com.cn',
  'co.in',
  'co.za',
  'co.kr',
  'com.sg',
  'com.hk',
  'com.tw',
  'co.il',
  'co.ke',
  'com.ng',
  'com.pk',
  'com.ua',
  'com.tr',
  // Multi-label suffixes retained by the old root-domain helper
  'co.id',
  'com.my',
  'com.ph',
  'net.br',
  'org.br',
  'gov.au',
  'ac.jp',
  'sch.uk',
  'k12.ca.us',
  // Single-label TLDs - a bare-TLD value must not be treated as a parent.
  'com',
  'org',
  'net',
  'io',
  'co',
  'app',
  'dev',
  'me',
  'tv',
  'xyz',
  'info',
  'biz',
  'site',
  'online',
  'tech',
  'store',
  'cloud',
  'live',
  'media',
  'ai',
]);

function publicSuffixLength(parts: string[]): number {
  // Prefer the longest known suffix: `foo.s3.amazonaws.com` is scoped to the
  // bucket, not merely `amazonaws.com`.
  for (let length = parts.length; length >= 1; length -= 1) {
    if (PUBLIC_SUFFIXES.has(parts.slice(-length).join('.'))) return length;
  }
  return 1;
}

/** Get root domain, handling common multi-level TLDs like .co.uk */
export function getRootDomain(domain: string): string {
  if (!domain) return '';
  const normalized = domain.toLowerCase().replace(/^\[|\]$/g, '');
  // IP literals are hosts, not registrable domains; never collapse their octets.
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(normalized) || normalized.includes(':')) {
    return normalized;
  }
  const parts = normalized.split('.').filter(Boolean);
  const suffixLength = publicSuffixLength(parts);
  if (parts.length > suffixLength) return parts.slice(-(suffixLength + 1)).join('.');
  return normalized;
}

/** Extract brand name from hostname (root without TLD). */
export function getDomainName(hostname: string): string {
  const root = getRootDomain(hostname);
  if (!root) return hostname.split('.')[0] || hostname;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(root) || root.includes(':')) return root;
  const parts = root.split('.');
  const suffixLength = publicSuffixLength(parts);
  return parts.slice(0, -suffixLength).join('.') || root;
}
