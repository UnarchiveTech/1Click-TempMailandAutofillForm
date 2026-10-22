/**
 * Magic-link / one-click sign-in URL detection.
 *
 * Scans subject + HTML/plain body for https URLs, scores them with generic
 * heuristics (path tokens, query keys, anchor text), and returns the best
 * candidates. Never auto-navigates - UI must require a user click.
 */

export interface MagicLink {
  url: string;
  /** Display label (anchor text or host) */
  label?: string;
  /** Relative confidence score (higher = more likely a magic/login link) */
  score: number;
  host?: string;
  /** Best-guess purpose of the link (verify emails are preferred over sign-in). */
  kind: 'verify' | 'signin' | 'other';
}

import { decodeHtmlEntities } from '@/utils/email/decode-html-entities.js';
import { parseAnchors } from '@/utils/email/html-scan.js';

/** Minimum score to treat a URL as a magic/login link. */
export const MAGIC_LINK_SCORE_THRESHOLD = 6;

/** Max links to attach per message. */
export const MAGIC_LINK_MAX = 3;

/**
 * Verification links (confirm/verify/activate) expire quickly and are the
 * email's primary action. This is the maximum age of the EMAIL we'll still
 * surface a magic link from - older messages usually contain already-expired
 * links (verify emails are typically valid 24h-14d).
 */
export const MAGIC_LINK_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const POSITIVE_PATH =
  /magic[_-]?link|magiclink|one[_-]?time|onetime|sign[_-]?in|signin|log[_-]?in|login|verify|verification|confirm|confirmation|activate|activation|auth(?:enticate|entication|orize)?|sso|session|callback|token|magic|otp\/link|passwordless|passkey|click[_-]?to[_-]?login|continue|access|join|invite|accept/i;

// `t`, `code` and `hash` are deliberately excluded: `t=` timestamps and
// `hash=`/`code=` values are how tracking pixels and promo-code links smuggle
// params, and they caused marketing links to look auth-ish.
const POSITIVE_QUERY_KEYS =
  /^(?:token|k|key|auth|sid|session|magic|ml|verify|confirm|uid|user_id|jwt|access_token|login_token|sso|state)$/i;

const NEGATIVE_PATH =
  /unsubscribe|opt[_-]?out|preference|preferences|list[_-]?manage|list-manage|privacy|terms|tos|policy|cdn\.|static\.|assets?\/|favicon|pixel|track(?:ing)?|open\.gif|click\.gif|beacon|mailto:|tel:|sms:|javascript:/i;

const NEGATIVE_HOST = /^(?:www\.)?(?:facebook|twitter|x|instagram|linkedin|youtube|tiktok)\.com$/i;

/** Identity-provider / account hosts whose login links are NOT magic links. */
const NEGATIVE_AUTH_HOST =
  /^accounts\.google\.com$|^login\.microsoftonline\.com$|^login\.live\.com$|^appleid\.apple\.com$|^signin\.aws\.amazon\.com$/i;

/**
 * Subjects that are NOT magic-link emails: transactional noise, receipts and
 * bulk mail. A link in these is a tracker or a "view details" pointer, not a
 * credential-in / verify-your-email action.
 */
const NEGATIVE_SUBJECT =
  /unsubscribe|newsletter|weekly|digest|receipt|invoice|order\s*(?:confirmation|shipped|delivered)|shipping|payment|statement|no[-\s]?reply|do[-\s]?not[-\s]?reply|transaction\s*(?:alert|confirm)|account[-\s]?(?:activity|statement|update)|2fa|two[-\s]?factor|security\s*alert|authentication\s*code|your\s*code|otp\s*code/i;

const POSITIVE_ANCHOR =
  /^(?:log\s*in|sign\s*in|sign\s*up|verify(?:\.?\s*email)?|confirm(?:\.?\s*(?:email|account))?|activate(?:\.?\s*account)?|continue|access|open|click\s+here|get\s+started|join|accept\s+invite|reset\s+password|set\s+password|view\s+(?:email|message)|authenticate)$/i;

// "welcome" emails are where "Confirm your email" primary actions live, so they
// are boosted here rather than penalized below.
const POSITIVE_SUBJECT =
  /magic\s*link|sign\s*in|log\s*in|verify\s*(?:your\s*)?email|confirm\s*(?:your\s*)?(?:email|account)|one[- ]?time|passwordless|click\s+to\s+(?:sign|log)\s*in|welcome(?: to)?/i;

