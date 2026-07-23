<script lang="ts">
import { onMount, tick } from 'svelte';
import { locale, t } from 'svelte-i18n';
import Icon from '@/components/icons/Icon.svelte';
import ProviderCreateMenu from '@/components/ui/composites/ProviderCreateMenu.svelte';
import type { View } from '@/features/types/view-types.js';
import { fitLabelFontSize } from '@/utils/fit-label-font.js';
import {
  fabIconForKind,
  fabKindForView,
  fabLabelKeyForKind,
  type OrganizeTabKind,
  type SidebarFabKind,
} from '@/utils/sidebar-fab.js';
import type { Account, ProviderInstance } from '@/utils/types.js';

/** Locale-aware base scale (longer languages start smaller so labels fit). */
function localeFontScale(lang: string | null | undefined): number {
  const l = (lang || 'en').toLowerCase().split('-')[0];
  switch (l) {
    case 'de':
    case 'fr':
      return 0.88;
    case 'es':
    case 'ar':
      return 0.9;
    case 'ja':
    case 'zh':
    case 'th':
      return 0.95;
    default:
      return 1;
  }
}

/** Views that light up the More tab as active (subset left in More after expansion) */
const DEEP_MORE_VIEWS = new Set<View>([
  'tagManagement',
  'labelManagement',
  'filtersManagement',
  'keybindings',
  'mailProvider',
  'storagePerformance',
  'mailboxManagement',
  'constantsSettings',
  'diagnostics',
]);

export type FooterFabKind = SidebarFabKind;

let {
  currentView = 'main',
  onNavigate = () => {},
  accounts = [],
  unreadByAddress = {},
  loading = false,
  onFabClick = () => {},
  onCreateInboxWithProvider = (_providerId: string, _instanceId?: string) => {},
  providerInstances = [] as ProviderInstance[],
  organizeTab = 'tags' as OrganizeTabKind,
} = $props<{
  currentView?: View;
  onNavigate?: (view: View) => void;
  accounts?: Account[];
  unreadByAddress?: Record<string, number>;
  loading?: boolean;
  onFabClick?: (kind: FooterFabKind) => void;
  /** Right-click FAB → create with specific provider/instance */
  onCreateInboxWithProvider?: (providerId: string, instanceId?: string) => void;
  providerInstances?: ProviderInstance[];
  organizeTab?: OrganizeTabKind;
}>();

let moreOpen = $state(false);
let providerMenuOpen = $state(false);
let providerMenuPos = $state({ x: 0, y: 0 });
/** Leave-delay so More submenu doesn't feel sticky / flicker */
let moreCloseTimer: ReturnType<typeof setTimeout> | null = null;
const MORE_LEAVE_MS = 280;

function cancelMoreClose() {
  if (moreCloseTimer != null) {
    clearTimeout(moreCloseTimer);
    moreCloseTimer = null;
  }
}

function openMoreMenu() {
  cancelMoreClose();
  if (moreItems.length > 0) moreOpen = true;
}

function scheduleCloseMore() {
  cancelMoreClose();
  moreCloseTimer = setTimeout(() => {
    moreOpen = false;
    moreCloseTimer = null;
  }, MORE_LEAVE_MS);
}

function closeMoreNow() {
  cancelMoreClose();
  moreOpen = false;
}

function openProviderMenu(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  const menuW = 240;
  const menuH = 300;
  let x = e.clientX;
  let y = e.clientY;
  x = Math.max(8, Math.min(x, window.innerWidth - menuW - 8));
  y = Math.max(8, Math.min(y - 40, window.innerHeight - menuH - 8));
  if (y < 8) y = 8;
  providerMenuPos = { x, y };
  providerMenuOpen = true;
  closeMoreNow();
}

function pickProvider(providerId: string, instanceId?: string) {
  providerMenuOpen = false;
  onCreateInboxWithProvider(providerId, instanceId);
}

