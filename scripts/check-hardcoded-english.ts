/**
 * check-hardcoded-english.ts
 *
 * Pre-commit / CI guard that stops hardcoded user-facing English from
 * regrowing in .svelte files, background/content TS, and feature TS. Flags:
 *
 *   1. Literal values in user-facing attributes (placeholder, aria-label,
 *      ariaLabel, title, label, alt) that don't use $t() / {…} / @-directives.
 *   2. toastStore.success/error/info/warning('…') calls with plain string
 *      literals instead of locale keys.
 *   3. window.prompt/confirm/alert('…') literals shown directly to users.
 *   4. `$t('…') || 'Literal fallback'` expressions - English fallbacks that
 *      show while a locale key is missing.
 *   5. Script-side object literals with user-facing properties
 *      (label/title/placeholder/description/ariaLabel/alt/hint/subtitle) whose
 *      values are plain English strings instead of $t() calls - e.g. dropdown
 *      option lists, DATE_PRESETS radio labels, notification configs.
 *      Identifier-like values (locale keys, config tokens such as
 *      "expiredSkip" or "keyboardShortcuts.fixedFocusSearch") are skipped.
 *   6. Visible text nodes - both single-line (<button>Save</button>) and
 *      multi-line (prose alone on its own line *between an open tag and its
 *      closing tag*, e.g. a button label spanning lines). Bare attributes,
 *      CSS class lists, identifiers, and HTML comment text on their own lines
 *      are not mistaken for text. Trailing prose punctuation (".!?%)…") is
 *      accepted so strings like "Auto-Delete Marketing/Promo (24h)" are
 *      caught.
 *
 * Comment bodies are blanked by the shared `./source-lexer` before any check
 * runs, so prose or parked code inside a `//`, `/* *​/` or `<!-- -->` comment is
 * never read as a finding - and a `'https://…'` URL or a `/['"]/` regex inside
 * code is never mistaken for a comment, which is what a naive stripper does.
 * Checks are then suppressed inside <script>/<style> regions except the ones
 * that are *meant* to live in script (toast, prompt, $t fallback,
 * option-property literals).
 *
 * Intentional holds (brand names, keycaps, format badges, abbreviations,
 * search-pill syntax, shell commands, examples) are allowlisted below by value.
 *
 * Zero-suppression policy: every file is scanned - there is no gate-level ignore
 * list, and the former `.hardcoded-english-ignore` is gone. The one thing skipped
 * is what `.gitignore` covers (`scripts/source-files.ts`), which is also exactly
 * what `bun run check` skips, so the two can no longer disagree about a file.
 * A file's English
 * debt is migrated to locale keys (UI text) or to stable codes the UI maps
 * (feature errors); it is never parked in an allowlist. The whole tree -
 * `src/features/**` included - currently reports zero findings, and adding a
 * suppression file would only resurrect the bypass that this removal closed.
 *
 * Usage: bun scripts/check-hardcoded-english.ts
 */

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { collectAbsoluteFiles } from './source-files';
import { analyzeSource, stripComments } from './source-lexer';

const SRC_DIR = join(process.cwd(), 'src');
/** Demo signup pages the extension opens (see `features/demo/demo-mode.ts`). */
const DEMO_DIR = join(process.cwd(), 'demo');
// Pages WXT copies verbatim into the extension (the MV3 offscreen document).
const PUBLIC_DIR = join(process.cwd(), 'public');

/** Trailing char class: alphanumerics plus common prose punctuation. */
const TEXT_END = 'A-Za-z0-9).!?%…';

/** User-facing attributes whose literal values should be localized. */
const ATTR_RE =
  /\b(placeholder|aria-label|ariaLabel|title|label|alt)\s*=\s*(?:"([^"]*)"|`([^`]*)`)/g;

