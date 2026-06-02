<script lang="ts">
import Icon from '@/components/icons/Icon.svelte';
import type { Account } from '@/utils/types.js';

let {
  currentView = 'main',
  onNavigate = () => {},
  accounts = [],
  unreadByAddress = {},
} = $props<{
  currentView?: View;
  onNavigate?: (view: View) => void;
  accounts?: Account[];
  unreadByAddress?: Record<string, number>;
}>();

let totalUnread = $derived(
  (Object.entries(unreadByAddress) as [string, number][])
    .filter(([addr]) => accounts.some((a: Account) => a.address === addr && a.status === 'active'))
    .reduce((sum, [, count]) => sum + count, 0)
);

let unreadTooltip = $derived.by(() => {
  if (!totalUnread) return 'Mailbox';
  const activeWithUnread = (Object.entries(unreadByAddress) as [string, number][])
    .filter(
      ([addr, count]) =>
        count > 0 && accounts.some((a: Account) => a.address === addr && a.status === 'active')
    )
    .map(([addr, count]) => `${addr} \u2192 ${count} unread`);
  if (activeWithUnread.length === 0) return 'Mailbox';
  return activeWithUnread.join('\n');
});

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
  | 'identities'
  | 'keybindings'
  | 'tagManagement'
  | 'filtersManagement'
  | 'mailProvider'
  | 'storagePerformance'
  | 'labelManagement'
  | 'mailboxManagement';

const navItems: { view: View; label: string; iconName: string }[] = [
  { view: 'main', label: 'Mailbox', iconName: 'mail' },
  { view: 'mailSettings', label: 'Manage', iconName: 'archive' },
  { view: 'loginInfo', label: 'Saved', iconName: 'user' },
  { view: 'identities', label: 'Identities', iconName: 'user' },
  { view: 'analytics', label: 'Activity', iconName: 'barChart' },
  { view: 'settings', label: 'Settings', iconName: 'settings' },
  { view: 'about', label: 'About', iconName: 'info' },
];
</script>

<!-- Floating Island Nav -->
<div class="flex justify-center w-full py-0 px-0">
  <nav
    class="floating-nav flex items-center justify-between w-[360px] gap-0 px-0 py-0 rounded-xl backdrop-blur-3xl bg-md-surface/50 border border-white/10 shadow-xl"
    aria-label="Main navigation"
  >
    {#each navItems as item}
      {@const isActive = currentView === item.view}
      {@const isMailbox = item.view === 'main'}
      <button
        class="relative flex-1 flex flex-col items-center gap-0.5 px-1.5 py-1.5 transition-all duration-200 hover:scale-105 active:scale-95 {isActive ? 'bg-md-primary rounded-[10px]' : 'rounded-full hover:bg-md-surface-variant'}"
        aria-label={item.label}
        aria-current={isActive ? 'page' : undefined}
        onclick={(e) => { e.stopPropagation(); onNavigate(item.view); }}
        title={isMailbox && unreadTooltip ? unreadTooltip : item.label}
      >
        <div class="relative">
          <Icon name={item.iconName} class="w-4 h-4 transition-colors duration-200 {isActive ? 'text-md-on-primary' : 'text-md-on-surface/50'}" />
          {#if isMailbox && totalUnread > 0}
            <span class="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full text-[8px] font-bold px-0.5 bg-md-error text-md-on-error">{totalUnread > 99 ? '99+' : totalUnread}</span>
          {/if}
        </div>
        <span class="text-[10px] font-semibold leading-none transition-colors duration-200 {isActive ? 'text-md-on-primary' : 'text-md-on-surface/50'}">
          {item.label}
        </span>
      </button>
    {/each}
  </nav>
</div>

<style>
  .floating-nav {
    box-shadow: 0 8px 32px color-mix(in srgb, var(--md-shadow, #000000) 12%, transparent), 0 0 0 1px color-mix(in srgb, var(--md-inverse-surface, #e2e2e9) 15%, transparent) inset, 0 0 0 1px color-mix(in srgb, var(--md-outline, #75777f) 5%, transparent);
  }
</style>
