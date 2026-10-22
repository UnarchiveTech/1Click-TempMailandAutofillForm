/**
 * CSP-proof half of the identity User-Agent spoof.
 *
 * `ua-spoof.content.ts` installs the override with an inline page `<script>`:
 * the zero-latency path, but a page whose CSP has no room for inline script
 * refuses it, and the refusal never reaches the content script as an error. The
 * spoof then silently does nothing on precisely the hardened sites that
 * fingerprint hardest - while the `declarativeNetRequest` rule in `index.ts`
 * still rewrites the `User-Agent` REQUEST HEADER, so the site is told one
 * platform on the wire and reads another from `navigator.userAgent`. That
 * mismatch is itself a signal.
 *
 * This module is the fallback the content script asks for when it observes the
 * refusal (`securitypolicyviolation`): `scripting.executeScript({ world: 'MAIN' })`
 * runs in the page's own world and is NOT subject to that page's CSP.
 *
 * The User-Agent is read HERE rather than taken from the sender: a page can
 * reach the content script, and the content script must never be the authority
 * on which identity the browser claims to be. Values pass the same
 * `isSafeUserAgentString` gate the inline path applies before a string reaches a
 * page world.
 */
import { browser } from 'wxt/browser';
import { inferPlatformFromUA, isSafeUserAgentString } from '@/utils/content/user-agent.js';
import { logError } from '@/utils/logger.js';
import type { Identity } from '@/utils/types.js';

/**
 * Runs in the page's MAIN world.
 *
 * `executeScript` serializes this function, so it may not close over anything.
 * It is deliberately the same three overrides as the inline tag's payload in
 * `ua-spoof.content.ts` - the two are the same spoof reached by two routes, so a
 * change here belongs there too.
 */
function installUserAgentOverride(userAgent: string, platform: string): void {
  // `userAgentData` is a Chromium-only experimental member that this project's
  // DOM lib does not declare, so widen the navigator once here instead of
  // casting at every use. (The inline path in `ua-spoof.content.ts` reaches the
  // same member through a template string, which no type-checker sees.)
  const page = navigator as Navigator & { userAgentData?: unknown };

  if ('userAgent' in page) {
    Object.defineProperty(page, 'userAgent', {
      get: () => userAgent,
      configurable: true,
    });
  }

  if ('platform' in page) {
    Object.defineProperty(page, 'platform', {
      get: () => platform,
      configurable: true,
    });
  }

  // Hide userAgentData so websites fall back to checking navigator.userAgent.
  if (page.userAgentData) {
    Object.defineProperty(page, 'userAgentData', {
      get: () => undefined,
      configurable: true,
    });
  }
}

/**
 * The active identity's validated spoof, or `null` when it has none.
 *
 * Exported so the inline path's inputs and the MAIN-world path's inputs are
 * provably the same pair (identity selection + validation), rather than two
 * lookups that can drift apart.
 */
export async function resolveSpoofedUserAgent(): Promise<{
  userAgent: string;
  platform: string;
} | null> {
  const { identities = [], selectedIdentityId } = await browser.storage.local.get([
    'identities',
    'selectedIdentityId',
  ]);
  const activeIdentity = (identities as Identity[]).find((i) => i.id === selectedIdentityId);
  const customUA = activeIdentity?.userAgent;
  if (!customUA || !isSafeUserAgentString(customUA)) return null;
  return { userAgent: customUA, platform: inferPlatformFromUA(customUA) };
}

/**
 * Install the override in one tab's MAIN world.
 *
 * Resolves `false` - never throws - when the active identity has no spoof, the
 * tab is already gone, or the injection is refused, so the message handler can
 * answer with a plain result. The failure is still logged: a silent `false` here
 * would restore exactly the blind spot this path exists to close.
 */
export async function applyUserAgentSpoofToTab(tabId: number): Promise<boolean> {
  try {
    const spoof = await resolveSpoofedUserAgent();
    if (!spoof) return false;

    await browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: installUserAgentOverride,
      args: [spoof.userAgent, spoof.platform],
    });
    return true;
  } catch (error) {
    logError('Failed to apply the User-Agent override in the page world', error);
    return false;
  }
}
