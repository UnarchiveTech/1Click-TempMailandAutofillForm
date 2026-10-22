/**
 * check-pseudo-overlays.ts
 *
 * Pre-commit / CI guard that stops decorative positioned ::before / ::after
 * pseudo-elements from silently swallowing pointer events over interactive
 * siblings.
 *
 * A pseudo-element that is `position: absolute|fixed` paints ABOVE the host's
 * in-flow (static) content - including interactive children such as buttons.
 * A full-cover decorative line/glow built that way (e.g. `.divider::before {
 * content: ''; position: absolute; inset: 0; }`) therefore eats every click
 * meant for the element underneath it. The fix is `pointer-events: none` on
 * the pseudo - it is decoration, never an input target (pseudo-elements cannot
 * receive events; they always hit-test to their originating element).
 *
 * Flags, in `.svelte` `<style>` blocks, `.css` files, CSS injected as
 * string literals in `.ts` files (e.g. stylesheet text assigned to a `<style>`
 * element or shadow-DOM style - such as PRINT_CSS in print-email.ts), and
 * CSS/svelte/html code fences in `docs/` + `docs-site/content/` markdown:
 *   a rule whose selector is ::before / ::after, with empty content and an
 *   absolute/fixed position, that does NOT declare `pointer-events: none`.
 * Only text that actually looks like stylesheet text (contain a rule block)
 * is parsed - prose and inline `el.style.cssText` (which can never express
 * pseudo-selectors) are skipped, so this only ever inspects real stylesheet
 * strings and code examples contributors could copy.
 *
 * Deliberately NOT flagged (not an overlay hazard):
 *   - non-positioned pseudos (inline glyphs like the EmailBody ↗ marker);
 *   - positioned pseudos with real content;
 *   - pseudos on interactive hosts themselves (clicks still land on the host,
 *     so `pointer-events: none` there is a harmless no-op).
 *
 * Zero suppression: every file is scanned - there is no path-level ignore list
 * (a `.pseudo-overlay-ignore` would only park the debt, not fix the click it
 * eats). The one skip is the set `.gitignore` covers, resolved through
 * `scripts/source-files.ts` so this gate agrees with `bun run check` on which
 * files exist.
 *
 * Usage: bun scripts/check-pseudo-overlays.ts
 */

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { collectAbsoluteFiles } from './source-files';

const SRC_DIR = join(process.cwd(), 'src');
const DOCS_DIR = join(process.cwd(), 'docs');
const DOCS_CONTENT_DIR = join(process.cwd(), 'docs-site', 'content');

const STYLE_TAG_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/g;

