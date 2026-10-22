<script lang="ts">
import { t } from 'svelte-i18n';
import Icon from '@/ui/components/icons/Icon.svelte';
import type { TagUsage } from '@/utils/address/address-tags.js';
import { getTagInkColor } from '@/utils/theme/color-utils.js';

let {
  tag = null,
  tagColor = null,
  onClick = () => {},
  showIcon = true,
  /**
   * How many addresses carry this tag, plus the hover detail naming them -
   * `tagUsageInfo()`, so the chip's number and the addresses it lists can never
   * disagree. `null`/omitted means the tag is on no address: no count is shown
   * and the tooltip falls back to the tag name.
   */
  usage = null,
  /** Hide usage totals in compact mailbox strips, retaining their tooltip. */
  showUsageCount = true,
  /** Names hidden after this pill in a width-limited tag row. */
  moreTags = [],
  /** A selected tag in Set Tags; clicking removes it from the selection. */
  removable = false,
  /** An unselected tag offered for addition in Set Tags. */
  addable = false,
  /**
   * Render the chip as INERT PREVIEW markup - same box, same styles, same count,
   * but not a focus stop and not a `[data-tag-chip]` (see `preview` in the
   * template). For a surface that must show the chip the app will paint without
   * offering a second way to edit it.
   */
  preview = false,
}: {
  tag?: string | null;
  tagColor?: string | null;
  onClick?: () => void;
  showIcon?: boolean;
  usage?: TagUsage | null;
  showUsageCount?: boolean;
  moreTags?: string[];
  removable?: boolean;
  addable?: boolean;
  preview?: boolean;
} = $props();

/**
 * The ink a custom (user-chosen, not MD3 role) fill gets.
 *
 * `getTagInkColor` is the SHARED rule - the address-list row chip and the tag
 * dialog read it too - and this pill must not carry a second one: it used to hold
 * its own WCAG-luminance formula with a 0.45 threshold, which put WHITE ink on the
 * palette's emerald while those surfaces painted it dark. One tag, disagreeing
 * with itself depending on where you looked at it.
 */
