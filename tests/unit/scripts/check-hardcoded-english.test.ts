/**
 * Unit tests for the markup-comment rule in scripts/check-hardcoded-english.ts.
 *
 * A JS comment in markup position is not a comment to Svelte: everything outside
 * `<script>`/`<style>` is template text, so the block renders verbatim - a
 * paragraph of English drawn above (or between) the elements it was written to
 * document. It shipped that way in `ListSelectionBar.svelte`, and the whole gate
 * suite missed it for a structural reason worth pinning here: every scanner reads
 * files through `stripComments()` (`source-lexer.ts`), which correctly classifies
 * `/** … *​/` as a comment for a SCRIPT and therefore hides exactly the case where
 * the same syntax is markup. So this rule reads the RAW source.
 *
 * The rule covers every markup position, not only the top of the file: the same
 * `// note` dropped between two elements renders identically, and a fix that
 * only looked above `<script>` would let it through. The exemptions are as
 * load-bearing as the findings - `<!-- -->` (dropped by the compiler), a comment
 * inside a `{…}` expression (JS again), and the `<script>`/`<style>` bodies
 * themselves - because a rule that flagged those would be a rule people disable.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRenderedComments } from '../../../scripts/check-hardcoded-english';

const ROOT = process.cwd();

/** The reported lines, in order. */
function lines(source: string): number[] {
  return findRenderedComments(source).map((c) => c.line);
}

describe('findRenderedComments flags comments the compiler renders', () => {
  test('a doc block above <script>', () => {
    const source = ['/**', ' * Doc block.', ' */', '<script lang="ts">', 'let a = 1;'].join('\n');
    expect(findRenderedComments(source)).toEqual([{ line: 1, style: '/*' }]);
  });

  test('a line comment above <script>', () => {
    expect(lines(['// a leading line comment', '<script lang="ts">'].join('\n'))).toEqual([1]);
  });

  test('a comment BETWEEN elements, deep in the template', () => {
    // The shape the first version of this rule missed: markup is markup
    // wherever it sits, so a note between two blocks still renders.
    const source = [
      '<script lang="ts">',
      '  let open = false;',
      '</script>',
      '',
      '<div class="card">',
      '  <button>Toggle</button>',
      '  // TODO move this into a component',
      '  {#if open}',
      '    /* an explanation nobody sees, except everyone does */',
      '    <p>Innards</p>',
      '  {/if}',
      '</div>',
    ].join('\n');
    expect(lines(source)).toEqual([7, 9]);
  });

  test('only the OPENER of a leaked block is reported', () => {
    // One finding per block, or a 12-line doc block becomes twelve messages.
    const source = [
      '<div>',
      '/**',
      ' * Line two.',
      ' * Line three.',
      ' */',
      '  <span>x</span>',
      '</div>',
    ].join('\n');
    expect(findRenderedComments(source)).toEqual([{ line: 2, style: '/*' }]);
  });

  test('a comment before <style>, and one after it', () => {
    const before = ['/** Doc. */', '<style>', '  .a { color: red; }', '</style>'].join('\n');
    expect(lines(before)).toEqual([1]);
    const after = [
      '<script>let a = 1;</script>',
      '<style>.a { color: red; }</style>',
      '// back in markup',
      '<p>Hi</p>',
    ].join('\n');
    expect(lines(after)).toEqual([3]);
  });

  test('a comment in the markup of a plain HTML page counts too', () => {
    // Entrypoint HTML and the demo signup pages are rendered by the same rules.
    const page = [
      '<!DOCTYPE html>',
      '<body>',
      '  <div id="app"></div>',
      '  // boot the app',
      '  <script type="module" src="./index.ts"></script>',
      '</body>',
    ].join('\n');
    expect(lines(page)).toEqual([4]);
  });
});