/** Skips over a quoted string starting at i (backslash escapes supported). */
function skipString(css: string, i: number): number {
  const quote = css[i];
  i += 1;
  while (i < css.length) {
    if (css[i] === '\\') {
      i += 2;
      continue;
    }
    if (css[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}

export interface CssRule {
  /** Selector text (trimmed). */
  selector: string;
  /** Character offset of the selector inside the scanned CSS. */
  selectorOffset: number;
  /** Declarations between the rule's braces. */
  body: string;
}

interface TsLiteral {
  /** File offset where the string/template literal starts. */
  start: number;
  /** Literal content (quotes/backticks removed, `${…}` interpolation elided). */
  value: string;
}

/**
 * Comment-aware extractor for TS string/template literals. Line comments,
 * block comments, and regex-ish `/.../` regions are skipped so prose like
 * "the ::before divider" can never be mistaken for a stylesheet literal.
 * Template interpolation (`${ … }`) is elided (replaced with a space); the
 * remaining text keeps its real newlines for line-accurate reporting.
 */
function extractTsLiterals(text: string): TsLiteral[] {
  const out: TsLiteral[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      const eol = text.indexOf('\n', i + 2);
      i = eol === -1 ? n : eol + 1;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
    } else if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let value = '';
      while (j < n) {
        if (text[j] === '\\' && j + 1 < n) {
          value += text[j] + text[j + 1];
          j += 2;
        } else if (text[j] === quote) {
          break;
        } else {
          value += text[j];
          j += 1;
        }
      }
      out.push({ start: i, value });
      i = j + 1;
    } else if (c === '`') {
      let j = i + 1;
      let value = '';
      let interp = 0;
      while (j < n) {
        const ch = text[j];
        if (ch === '\\' && interp === 0 && j + 1 < n) {
          value += text[j] + text[j + 1];
          j += 2;
        } else if (interp === 0 && ch === '`') {
          break;
        } else if (interp === 0 && ch === '$' && text[j + 1] === '{') {
          interp = 1;
          value += ' ';
          j += 2;
        } else if (interp > 0) {
          if (ch === '{') interp += 1;
          else if (ch === '}') interp -= 1;
          j += 1;
        } else {
          value += ch;
          j += 1;
        }
      }
      out.push({ start: i, value });
      i = j + 1;
    } else if (
      c === '/' &&
      !/[A-Za-z0-9_)\]}]/.test(text[i - 1] ?? '') &&
      !/[ \t\r\n/]/.test(text[i + 1] ?? '')
    ) {
      // Skip `/regex/` bodies (a '/' not after an identifier or closer and
      // not followed by whitespace/another slash) so quoted text inside a
      // regex can't be misread as a string literal.
      let j = i + 2;
      let escaped = false;
      while (j < n && (text[j] !== '/' || escaped) && text[j] !== '\n') {
        if (text[j] === '\\' && !escaped) escaped = true;
        else escaped = false;
        j += 1;
      }
      i = j < n && text[j] === '/' ? j + 1 : j;
    } else {
      i += 1;
    }
  }
  return out;
}

function countNewlines(s: string): number {
  let count = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === '\n') count += 1;
  return count;
}

/** Fence languages that may carry copy-pasteable CSS examples. */
const CSS_FENCE_LANGS = new Set(['css', 'scss', 'less', 'postcss', 'svelte', 'html']);

/**
 * Fenced code blocks in markdown that may contain CSS examples, mapped to
 * their 1-based start line inside the document. Returns entries in order.
 */
