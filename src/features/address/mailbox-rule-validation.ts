/**
 * Save-time validation for inbox-rule sender/recipient allowlist inputs.
 *
 * Allowlist entries accept the same forms `rulePassesAllowlist` matches: a full
 * address (`a@x.com`), a bare domain (`x.com`), or an `@domain` suffix
 * (`@x.com`). This module flags typo patterns before a rule is saved - a stray
 * space around `@`, multiple `@` signs, a missing domain or TLD, or pasted
 * `http://` / `mailto:` prefixes - so bad entries never get persisted.
 *
 * Pure functions: no browser or storage dependencies (unit-testable standalone).
 */

export type AllowlistEntryError =
  | 'spaceAroundAt'
  | 'multipleAt'
  | 'missingDomain'
  | 'missingTld'
  | 'invalidPrefix';

/** Split raw comma/whitespace-separated input exactly like the form's parser. */
export function splitAllowlistInput(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Structural check on the RAW input: whitespace directly adjacent to `@`
 * (`user @x.com`, `user@ x.com`) means an intended single address was split.
 * A space AFTER `@` is never valid; a space BEFORE `@` is only a typo when it
 * does not follow a comma separator (`, @y.com` is a legitimate list entry).
 */
export function validateAllowlistRaw(raw: string): AllowlistEntryError | null {
  if (/@\s/.test(raw)) return 'spaceAroundAt';
  if (/(?<![,\s])\s@/.test(raw)) return 'spaceAroundAt';
  return null;
}

/**
 * Validate a single (already-split, trimmed) entry. Returns an error code or
 * null when the entry is valid or empty.
 */
export function validateAllowlistEntry(entry: string): AllowlistEntryError | null {
  const e = entry.trim();
  if (!e) return null;
  if (/^(https?|mailto):/i.test(e)) return 'invalidPrefix';
  if (e.startsWith('@')) {
    const rest = e.slice(1);
    if (!rest) return 'missingDomain';
    if (rest.includes('@')) return 'multipleAt';
    if (!rest.includes('.')) return 'missingTld';
    return null;
  }
  if (e.includes('@')) {
    const parts = e.split('@');
    if (parts.length > 2) return 'multipleAt';
    if (!parts[1]) return 'missingDomain';
    if (!parts[1].includes('.')) return 'missingTld';
    return null;
  }
  if (!e.includes('.')) return 'missingTld';
  return null;
}

/** Validate the whole raw allowlist input; returns every error found (empty = valid). */
export function validateAllowlistInput(raw: string): AllowlistEntryError[] {
  const errors: AllowlistEntryError[] = [];
  const rawError = validateAllowlistRaw(raw);
  if (rawError) errors.push(rawError);
  for (const entry of splitAllowlistInput(raw)) {
    const err = validateAllowlistEntry(entry);
    if (err) errors.push(err);
  }
  return errors;
}
