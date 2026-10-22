<script lang="ts">
import { onMount, tick } from 'svelte';
import { locale, t } from 'svelte-i18n';
import TagPill from '@/ui/components/primitives/TagPill.svelte';
import {
  addressTagsList,
  DEFAULT_TAG_COLOR,
  tagColorFor,
  tagUsageInfo,
} from '@/utils/address/address-tags.js';
import type { Address } from '@/utils/types.js';
import { fitTagPillCount } from '@/utils/ui/tag-pill-fit.js';

let {
  account,
  tagColors,
  tagAddresses,
  onClick,
}: {
  account: Address;
  tagColors: Record<string, string>;
  tagAddresses: Record<string, string[]>;
  onClick: () => void;
} = $props();

const tags = $derived.by(() => {
  const entries = addressTagsList(account);
  if (entries.length === 0 && account.tag) {
    entries.push({ name: account.tag, color: account.tagColor || DEFAULT_TAG_COLOR });
  }
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = entry.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
});

let root: HTMLDivElement | null = $state(null);
let row: HTMLDivElement | null = $state(null);
let measures: HTMLDivElement | null = $state(null);
let visibleCount = $state(1);
let ready = $state(false);

function fit(): void {
  if (!root || !row || !measures) return;
  if (tags.length === 0) {
    visibleCount = 0;
    ready = true;
    return;
  }
  const availableWidth = root.clientWidth;
  if (availableWidth <= 0) return;
  const fullWidths = [...measures.querySelectorAll<HTMLElement>('[data-measure-full]')].map(
    (element) => element.getBoundingClientRect().width
  );
  const summaryWidths = [...measures.querySelectorAll<HTMLElement>('[data-measure-summary]')].map(
    (element) => element.getBoundingClientRect().width
  );
  if (fullWidths.length !== tags.length) return;
  const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
  visibleCount = fitTagPillCount(fullWidths, summaryWidths, availableWidth, gap);
  ready = true;
}

$effect(() => {
  // Tag names, colors, usage counts and fonts can change without the row width
  // changing. Measure after Svelte has painted the new hidden pill widths.
  void tags;
  void tagColors;
  void tagAddresses;
  void $locale;
  void tick().then(fit);
});

onMount(() => {
  if (!root) return;
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
  observer?.observe(root);
  if (!observer) window.addEventListener('resize', fit);
  void document.fonts?.ready.then(fit);
  fit();
  return () => {
    observer?.disconnect();
    if (!observer) window.removeEventListener('resize', fit);
  };
});
</script>

<div bind:this={root} class="relative flex-1 min-w-0 overflow-hidden" style:visibility={ready ? 'visible' : 'hidden'} data-mailbox-tags>
  <div bind:this={row} class="flex min-w-0 items-center gap-1 whitespace-nowrap">
    {#if tags.length === 0}
      <TagPill onClick={onClick} showIcon={true} />
    {:else}
      {#each tags.slice(0, visibleCount) as entry, index (entry.name)}
        <span class={visibleCount === 1 ? 'inline-flex min-w-0 max-w-full' : 'inline-flex shrink-0'}>
          <TagPill
            tag={entry.name}
            tagColor={tagColorFor(tagColors, entry.name) ?? entry.color}
            usage={tagUsageInfo($t, tagAddresses, entry.name)}
            showUsageCount={false}
            moreTags={index === visibleCount - 1 ? tags.slice(visibleCount).map((tag) => tag.name) : []}
            {onClick}
            showIcon={true}
          />
        </span>
      {/each}
    {/if}
  </div>

  <!-- Same TagPill markup as the visible row, kept out of layout and the
       accessibility tree. DOM widths include localized numbers and font metrics. -->
  <div bind:this={measures} class="absolute top-0 start-0 invisible pointer-events-none flex w-max items-center" aria-hidden="true">
    {#each tags as entry, index (entry.name)}
      <span data-measure-full={index} class="inline-flex shrink-0">
        <TagPill
          tag={entry.name}
          tagColor={tagColorFor(tagColors, entry.name) ?? entry.color}
          usage={tagUsageInfo($t, tagAddresses, entry.name)}
          showUsageCount={false}
          showIcon={true}
          preview={true}
        />
      </span>
      {#if index < tags.length - 1}
        <span data-measure-summary={index} class="inline-flex shrink-0">
          <TagPill
            tag={entry.name}
            tagColor={tagColorFor(tagColors, entry.name) ?? entry.color}
            usage={tagUsageInfo($t, tagAddresses, entry.name)}
            showUsageCount={false}
            moreTags={tags.slice(index + 1).map((tag) => tag.name)}
            showIcon={true}
            preview={true}
          />
        </span>
      {/if}
    {/each}
  </div>
</div>
