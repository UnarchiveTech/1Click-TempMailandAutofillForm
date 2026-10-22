<script lang="ts">
/**
 * Wide-layout sidebar (≥800px):
 *   App logo (full wordmark) → Create CTA → primary nav (+ nested) → theme + collapse control (bottom)
 *
 * Collapsed rail mode (collapsed=true, or density='minimised'): single-column strip (~w-14) showing
 * only the app mark, a create/CTA icon button, primary nav icons, and a
 * vertically oriented theme toggle followed by the expand control. Labels
 * become title/aria tooltips. Nested tabs, address pickers and
 * drag targets are intentionally dropped in rail mode - the rail is a compact
 * navigator, not a substitute for the pane.
 */
import { onDestroy, tick } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import type { ContrastLevel } from '@/features/theme/theme-actions.js';
import type { View } from '@/features/types/view-types.js';
import { layoutStore } from '@/ui/blocks/layout/layout-store.svelte.js';
import SidebarAddressPicker from '@/ui/blocks/layout/SidebarAddressPicker.svelte';
import { activeFabActionStore } from '@/ui/components/composites/fab-action-store.js';
import ProviderCreateMenu from '@/ui/components/composites/ProviderCreateMenu.svelte';
import {
  sidebarActiveTabsStore,
  sidebarTabsVisible,
} from '@/ui/components/composites/tabs-sidebar-store.js';
import AppLogo from '@/ui/components/icons/AppLogo.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';
import NavIconIndicator from '@/ui/components/primitives/NavIconIndicator.svelte';
import ThemeToggle from '@/ui/components/primitives/ThemeToggle.svelte';
import { isSettingsSplitView } from '@/ui/views/view-registry.js';
import { logError } from '@/utils/logger.js';
import {
  DEFAULT_SIDEBAR_POSITION,
  type SidebarPosition,
  type UiDensity,
} from '@/utils/storage/storage-keys.js';
import type { Address, ProviderInstance } from '@/utils/types.js';
import { rowSurface } from '@/utils/ui/row-surface.js';
import {
  fabIconForKind,
  fabKindForView,
  fabLabelKeyForKind,
  isFabActionDisabled,
  type SidebarFabKind,
} from '@/utils/ui/sidebar-fab.js';
import { toastStore } from '@/utils/ui/toastStore.js';

type NavItem = { view: View; labelKey: string; iconName: KnownIconName };
type NestedItem = {
  id: string;
  labelKey: string;
  view?: View;
  tab?: string;
  label?: string;
  count?: number;
  subtitle?: string;
};