describe('findRenderedComments leaves genuine comments alone', () => {
  test('a comment INSIDE the script tag is documentation', () => {
    const source = [
      '<script lang="ts">',
      '/**',
      ' * The correct place for this block.',
      ' */',
      '// and a line comment',
      '</script>',
    ].join('\n');
    expect(findRenderedComments(source)).toEqual([]);
  });

  test('a comment inside <style> is a CSS comment', () => {
    const source = [
      '<style>',
      '  /* .a { color: red } */',
      '  .b { color: blue; }',
      '</style>',
    ].join('\n');
    expect(findRenderedComments(source)).toEqual([]);
  });

  test('an HTML comment is dropped by the compiler, so its body is never a finding', () => {
    const source = [
      '<!-- a real markup comment -->',
      '<div>',
      '  <!--',
      '    a multi-line one, whose body includes a * and a / here',
      '  -->',
      '</div>',
      '<script>let a = 1;</script>',
    ].join('\n');
    expect(findRenderedComments(source)).toEqual([]);
  });

  test('a `//` inside a TEXT NODE is a finding - it is visible either way', () => {
    // The harder judgement: `<span>// text</span>` is not a comment in any
    // reading - the browser shows those two slashes. It is still a defect in
    // both readings, which is what the message says: a leaked comment if the
    // author meant one, un-localized English if they did not. Nothing else can
    // catch it either: the text-node layer reads `stripComments()`, which blanks
    // the very characters that make it visible.
    const source = ['<div>', '  <span>// and this is TEXT</span>', '</div>'].join('\n');
    expect(findRenderedComments(source)).toEqual([{ line: 2, style: '//' }]);
  });

  test('a `//` in the middle of a markup line, after an element', () => {
    // A line-leading rule could not see this one: the opener is not at the start
    // of anything, it simply follows `<span>`. Reading the lexer's blanking
    // instead of a line prefix is what makes it visible.
    const source = ['<div>', '  <span>x</span> // TODO wire this up', '</div>'].join('\n');
    expect(findRenderedComments(source)).toEqual([{ line: 2, style: '//' }]);
  });

  test('a comment inside a multi-line {…} expression is JavaScript again', () => {
    const source = [
      '<div>',
      '  {@const total = items',
      '    .map((i) => i.price)',
      '    // sum them up',
      '    .reduce((a, b) => a + b, 0)}',
      '  {total}',
      '</div>',
    ].join('\n');
    expect(findRenderedComments(source)).toEqual([]);
  });

  test('a one-line expression with a comment inside is not markup text', () => {
    const source = ['<div>', '  {@const x = 1 /* why not */}', '  {x}', '</div>'].join('\n');
    expect(findRenderedComments(source)).toEqual([]);
  });

  test('a URL-looking line in markup is not a comment', () => {
    // `https://…` is not a line-leading `//`, and protocol-relative hrefs are in
    // attributes; neither is a finding.
    const source = [
      '<a href="//example.test/path">Link</a>',
      '<p>See https://example.test</p>',
    ].join('\n');
    expect(findRenderedComments(source)).toEqual([]);
  });
});

describe('the premise holds: the compiler really does render these', () => {
  test('a markup comment reaches the generated HTML; a script comment does not', async () => {
    // The whole rule rests on "the compiler treats this as text", so the premise
    // is asserted against the real compiler rather than against my reading of
    // the docs. A static element compiles to one `from_html` template literal,
    // which is where a leaked comment shows up as content.
    const { compile } = await import('svelte/compiler');
    const emit = (src: string) =>
      compile(src, { filename: 'p.svelte', generate: 'client' }).js.code;

    /** Comment syntax as ELEMENT TEXT: right after a `>` or at the template's start. */
    const asElementText = />\s*(?:\/\/|\/\*)/;

    // Markup: the marker IS the element's text content.
    expect(emit('<div>\n  // LEAK_MARKER\n</div>')).toMatch(/from_html\(`<div>\/\/ LEAK_MARKER/);
    expect(emit('<div>\n  /* LEAK_MARKER */\n</div>')).toMatch(/from_html\(`<div>\/\* LEAK_MARKER/);

    // Script: the same text is a JS comment - present in the output, but never
    // inside the HTML string that becomes the DOM.
    const inScript = emit('<script>// LEAK_MARKER\nlet a = 1;</script><div>x</div>');
    expect(inScript).toContain('LEAK_MARKER');
    expect(inScript).not.toMatch(/from_html\(`[^`]*LEAK_MARKER/);

    // The corpus agrees with the compiler: no current component emits comment
    // syntax as element text. (A URL or an inline SVG legitimately contains
    // `//` - hence matching the SHAPE, text directly after `>`, rather than the
    // characters anywhere in the template.)
    for (const file of new Bun.Glob('src/**/*.svelte').scanSync({ cwd: ROOT })) {
      const js = emit(readFileSync(join(ROOT, file), 'utf8'));
      const leaked = [...js.matchAll(/from_html\(`([^`]*)`\)/g)].filter((m) =>
        asElementText.test(m[1])
      );
      expect([file, leaked.map((m) => m[1].slice(0, 80))]).toEqual([file, []]);
    }
  });
});

describe('no rendered comment ships in the app', () => {
  test('every component under src/ and every markup page is clean', () => {
    const offenders: string[] = [];
    const globs = ['src/**/*.svelte', 'src/**/*.html', 'demo/**/*.html', 'public/**/*.html'];
    for (const pattern of globs) {
      for (const file of new Bun.Glob(pattern).scanSync({ cwd: ROOT })) {
        const raw = readFileSync(join(ROOT, file), 'utf8');
        for (const comment of findRenderedComments(raw)) {
          offenders.push(`${file.replace(/\\/g, '/')}:${comment.line} (${comment.style})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
