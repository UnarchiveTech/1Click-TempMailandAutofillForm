<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import { clearActivityEvents, getActivityEvents } from '@/utils/activity-tracker.js';
import { downloadCSV, exportAnalyticsToCSV } from '@/utils/csv-export.js';
import { logError } from '@/utils/logger.js';
import type { ActivityEvent, Analytics } from '@/utils/types.js';

let {
  context = 'popup',
  onBack = () => {},
  analytics = {
    createdAt: undefined,
    accountsCreated: 0,
    emailsReceived: 0,
    otpsDetected: 0,
    notificationsSent: 0,
  },
  loading = false,
  onLoadAnalytics = () => {},
  onResetAnalytics = () => {},
} = $props<{
  context?: 'popup' | 'sidepanel' | 'app';
  onBack?: () => void;
  analytics?: Analytics;
  loading?: boolean;
  onLoadAnalytics?: () => void;
  onResetAnalytics?: () => void;
}>();

let refreshInterval: ReturnType<typeof setInterval> | null = null;
let activityEvents = $state<ActivityEvent[]>([]);
let loadingEvents = $state(false);

// Filter states
let activityTypeFilter = $state<string>('all');
let addressFilter = $state<string>('all');
let actionTypeDropdownOpen = $state(false);
let fromDropdownOpen = $state(false);
let fromSearch = $state('');

// Reset confirmation dialog
let resetDialogOpen = $state(false);

async function handleReset() {
  await clearActivityEvents();
  await onResetAnalytics();
  await loadActivityEvents();
  resetDialogOpen = false;
}

async function handleExportAnalytics() {
  try {
    const csvContent = exportAnalyticsToCSV(analytics, activityEvents);
    const filename = `1click-analytics-${new Date().toISOString().split('T')[0]}.csv`;
    downloadCSV(csvContent, filename);
  } catch (error) {
    logError('Failed to export analytics:', error);
  }
}

// Derived filtered events
let filteredEvents = $derived.by(() => {
  return activityEvents.filter((event) => {
    // Filter by activity type
    if (activityTypeFilter !== 'all') {
      if (activityTypeFilter === 'auto_extend' && event.type !== 'auto_extend') return false;
      if (activityTypeFilter === 'inbox_created' && event.type !== 'account_created') return false;
      if (activityTypeFilter === 'hard_reset' && event.type !== 'hard_reset') return false;
      if (
        activityTypeFilter === 'notification' &&
        event.type !== 'notification_sent' &&
        event.type !== 'toast_notification'
      )
        return false;
    }
    // Filter by address
    if (addressFilter !== 'all' && event.data.inboxAddress !== addressFilter) return false;
    return true;
  });
});

// Get unique email addresses from events for From filter
let uniqueAddresses = $derived.by(() => {
  const addresses = new Set<string>();
  activityEvents.forEach((event) => {
    if (event.data.inboxAddress) {
      addresses.add(event.data.inboxAddress);
    }
  });
  return Array.from(addresses).sort();
});

async function recordRenderTime(renderTime: number) {
  try {
    await browser.runtime.sendMessage({ type: 'recordUIRenderTime', renderTime });
  } catch (error) {
    logError('Failed to record UI render time:', error);
  }
}

async function loadActivityEvents() {
  const startTime = performance.now();
  loadingEvents = true;
  activityEvents = await getActivityEvents();
  loadingEvents = false;
  const renderTime = performance.now() - startTime;
  await recordRenderTime(renderTime);
}

onMount(() => {
  const mountStartTime = performance.now();
  // Auto-refresh analytics every 30 seconds
  refreshInterval = setInterval(() => {
    onLoadAnalytics();
    loadActivityEvents();
  }, 30000);
  // Load immediately on mount
  onLoadAnalytics();
  loadActivityEvents();
  const mountRenderTime = performance.now() - mountStartTime;
  recordRenderTime(mountRenderTime);
});

onDestroy(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
});