let {
  currentView = 'mailbox' as View,
  context = 'popup' as 'popup' | 'sidepanel' | 'app',
  collapsed = false,
  position = DEFAULT_SIDEBAR_POSITION,
  onToggleCollapse = () => {},
  themeMode = 'auto' as 'light' | 'auto' | 'dark',
  onThemeChange = (_m: 'light' | 'auto' | 'dark') => {},
  contrastLevel = 'standard' as ContrastLevel,
  onContrastChange = (_c: ContrastLevel) => {},
  onNavigate = (_v: View) => {},
  onLogoClick = () => {},
  organizeTab = 'tags' as 'tags' | 'labels' | 'filters',
  autofillTab = 'profiles' as 'profiles' | 'credentials' | 'sites',
  mgmtTab = 'active',
  onOrganizeTab = (_t: 'tags' | 'labels' | 'filters') => {},
  onAutofillTab = (_t: 'profiles' | 'credentials' | 'sites') => {},
  onMgmtTab = (_t: string) => {},
  totalUnread = 0,
  showBack = false,
  onBack = () => {},
  density = 'expanded' as UiDensity,
  onDensityChange = (_d: UiDensity) => {},
  loading = false,
  onFabClick = (_kind: SidebarFabKind) => {},
  onCreateAddressWithProvider = (_p: string, _i?: string) => {},
  onOpenProviderSettings = () => {},
  providerInstances = [] as ProviderInstance[],
  mailboxListTab = 'inbox' as string,
  onMailboxListTab = (_tab: string) => {},
  mailboxLabels = [] as string[],
  mailboxLabelCounts = {} as Record<string, number>,
  activeMailboxLabel = null as string | null,
  onMailboxLabel = (_label: string | null) => {},
  onMailboxFolderDrop = (_tab: string) => {},
  onMailboxLabelDrop = (_label: string) => {},
  selectedEmail = '',
  allAddresses = [] as Address[],
  unreadByAddress = {} as Record<string, number>,
  onSelectAddress = (_addr: string) => {},
  mailboxFolderCounts = { all: 0, inbox: 0, archived: 0, deleted: 0, storedLocally: 0 } as Record<
    string,
    number
  >,
  liveCount = 0,
  inactiveCount = 0,
  tagCount = 0,
  labelCount = 0,
  filterCount = 0,
  profileCount = 0,
  credentialCount = 0,
  onExpandApp = undefined as (() => void) | undefined,
}: {
  currentView?: View;
  context?: 'popup' | 'sidepanel' | 'app';
  /** Icon-only rail (single column) instead of the full labeled sidebar. */
  collapsed?: boolean;
  position?: SidebarPosition;
  /** Expand/collapse request (expansion state is owned by the parent shell). */
  onToggleCollapse?: () => void;
  themeMode?: 'light' | 'auto' | 'dark';
  onThemeChange?: (mode: 'light' | 'auto' | 'dark') => void;
  contrastLevel?: ContrastLevel;
  onContrastChange?: (level: ContrastLevel) => void;
  onNavigate?: (view: View) => void;
  onLogoClick?: () => void;
  onExpandApp?: () => void;
  organizeTab?: 'tags' | 'labels' | 'filters';
  autofillTab?: 'profiles' | 'credentials' | 'sites';
  mgmtTab?: string;
  onOrganizeTab?: (t: 'tags' | 'labels' | 'filters') => void;
  onAutofillTab?: (t: 'profiles' | 'credentials' | 'sites') => void;
  onMgmtTab?: (t: string) => void;
  totalUnread?: number;
  showBack?: boolean;
  onBack?: () => void;
  density?: UiDensity;
  /** Density switch request (owned + persisted by AppLayout). */
  onDensityChange?: (value: UiDensity) => void;
  loading?: boolean;
  onFabClick?: (kind: SidebarFabKind) => void;
  onCreateAddressWithProvider?: (providerId: string, instanceId?: string) => void;
  onOpenProviderSettings?: () => void;
  providerInstances?: ProviderInstance[];
  mailboxListTab?: string;
  onMailboxListTab?: (tab: string) => void;
  mailboxLabels?: string[];
  mailboxLabelCounts?: Record<string, number>;
  activeMailboxLabel?: string | null;
  onMailboxLabel?: (label: string | null) => void;
  onMailboxFolderDrop?: (tab: string) => void;
  onMailboxLabelDrop?: (label: string) => void;
  selectedEmail?: string;
  allAddresses?: Address[];
  unreadByAddress?: Record<string, number>;
  onSelectAddress?: (address: string) => void;
  mailboxFolderCounts?: Record<string, number>;
  liveCount?: number;
  inactiveCount?: number;
  tagCount?: number;
  labelCount?: number;
  filterCount?: number;
  profileCount?: number;
  credentialCount?: number;
} = $props();

let providerMenuOpen = $state(false);
let providerMenuPos = $state({ x: 0, y: 0 });
let addressPickerOpen = $state(false);
let addressPickerTrigger = $state<HTMLButtonElement>();
// Explicit choices survive navigation and rail toggles for this mounted sidebar.
let expandedSections = $state<Partial<Record<View, boolean>>>({});
let activePageTabs = $derived($sidebarActiveTabsStore);

/**
 * Mirror the Footer's nav configuration: same ordered items, including
 * whatever currently lives in the More menu (the sidebar has room for all of
 * them). Because the list comes from layoutStore.navLayout, the user's
 * customNavOrder reordering applies here too, and any future hide setting in
 * computeNavLayout is reflected automatically.
 */
const PRIMARY = $derived(
  [...layoutStore.navLayout.primaryNav, ...layoutStore.navLayout.moreItems].filter(
    (item): item is NavItem => item.view !== 'more'
  )
);

let dynamicFab = $derived($activeFabActionStore);

/** Icon-only rail when manually collapsed OR density is minimised. */
let iconRail = $derived(collapsed || density === 'minimised');

