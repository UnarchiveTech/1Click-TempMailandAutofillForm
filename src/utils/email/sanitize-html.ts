/**
 * Centralized HTML sanitization using DOMPurify and css-tree.
 * Lazily loads both parsers on first use and caches their module instances.
 */

import type { CssNode } from 'css-tree';
import { browser } from 'wxt/browser';
import { logError } from '@/utils/logger.js';
import { isObjectRecord } from '@/utils/storage/storage-shape-guards.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';

let _dompurify: typeof import('dompurify')['default'] | null = null;
let _cssTree: typeof import('css-tree') | null = null;
let _loading: Promise<void> | null = null;

/**
 * Dark-mode neutralization for email bodies: when the extension theme is dark,
 * emails that hardcode light backgrounds (white / very-light fills) become
 * invisible text-on-white blocks. This pass rewrites, at sanitize time:
 *   • light `background` / `background-color` values  → `transparent`
 *   • dark `color` values                           → `inherit` (theme on-surface)
 *   • light `bgcolor` attributes (table/td)         → removed
 *   • dark `<font color>` attributes                → removed (inherit)
 * Layout-affecting properties (padding, width, margins, display, …) are never
 * touched, and light text / dark backgrounds are left alone. Colors are
 * detected by luminance (hex, rgb()/rgba(), hsl()/hsla(), common named colors).
 */
const LIGHT_BG_LUMINANCE_THRESHOLD = 0.78;
const DARK_TEXT_LUMINANCE_THRESHOLD = 0.2;

/** Common named CSS colors used for email backgrounds/text (RGB values). */
const NAMED_CSS_COLORS: Record<string, [number, number, number]> = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  lightgray: [211, 211, 211],
  lightgrey: [211, 211, 211],
  darkgray: [169, 169, 169],
  darkgrey: [169, 169, 169],
  dimgray: [105, 105, 105],
  dimgrey: [105, 105, 105],
  gainsboro: [220, 220, 220],
  whitesmoke: [245, 245, 245],
  snow: [255, 250, 250],
  floralwhite: [255, 250, 240],
  ivory: [255, 255, 240],
  beige: [245, 245, 220],
  cornsilk: [255, 248, 220],
  linen: [250, 240, 230],
  honeydew: [240, 255, 240],
  mintcream: [245, 255, 250],
  lavender: [230, 230, 250],
  lavenderblush: [255, 240, 245],
  ghostwhite: [248, 248, 255],
  aliceblue: [240, 248, 255],
  azure: [240, 255, 255],
  seashell: [255, 245, 238],
  oldlace: [253, 245, 230],
  antiquewhite: [250, 235, 215],
  mistyrose: [255, 228, 225],
  peachpuff: [255, 218, 185],
  moccasin: [255, 228, 181],
  papayawhip: [255, 239, 213],
  lightyellow: [255, 255, 224],
  lightgoldenrodyellow: [250, 250, 210],
  lightcyan: [224, 255, 255],
  paleturquoise: [175, 238, 238],
  lightblue: [173, 216, 230],
  lightsteelblue: [176, 196, 222],
  powderblue: [176, 224, 230],
  thistle: [216, 191, 216],
  plum: [221, 160, 221],
  orchid: [218, 112, 214],
  pink: [255, 192, 203],
  lightpink: [255, 182, 193],
  gold: [255, 215, 0],
  khaki: [240, 230, 140],
  palegoldenrod: [238, 232, 170],
};

function clampChannel(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hPrime = ((((h % 360) + 360) % 360) / 60) % 6;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hPrime < 1) [r, g, b] = [c, x, 0];
  else if (hPrime < 2) [r, g, b] = [x, c, 0];
  else if (hPrime < 3) [r, g, b] = [0, c, x];
  else if (hPrime < 4) [r, g, b] = [0, x, c];
  else if (hPrime < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [clampChannel((r + m) * 255), clampChannel((g + m) * 255), clampChannel((b + m) * 255)];
}