let totalUnread = $derived(
  (Object.entries(unreadByAddress) as [string, number][])
    .filter(([addr]) => accounts.some((a: Account) => a.address === addr && a.status === 'active'))
    .reduce((sum, [, count]) => sum + count, 0)
);

let unreadTooltip = $derived.by(() => {
  if (!totalUnread) return $t('nav.mailbox');
  const activeWithUnread = (Object.entries(unreadByAddress) as [string, number][])
    .filter(
      ([addr, count]) =>
        count > 0 && accounts.some((a: Account) => a.address === addr && a.status === 'active')
    )
    .map(([addr, count]) => $t('nav.unreadForAddress', { values: { address: addr, n: count } }));
  if (activeWithUnread.length === 0) return $t('nav.mailbox');
  return activeWithUnread.join('\n');
});

type NavItem = { view: View | 'more'; labelKey: string; iconName: string };
type MoreItem = { view: View; labelKey: string; iconName: string };

const BASE_NAV: NavItem[] = [
  { view: 'main', labelKey: 'nav.mailbox', iconName: 'mail' },
  { view: 'mailSettings', labelKey: 'nav.addresses', iconName: 'inbox' },
  { view: 'autofill', labelKey: 'nav.autofill', iconName: 'editSquare' },
];

/**
 * Adaptive primary nav (base always: Mailbox · Addresses · Autofill).
 *
 * 6 items: Mailbox · Addresses · Autofill · Organize · Settings · More
 * 7 items: Mailbox · Addresses · Autofill · Organize · Activity · Settings · About
 */
const MORE_ALL: MoreItem[] = [
  { view: 'organize', labelKey: 'nav.organize', iconName: 'filter' },
  { view: 'analytics', labelKey: 'nav.activity', iconName: 'barChart' },
  { view: 'settings', labelKey: 'nav.settings', iconName: 'settings' },
  { view: 'about', labelKey: 'nav.about', iconName: 'info' },
];

type NavStage = 'compact' | 'plus_organize' | 'six' | 'seven';

function stageForWidth(w: number): NavStage {
  // 7 items — full bar, no More
  if (w >= 520) return 'seven';
  // 6 items — Organize · Settings · More
  if (w >= 440) return 'six';
  // 5 items — Organize · More
  if (w >= 400) return 'plus_organize';
  return 'compact';
}

let shellWidth = $state(360);
let footerRootEl = $state<HTMLElement | null>(null);
let floatingNavEl = $state<HTMLElement | null>(null);
let navItemEls: Record<string, HTMLButtonElement> = {};
let pillWidth = $state(0);
let pillOffset = $state(0);
let pillReady = $state(false);
let pillEpoch = $state(0);
/** Dynamic nav label font-size (px) — fitted so no label truncates */
let navFontPx = $state(13);

/** Svelte action: register each nav button for elastic-pill measurement */
function navItemAction(node: HTMLButtonElement, view: string) {
  navItemEls[view] = node;
  pillEpoch += 1;
  return {
    update(nextView: string) {
      if (nextView !== view) {
        delete navItemEls[view];
        view = nextView;
        navItemEls[view] = node;
        pillEpoch += 1;
      }
    },
    destroy() {
      delete navItemEls[view];
      pillEpoch += 1;
    },
  };
}

let navStage = $derived(stageForWidth(shellWidth));

let primaryNav = $derived.by((): NavItem[] => {
  const organize: NavItem = {
    view: 'organize',
    labelKey: 'nav.organize',
    iconName: 'filter',
  };
  const activity: NavItem = {
    view: 'analytics',
    labelKey: 'nav.activity',
    iconName: 'barChart',
  };
  const settings: NavItem = {
    view: 'settings',
    labelKey: 'nav.settings',
    iconName: 'settings',
  };
  const about: NavItem = { view: 'about', labelKey: 'nav.about', iconName: 'info' };
  const more: NavItem = { view: 'more', labelKey: 'nav.more', iconName: 'grid' };

  switch (navStage) {
    case 'seven':
      // Mailbox · Addresses · Autofill · Organize · Activity · Settings · About
      return [...BASE_NAV, organize, activity, settings, about];
    case 'six':
      // Mailbox · Addresses · Autofill · Organize · Settings · More
      return [...BASE_NAV, organize, settings, more];
    case 'plus_organize':
      return [...BASE_NAV, organize, more];
    default:
      return [...BASE_NAV, more];
  }
});

