/**
 * Unit tests for the pseudo-overlay rule scanner in scripts/check-pseudo-overlays.ts.
 *
 * findPseudoOverlayViolations() is the pure core behind the Svelte `<style>`,
 * `.css`, and TS string-literal scans (the file-level scanners only add line
 * mapping + file iteration). These tests pin the CSS parsing and the
 * violation predicate: a rule is flagged when its selector is ::before/::after,
 * its content is empty (decorative), it is positioned absolute/fixed, and it
 * does NOT declare `pointer-events: none`.
 *
 * Fixtures cover the shapes that occur in the codebase and the ones that
 * regressed in the past: top-level rules, rules nested inside @media, CSS
 * nesting (`&::after`), comments/decoy prose, and the safe patterns that must
 * never be flagged (EmailBody-style inline glyphs, positioned pseudos that
 * already carry pointer-events: none, and pseudos with real content).
 */

import { describe, expect, test } from 'bun:test';
import {
  findMarkdownCssViolations,
  findPseudoOverlayViolations,
  isPseudoOverlayViolation,
  scanRules,
} from '../../../scripts/check-pseudo-overlays';

/** Selectors of the flagged rules, in order. */
function flaggedSelectors(css: string): string[] {
  return findPseudoOverlayViolations(css).map((r) => r.selector);
}

describe('check-pseudo-overlays scanRules', () => {
  test('keeps selector offsets correct across multiline text', () => {
    const css = '.a { color: red; }\n.b::before {\n  content: "";\n  position: absolute;\n}\n';
    const rules = scanRules(css);
    expect(rules.map((r) => r.selector)).toEqual(['.a', '.b::before']);
    const idx = rules.findIndex((r) => r.selector === '.b::before');
    expect(idx).toBeGreaterThan(-1);
    // '.b::before' begins after '.a { color: red; }\n' - offset must be exact.
    const start = rules[idx].selectorOffset;
    expect(css.slice(start, start + '.b::before'.length)).toBe('.b::before');
  });

  test('braces inside quoted strings and comments do not confuse the scanner', () => {
    const css = [
      '.a::after { content: "{ }"; }',
      '.b::before { /* content: "} */ color: red; }',
      '.c { content: "}"; }',
    ].join('\n');
    const rules = scanRules(css);
    expect(rules.map((r) => r.selector)).toEqual(['.a::after', '.b::before', '.c']);
    // Each rule must parse as ONE complete unit (its body ends at the real
    // closing brace, not at a `}` inside a quoted string or comment) - if the
    // scanner split early, the body would end mid-declaration.
    expect(rules.every((r) => r.body.trim().endsWith(';'))).toBe(true);
  });
});

describe('check-pseudo-overlays violations', () => {
  test('flags a top-level decorative positioned pseudo without pointer-events', () => {
    const css = `
.overlay::before {
  content: "";
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.1);
}
.plain { color: red; }
`;
    expect(flaggedSelectors(css)).toEqual(['.overlay::before']);
  });

  test('flags ::after too, and fixed positioning counts as positioned', () => {
    const css = ".float::after { content: ''; position: fixed; inset: 0; }";
    expect(flaggedSelectors(css)).toEqual(['.float::after']);
  });

  test('flags violations nested inside @media', () => {
    const css = `
@media (min-width: 800px) {
  .media::before {
    content: "";
    position: absolute;
    inset: 0;
  }
  .safe::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
}
`;
    expect(flaggedSelectors(css)).toEqual(['.media::before']);
  });

  test('flags CSS-nested pseudos (&::after) inside a parent rule', () => {
    const css = `
.card {
  position: relative;
  &::after {
    content: "";
    position: fixed;
    inset: 0;
  }
}
.card::before {
  content: "";
  position: absolute;
}
`;
    expect(flaggedSelectors(css)).toEqual(['&::after', '.card::before']);
  });

  test('flags comma-grouped pseudo selectors as one rule', () => {
    const css = '.a::before, .b::after { content: ""; position: absolute; }';
    expect(flaggedSelectors(css)).toEqual(['.a::before, .b::after']);
  });

  test('a legacy single-colon pseudo selector is flagged too', () => {
    const css = '.old:before { content: ""; position: absolute; }';
    expect(flaggedSelectors(css)).toEqual(['.old:before']);
  });
});

