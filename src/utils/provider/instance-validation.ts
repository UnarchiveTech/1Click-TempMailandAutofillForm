import { CONSTANTS } from '../constants.js';
import { ValidationError } from '../errors.js';

/**
 * Validate custom instance name
 */
export function validateCustomInstanceName(name: string): void {
  if (!name || name.trim().length === 0) {
    throw new ValidationError('Instance name cannot be empty', { field: 'instanceName' });
  }
  if (name.length > CONSTANTS.MAX_CUSTOM_INSTANCE_NAME_LENGTH) {
    // The English message is for the log; the key is what the UI renders.
    throw new ValidationError(
      `Instance name must be less than ${CONSTANTS.MAX_CUSTOM_INSTANCE_NAME_LENGTH} characters`,
      { field: 'instanceName', maxLength: CONSTANTS.MAX_CUSTOM_INSTANCE_NAME_LENGTH },
      'errors.instanceNameTooLong'
    );
  }
  // Check for potentially dangerous characters
  if (/[<>"'&]/.test(name)) {
    throw new ValidationError(
      'Instance name contains invalid characters',
      { field: 'instanceName' },
      'errors.instanceNameInvalid'
    );
  }
}

// ─── SSRF defense ───────────────────────────────────────────────────────────
const IPV4_PRIVATE_RANGES: ReadonlyArray<{ base: number; bits: number }> = [
  { base: 0x00000000, bits: 8 }, // 0.0.0.0/8 ("this network")
  { base: 0x0a000000, bits: 8 }, // 10.0.0.0/8
  { base: 0x64400000, bits: 10 }, // 100.64.0.0/10 (CGNAT)
  { base: 0x7f000000, bits: 8 }, // 127.0.0.0/8 (loopback)
  { base: 0xa9fe0000, bits: 16 }, // 169.254.0.0/16 (link-local)
  { base: 0xac100000, bits: 12 }, // 172.16.0.0/12
  { base: 0xc0a80000, bits: 16 }, // 192.168.0.0/16
  { base: 0xc0000000, bits: 24 }, // 192.0.0.0/24 (IETF protocol assignments)
  { base: 0xc0586300, bits: 24 }, // 192.88.99.0/24 (6to4 relay anycast)
  { base: 0xc6120000, bits: 15 }, // 198.18.0.0/15 (benchmark/testing)
  { base: 0xc0000200, bits: 24 }, // 192.0.2.0/24 (TEST-NET-1)
  { base: 0xc6336400, bits: 24 }, // 198.51.100.0/24 (TEST-NET-2)
  { base: 0xcb007100, bits: 24 }, // 203.0.113.0/24 (TEST-NET-3)
  { base: 0xe0000000, bits: 4 }, // 224.0.0.0/4 (multicast)
  { base: 0xf0000000, bits: 4 }, // 240.0.0.0/4 (reserved/future use)
];

function matchesIpv4Cidr(ip: string, base: number, maskBits: number): boolean {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return false;
  const value = ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (value & mask) === (base & mask);
}

export function isIpv4Private(ip: string): boolean {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return false;
  return IPV4_PRIVATE_RANGES.some((r) => matchesIpv4Cidr(ip, r.base, r.bits));
}

function parseIpv4Alternative(hostname: string): string | null {
  const parts = hostname.split('.');
  if (parts.length > 4 || parts.some((part) => part === '')) return null;
  const values = parts.map((part) => {
    if (!/^(?:0[xX][0-9a-fA-F]+|0[0-7]*|[0-9]+)$/.test(part)) return null;
    const value = /^0[xX]/.test(part)
      ? Number.parseInt(part.slice(2), 16)
      : part.length > 1 && part.startsWith('0')
        ? Number.parseInt(part, 8)
        : Number.parseInt(part, 10);
    return Number.isSafeInteger(value) ? value : null;
  });
  if (values.some((value) => value === null)) return null;
  const nums = values as number[];
  const max = [0xffffffff, 0xffffff, 0xffff, 0xff][nums.length - 1];
  if (
    nums.length === 0 ||
    nums[nums.length - 1] > max ||
    nums.some((n, i) => i < nums.length - 1 && n > 255)
  )
    return null;
  let value = 0;
  if (nums.length === 1) value = nums[0];
  else if (nums.length === 2) value = (nums[0] << 24) + nums[1];
  else if (nums.length === 3) value = (nums[0] << 24) + (nums[1] << 16) + nums[2];
  else value = (nums[0] << 24) + (nums[1] << 16) + (nums[2] << 8) + nums[3];
  return `${(value >>> 24) & 255}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`;
}

function looksLikeDecimalIp(hostname: string): boolean {
  return parseIpv4Alternative(hostname) !== null;
}

function expandIpv6(hostname: string): string[] | null {
  const h = hostname.trim();
  if (h.includes('.')) {
    const lastColon = h.lastIndexOf(':');
    if (lastColon === -1) return null;
    const ipv4Part = h.slice(lastColon + 1);
    const ipv6Part = h.slice(0, lastColon + 1);
    const parts = ipv4Part.split('.').map((p) => Number.parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
    const a = parts[0].toString(16).padStart(2, '0');
    const b = parts[1].toString(16).padStart(2, '0');
    const c = parts[2].toString(16).padStart(2, '0');
    const d = parts[3].toString(16).padStart(2, '0');
    const hex32 = `${a}${b}:${c}${d}`;
    return expandIpv6(`${ipv6Part}${hex32}`);
  }

  const parts = h.split('::');
  if (parts.length > 2) return null; // multiple elisions - invalid

  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts[1] ? parts[1].split(':') : [];

  if (left.some((x) => x.length > 4 || (x.length > 0 && !/^[0-9a-fA-F]+$/.test(x)))) return null;
  if (right.some((x) => x.length > 4 || (x.length > 0 && !/^[0-9a-fA-F]+$/.test(x)))) return null;

  const totalSegments = left.length + right.length;
  if (totalSegments > 8) return null;

  if (parts.length === 2) {
    const elidedCount = 8 - totalSegments;
    const elided = Array<string>(elidedCount).fill('0');
    const finalGroups = [...left, ...elided, ...right].map((g) => g || '0');
    return finalGroups.length === 8 ? finalGroups : null;
  }

  if (totalSegments !== 8) return null;
  return left.map((g) => g || '0');
}

function ipv6GroupsToBigInt(groups: string[]): bigint {
  let value = 0n;
  for (const g of groups) {
    value = (value << 16n) | BigInt(Number.parseInt(g, 16));
  }
  return value;
}

/** Combine two 16-bit hex groups (e.g. '7f00', '0001') into a dotted-quad IPv4. */
function ipv4FromHexGroups(hi: string, lo: string): string | null {
  const a = Number.parseInt(hi, 16);
  const b = Number.parseInt(lo, 16);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const v = ((a & 0xffff) << 16) | (b & 0xffff);
  return `${(v >>> 24) & 0xff}.${(v >>> 16) & 0xff}.${(v >>> 8) & 0xff}.${v & 0xff}`;
}

export function isIpv6Private(groups: string[]): boolean {
  const value = ipv6GroupsToBigInt(groups);
  const HIGH_128 = value >> 0n;

  if (value === 1n) return true;

  // :: (unspecified) - never a valid fetch target; the IPv4 gate blocks
  // 0.0.0.0/8, so this must block its IPv6 counterpart too.
  if (value === 0n) return true;

  // ff00::/8 - multicast. Resolves to loopback/scope-local targets on the
  // local host and is never a legitimate public API endpoint, so it must not
  // be classified as "public" (the IPv4 gate likewise rejects 0.0.0.0/8).
  if (HIGH_128 >> 120n === 0xffn) return true;

  // fc00::/7 - unique local addresses (ULA)
  if (HIGH_128 >> 121n === 0b1111110n) return true;

  // fe80::/10 (link-local) and fec0::/10 (deprecated site-local)
  const top10 = HIGH_128 >> 118n;
  if (top10 === 0b1111111010n || top10 === 0b1111111011n) return true;

  // NAT64 Well-Known Prefix (RFC 6052): reject embedded non-global IPv4
  // destinations before a local DNS64/NAT64 translator can route them.
  // The separate local-use translation prefix is never a public fetch target.
  if (Number.parseInt(groups[0], 16) === 0x64 && Number.parseInt(groups[1], 16) === 0xff9b) {
    if (Number.parseInt(groups[2], 16) === 1) return true; // 64:ff9b:1::/48 (RFC 8215)
    if (groups.slice(2, 6).every((g) => Number.parseInt(g, 16) === 0)) {
      const embedded = ipv4FromHexGroups(groups[6], groups[7]);
      if (embedded && isIpv4Private(embedded)) return true;
    }
  }

  // Documentation prefixes are explicitly not globally reachable (IANA IPv6
  // special-purpose registry), so don't hand them to the fetch layer.
  if (Number.parseInt(groups[0], 16) === 0x2001 && Number.parseInt(groups[1], 16) === 0x0db8) {
    return true;
  }
  if (groups[0].toLowerCase() === '3fff' && Number.parseInt(groups[1], 16) < 0x1000) {
    return true;
  }

  // Teredo (RFC 4380) stores the client IPv4 address complemented in the low
  // 32 bits. Classify the decoded address with the IPv4 deny list.
  if (Number.parseInt(groups[0], 16) === 0x2001 && Number.parseInt(groups[1], 16) === 0) {
    const client = ~Number(value & 0xffffffffn) >>> 0;
    const embedded = `${client >>> 24}.${(client >>> 16) & 255}.${(client >>> 8) & 255}.${client & 255}`;
    if (isIpv4Private(embedded)) return true;
  }

  // 6to4 (RFC 3056): 2002:V4ADDR::/48 - the embedded IPv4 lives in groups 1-2,
  // so [2002:7f00:1::] encodes 127.0.0.1 and must be treated as private.
  if (groups.length >= 3 && groups[0].toLowerCase() === '2002') {
    const embedded = ipv4FromHexGroups(groups[1], groups[2]);
    if (embedded && isIpv4Private(embedded)) return true;
  }

  // IPv4-mapped (::ffff:a.b.c.d) - full 128-bit check, catches hex forms too.
  if (HIGH_128 >> 32n === 0xffffn) {
    const embedded = Number(value & 0xffffffffn) >>> 0;
    const a = (embedded >>> 24) & 0xff;
    const b = (embedded >>> 16) & 0xff;
    const c = (embedded >>> 8) & 0xff;
    const d = embedded & 0xff;
    return isIpv4Private(`${a}.${b}.${c}.${d}`);
  }

  // IPv4-compatible (deprecated ::/96, e.g. ::127.0.0.1 / ::7f00:1): first six
  // groups zero, last two groups encode the IPv4. Some stacks still route
  // these, so a private embedded address must be rejected.
  if (
    groups.length >= 8 &&
    groups.slice(0, 6).every((g) => Number.parseInt(g, 16) === 0) &&
    !(groups[6] === '0' && groups[7] === '0')
  ) {
    const embedded = ipv4FromHexGroups(groups[6], groups[7]);
    if (embedded && isIpv4Private(embedded)) return true;
  }

  return false;
}

export function isPublicHostname(hostname: string): boolean {
  if (!hostname) return false;
  // DNS treats a final dot as the root label, so `127.0.0.1.` and
  // `internal.example.` resolve to the same targets as their undotted forms.
  // Canonicalize before every lexical check and reject multiple root dots.
  const h = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (!h || h.endsWith('.')) return false;

  // RFC 6761 reserves localhost and every name beneath it for loopback.
  if (h === 'localhost' || h.endsWith('.localhost')) return false;

  const internalTldRe =
    /\.(local|internal|lan|home|home\.arpa|corp|priv|localdomain|onion|test|invalid|example)$/i;
  if (internalTldRe.test(h)) return false;

  const dnsRebindingRe = /\.(nip\.io|sslip\.io|traefik\.me|xip\.io)$/i;
  if (dnsRebindingRe.test(h)) return false;

  if (isIpv4Private(h)) return false;
  if (looksLikeDecimalIp(h)) return false;
  if (h.includes(':')) {
    const groups = expandIpv6(h);
    if (!groups) return false;
    return !isIpv6Private(groups);
  }

  if (!h.includes('.')) return false;

  return true;
}

/** Classify canonical A/AAAA response data, which is an address rather than a hostname. */
function isPublicIpAddress(address: string): boolean {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address)) {
    const octets = address.split('.').map(Number);
    return (
      octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) &&
      !isIpv4Private(address)
    );
  }
  if (address.includes(':')) {
    const groups = expandIpv6(address);
    return groups !== null && !isIpv6Private(groups);
  }
  return false;
}