/** Parse a tolerant CSS color → [r,g,b] or null (for layout-safe comparison). */
function parseCssColor(value: string): [number, number, number] | null {
  const v = value.trim().toLowerCase();
  if (!v || v === 'transparent' || v === 'currentcolor' || v === 'inherit' || v === 'none') {
    return null;
  }
  // #rgb / #rgba / #rrggbb / #rrggbbaa
  let m = v.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (m) {
    let hex = m[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  // rgb()/rgba() - tolerates comma or space syntax
  m = v.match(/^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)/);
  if (m)
    return [clampChannel(Number(m[1])), clampChannel(Number(m[2])), clampChannel(Number(m[3]))];
  m = v.match(/^hsla?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%/);
  if (m) return hslToRgb(Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100);
  if (NAMED_CSS_COLORS[v]) return NAMED_CSS_COLORS[v];
  return null;
}

function colorLuminance(rgb: [number, number, number]): number {
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

function isLightColor(value: string): boolean {
  const rgb = parseCssColor(value);
  return rgb !== null && colorLuminance(rgb) >= LIGHT_BG_LUMINANCE_THRESHOLD;
}

function isDarkColor(value: string): boolean {
  const rgb = parseCssColor(value);
  return rgb !== null && colorLuminance(rgb) <= DARK_TEXT_LUMINANCE_THRESHOLD;
}

/** Rewrite a `background`/`background-color` value: single color or a shorthand
 * whose leading token is a light color → `transparent` (layout/url kept). */
function neutralizeBackgroundValue(value: string): string {
  const v = value.trim();
  if (!v) return v;
  if (parseCssColor(v) !== null) return isLightColor(v) ? 'transparent' : v;
  const m = v.match(/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-zA-Z]+)\b(.*)$/);
  if (m && isLightColor(m[1])) {
    const rest = m[2].trim();
    return rest ? `transparent ${rest}` : 'transparent';
  }
  return v;
}

/** When dark mode is active, neutralize hardcoded light backgrounds / dark text
 * on a single element so email content stays readable on the dark surface. */
function neutralizeLightStyle(node: Element): void {
  try {
    // Old-school <table>/<td bgcolor="#ffffff"> - drop the fill (transparent).
    if (node.hasAttribute('bgcolor') && isLightColor(node.getAttribute('bgcolor') || '')) {
      node.removeAttribute('bgcolor');
    }
    // <font color="#000000"> - remove so text inherits the theme's color.
    if (node.tagName === 'FONT' && node.hasAttribute('color')) {
      const c = node.getAttribute('color') || '';
      const rgb = parseCssColor(c);
      if (rgb !== null && colorLuminance(rgb) <= DARK_TEXT_LUMINANCE_THRESHOLD) {
        node.removeAttribute('color');
      }
    }
    if (!node.hasAttribute('style')) return;
    const styleStr = node.getAttribute('style') || '';
    let out = '';
    let cursor = 0;
    let rewritten = false;
    const declRe = /([a-zA-Z-]+)\s*:\s*([^;]+);?/g;
    let m: RegExpExecArray | null;
    for (;;) {
      m = declRe.exec(styleStr);
      if (!m) break;
      const prop = m[1].trim().toLowerCase();
      const value = m[2].trim();
      out += styleStr.slice(cursor, m.index);
      if (prop === 'background' || prop === 'background-color') {
        const next = neutralizeBackgroundValue(value);
        if (next !== value) rewritten = true;
        out += `${m[1].trim()}: ${next};`;
      } else if (prop === 'color') {
        const next = isDarkColor(value) ? 'inherit' : value;
        if (next !== value) rewritten = true;
        out += `${m[1].trim()}: ${next};`;
      } else {
        out += m[0];
      }
      cursor = m.index + m[0].length;
    }
    out += styleStr.slice(cursor);
    if (rewritten) node.setAttribute('style', out);
  } catch {
    /* ignore */
  }
}

/** Set while sanitizing with `darkMode: true` so the shared DOMPurify hook can
 * neutralize hardcoded light colors (the hook is registered once globally). */
let activeDarkMode = false;

/**
 * CSS properties that let an email overlay or hijack the whole extension UI
 * (fixed-position phishing layers, full-viewport sheets, click-stealing).
 * Removed from every inline `style` attribute during sanitization.
 */
const FORBIDDEN_CSS_PROPS = [
  'position',
  'z-index',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'visibility',
  'pointer-events',
  'cursor',
  'opacity',
  'transform',
  'animation',
  'transition',
  'filter',
  'backdrop-filter',
  'clip',
  'clip-path',
];

