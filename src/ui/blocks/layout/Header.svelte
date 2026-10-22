<script lang="ts">
import { t } from 'svelte-i18n';
import type { ContrastLevel } from '@/features/theme/theme-actions.js';
import {
  activeViewHeaderStore,
  type ViewHeaderState,
} from '@/ui/components/composites/view-header-store.js';
import AppLogo from '@/ui/components/icons/AppLogo.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';
import ThemeToggle from '@/ui/components/primitives/ThemeToggle.svelte';

let {
  themeMode = 'auto',
  onThemeChange = () => {},
  contrastLevel = 'standard' as ContrastLevel,
  onContrastChange = (_c: ContrastLevel) => {},
  onExpand,
  /** Show back control (sub-views / message detail) */
  showBack = false,
  onBack = () => {},
  /** App logo click → About */
  onLogoClick = () => {},
  /** Page title on the left when this destination lives under More (not primary nav) */
  pageTitle = '' as string,
  /** When true, center logo+1Click and put pageTitle on the left */
  morePageChrome = false,
  /** Canonical nav icon shown before a More/sub-navigation page title. */
  pageIcon = undefined as KnownIconName | undefined,
}: {
  themeMode?: 'light' | 'auto' | 'dark';
  onThemeChange?: (mode: 'light' | 'auto' | 'dark') => void;
  contrastLevel?: ContrastLevel;
  onContrastChange?: (level: ContrastLevel) => void;
  onExpand: () => void | Promise<void>;
  showBack?: boolean;
  onBack?: () => void;
  onLogoClick?: () => void;
  pageTitle?: string;
  morePageChrome?: boolean;
  pageIcon?: KnownIconName;
} = $props();

let dynamicHeader = $derived($activeViewHeaderStore);

let effectiveShowBack = $derived(dynamicHeader?.showBack ?? showBack);
let effectivePageTitle = $derived(
  dynamicHeader?.title ??
    (dynamicHeader?.titleKey ? ($t(dynamicHeader.titleKey) as string) : pageTitle)
);
let effectiveOnBack = $derived(dynamicHeader?.onBack ?? onBack);
let effectivePageIcon = $derived(dynamicHeader?.icon ?? pageIcon);
</script>

<div class="shrink-0 relative flex items-center min-h-[32px] h-8 pl-[2.5px] pr-[2.5px]">
  <!-- Far-left back - same chrome color language as expand-view control -->
  {#if effectiveShowBack}
    <button
      type="button"
      class="absolute start-0 z-10 w-7 h-7 flex items-center justify-center rounded-full text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-outline-variant/30 active:bg-md-outline-variant/50 transition-all duration-200 active:scale-95"
      aria-label={$t('common.back')}
      title={$t('common.back')}
      onclick={(e) => {
        e.stopPropagation();
        effectiveOnBack();
      }}
    >
      <Icon name="back" class="w-4 h-4" />
    </button>
  {/if}

  {#if (morePageChrome || dynamicHeader?.title || dynamicHeader?.titleKey) && effectivePageTitle}
    <!--
      More-page chrome: three equal-width zones ([Title] [Logo + 1Click] [Theme + Expand]).
      Equal columns make both gaps identical by construction - no hardcoded spacing -
      and the center stays optically centered across popup / sidepanel / app widths.
    -->
    <div class="absolute inset-0 grid grid-cols-3 items-center gap-2">
      <div class="flex items-center gap-1.5 min-w-0 ps-0.5">
        {#if effectivePageIcon}
          <Icon name={effectivePageIcon} class="w-4 h-4 shrink-0 text-md-primary" aria-hidden="true" />
        {/if}
        <span class="text-sm font-semibold text-md-on-surface truncate block" title={effectivePageTitle}>{effectivePageTitle}</span>
      </div>
      <div class="flex items-center justify-center min-w-0">
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
          <AppLogo compact={false} showTitle={true} />
        </button>
      </div>
      <div class="flex items-center justify-end gap-1.5 pe-0.5">
        <ThemeToggle
          {themeMode}
          {onThemeChange}
          {contrastLevel}
          {onContrastChange}
          menuPlacement="bottom"
        />
        <button
          class="w-7 h-7 flex items-center justify-center rounded-full bg-md-surface-container-high text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-outline-variant/30 active:bg-md-outline-variant/50 transition-all duration-200 active:scale-95"
          title={$t('header.expandView')}
          aria-label={$t('header.expandView')}
          onclick={(e) => {
            e.stopPropagation();
            void onExpand();
          }}
        >
          <Icon name="expand" class="w-4 h-4" />
        </button>
      </div>
    </div>
  {:else}
    <!-- Logo: full branding on main pages; icon + title on back/sub-pages -->
    <div class="flex items-center w-full {showBack ? 'justify-start ps-9' : 'justify-start'}">
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
        <AppLogo compact={showBack} showTitle={showBack} />
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
        class="w-7 h-7 flex items-center justify-center rounded-full bg-md-surface-container-high text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-outline-variant/30 active:bg-md-outline-variant/50 transition-all duration-200 active:scale-95"
        title={$t('header.expandView')}
        aria-label={$t('header.expandView')}
        onclick={(e) => {
          e.stopPropagation();
          void onExpand();
        }}
      >
        <Icon name="expand" class="w-4 h-4" />
      </button>
    </div>
  {/if}
</div>
