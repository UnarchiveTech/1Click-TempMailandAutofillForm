<script lang="ts">
/**
 * MD3 menu list composite — shared dropdown / context menu styling.
 *
 * Container: surface-container-low
 * Item text: on-surface · icons: on-surface-variant
 * State layers (Android MD3 on-surface):
 *   hover  8% · pressed 12% · focus 12%
 * Selected/active: tertiary-container + on-tertiary-container
 */
import type { Snippet } from 'svelte';
import Icon from '@/components/icons/Icon.svelte';

export type MenuListItem = {
  id: string;
  label: string;
  icon?: string;
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
}: {
  items?: MenuListItem[];
  onSelect?: (id: string) => void;
  class?: string;
  role?: 'menu' | 'listbox';
  ariaLabel?: string;
  children?: Snippet;
} = $props();
</script>

<div
  class="menu-list rounded-xl border border-md-outline-variant/50 bg-md-surface-container-low shadow-xl overflow-hidden {className}"
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
        class="menu-list-item w-full flex items-center gap-2 px-2.5 py-2 text-sm text-start
          {i === 0 ? 'rounded-t-xl' : ''}
          {i === items.length - 1 ? 'rounded-b-xl' : ''}
          {item.disabled ? 'is-disabled' : ''}
          {item.active ? 'is-active' : ''}
          {item.danger && !item.active ? 'is-danger' : ''}"
        onclick={(e) => {
          e.stopPropagation();
          if (!item.disabled) onSelect(item.id);
        }}
      >
        {#if item.icon}
          <Icon name={item.icon} class="menu-list-icon w-4 h-4 shrink-0" />
        {/if}
        <span class="flex-1 truncate font-medium">{item.label}</span>
        {#if item.trailing}
          <span class="menu-list-trailing text-xs font-bold shrink-0">{item.trailing}</span>
        {/if}
      </button>
    {/each}
  {/if}
</div>
