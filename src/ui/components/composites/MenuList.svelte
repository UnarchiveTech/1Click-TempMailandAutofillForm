<script lang="ts">
/**
 * MD3 menu composite - shared dropdown / context menu surface.
 *
 * Container: 4dp (extra-small) shape · surface-container · elevation level 2 ·
 *            8dp vertical padding · no outline (MD3 menus are elevated).
 * Item:      48dp height · 12dp leading/trailing padding · Label Large ·
 *            24dp icons · 12dp icon-to-label gap.
 * Item text: on-surface · icons: on-surface-variant
 * State layers (MD3 of on-surface): hover 8% · focus 10% · pressed 10%
 * Selected/active: secondary-container + on-secondary-container
 */
import type { Snippet } from 'svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';
import { type AnchoredFlyoutOptions, anchoredFlyout } from '@/utils/ui/anchored-flyout.js';
import { ELEVATION } from '@/utils/ui/elevation.js';

export type MenuListItem = {
  id: string;
  label: string;
  icon?: KnownIconName;
  active?: boolean;
  disabled?: boolean;
  trailing?: string;
  danger?: boolean;
};

let {
  items = [] as MenuListItem[],
  onSelect = (_id: string) => {},
  class: className = '',
  role = 'menu' as 'menu' | 'listbox',
  ariaLabel = '',
  children,
  floating,
  ...restProps
}: {
  items?: MenuListItem[];
  onSelect?: (id: string) => void;
  class?: string;
  role?: 'menu' | 'listbox';
  ariaLabel?: string;
  children?: Snippet;
  floating?: AnchoredFlyoutOptions;
  /** Allow arbitrary attributes like style (positioning), id, data-*. */
  [key: string]: unknown;
} = $props();
</script>

<div
  {...restProps}
  use:anchoredFlyout={floating}
  class="menu-list rounded bg-md-surface-container py-2 {ELEVATION.level2} overflow-hidden {className}"
  {role}
  aria-label={ariaLabel || undefined}
>
  {#if children}
    {@render children()}
  {:else}
    {#each items as item, i (item.id)}
      <button
        type="button"
        role={role === 'menu' ? 'menuitem' : 'option'}
        aria-selected={role === 'listbox' ? !!item.active : undefined}
        disabled={item.disabled}
        class="menu-list-item w-full flex items-center gap-3 px-3 min-h-12 text-sm text-start
          {item.disabled ? 'is-disabled' : ''}
          {item.active ? 'is-active' : ''}
          {item.danger && !item.active ? 'is-danger' : ''}"
        onclick={(e) => {
          e.stopPropagation();
          if (!item.disabled) onSelect(item.id);
        }}
      >
        {#if item.icon}
          <Icon name={item.icon} class="menu-list-icon w-6 h-6 shrink-0" />
        {/if}
        <span class="flex-1 truncate font-medium">{item.label}</span>
        {#if item.trailing}
          <span class="menu-list-trailing text-xs font-bold shrink-0">{item.trailing}</span>
        {/if}
      </button>
    {/each}
  {/if}
</div>