let moreItems = $derived.by((): MoreItem[] => {
  switch (navStage) {
    case 'seven':
      return [];
    case 'six':
      // Settings is on primary; keep Activity + About in More
      return MORE_ALL.filter((m) => m.view === 'analytics' || m.view === 'about');
    case 'plus_organize':
      return MORE_ALL.filter((m) => m.view !== 'organize');
    default:
      return [...MORE_ALL];
  }
});

let MORE_VIEWS = $derived.by(() => {
  const s = new Set<View>(DEEP_MORE_VIEWS);
  for (const m of moreItems) s.add(m.view);
  // Organize deep links
  s.add('organize');
  s.add('tagManagement');
  s.add('labelManagement');
  s.add('filtersManagement');
  return s;
});

let fabKind = $derived(fabKindForView(currentView, { organizeTab }));

let fabLabel = $derived($t(fabLabelKeyForKind(fabKind)));

let fabIcon = $derived(fabIconForKind(fabKind));

function isPrimaryActive(view: View | 'more'): boolean {
  if (view === 'more') return MORE_VIEWS.has(currentView) && moreItems.length > 0;
  if (view === 'mailSettings')
    return (
      currentView === 'mailSettings' ||
      currentView === 'mailboxManagement' ||
      currentView === 'emailDetail'
    );
  if (view === 'main')
    return (
      currentView === 'main' || currentView === 'messageDetail' || currentView === 'archivedEmails'
    );
  if (view === 'organize')
    return (
      currentView === 'organize' ||
      currentView === 'tagManagement' ||
      currentView === 'labelManagement' ||
      currentView === 'filtersManagement'
    );
  if (view === 'autofill')
    return (
      currentView === 'autofill' || currentView === 'loginInfo' || currentView === 'identities'
    );
  return currentView === view;
}

function handlePrimaryClick(view: View | 'more') {
  if (view === 'more') {
    cancelMoreClose();
    moreOpen = !moreOpen;
    return;
  }
  closeMoreNow();
  onNavigate(view);
}

function handleMoreItem(view: View) {
  closeMoreNow();
  onNavigate(view);
}

function handleFab() {
  if (fabKind === 'none' || loading) return;
  onFabClick(fabKind);
}

function updatePillPosition() {
  if (!floatingNavEl) return;
  const activeKey = primaryNav.find((item) => isPrimaryActive(item.view))?.view;
  if (!activeKey) {
    pillReady = false;
    return;
  }
  const target = navItemEls[String(activeKey)];
  if (!target) {
    pillReady = false;
    return;
  }
  // offsetLeft/Width are relative to offsetParent and include padding after icon expands
  const measure = () => {
    if (!floatingNavEl || !target.isConnected) return;
    // Prefer layout offsets (stable with transforms / subpixel)
    let w = target.offsetWidth;
    let left = target.offsetLeft;
    // Walk offset parents until we hit the nav (handles nested wrappers)
    let el: HTMLElement | null = target;
    left = 0;
    while (el && el !== floatingNavEl) {
      left += el.offsetLeft;
      el = el.offsetParent as HTMLElement | null;
      if (el && !floatingNavEl.contains(el) && el !== floatingNavEl) break;
    }
    // Fallback to bounding rects if offset walk failed
    if (left === 0 && target !== floatingNavEl.firstElementChild) {
      const navRect = floatingNavEl.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      left = targetRect.left - navRect.left;
      w = targetRect.width;
    } else {
      w = target.offsetWidth;
    }
    // Extra horizontal padding so pill fully covers icon + label (active state expands icon)
    pillWidth = Math.ceil(w) + 6;
    pillOffset = Math.max(0, Math.round(left) - 3);
    pillReady = true;
  };
  measure();
  // Icon width animates ~280ms; remeasure at start, mid, and end of expand
  requestAnimationFrame(() => {
    measure();
    requestAnimationFrame(measure);
  });
  window.setTimeout(measure, 160);
  window.setTimeout(measure, 320);
}

