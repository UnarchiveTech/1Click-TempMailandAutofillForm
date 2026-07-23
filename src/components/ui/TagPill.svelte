<script lang="ts">
import { t } from 'svelte-i18n';
import Icon from '@/components/icons/Icon.svelte';

let {
  tag = null,
  tagColor = null,
  onClick = () => {},
  showIcon = true,
} = $props<{
  tag?: string | null;
  tagColor?: string | null;
  onClick?: () => void;
  showIcon?: boolean;
}>();

/** Parse #RGB / #RRGGBB / rgb() → [r,g,b] 0–255 */
function parseCssColor(input: string): [number, number, number] | null {
  const s = input.trim();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

/** Relative luminance (sRGB) - WCAG */
function relativeLuminance(r: number, g: number, b: number): number {
  const lin = [r, g, b].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/**
 * Custom tag fills are user-chosen (not MD3 roles).
 * Pick near-white or near-black ink for readable contrast on that fill.
 */
const tagInk = $derived.by(() => {
  if (!tagColor) return null;
  const rgb = parseCssColor(tagColor);
  if (!rgb) {
    // Unknown format - assume mid tone; prefer light ink on colored pills
    return '#ffffff';
  }
  // Threshold ~0.45: light fills get dark text, dark fills get light text
  return relativeLuminance(...rgb) > 0.45 ? '#1b1b1f' : '#ffffff';
});

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    onClick();
  }
}
</script>

<style>
  /* Match AutoRenewToggle.pill-toggle geometry (height, radius, border, type) */
  .tag-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    border-radius: 9999px;
    border: 1px solid var(--md-outline-variant, #c4c6d0);
    background: var(--md-surface-container-low, #f7f2fa);
    user-select: none;
    overflow: hidden;
    height: 1.5rem;
    min-height: 1.5rem;
    padding: 0 0.55rem;
    font-size: var(--md-type-label-medium-size, 0.75rem);
    font-weight: 700;
    font-family: system-ui, sans-serif;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    color: var(--md-on-surface, #1b1b1f);
    transition: box-shadow 0.2s, border-color 0.2s;
    box-sizing: border-box;
  }

  .tag-pill:hover {
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }

  .tag-pill.has-color {
    /* Ink set inline from luminance; border from tag bg */
    color: var(--tag-ink, #ffffff);
    border-color: color-mix(in srgb, var(--tag-bg, #888) 70%, #000);
  }

  .tag-pill.empty {
    color: var(--md-on-surface-variant, #44474f);
    opacity: 0.75;
    font-style: italic;
    font-weight: 600;
  }

  .tag-pill :global(svg) {
    width: 0.65rem;
    height: 0.65rem;
    flex-shrink: 0;
    opacity: 0.75;
  }

  .tag-pill.has-color :global(svg) {
    opacity: 0.95;
  }
</style>

<button
  type="button"
  class="tag-pill {tagColor ? 'has-color' : ''} {!tag ? 'empty' : ''}"
  style:background-color={tagColor || undefined}
  style:--tag-bg={tagColor || undefined}
  style:--tag-ink={tagInk || undefined}
  onclick={(e) => {
    e.stopPropagation();
    onClick();
  }}
  onkeydown={handleKeyDown}
  aria-label={tag ? $t('tagManagement.editTag', { values: { name: tag } }) : $t('common.addTag')}
  title={tag ? tag : $t('common.addTag')}
>
  {#if showIcon}
    <Icon name="tag" class="" />
  {/if}
  {tag || $t('common.addTag')}
</button>