/**
 * Reject a URL that is unsafe to fetch (SSRF guard).
 *
 * The returned `error` is a stable `errors.*` locale key, never prose: callers
 * forward it into result payloads (`fetchFavicon`, custom-instance validation)
 * or the WebDAV sync result objects, all of which render it through the UI's
 * translation layer.
 */
export function isSafeFetchUrl(url: string): { ok: boolean; error?: string } {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    /* ignore */
    return { ok: false, error: 'errors.webdavInvalidUrlFormat' };
  }
  if (parsedUrl.protocol !== 'https:') {
    return { ok: false, error: 'errors.webdavHttpsOnly' };
  }
  if (parsedUrl.username || parsedUrl.password) {
    return { ok: false, error: 'errors.webdavInvalidUrl' };
  }
  if (!isPublicHostname(parsedUrl.hostname)) {
    return { ok: false, error: 'errors.webdavPrivateNetwork' };
  }
  return { ok: true };
}

/**
 * Static URL safety check PLUS a DNS re-resolution guard for hostnames that
 * are not literal IPs. The browser resolves the hostname again at connect
 * time, so a hostname that currently resolves to a private address (DNS
 * rebinding, attacker-controlled zone) would pass the lexical
 * `isPublicHostname` pass - this rejects it before the fetch is issued.
 * Fail-closed: if the DNS validation itself cannot complete, the URL is
 * rejected.
 */