function findMarkdownCssFences(md: string): Array<{ startLine: number; css: string }> {
  const out: Array<{ startLine: number; css: string }> = [];
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    const fence = lines[i].match(/^\s*(```|~~~)\s*([A-Za-z0-9_-]*)/);
    if (fence) {
      const marker = fence[1];
      const lang = fence[2].toLowerCase();
      const closeRe = new RegExp(`^\\s*${marker}`);
      let j = i + 1;
      while (j < lines.length && !closeRe.test(lines[j])) j += 1;
      if (CSS_FENCE_LANGS.has(lang) && j > i + 1) {
        // Content starts on the line after the opening fence (1-based).
        out.push({ startLine: i + 2, css: lines.slice(i + 1, j).join('\n') });
      }
      i = j + 1; // skip past the closing fence (or EOF)
    } else {
      i += 1;
    }
  }
  return out;
}

/**
 * Pseudo-overlay violations inside a markdown document's CSS/svelte/html
 * code fences, each reported at its 1-based source line.
 *
 * A fence is scanned whole when it is plain CSS. When it carries markup
 * (svelte/html examples) only the inner text of each `<style>` block is CSS;
 * the surrounding markup must not be fed to the rule scanner (it would merge
 * into bogus selectors like `<style>\n.a::before`).
 */
export function findMarkdownCssViolations(md: string): Array<{ line: number; selector: string }> {
  const out: Array<{ line: number; selector: string }> = [];
  for (const fence of findMarkdownCssFences(md)) {
    if (/<style\b/i.test(fence.css)) {
      STYLE_TAG_RE.lastIndex = 0;
      for (const m of fence.css.matchAll(STYLE_TAG_RE)) {
        const styleCss = m[1];
        // Offset of the style's inner text within the fence text.
        const innerOffset = m.index + (m[0].length - styleCss.length);
        for (const rule of findPseudoOverlayViolations(styleCss)) {
          out.push({
            line:
              fence.startLine +
              countNewlines(fence.css.slice(0, innerOffset + rule.selectorOffset)),
            selector: rule.selector,
          });
        }
      }
    } else {
      for (const rule of findPseudoOverlayViolations(fence.css)) {
        out.push({
          line: fence.startLine + countNewlines(fence.css.slice(0, rule.selectorOffset)),
          selector: rule.selector,
        });
      }
    }
  }
  return out;
}

/**
 * Brace-aware rule scanner: returns every `selector { … }` block, including
 * rules nested inside @media / CSS nesting. Strings and comments are skipped,
 * so decorative `content: '{'` never confuses the brace matching.
 */
export function scanRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const stack: Array<{ open: number; selStart: number }> = [];
  let selStart = 0;
  let i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 2;
    } else if (c === '"' || c === "'") {
      i = skipString(css, i);
    } else if (c === '{') {
      stack.push({ open: i, selStart });
      selStart = i + 1;
      i += 1;
    } else if (c === '}') {
      const frame = stack.pop();
      if (frame) {
        // Skip comments/whitespace that precede the selector so the reported
        // line points at the rule itself, not at a comment above it.
        const rawSel = css.slice(frame.selStart, frame.open);
        const lead = rawSel.match(/^\s*(?:\/\*[\s\S]*?\*\/\s*)*/)?.[0].length ?? 0;
        rules.push({
          selector: rawSel.slice(lead).trim(),
          selectorOffset: frame.selStart + lead,
          body: css.slice(frame.open + 1, i),
        });
      }
      selStart = i + 1;
      i += 1;
    } else if (c === ';') {
      selStart = i + 1;
      i += 1;
    } else {
      i += 1;
    }
  }
  return rules;
}

const findings: string[] = [];

/** Pseudo-element selectors - `::before`, legacy `:before`, etc. */
const PSEUDO_SELECTOR_RE = /::?(before|after)(?![\w-])/i;
/** Empty content: `content: ''` / `content: ""`. */
const EMPTY_CONTENT_RE = /content\s*:\s*['"]\s*['"]/i;
const POSITIONED_RE = /\bposition\s*:\s*(absolute|fixed)\b/i;
const POINTER_EVENTS_NONE_RE = /\bpointer-events\s*:\s*none\b/i;

function lineAt(fileText: string, absIndex: number): number {
  let line = 1;
  for (let i = 0; i < absIndex && i < fileText.length; i++) {
    if (fileText[i] === '\n') line += 1;
  }
  return line;
}

/**
 * The overlay-hazard test for one rule: pseudo selector, decorative (empty
 * content), positioned (absolute/fixed), and no `pointer-events: none`.
 *
 * Drop comments first - then test empty content on the RAW body (its quotes
 * must survive: `content: ''` IS the decoration marker). Only then strip
 * strings so a literal "position: absolute" in a caption or docs comment
 * can't trip the position/pointer-events scan.
 */
export function isPseudoOverlayViolation(rule: Pick<CssRule, 'selector' | 'body'>): boolean {
  if (!PSEUDO_SELECTOR_RE.test(rule.selector)) return false;
  const noComments = rule.body.replace(/\/\*[\s\S]*?\*\//g, '');
  if (!EMPTY_CONTENT_RE.test(noComments)) return false; // decorative content only
  const noStrings = noComments.replace(/(['"])(?:\\.|(?!\1)[\s\S])*\1/g, '');
  if (!POSITIONED_RE.test(noStrings)) return false; // in-flow pseudos can't overlay siblings
  if (POINTER_EVENTS_NONE_RE.test(noStrings)) return false; // already safe
  return true;
}

/**
 * All rules in `css` that violate the decorative-overlay convention, with
 * offsets intact so callers can map them back to source lines. Works on
 * plain stylesheet text whether top-level, @media-nested, or CSS-nested.
 */
export function findPseudoOverlayViolations(css: string): CssRule[] {
  return scanRules(css).filter(isPseudoOverlayViolation);
}

function inspectCssText(file: string, fileText: string, css: string, baseOffset: number): void {
  for (const rule of findPseudoOverlayViolations(css)) {
    const line = lineAt(fileText, baseOffset + rule.selectorOffset);
    findings.push(
      `${relative(process.cwd(), file).replace(/\\/g, '/')}:${line}: positioned decorative ` +
        `pseudo missing pointer-events: none -> ${rule.selector}`
    );
  }
}

/**
 * Scans a TS string literal for stylesheet text and checks any pseudo rules
 * inside it. Only literals containing a rule block are parsed; inline CSS
 * (`el.style.cssText = 'color: red'`) has no braces and is skipped.
 */
function inspectTsLiteral(file: string, fileText: string, literal: TsLiteral): void {
  const value = literal.value;
  if (!value.includes('{')) return; // no rule block → inline/plain string
  if (!PSEUDO_SELECTOR_RE.test(value)) return; // no pseudo anywhere → nothing to check

  const startLine = lineAt(fileText, literal.start);
  for (const rule of findPseudoOverlayViolations(value)) {
    const line = startLine + countNewlines(value.slice(0, rule.selectorOffset));
    findings.push(
      `${relative(process.cwd(), file).replace(/\\/g, '/')}:${line}: positioned decorative ` +
        `pseudo missing pointer-events: none (ts css literal) -> ${rule.selector}`
    );
  }
}

function scanFile(file: string): void {
  const fileText = readFileSync(file, 'utf8');
  if (file.endsWith('.svelte')) {
    STYLE_TAG_RE.lastIndex = 0;
    for (const m of fileText.matchAll(STYLE_TAG_RE)) {
      const css = m[1];
      const baseOffset = m.index + (m[0].length - css.length);
      inspectCssText(file, fileText, css, baseOffset);
    }
  } else if (file.endsWith('.css')) {
    inspectCssText(file, fileText, fileText, 0);
  } else if (file.endsWith('.ts')) {
    for (const literal of extractTsLiterals(fileText)) {
      inspectTsLiteral(file, fileText, literal);
    }
  } else if (file.endsWith('.md')) {
    for (const violation of findMarkdownCssViolations(fileText)) {
      findings.push(
        `${relative(process.cwd(), file).replace(/\\/g, '/')}:${violation.line}: ` +
          `positioned decorative pseudo missing pointer-events: none (markdown css example) -> ` +
          violation.selector
      );
    }
  }
}

function main(): void {
  // `docs/` is scanned too, and it is where an ignore rule and a gate used to
  // disagree first: `.gitignore` covers several `docs/*.md` files that this gate
  // used to read anyway. Both now resolve their files the same way.
  const files = [
    ...collectAbsoluteFiles(SRC_DIR, ['.svelte', '.css', '.ts']),
    ...collectAbsoluteFiles(DOCS_DIR, ['.md']),
    ...collectAbsoluteFiles(DOCS_CONTENT_DIR, ['.md']),
  ];

  // Zero-suppression policy: every file is scanned - there is no ignore list.
  for (const file of files) scanFile(file);

  if (findings.length > 0) {
    console.error(
      `Positioned decorative pseudo-elements missing pointer-events: none (${findings.length}):`
    );
    for (const f of findings) console.error(`  ${f}`);
    console.error(
      '\nDecorative ::before/::after overlays paint above static siblings and swallow their ' +
        'clicks - add `pointer-events: none` to the pseudo. There is no path-level ignore list.'
    );
    process.exit(1);
  }
  console.log('No positioned decorative pseudo-elements lack pointer-events: none.');
}

if (import.meta.main) main();
