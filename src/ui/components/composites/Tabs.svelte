<script lang="ts">
/**
 * Reusable Tabs composite component.
 *
 * Visual variants:
 *  - underline: compact bottom-indicator tabs
 *  - pill: segmented pill tabs
 *
 * Both variants switch related content and share accessible tab semantics.
 * Action button rows remain independent and continue to use responsiveButtonLayout.
 */
import { onDestroy } from 'svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';
import { controlSurface } from '@/utils/ui/row-surface.js';
import { setSidebarActiveTabs, sidebarTabsVisible } from './tabs-sidebar-store.js';

export type TabItem = {
  id: string;
  /** Heading / primary label text */
  label: string;
  /** Optional icon name (Icon component) */
  icon?: KnownIconName;
  /** Optional sub-label below heading (pill variant) */
  subheading?: string;
  /** null = hidden, undefined = hidden, 0+ = shown */
  badge?: number | string | null;
};

const generatedIdPrefix = $props.id();

let {
  tabs = [] as TabItem[],
  activeTab = $bindable(''),
  /** Stable, unique prefix shared with the corresponding tabpanel. */
  idPrefix = generatedIdPrefix,
  /** Visual variant */
  variant = 'underline' as 'underline' | 'pill',
  ariaLabel = '',
  /** Whether tabs expand to fill the container width */
  fullWidth = false,
  /** ID of the tab currently being hovered over with a drag item */
  dropTargetId = null as string | null,
  /** Whether to automatically sync and display these tabs in the wide-layout sidebar */
  showInSidebar = false,
  onchange = (_id: string) => {},
  /** Called when a drag enters a tab area */
  ondragenter = (_id: string, _e: DragEvent) => {},
  /** Called when a drag leaves a tab area */
  ondragleave = (_id: string, _e: DragEvent) => {},
  /** Called when a drop occurs on a tab */
  ondrop = (_id: string, _e: DragEvent) => {},
  /** Called when a dragged item is over a tab (fires repeatedly) */
  ondragover = (_id: string, _e: DragEvent) => {},
}: {
  tabs?: TabItem[];
  activeTab?: string;
  idPrefix?: string;
  variant?: 'underline' | 'pill';
  ariaLabel?: string;
  fullWidth?: boolean;
  dropTargetId?: string | null;
  showInSidebar?: boolean;
  onchange?: (id: string) => void;
  ondragenter?: (id: string, e: DragEvent) => void;
  ondragleave?: (id: string, e: DragEvent) => void;
  ondrop?: (id: string, e: DragEvent) => void;
  ondragover?: (id: string, e: DragEvent) => void;
} = $props();

function tabId(id: string): string {
  return `${idPrefix}-tab-${id}`;
}

function tabPanelId(id: string): string {
  return `${idPrefix}-panel-${id}`;
}

function handleTabClick(id: string) {
  activeTab = id;
  onchange(id);
}

function handleTabKeydown(event: KeyboardEvent, id: string) {
  const currentIndex = tabs.findIndex((tab: TabItem) => tab.id === id);
  if (currentIndex < 0 || tabs.length === 0) return;

  const direction = getComputedStyle(event.currentTarget as HTMLElement).direction;
  const forwardKey = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
  const backwardKey = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
  let nextIndex: number;

  if (event.key === forwardKey) nextIndex = (currentIndex + 1) % tabs.length;
  else if (event.key === backwardKey) nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = tabs.length - 1;
  else return;

  event.preventDefault();
  const nextTab = tabs[nextIndex];
  if (!nextTab) return;

  handleTabClick(nextTab.id);
  const tablist = (event.currentTarget as HTMLElement).closest('[role="tablist"]');
  const nextButton = Array.from(
    tablist?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []
  ).find((button) => button.id === tabId(nextTab.id));
  nextButton?.focus({ preventScroll: true });
  nextButton?.scrollIntoView({
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'nearest',
    inline: 'nearest',
  });
}

$effect(() => {
  if (showInSidebar) {
    setSidebarActiveTabs({
      tabs,
      activeTab,
      onchange: handleTabClick,
    });
  }
});

onDestroy(() => {
  if (showInSidebar) {
    setSidebarActiveTabs(null);
  }
});

const hasDragListeners = $derived(
  ondragenter !== undefined || ondragleave !== undefined || ondrop !== undefined
);

/** Whether badge should be shown for a tab */
function showBadge(tab: TabItem): boolean {
  return tab.badge !== undefined && tab.badge !== null;
}
</script>

