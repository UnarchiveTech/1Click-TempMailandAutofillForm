/**
 * Redaction of runtime-message payloads for the "Received message" dev log.
 *
 * Kept pure - no `wxt/browser`, no logger import - so the redaction, which is
 * the security property, is unit-testable without a browser or a mocked logger
 * (same rationale as `src/utils/content/content-message-guard.ts`).
 *
 * Why a dedicated field list instead of relying on the logger's key redaction:
 * `logger.ts` blanks a value whose KEY matches `SENSITIVE_LOG_KEYS`
 * (password / token / secret / credential / cookie / …). That covers
 * credential-shaped field NAMES, but not the generic `text` field a message
 * carries as its payload - and `text` is exactly where secrets ride: the
 * plaintext handed to `encryptData` (a password about to be encrypted) and the
 * one-time code handed to `copyToClipboard`. Both were printed verbatim the
 * moment developer logging was switched on. The two dedicated credential fields
 * are kept here as well so the redaction does not depend on the logger's regex
 * staying in sync.
 */

/**
 * Message fields whose VALUES are secret and are blanked before the message is
 * logged, whatever their content or shape.
 */
export const REDACTED_MESSAGE_FIELDS = [
  // Login passwords and vault session material.
  'credential',
  'sessionCredentials',
  // Pending-signup recovery sends the old and replacement login identifiers.
  'username',
  'expectedUsername',
  // `encryptData` plaintext (plaintext at this point - it has not been
  // encrypted yet) and `copyToClipboard` payload (an OTP code).
  'text',
  // Ciphertext/plaintext round-trip payloads, blanked for the same reason.
  'encrypted',
  'decrypted',
] as const;

/**
 * Copy of a runtime message with every {@link REDACTED_MESSAGE_FIELDS} value
 * replaced by `[REDACTED]`. A non-object input yields an empty record rather
 * than the raw value, so a malformed message can never reach the log verbatim.
 */
export function redactMessageForLog(message: unknown): Record<string, unknown> {
  if (typeof message !== 'object' || message === null) return {};
  const safe = { ...(message as Record<string, unknown>) };
  for (const key of REDACTED_MESSAGE_FIELDS) {
    if (key in safe) safe[key] = '[REDACTED]';
  }
  return safe;
}
