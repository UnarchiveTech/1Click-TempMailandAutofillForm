/**
 * source-lexer.ts - the one answer to "what counts as code?"
 *
 * Every source scanner in `scripts/` has to decide, for a given file, which
 * bytes are *code* and which are prose or data: comments to skip, strings whose
 * contents are values rather than syntax, template literals whose `${…}`
 * interiors are code again, regex literals, and Svelte markup prose. Each
 * scanner used to answer that for itself, and they disagreed - the same file
 * could be "code" to one gate and "comment" to the next:
 *
 *   - `//` inside `'https://…'` read as a line comment (naive `replace()`);
 *   - an apostrophe in Svelte prose (`Don't`) or a `/['"]/` regex swallowed
 *     every following line as one unterminated string;
 *   - `a / b` division or `accept="image/*"` read as a regex / block comment;
 *   - a tooltip assembled inside `` `${…}` `` counted as code by one scanner
 *     and as inert template text by another;
 *   - `<!-- -->` handled in markup but not inside `<script>`.
 *
 * This module classifies a source file **once** and hands back three views of
 * that single pass, so two scanners reading the same file cannot disagree:
 *
 *   - `code`     - the source with comment *bodies* blanked (length and line
 *                  count preserved, so every reported line number still points
 *                  at the real line). String bodies survive verbatim: a scanner
 *                  looking for hardcoded English has to see inside them.
 *   - `inString` - 1 for bytes inside a quoted string or the static text of a
 *                  template. This is what lets a scanner tell `t('nav.mailbox')`
 *                  from the *text* of `"t('nav.mailbox')"`.
 *   - `inCode`   - 1 for bytes that are code: everything that is neither a
 *                  comment, nor string/template text, nor a regex body.
 *                  `${…}` interiors are code, because they are.
 *
 * Dialects: one JS/TS classifier covers `.ts`, `.js`, `.mjs` and the `<script>`
 * and markup regions of `.svelte`, which is what the scanners actually need.
 * Markup text is code to this lexer - the scanners that care about markup
 * regions track `<script>`/`<style>` themselves. HTML comments (`<!-- -->`) are
 * recognized everywhere, because a `.svelte` file's comments are HTML comments
 * and a `<!-- -->` inside a `<script>` block is still a comment to a reader.
 *
 * Three deliberate approximations, each of which is *exact* for JavaScript and
 * only approximate for prose, keep one bad guess from cascading to the end of
 * the file:
 *
 *   - a quoted string must close **on its own line** - which a JS string
 *     literal always does - so the apostrophe in Svelte prose (`Don't`) or in a
 *     `/['"]/` regex is never treated as an unclosed string;
 *   - a `/` is a regex only where one can start (after `=`, `(`, `,`, `:`, `!`,
 *     `&`, `|`, `?` …), so division and `image/*` stay code;
 *   - to the same end, a regex literal must also close on its own line (a JS
 *     regex cannot span lines).
 *
 * Template literals do span lines, and their `${…}` interiors are scanned as
 * code recursively, so a call assembled inside an interpolation stays visible.
 *
 * Usage:
 *   import { analyzeSource, stripComments } from './source-lexer';
 *   const { code, inCode, inString } = analyzeSource(raw);
 */

export interface SourceAnalysis {
  /** Source with comment bodies blanked: same length, same line count. */
  code: string;
  /** 1 for bytes inside a quoted string or the static text of a template. */
  inString: Uint8Array;
  /** 1 for bytes that are code (not comment, string/template text, or regex). */
  inCode: Uint8Array;
}

