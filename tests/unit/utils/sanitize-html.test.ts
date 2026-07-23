import { describe, expect, test } from 'bun:test';
import { escapeHtmlText, initSanitize, sanitizeHtml } from '@/utils/sanitize-html.js';

describe('escapeHtmlText', () => {
  test('escapes plain text before it is wrapped in HTML containers', () => {
    expect(escapeHtmlText('<img src=x onerror=alert(1)> & "quote"')).toBe(
      '&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quote&quot;'
    );
  });
});

describe('sanitizeHtml', () => {
  test('strips HTML tags when DOMPurify is not yet loaded', () => {
    const raw = '<p>Hello <strong>World</strong> <script>alert(1)</script></p>';
    // Since DOMPurify is not loaded, it falls back to tag stripping regex
    const sanitized = sanitizeHtml(raw);
    expect(sanitized).toContain('Hello World alert(1)');
    expect(sanitized).not.toContain('<p>');
  });

  describe('with DOMPurify loaded', () => {
    test('preloads DOMPurify successfully', async () => {
      await initSanitize();
    });

    test('decodes and unblocks Guerrilla Mail proxy image resources', () => {
      const raw =
        '<img src="https://www.guerrillamail.com/res.php?r=1&amp;n=img&amp;q=https%3A%2F%2Fexample.com%2Flogo.png" />';
      const sanitized = sanitizeHtml(raw);
      expect(sanitized).toContain('src="https://example.com/logo.png"');

      const rawRawAmp = '<img src="/res.php?r=1&n=img&q=https%3A%2F%2Fexample.org%2Flogo2.png" />';
      const sanitizedRawAmp = sanitizeHtml(rawRawAmp);
      expect(sanitizedRawAmp).toContain('src="https://example.org/logo2.png"');
    });

    test('sanitizes HTML properly after DOMPurify is loaded', () => {
      const raw = '<p>Hello <strong>World</strong><script>alert(1)</script></p>';
      const sanitized = sanitizeHtml(raw);
      expect(sanitized).toContain('<p>Hello <strong>World</strong></p>');
      expect(sanitized).not.toContain('<script>');
    });

    test('blocks style attributes completely', () => {
      const raw =
        '<div style="color: red; background-image: url(https://tracker.com/pixel.png)">Content</div>';
      const sanitized = sanitizeHtml(raw);
      expect(sanitized).toContain('<div>Content</div>');
      expect(sanitized).not.toContain('style');
    });

    test('forces rel="noopener noreferrer" and target="_blank" on links', () => {
      const raw = '<a href="https://example.com">Link</a>';
      const sanitized = sanitizeHtml(raw);
      expect(sanitized).toContain('rel="noopener noreferrer"');
      expect(sanitized).toContain('target="_blank"');
    });
  });
});
