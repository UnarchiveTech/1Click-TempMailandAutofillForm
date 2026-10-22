/**
 * Linear, quote-aware scanners for **attacker-controlled email HTML**.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Several hot paths pull structure out of a message body that any sender
 * controls:
 *   - MailView's "Links in this email" + markdown export  (UI thread)
 *   - magic-link detection and OTP extraction             (service worker, every
 *     ingested message)
 *
 * Each of them used a regex with a greedy or lazy quantifier in front of a
 * terminator that an attacker can simply omit, which makes the scan
 * SUPER-LINEAR in the body length:
 *
 *   regex shape                                   adversarial body      measured
 *   `/<a\b[^>]*\bhref…[^>]*>([\s\S]*?)<\/a>/gi`   `'<a href="'.repeat(n)`  126 s @ 28.8 KB  (cubic)
 *   `/<[^>]+>/g`                                  `'<'.repeat(n)`          2.3 s @ 125 KB   (quadratic)
 *   `/<!--[\s\S]*?-->/g`                          `'<!--'.repeat(n)`        88 s @ 500 KB   (quadratic)
 *
 * There is no ingest-time body cap, so those sizes are the sender's choice; the
 * cost lands as a frozen UI thread or a blocked service worker. Every function
 * here walks with `indexOf`/a bounded regex over ONE already-delimited region,
 * so each byte is consumed once and the total cost is linear.
 *
 * Semantics are kept identical to the regexes they replace (verified by the
 * unit tests), with two deliberate improvements noted on each function.
 *
 * This module has NO imports on purpose: it is shared by UI and background
 * code, so it must not drag sanitizer/DOM dependencies into either bundle
 * (confirmed: `background.js` still contains no sanitizer).
 */

/** Locate `<a` open tags (case-insensitive) for the linear anchor walk. */
const ANCHOR_OPEN_RE = /<a\b/gi;

/** Locate the matching `</a>`, case-insensitively, from a given index. */
const ANCHOR_CLOSE_RE = /<\/a>/gi;

/**
 * Pull the href value out of ONE already-delimited open tag. Safe to run on a
 * bounded tag string: there is no `[^>]*` scan to end-of-input possible here.
 */
const ANCHOR_HREF_RE = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

/** Read a tag's name from a short bounded slice at its `<`. */
const TAG_NAME_RE = /^<\s*([a-zA-Z][a-zA-Z0-9]*)/;

export interface ParsedAnchor {
  /** The href value exactly as written (entity-encoded, possibly relative). */
  href: string;
  /** False when the open tag carried no href attribute at all. */
  hasHref: boolean;
  /** Raw markup between the open tag's `>` and the closing `</a>`. */
  innerHtml: string;
  /** Offset of the `<` that opens the anchor. */
  start: number;
  /** Offset just past the closing `</a>`. */
  end: number;
}

/** Find a tag's closing `>` while respecting quotes and HTML comments. */
export function findTagEnd(html: string, start: number): number {
  if (html.startsWith('<!--', start)) {
    const commentEnd = html.indexOf('-->', start + 4);
    return commentEnd === -1 ? -1 : commentEnd + 2;
  }
  let quote = '';
  for (let i = start + 1; i < html.length; i++) {
    const char = html[i];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return i;
    }
  }
  return -1;
}

/**
 * Every FULLY CLOSED `<a>…</a>` span in `html`, in document order, in one
 * linear pass. An unterminated `<a` is not reported (the regexes this replaces
 * only matched closed anchors too) - and because no `</a>` exists at or after
 * that point, no later `<a` can be closed either, so the walk stops instead of
 * re-scanning to end-of-input once per remaining anchor.
 *
 * Improvement over the regex: a `>` inside an earlier quoted attribute no
 * longer truncates the tag, so a following `href` is found.
 *
 * Spans never overlap and `end` is exclusive.
 */
export function parseAnchors(html: string): ParsedAnchor[] {
  const anchors: ParsedAnchor[] = [];
  if (!html) return anchors;

  ANCHOR_OPEN_RE.lastIndex = 0;
  for (let open = ANCHOR_OPEN_RE.exec(html); open !== null; open = ANCHOR_OPEN_RE.exec(html)) {
    const tagStart = open.index;
    const tagEnd = findTagEnd(html, tagStart);
    if (tagEnd === -1) break; // no terminated tag remains in the body
    const tag = html.slice(tagStart, tagEnd + 1);
    ANCHOR_CLOSE_RE.lastIndex = tagEnd + 1;
    const close = ANCHOR_CLOSE_RE.exec(html);
    if (close === null) break;
    const end = close.index + close[0].length;
    // Resume scanning after the consumed span so a nested `<a` is not revisited.
    ANCHOR_OPEN_RE.lastIndex = end;
    const hrefMatch = ANCHOR_HREF_RE.exec(tag);
    anchors.push({
      href: hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? '',
      hasHref: hrefMatch !== null,
      innerHtml: html.slice(tagEnd + 1, close.index),
      start: tagStart,
      end,
    });
  }
  return anchors;
}

/**
 * `html` with every closed `<a>…</a>` span replaced by `replacement`, so a
 * bare-URL pass over the result cannot double-count a href. Built from the same
 * single pass - the previous `.replace(/<a\b[\s\S]*?<\/a>/gi, ' ')` was itself
 * quadratic on a body of unterminated anchors.
 */
