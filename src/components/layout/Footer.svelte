<script lang="ts">
import type { Component } from 'svelte';
import IconArchive from '@/components/icons/IconArchive.svelte';
import IconBarChart from '@/components/icons/IconBarChart.svelte';
import IconInfo from '@/components/icons/IconInfo.svelte';
import IconMail from '@/components/icons/IconMail.svelte';
import IconSettings from '@/components/icons/IconSettings.svelte';
import IconUser from '@/components/icons/IconUser.svelte';

let { currentView = 'main', onNavigate = () => {} } = $props<{
  currentView?: View;
  onNavigate?: (view: View) => void;
}>();

type View =
  | 'main'
  | 'mailSettings'
  | 'settings'
  | 'analytics'
  | 'loginInfo'
  | 'archivedEmails'
  | 'emailDetail'
  | 'messageDetail'
  | 'about'
  | 'identities';

const navItems: { view: View; label: string; icon: Component }[] = [
  { view: 'main', label: 'Inbox', icon: IconMail },
  { view: 'mailSettings', label: 'Manage', icon: IconArchive },
  { view: 'loginInfo', label: 'Saved', icon: IconUser },
  { view: 'identities', label: 'Identities', icon: IconUser },
  { view: 'analytics', label: 'Activity', icon: IconBarChart },
  { view: 'settings', label: 'Settings', icon: IconSettings },
  { view: 'about', label: 'About', icon: IconInfo },
];
</script>

<!-- Floating Island Nav -->
<div class="flex justify-center w-full py-0 px-0">
  <nav
    class="flex items-center justify-between w-[360px] gap-0 px-0 py-0 rounded-xl backdrop-blur-3xl bg-md-surface/50 border border-white/10 shadow-xl"
    style="box-shadow: 0 8px 32px color-mix(in srgb, var(--md-shadow, #000000) 12%, transparent), 0 0 0 1px color-mix(in srgb, var(--md-inverse-surface, #e2e2e9) 15%, transparent) inset, 0 0 0 1px color-mix(in srgb, var(--md-outline, #75777f) 5%, transparent);"
    aria-label="Main navigation"
  >
    {#each navItems as item}
      {@const isActive = currentView === item.view}
      <button
        class="relative flex-1 flex flex-col items-center gap-0.5 px-1.5 py-1.5 transition-all duration-200 hover:scale-105 active:scale-95 {isActive ? 'bg-md-primary rounded-[10px]' : 'rounded-full hover:bg-md-surface-variant'}"
        aria-label={item.label}
        aria-current={isActive ? 'page' : undefined}
        onclick={() => onNavigate(item.view)}
      >
        <item.icon class="w-4 h-4 transition-colors duration-200 {isActive ? 'text-md-on-primary' : 'text-md-on-surface/50'}" />
        <span class="text-[10px] font-semibold leading-none transition-colors duration-200 {isActive ? 'text-md-on-primary' : 'text-md-on-surface/50'}">
          {item.label}
        </span>
      </button>
    {/each}
  </nav>
</div>
