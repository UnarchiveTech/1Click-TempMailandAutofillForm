/**
 * Background-to-content OTP delivery.
 *
 * A service worker's runtime.sendMessage targets extension contexts, not
 * arbitrary webpage content scripts. Use tabs.sendMessage for page listeners;
 * tabs without the content script (extension pages, restricted URLs, closed
 * frames) are expected to reject and are intentionally ignored.
 */

import { browser } from 'wxt/browser';

export interface OtpBroadcastPayload {
  otp: string;
  sender?: string;
  senderName?: string;
  subject?: string;
  recipient?: string;
}

export async function broadcastOtpToTabs(payload: OtpBroadcastPayload): Promise<void> {
  let tabs: Array<{ id?: number; url?: string }>;
  try {
    // Only enumerate http(s) tabs - extension pages / new-tab pages never
    // contain wait-OTP panels and silently reject fillOTP messages.
    tabs = await browser.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  } catch {
    // Tab enumeration is best-effort; storage/latestOtp remains authoritative.
    return;
  }

  await Promise.allSettled(
    tabs
      .filter((tab): tab is { id: number } => typeof tab.id === 'number')
      .map((tab) =>
        browser.tabs.sendMessage(tab.id, {
          type: 'fillOTP',
          ...payload,
        })
      )
  );
}