/**
 * Document-level tags that must never survive into the email body. A <style> or
 * <link rel="stylesheet"> from an email would apply GLOBALLY to the extension
 * (restyling or hiding the whole app), and <meta>/<base>/<html>/<head>/<body>
 * wrappers leak document structure into the rendered fragment.
 *
 * Note: when `allowStyleBlocks` is on, <style> blocks are extracted and
 * sanitized BEFORE this regex runs (see sanitizeStyleBlockCss), so the regex
 * only ever sees (and strips) residual/unclosed <style> tags.
 */
const DOC_LEVEL_TAG_RE =
  /<(?:style|script)\b[^>]*>[\s\S]*?<\/(?:style|script)\s*>|<!DOCTYPE[^>]*>|<\/?style\b[^>]*>|<\/?script\b[^>]*>|<\/?link\b[^>]*>|<\/?meta\b[^>]*>|<\/?base\b[^>]*>|<\/?title\b[^>]*>|<\/?html\b[^>]*>|<\/?body\b[^>]*>|<head\b[^>]*>[\s\S]*?<\/head\s*>|<\/?head\b[^>]*>/gi;

// ============================================================================
// SAFE SUBSET OF EMAIL <style> BLOCKS
// ============================================================================
// Email bodies are rendered inside an OPEN SHADOW DOM (EmailBody.svelte), so a
// <style> element injected into the shadow root is scoped to that shadow tree:
// its rules can never restyle/hide the extension UI. That makes a sanitized
// <style> block safe to render - BUT only in the shadow-DOM path (MailView).
// Light-DOM consumers (message window, print) keep stripping style blocks.
//
// The CSS itself is still filtered (fail-closed): only layout/content rules
// survive. Everything that could (a) load external resources (tracking pixels,
// exfiltration), (b) overlay/hijack clicks, (c) tamper with the app or cascade,
// or (d) target the shadow host is removed.

