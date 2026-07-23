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
}

/** Minimum score to treat a URL as a magic/login link. */
export const MAGIC_LINK_SCORE_THRESHOLD = 4;

/** Max links to attach per message. */
export const MAGIC_LINK_MAX = 3;

const POSITIVE_PATH =
  /magic[_-]?link|magiclink|one[_-]?time|onetime|sign[_-]?in|signin|log[_-]?in|login|verify|verification|confirm|confirmation|activate|activation|auth(?:enticate|entication|orize)?|sso|session|callback|token|magic|otp\/link|passwordless|passkey|click[_-]?to[_-]?login|continue|access|join|invite|accept/i;

const POSITIVE_QUERY_KEYS =
  /^(?:token|t|k|key|code|auth|sid|session|magic|ml|verify|confirm|uid|user_id|jwt|access_token|login_token|sso|state|hash)$/i;

const NEGATIVE_PATH =
  /unsubscribe|opt[_-]?out|preference|preferences|list[_-]?manage|list-manage|privacy|terms|tos|policy|cdn\.|static\.|assets?\/|favicon|pixel|track(?:ing)?|open\.gif|click\.gif|beacon|mailto:|tel:|sms:|javascript:/i;

const NEGATIVE_HOST = /^(?:www\.)?(?:facebook|twitter|x|instagram|linkedin|youtube|tiktok)\.com$/i;

const POSITIVE_ANCHOR =
  /^(?:log\s*in|sign\s*in|sign\s*up|verify(?:\s+email)?|confirm(?:\s+email|\s+account)?|activate|continue|access|open|click\s+here|get\s+started|join|accept\s+invite|reset\s+password|set\s+password|view\s+(?:email|message)|authenticate)$/i;

const POSITIVE_SUBJECT =
  /magic\s*link|sign\s*in|log\s*in|verify\s*(?:your\s*)?email|confirm\s*(?:your\s*)?(?:email|account)|one[-\s]?time|passwordless|click\s+to\s+(?:sign|log)\s*in/i;

interface Candidate {
  url: string;
  label: string;
  score: number;
  host: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(Number.parseInt(h, 16)));
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize URL: decode entities, trim trailing punctuation. */
export function normalizeUrl(raw: string): string | null {
  let u = decodeEntities(raw.trim());
  // Strip wrapping punctuation common in plain text
  u = u.replace(/^[<(["']+/, '').replace(/[>)\],"'.!?;:]+$/g, '');
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
    return null;
  }
}

function scoreUrl(
  urlStr: string,
  label: string,
  subject: string
): { score: number; host: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return null;
  }

  // Prefer https; slight penalty for http
  let score = parsed.protocol === 'https:' ? 1 : -2;
  const host = parsed.hostname.toLowerCase();
  const path = `${parsed.pathname}${parsed.search}`.toLowerCase();
  const labelNorm = (label || '').replace(/\s+/g, ' ').trim();

  if (NEGATIVE_HOST.test(host)) return null;
  if (NEGATIVE_PATH.test(path) || NEGATIVE_PATH.test(urlStr)) {
    score -= 8;
  }

  // Path / full-url positive tokens
  if (POSITIVE_PATH.test(path) || POSITIVE_PATH.test(urlStr)) {
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

  // Anchor text
  if (labelNorm && POSITIVE_ANCHOR.test(labelNorm)) score += 4;
  else if (
    labelNorm &&
    /log\s*in|sign\s*in|verify|confirm|activate|continue|magic/i.test(labelNorm)
  )
    score += 3;

  // Subject context boosts all candidates slightly
  if (subject && POSITIVE_SUBJECT.test(subject)) score += 2;

  // Tracking redirect hosts without path signal stay low
  if (/click\.|track\.|email\.|links?\./i.test(host) && score < 4) {
    // still allow if query has token-like keys (already counted)
  }

  return { score, host };
}

function collectFromHtml(html: string): Array<{ url: string; label: string }> {
  const out: Array<{ url: string; label: string }> = [];
  if (!html) return out;

  // <a href="...">label</a>
  const aRe = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = aRe.exec(html); m !== null; m = aRe.exec(html)) {
    const href = m[2];
    const label = stripTags(m[3] || '').slice(0, 80);
    out.push({ url: href, label });
  }

  // Bare URLs in HTML text (after stripping tags)
  const plain = stripTags(html);
  const bareRe = /https?:\/\/[^\s<>"')\]]+/gi;
  for (let b = bareRe.exec(plain); b !== null; b = bareRe.exec(plain)) {
    out.push({ url: b[0], label: '' });
  }

  return out;
}

function collectFromPlain(text: string): Array<{ url: string; label: string }> {
  const out: Array<{ url: string; label: string }> = [];
  if (!text) return out;
  const bareRe = /https?:\/\/[^\s<>"')\]]+/gi;
  for (let m = bareRe.exec(text); m !== null; m = bareRe.exec(text)) {
    out.push({ url: m[0], label: '' });
  }
  return out;
}

/**
 * Extract and rank magic / sign-in links from an email.
 * Returns up to MAGIC_LINK_MAX links with score >= MAGIC_LINK_SCORE_THRESHOLD.
 */
export function extractMagicLinks(
  subject: string,
  bodyHtml: string = '',
  bodyPlain: string = ''
): MagicLink[] {
  const subj = decodeEntities(subject || '');
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
      byUrl.set(url, {
        url,
        label: item.label || scored.host,
        score: scored.score,
        host: scored.host,
      });
    } else if (existing && item.label && !existing.label) {
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
    }));
}

/** Convenience: first / best magic link, or null. */
export function extractBestMagicLink(
  subject: string,
  bodyHtml: string = '',
  bodyPlain: string = ''
): MagicLink | null {
  const links = extractMagicLinks(subject, bodyHtml, bodyPlain);
  return links[0] || null;
}
