/**
 * Centralized HTML sanitization using DOMPurify.
 * Lazily loads DOMPurify on first use and caches the instance.
 */

let _dompurify: typeof import('dompurify')['default'] | null = null;
let _loading: Promise<void> | null = null;

export function escapeHtmlText(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] || m
  );
}

/**
 * Resolve a Window for DOMPurify factory init.
 * Browser: use real window. Node tests: JSDOM via createRequire (hidden from Vite
 * so the browser bundle never pulls in node:module).
 */
async function resolveDomWindow(): Promise<Window | null> {
  if (typeof window !== 'undefined' && window.document) {
    return window;
  }
  // Node / bun test only - @vite-ignore keeps this out of the extension graph
  const isNode =
    typeof process !== 'undefined' &&
    typeof (process as { versions?: { node?: string } }).versions?.node === 'string';
  if (!isNode) return null;
  try {
    const nodeModule = await import(/* @vite-ignore */ 'node:module');
    const requireFn = nodeModule.createRequire(import.meta.url);
    const { JSDOM } = requireFn('jsdom') as {
      JSDOM: new (html: string) => { window: Window };
    };
    return new JSDOM('').window;
  } catch {
    return null;
  }
}

async function ensureLoaded(): Promise<void> {
  if (_dompurify) return;
  if (_loading) return _loading;
  _loading = (async () => {
    try {
      const m = await import('dompurify');
      let purify = m.default;
      // Factory build needs a Window; UMD/default may already expose .sanitize
      if (typeof purify === 'function' && !purify.sanitize) {
        const win = await resolveDomWindow();
        if (!win) {
          // No DOM (e.g. service worker) - strip-tags fallback in sanitizeHtml
          return;
        }
        // DOMPurify's WindowLike is a Pick of globalThis - cast is safe for real Window / JSDOM
        purify = purify(win as unknown as import('dompurify').WindowLike);
      }
      _dompurify = purify;
      _dompurify.addHook('afterSanitizeAttributes', (node) => {
        if (node.tagName === 'A') {
          node.setAttribute('rel', 'noopener noreferrer');
          node.setAttribute('target', '_blank');
        }
      });
    } catch {
      _dompurify = null;
    }
  })();
  return _loading;
}

/**
 * Sanitize HTML to prevent XSS. Returns sanitized HTML string.
 * If DOMPurify hasn't loaded yet, falls back to stripping all tags (safe).
 * Call `await initSanitize()` on component mount to preload.
 */
export function sanitizeHtml(html: string): string {
  if (!html) return '';

  // Unblock Guerrilla Mail proxy image resources (res.php) by decoding the original URLs from the 'q' parameter.
  // Handles both standard double/single quotes and HTML-encoded &quot; quotes.
  let unblockedHtml = html;

  // Match "/res.php?r=1&amp;n=img&amp;q=..." or "/res.php?r=1&n=img&q=..."
  const proxyRegex =
    /("|&quot;|')(?:\/|https?:\/\/(?:www\.)?guerrillamail(?:block)?\.(?:com|info|biz|de|net|org|la)\/)?res\.php\?r=1&amp;n=[a-z]+&amp;q=([^"'\s&]+)(?:&amp;[^"'\s>]*)?\1/gi;
  unblockedHtml = unblockedHtml.replace(proxyRegex, (match, quote, encodedUrl) => {
    try {
      const decodedUrl = decodeURIComponent(encodedUrl);
      return `${quote}${decodedUrl}${quote}`;
    } catch {
      return match;
    }
  });

  // Second pass regex for cases where the URL params might have different encoding or structure (e.g. using standard & instead of &amp;)
  const proxyRegexRawAmp =
    /("|&quot;|')(?:\/|https?:\/\/(?:www\.)?guerrillamail(?:block)?\.(?:com|info|biz|de|net|org|la)\/)?res\.php\?r=1&n=[a-z]+&q=([^"'\s&]+)(?:&[^"'\s>]*)?\1/gi;
  unblockedHtml = unblockedHtml.replace(proxyRegexRawAmp, (match, quote, encodedUrl) => {
    try {
      const decodedUrl = decodeURIComponent(encodedUrl);
      return `${quote}${decodedUrl}${quote}`;
    } catch {
      return match;
    }
  });

  if (!_dompurify) {
    return unblockedHtml.replace(/<[^>]*>/g, '');
  }

  return _dompurify.sanitize(unblockedHtml, {
    ALLOWED_TAGS: [
      'a',
      'b',
      'br',
      'div',
      'em',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'hr',
      'img',
      'li',
      'ol',
      'p',
      'span',
      'strong',
      'table',
      'tbody',
      'td',
      'th',
      'thead',
      'tr',
      'ul',
      'pre',
      'code',
      'blockquote',
      // Common email HTML
      'u',
      'i',
      's',
      'sub',
      'sup',
      'center',
      'font',
      'section',
      'article',
      'header',
      'footer',
      'main',
      'figure',
      'figcaption',
      'picture',
      'source',
      'colgroup',
      'col',
      'caption',
      'tbody',
      'tfoot',
    ],
    ALLOWED_ATTR: [
      'href',
      'src',
      'alt',
      'title',
      'width',
      'height',
      'target',
      'rel',
      'class',
      'colspan',
      'rowspan',
      'align',
      'valign',
      'cellpadding',
      'cellspacing',
      'bgcolor',
      'color',
      'face',
      'size',
      'border',
      'role',
      'dir',
    ],
    // Inline style from untrusted mail is a XSS/exfil surface — strip it.
    // Layout is recovered via .email-body CSS in MessageDetail.
    FORBID_ATTR: ['style'],
    ALLOWED_URI_REGEXP: /^(?:https?|mailto|cid|data):/i,
  });
}

/**
 * Initialize DOMPurify loading. Call in onMount or at startup.
 * Subsequent calls are no-ops.
 */
export async function initSanitize(): Promise<void> {
  await ensureLoaded();
}

/**
 * Extract safe plain text from an HTML string.
 * Uses DOMParser (DOM-backed) instead of regex tag stripping to avoid
 * producing executable text from <script> bodies or similar injections.
 * Falls back gracefully if DOMParser is unavailable (e.g. in service workers).
 */
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  try {
    if (typeof DOMParser !== 'undefined') {
      return new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
    }
  } catch {
    // DOMParser not available (e.g. background service worker)
  }
  // Fallback: strip tags with regex (safe enough when DOMParser is absent)
  return html.replace(/<[^>]*>/g, '');
}