/** Selectors that target the shadow host or the document root - dropped. */
const FORBIDDEN_STYLE_SELECTOR_RE =
  /(?:^|[\s>+~,:])(?::host(?:-context)?|:root)\b|expression\s*\(/i;

type CssParseContext = 'stylesheet' | 'declarationList';

/** Parse CSS with a standards-aware tokenizer/parser and fail closed on errors. */
function parseCssSafely(source: string, context: CssParseContext): CssNode | null {
  const cssTree = _cssTree;
  if (!cssTree) return null;
  let hadParseError = false;
  try {
    const ast = cssTree.parse(source, {
      context,
      positions: false,
      onParseError: () => {
        hadParseError = true;
      },
    }) as CssNode;
    return hadParseError ? null : ast;
  } catch {
    return null;
  }
}

function cssChildren(node: CssNode | undefined): CssNode[] {
  return node?.children?.toArray() ?? [];
}

/** Normalize a CSS identifier, including escaped spellings, before policy checks. */
function normalizeCssIdentifier(value: string): string {
  const cssTree = _cssTree;
  if (!cssTree) return '';
  try {
    return cssTree.ident.decode(value).trim().toLowerCase();
  } catch {
    return '';
  }
}

/** Remove URL and image-producing functions regardless of CSS spelling or nesting. */
function containsExternalImageResource(value: CssNode): boolean {
  const cssTree = _cssTree;
  if (!cssTree) return true;
  let blocked = false;
  cssTree.walk(value, (node) => {
    if (node.type === 'Url') {
      blocked = true;
      return;
    }
    if (node.type !== 'Function' || !node.name) return;
    const name = normalizeCssIdentifier(node.name).replace(/^-(?:webkit|moz|ms|o)-/, '');
    if (
      name === 'url' ||
      name === 'image-set' ||
      name === 'cross-fade' ||
      name === 'image' ||
      name === 'src' ||
      name === 'expression'
    ) {
      blocked = true;
    }
  });
  return blocked;
}

function normalizeCssProperty(prop: string): string {
  return normalizeCssIdentifier(prop).replace(/^-(?:webkit|moz|ms|o)-/, '');
}

/**
 * Sanitize a single `prop: value` declaration. Returns the sanitized
 * declaration (with original casing) or '' when it must be dropped.
 * When `darkMode` is set, hardcoded light backgrounds → `transparent` and dark
 * text → `inherit`, matching the inline-style neutralization pass so style
 * blocks behave identically to inline styles on dark themes.
 */
function sanitizeCssDeclaration(node: CssNode, darkMode = false): string {
  const cssTree = _cssTree;
  if (!cssTree) return '';
  if (node.type !== 'Declaration' || !node.property || !node.value) return '';
  const prop = normalizeCssIdentifier(node.property);
  const norm = normalizeCssProperty(node.property);
  if (!prop || prop.startsWith('--') || norm === 'behavior') return '';
  if (FORBIDDEN_CSS_PROPS.includes(norm) || containsExternalImageResource(node.value)) return '';
  let value = cssTree.generate(node.value).trim();
  if (!value) return '';
  if (darkMode && (norm === 'background' || norm === 'background-color' || norm === 'color')) {
    if (norm === 'color') {
      const next = isDarkColor(value) ? 'inherit' : value;
      if (next !== value) return `${prop}: ${next}`;
    } else {
      const next = neutralizeBackgroundValue(value);
      if (next !== value) return `${prop}: ${next}`;
    }
  }
  if (node.important) value += ' !important';
  return `${prop}: ${value}`;
}

function selectorTargetsExtension(node: CssNode): boolean {
  const cssTree = _cssTree;
  if (!cssTree) return true;
  let forbidden = false;
  cssTree.walk(node, (child) => {
    if (child.type !== 'PseudoClassSelector' || !child.name) return;
    const name = normalizeCssIdentifier(child.name);
    if (name === 'host' || name === 'host-context' || name === 'root') forbidden = true;
  });
  return forbidden || FORBIDDEN_STYLE_SELECTOR_RE.test(cssTree.generate(node));
}

function sanitizeCssRule(node: CssNode, darkMode: boolean): string {
  if (!node.prelude || !node.block) return '';
  if (selectorTargetsExtension(node.prelude)) return '';
  const cssTree = _cssTree;
  if (!cssTree) return '';
  const selector = cssTree.generate(node.prelude).trim();
  if (!selector) return '';
  const declarations = cssChildren(node.block)
    .map((declaration) => sanitizeCssDeclaration(declaration, darkMode))
    .filter(Boolean);
  return declarations.length ? `${selector} { ${declarations.join('; ')}; }` : '';
}

function sanitizeCssRules(nodes: CssNode[], darkMode: boolean): string[] {
  const cssTree = _cssTree;
  if (!cssTree) return [];
  const out: string[] = [];
  for (const node of nodes) {
    if (node.type === 'Rule') {
      const safeRule = sanitizeCssRule(node, darkMode);
      if (safeRule) out.push(safeRule);
      continue;
    }
    if (node.type !== 'Atrule' || !node.name) continue;
    const name = normalizeCssIdentifier(node.name);
    if (!['media', 'supports'].includes(name) || !node.block) continue;
    const inner = sanitizeCssRules(cssChildren(node.block), darkMode);
    if (!inner.length) continue;
    const prelude = node.prelude ? ` ${cssTree.generate(node.prelude)}` : '';
    out.push(`@${name}${prelude} { ${inner.join(' ')} }`);
  }
  return out;
}

/** Sanitize an inline style attribute using the same parser and declaration policy as style blocks. */
function sanitizeStyleAttribute(style: string, darkMode = false): string {
  const ast = parseCssSafely(style, 'declarationList');
  if (!ast) return '';
  const declarations = cssChildren(ast)
    .map((declaration) => sanitizeCssDeclaration(declaration, darkMode))
    .filter(Boolean)
    .join('; ');
  return declarations ? `${declarations};` : '';
}

/**
 * Sanitize the CSS text inside an email <style> block into a safe subset:
 *
 *   KEPT      - @media rules + plain rules with layout/content declarations
 *   STRIPPED  - @import/@font-face/@keyframes/@page/@layer/etc., url(),
 *               expression(), behavior:, custom properties, overlay/hijack
 *               properties (position, z-index, transform, opacity, …), and
 *               :host / :root selectors.
 *
 * `darkMode` additionally neutralizes hardcoded light backgrounds / dark text
 * (same luminance rules as inline styles) so style-block colors don't paint
 * white boxes on dark themes.
 *
 * Fail-closed: unparseable input yields no rules. Returns '' when nothing
 * survives (callers then drop the <style> block entirely).
 */
export function sanitizeStyleBlockCss(css: string, options?: { darkMode?: boolean }): string {
  if (!css?.trim()) return '';
  const darkMode = options?.darkMode === true;
  const ast = parseCssSafely(css, 'stylesheet');
  if (!ast) return '';
  return sanitizeCssRules(cssChildren(ast), darkMode).join('\n');
}

/**
 * Escape `</style` sequences inside sanitized CSS so the browser's HTML parser
 * can never terminate the injected <style> element early. A `</style` inside a
 * CSS string value (e.g. `content: "</style>"`) would otherwise close the tag
 * mid-block and let the remaining text parse as RAW UNSANITIZED HTML inside the
 * shadow root. `\/` is a valid CSS escape for `/` (inside strings it resolves
 * to `/`), so replacing `</style` → `<\/style` is CSS-semantics-preserving.
 */
function escapeStyleElementText(css: string): string {
  return css.replace(/<\/style/gi, '<\\/style');
}

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
    /* ignore */
    return null;
  }
}

