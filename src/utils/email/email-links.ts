/**
 * Email link extraction - collects ALL http(s) links from a message body,
 * not just the ranked magic links. Used by the MailView "Links in this email"
 * section.
 *
 * Sources:
 *  - `body_html`: <a href="...">anchor text</a> (label = trimmed anchor text)
 *    plus bare URLs that appear outside anchors.
 *  - `body_plain` / `body`: bare http(s) URLs.
 *
 * Output is deduped by URL (first-seen order preserved) and excludes
 * non-http(s) schemes (mailto:/tel:/data: etc.). Relative hrefs are dropped -
 * provider bodies are absolute, and resolving against an unknown base would be
 * misleading.
 */

import { decodeHtmlEntities } from './decode-html-entities.js';
import { findTagEnd, parseAnchors, stripAnchors } from './html-scan.js';
import { escapeHtmlText } from './sanitize-html.js';

export interface EmailLink {
  url: string;
  /** Anchor text when the link came from an <a> tag, else the host. */
  label: string;
  /** eTLD+1-ish host for display (e.g. `example.com`). */
  host: string;
}

/** Classify the destination host, never the sender-controlled link label. */
export function isSocialMediaLink(link: EmailLink): boolean {
  try {
    const host = new URL(link.url).hostname.toLowerCase();
    return SOCIAL_LINK_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

const SOCIAL_LINK_DOMAINS = [
  'facebook.com',
  'fb.com',
  'fb.me',
  'instagram.com',
  'threads.net',
  'threads.com',
  'twitter.com',
  'x.com',
  't.co',
  'linkedin.com',
  'lnkd.in',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'pinterest.com',
  'pin.it',
  'reddit.com',
  'redd.it',
  'snapchat.com',
  'discord.com',
  'discord.gg',
  'twitch.tv',
  'bsky.app',
  'mastodon.social',
  'telegram.org',
  't.me',
  'whatsapp.com',
  'wa.me',
  'weibo.com',
] as const;

/** Match bare http(s) URLs in text (stop at whitespace/quotes/angle brackets). */
const URL_RE = /https?:\/\/[^\s<>"']+/gi;

/** Normalize a candidate URL - null when it isn't a usable http(s) link. */
function normalizeUrl(raw: string): string | null {
  // Strip trailing punctuation/quote characters that aren't part of the URL.
  // Includes closing brackets when a URL appears inside [brackets] or {braces},
  // and common trailing quotation marks from HTML-encoded email bodies.
  const trimmed = raw.trim().replace(/[),.;:!?\]}'"»›\u201D\u2019]+$/, '');
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') || u.host || url;
  } catch {
    return url;
  }
}

/**
 * Extract every http(s) link from a message's body sources.
 * Returns deduped links in first-seen order. Anchor-text labels are
 * prioritized over bare-URL hosts.
 */
export function extractEmailLinks(input: {
  bodyHtml?: string;
  bodyPlain?: string;
  body?: string;
}): EmailLink[] {
  const html = input.bodyHtml || '';
  const text = input.bodyPlain || input.body || '';

  const seen = new Set<string>();
  const out: EmailLink[] = [];

  const push = (raw: string, label?: string) => {
    // The source strings are HTML (anchor attributes / rendered text), so the
    // matched URL is entity-encoded (e.g. `&amp;` for `&`). Decode ONCE so the
    // copied URL and dedupe key are the real URL, not the encoded spelling.
    const url = normalizeUrl(decodeHtmlEntities(raw));
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({
      url,
      label: (label || '').trim().slice(0, 200) || hostOf(url),
      host: hostOf(url),
    });
  };

  // 1) Anchors: one LINEAR walk (see html-scan.ts for why this is not a
  //    regex: the previous single-regex version was cubic on a body of
  //    unterminated `<a` tags - 126 s on 28.8 KB - and ran synchronously
  //    inside MailView's `$derived` over an attacker-controlled body).
  const anchors = parseAnchors(html);
  const anchorLabelByHref = new Map<string, string>();
  for (const anchor of anchors) {
    if (!anchor.hasHref) continue;
    const label = decodeHtmlEntities(
      anchor.innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    ).trim();
    if (label) anchorLabelByHref.set(anchor.href.trim(), label);
    push(anchor.href, label);
  }
  // Drop the anchor spans so their hrefs are not double-counted as bare URLs.
  const htmlWithoutAnchors = stripAnchors(html, anchors);

  // 2) Bare URLs in the HTML (outside anchors) and in the plain text.
  for (const raw of htmlWithoutAnchors.match(URL_RE) || []) {
    const label = anchorLabelByHref.get(raw.trim());
    push(raw, label);
  }
  for (const raw of text.match(URL_RE) || []) {
    push(raw);
  }

  return out;
}

/** Convenience: extract links from an Email-shaped object. */
export function extractLinksFromEmail(m: {
  body_html?: string;
  body_plain?: string;
  body?: string;
}): EmailLink[] {
  return extractEmailLinks({
    bodyHtml: m.body_html,
    bodyPlain: m.body_plain,
    body: m.body,
  });
}

/** Classification never downloads a resource. Unknown URLs remain ordinary links. */
export function splitEmailLinks(message: {
  body_html?: string;
  body_plain?: string;
  body?: string;
  attachments?: { downloadUrl?: string | null }[];
}): { links: EmailLink[]; media: EmailLink[] } {
  const embedded = new Set<string>();
  const html = message.body_html || '';
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor);
    if (start === -1) break;
    const end = findTagEnd(html, start);
    if (end === -1) break;
    const tag = html.slice(start, end + 1);
    if (/^<\s*(?:img|audio|video|source)\b/i.test(tag)) {
      for (const match of tag.matchAll(
        /\s(src|poster|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
      )) {
        const value = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? '');
        const sources = match[1].toLowerCase() === 'srcset' ? value.match(URL_RE) || [] : [value];
        for (const source of sources) {
          const url = normalizeUrl(source);
          if (url) embedded.add(url);
        }
      }
    }
    cursor = end + 1;
  }
  const attachments = new Set(
    (message.attachments || []).map((item) => item.downloadUrl).filter(Boolean)
  );
  const all = new Map(extractLinksFromEmail(message).map((link) => [link.url, link]));
  for (const url of embedded)
    if (!all.has(url)) all.set(url, { url, host: hostOf(url), label: hostOf(url) });
  const links: EmailLink[] = [];
  const media: EmailLink[] = [];
  for (const link of all.values()) {
    if (attachments.has(link.url)) continue;
    const mediaPath =
      /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp|apng|mp3|m4a|aac|wav|ogg|oga|flac|mp4|webm|mov|m4v|ogv)$/i.test(
        new URL(link.url).pathname
      );
    (embedded.has(link.url) || mediaPath ? media : links).push(link);
  }
  return { links, media };
}