export function analyzeSource(src: string): SourceAnalysis {
  const out = src.split('');
  const inString = new Uint8Array(src.length);
  const inCode = new Uint8Array(src.length).fill(1);
  const markString = (from: number, to: number) => {
    for (let k = Math.max(0, from); k <= to && k < src.length; k += 1) inString[k] = 1;
  };
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < out.length; i += 1) {
      if (out[i] !== '\n') out[i] = ' ';
    }
  };
  /** Data, not syntax: the bytes stop being code (they may also be a string). */
  const clearCode = (from: number, to: number) => {
    for (let k = Math.max(0, from); k <= to && k < src.length; k += 1) inCode[k] = 0;
  };
  const lineEnd = (i: number) => {
    const end = src.indexOf('\n', i);
    return end === -1 ? src.length : end;
  };

  /** Quoted string ending on this line, or -1 (an apostrophe, not a string). */
  const skipQuoted = (i: number): number => {
    const quote = src[i];
    const stop = lineEnd(i);
    let j = i + 1;
    while (j < stop) {
      if (src[j] === '\\') {
        j += 2;
        continue;
      }
      if (src[j] === quote) {
        markString(i, j);
        clearCode(i, j);
        return j + 1;
      }
      j += 1;
    }
    return -1;
  };

  /** Regex literal ending on this line, or -1. */
  const skipRegex = (i: number): number => {
    const stop = lineEnd(i);
    let inClass = false;
    let j = i + 1;
    while (j < stop) {
      const char = src[j];
      if (char === '\\') {
        j += 2;
        continue;
      }
      if (char === '[') inClass = true;
      else if (char === ']') inClass = false;
      else if (char === '/' && !inClass) {
        clearCode(i, j);
        return j + 1;
      }
      j += 1;
    }
    return -1;
  };

  /** A `/` here starts a regex when the previous significant char can precede one. */
  const regexAllowedAt = (i: number): boolean => {
    // `</` is a CLOSING TAG, never a regex opener. JavaScript cannot spell one
    // directly after a `<` either (`a</re/` is not source anyone writes), so
    // this costs the dialect nothing - while reading it as a regex did real
    // damage: `</span> // note` scanned `/span> /` as a regex literal, so the
    // rest of that line stayed "code" and a genuine `//` comment in markup was
    // invisible to every scanner (both the text-node layer and the
    // rendered-comment rule read a comment as `code[i] !== raw[i]`).
    if (src[i - 1] === '<') return false;
    let k = i - 1;
    while (k >= 0 && /\s/.test(src[k])) k -= 1;
    return k < 0 || '([{,;:=!&|?+-*%~^<>'.includes(src[k]);
  };

  /**
   * Template literal: its text is data, its `${…}` interiors are code. Returns
   * the index just past the closing backtick (or the end of the file).
   */
  const skipTemplate = (i: number): number => {
    let j = i + 1;
    let textStart = i;
    while (j < src.length) {
      const ch = src[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === '`') {
        markString(textStart, j);
        clearCode(textStart, j);
        return j + 1;
      }
      if (ch === '$' && src[j + 1] === '{') {
        markString(textStart, j - 1);
        clearCode(textStart, j - 1);
        const after = scanCode(j + 2, true);
        textStart = after;
        j = after;
        continue;
      }
      j += 1;
    }
    markString(textStart, src.length - 1);
    clearCode(textStart, src.length - 1);
    return src.length;
  };

  /** Scans code, recursing through interpolations; stops past a `}` in brace mode. */
  const scanCode = (start: number, stopAtBrace: boolean): number => {
    let depth = 0;
    let i = start;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '/' && src[i + 1] === '/') {
        const stop = lineEnd(i);
        blank(i, stop);
        clearCode(i, stop - 1);
        i = stop;
        continue;
      }
      if (ch === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2);
        const stop = end === -1 ? src.length : end + 2;
        blank(i, stop);
        clearCode(i, stop - 1);
        i = stop;
        continue;
      }
      if (ch === '<' && src.startsWith('<!--', i)) {
        const end = src.indexOf('-->', i + 4);
        const stop = end === -1 ? src.length : end + 3;
        blank(i, stop);
        clearCode(i, stop - 1);
        i = stop;
        continue;
      }
      if (ch === '/' && regexAllowedAt(i)) {
        const end = skipRegex(i);
        if (end !== -1) {
          i = end;
          continue;
        }
      }
      if (ch === "'" || ch === '"') {
        const end = skipQuoted(i);
        i = end === -1 ? i + 1 : end;
        continue;
      }
      if (ch === '`') {
        i = skipTemplate(i);
        continue;
      }
      if (stopAtBrace) {
        if (ch === '{') depth += 1;
        else if (ch === '}') {
          if (depth === 0) return i + 1;
          depth -= 1;
        }
      }
      i += 1;
    }
    return src.length;
  };

  scanCode(0, false);
  return { code: out.join(''), inString, inCode };
}

/**
 * The source with comment bodies blanked, strings and code intact - for
 * scanners that match patterns anywhere in a file and must not read prose
 * inside a comment as syntax (`// mock.restore()`, `/* label: 'Save' *​/`).
 */
export function stripComments(src: string): string {
  return analyzeSource(src).code;
}

/**
 * The source with comments, strings, template text and regex literals blanked -
 * syntax only, same length and line count. For scanners asking "does this file
 * *do* X?" rather than "does this file *say* X?" (`mock.module(`, `sendMessage(`),
 * where a mention inside a string or a comment must not count as a call.
 */
export function codeOnly(src: string): string {
  const { code, inCode } = analyzeSource(src);
  const chars = code.split('');
  for (let i = 0; i < chars.length; i += 1) {
    if (inCode[i] === 0 && chars[i] !== '\n') chars[i] = ' ';
  }
  return chars.join('');
}