export async function isSafeFetchUrlWithDns(
  url: string,
  options: { allowHttp?: boolean } = {}
): Promise<{ ok: boolean; error?: string }> {
  let staticCheck: { ok: boolean; error?: string };
  if (options.allowHttp) {
    try {
      const parsed = new URL(url);
      staticCheck =
        parsed.protocol === 'http:' && isPublicHostname(parsed.hostname)
          ? { ok: true }
          : isSafeFetchUrl(url);
    } catch {
      staticCheck = { ok: false, error: 'errors.webdavInvalidUrlFormat' };
    }
  } else {
    staticCheck = isSafeFetchUrl(url);
  }
  if (!staticCheck.ok) return staticCheck;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, error: 'errors.webdavInvalidUrlFormat' };
  }
  const hostname = parsedUrl.hostname.toLowerCase().replace(/\.$/, '');
  // Literal IPs (v4/v6) were already classified by isPublicHostname - no DNS needed.
  if (
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) ||
    hostname.includes(':') ||
    hostname === 'localhost'
  ) {
    return { ok: true };
  }
  try {
    const queryTypes = ['A', 'AAAA'] as const;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const responses = await Promise.all(
        queryTypes.map((type) =>
          fetch(`https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=${type}`, {
            signal: controller.signal,
          })
        )
      );
      let resolvedAddressCount = 0;
      for (const response of responses) {
        if (!response.ok) {
          return { ok: false, error: 'errors.networkErrorGeneric' };
        }
        const data = (await response.json()) as {
          Answer?: Array<{ type: number; data?: string }>;
        };
        const answers = data.Answer || [];
        for (const answer of answers) {
          if (answer.type === 1 || answer.type === 28) {
            if (typeof answer.data !== 'string' || !isPublicIpAddress(answer.data)) {
              return { ok: false, error: 'errors.webdavPrivateNetwork' };
            }
            resolvedAddressCount += 1;
          }
        }
      }
      // An empty/NODATA response cannot establish that the browser's resolver
      // will reach a public address (for example, split-horizon DNS). Fail
      // closed instead of allowing the subsequent fetch to resolve unchecked.
      if (resolvedAddressCount === 0) {
        return { ok: false, error: 'errors.networkErrorGeneric' };
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return { ok: false, error: 'errors.networkErrorGeneric' };
  }
  return { ok: true };
}

