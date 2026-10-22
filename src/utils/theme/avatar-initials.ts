/**
 * Code-point-safe avatar initials.
 *
 * `name[0]` / `charAt(0)` index UTF-16 *code units*, so an astral first
 * character (emoji display names, CJK extension-B, flags) is split into a lone
 * surrogate and renders as a replacement glyph. `Array.from` iterates by code
 * point, keeping the character whole.
 *
 * Shared by every avatar surface - the `Avatar` primitive, the SVG
 * default-avatar generator, the sender-avatar stack, and address cards - so
 * initials are derived identically everywhere.
 */

/**
 * First code point of `input`, upper-cased, falling back to `fallback` when
 * the input is empty or whitespace-only.
 */
export function avatarInitial(input: string | null | undefined, fallback = '?'): string {
  const trimmed = (input ?? '').trim();
  return (Array.from(trimmed)[0] ?? fallback).toUpperCase();
}