async function ensureLoaded(): Promise<void> {
  if (_dompurify && _cssTree) return;
  if (_loading) return _loading;
  _loading = (async () => {
    try {
      const [m, cssTree] = await Promise.all([import('dompurify'), import('css-tree')]);
      _cssTree = cssTree;
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
        if (node.localName?.toLowerCase() === 'a') {
          node.setAttribute('rel', 'noopener noreferrer');
          node.setAttribute('target', '_blank');
        }
        // Parse and filter every inline declaration. DOMPurify allows the style
        // attribute but does not sanitize CSS URL/image functions for us.
        if (node.hasAttribute('style')) {
          const safeStyle = sanitizeStyleAttribute(
            node.getAttribute('style') || '',
            activeDarkMode
          );
          if (safeStyle) node.setAttribute('style', safeStyle);
          else node.removeAttribute('style');
        }
        // Dark-mode pass: neutralize hardcoded light backgrounds / dark text
        // (gated by the sanitizeHtml({ darkMode }) option).
        if (activeDarkMode) neutralizeLightStyle(node);
        if (node.tagName === 'IMG') {
          const src = node.getAttribute('src') || '';
          const w = (node.getAttribute('width') || '').trim();
          const h = (node.getAttribute('height') || '').trim();
          const style = (node.getAttribute('style') || '').toLowerCase().replace(/\s/g, '');

          const isZeroSize =
            w === '0' ||
            w === '1' ||
            w === '0px' ||
            w === '1px' ||
            h === '0' ||
            h === '1' ||
            h === '0px' ||
            h === '1px';

          const isHiddenStyle =
            style.includes('display:none') ||
            style.includes('visibility:hidden') ||
            style.includes('opacity:0') ||
            style.includes('width:0') ||
            style.includes('width:1px') ||
            style.includes('height:0') ||
            style.includes('height:1px');

          const isTrackingUrl =
            /(\/pixel|\/track|\/beacon|\/open\.php|\/t\.gif|pixel\.png|pixel\.gif|open\.gif|tracking)/i.test(
              src
            );

          if (isZeroSize || isHiddenStyle || (isTrackingUrl && (isZeroSize || isHiddenStyle))) {
            node.setAttribute(
              'src',
              'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
            );
            node.setAttribute('data-blocked-tracker', 'true');
            node.setAttribute('width', '1');
            node.setAttribute('height', '1');
          }
        }
      });
    } catch {
      /* ignore */
      _dompurify = null;
    }
  })();
  return _loading;
}

/**
 * Characters a decoded Guerrilla Mail proxy payload must never contain. The
 * decoded URL is spliced back between the quotes captured from the ORIGINAL
 * markup - before DOMPurify runs and before the entity-decode pass below - so a
 * quote or angle bracket in the decoded value would close the attribute (or the
 * tag) early and inject raw markup. Entity forms of the delimiters count too:
 * the decode pass turns a decoded `&quot;`/`&lt;`/`&#39;` back into the raw
 * character, so `%26quot%3B` is just as dangerous as `%22`.
 *
 * DOMPurify remains the enforcing layer; this only keeps the pre-sanitizer
 * rewrite from manufacturing markup it must then clean up.
 */