/** How long a positive per-hostname DNS validation is trusted (ms).
 *  Sized against the mail poll cadence, which is USER-SELECTED:
 *  `autoRefreshInterval` can be as aggressive as 10s (defaults to 30s; the
 *  background alarm is clamped to ≥30s). A 10s TTL equals the most aggressive
 *  poll setting, so the cache expires between EVERY poll cycle - every fetch
 *  re-resolves and a DNS-rebinding repoint is caught on the very next
 *  request at any cadence. The previous 30s TTL let a rebind ride the cache
 *  for up to ~3 polls at the 10-minute setting (≤30s of blind spot); the
 *  cost of closing that window is at most one dns.google DoH lookup per
 *  hostname per poll cycle - the rate the 30s TTL already accepted at the
 *  default cadence. */
const FETCH_URL_DNS_CACHE_TTL_MS = 10 * 1000;
/** Bound the cache size so a long-lived session with many instances can't grow it unbounded. */
const FETCH_URL_DNS_CACHE_MAX = 100;

/**
 * Per-hostname cache of POSITIVE DNS validations. Failed validations are not
 * cached (a transient dns.google outage must not stick for the whole TTL -
 * the next fetch re-validates, fail-closed either way).
 */
const fetchUrlDnsCache = new Map<string, number>();