let fabKind = $derived(
  dynamicFab?.kind ??
    fabKindForView(currentView, {
      organizeTab:
        currentView === 'organize' ||
        currentView === 'tagManagement' ||
        currentView === 'labelManagement' ||
        currentView === 'filtersManagement'
          ? organizeTab
          : undefined,
    })
);
let fabIcon = $derived(dynamicFab?.icon ?? fabIconForKind(fabKind));
let fabLabel = $derived(
  dynamicFab?.label ??
    (dynamicFab?.labelKey
      ? ($t(dynamicFab.labelKey) as string)
      : ($t(fabLabelKeyForKind(fabKind)) as string))
);

function isActive(view: View): boolean {
  if (view === 'settings') return currentView === 'settings' || isSettingsSplitView(currentView);
  if (view === 'mailbox') return currentView === 'mailbox' || currentView === 'mailView';
  if (view === 'addresses') return currentView === 'addresses' || currentView === 'addressView';
  if (view === 'autofill')
    return (
      currentView === 'autofill' || currentView === 'loginInfo' || currentView === 'identities'
    );
  if (view === 'organize')
    return (
      currentView === 'organize' ||
      currentView === 'tagManagement' ||
      currentView === 'labelManagement' ||
      currentView === 'filtersManagement'
    );
  return currentView === view;
}

function nestedFor(view: View): NestedItem[] {
  if (view === 'mailbox') {
    const base: NestedItem[] = [
      {
        id: 'all',
        labelKey: 'inbox.listTabs.allShort',
        tab: 'all',
        count: mailboxFolderCounts.all ?? 0,
      },
      {
        id: 'inbox',
        labelKey: 'inbox.listTabs.inboxShort',
        tab: 'inbox',
        count: mailboxFolderCounts.inbox ?? 0,
      },
      {
        id: 'archived',
        labelKey: 'inbox.listTabs.archivedShort',
        tab: 'archived',
        count: mailboxFolderCounts.archived ?? 0,
      },
      {
        id: 'deleted',
        labelKey: 'inbox.listTabs.deletedShort',
        tab: 'deleted',
        count: mailboxFolderCounts.deleted ?? 0,
      },
    ];
    if ((mailboxFolderCounts.storedLocally ?? 0) > 0 || mailboxListTab === 'storedLocally') {
      base.push({
        id: 'storedLocally',
        labelKey: 'inbox.listTabs.storedLocallyShort',
        tab: 'storedLocally',
        count: mailboxFolderCounts.storedLocally ?? 0,
      });
    }
    for (const lab of mailboxLabels) {
      base.push({
        id: `label:${lab}`,
        labelKey: '',
        label: lab,
        tab: `label:${lab}`,
        count: mailboxLabelCounts[lab] ?? 0,
      });
    }
    return base;
  }

  // Use the live page's declared tabs when it is the current destination.
  // An expanded section for another destination must not accidentally reuse the
  // currently mounted page's tab list or callback.
  if (isActive(view) && activePageTabs && activePageTabs.tabs.length > 0) {
    return activePageTabs.tabs.map((tab) => ({
      id: tab.id,
      labelKey: '',
      label: tab.label,
      subtitle: tab.subheading,
      tab: tab.id,
      view: view,
      count: typeof tab.badge === 'number' ? tab.badge : undefined,
    }));
  }

  // These destinations have stable tabs, so users can expand and open them
  // directly from the sidebar without navigating to the parent first.
  if (view === 'addresses') {
    return [
      {
        id: 'live',
        labelKey: 'address.live',
        tab: 'live',
        count: liveCount,
        subtitle: $t('address.activeSubtitle'),
      },
      {
        id: 'inactive',
        labelKey: 'address.inactive',
        tab: 'inactive',
        count: inactiveCount,
        subtitle: $t('address.inactiveSubtitle'),
      },
    ];
  }
  if (view === 'autofill') {
    return [
      { id: 'profiles', labelKey: 'nav.profiles', tab: 'profiles', count: profileCount },
      {
        id: 'credentials',
        labelKey: 'nav.credentials',
        tab: 'credentials',
        count: credentialCount,
        subtitle: $t('nav.credentialsSubtitle'),
      },
      { id: 'sites', labelKey: 'nav.sites', tab: 'sites' },
    ];
  }
  if (view === 'organize') {
    return [
      { id: 'tags', labelKey: 'nav.tagManagement', tab: 'tags', count: tagCount },
      { id: 'labels', labelKey: 'nav.labelManagement', tab: 'labels', count: labelCount },
      { id: 'filters', labelKey: 'nav.savedSearches', tab: 'filters', count: filterCount },
    ];
  }

  return [];
}