/**
 * Fit nav label font so every item stays fully visible (no ellipsis),
 * scaled first by language then by available width.
 */
function fitNavFontSize() {
  if (!floatingNavEl || !footerRootEl) return;
  const lang = typeof $locale === 'string' ? $locale : 'en';
  // Prefer larger labels so the pill doesn't look sparse left/right
  const base = 14 * localeFontScale(lang);
  const labels = primaryNav.map((item) => $t(item.labelKey));
  // Available width for nav (reserve FAB ~48 + gap)
  const avail = Math.max(140, (footerRootEl.clientWidth || shellWidth) - 52);
  const perItem = Math.floor(avail / Math.max(1, labels.length));
  // Measure real nav buttons when mounted — more accurate than equal split
  const btns = floatingNavEl.querySelectorAll<HTMLElement>('.nav-item');
  if (btns.length > 0) {
    const measured = Array.from(btns).map((btn, i) => ({
      text: labels[i] || '',
      availableWidth: Math.max(perItem, btn.clientWidth || perItem),
    }));
    navFontPx = fitLabelFontSize(measured, {
      basePx: base,
      minPx: 11,
      weight: 600,
      reservedPx: 22,
    });
  } else {
    navFontPx = fitLabelFontSize(
      labels.map((text) => ({ text, availableWidth: perItem })),
      { basePx: base, minPx: 11, weight: 600, reservedPx: 22 }
    );
  }
  // Soft floor so labels never look tiny when space allows
  if (avail / Math.max(1, labels.length) >= 52) {
    navFontPx = Math.max(navFontPx, Math.min(base, 13));
  }
}

onMount(() => {
  const measure = () => {
    shellWidth = footerRootEl?.clientWidth || window.innerWidth || 360;
    void tick().then(() => {
      fitNavFontSize();
      updatePillPosition();
    });
  };
  measure();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null;
  if (footerRootEl && ro) ro.observe(footerRootEl);
  window.addEventListener('resize', measure);
  return () => {
    ro?.disconnect();
    window.removeEventListener('resize', measure);
  };
});

// Reposition elastic pill + refit fonts when active tab / nav set / labels / locale change
$effect(() => {
  void currentView;
  void primaryNav;
  void moreOpen;
  void pillEpoch;
  void $t;
  void $locale;
  void tick().then(() => {
    fitNavFontSize();
    updatePillPosition();
  });
});
</script>

<!--
  Floating bottom nav (Google Photos style):
  fixed island over content — pill bar + circular FAB, elastic active indicator.
  pointer-events only on interactive children so content can receive clicks around the island.
-->
<div
  class="footer-float pointer-events-none shrink-0 w-full"
  bind:this={footerRootEl}
  style="--footer-float-inset: 2px;"
