/**
 * Heuristics for OTP / magic-link validity windows from email text.
 * Used for strip countdown UI — best-effort, never blocks the user.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Parse phrases like "expires in 10 minutes", "valid for 1 hour", "within 5 min" */
export function parseValidityDurationMs(text: string): number | null {
  if (!text) return null;
  const t = text.toLowerCase();

  const patterns: Array<{ re: RegExp; unit: number }> = [
    {
      re: /(?:expires?|valid|expire|expiry|within)\s*(?:for|in|within)?\s*(\d{1,3})\s*(?:minutes?|mins?|min\.?)\b/i,
      unit: MINUTE,
    },
    {
      re: /(?:expires?|valid|expire|expiry|within)\s*(?:for|in|within)?\s*(\d{1,2})\s*(?:hours?|hrs?|hr\.?)\b/i,
      unit: HOUR,
    },
    { re: /(\d{1,3})\s*(?:minutes?|mins?)\s*(?:to\s*)?(?:expire|valid|left)/i, unit: MINUTE },
    { re: /(\d{1,2})\s*(?:hours?|hrs?)\s*(?:to\s*)?(?:expire|valid|left)/i, unit: HOUR },
  ];

  for (const { re, unit } of patterns) {
    const m = t.match(re);
    if (m?.[1]) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0 && n < 24 * 60) return n * unit;
    }
  }

  if (/\b10\s*min/.test(t) && /code|otp|verif/.test(t)) return 10 * MINUTE;
  if (/\b15\s*min/.test(t) && /code|otp|verif|magic|link/.test(t)) return 15 * MINUTE;
  if (/\b5\s*min/.test(t) && /code|otp|verif/.test(t)) return 5 * MINUTE;

  return null;
}

/** Absolute expiry from received_at + duration heuristic, or null */
export function estimateExpiresAt(
  receivedAt: number | undefined,
  subject: string,
  body: string
): number | null {
  const base = receivedAt && receivedAt > 0 ? receivedAt : Date.now();
  const ms = parseValidityDurationMs(`${subject || ''}\n${body || ''}`);
  if (!ms) return null;
  return base + ms;
}

export function formatRemaining(expiresAt: number, now = Date.now()): string {
  const ms = expiresAt - now;
  if (ms <= 0) return 'expired';
  const mins = Math.ceil(ms / MINUTE);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
}