function isNestedActive(parent: View, item: NestedItem): boolean {
  if (parent === 'mailbox') {
    if (item.tab?.startsWith('label:')) {
      const lab = item.tab.slice(6);
      return activeMailboxLabel === lab;
    }
    return mailboxListTab === item.tab && !activeMailboxLabel;
  }
  if (isActive(parent) && activePageTabs && item.tab) {
    return activePageTabs.activeTab === item.tab;
  }
  if (parent === 'addresses') return (mgmtTab === 'active' ? 'live' : 'inactive') === item.tab;
  if (parent === 'autofill') return autofillTab === item.tab;
  if (parent === 'organize') return organizeTab === item.tab;
  return false;
}

function handleNested(parent: View, item: NestedItem) {
  if (parent === 'mailbox' && item.tab) {
    onNavigate('mailbox');
    if (item.tab.startsWith('label:')) {
      onMailboxLabel(item.tab.slice(6));
    } else {
      onMailboxLabel(null);
      onMailboxListTab(item.tab);
    }
    return;
  }
  if (parent === 'addresses' && item.tab) {
    onMgmtTab(item.tab === 'live' ? 'active' : 'expired');
    onNavigate(parent);
    return;
  }
  if (parent === 'autofill' && item.tab) {
    onAutofillTab(item.tab as 'profiles' | 'credentials' | 'sites');
    onNavigate(parent);
    return;
  }
  if (parent === 'organize' && item.tab) {
    onOrganizeTab(item.tab as 'tags' | 'labels' | 'filters');
    onNavigate(parent);
    return;
  }
  if (item.tab && isActive(parent) && activePageTabs) {
    activePageTabs.onchange(item.tab);
    onNavigate(parent);
  }
}

const nestedByView = $derived.by(
  () => new Map(PRIMARY.map((item) => [item.view, nestedFor(item.view)]))
);

$effect(() => {
  sidebarTabsVisible.set(
    !iconRail &&
      PRIMARY.some(
        (item) =>
          isActive(item.view) &&
          (expandedSections[item.view] ?? true) &&
          (nestedByView.get(item.view)?.length ?? 0) > 0
      )
  );
});
onDestroy(() => sidebarTabsVisible.set(false));

function handleSectionKeydown(view: View, event: KeyboardEvent) {
  if (event.key === 'Escape' && (expandedSections[view] ?? isActive(view))) {
    event.preventDefault();
    event.stopPropagation();
    expandedSections[view] = false;
    const group = (event.currentTarget as HTMLElement).closest('[data-sidebar-nav-item]');
    group?.querySelector<HTMLButtonElement>('[data-sidebar-disclosure]')?.focus();
  }
}

function closeAddressPicker() {
  addressPickerOpen = false;
  addressPickerTrigger?.focus();
}

async function toggleAddressPicker() {
  addressPickerOpen = !addressPickerOpen;
  if (addressPickerOpen) {
    await tick();
    document.getElementById('sidebar-address-search')?.focus();
  }
}

async function expandApp() {
  try {
    if (onExpandApp) await onExpandApp();
    else await browser.tabs.create({ url: new URL('/app.html', window.location.href).href });
  } catch (error) {
    logError('Failed to open full app from sidebar', error);
    toastStore.error($t('toasts.operationFailed'));
  }
}

function nestedLabelBase(item: NestedItem): string {
  if (item.label) return item.label;
  return ($t(item.labelKey) as string) || '';
}

function openProviderMenu(e: MouseEvent | KeyboardEvent) {
  e.preventDefault();
  e.stopPropagation();
  const menuW = 240;
  const menuH = 300;
  const rect =
    e.currentTarget instanceof HTMLElement ? e.currentTarget.getBoundingClientRect() : null;
  let x = e instanceof MouseEvent ? e.clientX : rect?.left || 8;
  let y = e instanceof MouseEvent ? e.clientY : rect?.bottom || 8;
  x = Math.max(8, Math.min(x, window.innerWidth - menuW - 8));
  y = Math.max(8, Math.min(y, window.innerHeight - menuH - 8));
  providerMenuPos = { x, y };
  providerMenuOpen = true;
}

