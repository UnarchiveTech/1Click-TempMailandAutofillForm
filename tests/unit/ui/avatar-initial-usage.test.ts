/**
 * Regression guard for avatar-initial deduplication.
 *
 * Every avatar letter must come from the shared code-point-safe helper
 * (`src/utils/theme/avatar-initials.js`). MailboxView and FilterList previously
 * carried their own extraction - a local `getInitial` function, inline
 * `Array.from(...)[0]` expressions, and `fallbackLetter={...[0]...}`
 * derivations. Those copies were not surrogate-pair safe (an emoji or CJK
 * first character was split into a lone surrogate) and could drift from the
 * shared contract, so this source scan fails if one is reintroduced.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');

const SURFACES = [
  'src/ui/views/mailbox/MailboxView.svelte',
  'src/ui/blocks/mail/FilterList.svelte',
] as const;

/** Single-initial derivations that bypass the shared helper. */
const INLINE_INITIAL_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'Array.from(...)[0]', re: /Array\.from\([^\n]*?\)\s*\[\s*0\s*\]/ },
  { label: 'charAt(0)', re: /\.charAt\(0\)/ },
  { label: '[0].toUpperCase()', re: /\[\s*0\s*\]\??\.\s*toUpperCase\(\)/ },
  { label: 'a local getInitial helper', re: /function\s+getInitial\b/ },
];

const SHARED_IMPORT = "import { avatarInitial } from '@/utils/theme/avatar-initials.js'";

describe('avatar initials are routed through the shared helper', () => {
  for (const rel of SURFACES) {
    describe(rel, () => {
      const src = readFileSync(join(ROOT, rel), 'utf8');

      test('imports avatarInitial from the shared module', () => {
        expect(src).toContain(SHARED_IMPORT);
      });

      for (const { label, re } of INLINE_INITIAL_PATTERNS) {
        test(`has no inline initial via ${label}`, () => {
          const match = src.match(re);
          expect(match?.[0] ?? null).toBeNull();
        });
      }
    });
  }
});