/** toastStore.success('…') / .error('…') / .info('…') / .warning('…') literals. */
const TOAST_RE = /toastStore\.(?:success|error|info|warning)\(\s*(['"`])([^'"`]*)\1/g;

/** window.prompt/confirm/alert('…') literals - user-visible dialogs. */
const PROMPT_RE = /(?:window\.)?(?:prompt|confirm|alert)\(\s*(['"`])([^'"`]*)\1/g;

/** $t('…') || 'Literal fallback' - English shown while a locale key is missing. */
const T_FALLBACK_RE = /\$t\([^)]*\)\s*\|\|\s*(['"`])([^'"`]*)\1/g;

/**
 * Script-side (or inline template) object literals carrying user-facing text:
 * { label: 'Save' }, { title: 'Export' }, { description: '…' }, … These drive
 * dropdown options, radio labels, hints, and notification configs - all need
 * locale keys. Property values that are $t(...) calls, bindings, or
 * identifier-like tokens (locale keys, config constants) don't match.
 */
const OPTION_PROP_RE =
  /\b(label|title|placeholder|description|ariaLabel|alt|hint|subtitle)\s*:\s*(['"`])([^'"`]*)\2/g;

/**
 * Background (non-Svelte) checks - user-facing copy created in TS was
 * previously invisible to the .svelte-only scan, so hard-coded English grew
 * back there (e.g. "Temp Email Created"). Three surfaces are covered:
 *
 *   1. Desktop notifications + toolbar/context-menu copy: plain string
 *      literals for title/message/contextMessage inside
 *      createBrowserNotification({…}) / contextMenus.update(…, {…}) /
 *      action.setTitle({…}) calls. tSync()/t() calls are skipped.
 *   2. Template-literal props with prose outside ${…} interpolation
 *      (e.g. `Remove "${domain}" from Autofill Blocklist`) - pure-data
 *      templates like "${from}: ${subject}" have no prose residue, so they
 *      pass.
 *   3. Omnibox suggestion descriptions (`description: '…'` in background TS) -
 *      same user-facing surface as notifications.
 *
 * Known limitations: a `title:` literal hidden inside a ternary expression
 * (title: ok ? 'Copied' : …) or a multi-line description: '…' is not caught -
 * migrate those to tSync()/locale keys when touched.
 */
const NOTIF_CALL_RE = /(?:createBrowserNotification|contextMenus\.update|action\.setTitle)\s*\(/;
const NOTIF_PROP_RE = /\b(title|message|contextMessage)\s*:\s*(['"`])([^'"`\n]*)\2/g;
const NOTIF_TPL_RE = /\b(title|message|contextMessage)\s*:\s*`([^`]*)`/g;
const NOTIF_CLOSE_RE = /^\s*\}\)\s*;\s*$/;

/** Omnibox suggestion descriptions - user-visible background copy. */
const TS_DESC_RE = /\bdescription\s*:\s*(['"`])([^'"`\n]*)\1/g;

/** Visible text node on one line: >Text< where Text is 2+ ASCII chars. */
const TEXT_NODE_RE = new RegExp(`>([A-Za-z][A-Za-z0-9 ,'’\\--…()+/]*[${TEXT_END}])<\\s*`, 'g');

/**
 * Multi-line text node: a line whose whole trimmed content is prose (no
 * markup, no braces, no quotes, no interpolation). Only treated as text when
 * it sits between an open tag (previous non-empty line ends with '>') and a
 * closing tag (next non-empty line starts with '<'), so bare attributes, class
 * lists, identifiers, and comment lines are never mistaken for user-facing
 * copy. Example:
 *
 *   <button …>
 *     Generate Random
 *   </button>
 */
const TEXT_LINE_RE = new RegExp(`^[A-Za-z][A-Za-z0-9 ,'’\\--…()+/]*[${TEXT_END}]$`);

/** Exact-match allowlist for intentional single tokens. */
const ALLOWLIST = new Set([
  // Keycaps (never localized)
  'Esc',
  'Enter',
  'Escape',
  'Tab',
  'Shift',
  'Alt',
  'Ctrl',
  'Cmd',
  'Ctrl+K',
  'Delete',
  'Backspace',
  'Space',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  '⌘',
  // Format badges
  'JSON',
  'EML',
  'MBOX',
  'PDF',
  'CSV',
  'MD',
  // Abbreviations / brand fragments
  'QR',
  'OTP',
  'Autofill',
  'Autofill Form',
  'Mail',
  'Temp',
  'FAQs',
  'ID',
  '1C',
  // Fixed shortcut labels rendered as keys ("J"/"K" are single chars - never matched)
  'Ctrl + K / Cmd + K',
  'Ctrl + Shift + P',
  'Ctrl + A / Cmd + A',
  'Ctrl + Shift + S',
  'Ctrl + Shift + F',
  'Shift + Click',
  'Shift + Drag',
]);

/** Substrings that mark a value as intentionally non-prose (examples, syntax). */
function isIntentional(value: string): boolean {
  const v = value.trim();
  if (ALLOWLIST.has(v)) return true;
  if (/^(https?:\/\/|\/|www\.)/i.test(v)) return true; // URLs / paths
  if (/[{}]$/.test(v) || v.startsWith('{')) return true; // bound expressions
  if (/\$\{/.test(v) || /\$t\(/.test(v)) return true; // template / i18n calls
  if (/^@/.test(v)) return true; // svelte directives
  if (/(^|\s)(tag|domain|country|from|to|label|site|is):/i.test(v)) return true; // search-pill syntax
  if (/(\d{1,2})\s?(AM|PM)/i.test(v)) return true; // heatmap axis labels
  if (/\.(com|io|org|net|dev|app|ru|de)\b/i.test(v)) return true; // example domains
  if (/^Mozilla\/5\.0/i.test(v)) return true; // UA strings
  if (/^Chrome \(|^Custom User-Agent|^Default Browser|^User-Agent/i.test(v)) return true; // UA options
  if (/^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(v)) return true; // email addresses
  if (/^(bunx|bun|npm|npx|pnpm|yarn|node|python|pip)\s+\S/.test(v)) return true; // shell commands
  return false;
}

const findings: string[] = [];

function report(file: string, lineNo: number, kind: string, value: string): void {
  findings.push(`${relative(process.cwd(), file)}:${lineNo}: ${kind}: ${value}`);
}

/**
 * A JS comment in MARKUP position is not a comment: the compiler renders it.
 *
 * This is the one user-facing string the rest of this scan CANNOT see, and the
 * reason is structural rather than an oversight: `stripComments()` (the shared
 * lexer) classifies `/** … *\/` as a comment, which is correct for a script and
 * wrong for a template, and every other gate reads the file through that same
 * lexer. So markup is inspected here, on the raw source, before blanking.
 *
 * EVERY markup position counts, not just the top of the file. The first version
 * of this rule only looked above the opening `<script>`, which is where the
 * block that shipped from was written - but a `// note` dropped between two
 * elements renders exactly the same paragraph of English, so the scan now walks
 * the whole file and tracks what it is looking at: in `<script>`/`<style>` a JS
 * comment is a comment and is left alone; in markup it is a defect, unless it
 * sits inside a `{…}` expression (where it is JS again) or inside `<!-- -->`.
 *
 * `<!-- -->` is deliberately NOT flagged: Svelte drops HTML comments instead of
 * rendering them, so only JS comment syntax is a defect.
 *
 * Known limitation: a `{` in a TEXT NODE is counted as opening an expression, so
 * prose with an unmatched brace can suppress a finding below it until a `}`
 * rebalances it. `tests/unit/scripts/check-hardcoded-english.test.ts` closes that
 * gap from the other side - it compiles every component and asserts no comment
 * syntax reaches the generated HTML - which is affordable once, in a test, and
 * not once per keystroke in a pre-commit hook.
 */
/** One comment sitting in markup position - i.e. text the compiler renders. */
export interface RenderedComment {
  /** 1-based line of the comment's opener. */
  line: number;
  /** Which JS comment syntax leaked: `//` or `/*`. */
  style: '//' | '/*';
}

/** `index` → the 1-based line it sits on, counting in the RAW text. */
function lineAt(raw: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (raw[i] === '\n') line++;
  return line;
}

/** Where a comment opened at `i` ends, so the scan resumes past it. */
function commentEnd(raw: string, i: number): number {
  if (raw.startsWith('<!--', i)) {
    const close = raw.indexOf('-->', i + 4);
    return close === -1 ? raw.length : close + 3;
  }
  if (raw.startsWith('//', i)) {
    const close = raw.indexOf('\n', i);
    return close === -1 ? raw.length : close;
  }
  const close = raw.indexOf('*/', i + 2);
  return close === -1 ? raw.length : close + 2;
}

/**
 * Comments the compiler will RENDER: JS comment syntax sitting in markup.
 *
 * The classification itself is NOT repeated here - that is `source-lexer.ts`'s
 * job, and `tests/unit/scripts/source-lexer.test.ts` fails any scanner that keeps
 * its own comment-state machine. So this asks the lexer and reads its answer:
 *
 *   - `analyzeSource(raw).code` is the source with every comment body blanked,
 *     so "is this byte inside a comment" is `code[i] !== raw[i]`. That is also how
 *     a comment INSIDE a string is never mistaken for one - `https://…` in an
 *     attribute is string text to the lexer and stays unblanked - and how a
 *     comment in the MIDDLE of a markup line (`<div>x // note`) is caught, which
 *     a line-leading rule could not see;
 *   - `inString` answers the same question for quotes, so a `{` inside a string
 *     does not open a template expression.
 *
 * What is left here is markup structure, which the lexer deliberately does not
 * model (its own header says scanners track `<script>`/`<style>` themselves) and
 * which is not comment classification in any case: the region a byte sits in, the
 * `{…}` expression depth, and the extent of an `<!-- -->` comment.
 */
export function findRenderedComments(raw: string): RenderedComment[] {
  const { code, inString } = analyzeSource(raw);
  const findings: RenderedComment[] = [];
  const blanked = (i: number) => code[i] !== raw[i];

  let region: 'markup' | 'script' | 'style' = 'markup';
  let depth = 0;

  for (let i = 0; i < raw.length; ) {
    // Newlines are skipped rather than handled: every rule below is decided by
    // the byte in front of the cursor, and a comment's extent is measured with
    // `commentEnd`/`indexOf`, so no rule needs to know where the line began.
    if (raw[i] === '\n') {
      i++;
      continue;
    }

    // Region changes are read off the BLANKED text, so a `<script>` inside a
    // comment cannot open a region. A block that opens and closes on one line
    // never enters its region, or a single-line `<style>…</style>` would swallow
    // everything after it.
    if (region === 'markup') {
      const restOfLine = code.slice(
        i,
        code.indexOf('\n', i) === -1 ? code.length : code.indexOf('\n', i)
      );
      if (/<script\b/i.test(restOfLine)) {
        region = /<\/script>/i.test(restOfLine) ? 'markup' : 'script';
      } else if (/<style\b/i.test(restOfLine)) {
        region = /<\/style>/i.test(restOfLine) ? 'markup' : 'style';
      }
    } else if (
      (region === 'script' && code.startsWith('</script>', i)) ||
      (region === 'style' && code.startsWith('</style>', i))
    ) {
      region = 'markup';
    }

    const char = raw[i];

    // An `<!-- -->` comment is dropped by the compiler, so nothing inside it is
    // ever rendered - skip its whole extent, wherever it sits.
    if (char === '<' && blanked(i) && raw.startsWith('<!--', i)) {
      i = commentEnd(raw, i);
      continue;
    }

    if (region === 'markup' && !inString[i]) {
      if ((char === '{' || char === '}') && !blanked(i)) {
        depth = Math.max(0, depth + (char === '{' ? 1 : -1));
      } else if (depth === 0 && char === '/' && blanked(i) && /[/\\*]/.test(raw[i + 1] ?? '')) {
        // Blanked `/` opening a `//` or `/*`: a comment the template will print.
        // A `*/` CLOSER cannot match - its `/` is followed by the next token,
        // never by `/` or `*`.
        //
        // The `scheme://` exclusion is the one place the lexer's JS reading and
        // the browser's HTML reading disagree: in a TEXT NODE
        // (`<p>See https://example.test/p</p>`) the `//` is plain text that the
        // browser shows, while the lexer - which classifies `.svelte` markup with
        // a JS dialect - reads a line comment from the `:`. Excluding a `//`
        // directly after a scheme colon keeps the rule pointed at leaks without
        // inventing a text-node parser.
        const isUrlScheme = raw[i - 1] === ':' && raw[i + 1] === '/';
        if (!isUrlScheme) {
          findings.push({ line: lineAt(raw, i), style: raw.slice(i, i + 2) as '//' | '/*' });
        }
        i = commentEnd(raw, i);
        continue;
      }
    }

    i++;
  }

  return findings;
}

/** Index of the nearest non-empty line before/after `i` (or -1). */
function prevNonEmpty(lines: string[], i: number): number {
  for (let j = i - 1; j >= 0; j--) {
    if (lines[j].trim()) return j;
  }
  return -1;
}

function nextNonEmpty(lines: string[], i: number): number {
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].trim()) return j;
  }
  return -1;
}

/**
 * Report the comments a template will PRINT - the rule alone, so a markup file
 * with no `<script lang="ts">` shape (an entrypoint HTML page) can be scanned by
 * it directly.
 *
 * The wording covers both readings of a `//`/`/*` in markup, because both are a
 * defect and only one fix each: a comment written there is text on screen (move
 * it into `<script>`), and text written there is un-localized English (route it
 * through a locale key). Which one it is does not change that the file is wrong,
 * and the scanner cannot tell the two apart - nor does it need to.
 */
function reportRenderedComments(file: string): void {
  const raw = readFileSync(file, 'utf8');
  for (const comment of findRenderedComments(raw)) {
    report(
      file,
      comment.line,
      'markup-comment',
      `${comment.style} in markup is RENDERED, not a comment - move it into <script>, or localize it if the text is meant to be visible`
    );
  }
}

function scanFile(file: string): void {
  const raw = readFileSync(file, 'utf8');
  reportRenderedComments(file);
  // Comment bodies are blanked first, so nothing below has to reason about
  // `//`, `/* */` or `<!-- -->` again - that classification lives in one place.
  const lines = stripComments(raw).split('\n');
  // Region tracking: bare tokens inside <script>/<style> are code or styles, not
  // visible text. Script-side checks (toast, prompt, $t fallback, option
  // properties) intentionally still run inside <script>.
  let inScript = false;
  let inStyle = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const opensScript = /<script\b/.test(line) && !/<\/script>/.test(line);
    const opensStyle = /<style\b/.test(line) && !/<\/style>/.test(line);
    if (opensScript) inScript = true;
    if (opensStyle) inStyle = true;

    // Checks that live in markup OR script (never inside styles)
    const inMarkupOrScript = !inStyle;
    if (inMarkupOrScript) {
      // Attribute literals (double-quoted and backtick forms)
      for (const m of line.matchAll(ATTR_RE)) {
        const value = (m[2] ?? m[3] ?? '').trim();
        if (!value || !/^[A-Za-z]/.test(value)) continue;
        if (isIntentional(value)) continue;
        report(file, i + 1, 'attribute', `${m[1]}="${value}"`);
      }

      // Script-side user-facing option/config string literals
      for (const m of line.matchAll(OPTION_PROP_RE)) {
        const value = m[3].trim();
        if (!value || !/^[A-Za-z]/.test(value) || isIntentional(value)) continue;
        // Skip identifier-like values: locale keys, config tokens, prop names.
        if (/^[a-z][a-zA-Z0-9.]*$/.test(value)) continue;
        report(file, i + 1, 'option', `${m[1]}: "${value}"`);
      }

      // Visible text nodes - skip control-flow / script-expression lines
      // and any region where a bare token is code, not copy.
      if (!inScript) {
        // Single-line text nodes
        if (/{@|{#|\{:/g.test(line)) continue;
        // Skip lines mixing script expressions with markup (unreliable heuristic)
        if (/\{.*\}[^>]*>[^<]*</.test(line)) continue;
        for (const m of line.matchAll(TEXT_NODE_RE)) {
          const value = m[1].trim();
          if (!value || value.length < 2 || isIntentional(value)) continue;
          report(file, i + 1, 'text', `>${value}<`);
        }

        // Multi-line text nodes: prose alone on its own line between an open
        // tag ('>') and a closing tag ('<'). Without this context, bare
        // attributes, class lists, and identifiers would be reported as text.
        const prev = prevNonEmpty(lines, i);
        const next = nextNonEmpty(lines, i);
        const betweenTags =
          prev >= 0 &&
          next >= 0 &&
          lines[prev].trimEnd().endsWith('>') &&
          /^\s*</.test(lines[next]);
        if (betweenTags) {
          const trimmed = line.trim();
          if (trimmed.length >= 2 && trimmed.length <= 120 && TEXT_LINE_RE.test(trimmed)) {
            if (/[a-z][A-Z]/.test(trimmed)) continue; // camelCase identifier
            if (isIntentional(trimmed)) continue;
            report(file, i + 1, 'text', `>${trimmed}<`);
          }
        }
      }
    }

    // Script-only checks - intended to live inside <script> blocks.
    if (inScript) {
      // toastStore literals
      for (const m of line.matchAll(TOAST_RE)) {
        const value = m[2].trim();
        if (!value || !/^[A-Za-z]/.test(value) || isIntentional(value)) continue;
        report(file, i + 1, 'toast', `toastStore.*("${value}")`);
      }

      // prompt/confirm/alert literals
      for (const m of line.matchAll(PROMPT_RE)) {
        const value = m[2].trim();
        if (!value || !/^[A-Za-z]/.test(value) || isIntentional(value)) continue;
        report(file, i + 1, 'prompt', m[0].replace(/\s+/g, ' '));
      }

      // $t('…') || 'Literal fallback' expressions
      for (const m of line.matchAll(T_FALLBACK_RE)) {
        const value = m[2].trim();
        if (!value || !/^[A-Za-z]/.test(value) || isIntentional(value)) continue;
        report(file, i + 1, 'fallback', `$t(...) || "${value}"`);
      }
    }

    if (/<\/script>/.test(line)) inScript = false;
    if (/<\/style>/.test(line)) inStyle = false;
  }
}

/** Scan background TS for hard-coded notification/menu/tooltip literals. */
function scanTsFile(file: string): void {
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
  let inNotifCall = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (NOTIF_CALL_RE.test(line)) inNotifCall = true;
    if (inNotifCall) {
      for (const m of line.matchAll(NOTIF_PROP_RE)) {
        const value = m[3].trim();
        if (!value || !/^[A-Za-z]/.test(value) || isIntentional(value)) continue;
        report(file, i + 1, 'notification', `${m[1]}: "${value}"`);
      }
      // Template literals: flag when prose survives outside ${…} interpolation
      // (e.g. `Remove "${domain}" from Autofill Blocklist`).
      for (const m of line.matchAll(NOTIF_TPL_RE)) {
        const value = m[2].trim();
        if (!value) continue;
        const residue = value.replace(/\$\{[^}]*\}/g, '');
        if (!/[A-Za-z]{3,}/.test(residue) || isIntentional(residue)) continue;
        report(file, i + 1, 'notification', `${m[1]}: \`${value}\``);
      }
      if (NOTIF_CLOSE_RE.test(line)) inNotifCall = false;
    }
    // Omnibox suggestion descriptions (all background TS, not just tracked
    // call regions - they live in plain object literals).
    for (const m of line.matchAll(TS_DESC_RE)) {
      const value = m[2].trim();
      if (!value || !/^[A-Za-z]/.test(value) || isIntentional(value)) continue;
      if (/^[a-z][a-zA-Z0-9.]*$/.test(value)) continue; // identifier-like value
      report(file, i + 1, 'notification', `description: "${value}"`);
    }
  }
}

/**
 * Content-script scan - DOM text/attribute assignments built by hand:
 * `label.textContent = 'Done ✓'`, `el.title = 'Copy'`, `chip.textContent =
 * 'Autofilling… 12s'`. These are user-visible copy in the injected shadow-DOM
 * UI and previously invisible to every scan. Skipped: already-localized
 * values containing t()/tSync(), icon-only tokens (⚡ ✎ 1C), format strings
 * like '0:00', and template literals that are pure data ("${address}").
 */
const DOM_TEXT_ASSIGN_RE =
  /\.(textContent|innerText|placeholder|title)\s*=\s*(['"`])([^'"`\n]*)\2/g;

function scanContentFile(file: string): void {
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\bt\(\s*['"]|\btSync\(\s*['"]/.test(line)) continue; // already localized
    for (const m of line.matchAll(DOM_TEXT_ASSIGN_RE)) {
      const value = m[3].trim();
      if (!value) continue;
      // Icon-only / decorative tokens, countdown formats, URLs
      if (!/[A-Za-z]/.test(value)) continue;
      if (/^[0-9:.,%]+$/.test(value)) continue;
      if (isIntentional(value)) continue;
      // Data-only template: interpolation without a static prose word
      if (value.includes('${') && !/[A-Za-z]{3,}/.test(value.replace(/\$\{[^}]*\}/g, ''))) continue;
      report(file, i + 1, 'content-dom', `${m[1]} = "${value}"`);
    }
  }
}

/**
 * Feature-file error/result copy. These literals are returned to toasts and
 * dialogs but live in .ts files outside the .svelte, background-notification,
 * and content-DOM scans - which is exactly how "This provider does not support
 * mailbox re-authentication" and "Incorrect password or corrupted backup file"
 * regrew. Matched forms:
 *
 *   1. `throw new Error('…')` / `new Error('…')` - single-line, and (via a
 *      small region tracker) multi-line `throw new Error(\n  '…'\n)` bodies.
 *   2. `{ error: '…' }` / `{ message: '…' }` result literals.
 *   3. `|| 'fallback'` on error-related lines (result?.error || 'Delete failed').
 *
 * SURFACE-AWARE EXEMPTION - not every error literal reaches a user. A thrown
 * Error is only user-facing if something RENDERS it. Throws inside a `try`
 * block are therefore deferred until the block's `catch` is classified:
 *
 *   • catch only LOGS (`logError` / `console.*`) or shows a LOCALIZED generic
 *     (`showToast(await t('toasts.xFailed'))`) → dev diagnostic, exempt. This
 *     is the project-endorsed pattern: localized generic + logged detail.
 *   • catch displays the raw error (toast/showError of `e.message`, error
 *     result assignment), RETHROWS, or INTERPOLATES the message into a
 *     localized sentence (`t('…Failed', { msg })`) → the English reaches the
 *     screen; the finding stands.
 *   • Result literals and `||` fallbacks are display-bound by definition and
 *     never exempt.
 *
 * Heuristic limits (documented, conservative): promise `.catch(() => …)`
 * handlers are not tracked; nested try/catch attributes a throw to the
 * OUTER catch; a catch body whose braces never balance before EOF flushes
 * its deferred findings as findings.
 *
 * Internal enum codes (`reason: 'sticky'`, `'domain_hint'`, `'ok'`) and
 * single-token statuses are skipped: prose must start uppercase and contain
 * whitespace. Known limitation: concatenated multi-line strings are reported
 * per-fragment, and template literals spanning lines are not caught.
 */
const ERROR_CTOR_RE = /(?:throw\s+)?new\s+Error\s*\(\s*(['"`])([^'"`\n]*?)\1/g;
const ERROR_PROP_RE = /\b(?:error|message)\s*:\s*(['"`])([^'"`\n]*?)\1/g;
const ERROR_FALLBACK_RE = /\|\|\s*(['"`])([^'"`\n]*?)\1/g;
const ANY_STRING_RE = /(['"`])([^'"`\n]*?)\1/g;

// ── Catch-handler classification (surface-aware exemption) ─────────────────

/** Catch-body lines that RENDER the error: toasts, dialogs, notifications, error slots. */
const CATCH_DISPLAY_RE =
  /\b(?:toastStore|showToast|showError|notify|setShowToast|createBrowserNotification|onError|parseError|confirm|alert)\b|\b(?:item|res|result)\.error\s*=/;

/** Catch-body lines that only LOG - the English stays in devtools. */
const CATCH_LOG_ONLY_RE =
  /\b(?:logError|logWarn|logInfo|logDebug|console\.(?:error|warn|info|log|debug))\s*\(/;

/** A localized message in the catch (generic copy - not the raw error). */
const CATCH_LOCALIZED_MSG_RE = /\b(?:t|tSync|\$t)\s*\(\s*['"`][A-Za-z][\w.]*['"`]/;

/** The error message is interpolated into copy (`{ msg }`, `${err…}`, `msg:`). */
const CATCH_MSG_INTERP_RE = /\{\s*(?:msg|message|error|e|err)\b|\bmsg\s*[:=}]|\$\{/;

/** True when a literal reads as sentence-cased user-facing prose. */
function isProseLiteral(value: string): boolean {
  const v = value.trim();
  if (v.length < 4) return false;
  if (!/^[A-Z]/.test(v)) return false; // sentence-cased
  if (!/\s/.test(v)) return false; // two or more words
  if (!/[A-Za-z]{3,}/.test(v)) return false;
  if (ALLOWLIST.has(v)) return false;
  if (/^(https?:\/\/|\/|www\.)/i.test(v)) return false; // URLs / paths
  if (/^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(v)) return false; // emails
  if (/^Mozilla\/5\.0/i.test(v)) return false; // UA strings
  if (/^(bunx|bun|npm|npx|pnpm|yarn|node|python|pip)\s+\S/.test(v)) return false; // shell cmds
  return true;
}

function scanFeatureFile(file: string): void {
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
  let inErrorCtor = false;

  // ── Surface-aware tracking ─────────────────────────────────────────────
  // The innermost open `try {` region and its catch classification.
  let inTry = false;
  let tryOpenLine = -1;
  let tryBraces = 0;

  interface DeferredFinding {
    lineNo: number;
    text: string;
  }
  /** Findings inside a try block, kept until its catch is classified. */
  const deferredByTry = new Map<number, DeferredFinding[]>();

  /** Classification of the catch handler belonging to `tryOpenLine`. */
  interface PendingCatch {
    ownerTry: number;
    headerLine: number;
    bodyDepth: number;
    closed: boolean;
    display: boolean;
    rethrow: boolean;
    logOnly: boolean;
    localized: boolean;
    msgInterp: boolean;
  }
  let pendingCatch: PendingCatch | null = null;

  const defer = (ownerTry: number, lineNo: number, text: string): void => {
    const list = deferredByTry.get(ownerTry);
    if (list) list.push({ lineNo, text });
    else deferredByTry.set(ownerTry, [{ lineNo, text }]);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Lines already using the i18n store are localized.
    if (/\b(?:t|tSync)\s*\(\s*['"]/.test(line)) continue;

    // ── Classify the open catch handler, line by line ────────────────────
    if (pendingCatch && !pendingCatch.closed) {
      if (CATCH_DISPLAY_RE.test(line)) pendingCatch.display = true;
      if (/\bthrow\b/.test(line)) pendingCatch.rethrow = true;
      if (CATCH_LOG_ONLY_RE.test(line)) pendingCatch.logOnly = true;
      if (CATCH_LOCALIZED_MSG_RE.test(line)) pendingCatch.localized = true;
      if (CATCH_MSG_INTERP_RE.test(line)) pendingCatch.msgInterp = true;
      pendingCatch.bodyDepth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (i > pendingCatch.headerLine && pendingCatch.bodyDepth <= 0) {
        pendingCatch.closed = true;
        // Dev-only surface: the thrown English is never rendered.
        const exempt =
          !pendingCatch.rethrow &&
          !(pendingCatch.display && !pendingCatch.localized) &&
          !(pendingCatch.localized && pendingCatch.msgInterp);
        if (exempt) deferredByTry.delete(pendingCatch.ownerTry);
        pendingCatch = null;
      }
    }

    // ── Track `try {` regions ────────────────────────────────────────────
    if (!inTry && /(?:^|[^\w])try\s*\{/.test(line)) {
      inTry = true;
      tryOpenLine = i;
      tryBraces = 0;
    }
    if (inTry) {
      tryBraces += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (/\bcatch\s*(?:\(|\{)/.test(line)) {
        pendingCatch = {
          ownerTry: tryOpenLine,
          headerLine: i,
          bodyDepth: 0,
          closed: false,
          display: false,
          rethrow: false,
          logOnly: false,
          localized: false,
          msgInterp: false,
        };
        inTry = false;
      } else if (i > tryOpenLine && tryBraces <= 0) {
        inTry = false; // try/finally without catch - findings stand
      }
    }

    /** Report immediately, or defer while inside a tracked try block. */
    const reportError = (lineNo: number, text: string): void => {
      if (inTry) defer(tryOpenLine, lineNo, text);
      else report(file, lineNo, 'error-string', text);
    };

    // Enter a multi-line `throw new Error(` region (single-line forms still
    // close on the same line, so they're handled by ERROR_CTOR_RE below).
    const opensError = /(?:throw\s+)?new\s+Error\s*\(/.test(line);
    if (opensError && !line.includes(')')) inErrorCtor = true;

    for (const m of line.matchAll(ERROR_CTOR_RE)) {
      if (isProseLiteral(m[2])) {
        reportError(i + 1, m[0].replace(/\s+/g, ' ').trim());
      }
    }

    for (const m of line.matchAll(ERROR_PROP_RE)) {
      if (isProseLiteral(m[2])) {
        report(file, i + 1, 'error-string', `${m[1]}: "${m[2]}"`); // result copy: display-bound
      }
    }

    if (/\b(?:error|Error|throw)\b/.test(line)) {
      for (const m of line.matchAll(ERROR_FALLBACK_RE)) {
        if (isProseLiteral(m[2])) {
          // A fallback on a THROW line shares the throw's fate (its catch
          // governs whether the English ever renders); a fallback on a
          // result-building line is display-bound and always reported.
          if (/\bthrow\b/.test(line)) reportError(i + 1, `|| "${m[2]}"`);
          else report(file, i + 1, 'error-string', `|| "${m[2]}"`);
        }
      }
    }

    // Inside a multi-line error constructor, every sentence-cased literal is copy.
    if (inErrorCtor) {
      for (const m of line.matchAll(ANY_STRING_RE)) {
        if (isProseLiteral(m[2])) {
          reportError(i + 1, `"${m[2]}"`);
        }
      }
    }

    if (inErrorCtor && line.includes(')')) inErrorCtor = false;
  }

  // Unclassified try regions (no catch found / unbalanced braces): flush.
  for (const [, list] of deferredByTry) {
    for (const d of list) report(file, d.lineNo, 'error-string', d.text);
  }
}

function main(): void {
  for (const file of collectAbsoluteFiles(SRC_DIR, ['.svelte'])) {
    scanFile(file);
  }

  // Markup that is not a component is still markup: the entrypoint HTML pages,
  // the pages under `public/` that the extension ships verbatim, and the demo
  // signup pages it opens are all rendered by the same rules, so a JS comment
  // left in one is text on screen exactly as it is in a `.svelte` template. This
  // is the comment rule only - the attribute, text-node and `<script>` layers
  // above are component-shaped. (`tests/**/*.html` is deliberately out: those are
  // host-page fixtures a test feeds to the content script, never rendered by us.)
  for (const file of collectAbsoluteFiles(SRC_DIR, ['.html'])) {
    reportRenderedComments(file);
  }
  for (const file of collectAbsoluteFiles(DEMO_DIR, ['.html'])) {
    reportRenderedComments(file);
  }
  for (const file of collectAbsoluteFiles(PUBLIC_DIR, ['.html'])) {
    reportRenderedComments(file);
  }

  // Background notifications / context menus / toolbar tooltips / omnibox
  // suggestions are user-facing too - the .svelte scan never saw them, which
  // is exactly how "Temp Email Created" slipped through.
  for (const file of collectAbsoluteFiles(join(SRC_DIR, 'entrypoints', 'background'), ['.ts'])) {
    scanTsFile(file);
  }

  // Content scripts build their injected UI with DOM assignments - same
  // user-facing copy, same scan gap (e.g. the "Autofilling… / Done ✓" pill).
  for (const file of collectAbsoluteFiles(join(SRC_DIR, 'entrypoints', 'content'), ['.ts'])) {
    scanContentFile(file);
  }

  // Feature files return error/result copy to toasts and dialogs - the
  // .svelte / background / content scans never saw it (e.g. WebDAV validation
  // errors, re-auth failure messages).
  for (const file of collectAbsoluteFiles(join(SRC_DIR, 'features'), ['.ts'])) {
    scanFeatureFile(file);
  }

  if (findings.length > 0) {
    console.error(`Hardcoded user-facing English detected (${findings.length}):`);
    for (const f of findings) console.error(`  ${f}`);
    console.error(
      '\nLocalize with locale keys ($t/tSync), or return a stable code the UI maps. ' +
        'There is no path-level ignore list.'
    );
    process.exit(1);
  }
  console.log(
    'No hardcoded user-facing English found in .svelte or markup pages, background notifications, content-script DOM assignments, or feature-file error strings.'
  );
}

if (import.meta.main) main();
