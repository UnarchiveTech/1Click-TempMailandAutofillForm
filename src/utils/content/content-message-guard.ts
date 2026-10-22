/**
 * Content-script message guard.
 *
 * The injected content script's `runtime.onMessage` listener is reachable by
 * ANY other extension (web pages cannot message content scripts directly, but
 * extensions can). Two layers of defense:
 *
 *  1. Same-extension check - `sender.id` must equal our own extension id.
 *     (`sender.url` is the PAGE url for content-script senders, so only `id`
 *     is reliable.)
 *  2. Allowlist - even our own extension may only trigger the message types
 *     the content script actually handles, dispatched on the `type` key.
 *     A confused/compromised caller - or a future handler that forgets to
 *     check its own type - cannot drive arbitrary flows.
 *
 * Kept pure (no `wxt/browser` import) so it's unit-testable without a browser.
 */

/** Message types the content script handles via the `type` key. */
const TYPE_KEYED_TYPES: ReadonlySet<string> = new Set([
  'startSignup',
  'fillOTP',
  'ping',
  'checkFormDetected',
  'rescanForms',
  'refillSavedLogin',
  'autofillBlocklistChanged',
  'sitePrivacySettingsChanged',
  // Diagnostics: the dev perf report merges the active tab's mark ring by
  // asking this script for it (getPerfReport in message-handler). Read-only.
  'collectPerfMarks',
]);

/** The full allowlist (for introspection / tests). */
export const CONTENT_SCRIPT_MESSAGE_TYPES: ReadonlySet<string> = TYPE_KEYED_TYPES;

/** The dispatch key of a message - `type` wins, then legacy `action` for backwards compat, else ''. */
export function contentScriptMessageKey(message: unknown): string {
  if (typeof message !== 'object' || message === null) return '';
  const m = message as Record<string, unknown>;
  if (typeof m.type === 'string') return m.type;
  if (typeof m.action === 'string') return m.action;
  return '';
}

/**
 * True only when the message came from our own extension AND names an
 * allowlisted message type on the exact key its handler switches on.
 * Fail-closed: missing ids, non-object payloads, and unknown types are
 * rejected.
 */
export function isTrustedContentScriptMessage(
  message: unknown,
  senderId: string | undefined,
  ownId: string
): boolean {
  if (!senderId || !ownId || senderId !== ownId) return false;
  if (typeof message !== 'object' || message === null) return false;
  const m = message as Record<string, unknown>;
  if (typeof m.type === 'string') return TYPE_KEYED_TYPES.has(m.type);
  return false;
}
