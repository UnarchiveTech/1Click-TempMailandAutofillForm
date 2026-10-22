/**
 * Unit tests for `scripts/source-lexer.ts` - the single classifier behind every
 * source scanner.
 *
 * The lexer exists because several scanners used to answer "which bytes are code?"
 * for themselves, and disagreed: a `//` inside a URL, an apostrophe in Svelte
 * prose, a `/` that is division, `${…}` inside a template. The first two
 * describes pin the classification each scanner now shares; the last one pins
 * the *absence* of a second opinion, so a scanner cannot quietly grow its own
 * comment state machine again - the failure mode that made two gates read the
 * same file differently in the first place.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { analyzeSource, codeOnly, stripComments } from '../../../scripts/source-lexer';
import { PROJECT_ROOT } from '../helpers/project-root';

const SCRIPTS_DIR = join(PROJECT_ROOT, 'scripts');

/** Byte offset of `needle`'s first occurrence (fails loudly when absent). */
function at(src: string, needle: string): number {
  const index = src.indexOf(needle);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

/** How the lexer classifies the first byte of `needle`. */
function kindOf(src: string, needle: string): { code: number; string: number } {
  const { inCode, inString } = analyzeSource(src);
  const index = at(src, needle);
  return { code: inCode[index], string: inString[index] };
}

/** Every `.ts` file under `scripts/`, as repo-relative POSIX paths. */
function scriptFiles(dir: string = SCRIPTS_DIR, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) scriptFiles(full, out);
    else if (entry.endsWith('.ts')) out.push(relative(PROJECT_ROOT, full).split('\\').join('/'));
  }
  return out;
}

describe('stripComments - comment bodies are blanked, nothing else moves', () => {
  test('blanks every comment form while preserving length and line count', () => {
    const src = [
      "a() // t('in.lineComment')",
      "/* t('in.blockComment')",
      '   still a comment */',
      "<!-- t('in.htmlComment') -->",
      'done()',
      '',
    ].join('\n');
    const stripped = stripComments(src);

    expect(stripped.length).toBe(src.length);
    expect(stripped.split('\n').length).toBe(src.split('\n').length);
    expect(stripped).not.toContain('in.lineComment');
    expect(stripped).not.toContain('in.blockComment');
    expect(stripped).not.toContain('in.htmlComment');
    expect(stripped).toContain('done()');
  });

  test('string contents survive - a scanner must be able to read inside them', () => {
    const src = `const message = 'Delete this address?'; t('nav.mailbox');`;
    const stripped = stripComments(src);

    expect(stripped).toContain("'Delete this address?'");
    expect(stripped).toContain("t('nav.mailbox')");
  });

  test('a comment never leaks past its own line', () => {
    const src = "t('keep.me') // t('drop.me')\nt('also.keep.me')";
    const stripped = stripComments(src);

    expect(stripped).toContain("'keep.me'");
    expect(stripped).not.toContain('drop.me');
    expect(stripped).toContain("'also.keep.me'");
  });

  test('a URL literal is not mistaken for a line comment', () => {
    const src = "const u = 'https://host.example/path';\nt('nav.mailbox');";
    const stripped = stripComments(src);

    expect(stripped).toContain('https://host.example/path');
    expect(stripped).toContain("t('nav.mailbox')");
  });

  test('markup that merely looks like a comment is left alone', () => {
    // `image/*` is an attribute value, not the start of a block comment; if the
    // lexer treated it as one, the rest of the file would vanish from every scan.
    const src = '<input accept="image/*" type="file" />\n<button>Save</button>';
    const stripped = stripComments(src);

    expect(stripped).toContain('accept="image/*"');
    expect(stripped).toContain('<button>Save</button>');
  });

  test('a closing tag does not start a regex that swallows the rest of the line', () => {
    // `</span>` was read as a regex literal spanning `/span> /`, and that
    // consumed the `/` of a following `//` comment - so the comment stayed
    // "code" and was invisible to every scanner. A `//` after a closing tag is
    // exactly the markup comment that reaches the user as rendered text, which
    // is why check-hardcoded-english's rendered-comment rule depends on this.
    const src = '<div>\n  <span>x</span> // TODO wire this up\n</div>';
    const { code, inCode } = analyzeSource(src);

    expect(code).not.toContain('TODO wire this up');
    expect(inCode[at(src, '// TODO')]).toBe(0);
    // The tag itself remains markup, not data - a scanner still sees it.
    expect(inCode[at(src, '</span>')]).toBe(1);
    expect(code).toContain('</span>');
  });

  test('`a < /re/` is still a regex - only an ADJACENT `<` is a closing tag', () => {
    const src = 'const ok = a < /x/.test(b);';
    const { inCode } = analyzeSource(src);

    expect(inCode[at(src, '/x/')]).toBe(0);
    expect(inCode[at(src, 'a <')]).toBe(1);
  });

  test('a commented-out call is not code', () => {
    // The hardcoded-English and mock-restore gates both rely on this: prose or
    // parked code inside a comment must never count as a finding.
    const src = [
      "// throw new Error('Save failed');",
      '/* afterAll(() => { mock.restore(); }); */',
      "mock.module('x', () => ({}));",
    ].join('\n');
    const { inCode } = analyzeSource(src);

    expect(inCode[at(src, '// throw new Error')]).toBe(0);
    expect(inCode[at(src, 'mock.restore()')]).toBe(0);
    expect(inCode[at(src, 'mock.module')]).toBe(1);
  });
});