{#if variant === 'pill'}
  <!-- ── Pill / segmented tabs ─────────────────────────────────────────── -->
  <div
    class="tabs-m3 flex gap-1 p-1 rounded-full bg-md-surface-variant shrink-0 {fullWidth ? 'w-full' : ''}"
    role="tablist"
    hidden={showInSidebar && $sidebarTabsVisible}
    style:display={showInSidebar && $sidebarTabsVisible ? 'none' : undefined}
    aria-label={ariaLabel || undefined}
    aria-orientation="horizontal"
  >
    {#each tabs as tab (tab.id)}
      {@const isActive = activeTab === tab.id}
      {@const isDropTarget = dropTargetId === tab.id}
      <button
        type="button"
        role="tab"
        id={tabId(tab.id)}
        aria-controls={tabPanelId(tab.id)}
        aria-selected={isActive}
        tabindex={isActive ? 0 : -1}
        onclick={() => handleTabClick(tab.id)}
        onkeydown={(event) => handleTabKeydown(event, tab.id)}
        class="flex items-center justify-center gap-2 px-3 py-1.5 h-10 min-h-10 max-h-10 rounded-full text-md-on-surface/40 transition-colors duration-200 {fullWidth
          ? 'flex-1'
          : 'flex-none min-w-[80px]'}
          {controlSurface(isActive)}
          {isDropTarget ? 'ring-2 ring-md-primary ring-inset' : ''}"
        ondragover={hasDragListeners
          ? (event) => {
              event.preventDefault();
              ondragover(tab.id, event);
            }
          : undefined}
        ondragenter={hasDragListeners
          ? (event) => ondragenter(tab.id, event)
          : undefined}
        ondragleave={hasDragListeners
          ? (event) => ondragleave(tab.id, event)
          : undefined}
        ondrop={hasDragListeners
          ? (event) => {
              event.preventDefault();
              ondrop(tab.id, event);
            }
          : undefined}
      >
        {#if tab.icon}
          <Icon name={tab.icon} class="w-3.5 h-3.5 shrink-0" />
        {/if}
        <span class="flex flex-col items-start justify-center leading-none min-w-0 {tab.subheading ? 'min-h-[28px] gap-0.5' : ''}">
          <span class="nav-label font-bold whitespace-nowrap" style="font-size: var(--nav-font-size, 12px);">{tab.label}</span>
          {#if tab.subheading}
            <span class="ui-support font-medium truncate max-w-full">{tab.subheading}</span>
          {/if}
        </span>
        {#if showBadge(tab)}
          <span
            class="text-label-sm font-bold px-1.5 py-0.5 rounded-full shrink-0 bg-md-on-surface/10 {isActive
              ? 'text-md-on-primary'
              : 'text-md-on-surface/60'}"
          >
            {tab.badge}
          </span>
        {/if}
      </button>
    {/each}
  </div>
{:else}
  <!-- ── Underline tabs ────────────────────────────────────────────────── -->
  <div
    class="tabs-m3 tabs-underline flex flex-row overflow-x-auto whitespace-nowrap gap-0 border-b border-md-outline-variant/30 {fullWidth
      ? 'w-full'
      : ''}"
    role="tablist"
    hidden={showInSidebar && $sidebarTabsVisible}
    style:display={showInSidebar && $sidebarTabsVisible ? 'none' : undefined}
    aria-label={ariaLabel || undefined}
    aria-orientation="horizontal"
  >
    {#each tabs as tab (tab.id)}
      {@const isActive = activeTab === tab.id}
      {@const isDropTarget = dropTargetId === tab.id}
      <button
        type="button"
        role="tab"
        id={tabId(tab.id)}
        aria-controls={tabPanelId(tab.id)}
        aria-selected={isActive}
        tabindex={isActive ? 0 : -1}
        onclick={() => handleTabClick(tab.id)}
        onkeydown={(event) => handleTabKeydown(event, tab.id)}
        ondragover={hasDragListeners
          ? (event) => {
              event.preventDefault();
              ondragover(tab.id, event);
            }
          : undefined}
        ondragenter={hasDragListeners
          ? (event) => ondragenter(tab.id, event)
          : undefined}
        ondragleave={hasDragListeners
          ? (event) => ondragleave(tab.id, event)
          : undefined}
        ondrop={hasDragListeners
          ? (event) => {
              event.preventDefault();
              ondrop(tab.id, event);
            }
          : undefined}
        class="flex flex-col items-center justify-center gap-0.5 px-4 py-2.5 relative transition-colors shrink-0 text-md-on-surface-variant {fullWidth
          ? 'flex-1'
          : ''}
          {controlSurface(isActive, 'underline')} {isDropTarget
          ? 'ring-2 ring-md-primary ring-inset'
          : ''}"
      >
        <div class="flex items-center gap-1.5">
          {#if tab.icon}
            <Icon name={tab.icon} class="w-4 h-4" />
          {/if}
          <span class="text-sm font-semibold">{tab.label}</span>
          {#if showBadge(tab)}
            <span class="inline-flex items-center justify-center bg-md-secondary-container text-md-on-secondary-container text-label-sm font-bold px-1.5 py-0.5 rounded-full min-w-[16px] h-[16px]">
              {tab.badge}
            </span>
          {/if}
        </div>
        {#if tab.subheading}
          <span class="ui-support text-md-on-surface-variant">{tab.subheading}</span>
        {/if}
      </button>
    {/each}
  </div>
{/if}

{#each tabs as tab (tab.id)}
  {#if activeTab !== tab.id}
    <div
      id={tabPanelId(tab.id)}
      role="tabpanel"
      aria-labelledby={tabId(tab.id)}
      hidden
    ></div>
  {/if}
{/each}

<style>
  .tabs-underline {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
  .tabs-underline::-webkit-scrollbar {
    display: none;
  }
</style>