const tagInk = $derived(tagColor ? getTagInkColor(tagColor) : null);
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
    max-width: 100%;
    height: 1.5rem;
    min-height: 1.5rem;
    padding: 0 0.55rem;
    font-size: var(--md-type-label-medium-size, 0.75rem);
    font-weight: var(--md-type-label-medium-weight, 500);
    font-family: inherit;
    line-height: var(--md-type-label-medium-line, 1rem);
    white-space: nowrap;
    cursor: pointer;
    color: var(--md-on-surface, #1b1b1f);
    transition: border-color 0.2s;
    box-sizing: border-box;
  }

  .tag-pill.is-removable,
  .tag-pill.is-addable {
    min-height: 2.5rem;
    height: auto;
    padding-inline: 0.75rem;
  }

  .tag-pill.is-addable {
    background: var(--md-surface-container, #f3edf7);
    color: var(--md-on-surface, #1b1b1f);
    border-color: var(--md-outline-variant, #c4c6d0);
  }

  .tag-pill.has-color {
    /* Ink set inline from luminance; border from tag bg */
    color: var(--tag-ink, #ffffff);
    border-color: color-mix(in srgb, var(--tag-bg, #888) 70%, #000);
  }

  .tag-pill.empty {
    color: var(--md-on-surface-variant, #44474f);
  }

  .tag-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tag-prefix {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    font: inherit;
  }

  .tag-hash {
    font: inherit;
    font-size: 1.1em;
    flex-shrink: 0;
  }

  .tag-color-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--tag-bg, var(--md-primary));
  }

  .more-count {
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  /* A preview is not a control, so it must not offer a control's affordance. */
  .tag-pill.is-preview {
    cursor: default;
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

  .tag-pill.is-removable :global(svg) {
    width: 1rem;
    height: 1rem;
  }

  /*
   * How many addresses carry the tag. Inked from the pill's own `currentColor`,
   * so it stays readable on a user-chosen fill (whose ink is picked for contrast
   * in `tagInk`) as well as on the neutral pill.
   */
  .tag-pill .count {
    flex-shrink: 0;
    padding: 0 0.3rem;
    border-radius: 9999px;
    background: color-mix(in srgb, currentColor 18%, transparent);
    font-size: var(--md-type-label-small-size, 0.6875rem);
    font-variant-numeric: tabular-nums;
    line-height: var(--md-type-label-small-line, 1rem);
  }
</style>

{#snippet pillBody()}
  {#if addable}
    <span class="tag-color-dot" aria-hidden="true"></span>
  {/if}
  <span class="tag-prefix">
    {#if tag && showIcon}<span class="tag-hash" aria-hidden="true">#</span>{/if}
    <span class="tag-name">{tag || $t('common.addTag')}</span>
  </span>
  {#if usage && showUsageCount}
    <!--
      Hidden from screen readers on purpose: the button's own accessible name is
      its action ("Edit tag banking"), and the tooltip above already names every
      address behind this number - announcing it twice inside one button adds a
      digit nobody can act on. The number is still selectable text, so it stays
      copyable.
    -->
    <span class="count" aria-hidden="true">{usage.count}</span>
  {/if}
  {#if moreTags.length > 0}
    <span class="more-count" aria-hidden="true">+{moreTags.length}</span>
  {/if}
  {#if removable}
    <Icon name="close" class="" />
  {/if}
{/snippet}

{#if preview}
  <!--
    The same box, the same styles, the same count as the real chip - because it IS
    the real chip's markup, not a second drawing of it. Only two things differ: it
    is a `span`, so it is not a focus stop for a control that does nothing, and it
    carries `data-tag-chip-preview` rather than `data-tag-chip`, so the probe's
    "every chip's count matches its own tooltip" walk keeps meaning LIVE chips.
  -->
  <span
    data-tag-chip-preview
    class="tag-pill is-preview {tagColor ? 'has-color' : ''} {!tag ? 'empty' : ''}"
    style:background-color={tagColor || undefined}
    style:--tag-bg={tagColor || undefined}
    style:--tag-ink={tagInk || undefined}
  >
    {@render pillBody()}
  </span>
{:else}
  <button
    type="button"
    data-tag-chip={removable || addable ? undefined : true}
    data-tag-chip-preview={removable ? true : undefined}
    class="tag-pill md-action {removable ? 'is-removable' : ''} {addable ? 'is-addable' : ''} {tagColor && !addable ? 'has-color' : ''} {!tag ? 'empty' : ''}"
    style:background-color={addable ? undefined : tagColor || undefined}
    style:--tag-bg={tagColor || undefined}
    style:--tag-ink={tagInk || undefined}
    onclick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    aria-label={removable
      ? $t('tagManagement.removeSelectedTag', { values: { name: tag ?? '' } })
      : addable
        ? $t('tagManagement.addExistingTag', { values: { name: tag ?? '' } })
      : moreTags.length > 0
        ? $t('tagManagement.setTagsIncluding', { values: { names: [tag, ...moreTags].filter(Boolean).join(', ') } })
        : tag ? $t('tagManagement.editTag', { values: { name: tag } }) : $t('common.addTag')}
    title={removable
      ? $t('tagManagement.removeSelectedTag', { values: { name: tag ?? '' } })
      : addable
        ? (usage?.label ?? $t('tagManagement.addExistingTag', { values: { name: tag ?? '' } }))
      : moreTags.length > 0
        ? [usage?.label, $t('tagManagement.setTagsIncluding', { values: { names: [tag, ...moreTags].filter(Boolean).join(', ') } })].filter(Boolean).join(' · ')
        : tag ? (usage?.label ?? tag) : $t('common.addTag')}
  >
    {@render pillBody()}
  </button>
{/if}
