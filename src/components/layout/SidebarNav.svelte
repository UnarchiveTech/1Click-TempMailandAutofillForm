<script lang="ts">
/**
 * Wide-layout sidebar (≥800px):
 *   App logo (full wordmark) → Create CTA → primary nav (+ nested) → theme (bottom)
 */
import { t } from 'svelte-i18n';
import AppLogo from '@/components/icons/AppLogo.svelte';
import Icon from '@/components/icons/Icon.svelte';
import ProviderCreateMenu from '@/components/ui/composites/ProviderCreateMenu.svelte';
import ThemeToggle from '@/components/ui/ThemeToggle.svelte';
import type { ContrastLevel } from '@/features/theme/theme-actions.js';
import type { View } from '@/features/types/view-types.js';
import {
  fabIconForKind,
  fabKindForView,
  fabLabelKeyForKind,
  type SidebarFabKind,
} from '@/utils/sidebar-fab.js';
import type { Account, ProviderInstance } from '@/utils/types.js';

type NavItem = { view: View; labelKey: string; iconName: string };
type NestedItem = {
  id: string;
  labelKey: string;
  view?: View;
  tab?: string;
  label?: string;
  count?: number;
  subtitleKey?: string;
};

let {
  currentView = 'main' as View,
  themeMode = 'auto' as 'light' | 'auto' | 'dark',
  onThemeChange = (_m: 'light' | 'auto' | 'dark') => {},
  contrastLevel = 'standard' as ContrastLevel,
  onContrastChange = (_c: ContrastLevel) => {},
  onNavigate = (_v: View) => {},
  onLogoClick = () => {},
  organizeTab = 'tags' as 'tags' | 'labels' | 'filters',
  autofillTab = 'profiles' as 'profiles' | 'credentials',
  mgmtTab = 'active',
  onOrganizeTab = (_t: 'tags' | 'labels' | 'filters') => {},
  onAutofillTab = (_t: 'profiles' | 'credentials') => {},
  onMgmtTab = (_t: string) => {},
  totalUnread = 0,
  showBack = false,
  onBack = () => {},
  density = 'comfortable' as 'comfortable' | 'compact',
  loading = false,
  onFabClick = (_kind: SidebarFabKind) => {},
  onCreateInboxWithProvider = (_p: string, _i?: string) => {},
  providerInstances = [] as ProviderInstance[],
  mailboxListTab = 'inbox' as string,
  onMailboxListTab = (_tab: string) => {},
  mailboxLabels = [] as string[],
  activeMailboxLabel = null as string | null,
  onMailboxLabel = (_label: string | null) => {},
  selectedEmail = '',
  allInboxes = [] as Account[],
  onSelectAccount = (_addr: string) => {},
  mailboxFolderCounts = { all: 0, inbox: 0, archived: 0, deleted: 0 } as Record<string, number>,
  liveCount = 0,
  inactiveCount = 0,
  tagCount = 0,
  labelCount = 0,
  filterCount = 0,
  profileCount = 0,
  credentialCount = 0,
} = $props<{
  currentView?: View;
  themeMode?: 'light' | 'auto' | 'dark';
  onThemeChange?: (mode: 'light' | 'auto' | 'dark') => void;
  contrastLevel?: ContrastLevel;
  onContrastChange?: (level: ContrastLevel) => void;
  onNavigate?: (view: View) => void;
  onLogoClick?: () => void;
  organizeTab?: 'tags' | 'labels' | 'filters';
  autofillTab?: 'profiles' | 'credentials';
  mgmtTab?: string;
  onOrganizeTab?: (t: 'tags' | 'labels' | 'filters') => void;
  onAutofillTab?: (t: 'profiles' | 'credentials') => void;
  onMgmtTab?: (t: string) => void;
  totalUnread?: number;
  showBack?: boolean;
  onBack?: () => void;
  density?: 'comfortable' | 'compact';
  loading?: boolean;
  onFabClick?: (kind: SidebarFabKind) => void;
  onCreateInboxWithProvider?: (providerId: string, instanceId?: string) => void;
  providerInstances?: ProviderInstance[];
  mailboxListTab?: string;
  onMailboxListTab?: (tab: string) => void;
  mailboxLabels?: string[];
  activeMailboxLabel?: string | null;
  onMailboxLabel?: (label: string | null) => void;
  selectedEmail?: string;
  allInboxes?: Account[];
  onSelectAccount?: (address: string) => void;
  mailboxFolderCounts?: Record<string, number>;
  liveCount?: number;
  inactiveCount?: number;
  tagCount?: number;
  labelCount?: number;
  filterCount?: number;
  profileCount?: number;
  credentialCount?: number;
}>();

