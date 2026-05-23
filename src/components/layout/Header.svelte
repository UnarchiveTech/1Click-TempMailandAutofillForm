<script lang="ts">
import { browser } from 'wxt/browser';
import AppLogo from '@/components/icons/AppLogo.svelte';
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
        onclick={expandCurrentView}
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>
        </svg>
      </button>
    </div>
  </div>
</div>