describe('codeOnly - syntax, without the places that merely mention it', () => {
  test('blanks quoted and commented mentions while leaving the call', () => {
    const src = [
      "// mock.module('a', () => ({}));",
      "const note = 'mock.restore() is required';",
      "mock.module('b', () => ({}));",
    ].join('\n');
    const syntax = codeOnly(src);

    expect(syntax.length).toBe(src.length);
    expect(syntax.split('\n').length).toBe(src.split('\n').length);
    // Exactly the one real call survives: the commented-out one and the quoted
    // one are prose about the call, not a call.
    expect(syntax.split('mock.module(').length - 1).toBe(1);
    expect(syntax.split('mock.restore()').length - 1).toBe(0);
  });

  test('a call is kept while its interpolated argument is blanked', () => {
    const src = `sendMessage(\`type: ${'x'}\`);`;
    const syntax = codeOnly(src);

    expect(syntax).toContain('sendMessage(');
    expect(syntax).not.toContain('type:');
  });
});

describe('classification - strings, templates, regexes and prose', () => {
  test('quoted strings are data, including their delimiters', () => {
    const src = "const k = 'nav.mailbox';";
    expect(kindOf(src, "'nav.mailbox'")).toEqual({ code: 0, string: 1 });
    expect(kindOf(src, 'const k')).toEqual({ code: 1, string: 0 });
  });

  test('template text is data while its interpolation is code again', () => {
    // The opening `${` is assembled from fragments: spelling it inside a plain
    // string trips lint/suspicious/noTemplateCurlyInString.
    const openInterp = ['$', '{'].join('');
    const src = `const t = \`Label: ${openInterp}t('nav.mailbox')} done\`;`;
    expect(kindOf(src, 'Label: ')).toEqual({ code: 0, string: 1 });
    expect(kindOf(src, '${')).toEqual({ code: 1, string: 0 });
    expect(kindOf(src, "'nav.mailbox'")).toEqual({ code: 0, string: 1 });
  });

  test('an unterminated template still classifies its text as data', () => {
    const src = 'const broken = `open and never closed';
    expect(kindOf(src, 'open and never closed')).toEqual({ code: 0, string: 1 });
  });

  test('a regex literal is not code, and not a string either', () => {
    const src = "const re = /['\"]/;\nt('nav.mailbox');";
    expect(kindOf(src, '/[\'"]/')).toEqual({ code: 0, string: 0 });
    expect(kindOf(src, "'nav.mailbox'")).toEqual({ code: 0, string: 1 });
  });

  test('division is not a regex, so the rest of the line stays code', () => {
    const src = "const half = total / 2; t('nav.mailbox');";
    expect(kindOf(src, '/ 2')).toEqual({ code: 1, string: 0 });
    expect(kindOf(src, 't(')).toEqual({ code: 1, string: 0 });
  });

  test('an apostrophe in Svelte prose does not swallow the following lines', () => {
    // The cross-line guard: a `'` with no partner on its own line is prose, not
    // an unterminated string. Without it, `Don't` here would turn every later
    // line into string content and silently disable the gate for the file.
    const src = ["<p>Don't worry</p>", '{#if ready}', "{t('nav.mailbox')}"].join('\n');
    const { inCode } = analyzeSource(src);

    expect(inCode[at(src, "Don't")]).toBe(1);
    expect(inCode[at(src, 't(')]).toBe(1);
    expect(inCode[at(src, '{#if')]).toBe(1);
  });

  test('HTML comments inside a script block are still comments', () => {
    const src = ['<script>', '<!--', "t('commented.out')", '-->', "t('live')", '</script>'].join(
      '\n'
    );
    const { inCode, inString } = analyzeSource(src);

    expect(inCode[at(src, "'commented.out'")]).toBe(0);
    // Past the `-->` the file is code again - the comment did not swallow it.
    expect(inCode[at(src, "t('live')")]).toBe(1);
    expect(inString[at(src, "'live'")]).toBe(1);
  });
});

describe('scanner wiring - one classifier, no second opinion', () => {
  /**
   * The scanners that must read the shared classification. If one is unwired it
   * silently goes back to guessing, which is how the gates drifted apart before.
   */
  const CONSUMERS = [
    'scripts/audit-row-surfaces.ts',
    'scripts/check-hardcoded-english.ts',
    'scripts/check-layer-tokens.ts',
    'scripts/check-locale-key-references.ts',
    'scripts/check-message-types.ts',
    'scripts/check-mock-restore.ts',
    'scripts/check-plural-keys.ts',
    'scripts/generate-background-locales.ts',
  ] as const;

  test('the classifier is implemented exactly once under scripts/', () => {
    const definers = scriptFiles().filter((path) =>
      // `function <name>(` or `export function <name>(` - a definition, not a call.
      /(?:^|\s)(?:export\s+)?function\s+(?:stripComments|analyzeSource|computeCodeMask)\s*\(/m.test(
        readFileSync(join(PROJECT_ROOT, path), 'utf8')
      )
    );

    expect(definers).toEqual(['scripts/source-lexer.ts']);
  });

  test('no scanner keeps its own comment-state machine', () => {
    const offenders = scriptFiles().filter((path) => {
      if (path === 'scripts/source-lexer.ts') return false;
      return /\blet\s+(?:inComment|inHtmlComment|inJsBlockComment|lineComment|blockComment)\b/.test(
        readFileSync(join(PROJECT_ROOT, path), 'utf8')
      );
    });

    expect(offenders).toEqual([]);
  });

  test('every scanner imports the shared classifier', () => {
    const unwired = CONSUMERS.filter(
      (path) => !/from\s+'\.\/source-lexer'/.test(readFileSync(join(PROJECT_ROOT, path), 'utf8'))
    );

    expect(unwired).toEqual([]);
  });
});
