<script lang="ts">
import type { Snippet } from 'svelte';
import { t } from 'svelte-i18n';
import SearchBar, { type SearchShortcut } from '@/ui/components/composites/SearchBar.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import { PORTAL_Z_CLASS } from '@/utils/ui/portal-layers.js';
import { controlSurface } from '@/utils/ui/row-surface.js';

let {
  value = $bindable(''),
  placeholder = undefined as string | undefined,
  ariaLabel = undefined as string | undefined,
  totalCount = undefined as number | undefined,
  filteredCount = undefined as number | undefined,
  showFilterButton = false,
  filterActive = false,
  onFilterClick = undefined as (() => void) | undefined,
  scope = 'default',
  class: className = '',
  settingsStyle = true,
  showSlashButton = false,
  animatedPlaceholders = [] as string[],
  shortcuts = [] as SearchShortcut[],
  showVoiceSearch = true,
  borderBottom = true,
  paddingClass = 'px-0 pt-3 pb-2',
  extraActions = undefined as Snippet | undefined,
  filterControl: customFilterControl = undefined as Snippet | undefined,
  trailing: customTrailing = undefined as Snippet | undefined,
  prefixContent: customPrefixContent = undefined as Snippet | undefined,
  onChange = undefined as ((v: string) => void) | undefined,
  onkeydown = undefined as ((e: KeyboardEvent) => void) | undefined,
  onInputRef = undefined as ((el: HTMLInputElement | null) => void) | undefined,
}: {
  value: string;
  placeholder?: string;
  ariaLabel?: string;
  totalCount?: number;
  filteredCount?: number;
  showFilterButton?: boolean;
  filterActive?: boolean;
  onFilterClick?: () => void;
  scope?: string;
  class?: string;
  settingsStyle?: boolean;
  showSlashButton?: boolean;
  animatedPlaceholders?: string[];
  shortcuts?: SearchShortcut[];
  showVoiceSearch?: boolean;
  borderBottom?: boolean;
  paddingClass?: string;
  extraActions?: Snippet;
  filterControl?: Snippet;
  trailing?: Snippet;
  prefixContent?: Snippet;
  onChange?: (v: string) => void;
  onkeydown?: (e: KeyboardEvent) => void;
  onInputRef?: (el: HTMLInputElement | null) => void;
} = $props();

let searchInputEl: HTMLInputElement | null = null;
</script>

<div
  class="relative {PORTAL_Z_CLASS.chrome} {paddingClass} {borderBottom ? 'border-b border-md-outline-variant/15' : ''} bg-md-surface/95 backdrop-blur-sm {className}"
>
  <div class="relative flex items-center gap-2">
      <SearchBar
        class="flex-1"
        {scope}
        bind:value
        {placeholder}
        {ariaLabel}
        {settingsStyle}
        {showSlashButton}
        {animatedPlaceholders}
        {shortcuts}
        {showVoiceSearch}
        {onChange}
        {onkeydown}
        prefixContent={customPrefixContent}
        trailing={customTrailing}
        onInputRef={(el) => {
          searchInputEl = el;
          if (onInputRef) onInputRef(el);
        }}
      >
        {#snippet filterControl()}
          {#if customFilterControl}
            {@render customFilterControl()}
          {:else if showFilterButton}
            <button
              type="button"
              class="w-8 h-8 flex items-center justify-center rounded-full border border-md-outline-variant text-md-on-surface/60 transition-colors relative shrink-0 active:brightness-95 {controlSurface(
                filterActive
              )}"
              onclick={onFilterClick}
              aria-label={$t('common.filter')}
              title={$t('common.filter')}
            >
              <Icon name="filter" class="w-4 h-4" />
            </button>
          {/if}
        {/snippet}
      </SearchBar>

    {#if extraActions}
      <div class="flex items-center gap-1.5 shrink-0">
        {@render extraActions()}
      </div>
    {/if}
  </div>

  {#if typeof filteredCount === 'number' && typeof totalCount === 'number' && value.trim().length > 0}
    <div class="mt-2 text-xs text-md-on-surface/50 font-medium px-1 flex items-center justify-between">
      <span>{$t('common.showingCount', { values: { n: filteredCount, m: totalCount } })}</span>
      {#if value}
        <button
          type="button"
          class="text-md-primary hover:underline focus:outline-none"
          onclick={() => {
            value = '';
            // Return focus to the search input so the user can keep typing
            // instead of dropping focus to document.body.
            searchInputEl?.focus();
          }}
        >
          {$t('common.clearSearch')}
        </button>
      {/if}
    </div>
  {/if}
</div>