function getEventIcon(type: ActivityEvent['type']): string {
  switch (type) {
    case 'email_received':
      return 'mail';
    case 'otp_detected':
      return 'envelope';
    case 'notification_sent':
      return 'bell';
    case 'account_created':
      return 'barChart';
    case 'account_deleted':
      return 'barChart';
    case 'auto_fill':
      return 'clock';
    case 'toast_notification':
      return 'bell';
    case 'auto_extend':
      return 'refresh';
    case 'hard_reset':
      return 'refresh';
    default:
      return 'mail';
  }
}

function getEventTitle(type: ActivityEvent['type'], data: ActivityEvent['data']) {
  const tr = get(t);
  const sender = data.sender || tr('activity.unknownSender');
  switch (type) {
    case 'email_received':
      return tr('activity.eventEmailReceived', { values: { sender } });
    case 'otp_detected':
      return tr('activity.eventOtpDetected', { values: { sender } });
    case 'notification_sent':
      return tr('activity.eventNotificationSent', { values: { sender } });
    case 'account_created':
      return tr('activity.eventAccountCreated', { values: { address: data.inboxAddress } });
    case 'account_deleted':
      return tr('activity.eventAccountDeleted', { values: { address: data.inboxAddress } });
    case 'auto_fill':
      return tr('activity.eventAutoFill', { values: { website: data.website } });
    case 'toast_notification':
      return data.message || tr('activity.eventToastNotification');
    case 'auto_extend':
      return tr('activity.eventAutoExtended', { values: { address: data.inboxAddress } });
    case 'hard_reset':
      return tr('activity.eventHardReset');
    default:
      return tr('activity.eventUnknown');
  }
}

function getEventSubtitle(type: ActivityEvent['type'], data: ActivityEvent['data']) {
  const tr = get(t);
  const fallbackSubject = tr('activity.noSubject');
  switch (type) {
    case 'email_received':
      return data.subject || fallbackSubject;
    case 'otp_detected':
      return data.subject || fallbackSubject;
    case 'notification_sent':
      return data.subject || fallbackSubject;
    case 'account_created':
      return data.inboxAddress;
    case 'account_deleted':
      return data.inboxAddress;
    case 'auto_fill':
      return data.website;
    case 'toast_notification':
      return data.toastType || tr('activity.toastInfo');
    case 'auto_extend':
      return data.inboxAddress;
    case 'hard_reset':
      return tr('activity.allDataCleared');
    default:
      return '';
  }
}

function formatTime(timestamp: number) {
  const tr = get(t);
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) return tr('activity.timeJustNow');
  if (diff < 3600000)
    return tr('activity.timeMinutesAgo', { values: { n: Math.floor(diff / 60000) } });
  if (diff < 86400000)
    return tr('activity.timeHoursAgo', { values: { n: Math.floor(diff / 3600000) } });
  return new Date(timestamp).toLocaleDateString();
}

async function copyOtp(otp: string) {
  try {
    await navigator.clipboard.writeText(otp);
  } catch {
    // Best-effort copy; ignore failures
  }
}
</script>