export function stripAnchors(
  html: string,
  anchors: ParsedAnchor[] = parseAnchors(html),
  replacement = ' '
): string {
  if (anchors.length === 0) return html;
  let out = '';
  let cursor = 0;
  for (const anchor of anchors) {
    out += `${html.slice(cursor, anchor.start)}${replacement}`;
    cursor = anchor.end;
  }
  return out + html.slice(cursor);
}

/**
 * Replace every closed `<!-- … -->` comment with `replacement`.
 * Equivalent to `.replace(/<!--[\s\S]*?-->/g, replacement)` - a comment with no
 * `-->` is left untouched, exactly as the regex left it - but linear instead of
 * quadratic on a body of `<!--` openers.
 */
export function stripHtmlComments(html: string, replacement = ' '): string {
  const open = '<!--';
  const first = html.indexOf(open);
  if (first === -1) return html;
  let out = '';
  let cursor = 0;
  let start = first;
  while (start !== -1) {
    const end = html.indexOf('-->', start + open.length);
    if (end === -1) break; // no comment can close at or after this point
    out += html.slice(cursor, start) + replacement;
    cursor = end + 3;
    start = html.indexOf(open, cursor);
  }
  return out + html.slice(cursor);
}

/**
 * Replace every tag (`<` … `>`, at least one char between) with `replacement`.
 *
 * Equivalent to `.replace(/<[^>]+>/g, replacement)` - including that `<>` is
 * NOT a tag and an unterminated `<` never matches - but linear instead of
 * quadratic on a body of `<` characters with no `>`.
 */
export function stripAllTags(html: string, replacement = ' '): string {
  let out = '';
  let cursor = 0;
  let lt = html.indexOf('<', cursor);
  while (lt !== -1) {
    const gt = html.indexOf('>', lt + 1);
    if (gt === -1) break; // no tag can close from here on: the rest is text
    if (gt === lt + 1) {
      // `<>`: `[^>]+` needs at least one char between, so it never matched.
      out += `${html.slice(cursor, lt + 1)}`;
      cursor = lt + 1;
      lt = html.indexOf('<', cursor);
      continue;
    }
    out += `${html.slice(cursor, lt)}${replacement}`;
    cursor = gt + 1;
    lt = html.indexOf('<', cursor);
  }
  return out + html.slice(cursor);
}

/**
 * Replace every `<` … `>` span with `replacement`, INCLUDING the empty `<>`.
 *
 * Equivalent to `.replace(/<[^>]*>/g, replacement)` - `*` rather than `+`, so
 * `<>` IS a span here - but linear instead of quadratic on a body of `<`
 * characters with no `>` (the regex's 2.3 s at 125 KB, the freeze this module
 * exists to remove). An unterminated `<` still never matches, and a span may
 * contain other `<` characters: `<a<b>` is ONE span, exactly as `[^>]*` reads
 * it, because both take the first `>` at or after the `<`.
 *
 * This is the shape the UI's row and hover body previews shipped with, so
 * moving them here changes no output - only the worst case.
 */
export function stripTagSpans(html: string, replacement = ''): string {
  let out = '';
  let cursor = 0;
  let lt = html.indexOf('<', cursor);
  while (lt !== -1) {
    const gt = html.indexOf('>', lt + 1);
    if (gt === -1) break; // no `>` can close from here on: the rest is text
    out += `${html.slice(cursor, lt)}${replacement}`;
    cursor = gt + 1;
    lt = html.indexOf('<', cursor);
  }
  return out + html.slice(cursor);
}

/**
 * Replace every `<name …>…</name>` BLOCK (open tag through close tag, content
 * included) with `replacement`; every other tag is left in place.
 *
 * Equivalent to `/<name\b[^>]*>[\s\S]*?<\/name\s*>/gi` over each name, but
 * linear: the close tag is located with `indexOf`-style literal search rather
 * than by backtracking, so a body of unterminated `<name` openers costs O(n)
 * not O(n²). A block with no close tag is left alone (the regexes did not match
 * those either), and the close tag must match the opener's name - slightly
 * stricter than an alternation like `<\/(style|script)>`, which allowed a
 * mismatched pair.
 */
export function stripTagBlocks(html: string, names: readonly string[], replacement = ' '): string {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  if (wanted.size === 0 || html.length === 0) return html;
  const closeRes = new Map(
    [...wanted].map((name) => [name, new RegExp(`</\\s*${name}\\s*>`, 'gi')])
  );
  let out = '';
  let cursor = 0;
  let lt = html.indexOf('<', cursor);
  while (lt !== -1) {
    const name = TAG_NAME_RE.exec(html.slice(lt, lt + 32))?.[1]?.toLowerCase();
    const gt = html.indexOf('>', lt + 1);
    if (gt === -1) break; // no tag can close from here on: the rest is text
    const closeRe = name && wanted.has(name) ? closeRes.get(name) : undefined;
    if (closeRe) {
      closeRe.lastIndex = gt + 1;
      const close = closeRe.exec(html);
      if (close !== null) {
        out += `${html.slice(cursor, lt)}${replacement}`;
        cursor = close.index + close[0].length;
        lt = html.indexOf('<', cursor);
        continue;
      }
    }
    // Not a block (or unterminated): emit this `<` and keep scanning.
    out += html.slice(cursor, lt + 1);
    cursor = lt + 1;
    lt = html.indexOf('<', cursor);
  }
  return out + html.slice(cursor);
}
