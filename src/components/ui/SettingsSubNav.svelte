<script lang="ts">
import Icon from '@/components/icons/Icon.svelte';

let {
  currentSubPage = null,
  onNavigateTo = () => {},
}: {
  currentSubPage?: string | null;
  onNavigateTo?: (view: string) => void;
} = $props();

const subPages = [
  { label: 'Provider', icon: 'mail', view: 'mailProvider' },
  { label: 'Storage', icon: 'barChart', view: 'storagePerformance' },
  { label: 'Shortcuts', icon: 'settings', view: 'keybindings' },
  { label: 'Tags', icon: 'tag', view: 'tagManagement' },
  { label: 'Filters', icon: 'filter', view: 'filtersManagement' },
  { label: 'Labels', icon: 'tag', view: 'labelManagement' },
  { label: 'Mailboxes', icon: 'archive', view: 'mailboxManagement' },
  { label: 'Identities', icon: 'user', view: 'identities' },
];

// How many items visible in the sliding window
const VISIBLE = 3;

let offset = $state(0);

let canScrollLeft = $derived(offset > 0);
let canScrollRight = $derived(offset + VISIBLE < subPages.length);

let visiblePages = $derived(subPages.slice(offset, offset + VISIBLE));

function scrollLeft() {
  if (canScrollLeft) offset = Math.max(0, offset - 1);
}

function scrollRight() {
  if (canScrollRight) offset = Math.min(subPages.length - VISIBLE, offset + 1);
}
</script>

<div
  class="settings-subnav flex items-center gap-1.5 px-1.5 py-1.5 rounded-xl backdrop-blur-3xl bg-md-surface/50 border border-white/10 w-[360px] max-w-full mx-auto"
  aria-label="Settings subpage navigation"
  role="navigation"
>
    <!-- Left chevron -->
    <button
      class="subnav-chevron flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-[10px] transition-all duration-200
        {canScrollLeft
          ? 'bg-md-surface-variant hover:bg-md-surface-variant/80 text-md-on-surface active:scale-95'
          : 'bg-transparent text-md-on-surface/20 cursor-not-allowed'}"
      onclick={(e) => { e.stopPropagation(); scrollLeft(); }}
      disabled={!canScrollLeft}
      aria-label="Scroll settings left"
      title="Previous settings"
    >
      <Icon name="chevronLeft" class="w-4 h-4" />
    </button>

    <!-- Visible subpage buttons -->
    <div class="flex flex-1 items-center gap-1 min-w-0 overflow-hidden">
      {#each visiblePages as page (page.label)}
        {@const isActive = currentSubPage === page.view}
        <button
          class="subnav-item flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-[10px] text-label-sm font-semibold transition-all duration-200 hover:scale-105 active:scale-95 truncate
            {isActive
              ? 'bg-md-primary text-md-on-primary shadow-sm'
              : 'bg-md-surface-variant/60 text-md-on-surface/70 hover:bg-md-surface-variant hover:text-md-on-surface'}"
          onclick={(e) => { e.stopPropagation(); onNavigateTo(page.view); }}
          aria-label={page.label}
          title={page.label}
        >
          <Icon name={page.icon} class="w-3 h-3 flex-shrink-0" />
          <span class="truncate leading-none">{page.label}</span>
        </button>
      {/each}
    </div>

    <!-- Right chevron -->
    <button
      class="subnav-chevron flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-[10px] transition-all duration-200
        {canScrollRight
          ? 'bg-md-surface-variant hover:bg-md-surface-variant/80 text-md-on-surface active:scale-95'
          : 'bg-transparent text-md-on-surface/20 cursor-not-allowed'}"
      onclick={(e) => { e.stopPropagation(); scrollRight(); }}
      disabled={!canScrollRight}
      aria-label="Scroll settings right"
      title="More settings"
    >
    <Icon name="chevronRight" class="w-4 h-4 rtl-flip" />
  </button>
</div>

<style>
  .settings-subnav {
    box-shadow:
      0 8px 32px color-mix(in srgb, var(--md-shadow, #000000) 12%, transparent),
      0 0 0 1px color-mix(in srgb, var(--md-inverse-surface, #e2e2e9) 15%, transparent) inset,
      0 0 0 1px color-mix(in srgb, var(--md-outline, #75777f) 5%, transparent);
  }

  .subnav-chevron:not(:disabled) {
    cursor: pointer;
  }
</style>