function onProviderMenuKeydown(event: KeyboardEvent) {
  if (
    fabKind === 'createAddress' &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))
  )
    openProviderMenu(event);
}
</script>

<aside
  class="sidebar-nav flex flex-col shrink-0 h-full min-h-0 {position === 'left' ? 'border-r' : 'border-l'} border-md-outline-variant/30 bg-md-surface-container-low/80
    {iconRail ? 'w-14' : 'w-[220px]'}"
  data-density={density}
  data-icon-rail={iconRail}
  aria-label={$t('nav.mainNav')}
>
  {#if showBack}
    <div class="px-2 pt-2">
      <button
        type="button"
        class="sidebar-control w-full min-h-10 flex items-center gap-2 px-2.5 py-2 rounded-xl ui-label text-md-on-surface-variant hover:bg-[color-mix(in_srgb,var(--md-on-surface-variant)_8%,transparent)] active:bg-[color-mix(in_srgb,var(--md-on-surface-variant)_12%,transparent)] transition-colors focus-visible:outline-2 focus-visible:outline-md-primary focus-visible:outline-offset-2"
        aria-label={$t('common.back')}
        title={$t('common.back')}
        onclick={() => onBack()}
      >
        <Icon name="back" class="w-4 h-4" />
        {#if !iconRail}
          <span>{$t('common.back')}</span>
        {/if}
      </button>
    </div>
  {/if}

  {#if iconRail}
    <!-- Icon-only rail: logo → create → nav icons → theme + expand -->
    <div class="px-1.5 {showBack ? 'pt-1.5' : 'pt-3'} pb-2">
      <button
        type="button"
        class="sidebar-control w-full min-h-10 flex items-center justify-center rounded-xl px-1.5 py-1.5 hover:bg-[color-mix(in_srgb,var(--md-on-surface-variant)_8%,transparent)] active:bg-[color-mix(in_srgb,var(--md-on-surface-variant)_12%,transparent)] transition-colors focus-visible:outline-2 focus-visible:outline-md-primary focus-visible:outline-offset-2"
        aria-label={$t('nav.about')}
        onclick={() => onLogoClick()}
      >
        <AppLogo compact showTitle={false} />
      </button>
    </div>

    {#if fabKind !== 'none'}
      <div class="px-1.5 pb-2">
        <button
          type="button"
          id="sidebar-create-cta"
          onkeydown={onProviderMenuKeydown}
          class="sidebar-control md-action w-full h-10 flex items-center justify-center rounded-xl
            bg-md-primary text-md-on-primary transition-colors
            disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-md-primary focus-visible:outline-offset-2"
          aria-label={fabLabel}
          title={fabLabel}
          disabled={isFabActionDisabled(fabKind, loading)}
          oncontextmenu={(e) => {
            if (fabKind === 'createAddress') openProviderMenu(e);
            else {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onclick={(e) => {
            e.stopPropagation();
            if (dynamicFab?.onclick) {
              dynamicFab.onclick();
            } else {
              onFabClick(fabKind);
            }
          }}
        >
          <Icon
            name={providerMenuOpen && fabKind === 'createAddress' ? 'chevronDown' : fabIcon}
            class="w-4 h-4 shrink-0 {loading && fabKind === 'refresh' ? 'animate-spin' : ''}"
          />
        </button>
      </div>
    {/if}

    <nav class="flex-1 min-h-0 overflow-y-auto px-1.5 pb-2 space-y-0.5" aria-label={$t('nav.mainNav')}>
      {#each PRIMARY as item (item.view)}
        {@const active = isActive(item.view)}
        <button
          type="button"
          data-sidebar-destination
          class="sidebar-control w-full h-10 flex items-center justify-center rounded-xl {rowSurface({ selected: active })} {active
            ? 'text-md-on-secondary-container'
            : 'text-md-on-surface-variant'}"
          aria-current={active ? 'page' : undefined}
          aria-label={item.view === 'mailbox' && totalUnread > 0 ? $t('nav.mailboxUnread', { values: { n: totalUnread } }) : $t(item.labelKey)}
          title={$t(item.labelKey)}
          onclick={() => onNavigate(item.view)}
        >
          <!-- MD3 active-destination rule: filled glyph on the current page. -->
          <span class="relative inline-flex w-4 h-4 shrink-0 text-sm" aria-hidden="true">
            <Icon name={item.iconName} class="w-full h-full" filled={active} />
            {#if item.view === 'mailbox' && totalUnread > 0}
              <NavIconIndicator countText={totalUnread > 99 ? '99+' : String(totalUnread)} iconSizePx={16} />
            {/if}
          </span>
        </button>
      {/each}
    </nav>

    <div class="mt-auto shrink-0 border-t border-md-outline-variant/25 px-1.5 py-2.5 flex flex-col items-center gap-1.5">
      {#if context !== 'app'}
        <button
          type="button"
          class="sidebar-control md-action w-full h-10 flex items-center justify-center rounded-xl text-md-on-surface-variant"
          onclick={(event) => {
            event.stopPropagation();
            void expandApp();
          }}
          title={$t('navigation.openFullApp')}
          aria-label={$t('navigation.openFullApp')}
        >
          <Icon name="expand" class="w-4 h-4 shrink-0" />
        </button>
      {/if}
      <ThemeToggle
        {themeMode}
        {onThemeChange}
        {contrastLevel}
        {onContrastChange}
        menuPlacement="top"
        orientation="vertical"
      />
      <button
        type="button"
        class="sidebar-control w-full h-10 flex items-center justify-center rounded-xl text-md-on-surface-variant
         hover:bg-[color-mix(in_srgb,var(--md-on-surface-variant)_8%,transparent)] active:bg-[color-mix(in_srgb,var(--md-on-surface-variant)_12%,transparent)] hover:text-md-on-surface transition-colors
          focus-visible:outline-2 focus-visible:outline-md-primary focus-visible:outline-offset-2"
        aria-label={$t('common.expandSidebar')}
        aria-expanded={false}
        title={$t('common.expandSidebar')}
        onclick={(e) => {
          e.stopPropagation();
          if (density === 'minimised') {
            // Minimised density alone keeps the rail up even after clearing a
            // manual collapse, so switch to expanded to restore the full
            // sidebar in a single click regardless of persisted state.
            onDensityChange('expanded');
            if (collapsed) onToggleCollapse();
          } else {
            onToggleCollapse();
          }
        }}
      >
        <Icon name={position === 'left' ? 'chevronRight' : 'chevronLeft'} class="w-4 h-4" />
      </button>
    </div>
  {:else}
  <!-- Full labeled sidebar: logo → create CTA → primary nav (+ nested) → theme -->

  <!-- App logo at top (full wordmark like popup) -->
  <div class="px-2 {showBack ? 'pt-1.5' : 'pt-3'} pb-2">
    <button
      type="button"
      class="sidebar-control w-full min-h-10 flex items-center justify-start rounded-xl px-1.5 py-1.5 hover:bg-[color-mix(in_srgb,var(--md-on-surface-variant)_8%,transparent)] active:bg-[color-mix(in_srgb,var(--md-on-surface-variant)_12%,transparent)] transition-colors focus-visible:outline-2 focus-visible:outline-md-primary focus-visible:outline-offset-2"
      aria-label={$t('nav.about')}
      onclick={() => onLogoClick()}
    >
      <AppLogo compact={false} showTitle={false} />
    </button>
  </div>

  <!-- Primary action CTA (create address / identity / etc.) -->
  {#if fabKind !== 'none'}
    <div class="px-2 pb-2">
      <button
        type="button"
        id="sidebar-create-cta"
        onkeydown={onProviderMenuKeydown}
        class="sidebar-control md-action w-full min-h-10 flex items-center justify-center gap-2 px-3 py-2 rounded-xl ui-row-primary
          bg-md-primary text-md-on-primary transition-colors
          disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-md-primary focus-visible:outline-offset-2"
        aria-label={fabLabel}
        title={fabLabel}
        disabled={isFabActionDisabled(fabKind, loading)}
        oncontextmenu={(e) => {
          if (fabKind === 'createAddress') openProviderMenu(e);
          else {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onclick={(e) => {
          e.stopPropagation();
          if (dynamicFab?.onclick) {
            dynamicFab.onclick();
          } else {
            onFabClick(fabKind);
          }
        }}
      >
        <Icon
          name={providerMenuOpen && fabKind === 'createAddress' ? 'chevronDown' : fabIcon}
          class="w-4 h-4 shrink-0 {loading && fabKind === 'refresh' ? 'animate-spin' : ''}"
        />
        <span class="truncate">{fabLabel}</span>
      </button>
    </div>
  {/if}

  <nav
    class="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-0.5"
  >
    {#each PRIMARY as item (item.view)}
      {@const active = isActive(item.view)}
      {@const nested = nestedByView.get(item.view) ?? []}
      {@const sectionOpen = expandedSections[item.view] ?? active}
      <div
        data-sidebar-nav-item={item.view}
        role="group"
        aria-label={$t(item.labelKey)}
      >
        <div class="flex items-center min-w-0">
        <button
          type="button"
          data-sidebar-destination
          class="sidebar-control flex-1 min-w-0 min-h-10 flex items-center gap-2.5 px-2.5 py-2 rounded-xl ui-row-primary text-start {rowSurface({ selected: active })}
            {active ? 'text-md-on-secondary-container' : 'text-md-on-surface-variant hover:text-md-on-surface'}"
          aria-current={active ? 'page' : undefined}
          aria-label={item.view === 'mailbox' && totalUnread > 0 ? $t('nav.mailboxUnread', { values: { n: totalUnread } }) : $t(item.labelKey)}
          onclick={(event) => {
            event.stopPropagation();
            expandedSections[item.view] = true;
            onNavigate(item.view);
          }}
        >
          <!-- MD3 active-destination rule: filled glyph on the current page. -->
          <span class="relative inline-flex w-4 h-4 shrink-0" aria-hidden="true">
            <Icon name={item.iconName} class="w-full h-full" filled={active} />
            {#if item.view === 'mailbox' && totalUnread > 0}
              <NavIconIndicator countText={totalUnread > 99 ? '99+' : String(totalUnread)} iconSizePx={16} />
            {/if}
          </span>
          <span class="truncate flex-1">{$t(item.labelKey)}</span>
        </button>
        {#if nested.length > 0}
          <button
            type="button"
            data-sidebar-disclosure
            class="sidebar-control md-action shrink-0 w-8 h-10 rounded-xl flex items-center justify-center text-md-on-surface-variant"
            aria-label={$t(item.labelKey)}
            title={sectionOpen ? $t('common.collapse') : $t('common.expand')}
            aria-expanded={sectionOpen}
            aria-controls="sidebar-submenu-{item.view}"
            onclick={(event) => {
              event.stopPropagation();
              expandedSections[item.view] = !sectionOpen;
            }}
          >
            <Icon name={sectionOpen ? 'chevronUp' : 'chevronDown'} class="w-4 h-4" />
          </button>
        {/if}
        </div>
        {#if active && sectionOpen && item.view === 'mailbox' && selectedEmail}
          <button
            type="button"
            bind:this={addressPickerTrigger}
            class="sidebar-control ms-4 mt-0.5 w-[calc(100%-1rem)] min-h-10 text-start px-2 py-1 rounded-lg ui-support text-md-primary {rowSurface()} flex items-center gap-1"
            title={selectedEmail}
            aria-expanded={addressPickerOpen}
            aria-controls="sidebar-address-picker"
            onclick={(e) => {
              e.stopPropagation();
              void toggleAddressPicker();
            }}
          >
            <bdi dir="ltr" class="truncate flex-1">{selectedEmail}</bdi>
            <Icon name={addressPickerOpen ? 'chevronUp' : 'chevronDown'} class="w-4 h-4 shrink-0" />
          </button>
          {#if addressPickerOpen}
            <SidebarAddressPicker
              {allAddresses}
              {selectedEmail}
              {unreadByAddress}
              onClose={closeAddressPicker}
              onPick={(address) => {
                onSelectAddress(address);
                closeAddressPicker();
                onNavigate('mailbox');
              }}
            />
          {/if}
        {/if}
        {#if nested.length > 0 && sectionOpen}
          <div
            class="ms-4 mt-0.5 mb-1 space-y-0.5 border-s border-md-outline-variant/40 ps-2"
            id="sidebar-submenu-{item.view}"
            data-sidebar-submenu={item.view}
            role="group"
            aria-label={$t(item.labelKey)}
          >
            {#each nested as child (child.id)}
              {@const childActive = isNestedActive(item.view, child)}
              <button
                type="button"
                class="sidebar-control w-full min-h-10 text-start px-2 py-2 rounded-lg ui-label {rowSurface({ active: active && childActive })}
                  {active && childActive ? 'text-md-on-secondary-container' : 'text-md-on-surface-variant'}"
                aria-current={active && childActive ? 'page' : undefined}
                onkeydown={(event) => handleSectionKeydown(item.view, event)}
                onclick={(event) => {
                  event.stopPropagation();
                  handleNested(item.view, child);
                }}
                title={nestedLabelBase(child)}
                ondragover={(e) => {
                  if (item.view !== 'mailbox' || !child.tab) return;
                  e.preventDefault();
                  if (e.dataTransfer) {
                    e.dataTransfer.dropEffect = child.tab.startsWith('label:') ? 'copy' : 'move';
                  }
                }}
                ondrop={(e) => {
                  if (item.view !== 'mailbox' || !child.tab) return;
                  e.preventDefault();
                  e.stopPropagation();
                  if (child.tab.startsWith('label:')) {
                    onMailboxLabelDrop(child.tab.slice(6));
                  } else {
                    onMailboxFolderDrop(child.tab);
                  }
                }}
              >
                <div class="flex items-center justify-between gap-1 w-full min-w-0">
                  <span class="truncate">{nestedLabelBase(child)}</span>
                  {#if typeof child.count === 'number'}
                    <span class="shrink-0 px-1.5 py-0.5 rounded-full text-label-sm font-bold bg-md-primary/15 text-md-primary tabular-nums min-w-[18px] text-center">{child.count}</span>
                  {/if}
                </div>
                  {#if child.subtitle}
                    <span class="block ui-support font-normal text-md-on-surface-variant truncate">{child.subtitle}</span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </nav>

  <!-- Far bottom: Open Full Page + theme -->
  <div
    class="mt-auto shrink-0 border-t border-md-outline-variant/25 px-2 py-2.5 flex flex-col gap-1.5"
  >
    {#if context !== 'app'}
      <button
        type="button"
        class="sidebar-control md-action w-full min-h-10 flex items-center gap-2.5 px-3 py-2 ui-support text-md-on-surface-variant rounded-xl"
        onclick={(event) => {
          event.stopPropagation();
          void expandApp();
        }}
        title={$t('navigation.openFullApp')}
      >
        <Icon name="expand" class="w-4 h-4 shrink-0" />
        <span class="truncate">{$t('navigation.openFullApp')}</span>
      </button>
    {/if}
    <div class="flex items-center justify-end gap-1">
      <ThemeToggle
        {themeMode}
        {onThemeChange}
        {contrastLevel}
        {onContrastChange}
        menuPlacement="top"
      />
      <button
        type="button"
        class="sidebar-control w-10 h-10 shrink-0 flex items-center justify-center rounded-full text-md-on-surface-variant hover:text-md-on-surface hover:bg-[color-mix(in_srgb,var(--md-on-surface-variant)_8%,transparent)] active:bg-[color-mix(in_srgb,var(--md-on-surface-variant)_12%,transparent)] transition-colors focus-visible:outline-2 focus-visible:outline-md-primary focus-visible:outline-offset-2"
        aria-label={$t('common.collapseSidebar')}
        aria-expanded={true}
        title={$t('common.collapseSidebar')}
        onclick={(e) => {
          e.stopPropagation();
          onToggleCollapse();
        }}
      >
        <Icon name={position === 'left' ? 'chevronLeft' : 'chevronRight'} class="w-4 h-4" />
      </button>
    </div>
  </div>
{/if}
  <ProviderCreateMenu
    open={providerMenuOpen && fabKind === 'createAddress'}
    x={providerMenuPos.x}
    y={providerMenuPos.y}
    {providerInstances}
    onClose={() => (providerMenuOpen = false)}
    onPick={(pid, iid) => {
      providerMenuOpen = false;
      onCreateAddressWithProvider(pid, iid);
    }}
    onOpenProviderSettings={() => {
      providerMenuOpen = false;
      onOpenProviderSettings();
    }}
  />
</aside>

<style>
  .sidebar-nav :global(button:focus-visible) {
    outline: 2px solid var(--md-primary);
    outline-offset: -2px;
  }
  @media (pointer: coarse) {
    .sidebar-nav[data-icon-rail='true'] { width: 64px; }
    .sidebar-control { min-height: 48px; min-width: 48px; }
  }
</style>