{#if loading}
  <div class="flex-1 overflow-y-auto px-4 py-4 space-y-4">
    {#each [1,2,3,4] as _}
      <div class="rounded-xl bg-md-primary-container p-4 space-y-2 animate-pulse">
        <div class="h-3 w-24 bg-md-secondary-container rounded"></div>
        <div class="h-8 w-32 bg-md-secondary-container rounded"></div>
      </div>
    {/each}
  </div>
{:else}
<div class="flex-1 overflow-y-auto px-4 py-4 space-y-5 pb-20">

  <!-- Page heading -->
  <div class="pt-1">
    <h1 class="text-lg font-bold text-md-on-surface">{$t('activity.title')}</h1>
    <p class="text-xs text-md-on-surface/50 mt-0.5">{$t('activity.subtitle')}</p>
  </div>

  <!-- ── Summary Stats Cards ── -->
  <section class="space-y-2">
    <div class="flex items-center gap-2 mb-1">
      <Icon name="barChart" class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-semibold text-md-on-surface">{$t('activity.summary')}</span>
    </div>

    <div class="grid grid-cols-2 gap-2">
      <div class="bg-md-tertiary-container rounded-xl px-3 py-3 flex flex-col items-center justify-center">
        <div class="text-2xl font-bold text-md-primary">{analytics.accountsCreated}</div>
        <div class="text-xs text-md-on-surface/50">{$t('activity.inboxes')}</div>
      </div>

      <div class="bg-md-tertiary-container rounded-xl px-3 py-3 flex flex-col items-center justify-center">
        <div class="text-2xl font-bold text-md-secondary">{analytics.emailsReceived}</div>
        <div class="text-xs text-md-on-surface/50">{$t('activity.emails')}</div>
      </div>

      <div class="bg-md-tertiary-container rounded-xl px-3 py-3 flex flex-col items-center justify-center">
        <div class="text-2xl font-bold text-md-tertiary">{analytics.otpsDetected}</div>
        <div class="text-xs text-md-on-surface/50">{$t('activity.otps')}</div>
      </div>

      <div class="bg-md-tertiary-container rounded-xl px-3 py-3 flex flex-col items-center justify-center">
        <div class="text-2xl font-bold text-md-primary">{analytics.notificationsSent}</div>
        <div class="text-xs text-md-on-surface/50">{$t('activity.notifications')}</div>
      </div>
    </div>
  </section>

  <!-- ── Performance Metrics ── -->
  {#if analytics.performance}
    <section class="space-y-2">
      <div class="flex items-center gap-2 mb-1">
        <Icon name="clock" class="w-4 h-4 text-md-primary" />
        <span class="text-sm font-semibold text-md-on-surface">{$t('activity.performance')}</span>
      </div>

      <div class="bg-md-primary-container rounded-xl px-4 py-3 space-y-3">
        <!-- Email Fetch Time -->
        <div class="flex items-center justify-between">
          <div class="text-xs text-md-on-surface/70">{$t('activity.avgEmailFetch')}</div>
          <div class="text-sm font-semibold text-md-primary">
            {analytics.performance.emailFetchTimes.length > 0
              ? `${(analytics.performance.emailFetchTimes.reduce((a: number, b: number) => a + b, 0) / analytics.performance.emailFetchTimes.length).toFixed(0)}ms`
              : $t('activity.notAvailable')}
          </div>
        </div>

        <!-- UI Render Time -->
        <div class="flex items-center justify-between">
          <div class="text-xs text-md-on-surface/70">{$t('activity.avgUiRender')}</div>
          <div class="text-sm font-semibold text-md-secondary">
            {analytics.performance.uiRenderTimes.length > 0
              ? `${(analytics.performance.uiRenderTimes.reduce((a: number, b: number) => a + b, 0) / analytics.performance.uiRenderTimes.length).toFixed(0)}ms`
              : $t('activity.notAvailable')}
          </div>
        </div>

        <!-- Provider Latency -->
        {#if Object.keys(analytics.performance.providerLatency).length > 0}
          <div class="pt-2 border-t border-md-outline-variant/30">
            <div class="text-xs text-md-on-surface/70 mb-2">{$t('activity.providerLatency')}</div>
            {#each Object.entries(analytics.performance.providerLatency) as [provider, latencies]}
              <div class="flex items-center justify-between mb-1 last:mb-0">
                <div class="text-xs text-md-on-surface/60 capitalize">{provider}</div>
                <div class="text-xs font-medium text-md-tertiary">
                  {Array.isArray(latencies) && latencies.length > 0
                    ? `${(latencies.reduce((a: number, b: number) => a + b, 0) / latencies.length).toFixed(0)}ms`
                    : $t('activity.notAvailable')}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </section>
  {/if}

  <!-- ── Activity Timeline ── -->
  <section class="space-y-2">
    <div class="flex items-center gap-2 mb-1">
      <Icon name="clock" class="w-4 h-4 text-md-primary" />
      <span class="text-sm font-semibold text-md-on-surface">{$t('activity.recentActivity')}</span>
    </div>

    <!-- Filter pills -->
    <div class="flex items-center gap-2 flex-wrap">
      <!-- Action Type filter -->
      <div class="relative shrink-0">
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-colors {activityTypeFilter !== 'all' ? 'border-md-primary bg-md-primary/10 text-md-primary' : 'border-md-outline-variant bg-transparent text-md-on-surface/80 hover:bg-md-surface-variant'}"
          aria-label={$t('activity.filterByActionType')}
          onclick={() => { actionTypeDropdownOpen = !actionTypeDropdownOpen; fromDropdownOpen = false; }}
        >
          {$t('activity.actionLabel')}: {activityTypeFilter === 'all' ? $t('activity.all') : activityTypeFilter === 'auto_extend' ? $t('activity.autoExtend') : activityTypeFilter === 'inbox_created' ? $t('activity.newInbox') : activityTypeFilter === 'hard_reset' ? $t('activity.hardReset') : activityTypeFilter === 'notification' ? $t('activity.notification') : $t('activity.all')}
          <Icon name="chevronDown" class="w-3 h-3" />
        </button>
        {#if actionTypeDropdownOpen}
          <div class="absolute top-full left-0 mt-1 bg-md-surface border border-md-outline-variant rounded-xl shadow-lg z-[200] overflow-hidden min-w-[140px]">
            {#each [['all', $t('activity.all')], ['auto_extend', $t('activity.autoExtend')], ['inbox_created', $t('activity.newInbox')], ['hard_reset', $t('activity.hardReset')], ['notification', $t('activity.notification')]] as [val, label]}
              <button
                class="w-full px-3 py-2 text-left text-xs hover:bg-md-surface-variant transition-colors {activityTypeFilter === val ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
                onclick={() => { activityTypeFilter = val; actionTypeDropdownOpen = false; }}
              >
                {label}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- From filter -->
      <div class="relative shrink-0">
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-colors {addressFilter !== 'all' ? 'border-md-primary bg-md-primary/10 text-md-primary' : 'border-md-outline-variant bg-transparent text-md-on-surface/80 hover:bg-md-surface-variant'}"
          aria-label={$t('activity.filterByEmailAddress')}
          onclick={() => { fromDropdownOpen = !fromDropdownOpen; actionTypeDropdownOpen = false; }}
        >
          {$t('activity.fromLabel')}: {addressFilter === 'all' ? $t('activity.all') : addressFilter.length > 20 ? addressFilter.slice(0, 20) + '...' : addressFilter}
          <Icon name="chevronDown" class="w-3 h-3" />
        </button>
        {#if fromDropdownOpen}
          <div class="absolute top-full left-0 mt-1 bg-md-surface border border-md-outline-variant rounded-xl shadow-lg z-[200] overflow-hidden min-w-[200px] max-h-64 overflow-y-auto">
            <!-- Search input -->
            <div class="p-2 border-b border-md-outline-variant/30">
              <input
                type="text"
                placeholder={$t('activity.searchAddresses')}
                class="w-full px-2 py-1 text-xs border border-md-outline-variant rounded-md bg-md-surface focus:outline-none focus:border-md-primary"
                bind:value={fromSearch}
              />
            </div>
            <!-- All option -->
            <button
              class="w-full px-3 py-2 text-left text-xs hover:bg-md-surface-variant transition-colors {addressFilter === 'all' ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
              onclick={() => { addressFilter = 'all'; fromDropdownOpen = false; fromSearch = ''; }}
            >
              {$t('activity.all')}
            </button>
            <!-- Address options -->
            {#each uniqueAddresses.filter(addr => fromSearch === '' || addr.toLowerCase().includes(fromSearch.toLowerCase())) as addr}
              <button
                class="w-full px-3 py-2 text-left text-xs hover:bg-md-surface-variant transition-colors {addressFilter === addr ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
                onclick={() => { addressFilter = addr; fromDropdownOpen = false; fromSearch = ''; }}
              >
                {addr.length > 30 ? addr.slice(0, 30) + '...' : addr}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    {#if loadingEvents}
      <div class="space-y-2">
        {#each [1,2,3] as _}
          <div class="rounded-xl bg-md-primary-container p-4 space-y-2 animate-pulse">
            <div class="h-3 w-24 bg-md-secondary-container rounded"></div>
            <div class="h-4 w-32 bg-md-secondary-container rounded"></div>
          </div>
        {/each}
      </div>
    {:else if filteredEvents.length === 0}
      <div class="bg-md-primary-container rounded-xl px-4 py-6 text-center">
        <div class="text-sm text-md-on-surface/50">{activityEvents.length === 0 ? $t('activity.noActivity') : $t('activity.noMatchingActivity')}</div>
      </div>
    {:else}
      <div class="space-y-2">
        {#each filteredEvents as event}
          {#if event.type === 'email_received'}
            <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-start gap-3">
              <div class="mt-0.5">
                <Icon name="mail" class="w-4 h-4 text-md-primary" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-md-on-surface truncate">
                  {getEventTitle(event.type, event.data)}
                </div>
                <div class="text-xs text-md-on-surface/50 truncate">
                  {getEventSubtitle(event.type, event.data)}
                </div>
                <div class="text-[10px] text-md-on-surface/40 mt-1">
                  {formatTime(event.timestamp)}
                </div>
              </div>
            </div>
          {:else if event.type === 'otp_detected'}
            <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-start gap-3">
              <div class="mt-0.5">
                <Icon name="envelope" class="w-4 h-4 text-md-primary" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-md-on-surface truncate">
                  {getEventTitle(event.type, event.data)}
                </div>
                <div class="text-xs text-md-on-surface/50 truncate">
                  {getEventSubtitle(event.type, event.data)}
                </div>
                {#if event.data.otp}
                  {@const otpValue = event.data.otp}
                  <div class="mt-2 flex items-center gap-2">
                    <span class="text-[10px] text-md-on-surface/50 uppercase tracking-wide">{$t('activity.code')}</span>
                    <code class="px-2 py-0.5 text-sm font-mono font-semibold rounded-md bg-md-primary/20 text-md-primary tracking-widest">
                      {otpValue}
                    </code>
                    <button
                      type="button"
                      class="text-[10px] text-md-primary hover:underline bg-transparent border-0 p-0"
                      onclick={(e) => { e.stopPropagation(); void copyOtp(otpValue); }}
                      title={$t('activity.copyOtp')}
                    >
                      {$t('activity.copy')}
                    </button>
                  </div>
                {/if}
                <div class="text-[10px] text-md-on-surface/40 mt-1">
                  {formatTime(event.timestamp)}
                </div>
              </div>
            </div>
          {:else if event.type === 'notification_sent'}
            <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-start gap-3">
              <div class="mt-0.5">
                <Icon name="bell" class="w-4 h-4 text-md-primary" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-md-on-surface truncate">
                  {getEventTitle(event.type, event.data)}
                </div>
                <div class="text-xs text-md-on-surface/50 truncate">
                  {getEventSubtitle(event.type, event.data)}
                </div>
                <div class="text-[10px] text-md-on-surface/40 mt-1">
                  {formatTime(event.timestamp)}
                </div>
              </div>
            </div>
          {:else if event.type === 'account_created'}
            <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-start gap-3">
              <div class="mt-0.5">
                <Icon name="barChart" class="w-4 h-4 text-md-primary" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-md-on-surface truncate">
                  {getEventTitle(event.type, event.data)}
                </div>
                <div class="text-xs text-md-on-surface/50 truncate">
                  {getEventSubtitle(event.type, event.data)}
                </div>
                <div class="text-[10px] text-md-on-surface/40 mt-1">
                  {formatTime(event.timestamp)}
                </div>
              </div>
            </div>
          {:else if event.type === 'account_deleted'}
            <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-start gap-3">
              <div class="mt-0.5">
                <Icon name="barChart" class="w-4 h-4 text-md-primary" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-md-on-surface truncate">
                  {getEventTitle(event.type, event.data)}
                </div>
                <div class="text-xs text-md-on-surface/50 truncate">
                  {getEventSubtitle(event.type, event.data)}
                </div>
                <div class="text-[10px] text-md-on-surface/40 mt-1">
                  {formatTime(event.timestamp)}
                </div>
              </div>
            </div>
          {:else if event.type === 'toast_notification'}
            <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-start gap-3">
              <div class="mt-0.5">
                <Icon name="bell" class="w-4 h-4 text-md-primary" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-md-on-surface truncate">
                  {getEventTitle(event.type, event.data)}
                </div>
                <div class="text-xs text-md-on-surface/50 truncate">
                  {getEventSubtitle(event.type, event.data)}
                </div>
                <div class="text-[10px] text-md-on-surface/40 mt-1">
                  {formatTime(event.timestamp)}
                </div>
              </div>
            </div>
          {:else}
            <div class="bg-md-primary-container rounded-xl px-4 py-3 flex items-start gap-3">
              <div class="mt-0.5">
                <Icon name="mail" class="w-4 h-4 text-md-primary" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-md-on-surface truncate">
                  {getEventTitle(event.type, event.data)}
                </div>
                <div class="text-xs text-md-on-surface/50 truncate">
                  {getEventSubtitle(event.type, event.data)}
                </div>
                <div class="text-[10px] text-md-on-surface/40 mt-1">
                  {formatTime(event.timestamp)}
                </div>
              </div>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </section>

  <!-- ── Since Info ── -->
  {#if analytics.createdAt}
    <div class="bg-md-primary-container rounded-xl px-4 py-3">
      <div class="text-[10px] font-semibold text-md-on-surface/40 uppercase tracking-wider mb-1.5">{$t('activity.trackingSince')}</div>
      <div class="text-sm text-md-on-surface">{new Date(analytics.createdAt).toLocaleDateString()}</div>
    </div>
  {/if}

  <!-- ── Refresh Button ── -->
  <button class="w-full h-12 px-4 text-sm font-semibold rounded-xl border border-md-primary text-md-primary hover:bg-md-primary/10 transition-colors flex items-center justify-center gap-2" onclick={() => { onLoadAnalytics(); loadActivityEvents(); }}>
    <Icon name="refresh" class="w-4 h-4" />
    {$t('activity.refresh')}
  </button>

  <!-- ── Export Analytics Button ── -->
  <button class="w-full h-12 px-4 text-sm font-semibold rounded-xl border border-md-secondary text-md-secondary hover:bg-md-secondary/10 transition-colors flex items-center justify-center gap-2" onclick={handleExportAnalytics}>
    <Icon name="barChart" class="w-4 h-4" />
    {$t('activity.exportAnalytics')}
  </button>

  <!-- ── Reset Button ── -->
  <button class="w-full h-12 px-4 text-sm font-semibold rounded-xl border border-md-error text-md-error hover:bg-md-error/10 transition-colors flex items-center justify-center gap-2" onclick={() => { resetDialogOpen = true; }}>
    <Icon name="trash" class="w-4 h-4" />
    {$t('activity.resetActivity')}
  </button>

  <!-- ── Reset Confirmation Dialog ── -->
  {#if resetDialogOpen}
    <div
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-[300]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-dialog-title"
      tabindex="-1"
      onclick={() => resetDialogOpen = false}
      onkeydown={(e) => { if (e.key === 'Escape') resetDialogOpen = false; }}
    >
      <div
        class="bg-md-surface rounded-xl p-6 max-w-sm mx-4 shadow-xl"
        role="document"
      >
        <h3 id="reset-dialog-title" class="text-lg font-semibold text-md-on-surface mb-2">{$t('activity.resetDialogTitle')}</h3>
        <p class="text-sm text-md-on-surface/70 mb-4">
          {$t('activity.resetDialogBody')}
        </p>
        <div class="flex gap-2">
          <button
            class="flex-1 h-10 px-4 text-sm font-semibold rounded-xl border border-md-outline-variant text-md-on-surface hover:bg-md-surface-variant transition-colors"
            onclick={() => resetDialogOpen = false}
            type="button"
          >
            {$t('common.cancel')}
          </button>
          <button
            class="flex-1 h-10 px-4 text-sm font-semibold rounded-xl bg-md-error text-md-on-error hover:bg-md-error/90 transition-colors"
            onclick={handleReset}
            type="button"
          >
            {$t('activity.reset')}
          </button>
        </div>
      </div>
    </div>
  {/if}

</div>
{/if}
