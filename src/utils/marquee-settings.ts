/**
 * User preference for rubber-band (marquee) multi-select.
 * Default: enabled.
 */
import { browser } from 'wxt/browser';

export const MARQUEE_SELECTION_KEY = 'marqueeSelectionEnabled';

export async function isMarqueeSelectionEnabled(): Promise<boolean> {
  try {
    const res = (await browser.storage.local.get([MARQUEE_SELECTION_KEY])) as {
      marqueeSelectionEnabled?: boolean;
    };
    // Default true when unset
    return res.marqueeSelectionEnabled !== false;
  } catch {
    return true;
  }
}

export async function setMarqueeSelectionEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [MARQUEE_SELECTION_KEY]: enabled });
}
