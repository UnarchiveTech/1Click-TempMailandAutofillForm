/**
 * Stable-ish DOM selector hints - the single implementation shared by the
 * background/UI field-map layer (`features/intelligence/field-maps.ts`) and the
 * content-script bridge (`utils/content/content-bg-bridge.ts`).
 *
 * This module imports NOTHING. That is the whole point: the two callers used to
 * carry byte-identical copies of `buildSelectorHint` because importing
 * `field-maps.ts` would drag its storage imports into the content-script bundle,
 * while importing `content-bg-bridge.ts` from the field-map layer would drag the
 * messaging bridge (and its `wxt/browser` side effects) into every field-map
 * consumer. A leaf with no imports is safe to pull into either graph, so both
 * graphs share one function instead of two copies that can silently drift.
 */

/**
 * Build a stable-ish selector for an element (id > name > autocomplete >
 * aria-label > form path > tag).
 */
export function buildSelectorHint(el: Element): string {
  if (!(el instanceof HTMLElement)) return el.tagName.toLowerCase();
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${CSS.escape(el.id)}`;
  const name = el.getAttribute('name');
  if (name) return `${tag}[name="${CSS.escape(name)}"]`;
  const ac = el.getAttribute('autocomplete');
  if (ac) return `${tag}[autocomplete="${CSS.escape(ac)}"]`;
  const aria = el.getAttribute('aria-label');
  if (aria && aria.length < 40) return `${tag}[aria-label="${CSS.escape(aria)}"]`;
  // Short path from form
  const form = el.closest('form');
  if (form) {
    const inputs = Array.from(form.querySelectorAll(tag));
    const idx = inputs.indexOf(el);
    if (idx >= 0) return `form ${tag}:nth-of-type(${idx + 1})`;
  }
  return tag;
}