>
  <!-- More menu: same visual language as floating nav (icon only when active) -->
  {#if moreOpen && moreItems.length > 0}
    <!-- Transparent hit area (click-away); leave delay handles hover polish -->
    <button
      type="button"
      class="pointer-events-auto fixed inset-0 z-[90] bg-transparent cursor-default"
      aria-label={$t('common.close')}
      onclick={() => closeMoreNow()}
    ></button>
    <div
      class="pointer-events-auto absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-[100] more-menu-nav"
      role="menu"
      tabindex="-1"
      aria-label={$t('nav.moreMenu')}
      style="--nav-font-size: {navFontPx}px;"
      onmouseenter={cancelMoreClose}
      onmouseleave={scheduleCloseMore}
    >
      {#each moreItems as item (item.view)}
        {@const active =
          item.view === 'organize'
            ? currentView === 'organize' ||
              currentView === 'tagManagement' ||
              currentView === 'labelManagement' ||
              currentView === 'filtersManagement'
            : currentView === item.view}
        <button
          type="button"
          role="menuitem"
          class="more-menu-item {active ? 'active' : ''}"
          onclick={() => handleMoreItem(item.view)}
          aria-current={active ? 'page' : undefined}
        >
          <span class="nav-icon" aria-hidden="true">
            <Icon name={item.iconName} class="w-full h-full" />
          </span>
          <span class="nav-label" style="font-size: var(--nav-font-size, 12px);">{$t(item.labelKey)}</span>
        </button>
      {/each}
    </div>
  {/if}

  <!-- Floating island: nav pill + FAB (minimal outer padding for max label width) -->
  <div class="bottom-nav-container pointer-events-auto flex items-stretch justify-center gap-1.5 w-full px-0.5">
    <nav
      class="floating-nav relative flex items-center min-w-0 max-w-full"
      bind:this={floatingNavEl}
      aria-label={$t('nav.mainNav')}
      data-tour="footer-nav"
      style="--nav-font-size: {navFontPx}px;"
    >
      <!-- Elastic active pill (measures real button width like Google Photos) -->
      {#if pillReady}
        <div
          class="pill-indicator"
          style="width: {pillWidth}px; transform: translateX({pillOffset}px);"
          aria-hidden="true"
        ></div>
      {/if}

      {#each primaryNav as item (item.view)}
        {@const isActive = isPrimaryActive(item.view)}
        {@const isMailbox = item.view === 'main'}
        {@const label = $t(item.labelKey)}
        <button
          type="button"
          class="nav-item {isActive ? 'active' : ''}"
          use:navItemAction={String(item.view)}
          aria-label={label}
          aria-current={isActive ? 'page' : undefined}
          aria-expanded={item.view === 'more' ? moreOpen : undefined}
          onclick={(e) => {
            e.stopPropagation();
            handlePrimaryClick(item.view);
            void tick().then(updatePillPosition);
          }}
          onmouseenter={() => {
            if (item.view === 'more' && moreItems.length > 0) openMoreMenu();
            else if (moreOpen) scheduleCloseMore();
          }}
          onmouseleave={() => {
            if (item.view === 'more') scheduleCloseMore();
          }}
          title={isMailbox && totalUnread > 0 ? unreadTooltip : undefined}
        >
          <span class="nav-icon" aria-hidden="true">
            <Icon name={item.iconName} class="w-full h-full" />
          </span>
          <span class="nav-label" style="font-size: var(--nav-font-size, 13px);">{label}</span>
          {#if isMailbox && totalUnread > 0}
            <span class="nav-badge" aria-hidden="true">
              {totalUnread > 99 ? '99+' : totalUnread}
            </span>
          {/if}
        </button>
      {/each}
    </nav>

    {#if fabKind !== 'none'}
      <button
        type="button"
        id="footer-contextual-fab"
        class="fab-btn fab-pop shrink-0 {fabKind === 'refresh'
          ? 'fab-primary'
          : fabKind === 'ghostLogin' || fabKind === 'ghost' || fabKind === 'ghostExpand'
            ? 'fab-ghost'
            : 'fab-primary'}"
        aria-label={fabLabel}
        title={fabLabel}
        disabled={loading && fabKind === 'refresh'}
        oncontextmenu={(e) => {
          if (fabKind === 'createAddress') {
            openProviderMenu(e);
          } else {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onclick={(e) => {
          e.stopPropagation();
          handleFab();
        }}
      >
        <Icon
          name={fabIcon}
          class="w-6 h-6 {loading && fabKind === 'refresh' ? 'animate-spin' : ''}"
        />
      </button>
    {/if}
  </div>

  <ProviderCreateMenu
    open={providerMenuOpen && fabKind === 'createAddress'}
    x={providerMenuPos.x}
    y={providerMenuPos.y}
    {providerInstances}
    onClose={() => (providerMenuOpen = false)}
    onPick={pickProvider}
  />
</div>

<style>
  /*
   * Floating footer island — Google Photos–style pill nav + circular FAB.
   * Uses MD theme tokens so light/dark schemes stay consistent.
   */
  .footer-float {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    padding: 0;
    background: transparent;
  }

  .floating-nav {
    display: flex;
    align-items: center;
    background-color: color-mix(in srgb, var(--md-surface-container-high) 92%, transparent);
    backdrop-filter: blur(20px) saturate(1.2);
    -webkit-backdrop-filter: blur(20px) saturate(1.2);
    border-radius: 36px;
    padding: 0px;
    border: 1px solid color-mix(in srgb, var(--md-outline-variant) 45%, transparent);
    box-shadow:
      0 4px 16px color-mix(in srgb, var(--md-shadow, #000) 28%, transparent),
      0 1px 0 color-mix(in srgb, var(--md-inverse-surface) 8%, transparent) inset;
  }

  .pill-indicator {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    height: 100%;
    min-height: 100%;
    background-color: var(--md-secondary-container);
    border-radius: 28px;
    z-index: 1;
    pointer-events: none;
    box-sizing: border-box;
    transition:
      transform var(--motion-slow, 0.35s) var(--motion-ease, cubic-bezier(0.2, 0, 0, 1)),
      width var(--motion-slow, 0.35s) var(--motion-ease, cubic-bezier(0.2, 0, 0, 1));
  }
  @media (prefers-reduced-motion: reduce) {
    .pill-indicator {
      transition: none;
    }
    .nav-icon {
      transition: none;
    }
    .fab-btn {
      transition: none;
    }
  }

  /* More overflow menu — pill island matching floating-nav */
  .more-menu-nav {
    display: flex;
    align-items: center;
    flex-wrap: nowrap; /* single row only */
    justify-content: center;
    gap: 0;
    max-width: min(100vw - 8px, 100%);
    overflow-x: auto;
    padding: 4px;
    border-radius: 36px;
    background-color: color-mix(in srgb, var(--md-surface-container-high) 96%, transparent);
    backdrop-filter: blur(20px) saturate(1.2);
    -webkit-backdrop-filter: blur(20px) saturate(1.2);
    border: 1px solid color-mix(in srgb, var(--md-outline-variant) 45%, transparent);
    box-shadow:
      0 4px 16px color-mix(in srgb, var(--md-shadow, #000) 28%, transparent),
      0 1px 0 color-mix(in srgb, var(--md-inverse-surface) 8%, transparent) inset;
  }
  .more-menu-item {
    position: relative;
    z-index: 2;
    background: transparent;
    border: none;
    outline: none;
    color: var(--md-on-surface-variant);
    font-size: var(--nav-font-size, 12px);
    font-weight: 600;
    padding: 8px 12px;
    border-radius: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.25s ease, background-color 0.2s ease;
  }
  .more-menu-item:hover {
    color: var(--md-on-surface);
  }
  .more-menu-item.active {
    color: var(--md-on-secondary-container);
    background-color: var(--md-secondary-container);
  }
  .more-menu-item .nav-icon {
    display: inline-flex;
    width: 0;
    height: 18px;
    opacity: 0;
    margin-inline-end: 0;
    flex-shrink: 0;
    transform: scale(0.6);
    overflow: hidden;
    transition:
      opacity 0.25s ease 0.05s,
      transform 0.25s ease 0.05s,
      width 0.28s cubic-bezier(0.2, 0, 0, 1),
      margin 0.28s cubic-bezier(0.2, 0, 0, 1);
  }
  .more-menu-item.active .nav-icon {
    width: 18px;
    margin-inline-end: 6px;
    opacity: 1;
    transform: scale(1);
  }

  .nav-item {
    position: relative;
    z-index: 2;
    background: transparent;
    border: none;
    outline: none;
    color: var(--md-on-surface-variant);
    font-size: var(--nav-font-size, 13px);
    font-weight: 600;
    padding: 8px 10px;
    border-radius: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    white-space: nowrap;
    min-width: 0;
    max-width: none;
    box-sizing: border-box;
    transition: color 0.25s ease;
  }

  .nav-item:hover {
    color: var(--md-on-surface);
  }

  .nav-item.active {
    color: var(--md-on-secondary-container);
  }

  .nav-item:focus-visible {
    outline: 2px solid var(--md-primary);
    outline-offset: 2px;
  }

  /* Icon collapses when inactive; expands when active (Gemini reference) */
  .nav-icon {
    display: inline-flex;
    width: 0;
    height: 18px;
    opacity: 0;
    margin-inline-end: 0;
    flex-shrink: 0;
    transform: scale(0.6);
    overflow: hidden;
    transition:
      opacity 0.25s ease 0.05s,
      transform 0.25s ease 0.05s,
      width 0.28s cubic-bezier(0.2, 0, 0, 1),
      margin 0.28s cubic-bezier(0.2, 0, 0, 1);
  }

  .nav-item.active .nav-icon {
    width: 18px;
    margin-inline-end: 6px;
    opacity: 1;
    transform: scale(1);
  }

  .nav-label {
    line-height: 1;
    overflow: visible;
    text-overflow: clip;
    white-space: nowrap;
    /* No max-width / ellipsis — font-size is fitted so labels stay fully visible */
  }

  .nav-badge {
    position: absolute;
    top: 2px;
    inset-inline-end: 2px;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    border-radius: 999px;
    font-size: 9px;
    font-weight: 700;
    line-height: 14px;
    text-align: center;
    background: var(--md-error);
    color: var(--md-on-error);
    z-index: 3;
  }

  /* Circular FAB — height matches floating-nav via stretch + aspect-ratio */
  .fab-btn {
    align-self: stretch;
    width: auto;
    height: auto;
    aspect-ratio: 1 / 1;
    min-width: 2.25rem;
    min-height: 2.25rem;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border: none;
    outline: none;
    box-shadow:
      0 4px 16px color-mix(in srgb, var(--md-shadow, #000) 28%, transparent);
    transition:
      transform 0.15s ease,
      background-color 0.2s ease,
      opacity 0.2s ease;
  }

  .fab-btn:hover:not(:disabled) {
    transform: scale(1.05);
  }

  .fab-btn:active:not(:disabled) {
    transform: scale(0.95);
  }

  .fab-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .fab-btn:focus-visible {
    outline: 2px solid var(--md-primary);
    outline-offset: 2px;
  }

  .fab-primary {
    background-color: var(--md-primary);
    color: var(--md-on-primary);
  }

  .fab-primary:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .fab-ghost {
    background-color: color-mix(in srgb, var(--md-surface-container-high) 92%, transparent);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    color: var(--md-primary);
    border: 1px solid color-mix(in srgb, var(--md-outline-variant) 50%, transparent);
  }

  .fab-ghost:hover:not(:disabled) {
    background-color: color-mix(in srgb, var(--md-primary) 12%, var(--md-surface-container-high));
  }

  .fab-pop {
    animation: fab-in 280ms cubic-bezier(0.34, 1.4, 0.64, 1) both;
  }

  @keyframes fab-in {
    from {
      opacity: 0;
      transform: scale(0.6) translateY(8px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pill-indicator {
      transition: none;
    }
    .nav-icon {
      transition: none;
    }
    .fab-pop {
      animation: none;
    }
    .fab-btn {
      transition: none;
    }
  }
</style>
