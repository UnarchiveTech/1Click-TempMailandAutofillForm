<script lang="ts">
import { browser } from 'wxt/browser';
import AppLogo from '@/components/icons/AppLogo.svelte';
import Icon from '@/components/icons/Icon.svelte';
import ThemeToggle from '@/components/ui/ThemeToggle.svelte';
import type { View } from '@/features/types/view-types.js';
import type { Account, Email } from '@/utils/types.js';

export interface ExpandedAppState {
  currentView?: View;
  mgmtTab?: string;
  mgmtSearch?: string;
  selectedEmail?: string;
  selectedMessage?: Email | null;
  currentEmailDetail?: Account | null;
  archivedSearch?: string;
}

let {
  themeMode = 'auto',
  onThemeChange = () => {},
  expandState = {},
} = $props<{
  themeMode?: 'light' | 'auto' | 'dark';
  onThemeChange?: (mode: 'light' | 'auto' | 'dark') => void;
  expandState?: ExpandedAppState;
}>();

async function expandCurrentView() {
  await browser.storage.local.set({
    expandedAppState: {
      ...expandState,
      createdAt: Date.now(),
    },
  });
  await browser.tabs.create({ url: '/app.html' });
}
</script>

<div class="flex items-center relative pl-[2.5px] pr-[2.5px]">
  <div class="flex items-center w-full px-0">
    <AppLogo />
    <!-- Theme toggle + expand in header right -->
    <div class="absolute right-0 flex items-center gap-1.5">
      <ThemeToggle {themeMode} {onThemeChange} />
      <button
        class="w-7 h-7 flex items-center justify-center rounded-lg text-md-on-surface/50 hover:text-md-on-surface hover:bg-md-outline-variant transition-all duration-200 active:scale-95"
        title="Full Page"
        aria-label="Expand view"
        onclick={(e) => { e.stopPropagation(); void expandCurrentView(); }}
      >
        <Icon name="expand" class="w-4 h-4" />
      </button>
    </div>
  </div>
</div>
