/** Maintainer permission reported by the user on 11 October 2026, for seven days. */
export const RUNSIGNUP_WINDOW_START = Date.parse('2026-10-11T00:00:00+05:30');
export const RUNSIGNUP_WINDOW_END = Date.parse('2026-10-18T00:00:00+05:30');

export function requireRunSignupAuthorization(optIn: string | undefined, now = Date.now()): void {
  if (optIn !== '1')
    throw new Error('Set RUNSIGNUP_LIVE=1 to explicitly run the real signup test.');
  if (now < RUNSIGNUP_WINDOW_START || now >= RUNSIGNUP_WINDOW_END)
    throw new Error('RunSignup testing permission is outside its seven-day window.');
}
