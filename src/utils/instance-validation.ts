import { MAX_CUSTOM_INSTANCE_NAME_LENGTH, MAX_CUSTOM_INSTANCE_URL_LENGTH } from './constants.js';
import { ValidationError } from './errors.js';

/**
 * Validate custom instance name
 */
export function validateCustomInstanceName(name: string): void {
  if (!name || name.trim().length === 0) {
    throw new ValidationError('Instance name cannot be empty', { field: 'instanceName' });
  }
  if (name.length > MAX_CUSTOM_INSTANCE_NAME_LENGTH) {
    throw new ValidationError(
      `Instance name must be less than ${MAX_CUSTOM_INSTANCE_NAME_LENGTH} characters`,
      { field: 'instanceName', maxLength: MAX_CUSTOM_INSTANCE_NAME_LENGTH }
    );
  }
  // Check for potentially dangerous characters
  if (/[<>"'&]/.test(name)) {
    throw new ValidationError('Instance name contains invalid characters', {
      field: 'instanceName',
    });
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
  { base: 0xc0000200, bits: 24 }, // 192.0.2.0/24 (TEST-NET-1)
  { base: 0xc6336400, bits: 24 }, // 198.51.100.0/24 (TEST-NET-2)
  { base: 0xcb007100, bits: 24 }, // 203.0.113.0/24 (TEST-NET-3)
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

function looksLikeDecimalIp(hostname: string): boolean {
  if (!/^\d+$/.test(hostname)) return false;
  const n = Number.parseInt(hostname, 10);
  return n >= 0 && n <= 0xffffffff;
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

export function isIpv6Private(groups: string[]): boolean {
  const value = ipv6GroupsToBigInt(groups);
  const HIGH_128 = value >> 0n;

  if (value === 1n) return true;

  if (HIGH_128 >> 121n === 0b1111110n) return true;

  if (HIGH_128 >> 118n === 0b1111111010n) return true;

  if (HIGH_128 >> 96n === 0xffffn) {
    const embedded = Number(value & 0xffffffffn) >>> 0;
    const a = (embedded >>> 24) & 0xff;
    const b = (embedded >>> 16) & 0xff;
    const c = (embedded >>> 8) & 0xff;
    const d = embedded & 0xff;
    return isIpv4Private(`${a}.${b}.${c}.${d}`);
  }

  return false;
}

export function isPublicHostname(hostname: string): boolean {
  if (!hostname) return false;
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (h === 'localhost' || h === 'localhost.') return false;

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

export function isSafeFetchUrl(url: string): { ok: boolean; error?: string } {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, error: 'Invalid URL format' };
  }
  if (parsedUrl.protocol !== 'https:') {
    return { ok: false, error: 'Only https URLs are allowed' };
  }
  if (!isPublicHostname(parsedUrl.hostname)) {
    return { ok: false, error: 'URL cannot point to internal/private networks' };
  }
  return { ok: true };
}

export async function validateCustomInstanceUrl(url: string): Promise<void> {
  if (!url || url.trim().length === 0) {
    throw new ValidationError('Instance URL cannot be empty', { field: 'instanceUrl' });
  }
  if (url.length > MAX_CUSTOM_INSTANCE_URL_LENGTH) {
    throw new ValidationError(
      `Instance URL must be less than ${MAX_CUSTOM_INSTANCE_URL_LENGTH} characters`,
      { field: 'instanceUrl', maxLength: MAX_CUSTOM_INSTANCE_URL_LENGTH }
    );
  }
  const { ok, error } = isSafeFetchUrl(url);
  if (!ok) {
    throw new ValidationError(error ?? 'Instance URL is not allowed', { field: 'instanceUrl' });
  }

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    // Skip DNS query if it's already an IP address
    if (
      !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) &&
      !hostname.includes(':') &&
      hostname !== 'localhost'
    ) {
      const queryTypes = ['A', 'AAAA'];
      const responses = await Promise.all(
        queryTypes.map((type) =>
          fetch(`https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=${type}`)
        )
      );
      for (const response of responses) {
        if (!response.ok) {
          throw new Error('DNS validation request failed');
        }
        const data = await response.json();
        const answers = data.Answer || [];
        for (const answer of answers) {
          if (
            (answer.type === 1 || answer.type === 28) &&
            typeof answer.data === 'string' &&
            !isPublicHostname(answer.data)
          ) {
            throw new ValidationError('URL hostname resolves to private network', {
              field: 'instanceUrl',
            });
          }
        }
      }
    }
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError('Unable to validate instance hostname', {
      field: 'instanceUrl',
    });
  }
}
