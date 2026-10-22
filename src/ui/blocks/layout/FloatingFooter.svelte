<script lang="ts">
import { t } from 'svelte-i18n';
import type { View } from '@/features/types/view-types.js';
import Icon from '@/ui/components/icons/Icon.svelte';
import type { Address, ProviderInstance } from '@/utils/types.js';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { NAV_FAB_SIZE_PX, NAV_FLOAT_BOTTOM_PX } from '@/utils/ui/nav-layout.js';
import { PORTAL_Z_CLASS } from '@/utils/ui/portal-layers.js';
import type { OrganizeTabKind } from '@/utils/ui/sidebar-fab.js';
import Footer, { type FooterFabKind } from './Footer.svelte';

type FloatingFooterProps = {
  currentView: View;
  scrollChromeHidden: boolean;
  organizeTab: OrganizeTabKind;
  accounts: Address[];
  unreadByAddress: Record<string, number>;
  loading: boolean;
  providerInstances: ProviderInstance[];
  demoModeActive: boolean;
  rootElement?: HTMLElement | null;
  onNavigate: (view: View) => void;
  onLongPressNavbar: () => void;
  onCreateAddressWithProvider: (providerId: string, instanceId?: string) => void;
  onOpenProviderSettings: () => void;
  onRefresh: () => void | Promise<void>;
  onCreateAddress: () => void | Promise<void>;
  onCreateIdentity: () => void;
  onCreateTag: () => void;
  onCreateLabel: () => void;
  onCreateFilter: () => void;
  onOpenSavedLogins: () => void;
  onExpandCurrentView: () => void | Promise<void>;
  onScrollToTop: () => void;
  onExitDemoMode: () => void | Promise<void>;
};

let {
  currentView,
  scrollChromeHidden,
  organizeTab,
  accounts,
  unreadByAddress,
  loading,
  providerInstances,
  demoModeActive,
  rootElement = $bindable<HTMLElement | null>(null),
  onNavigate,
  onLongPressNavbar,
  onCreateAddressWithProvider,
  onOpenProviderSettings,
  onRefresh,
  onCreateAddress,
  onCreateIdentity,
  onCreateTag,
  onCreateLabel,
  onCreateFilter,
  onOpenSavedLogins,
  onExpandCurrentView,
  onScrollToTop,
  onExitDemoMode,
}: FloatingFooterProps = $props();

function handleFabClick(kind: FooterFabKind) {
  switch (kind) {
    case 'refresh':
      void onRefresh();
      break;
    case 'createAddress':
      void onCreateAddress();
      break;
    case 'createIdentity':
      onCreateIdentity();
      break;
    case 'createTag':
      onCreateTag();
      break;
    case 'createLabel':
      onCreateLabel();
      break;
    case 'createFilter':
      onCreateFilter();
      break;
    case 'ghostLogin':
      onOpenSavedLogins();
      break;
    case 'ghostExpand':
      void onExpandCurrentView();
      break;
    case 'ghost':
      onScrollToTop();
      break;
    case 'none':
      break;
  }
}
</script>

<div
  bind:this={rootElement}
  class="bottom-floating-layer-wrapper absolute bottom-0 inset-x-0 {PORTAL_Z_CLASS.chrome} pointer-events-none"
>
  {#if demoModeActive}
    <!-- Anchored to the island it floats above: its own bottom gap plus the
         island's height, both from nav-layout.ts. This used to read
         `--footer-safe` - a shell variable for the CONTENT safe area - so the
         badge drifted away from the island whenever that value changed. -->
    <div
      class="absolute end-2 {PORTAL_Z_CLASS.chrome} pointer-events-auto"
      style="bottom: calc({NAV_FLOAT_BOTTOM_PX}px + {NAV_FAB_SIZE_PX}px + 0.5rem);"
    >
      <button
        type="button"
        data-demo-exit
        class="px-3 py-1.5 rounded-full text-label-sm font-bold {ELEVATION.level3} bg-md-error text-md-on-error hover:brightness-110 active:brightness-95 transition-all active:scale-95 flex items-center gap-1.5"
        onclick={() => void onExitDemoMode()}
      >
        <Icon name="close" class="w-3.5 h-3.5" />
        {$t('preferences.exitDemoMode')}
      </button>
    </div>
  {/if}
  <Footer
    {currentView}
    {scrollChromeHidden}
    {organizeTab}
    {accounts}
    {unreadByAddress}
    {loading}
    {providerInstances}
    onNavigate={onNavigate}
    onLongPressNavbar={onLongPressNavbar}
    onCreateAddressWithProvider={onCreateAddressWithProvider}
    onOpenProviderSettings={onOpenProviderSettings}
    onFabClick={handleFabClick}
  />
</div>