/** Test hooks for the module-level positive-DNS cache. Seeding an explicit
 *  `cachedAt` timestamp makes TTL behavior deterministic WITHOUT mocking the
 *  process clock (Bun's setSystemTime leaks past mock.restore and freezes
 *  Date.now for every test file that runs afterwards). */
export function resetFetchUrlDnsCacheForTests(): void {
  fetchUrlDnsCache.clear();
}
export function seedFetchUrlDnsCacheForTests(hostname: string, cachedAtMs: number): void {
  fetchUrlDnsCache.set(hostname, cachedAtMs);
}

/**
 * SSRF validation to run at REQUEST time (not only when a custom instance is
 * added). A hostname that resolved to a public address when the user saved
 * the instance can later be repointed at a private/loopback IP (DNS
 * rebinding) - the add-time gate can't see that. Every provider fetch
 * re-runs the cheap static checks; the DNS re-resolution runs for hostnames
 * that are not the provider's own bundled endpoint (the caller decides via
 * `skipDns`) and is cached per hostname so polling doesn't hammer dns.google
 * every cycle.
 *
 * Fail-closed: if the DNS validation cannot complete, the URL is rejected.
 */
export async function validateFetchUrl(
  url: string,
  opts?: { skipDns?: boolean; allowHttp?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      return { ok: false, error: 'errors.webdavInvalidUrl' };
    }
  } catch {
    return { ok: false, error: 'errors.webdavInvalidUrlFormat' };
  }
  const staticCheck = opts?.allowHttp
    ? (() => {
        try {
          const parsed = new URL(url);
          return parsed.protocol === 'http:' && isPublicHostname(parsed.hostname)
            ? { ok: true }
            : isSafeFetchUrl(url);
        } catch {
          // Same failure as the `new URL(url)` guard below - a locale key, not
          // prose: callers forward this into result payloads the UI renders.
          return { ok: false, error: 'errors.webdavInvalidUrlFormat' };
        }
      })()
    : isSafeFetchUrl(url);
  if (!staticCheck.ok) return staticCheck;
  if (opts?.skipDns) return { ok: true };

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { ok: false, error: 'errors.webdavInvalidUrlFormat' };
  }

  const cachedAt = fetchUrlDnsCache.get(hostname);
  if (cachedAt && Date.now() - cachedAt < FETCH_URL_DNS_CACHE_TTL_MS) {
    // The cache is ONLY a rate limit for repeated polls of an already-validated
    // hostname - it must never gate success by itself. The cheap static checks
    // re-ran above, so a URL that went private in URL space is still caught on
    // a cached hit; only an IP-space repoint inside the TTL rides the cache.
    return { ok: true };
  }

  const dns = await isSafeFetchUrlWithDns(url, { allowHttp: opts?.allowHttp });
  if (dns.ok) {
    if (fetchUrlDnsCache.size >= FETCH_URL_DNS_CACHE_MAX) {
      fetchUrlDnsCache.clear();
    }
    fetchUrlDnsCache.set(hostname, Date.now());
  }
  return dns;
}

export async function validateCustomInstanceUrl(url: string): Promise<void> {
  if (!url || url.trim().length === 0) {
    throw new ValidationError('Instance URL cannot be empty', { field: 'instanceUrl' });
  }
  if (url.length > CONSTANTS.MAX_CUSTOM_INSTANCE_URL_LENGTH) {
    throw new ValidationError(
      `Instance URL must be less than ${CONSTANTS.MAX_CUSTOM_INSTANCE_URL_LENGTH} characters`,
      { field: 'instanceUrl', maxLength: CONSTANTS.MAX_CUSTOM_INSTANCE_URL_LENGTH },
      'errors.instanceUrlTooLong'
    );
  }
  const { ok, error } = await isSafeFetchUrlWithDns(url);
  if (!ok) {
    // `error` is a stable `errors.*` key; ValidationError adopts it as its
    // translationKey so the handler payload stays renderable by the UI.
    throw new ValidationError(error ?? 'errors.invalidUrl', { field: 'instanceUrl' });
  }
}
