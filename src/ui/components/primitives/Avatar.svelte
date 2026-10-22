<script lang="ts">
import { avatarColor } from '@/utils/theme/avatar-color.js';
import { avatarInitial } from '@/utils/theme/avatar-initials.js';
import { type AvatarTier, avatarPx, DEFAULT_AVATAR_TIER } from '@/utils/ui/avatar-size.js';

let {
  size = DEFAULT_AVATAR_TIER,
  letter = '?',
  email = '',
  /** Explicit Tailwind bg class - when empty, hashed from email/letter (dark palette) */
  color = '',
  shape = 'circle',
  class: className = '',
}: {
  /** A tier from the avatar size scale - never a raw px number. */
  size?: AvatarTier;
  letter?: string;
  email?: string;
  color?: string;
  shape?: 'circle' | 'square';
  class?: string;
} = $props();

let bg = $derived(color || avatarColor(email || letter || '?'));
let px = $derived(avatarPx(size));
// The wrapper may already carry an explicit text color (e.g. AVATAR_MUTED's
// `text-md-on-surface-variant`); only force white when the shell has none.
let hasTextClass = $derived(/\btext-[^\s]+/.test(bg));
let letterClass = $derived(hasTextClass ? '' : 'text-white');
// First *code point* - charAt(0) splits surrogate pairs (emoji names) into broken glyphs.
let ch = $derived(avatarInitial(letter, '?'));
let fontSize = $derived(`${Math.round(px * 0.52)}px`);

// Optical vertical centering. `leading-none` + flex centers the font's *em
// box*, but the ink only fills part of it, and where the leftover sits depends
// on the font (Segoe keeps ~0.06em below the baseline; Roboto ~0; CJK/emoji
// paint edge-to-edge). Two strategies, engine-dependent:
//
//  1. CSS leading-trim (text-box-trim/edge) - trims the line box to the true
//     glyph band (cap→alphabetic for Latin; full em for CJK/emoji), so flex
//     centering is pixel-exact for ANY font, no constants or script gates.
//     Measured: ink center within ±0.5px at every avatar size, on Roboto and
//     system-ui alike. Supported in Chromium (and current Safari/Firefox);
//     the JS guard keeps unsupported engines on strategy 2.
//  2. Fallback - the -0.06em nudge calibrated for the shipped Segoe/system-ui
//     fonts, applied only to Latin-style code points (full-em glyphs must not
//     be nudged). Slightly off for non-Segoe Latin fonts on old engines; that
//     is why strategy 1 exists.
let supportsTextTrim = $derived(
  typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('text-box-trim', 'trim-both') &&
    CSS.supports('text-box-edge', 'cap alphabetic')
);
let needsCapNudge = $derived((ch.codePointAt(0) ?? 0x3f) < 0x2c00);
let letterStyle = $derived(
  supportsTextTrim
    ? `font-size:${fontSize};text-box-trim:trim-both;text-box-edge:cap alphabetic;`
    : `font-size:${fontSize};${needsCapNudge ? 'transform:translateY(-0.06em);' : ''}`
);
let shapeClass = $derived(shape === 'square' ? 'rounded-lg' : 'rounded-full');
// Avoid dual sizing / position fights - same guards as FaviconImage.
// Require a real class boundary (start or whitespace) so `max-w-*` / `inset-*`
// prefixes do not false-positive as explicit sizing/positioning.
let hasPositionClass = $derived(
  /(?:^|\s)(?:absolute|fixed|relative|sticky)(?:\s|$)/.test(className)
);
let hasSizeClass = $derived(
  /(?:^|\s)w-(?:\d|full|\[|auto|screen)/.test(className) ||
    /(?:^|\s)h-(?:\d|full|\[|auto|screen)/.test(className)
);
let positionClass = $derived(hasPositionClass ? '' : 'relative');
// A caller that needs the avatar to fill a box it does not own (a lift-out disc,
// the FaviconImage layer) passes a size class instead. That class must be the
// tier's own box (`AVATAR_BOX[tier]`) or a fill - `bun run check-avatar-sizes`
// fails any other pair, so the two can no longer disagree.
let sizeStyle = $derived(hasSizeClass ? '' : `width:${px}px;height:${px}px;`);
</script>

<div
  class="{className} {positionClass} flex items-center justify-center overflow-hidden {shapeClass} {bg}"
  style={sizeStyle}
  aria-hidden="true"
>
  <span class="font-bold uppercase leading-none select-none {letterClass}" style={letterStyle}>{ch}</span>
</div>
