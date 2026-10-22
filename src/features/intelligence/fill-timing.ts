/**
 * Human-like staggered fill timing.
 */

import { loadSmartAutofillSettingsViaBg } from '@/utils/content/content-bg-bridge.js';

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function randomBetween(min: number, max: number): number {
  const a = Math.min(min, max);
  const b = Math.max(min, max);
  return a + Math.floor(Math.random() * (b - a + 1));
}

/** Delay between field fills when human-like timing is enabled. */
export async function maybeHumanDelay(): Promise<void> {
  const s = (await loadSmartAutofillSettingsViaBg()) as {
    humanLikeTiming?: boolean;
    timingMinMs?: number;
    timingMaxMs?: number;
  } | null;
  if (!s?.humanLikeTiming) return;
  await sleep(randomBetween(s.timingMinMs ?? 100, s.timingMaxMs ?? 500));
}