const PROXY_UNBLOCK_BREAKOUT_RE = /["'`<>]|\s|&(?:quot|apos|lt|gt|#0*39|#x0*27);?/i;

/** True when a decoded proxy payload could escape the attribute it is spliced into. */
function isUnsafeProxyPayload(value: string): boolean {
  if (PROXY_UNBLOCK_BREAKOUT_RE.test(value)) return true;
  // C0 controls (e.g. a decoded `%00`) must not reach the attribute either.
  // Expressed as a code-point loop because the lint rule forbids control-char
  // classes in regex literals.
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 0x20) return true;
  }
  return false;
}

/**
 * Replace a matched Guerrilla Mail `res.php?…&q=<encoded>` proxy URL with the
 * decoded original URL - but only when the decoded value is provably safe to
 * splice between `quote`s. Anything containing a breakout character is left
 * untouched (the image still renders through the proxy, and DOMPurify handles
 * the markup exactly as it did before).
 */
function unblockGuerrillaProxyUrl(match: string, quote: string, encodedUrl: string): string {
  try {
    const decodedUrl = decodeURIComponent(encodedUrl);
    if (!decodedUrl || isUnsafeProxyPayload(decodedUrl)) return match;
    return `${quote}${decodedUrl}${quote}`;
  } catch {
    /* ignore */
    return match;
  }
}

/**
 * Sanitize HTML to prevent XSS. Returns sanitized HTML string.
 * If DOMPurify hasn't loaded yet, falls back to stripping all tags (safe).
 * Call `await initSanitize()` on component mount to preload.
 */