// Opaque tracking tokens and their random contents are not authentication
// intent. Require a purpose in an actual path component or visible mail copy.
const AUTH_ACTION_PATH =
  /(?:^|\/)(?:magic(?:[_-]?link)?|one[_-]?time|sign[_-]?in|log[_-]?in|loginwithemail|verify|verification|confirm|confirmation|activate|activation|auth(?:enticate|entication|orize)?|sso|session|passwordless|passkey|otp)(?:\/|$|[-_])/i;
const AUTH_ACTION_LABEL =
  /(?:log\s*in|sign\s*in|verify|confirm|activate|magic\s*link|reset\s+password|set\s+password)/i;

/** Path/query tokens that mark a link as a verification (primary) action. */
const VERIFY_PATH =
  /verify|verification|confirm|confirmation|activate|activation|email[_-]?verify/i;

/** Path/query tokens that mark a link as a sign-in action. */
const SIGNIN_PATH = /sign[_-]?in|signin|log[_-]?in|login|magic|sso|passwordless|session|auth/i;

interface Candidate {
  url: string;
  label: string;
  score: number;
  host: string;
  kind: 'verify' | 'signin' | 'other';
}

/** Sticky openers, anchored at an exact `<` offset via `lastIndex`. */
const SCRIPT_OPEN_RE = /<script\b/iy;
const STYLE_OPEN_RE = /<style\b/iy;
const SCRIPT_CLOSE_RE = /<\/script\s*>/gi;
const STYLE_CLOSE_RE = /<\/style\s*>/gi;

/**
 * Strip `<script>`/`<style>` blocks and every other tag in ONE linear pass.
 *
 * The previous implementation was three sequential regex passes:
 * `<script[\s\S]*?<\/script>`, the same for style, then `<[^>]+>`. The last one
 * is QUADRATIC when the body contains `<` characters with no `>` after them:
 * the engine scans to end-of-input at every `<`. A sender can trivially craft
 * that (a body of nothing but `<`), and this runs on EVERY ingested message in
 * the service worker - measured 2.3 s for a 125 KB body through
 * `extractMagicLinks`. Scanning with indexOf instead consumes each region once,
 * so the cost is linear, and the block/tag semantics are unchanged.
 */
