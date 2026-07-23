<script lang="ts">
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import AppLogo from '@/components/icons/AppLogo.svelte';
import Icon from '@/components/icons/Icon.svelte';
import ThemeToggle from '@/components/ui/ThemeToggle.svelte';
import type { ContrastLevel } from '@/features/theme/theme-actions.js';
import type { View } from '@/features/types/view-types.js';
import type { Account, Email } from '@/utils/types.js';

export interface ExpandedAppState {
  currentView?: View;
  mgmtTab?: string;
  mgmtSearch?: string;
  selectedEmail?: string;
  selectedThread?: Email[];
  currentEmailDetail?: Account | null;
  archivedSearch?: string;
}

let {
  themeMode = 'auto',
  onThemeChange = () => {},
  contrastLevel = 'standard' as ContrastLevel,
  onContrastChange = (_c: ContrastLevel) => {},
  expandState = {},
  /** Show back control (sub-views / message detail) */
  showBack = false,
  onBack = () => {},
  /** Compact logo: icon only, centered when showBack */
  compactLogo = false,
  /** App logo click → About */
  onLogoClick = () => {},
  /** Page title on the left when this destination lives under More (not primary nav) */
  pageTitle = '' as string,
  /** When true, center logo+1Click and put pageTitle on the left */
  morePageChrome = false,
} = $props<{
  themeMode?: 'light' | 'auto' | 'dark';
  onThemeChange?: (mode: 'light' | 'auto' | 'dark') => void;
  contrastLevel?: ContrastLevel;
  onContrastChange?: (level: ContrastLevel) => void;
  expandState?: ExpandedAppState;
  showBack?: boolean;
  onBack?: () => void;
  compactLogo?: boolean;
  onLogoClick?: () => void;
  pageTitle?: string;
  morePageChrome?: boolean;
}>();

async function expandCurrentView() {
  try {
    await browser.storage.local.set({
      expandedAppState: {
        ...expandState,
        createdAt: Date.now(),
      },
    });
    // Prefer full extension URL (relative /app.html fails in some MV3 hosts)
    const runtime = browser.runtime as { getURL?: (path: string) => string };
    const appUrl = typeof runtime.getURL === 'function' ? runtime.getURL('/app.html') : '/app.html';
    await browser.tabs.create({ url: appUrl });
  } catch {
    /* expand failed — keep UI quiet */
  }
}

const useCenteredChrome = $derived(showBack || compactLogo || morePageChrome);
</script>

<div class="shrink-0 relative flex items-center min-h-[32px] h-8 pl-[2.5px] pr-[2.5px]">
  <!-- Far-left back - same chrome color language as expand-view control -->
  {#if showBack}
    <button
      type="button"
      class="absolute start-0 z-10 w-7 h-7 flex items-center justify-center rounded-lg text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-outline-variant/30 transition-all duration-200 active:scale-95"
      aria-label={$t('common.back')}
      title={$t('common.back')}
      onclick={(e) => {
        e.stopPropagation();
        onBack();
      }}
    >
      <Icon name="back" class="w-4 h-4" />
    </button>
  {:else if morePageChrome && pageTitle}
    <!-- More destinations: page title on the left; logo centered -->
    <div class="absolute start-0 z-10 max-w-[38%] ps-0.5">
      <span class="text-sm font-semibold text-md-on-surface truncate block">{pageTitle}</span>
    </div>
  {/if}

  <!-- Logo: full branding on main; click opens About -->
  <div
    class="flex items-center w-full {showBack
      ? 'justify-start ps-9'
      : useCenteredChrome
        ? 'justify-center'
        : 'justify-start'}"
  >
    <button
      type="button"
      class="flex items-center rounded-lg hover:opacity-90 active:scale-[0.98] transition-all focus-visible:outline-2 focus-visible:outline-md-primary"
      aria-label={$t('nav.about')}
      title={$t('nav.about')}
      onclick={(e) => {
        e.stopPropagation();
        onLogoClick();
      }}
    >
      <AppLogo
        compact={useCenteredChrome && !showBack && !morePageChrome}
        showTitle={showBack || morePageChrome}
      />
    </button>
  </div>

  <!-- Theme toggle + expand in header right -->
  <div class="absolute end-0 flex items-center gap-1.5">
    <ThemeToggle
      {themeMode}
      {onThemeChange}
      {contrastLevel}
      {onContrastChange}
      menuPlacement="bottom"
    />
    <button
      class="w-7 h-7 flex items-center justify-center rounded-lg text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-outline-variant/30 transition-all duration-200 active:scale-95"
      title={$t('header.expandView')}
      aria-label={$t('header.expandView')}
      onclick={(e) => {
        e.stopPropagation();
        void expandCurrentView();
      }}
    >
      <Icon name="expand" class="w-4 h-4" />
    </button>
  </div>
</div>