export function sanitizeHtml(
  html: string,
  options?: { allowImages?: boolean; darkMode?: boolean; allowStyleBlocks?: boolean }
): string {
  if (!html) return '';

  const allowImages =
    options?.allowImages === true
      ? true
      : options?.allowImages === false
        ? false
        : cachedHtmlSettings.img !== false;

  // Style blocks are only safe when the output lands in the email's OPEN
  // SHADOW DOM (EmailBody) - there they are scoped to the shadow tree and can
  // never restyle the app. Light-DOM consumers (message window, print) must
  // NOT pass this flag. The CSS inside the blocks is still filtered through
  // sanitizeStyleBlockCss (fail-closed). Also respects the user's "styles"
  // rendering toggle - disabling inline styles disables style blocks too.
  const allowStyleBlocks = options?.allowStyleBlocks === true && cachedHtmlSettings.style !== false;

  // Unblock Guerrilla Mail proxy image resources (res.php) by decoding the original URLs from the 'q' parameter.
  // Handles both standard double/single quotes and HTML-encoded &quot; quotes.
  let unblockedHtml = html;

  // Match "/res.php?r=1&amp;n=img&amp;q=..." or "/res.php?r=1&n=img&q=..."
  const proxyRegex =
    /("|&quot;|')(?:\/|https?:\/\/(?:www\.)?guerrillamail(?:block)?\.(?:com|info|biz|de|net|org|la)\/)?res\.php\?r=1&amp;n=[a-z]{1,20}&amp;q=([^"'\s&]{1,2000})(?:&amp;[^"'\s>]{0,1000}?)?\1/gi;
  unblockedHtml = unblockedHtml.replace(proxyRegex, unblockGuerrillaProxyUrl);

  // Second pass regex for cases where the URL params might have different encoding or structure (e.g. using standard & instead of &amp;)
  const proxyRegexRawAmp =
    /("|&quot;|')(?:\/|https?:\/\/(?:www\.)?guerrillamail(?:block)?\.(?:com|info|biz|de|net|org|la)\/)?res\.php\?r=1&n=[a-z]{1,20}&q=([^"'\s&]{1,2000})(?:&[^"'\s>]{0,1000}?)?\1/gi;
  unblockedHtml = unblockedHtml.replace(proxyRegexRawAmp, unblockGuerrillaProxyUrl);

  if (!_dompurify && typeof window !== 'undefined') {
    initSanitize();
  }

  // Detect and decode HTML-entity encoded HTML (e.g. &lt;div style="..."&gt;).
  // Decode whenever encoded tags are present - even when the message ALSO
  // contains raw `<` (mixed content). The pass is single-level (&amp; is
  // replaced last), so `&amp;lt;` can never be double-decoded into a raw tag.
  if (unblockedHtml && (unblockedHtml.includes('&lt;') || unblockedHtml.includes('&gt;'))) {
    unblockedHtml = unblockedHtml
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }

  // When style blocks are allowed, extract them BEFORE the doc-level regex
  // runs (which would otherwise eat them along with <head>). Sanitize each
  // block's CSS to the safe subset and remember it for re-injection.
  const darkMode = options?.darkMode === true;
  let safeStyleBlocks = '';
  if (allowStyleBlocks) {
    unblockedHtml = unblockedHtml.replace(
      /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi,
      (_match, cssText: string) => {
        const safeCss = sanitizeStyleBlockCss(cssText, { darkMode });
        if (safeCss) {
          // escapeStyleElementText prevents a `</style` inside a CSS string
          // from closing the tag early and leaking raw HTML into the shadow
          // root (the re-injected block bypasses DOMPurify by construction).
          safeStyleBlocks += `\n<style>${escapeStyleElementText(safeCss)}</style>`;
        }
        return '';
      }
    );
  }

  // Strip document-level CSS/metadata tags (contents included) AFTER entity
  // decoding so neither raw nor encoded <style>/<link> can inject global CSS.
  unblockedHtml = unblockedHtml.replace(DOC_LEVEL_TAG_RE, '');

  if (!_dompurify) {
    // The fallback is deliberately text-only. Re-injecting even sanitized CSS
    // here would bypass DOMPurify's document boundary and violate the
    // strip-all-tags contract when no DOM implementation is available.
    return unblockedHtml.replace(/<[^>]*>/g, '');
  }

  const baseAllowed = [
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
    ...(allowImages ? ['img'] : []),
    'li',
    'ol',
    'p',
    'span',
    'strong',
    ...(cachedHtmlSettings.table !== false
      ? ['table', 'tbody', 'td', 'th', 'thead', 'tr', 'tfoot', 'colgroup', 'col', 'caption']
      : []),
    'ul',
    'pre',
    'code',
    'blockquote',
    'u',
    'i',
    's',
    'strike',
    'del',
    'ins',
    'sub',
    'sup',
    'small',
    'mark',
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
    'dl',
    'dt',
    'dd',
    'details',
    'summary',
    ...(cachedHtmlSettings.svg ? ['svg', 'path', 'g', 'circle', 'rect'] : []),
    ...(cachedHtmlSettings.audio ? ['audio', 'source'] : []),
    ...(cachedHtmlSettings.video ? ['video', 'source'] : []),
    ...(cachedHtmlSettings.iframe ? ['iframe'] : []),
    ...(cachedHtmlSettings.object ? ['object', 'embed', 'param'] : []),
    ...(cachedHtmlSettings.form ? ['form', 'input', 'button', 'select', 'textarea', 'label'] : []),
  ];

  activeDarkMode = options?.darkMode === true;
  try {
    const sanitized = _dompurify.sanitize(unblockedHtml, {
      ALLOWED_TAGS: baseAllowed,
      ALLOWED_ATTR: [
        ...(cachedHtmlSettings.style !== false ? ['style'] : []),
        'href',
        'src',
        'srcset',
        'alt',
        'title',
        'width',
        'height',
        'target',
        'rel',
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
        'lang',
        'aria-hidden',
        'aria-label',
        'type',
        'media',
      ],
      // SECURITY: Allow only image/font data URIs and cid/http/https/mailto schemes
      ALLOWED_URI_REGEXP: /^(?:https?|mailto|cid|data:image\/|data:font\/)/i,
      // DOMPurify keeps allowed style text as-is; sanitizeStyleAttribute applies
      // the CSS parser policy in the hook above. <style> blocks are extracted
      // separately and parsed before being scoped back into the email shadow root.
      FORCE_BODY: false,
    });
    // Re-inject sanitized (safe-subset) <style> blocks when requested. Only the
    // shadow-DOM rendering path (EmailBody) passes allowStyleBlocks, so these
    // rules stay scoped to the email's shadow tree.
    return sanitized + safeStyleBlocks;
  } finally {
    activeDarkMode = false;
  }
}