/**
 * Linkify bare http(s) URLs inside already-sanitized email HTML - URLs that
 * appear in the body text but were NOT wrapped in an <a> tag by the sender.
 *
 * Existing anchors are preserved untouched (their hrefs are never re-wrapped
 * or altered). Non-anchor tags are preserved verbatim too - a URL inside an
 * attribute value (e.g. `<img src="https://…">`) must never be wrapped,
 * because injecting `<a>` markup into an attribute corrupts the tag. Output
 * is safe for the shadow-DOM EmailBody: the hrefs go through the same
 * `normalizeUrl` http(s)-only gate and get hardcoded
 * `target="_blank" rel="noopener noreferrer"`. The URL text is HTML-escaped
 * so the injected markup can't break out of the wrapping tag.
 */
export function linkifyHtmlBareUrls(html: string): string {
  if (!html || !URL_RE.test(html)) return html;
  URL_RE.lastIndex = 0;

  // Walk markup with quote-aware tag boundaries. Regex tag splitting at the
  // first `>` can mistake one inside an attribute value for the end of a tag.
  let output = '';
  let cursor = 0;
  let anchorDepth = 0;
  while (cursor < html.length) {
    const tagStart = html.indexOf('<', cursor);
    if (tagStart === -1) {
      const text = html.slice(cursor);
      output += anchorDepth === 0 ? linkifyText(text) : text;
      break;
    }
    const text = html.slice(cursor, tagStart);
    output += anchorDepth === 0 ? linkifyText(text) : text;
    const tagEnd = findTagEnd(html, tagStart);
    if (tagEnd === -1) {
      output += html.slice(tagStart);
      break;
    }
    const tag = html.slice(tagStart, tagEnd + 1);
    const anchorTag = /^<\s*(\/?)\s*a(?:\s|\/?>)/i.exec(tag);
    if (anchorTag?.[1]) anchorDepth = Math.max(0, anchorDepth - 1);
    output += tag;
    if (anchorTag && !anchorTag[1] && !/\/\s*>$/.test(tag)) anchorDepth++;
    cursor = tagEnd + 1;
  }
  return output;
}

function linkifyText(text: string): string {
  return text.replace(/https?:\/\/[^\s<>"']+/gi, (raw) => {
    // `raw` is text inside already-sanitized HTML, so it's entity-encoded.
    // Decode it to the REAL URL first (href + visible text), then escape once
    // for the markup - otherwise `&amp;` would be double-escaped to `&amp;amp;`,
    // mangling both the link text and the destination.
    const url = normalizeUrl(decodeHtmlEntities(raw));
    if (!url) return raw;
    const text = escapeHtmlText(decodeHtmlEntities(raw));
    return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" class="email-body-link">${text}</a>`;
  });
}

/** Escape for use inside a double-quoted HTML attribute. */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
