/**
 * Standard RFC 6238 / RFC 4226 TOTP (Time-based One-Time Password) Authenticator Generator.
 * Uses Web Crypto API (HMAC-SHA1) with Base32 decoding.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decode Base32 string to Uint8Array.
 *
 * Throws on any character outside the RFC 4648 Base32 alphabet (after
 * stripping whitespace, dashes and padding). Silently skipping invalid
 * characters would derive a WRONG key from a mistyped secret and produce a
 * plausible-but-incorrect TOTP with no error surface - callers catch and
 * surface the failure instead.
 */
export function base32ToBytes(base32: string): Uint8Array {
  const clean = base32.toUpperCase().replace(/[\s=-]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) {
      throw new Error(`Invalid Base32 character: "${clean[i]}"`);
    }

    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return new Uint8Array(bytes);
}

/**
 * Generate a 6-digit TOTP code and return remaining seconds until next refresh cycle.
 */
export async function generateTOTP(
  secretBase32: string,
  timeMs: number = Date.now(),
  stepSeconds = 30,
  digits = 6
): Promise<{ code: string; secondsRemaining: number; progressPercent: number }> {
  if (!secretBase32 || secretBase32.trim().length === 0) {
    return { code: '', secondsRemaining: 0, progressPercent: 0 };
  }

  try {
    const keyBytes = base32ToBytes(secretBase32);
    if (keyBytes.length === 0) {
      return { code: '', secondsRemaining: 0, progressPercent: 0 };
    }

    const epochSeconds = Math.floor(timeMs / 1000);
    const counter = Math.floor(epochSeconds / stepSeconds);
    const secondsRemaining = stepSeconds - (epochSeconds % stepSeconds);
    const progressPercent = Math.round((secondsRemaining / stepSeconds) * 100);

    // Convert counter integer to 8-byte big-endian Uint8Array
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setUint32(4, counter, false); // Big-endian 32-bit low part

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes.buffer as ArrayBuffer,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, buffer);
    const sigBytes = new Uint8Array(signature);

    // Dynamic truncation offset
    const offset = sigBytes[sigBytes.length - 1] & 0x0f;
    const binary =
      ((sigBytes[offset] & 0x7f) << 24) |
      ((sigBytes[offset + 1] & 0xff) << 16) |
      ((sigBytes[offset + 2] & 0xff) << 8) |
      (sigBytes[offset + 3] & 0xff);

    const otpNumber = binary % 10 ** digits;
    const code = String(otpNumber).padStart(digits, '0');

    return { code, secondsRemaining, progressPercent };
  } catch {
    return { code: '', secondsRemaining: 0, progressPercent: 0 };
  }
}