export interface HtmlRenderingSettings {
  img: boolean;
  style: boolean;
  table: boolean;
  svg: boolean;
  audio: boolean;
  video: boolean;
  iframe: boolean;
  object: boolean;
  form: boolean;
  [tag: string]: boolean | undefined;
}

export const DEFAULT_HTML_RENDERING_SETTINGS: HtmlRenderingSettings = {
  img: false,
  // Inline style attributes. When enabled, sanitized (safe-subset) <style>
  // blocks are also kept for shadow-DOM renderers; when disabled, both go.
  style: true,
  table: true,
  svg: true,
  audio: false,
  video: false,
  iframe: false,
  object: false,
  form: false,
};

let cachedHtmlSettings: HtmlRenderingSettings = { ...DEFAULT_HTML_RENDERING_SETTINGS };
let htmlSettingsRevision = 0;
let htmlSettingsListenerRegistered = false;

/** Reset to safe defaults before applying valid stored flags. */
function resetHtmlSettings(value: unknown): HtmlRenderingSettings {
  const settings = { ...DEFAULT_HTML_RENDERING_SETTINGS };
  if (isObjectRecord(value)) {
    for (const key of Object.keys(settings)) {
      if (typeof value[key] === 'boolean') settings[key] = value[key];
    }
  }
  return settings;
}

// One listener for this module's context lifetime; cross-window changes and
// removals invalidate the synchronous sanitizer cache immediately.
function ensureHtmlSettingsListener(): void {
  if (htmlSettingsListenerRegistered) return;
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.htmlRenderingSettings) return;
    htmlSettingsRevision += 1;
    cachedHtmlSettings = resetHtmlSettings(changes.htmlRenderingSettings.newValue);
  });
  htmlSettingsListenerRegistered = true;
}

export async function loadHtmlRenderingSettings(): Promise<HtmlRenderingSettings> {
  try {
    ensureHtmlSettingsListener();
    const revision = htmlSettingsRevision;
    const res = (await browser.storage.local.get(['htmlRenderingSettings'])) as {
      htmlRenderingSettings?: Partial<HtmlRenderingSettings>;
    };
    if (revision === htmlSettingsRevision) {
      cachedHtmlSettings = resetHtmlSettings(res.htmlRenderingSettings);
    }
  } catch (error) {
    logError('Failed to load HTML rendering settings', error);
  }
  return cachedHtmlSettings;
}

export async function saveHtmlRenderingSettings(
  settings: HtmlRenderingSettings
): Promise<HtmlRenderingSettings> {
  const revision = htmlSettingsRevision;
  const normalized = resetHtmlSettings(settings);
  // Let callers show their existing failure toast and roll back the toggle.
  // Failed writes must never change the sanitizer's effective preferences.
  await writeWithRetry({ htmlRenderingSettings: normalized });
  if (revision === htmlSettingsRevision) cachedHtmlSettings = normalized;
  return cachedHtmlSettings;
}

/**
 * Initialize DOMPurify loading. Call in onMount or at startup.
 * Subsequent calls are no-ops.
 */
export async function initSanitize(): Promise<void> {
  await ensureLoaded();
  await loadHtmlRenderingSettings();
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
      const doc = new DOMParser().parseFromString(html, 'text/html');
      // Remove <script>/<style> elements (and their inner text) so inline
      // CSS/JS never pollutes the extracted plain text - matching the regex
      // fallback below. body.textContent would otherwise include them.
      try {
        doc.body.querySelectorAll('script, style').forEach((el) => {
          el.remove();
        });
      } catch {
        /* ignore */
      }
      return doc.body.textContent || '';
    }
  } catch {
    // DOMParser not available (e.g. background service worker)
  }
  // Fallback: strip tags with regex (safe enough when DOMParser is absent)
  // Strip <script> and <style> blocks completely before stripping other tags
  const noScripts = html.replace(/<(script|style)[\s\S]*?(?:<\/\1>|$)/gi, '');
  return noScripts.replace(/<[^>]*(?:>|$)/g, '');
}
