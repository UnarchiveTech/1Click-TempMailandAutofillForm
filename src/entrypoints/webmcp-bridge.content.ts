/**
 * webmcp-bridge.content.ts - Isolated world content script for WebMCP.
 *
 * 1Click analog of `calculator-webmcp/content.js`:
 *
 * 1. Inject webmcp-page.unlisted.ts into the real page context (MAIN world)
 *    so WebMCP can run where `document.modelContext` / `navigator.modelContext`
 *    exist. The page script is a web-accessible resource (WXT does not
 *    auto-add non-CSS resources), served from a per-session dynamic URL so a
 *    page cannot precompute or re-fetch it (see wxt.config.ts).
 * 2. Act as a secure bridge: the page script cannot call chrome.* APIs, so it
 *    talks to us via window.postMessage; we talk to the background via
 *    chrome.runtime.sendMessage.
 *
 * Do NOT register WebMCP tools here - isolated content scripts do not share
 * the page's JS environment that WebMCP agents observe.
 */

import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { injectScript } from 'wxt/utils/inject-script';
import { logError, logInfo, setContentLogging } from '@/utils/content/content-logger.js';

/** Must match the CHANNEL in webmcp-page.unlisted.ts. */
const CHANNEL = 'ONECLICK_WEBMCP';

/** Tools the background understands. The background re-validates anyway. */
const TOOL_NAMES = new Set([
  'get_active_email',
  'create_temp_email',
  'get_latest_emails',
  'get_latest_otp',
  'get_otp_from',
  'search_emails',
  'list_addresses',
  'get_email',
  'burn_inbox',
]);

/** Accept both the normal structured payload and WebMCP implementations that
 * serialize tool arguments before invoking the bridge. */
function normalizeToolArgs(args: unknown): Record<string, unknown> | null {
  if (args === undefined) return {};
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return null;
  return args as Record<string, unknown>;
}

function postBridgeError(requestId: string, error: string): void {
  window.postMessage(
    {
      channel: CHANNEL,
      direction: 'response',
      requestId,
      ok: false,
      error,
    },
    window.location.origin
  );
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  // Register tools as early as possible (modelContext can appear at any point;
  // the page script retries on its own).
  runAt: 'document_start',
  allFrames: false,
  async main() {
    // Respect the developer-settings logging toggle so raw WebMCP output
    // only appears when the user opted in (Settings → Developer → Enable logging).
    let loggingEnabled = false;
    try {
      const result = await browser.storage.local.get(['developerSettings']);
      const dev = result.developerSettings as { enableLogging?: boolean } | undefined;
      loggingEnabled = dev?.enableLogging === true;
    } catch {
      /* storage unavailable - leave logging off */
    }
    setContentLogging('[1Click WebMCP]', loggingEnabled);

    // Pass the flag into the page script's MAIN-world context via a data
    // attribute on <html> so the page script (which has no extension APIs)
    // can respect the same toggle without a postMessage round-trip.
    if (loggingEnabled && document.documentElement) {
      document.documentElement.dataset.oneclickWebmcpLogging = '1';
    }

    // Avoid double-injection if the content script runs more than once.
    if (document.documentElement?.dataset.oneclickWebmcpInjected === '1') return;
    if (document.documentElement) {
      document.documentElement.dataset.oneclickWebmcpInjected = '1';
    }

    // 1. Bridge: page (window.postMessage) ↔ background (chrome.runtime).
    //    Registered BEFORE the page script is injected so a tool call can never
    //    arrive before the listener exists.
    window.addEventListener('message', (event) => {
      // Must come from this window (page script) and same origin, not from iframes or foreign origins.
      if (event.source !== window || event.origin !== window.location.origin) return;

      const data = event.data as {
        channel?: string;
        direction?: string;
        requestId?: string;
        tool?: string;
        args?: unknown;
      } | null;
      if (!data || data.channel !== CHANNEL || data.direction !== 'request') return;

      // Basic shape validation before touching extension APIs.
      if (typeof data.requestId !== 'string' || data.requestId.length === 0) {
        return;
      }
      if (typeof data.tool !== 'string' || !TOOL_NAMES.has(data.tool)) {
        postBridgeError(data.requestId, 'Unknown WebMCP tool.');
        return;
      }

      const args = normalizeToolArgs(data.args);
      if (!args) {
        postBridgeError(data.requestId, 'Tool arguments must be a JSON object.');
        return;
      }
      if ('gestureToken' in args) {
        postBridgeError(data.requestId, 'Gesture tokens cannot be sent by a page.');
        return;
      }

      const payload = {
        type: 'webmcpTool',
        tool: data.tool,
        args,
      };

      try {
        browser.runtime
          .sendMessage(payload)
          .then((response) => {
            const reply = {
              channel: CHANNEL,
              direction: 'response',
              requestId: data.requestId,
              ok: Boolean(response?.success),
              result: (response as { result?: unknown } | undefined)?.result,
              error: (response as { error?: string } | undefined)?.error,
            };
            window.postMessage(reply, window.location.origin);
          })
          .catch(() => {
            const reply = {
              channel: CHANNEL,
              direction: 'response',
              requestId: data.requestId,
              ok: false,
              error: 'Extension context unavailable.',
            };
            window.postMessage(reply, window.location.origin);
          });
      } catch {
        const reply = {
          channel: CHANNEL,
          direction: 'response',
          requestId: data.requestId,
          ok: false,
          error: 'Failed to reach extension background.',
        };
        window.postMessage(reply, window.location.origin);
      }
    });

    // 2. Inject the MAIN-world page script (WXT's injectScript mirrors the
    //    calculator's manual script-tag injection, minus the boilerplate).
    //    Injected AFTER the listener above is registered so a tool call can
    //    never arrive before the bridge is able to answer it.
    try {
      await injectScript('/webmcp-page.js');
    } catch (err) {
      logError('Failed to inject page script', err);
      return;
    }

    logInfo('Content bridge active.');
  },
});