let providerMenuOpen = $state(false);
let providerMenuPos = $state({ x: 0, y: 0 });
let addressPickerOpen = $state(false);

const PRIMARY: NavItem[] = [
  { view: 'main', labelKey: 'nav.mailbox', iconName: 'mail' },
  { view: 'mailSettings', labelKey: 'nav.addresses', iconName: 'inbox' },
  { view: 'autofill', labelKey: 'nav.autofill', iconName: 'editSquare' },
  { view: 'organize', labelKey: 'nav.organize', iconName: 'filter' },
  { view: 'analytics', labelKey: 'nav.activity', iconName: 'barChart' },
  { view: 'settings', labelKey: 'nav.settings', iconName: 'settings' },
  { view: 'about', labelKey: 'nav.about', iconName: 'info' },
];

let fabKind = $derived(
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
let fabIcon = $derived(fabIconForKind(fabKind));
let fabLabel = $derived($t(fabLabelKeyForKind(fabKind)));

function isActive(view: View): boolean {
  if (view === 'main')
    return (
      currentView === 'main' || currentView === 'messageDetail' || currentView === 'archivedEmails'
    );
  if (view === 'mailSettings')
    return (
      currentView === 'mailSettings' ||
      currentView === 'mailboxManagement' ||
      currentView === 'emailDetail'
    );
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
  if (view === 'main') {
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
    for (const lab of mailboxLabels.slice(0, 12)) {
      base.push({ id: `label:${lab}`, labelKey: '', label: lab, tab: `label:${lab}` });
    }
    return base;
  }
  if (view === 'mailSettings' || view === 'mailboxManagement') {
    return [
      {
        id: 'active',
        labelKey: 'mailManagement.live',
        tab: 'active',
        count: liveCount,
        subtitleKey: 'mailManagement.activeSubtitle',
      },
      {
        id: 'expired',
        labelKey: 'mailManagement.inactive',
        tab: 'expired',
        count: inactiveCount,
        subtitleKey: 'mailManagement.inactiveSubtitle',
      },
    ];
  }
  if (view === 'organize') {
    return [
      { id: 'tags', labelKey: 'nav.tagManagement', tab: 'tags', view: 'organize', count: tagCount },
      {
        id: 'labels',
        labelKey: 'nav.labelManagement',
        tab: 'labels',
        view: 'organize',
        count: labelCount,
      },
      {
        id: 'filters',
        labelKey: 'nav.filtersAndAutomations',
        tab: 'filters',
        view: 'organize',
        count: filterCount,
      },
    ];
  }
  if (view === 'autofill') {
    return [
      {
        id: 'profiles',
        labelKey: 'nav.identities',
        tab: 'profiles',
        view: 'autofill',
        count: profileCount,
      },
      {
        id: 'credentials',
        labelKey: 'nav.savedLogins',
        tab: 'credentials',
        view: 'autofill',
        count: credentialCount,
      },
    ];
  }
  return [];
}

function isNestedActive(parent: View, item: NestedItem): boolean {
  if (parent === 'main') {
    if (item.tab?.startsWith('label:')) {
      const lab = item.tab.slice(6);
      return activeMailboxLabel === lab;
    }
    return mailboxListTab === item.tab && !activeMailboxLabel;
  }
  if (parent === 'mailSettings' || parent === 'mailboxManagement') {
    if (item.tab === 'active') return mgmtTab === 'active';
    return mgmtTab === 'expired' || mgmtTab === 'archived';
  }
  if (parent === 'organize') {
    if (item.tab === 'tags') return organizeTab === 'tags' || currentView === 'tagManagement';
    if (item.tab === 'labels') return organizeTab === 'labels' || currentView === 'labelManagement';
    if (item.tab === 'filters')
      return organizeTab === 'filters' || currentView === 'filtersManagement';
  }
  if (parent === 'autofill') {
    if (item.tab === 'profiles') return autofillTab === 'profiles' || currentView === 'identities';
    if (item.tab === 'credentials')
      return autofillTab === 'credentials' || currentView === 'loginInfo';
  }
  return false;
}

function handleNested(parent: View, item: NestedItem) {
  if (parent === 'main' && item.tab) {
    onNavigate('main');
    if (item.tab.startsWith('label:')) {
      onMailboxLabel(item.tab.slice(6));
    } else {
      onMailboxLabel(null);
      onMailboxListTab(item.tab);
    }
    return;
  }
  if (parent === 'mailSettings' || parent === 'mailboxManagement') {
    onNavigate('mailSettings');
    if (item.tab) onMgmtTab(item.tab);
    return;
  }
  if (parent === 'organize' && item.tab) {
    onOrganizeTab(item.tab as 'tags' | 'labels' | 'filters');
    onNavigate('organize');
    return;
  }
  if (parent === 'autofill' && item.tab) {
    onAutofillTab(item.tab as 'profiles' | 'credentials');
    onNavigate('autofill');
  }
}

function nestedLabel(item: NestedItem): string {
  if (item.label) return item.label;
  const base = $t(item.labelKey) as string;
  if (typeof item.count === 'number') return `${base} (${item.count})`;
  return base;
}

function openProviderMenu(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  const menuW = 240;
  const menuH = 300;
  let x = e.clientX;
  let y = e.clientY;
  x = Math.max(8, Math.min(x, window.innerWidth - menuW - 8));
  y = Math.max(8, Math.min(y, window.innerHeight - menuH - 8));
  providerMenuPos = { x, y };
  providerMenuOpen = true;
}
</script>

<aside
  class="sidebar-nav flex flex-col shrink-0 h-full min-h-0 border-e border-md-outline-variant/30 bg-md-surface-container-low/80
    {density === 'compact' ? 'w-[188px]' : 'w-[220px]'}"
  data-density={density}
  aria-label={$t('nav.mainNav')}
>
  {#if showBack}
    <div class="px-2 pt-2">
      <button
        type="button"
        class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-md-on-surface-variant hover:bg-md-surface-variant transition-colors focus-visible:outline-2 focus-visible:outline-md-primary focus-visible:outline-offset-2"
        aria-label={$t('common.back')}
        title={$t('common.back')}
        onclick={() => onBack()}
      >
        <Icon name="back" class="w-4 h-4" />
        <span>{$t('common.back')}</span>
      </button>
    </div>
  {/if}

  <!-- App logo at top (full wordmark like popup) -->
  <div class="px-2 {showBack ? 'pt-1.5' : 'pt-3'} pb-2">
    <button
      type="button"
      class="w-full flex items-center justify-start rounded-xl px-1.5 py-1.5 hover:bg-md-surface-variant/50 transition-colors focus-visible:outline-2 focus-visible:outline-md-primary focus-visible:outline-offset-2"
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
        class="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold
          bg-md-primary text-md-on-primary hover:brightness-110 active:scale-[0.98] transition-all
          disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-md-primary focus-visible:outline-offset-2"
        aria-label={fabLabel}
        title={fabLabel}
        disabled={loading && fabKind === 'refresh'}
        oncontextmenu={(e) => {
          if (fabKind === 'createAddress') openProviderMenu(e);
          else {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onclick={(e) => {
          e.stopPropagation();
          onFabClick(fabKind);
        }}
      >
        <Icon
          name={fabIcon}
          class="w-4 h-4 shrink-0 {loading && fabKind === 'refresh' ? 'animate-spin' : ''}"
        />
        <span class="truncate">{fabLabel}</span>
      </button>
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
      onCreateInboxWithProvider(pid, iid);
    }}
  />

  <nav class="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-0.5">
    {#each PRIMARY as item (item.view)}
      {@const active = isActive(item.view)}
      {@const nested = active ? nestedFor(item.view) : []}
      <div>
        <button
          type="button"
          class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm font-semibold transition-colors text-start
            {active
              ? 'bg-md-secondary-container text-md-on-secondary-container'
              : 'text-md-on-surface-variant hover:bg-md-surface-variant/60 hover:text-md-on-surface'}"
          aria-current={active ? 'page' : undefined}
          onclick={() => onNavigate(item.view)}
        >
          <Icon name={item.iconName} class="w-4 h-4 shrink-0" />
          <span class="truncate flex-1">{$t(item.labelKey)}</span>
          {#if item.view === 'main' && totalUnread > 0}
            <span
              class="min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center bg-md-error text-md-on-error"
            >
              {totalUnread > 99 ? '99+' : totalUnread}
            </span>
          {/if}
        </button>
        {#if active && item.view === 'main' && selectedEmail}
          <button
            type="button"
            class="ms-4 mt-0.5 w-[calc(100%-1rem)] text-start px-2 py-1 rounded-lg text-[11px] font-medium text-md-primary/90 hover:bg-md-primary/10 truncate border-s border-md-outline-variant/40 ps-2"
            title={selectedEmail}
            onclick={(e) => {
              e.stopPropagation();
              addressPickerOpen = !addressPickerOpen;
            }}
          >
            {selectedEmail}
          </button>
          {#if addressPickerOpen}
            <div
              class="ms-4 mt-0.5 mb-1 max-h-40 overflow-y-auto rounded-lg border border-md-outline-variant/40 bg-md-surface py-0.5"
            >
              {#each allInboxes.filter((a: Account) => a.address && a.accountStatus !== 'deleted') as acc (acc.id)}
                <button
                  type="button"
                  class="w-full text-start px-2 py-1.5 text-[11px] truncate
                    {(acc.address || '').toLowerCase() === selectedEmail.toLowerCase()
                      ? 'bg-md-primary/15 text-md-primary font-semibold'
                      : 'text-md-on-surface/70 hover:bg-md-surface-variant'}"
                  title={acc.address}
                  onclick={() => {
                    onSelectAccount(acc.address);
                    addressPickerOpen = false;
                    onNavigate('main');
                  }}
                >
                  {acc.address}
                </button>
              {/each}
            </div>
          {/if}
        {/if}
        {#if nested.length > 0}
          <div class="ms-4 mt-0.5 mb-1 space-y-0.5 border-s border-md-outline-variant/40 ps-2">
            {#each nested as child (child.id)}
              {@const childActive = isNestedActive(item.view, child)}
              <button
                type="button"
                class="w-full text-start px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors
                  {childActive
                    ? 'bg-md-primary/15 text-md-primary'
                    : 'text-md-on-surface/60 hover:bg-md-surface-variant/50 hover:text-md-on-surface'}"
                onclick={() => handleNested(item.view, child)}
                title={nestedLabel(child)}
              >
                <span class="block truncate">{nestedLabel(child)}</span>
                {#if child.subtitleKey}
                  <span class="block text-[10px] font-normal opacity-60 truncate"
                    >{$t(child.subtitleKey)}</span
                  >
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </nav>

  <!-- Far bottom: theme only (logo moved to top) -->
  <div
    class="mt-auto shrink-0 border-t border-md-outline-variant/25 px-2 py-2.5 flex items-center justify-end"
  >
    <ThemeToggle
      {themeMode}
      {onThemeChange}
      {contrastLevel}
      {onContrastChange}
      menuPlacement="top"
    />
  </div>
</aside>
