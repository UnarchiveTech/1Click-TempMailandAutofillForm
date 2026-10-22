/**
 * Memoized body-derived preview text for the mail list: the one-line preview
 * under a list row, and the longer preview inside the row-hover tooltip.
 *
 * Both are derived from the message body, which is attacker-controlled HTML, so
 * both mean stripping tags and collapsing whitespace across the WHOLE body. The
 * row template re-ran its strip on every render, for every visible row, twice
 * per row in the list's two variants; the hover tooltip re-ran its own on every
 * change of hovered row. A 40-row window over HTML-heavy messages rescanned
 * megabytes of body text per render, and again on each hover / selection /
 * scroll re-render, for output that cannot change while the body does not.
 *
 * So each strip runs once per (email object, body value) and is reused. The
 * `WeakMap` gives each cache its lifetime story: an entry dies with the message
 * object it describes. A body mutated in place (a lazily filled `body_html`, a
 * just-decrypted `body_plain`) is re-previewed rather than serving a stale
 * string - the same source-verification pattern as `indexedEmailText` in
 * `email-filters.ts`.
 *
 * The cache must verify against the RAW body fields, never against the stripped
 * text: producing that text IS the expensive step, so verifying with it would
 * re-strip on every call and cache only the cheaper collapse/trim that follows.
 * Comparing the raw fields is a property read plus a string identity check, so a
 * hit costs nothing measurable.
 *
 * Output is byte-identical to the inline expressions these replace. Tag
 * stripping goes through `stripTagSpans`, which is exactly the `/<[^>]*>/g`
 * shape both call sites shipped with (including `<>`) but linear instead of
 * quadratic on a body of `<` characters with no `>` - so only the worst case
 * changes, never a character of what is rendered.
 */

import { stripTagSpans } from '@/utils/email/html-scan.js';
import type { Email } from '@/utils/types.js';

const WHITESPACE_RUN_RE = /\s+/g;

/** How much of the body the row-hover tooltip shows. */
const HOVER_PREVIEW_CHARS = 400;

interface RowPreviewEntry {
  /** The raw body fields the preview was derived from, as they were read. */
  plain: string | undefined;
  html: string | undefined;
  body: string | undefined;
  text: string;
}

interface HoverPreviewEntry {
  /** The raw `body_html` the preview was derived from. */
  source: string;
  text: string;
}

const rowPreviewCache = new WeakMap<Email, RowPreviewEntry>();
const hoverPreviewCache = new WeakMap<Email, HoverPreviewEntry>();

/**
 * The one-line preview shown under a list row: `body_plain` verbatim when
 * present, otherwise `body_html`/`body` with tags stripped, in both cases with
 * whitespace runs collapsed and the ends trimmed.
 */
export function emailBodyPreview(mail: Email): string {
  const plain = mail.body_plain;
  const html = mail.body_html;
  const body = mail.body;

  const cached = rowPreviewCache.get(mail);
  if (cached && cached.plain === plain && cached.html === html && cached.body === body) {
    return cached.text;
  }

  const text = (plain || stripTagSpans(html || body || '')).replace(WHITESPACE_RUN_RE, ' ').trim();
  rowPreviewCache.set(mail, { plain, html, body, text });
  return text;
}

/**
 * The row-hover tooltip's body text, capped at `HOVER_PREVIEW_CHARS`, or `null`
 * when the message carries no body at all (the tooltip then shows its localized
 * "no preview" line). `body_plain` is shown trimmed but NOT whitespace-collapsed,
 * and the HTML branch collapses whitespace before trimming - exactly as the
 * inline markup did.
 */
export function emailHoverPreview(mail: Email): string | null {
  const plain = mail.body_plain;
  // Cheap path, and the one the inline markup took first: no strip needed.
  if (plain) return plain.trim().slice(0, HOVER_PREVIEW_CHARS);

  const source = mail.body_html;
  if (!source) return null;

  const cached = hoverPreviewCache.get(mail);
  if (cached && cached.source === source) return cached.text;

  const text = stripTagSpans(source, ' ')
    .replace(WHITESPACE_RUN_RE, ' ')
    .trim()
    .slice(0, HOVER_PREVIEW_CHARS);
  hoverPreviewCache.set(mail, { source, text });
  return text;
}
