/**
 * The avatar size scale's own arithmetic, recomputed rather than restated.
 *
 * `AVATAR_BOX` / `AVATAR_INK` are Tailwind class strings, so they can drift from
 * the px values they claim to be. Every assertion here derives the expected
 * class from the tier's px (Tailwind's `w-N` is N × 4px) - a tier that ships a
 * box of a different size fails, and so does an ink glyph that does not fit
 * inside its own box.
 *
 * The last test is the wiring one: the four list surfaces that show the same
 * thing - a row's leading avatar - must all take the SAME tier, which is the
 * bug this scale exists to prevent (35px mail rows, 36px address rows, 40px
 * identity rows, 28px grouped rows).
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AVATAR_BOX,
  AVATAR_INK,
  AVATAR_TIER_NAMES,
  AVATAR_TIERS,
  avatarPx,
  DEFAULT_AVATAR_TIER,
  isAvatarTier,
} from '@/utils/ui/avatar-size.js';
import { findAvatarSites } from '../../../scripts/check-avatar-sizes';

const ROOT = process.cwd();

/** Tailwind's spacing step: `w-N` is N × 4px. */
function tailwindBox(px: number): string {
  return `w-${px / 4} h-${px / 4}`;
}

/** Reads a token back to px so the ink can be compared with its box. */
function tokenPx(token: string): number {
  return Number(token.replace(/^[wh]-/, '')) * 4;
}

describe('avatar size scale', () => {
  test('every tier is a whole Tailwind step, strictly ascending', () => {
    for (const tier of AVATAR_TIER_NAMES) {
      const px = AVATAR_TIERS[tier];
      expect(px % 4).toBe(0);
      // 4px is the smallest step Tailwind names; nothing above a card fits a row.
      expect(px).toBeGreaterThanOrEqual(16);
      expect(px).toBeLessThanOrEqual(36);
    }
    const sizes = AVATAR_TIER_NAMES.map((tier) => AVATAR_TIERS[tier]);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
  });

  test('AVATAR_BOX states each tier’s own size, in px', () => {
    for (const tier of AVATAR_TIER_NAMES) {
      expect(AVATAR_BOX[tier]).toBe(tailwindBox(AVATAR_TIERS[tier]));
      const [w, h] = AVATAR_BOX[tier].split(' ');
      expect(tokenPx(w)).toBe(AVATAR_TIERS[tier]);
      expect(tokenPx(h)).toBe(AVATAR_TIERS[tier]);
    }
  });

  test('a box fits inside its own avatar, with margin', () => {
    for (const tier of AVATAR_TIER_NAMES) {
      const [inkW] = AVATAR_INK[tier].split(' ');
      const inkPx = tokenPx(inkW);
      // A glyph at or past the box edge would clip on the rounded shell.
      expect(inkPx).toBeLessThan(AVATAR_TIERS[tier]);
      // …but large enough to read: no glyph below half the box.
      expect(inkPx).toBeGreaterThanOrEqual(AVATAR_TIERS[tier] / 2);
    }
  });

  test('the row tier - the one every list shares - is the largest of the scale', () => {
    const sizes: number[] = AVATAR_TIER_NAMES.map((t) => AVATAR_TIERS[t]);
    expect(AVATAR_TIERS.row as number).toBe(Math.max(...sizes));
    // Every map names every tier: a map missing one would leave a tier that
    // silently renders with no box.
    const names = [...AVATAR_TIER_NAMES].sort() as string[];
    expect(Object.keys(AVATAR_TIERS).sort()).toEqual(names);
    expect(Object.keys(AVATAR_BOX).sort()).toEqual(names);
    expect(Object.keys(AVATAR_INK).sort()).toEqual(names);
  });

  test('the default tier, px lookup and guard agree with the table', () => {
    expect(avatarPx()).toBe(AVATAR_TIERS[DEFAULT_AVATAR_TIER]);
    for (const tier of AVATAR_TIER_NAMES) expect(avatarPx(tier)).toBe(AVATAR_TIERS[tier]);
    expect(isAvatarTier('row')).toBe(true);
    expect(isAvatarTier('md')).toBe(true);
    // The pre-scale values must NOT be tiers: a px number is exactly what the
    // scale exists to stop, and 'tiny'/'huge' would be a second vocabulary.
    expect(isAvatarTier(35)).toBe(false);
    expect(isAvatarTier('35')).toBe(false);
    expect(isAvatarTier('tiny')).toBe(false);
    expect(isAvatarTier(undefined)).toBe(false);
  });

  test('every list row states the SAME tier for its leading avatar', () => {
    // The surfaces that show one: mailbox mail rows (both renderings), the
    // addresses list, the identity list and the saved-login list.
    const listSurfaces = [
      'src/ui/views/mailbox/MailboxView.svelte',
      'src/ui/views/addresses/AddressesView.svelte',
      'src/ui/views/autofill/IdentitiesView.svelte',
      'src/ui/views/autofill/SavedLoginsView.svelte',
    ];
    for (const file of listSurfaces) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      // Every one of them lays its row avatar out on the row box - the
      // identity row renders a profile picture rather than a letter, so its
      // disc is hand-written, but from the same tier.
      expect(source).toContain(`{${'AVATAR_BOX.row'}}`);
      // …and no avatar or favicon in a list surface states a size of its own.
      for (const site of findAvatarSites(source, file)) {
        expect(site.tier).not.toBeNull();
      }
    }
  });
});