function stripTags(html: string): string {
  let out = '';
  let cursor = 0;
  while (cursor < html.length) {
    const lt = html.indexOf('<', cursor);
    if (lt === -1) break;
    out += html.slice(cursor, lt);
    const gt = html.indexOf('>', lt + 1);
    if (gt === -1) {
      // No tag can be closed from here on, so the remainder is text.
      out += html.slice(lt);
      cursor = html.length;
      break;
    }
    const blockEnd = scriptBlockEnd(html, lt, gt);
    if (blockEnd !== -1) {
      // The whole block, content included, is dropped (the old passes did).
      out += ' ';
      cursor = blockEnd;
      continue;
    }
    if (gt === lt + 1) {
      // `<>`: `[^>]+` needs at least one char between, so it never matched.
      out += '<';
      cursor = lt + 1;
      continue;
    }
    out += ' ';
    cursor = gt + 1;
  }
  out += html.slice(cursor);
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Exclusive end offset of a `<script>`/`<style>` block opening at `lt`, or -1
 * when this `<` starts no such block (or the block is unterminated, in which
 * case the old regexes did not match it either and its tag is stripped alone).
 */
function scriptBlockEnd(html: string, lt: number, openTagEnd: number): number {
  SCRIPT_OPEN_RE.lastIndex = lt;
  const isScript = SCRIPT_OPEN_RE.test(html);
  STYLE_OPEN_RE.lastIndex = lt;
  const isStyle = !isScript && STYLE_OPEN_RE.test(html);
  if (!isScript && !isStyle) return -1;
  const closeRe = isScript ? SCRIPT_CLOSE_RE : STYLE_CLOSE_RE;
  closeRe.lastIndex = openTagEnd + 1;
  const close = closeRe.exec(html);
  return close === null ? -1 : close.index + close[0].length;
}

/**
 * Shared hard-reject rules for magic-link destinations. Returns a reason
 * string when the URL must NEVER be surfaced as a magic link, or null when it
 * passes. Used by BOTH detectors so the AI path applies exactly the same host
 * / path checks as the local scorer.
 *
 * `strictNegativePath` is AI-mode-only: the local scorer penalizes
 * tracking/unsubscribe paths by -8 but still lets a genuinely strong verify
 * link through, while the AI path hard-rejects them (the model is explicitly
 * told to ignore those links anyway, so reporting one is a mistake).
 */
export function magicLinkRejectionReason(
  host: string,
  pathname: string,
  search: string = '',
  opts: { strictNegativePath?: boolean } = {}
): string | null {
  if (NEGATIVE_HOST.test(host)) return 'blocked marketing/social host';
  if (NEGATIVE_AUTH_HOST.test(host)) return 'identity-provider host';
  // GitHub account-security emails ("new device signed in") link to
  // github.com/login, but its settings/emails/verify links are real
  // confirm-email actions, so only the login path is excluded.
  if (host === 'github.com' && /^\/login(?:\/|$)/i.test(pathname)) {
    return 'generic login path';
  }
  if (opts.strictNegativePath && NEGATIVE_PATH.test(`${pathname}${search}`)) {
    return 'tracking/unsubscribe path';
  }
  return null;
}

/**
 * True when an email is old enough that its verify/confirm links are usually
 * already expired (same MAGIC_LINK_MAX_AGE_MS guard both detectors apply).
 */
export function magicLinkIsStale(receivedAt: number | undefined): boolean {
  if (typeof receivedAt !== 'number' || receivedAt <= 0) return false;
  const toMs = (t: number): number => (t < 1e12 ? t * 1000 : t);
  return Date.now() - toMs(receivedAt) > MAGIC_LINK_MAX_AGE_MS;
}

/**
 * Normalize URL: decode entities + a SINGLE percent-decode pass.
 *
 * The decode is deliberately NOT looped until stable: some signup flows
 * double-encode tokens (e.g. `?token=abc%252Fdef`). Re-decoding until stable
 * would turn that into `abc/def` and corrupt the link, so we decode exactly
 * once - a double-encoded token stays `%2F` (still valid), and a
 * legitimately-encoded value is decoded exactly as the sender intended.
 * Malformed percent sequences (bare `%`) are left untouched.
 */
export function normalizeUrl(raw: string): string | null {
  let u = decodeHtmlEntities(raw.trim());
  try {
    u = decodeURIComponent(u);
  } catch {
    /* not (fully) percent-encoded - keep as-is */
  }
  // Strip wrapping punctuation common in plain text
  u = u.replace(/^[<(["']+/, '').replace(/[>)\]",'.!?;:]+$/g, '');
  if (!u) return null;
  // Protocol-relative
  if (u.startsWith('//')) u = `https:${u}`;
  if (!/^https?:\/\//i.test(u)) return null;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    // Prefer https for display/open; keep original if already https
    return parsed.href;
  } catch {
    /* ignore */
    return null;
  }
}

function classifyKind(urlStr: string, label: string): 'verify' | 'signin' | 'other' {
  // Kind is a property of the LINK itself (path/label), NOT the email subject:
  // a "Confirm your email" email also carries a "Sign in" anchor, and marking
  // every link verify-kind would let the sign-in anchor steal the bonus and
  // the verify-preference tie-break. The subject only boosts scores equally.
  const parsed = new URL(urlStr);
  // Query VALUES can contain arbitrary prose or random tokens. Their contents
  // must not classify a product/article as verify/sign-in.
  const hay =
    `${parsed.pathname} ${Array.from(parsed.searchParams.keys()).join(' ')} ${label || ''}`.toLowerCase();
  if (VERIFY_PATH.test(hay) || /verify|confirm|activate/i.test(label || '')) {
    return 'verify';
  }
  if (SIGNIN_PATH.test(hay) || /log\s*in|sign\s*in/i.test(label || '')) {
    return 'signin';
  }
  return 'other';
}

function scoreUrl(
  urlStr: string,
  label: string,
  subject: string
): { score: number; host: string; kind: 'verify' | 'signin' | 'other' } | null {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    /* ignore */
    return null;
  }

  // Prefer https; slight penalty for http
  let score = parsed.protocol === 'https:' ? 1 : -2;
  const host = parsed.hostname.toLowerCase();
  const path = `${parsed.pathname}${parsed.search}`.toLowerCase();
  const labelNorm = (label || '').replace(/\s+/g, ' ').trim();

  if (magicLinkRejectionReason(host, parsed.pathname, parsed.search)) return null;
  // Tracking, unsubscribe, policy, and asset paths are never magic links.
  // Hard-reject locally as well as in AI mode so later positive signals (for
  // example a verify-looking path or a long token) cannot resurrect them.
  if (NEGATIVE_PATH.test(path) || NEGATIVE_PATH.test(urlStr)) return null;

  if (
    /\/(?:products?|collections?|articles?|posts?|news|blog|landingpage)(?:\/|$)/i.test(
      parsed.pathname
    ) &&
    !AUTH_ACTION_LABEL.test(labelNorm) &&
    !POSITIVE_SUBJECT.test(subject)
  )
    return null;

  if (
    !AUTH_ACTION_PATH.test(parsed.pathname) &&
    !AUTH_ACTION_LABEL.test(labelNorm) &&
    !POSITIVE_SUBJECT.test(subject)
  )
    return null;

  // Path positive tokens
  if (POSITIVE_PATH.test(parsed.pathname)) {
    score += 5;
  }

  // Query keys
  for (const key of parsed.searchParams.keys()) {
    if (POSITIVE_QUERY_KEYS.test(key)) score += 3;
    // Long opaque values on auth-ish keys
    const val = parsed.searchParams.get(key) || '';
    if (POSITIVE_QUERY_KEYS.test(key) && val.length >= 16) score += 2;
  }

  // Long path segments often encode tokens
  const segments = parsed.pathname.split('/').filter(Boolean);
  for (const seg of segments) {
    if (seg.length >= 20 && /[a-z0-9_-]{20,}/i.test(seg)) score += 2;
  }

  // Anchor text. A label that merely CONTAINS the action word ("Click here to
  // log in") gets +3; a label that STARTS with a strong action ("Confirm email
  // now", "Log in to view") gets the full +4.
  if (
    labelNorm &&
    (POSITIVE_ANCHOR.test(labelNorm) ||
      /^(?:log\s*in|sign\s*in|verify|confirm|activate)\b/i.test(labelNorm))
  )
    score += 4;
  else if (
    labelNorm &&
    /log\s*in|sign\s*in|verify|confirm|activate|continue|magic/i.test(labelNorm)
  )
    score += 3;

  // Subject context boosts all candidates slightly
  if (subject && POSITIVE_SUBJECT.test(subject)) score += 2;
  // …but transactional/bulk subjects strongly penalize magic-link detection.
  if (subject && NEGATIVE_SUBJECT.test(subject)) score -= 8;

  // Verify/confirm/activate links are the email's primary action - boost them
  // so a token-heavy "Sign in" anchor elsewhere in the body cannot outrank the
  // actual verify button (verify emails often contain both).
  const kind = classifyKind(urlStr, labelNorm);
  if (kind === 'verify') score += 4;
  else if (kind === 'signin') score += 1;

  // Tracking redirect hosts without path signal stay low
  if (/click\.|track\.|email\.|links?\./i.test(host) && score < MAGIC_LINK_SCORE_THRESHOLD) {
    // still allow if query has token-like keys (already counted)
  }

  return { score, host, kind };
}

function collectFromHtml(html: string): Array<{ url: string; label: string }> {
  const out: Array<{ url: string; label: string }> = [];
  if (!html) return out;

  // <a href="...">label</a> - quoted OR unquoted href values. Unquoted hrefs
  // (no " or ' around the URL) are common in real sender HTML and were
  // previously invisible: the bare-URL fallback below scans tag-stripped text,
  // where attributes no longer exist.
  //
  // The walk is linear and lives in html-scan.ts. The regex this replaces
  // (`/<a\b[^>]*\bhref…[^>]*>([\s\S]*?)<\/a>/gi`) was CUBIC on a body of
  // unterminated `<a` tags: measured 18 KB -> 30.6 s of a blocked thread. This
  // runs on EVERY ingested message, in the service worker, so one crafted
  // email could stall the whole background pipeline.
  for (const anchor of parseAnchors(html)) {
    if (!anchor.hasHref || !anchor.href) continue;
    const label = stripTags(anchor.innerHtml).slice(0, 80);
    out.push({ url: anchor.href, label });
  }

  // Bare URLs in HTML text (after stripping tags)
  const plain = stripTags(html);
  const bareRe = /https?:\/\/[^\s<>"')}\]]+/gi;
  for (let b = bareRe.exec(plain); b !== null; b = bareRe.exec(plain)) {
    out.push({ url: b[0], label: '' });
  }

  return out;
}

function collectFromPlain(text: string): Array<{ url: string; label: string }> {
  const out: Array<{ url: string; label: string }> = [];
  if (!text) return out;
  const bareRe = /https?:\/\/[^\s<>"')}\]]+/gi;
  for (let m = bareRe.exec(text); m !== null; m = bareRe.exec(text)) {
    out.push({ url: m[0], label: '' });
  }
  return out;
}

/**
 * A label is "better" than the current one when the current one is just the
 * host (bare URL) or is shorter - used when the same URL appears multiple
 * times with different anchor text.
 */
function isBetterLabel(candidate: string, current: string, host: string): boolean {
  if (current !== host) return candidate.length > current.length;
  return true;
}

/** Module default; background may set from storage before parse runs. */
let magicLinkDetectionEnabled = true;

export function setMagicLinkDetectionEnabled(enabled: boolean): void {
  magicLinkDetectionEnabled = enabled;
}

/**
 * Extract and rank magic / sign-in links from an email.
 * Returns up to MAGIC_LINK_MAX links with score >= MAGIC_LINK_SCORE_THRESHOLD.
 *
 * `receivedAt` (ms) optionally gates stale emails: verify/confirm links from
 * messages older than MAGIC_LINK_MAX_AGE_MS are usually already expired, so
 * they are dropped instead of surfaced as a dead "one-click sign-in".
 */
export function extractMagicLinks(
  subject: string,
  bodyHtml: string = '',
  bodyPlain: string = '',
  receivedAt?: number
): MagicLink[] {
  if (!magicLinkDetectionEnabled) return [];
  const subj = decodeHtmlEntities(subject || '');

  // Stale-email guard: don't surface links from old messages.
  if (magicLinkIsStale(receivedAt)) return [];

  const raw: Array<{ url: string; label: string }> = [
    ...collectFromHtml(bodyHtml || ''),
    ...collectFromPlain(bodyPlain || ''),
    // Subject rarely has links but include
    ...collectFromPlain(subj),
  ];

  const byUrl = new Map<string, Candidate>();

  for (const item of raw) {
    const url = normalizeUrl(item.url);
    if (!url) continue;
    const scored = scoreUrl(url, item.label, subj);
    if (!scored) continue;
    if (scored.score < MAGIC_LINK_SCORE_THRESHOLD) continue;

    const existing = byUrl.get(url);
    if (!existing || scored.score > existing.score) {
      // Keep the existing label when the higher-scoring duplicate is a bare URL.
      byUrl.set(url, {
        url,
        label: item.label || existing?.label || scored.host,
        score: scored.score,
        host: scored.host,
        kind: scored.kind,
      });
    } else if (existing && item.label && isBetterLabel(item.label, existing.label, existing.host)) {
      existing.label = item.label;
    }
  }

  return Array.from(byUrl.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, MAGIC_LINK_MAX)
    .map((c) => ({
      url: c.url,
      label: c.label || c.host,
      score: c.score,
      host: c.host,
      kind: c.kind,
    }));
}

/**
 * Convenience: first / best magic link, or null.
 * Prefers a verify-kind link over an equally-scored sign-in link (the verify
 * button is the email's primary action and must win tie-breaks).
 */
export function extractBestMagicLink(
  subject: string,
  bodyHtml: string = '',
  bodyPlain: string = '',
  receivedAt?: number
): MagicLink | null {
  const links = extractMagicLinks(subject, bodyHtml, bodyPlain, receivedAt);
  if (links.length === 0) return null;
  const bestScore = links[0].score;
  const tied = links.filter((l) => l.score >= bestScore - 2);
  const verify = tied.find((l) => l.kind === 'verify');
  if (verify) return verify;
  return links[0];
}
