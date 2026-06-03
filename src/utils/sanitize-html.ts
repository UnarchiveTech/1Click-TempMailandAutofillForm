/**
 * Centralized HTML sanitization using DOMPurify.
 * Lazily loads DOMPurify on first use and caches the instance.
 */

let _dompurify: typeof import('dompurify')['default'] | null = null;
let _loading: Promise<void> | null = null;

async function ensureLoaded(): Promise<void> {
  if (_dompurify) return;
  if (_loading) return _loading;
  _loading = import('dompurify').then((m) => {
    _dompurify = m.default;
  });
  return _loading;
}

/**
 * Sanitize HTML to prevent XSS. Returns sanitized HTML string.
 * If DOMPurify hasn't loaded yet, falls back to stripping all tags (safe).
 * Call `await initSanitize()` on component mount to preload.
 */
export function sanitizeHtml(html: string): string {
  if (!_dompurify) return html.replace(/<[^>]*>/g, '');
  return _dompurify.sanitize(html);
}

/**
 * Initialize DOMPurify loading. Call in onMount or at startup.
 * Subsequent calls are no-ops.
 */
export async function initSanitize(): Promise<void> {
  await ensureLoaded();
}