describe('check-pseudo-overlays safe patterns (never flagged)', () => {
  test('positioned decorative pseudo WITH pointer-events: none is safe', () => {
    const css = `
.glass::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 3;
}
`;
    expect(flaggedSelectors(css)).toEqual([]);
  });

  test('non-positioned content glyph (EmailBody ↗ marker) is safe', () => {
    const css =
      'a[href]::after { content: "↗"; display: inline-block; margin-inline-start: 0.2em; }';
    expect(flaggedSelectors(css)).toEqual([]);
  });

  test('positioned pseudo with real (non-empty) content is safe', () => {
    const css = '.badge::after { content: "●"; position: absolute; top: -2px; }';
    expect(flaggedSelectors(css)).toEqual([]);
  });

  test('a pseudo in a comment (prose/decoy) is never parsed as a rule', () => {
    const css = `
/* .decoy::before { content: ''; position: absolute; inset: 0; } */
.decoy-caption::after { content: ""; position: absolute; pointer-events: none; }
`;
    expect(flaggedSelectors(css)).toEqual([]);
  });

  test('no pseudo selector at all yields no violations', () => {
    const css = '.a { position: absolute; } .b::marker { content: ""; }';
    expect(flaggedSelectors(css)).toEqual([]);
  });
});
describe('check-pseudo-overlays isPseudoOverlayViolation', () => {
  test('predicate is true only for the full hazard combination', () => {
    const flag = (body: string) => isPseudoOverlayViolation({ selector: '.x::before', body });
    expect(flag('content: ""; position: absolute; inset: 0;')).toBe(true);
    expect(flag('content: ""; position: absolute; pointer-events: none;')).toBe(false);
    expect(flag('content: "text"; position: absolute;')).toBe(false);
    expect(flag('position: absolute; inset: 0;')).toBe(false); // no content at all
    expect(flag('content: ""; display: inline-block;')).toBe(false); // not positioned
  });
});

describe('check-pseudo-overlays markdown code fences', () => {
  test('flags a bad CSS example inside a css fence at its real line', () => {
    const md = [
      '# Docs',
      '',
      'Prose mentioning `::before` must be ignored.',
      '',
      '```css',
      '.rim::before {',
      '  content: "";',
      '  position: absolute;',
      '  pointer-events: none;',
      '}',
      '',
      '```',
      '```css',
      '.trap::after {',
      '  content: "";',
      '  position: absolute;',
      '  inset: 0;',
      '}',
      '```',
    ].join('\n');
    // .rim is safe; .trap (line 14) must be flagged - prose above is ignored.
    expect(findMarkdownCssViolations(md)).toEqual([{ line: 14, selector: '.trap::after' }]);
  });

  test('non-CSS fences and prose are never scanned', () => {
    const md = [
      '```ts',
      'const sel = ".x::before { content: \'\'; position: absolute; }";',
      '```',
      '',
      'An inline mention: `.y::after { content: ""; position: fixed; }` stays prose.',
    ].join('\n');
    expect(findMarkdownCssViolations(md)).toEqual([]);
  });

  test('svelte and html fences are scanned too (only <style> inner text)', () => {
    const md = [
      '```svelte',
      '<style>',
      '.card::before {',
      '  content: "";',
      '  position: absolute;',
      '}',
      '</style>',
      '```',
      '',
      '```html',
      '<style>',
      '.badge::after { content: ""; position: absolute; pointer-events: none; }',
      '</style>',
      '```',
    ].join('\n');
    expect(findMarkdownCssViolations(md)).toEqual([{ line: 3, selector: '.card::before' }]);
  });

  test('unclosed CSS fences still scan to EOF and report real lines', () => {
    const md = ['```css', '.open::before {', '  content: "";', '  position: absolute;', '}'].join(
      '\n'
    );
    expect(findMarkdownCssViolations(md)).toEqual([{ line: 2, selector: '.open::before' }]);
  });
});
