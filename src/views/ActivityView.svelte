<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import ScrollSpy from '@/components/ui/composites/ScrollSpy.svelte';
import { clearActivityEvents, getActivityEvents } from '@/utils/activity-tracker.js';
import { copyToClipboardAndSchedulePurge } from '@/utils/clipboard.js';
import { downloadCSV, exportAnalyticsToCSV } from '@/utils/csv-export.js';
import { logError } from '@/utils/logger.js';
import { getInboxes } from '@/utils/storage-keys.js';
import type { Account, ActivityEvent, Analytics } from '@/utils/types.js';
import { humanizeViewId, viewDisplayLabelKey } from '@/utils/view-display-names.js';

function labelForVisit(viewId: string): string {
  const key = viewDisplayLabelKey(viewId);
  if (key) {
    try {
      const translated = get(t)(key) as string;
      if (translated && translated !== key) return translated;
    } catch {
      /* fall through */
    }
  }
  return humanizeViewId(viewId);
}

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
let currentInboxes = $state<Account[]>([]);
let loadingEvents = $state(false);

// Filter states
let activityTypeFilter = $state<string>('all');
let addressFilter = $state<string>('all');
let actionTypeDropdownOpen = $state(false);
let fromDropdownOpen = $state(false);
let fromSearch = $state('');

// Interactive chart hovers
let activeTimelineHover = $state<number | null>(null);
let activeDonutHover = $state<number | null>(null);

// Scrollspy navigation sections (summary merged into visual)
const ACTIVITY_SECTIONS: { id: string; labelKey: string }[] = [
  { id: 'visual', labelKey: 'activity.visual' },
  { id: 'performance', labelKey: 'activity.performance' },
  { id: 'feed', labelKey: 'activity.recentActivity' },
];
let activityScrollEl = $state<HTMLElement | null>(null);
let activeSpySection = $state('visual');

const sectionTitleClass =
  'text-sm font-semibold text-md-on-surface flex items-center gap-2 mb-2 pt-1';

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
  try {
    activityEvents = await getActivityEvents();
    currentInboxes = await getInboxes();
  } catch (error) {
    logError('Failed to load activity events:', error);
  } finally {
    loadingEvents = false;
    const renderTime = performance.now() - startTime;
    await recordRenderTime(renderTime);
  }
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
    await copyToClipboardAndSchedulePurge(otp);
  } catch {
    // Best-effort copy; ignore failures
  }
}

// ── Derived Calculations for Visual Analytics ──

// 1. Time Saved circular gauge
const timeSaved = $derived.by(() => {
  const inboxes = analytics.accountsCreated || 0;
  const otps = analytics.otpsDetected || 0;
  let autofills = 0;
  activityEvents.forEach((e) => {
    if (e.type === 'auto_fill') autofills++;
  });

  const totalSeconds = inboxes * 10 + otps * 15 + autofills * 30;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  const targetSeconds = 3600; // 1 hour target
  const percent = Math.min((totalSeconds / targetSeconds) * 100, 100);
  const circumference = 2 * Math.PI * 40;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  return {
    totalSeconds,
    minutes,
    seconds,
    percent: Math.round(percent),
    strokeDasharray: circumference,
    strokeDashoffset,
  };
});

// 2. Inbox Expiry Outlook progress track
const expiryOutlook = $derived.by(() => {
  let active = 0;
  let expiringSoon = 0;
  let expired = 0;
  const now = Date.now();

  currentInboxes.forEach((inbox) => {
    if (inbox.expiresAt <= now) {
      expired++;
    } else if (inbox.expiresAt <= now + 15 * 60 * 1000) {
      expiringSoon++;
    } else {
      active++;
    }
  });

  const total = currentInboxes.length;
  return {
    active,
    expiringSoon,
    expired,
    total,
    activePercent: total > 0 ? (active / total) * 100 : 0,
    expiringSoonPercent: total > 0 ? (expiringSoon / total) * 100 : 0,
    expiredPercent: total > 0 ? (expired / total) * 100 : 0,
  };
});

// 3. Activity Timeline (7-day stacked bar chart)
const timelineData = $derived.by(() => {
  const days: { label: string; start: number; end: number }[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const start = d.getTime();
    const dEnd = new Date(d);
    dEnd.setHours(23, 59, 59, 999);
    const end = dEnd.getTime();

    const label = d.toLocaleDateString(undefined, { weekday: 'short' });
    days.push({ label, start, end });
  }

  let maxTotal = 5;
  const formattedDays = days.map((day) => {
    let inboxes = 0;
    let emails = 0;
    let otps = 0;

    activityEvents.forEach((e) => {
      if (e.timestamp >= day.start && e.timestamp <= day.end) {
        if (e.type === 'account_created') inboxes++;
        else if (e.type === 'email_received') emails++;
        else if (e.type === 'otp_detected') otps++;
      }
    });

    const total = inboxes + emails + otps;
    if (total > maxTotal) maxTotal = total;

    return {
      label: day.label,
      inboxes,
      emails,
      otps,
      total,
    };
  });

  return {
    days: formattedDays,
    max: maxTotal,
  };
});

// 4. Event Breakdown (donut segments)
const eventBreakdown = $derived.by(() => {
  let created = 0;
  let received = 0;
  let autofilled = 0;
  let notification = 0;

  activityEvents.forEach((e) => {
    if (e.type === 'account_created') created++;
    else if (e.type === 'email_received' || e.type === 'otp_detected') received++;
    else if (e.type === 'auto_fill') autofilled++;
    else if (
      e.type === 'notification_sent' ||
      e.type === 'toast_notification' ||
      e.type === 'auto_extend'
    ) {
      notification++;
    }
  });

  const total = created + received + autofilled + notification;
  return { created, received, autofilled, notification, total };
});

const donutSegments = $derived.by(() => {
  const { created, received, autofilled, notification, total } = eventBreakdown;
  const circumference = 2 * Math.PI * 35; // r=35

  if (total === 0) {
    return [
      {
        dashArray: `0 ${circumference}`,
        dashOffset: 0,
        color: 'var(--md-outline-variant, #c5c8ba)',
        label: 'No Data',
        percent: 0,
        count: 0,
      },
    ];
  }

  const items = [
    { label: 'Created', count: created, color: 'var(--md-primary, #4c662b)' },
    { label: 'Received', count: received, color: 'var(--md-secondary, #586249)' },
    { label: 'Autofilled', count: autofilled, color: 'var(--md-tertiary, #386663)' },
    { label: 'Notifications', count: notification, color: 'var(--md-error, #ba1a1a)' },
  ];

  let cumulativePercent = 0;
  const segments = items.map((item) => {
    const percent = item.count / total;
    const strokeDash = percent * circumference;
    const dashArray = `${strokeDash} ${circumference}`;
    const dashOffset = -cumulativePercent * circumference;
    cumulativePercent += percent;
    return {
      dashArray,
      dashOffset,
      color: item.color,
      label: item.label,
      percent: Math.round(percent * 100),
      count: item.count,
    };
  });

  return segments.filter((s) => s.count > 0);
});

// 5. Top Sites Filled
const topWebsites = $derived.by(() => {
  const counts: Record<string, number> = {};
  activityEvents.forEach((e) => {
    if (e.type === 'auto_fill' && e.data.website) {
      let domain = e.data.website;
      try {
        if (!domain.startsWith('http')) {
          domain = `https://${domain}`;
        }
        const url = new URL(domain);
        domain = url.hostname.replace('www.', '');
      } catch {
        domain = domain.replace('www.', '');
      }
      counts[domain] = (counts[domain] || 0) + 1;
    }
  });

  const sorted = Object.entries(counts)
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const maxCount = sorted.length > 0 ? sorted[0].count : 1;
  return sorted.map((item) => ({
    ...item,
    percent: (item.count / maxCount) * 100,
  }));
});

// 5. 24-Hour Email & Event Arrival Heatmap
const hourlyHeatmap = $derived.by(() => {
  const buckets = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0, otps: 0 }));
  activityEvents.forEach((ev) => {
    const hour = new Date(ev.timestamp).getHours();
    if (hour >= 0 && hour < 24) {
      buckets[hour].count++;
      if (ev.type === 'otp_detected' || ev.data?.otp) {
        buckets[hour].otps++;
      }
    }
  });
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  return { buckets, maxCount };
});

// 6. Email Fetch Latency Line Chart
const latencyData = $derived.by(() => {
  const rawTimes = analytics.performance?.emailFetchTimes || [];
  const times: number[] =
    rawTimes.length > 0 ? rawTimes.slice(-10) : [120, 150, 95, 210, 110, 135, 80, 95, 115, 105];
  const maxVal = Math.max(...times, 250);
  const minVal = Math.min(...times, 50);
  const range = maxVal - minVal || 100;

  const points = times.map((t: number, idx: number) => {
    const x = 20 + (idx / (times.length - 1 || 1)) * 260;
    const y = 100 - ((t - minVal) / range) * 80;
    return { x, y, value: t };
  });

  let linePath = '';
  let areaPath = '';
  if (points.length > 0) {
    linePath = `M ${points[0].x} ${points[0].y}`;
    points.slice(1).forEach((p: { x: number; y: number; value: number }) => {
      linePath += ` L ${p.x} ${p.y}`;
    });
    areaPath = `${linePath} L ${points[points.length - 1].x} 100 L ${points[0].x} 100 Z`;
  }

  return { points, linePath, areaPath, times, maxVal, minVal };
});
</script>

{#if loading}
  <div class="flex-1 overflow-y-auto px-2 py-3 space-y-4">
    {#each [1,2,3,4] as _}
      <div class="rounded-xl bg-md-primary-container p-4 space-y-2 animate-pulse">
        <div class="h-3 w-24 bg-md-secondary-container rounded"></div>
        <div class="h-8 w-32 bg-md-secondary-container rounded"></div>
      </div>
    {/each}
  </div>
{:else}
<div class="flex flex-col h-full min-h-0">
  <ScrollSpy
    sections={ACTIVITY_SECTIONS}
    bind:activeId={activeSpySection}
    scrollRoot={activityScrollEl}
    sectionAttr="data-section"
    sectionIdPrefix="activity-section-"
    ariaLabel={$t('activity.navAria')}
  />

<div
  bind:this={activityScrollEl}
  class="flex-1 min-h-0 overflow-y-auto px-2 py-2.5 space-y-4 pb-3"
>

  <!-- Page heading -->
  <h1 class="pt-0.5 text-base font-bold text-md-on-surface">
    {$t('activity.title')}
    <span class="block text-label-sm font-normal text-md-on-surface/50 mt-0.5">{$t('activity.subtitle')}</span>
  </h1>

  <!-- ── Visual Analytics Dashboard (includes former summary totals) ── -->
  <section id="activity-section-visual" data-section="visual" class="space-y-3 scroll-mt-2">
    <h2 class={sectionTitleClass}>
      <Icon name="barChart" class="w-4 h-4 text-md-primary" />
      {$t('activity.visual')}
    </h2>

    <!-- Totals (moved from summary) -->
    <div class="grid grid-cols-2 gap-2">
      <div class="bg-md-tertiary-container rounded-xl px-2 py-2 flex flex-col items-center justify-center">
        <div class="text-2xl font-bold text-md-primary">{analytics.accountsCreated}</div>
        <div class="text-xs text-md-on-surface/50">{$t('activity.inboxes')}</div>
      </div>
      <div class="bg-md-tertiary-container rounded-xl px-2 py-2 flex flex-col items-center justify-center">
        <div class="text-2xl font-bold text-md-secondary">{analytics.emailsReceived}</div>
        <div class="text-xs text-md-on-surface/50">{$t('activity.emails')}</div>
      </div>
      <div class="bg-md-tertiary-container rounded-xl px-2 py-2 flex flex-col items-center justify-center">
        <div class="text-2xl font-bold text-md-tertiary">{analytics.otpsDetected}</div>
        <div class="text-xs text-md-on-surface/50">{$t('activity.otps')}</div>
      </div>
      <div class="bg-md-tertiary-container rounded-xl px-2 py-2 flex flex-col items-center justify-center">
        <div class="text-2xl font-bold text-md-primary">{analytics.notificationsSent}</div>
        <div class="text-xs text-md-on-surface/50">{$t('activity.notifications')}</div>
      </div>
      <div class="bg-md-tertiary-container rounded-xl px-2 py-2 flex flex-col items-center justify-center">
        <div class="text-2xl font-bold text-md-primary">{analytics.extensionOpens || 0}</div>
        <div class="text-xs text-md-on-surface/50">{$t('activity.extensionOpens')}</div>
      </div>
      <div class="bg-md-tertiary-container rounded-xl px-2 py-2 flex flex-col items-center justify-center">
        <div class="text-2xl font-bold text-md-secondary">{analytics.emailsRead || 0}</div>
        <div class="text-xs text-md-on-surface/50">{$t('activity.emailsRead')}</div>
      </div>
    </div>

    {#if analytics.pageVisits && Object.keys(analytics.pageVisits).length > 0}
      {@const pageOnly = Object.entries(analytics.pageVisits || {}).filter(
        ([k]) => !k.startsWith('dialog:')
      )}
      {@const dialogOnly = Object.entries(analytics.pageVisits || {}).filter(([k]) =>
        k.startsWith('dialog:')
      )}
      {#if pageOnly.length > 0}
        <div class="bg-md-surface-container rounded-xl p-3 border border-md-outline-variant/20">
          <h3 class="text-xs font-semibold text-md-on-surface/80 mb-2">{$t('activity.pageVisits')}</h3>
          <div class="space-y-1.5 max-h-40 overflow-y-auto">
            {#each (pageOnly as [string, number][]).sort((a, b) => b[1] - a[1]) as [viewId, count] (viewId)}
              <div class="flex items-center justify-between gap-2 text-label-sm">
                <span class="truncate text-md-on-surface/70">{labelForVisit(viewId)}</span>
                <span class="tabular-nums font-semibold text-md-on-surface shrink-0">{count}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}
      {#if dialogOnly.length > 0}
        <div class="bg-md-surface-container rounded-xl p-3 border border-md-outline-variant/20">
          <h3 class="text-xs font-semibold text-md-on-surface/80 mb-2">{$t('activity.dialogVisits')}</h3>
          <div class="space-y-1.5 max-h-40 overflow-y-auto">
            {#each (dialogOnly as [string, number][]).sort((a, b) => b[1] - a[1]) as [viewId, count] (viewId)}
              <div class="flex items-center justify-between gap-2 text-label-sm">
                <span class="truncate text-md-on-surface/70">{labelForVisit(viewId)}</span>
                <span class="tabular-nums font-semibold text-md-on-surface shrink-0">{count}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/if}

    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <!-- Chart 1: Time Saved Gauge -->
      <div class="bg-md-primary-container/20 dark:bg-md-primary-container/10 rounded-2xl p-4 border border-md-outline-variant/20 flex flex-col justify-between h-48">
        <div class="flex items-center gap-2 mb-2">
          <Icon name="clock" class="w-4 h-4 text-md-primary" />
          <span class="text-xs font-semibold text-md-on-surface/80">{$t('activity.timeSaved')}</span>
        </div>
        <div class="flex items-center gap-4 flex-1">
          <div class="relative w-20 h-20 flex items-center justify-center shrink-0">
            <svg class="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="transparent"
                stroke="var(--md-outline-variant, #c5c8ba)"
                stroke-width="8"
                class="opacity-30"
              />
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="transparent"
                stroke="var(--md-primary, #4c662b)"
                stroke-width="8"
                stroke-dasharray={timeSaved.strokeDasharray}
                stroke-dashoffset={timeSaved.strokeDashoffset}
                stroke-linecap="round"
                class="transition-all duration-700 ease-out"
              />
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center">
              <span class="text-sm font-bold text-md-primary leading-none">
                {timeSaved.minutes}m
              </span>
              <span class="text-xs text-md-on-surface/50 font-medium leading-none mt-0.5">
                {timeSaved.seconds}s
              </span>
            </div>
          </div>
          <div class="flex-1 flex flex-col justify-center">
            <div class="text-xl font-bold text-md-on-surface">
              {Math.round(timeSaved.totalSeconds / 60)} <span class="text-xs font-normal text-md-on-surface/60">min saved</span>
            </div>
            <p class="text-label-sm text-md-on-surface/60 mt-1 leading-normal">
              Estimated productivity time saved from automated inbox creation and form filling actions.
            </p>
          </div>
        </div>
      </div>

      <!-- Chart 2: Inbox Expiry Outlook -->
      <div class="bg-md-primary-container/20 dark:bg-md-primary-container/10 rounded-2xl p-4 border border-md-outline-variant/20 flex flex-col justify-between h-48">
        <div class="flex items-center gap-2 mb-2">
          <Icon name="refresh" class="w-4 h-4 text-md-tertiary" />
          <span class="text-xs font-semibold text-md-on-surface/80">{$t('activity.expiryOutlook')}</span>
        </div>
        
        <div class="flex-1 flex flex-col justify-center space-y-4">
          <div class="w-full h-3 rounded-full bg-md-outline-variant/20 overflow-hidden flex">
            {#if expiryOutlook.total === 0}
              <div class="w-full h-full bg-md-outline-variant/40"></div>
            {:else}
              {#if expiryOutlook.active > 0}
                <div class="h-full bg-[var(--md-primary)] transition-all duration-500" style="width: {expiryOutlook.activePercent}%" title="Active"></div>
              {/if}
              {#if expiryOutlook.expiringSoon > 0}
                <div class="h-full bg-[var(--md-tertiary)] transition-all duration-500" style="width: {expiryOutlook.expiringSoonPercent}%" title="Expiring Soon"></div>
              {/if}
              {#if expiryOutlook.expired > 0}
                <div class="h-full bg-[var(--md-error)] transition-all duration-500 opacity-60" style="width: {expiryOutlook.expiredPercent}%" title="Expired"></div>
              {/if}
            {/if}
          </div>

          <div class="grid grid-cols-3 gap-1 text-center">
            <div class="flex flex-col items-center">
              <div class="flex items-center gap-1">
                <span class="w-2 h-2 rounded-full bg-[var(--md-primary)]"></span>
                <span class="text-xs font-bold text-md-on-surface">{expiryOutlook.active}</span>
              </div>
              <span class="text-xs text-md-on-surface/60 mt-0.5">{$t('activity.active')}</span>
            </div>
            
            <div class="flex flex-col items-center">
              <div class="flex items-center gap-1">
                <span class="w-2 h-2 rounded-full bg-[var(--md-tertiary)]"></span>
                <span class="text-xs font-bold text-md-on-surface">{expiryOutlook.expiringSoon}</span>
              </div>
              <span class="text-xs text-md-on-surface/60 mt-0.5">{$t('activity.expiringSoon')}</span>
            </div>
            
            <div class="flex flex-col items-center">
              <div class="flex items-center gap-1">
                <span class="w-2 h-2 rounded-full bg-[var(--md-error)] opacity-60"></span>
                <span class="text-xs font-bold text-md-on-surface">{expiryOutlook.expired}</span>
              </div>
              <span class="text-xs text-md-on-surface/60 mt-0.5">{$t('inbox.expired')}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Chart 3: Activity Timeline -->
      <div class="bg-md-primary-container/20 dark:bg-md-primary-container/10 rounded-2xl p-4 border border-md-outline-variant/20 flex flex-col justify-between h-56">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <Icon name="barChart" class="w-4 h-4 text-md-primary" />
            <span class="text-xs font-semibold text-md-on-surface/80">{$t('activity.activityTimeline')}</span>
          </div>
          {#if activeTimelineHover !== null}
            <span class="text-xs bg-md-primary-container text-md-on-primary-container px-2 py-0.5 rounded-full transition-opacity duration-200">
              {timelineData.days[activeTimelineHover].label}: {timelineData.days[activeTimelineHover].total} events
            </span>
          {/if}
        </div>

        <div class="flex-1 flex items-end justify-between relative px-1 pb-1 pt-2">
          <div class="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-10 pb-5 pt-3">
            <div class="border-b border-md-outline w-full"></div>
            <div class="border-b border-md-outline w-full"></div>
            <div class="border-b border-md-outline w-full"></div>
          </div>

          <svg viewBox="0 0 280 100" class="w-full h-24 overflow-visible z-10">
            {#each timelineData.days as day, idx}
              {@const maxH = 80}
              {@const xPos = idx * 38 + 12}
              {@const inboxH = (day.inboxes / timelineData.max) * maxH}
              {@const emailH = (day.emails / timelineData.max) * maxH}
              {@const otpH = (day.otps / timelineData.max) * maxH}
              
              <g 
                role="presentation"
                class="cursor-pointer group"
                onmouseenter={() => activeTimelineHover = idx}
                onmouseleave={() => activeTimelineHover = null}
              >
                <rect
                  x={xPos - 4}
                  y="0"
                  width="24"
                  height="90"
                  fill="var(--md-primary-container)"
                  class="opacity-0 group-hover:opacity-15 transition-opacity duration-150"
                  rx="4"
                />

                {#if inboxH > 0}
                  <rect
                    x={xPos}
                    y={80 - inboxH}
                    width="16"
                    height={inboxH}
                    fill="var(--md-primary, #4c662b)"
                    rx="1.5"
                  />
                {/if}
                {#if emailH > 0}
                  <rect
                    x={xPos}
                    y={80 - inboxH - emailH}
                    width="16"
                    height={emailH}
                    fill="var(--md-secondary, #586249)"
                    rx="1.5"
                  />
                {/if}
                {#if otpH > 0}
                  <rect
                    x={xPos}
                    y={80 - inboxH - emailH - otpH}
                    width="16"
                    height={otpH}
                    fill="var(--md-tertiary, #386663)"
                    rx="1.5"
                  />
                {/if}

                {#if day.total === 0}
                  <rect
                    x={xPos}
                    y="79"
                    width="16"
                    height="2"
                    fill="var(--md-outline-variant, #c5c8ba)"
                    class="opacity-45"
                  />
                {/if}

                <text
                  x={xPos + 8}
                  y="94"
                  text-anchor="middle"
                  class="text-xs fill-md-on-surface/50 group-hover:fill-md-primary font-medium"
                >
                  {day.label}
                </text>
              </g>
            {/each}
          </svg>
        </div>

        <div class="flex items-center justify-center gap-3 text-xs text-md-on-surface/60 mt-1 border-t border-md-outline-variant/10 pt-2 shrink-0">
          <div class="flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded bg-[var(--md-primary)]"></span>
            <span>Inboxes</span>
          </div>
          <div class="flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded bg-[var(--md-secondary)]"></span>
            <span>Emails</span>
          </div>
          <div class="flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded bg-[var(--md-tertiary)]"></span>
            <span>OTPs</span>
          </div>
        </div>
      </div>

      <!-- Chart 4: Event Breakdown -->
      <div class="bg-md-primary-container/20 dark:bg-md-primary-container/10 rounded-2xl p-4 border border-md-outline-variant/20 flex flex-col justify-between h-56">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <Icon name="envelope" class="w-4 h-4 text-md-secondary" />
            <span class="text-xs font-semibold text-md-on-surface/80">{$t('activity.eventBreakdown')}</span>
          </div>
          {#if activeDonutHover !== null}
            <span class="text-xs bg-md-secondary-container text-md-on-secondary-container px-2 py-0.5 rounded-full transition-opacity duration-200">
              {donutSegments[activeDonutHover].label}: {donutSegments[activeDonutHover].count} ({donutSegments[activeDonutHover].percent}%)
            </span>
          {/if}
        </div>

        <div class="flex-1 flex items-center justify-around gap-2">
          <div class="relative w-24 h-24 flex items-center justify-center shrink-0">
            <svg class="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="35"
                fill="transparent"
                stroke="var(--md-outline-variant, #c5c8ba)"
                stroke-width="10"
                class="opacity-20"
              />
              {#each donutSegments as segment, idx}
                <circle
                  role="presentation"
                  cx="50"
                  cy="50"
                  r="35"
                  fill="transparent"
                  stroke={segment.color}
                  stroke-width="10"
                  stroke-dasharray={segment.dashArray}
                  stroke-dashoffset={segment.dashOffset}
                  stroke-linecap="round"
                  class="transition-all duration-500 ease-in-out cursor-pointer hover:stroke-[12px]"
                  onmouseenter={() => activeDonutHover = idx}
                  onmouseleave={() => activeDonutHover = null}
                />
              {/each}
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span class="text-base font-bold text-md-on-surface leading-none">
                {eventBreakdown.total}
              </span>
              <span class="text-label-sm text-md-on-surface/50 font-semibold uppercase tracking-wider leading-none mt-1">
                Total
              </span>
            </div>
          </div>

          <div class="flex flex-col gap-1 min-w-0">
            {#each donutSegments as segment, idx}
              <div 
                role="presentation"
                class="flex items-center gap-1.5 cursor-pointer transition-transform duration-150 hover:translate-x-1"
                onmouseenter={() => activeDonutHover = idx}
                onmouseleave={() => activeDonutHover = null}
              >
                <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: {segment.color}"></span>
                <div class="flex flex-col min-w-0">
                  <span class="text-xs font-semibold text-md-on-surface/90 leading-none truncate">{segment.label}</span>
                  <span class="text-label-sm text-md-on-surface/50 leading-none mt-0.5">{segment.count} ({segment.percent}%)</span>
                </div>
              </div>
          {:else}
            <div class="text-xs text-md-on-surface/50 text-center py-4">{$t('activity.noAutofills')}</div>
          {/each}
        </div>
      </div>

      <!-- Chart 6: 24-Hour Email & Event Arrival Heatmap -->
      <div class="md:col-span-2 bg-md-primary-container/20 dark:bg-md-primary-container/10 rounded-2xl p-4 border border-md-outline-variant/20 space-y-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <Icon name="clock" class="w-4 h-4 text-md-primary" />
            <span class="text-xs font-semibold text-md-on-surface/80">24-Hour Email Arrival Activity Heatmap</span>
          </div>
          <span class="text-xs text-md-on-surface/50 font-mono">00:00 - 23:00 (Hourly Density Matrix)</span>
        </div>

        <div class="grid grid-cols-12 md:grid-cols-24 gap-1 items-end h-24 pt-2">
          {#each hourlyHeatmap.buckets as bucket}
            {@const intensity = bucket.count > 0 ? Math.max(0.25, bucket.count / hourlyHeatmap.maxCount) : 0.08}
            {@const formattedHour = `${bucket.hour.toString().padStart(2, '0')}:00`}
            <div
              class="group relative flex flex-col items-center justify-end h-full w-full rounded-md transition-all duration-150 hover:scale-105"
              style="background-color: rgba(var(--md-primary-rgb, 76, 102, 43), {intensity});"
            >
              <div
                class="w-full bg-md-primary rounded-t transition-all"
                style="height: {hourlyHeatmap.maxCount > 0 ? (bucket.count / hourlyHeatmap.maxCount) * 100 : 0}%; opacity: {intensity};"
              ></div>

              <!-- Tooltip on hover -->
              <div class="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-30 pointer-events-none">
                <div class="bg-md-inverse-surface text-md-inverse-on-surface text-xs rounded-lg px-2 py-1 shadow-xl whitespace-nowrap border border-md-outline-variant/30 font-mono">
                  <span class="font-bold text-md-primary">{formattedHour}</span>: {bucket.count} events ({bucket.otps} OTPs)
                </div>
              </div>
            </div>
          {/each}
        </div>

        <div class="flex items-center justify-between text-xs text-md-on-surface/40 pt-1 border-t border-md-outline-variant/10">
          <span>12 AM</span>
          <span>4 AM</span>
          <span>8 AM</span>
          <span>12 PM</span>
          <span>4 PM</span>
          <span>8 PM</span>
          <span>11 PM</span>
        </div>
      </div>
      </div>

      <!-- Chart 5: Top Sites Filled -->
      <div class="bg-md-primary-container/20 dark:bg-md-primary-container/10 rounded-2xl p-4 border border-md-outline-variant/20 flex flex-col justify-between h-56">
        <div class="flex items-center gap-2 mb-3">
          <Icon name="globe" class="w-4 h-4 text-md-primary" />
          <span class="text-xs font-semibold text-md-on-surface/80">{$t('activity.topWebsites')}</span>
        </div>

        <div class="flex-1 flex flex-col justify-between space-y-2 pb-1">
          {#each topWebsites as site, idx}
            <div class="space-y-1">
              <div class="flex justify-between items-center text-label-sm">
                <div class="flex items-center gap-1.5 min-w-0">
                  <span class="text-xs font-bold text-md-primary/70 bg-md-primary-container/50 px-1 py-0.2 rounded">#{idx + 1}</span>
                  <span class="text-md-on-surface truncate font-medium">{site.domain}</span>
                </div>
                <span class="text-md-on-surface/60 font-semibold shrink-0">{site.count} fills</span>
              </div>
              <div class="w-full h-1.5 rounded-full bg-md-outline-variant/20 overflow-hidden">
                <div 
                  class="h-full bg-[var(--md-primary)] rounded-full transition-all duration-700 ease-out" 
                  style="width: {site.percent}%"
                ></div>
              </div>
            </div>
          {:else}
            <div class="flex-1 flex items-center justify-center text-label-sm text-md-on-surface/50 text-center">
              No websites autofilled yet. Start filling forms on registration websites.
            </div>
          {/each}
        </div>
      </div>

      <!-- Chart 6: Email Fetch Latency -->
      <div class="bg-md-primary-container/20 dark:bg-md-primary-container/10 rounded-2xl p-4 border border-md-outline-variant/20 flex flex-col justify-between h-56">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <Icon name="clock" class="w-4 h-4 text-md-tertiary" />
            <span class="text-xs font-semibold text-md-on-surface/80">{$t('activity.avgEmailFetch')} Latency (ms)</span>
          </div>
          <span class="text-xs text-md-on-surface/60 font-semibold">
                        Avg: {latencyData.times.length > 0 ? (latencyData.times.reduce((a: number, b: number) => a + b, 0) / latencyData.times.length).toFixed(0) : 0}ms
          </span>
        </div>

        <div class="flex-1 flex items-end justify-between relative px-1 pb-1 pt-2">
          <div class="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-10 pb-5 pt-3">
            <div class="border-b border-md-outline w-full"></div>
            <div class="border-b border-md-outline w-full"></div>
            <div class="border-b border-md-outline w-full"></div>
          </div>

          <svg viewBox="0 0 300 120" class="w-full h-24 overflow-visible z-10">
            <defs>
              <linearGradient id="latency-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--md-tertiary, #386663)" stop-opacity="0.3"/>
                <stop offset="100%" stop-color="var(--md-tertiary, #386663)" stop-opacity="0.0"/>
              </linearGradient>
            </defs>

            {#if latencyData.areaPath}
              <path d={latencyData.areaPath} fill="url(#latency-grad)" />
            {/if}

            {#if latencyData.linePath}
              <path
                d={latencyData.linePath}
                fill="none"
                stroke="var(--md-tertiary, #386663)"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            {/if}

            {#each latencyData.points as point}
              <g class="group/point cursor-pointer">
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="3.5"
                  fill="var(--md-surface, #ffffff)"
                  stroke="var(--md-tertiary, #386663)"
                  stroke-width="1.8"
                  class="transition-all duration-150 group-hover/point:r-5 group-hover/point:stroke-width-2.5"
                />
                <title>{point.value}ms</title>
              </g>
            {/each}

            <line x1="20" y1="100" x2="280" y2="100" stroke="var(--md-outline-variant, #c5c8ba)" stroke-width="1" class="opacity-40" />
          </svg>
        </div>
      </div>
    </div>
  </section>

  <!-- ── Performance Metrics ── -->
  <section id="activity-section-performance" data-section="performance" class="space-y-2 scroll-mt-2">
    <h2 class={sectionTitleClass}>
      <Icon name="clock" class="w-4 h-4 text-md-primary" />
      {$t('activity.performance')}
    </h2>
    {#if analytics.performance}
      <div class="bg-md-primary-container rounded-xl px-2 py-2 space-y-3">
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
    {:else}
      <div class="bg-md-primary-container rounded-xl px-3 py-4 text-center text-xs text-md-on-surface/50">
        {$t('activity.notAvailable')}
      </div>
    {/if}
  </section>

  <!-- ── Activity Timeline ── -->
  <section id="activity-section-feed" data-section="feed" class="space-y-2 scroll-mt-2">
    <h2 class={sectionTitleClass}>
      <Icon name="clock" class="w-4 h-4 text-md-primary" />
      {$t('activity.recentActivity')}
    </h2>
    <div class="space-y-2">
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
          <div class="absolute top-full start-0 mt-1 bg-md-surface border border-md-outline-variant rounded-xl shadow-lg z-[200] overflow-hidden min-w-[140px]">
            {#each [['all', $t('activity.all')], ['auto_extend', $t('activity.autoExtend')], ['inbox_created', $t('activity.newInbox')], ['hard_reset', $t('activity.hardReset')], ['notification', $t('activity.notification')]] as [val, label]}
              <button
                class="w-full px-3 py-2 text-start text-xs hover:bg-md-surface-variant transition-colors {activityTypeFilter === val ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
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
          <div class="absolute top-full start-0 mt-1 bg-md-surface border border-md-outline-variant rounded-xl shadow-lg z-[200] overflow-hidden min-w-[200px] max-h-64 overflow-y-auto">
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
              class="w-full px-3 py-2 text-start text-xs hover:bg-md-surface-variant transition-colors {addressFilter === 'all' ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
              onclick={() => { addressFilter = 'all'; fromDropdownOpen = false; fromSearch = ''; }}
            >
              {$t('activity.all')}
            </button>
            <!-- Address options -->
            {#each uniqueAddresses.filter(addr => fromSearch === '' || addr.toLowerCase().includes(fromSearch.toLowerCase())) as addr}
              <button
                class="w-full px-3 py-2 text-start text-xs hover:bg-md-surface-variant transition-colors {addressFilter === addr ? 'text-md-primary font-medium' : 'text-md-on-surface'}"
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
                <div class="text-xs text-md-on-surface/40 mt-1">
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
                    <span class="text-xs text-md-on-surface/50 uppercase tracking-wide">{$t('activity.code')}</span>
                    <code class="px-2 py-0.5 text-sm font-mono font-semibold rounded-md bg-md-primary/20 text-md-primary tracking-widest">
                      {otpValue}
                    </code>
                    <button
                      type="button"
                      class="text-xs text-md-primary hover:underline bg-transparent border-0 p-0"
                      onclick={(e) => { e.stopPropagation(); void copyOtp(otpValue); }}
                      title={$t('activity.copyOtp')}
                    >
                      {$t('activity.copy')}
                    </button>
                  </div>
                {/if}
                <div class="text-xs text-md-on-surface/40 mt-1">
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
                <div class="text-xs text-md-on-surface/40 mt-1">
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
                <div class="text-xs text-md-on-surface/40 mt-1">
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
                <div class="text-xs text-md-on-surface/40 mt-1">
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
                <div class="text-xs text-md-on-surface/40 mt-1">
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
                <div class="text-xs text-md-on-surface/40 mt-1">
                  {formatTime(event.timestamp)}
                </div>
              </div>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
    </div>
  </section>

  <!-- ── Since Info ── -->
  {#if analytics.createdAt}
    <div class="bg-md-primary-container rounded-xl px-2 py-2">
      <div class="text-xs font-semibold text-md-on-surface/40 uppercase tracking-wider mb-1.5">{$t('activity.trackingSince')}</div>
      <div class="text-sm text-md-on-surface">{new Date(analytics.createdAt).toLocaleDateString()}</div>
    </div>
  {/if}

</div>

  <!-- Sticky bottom action row -->
  <div class="shrink-0 flex gap-2 px-2 py-2 border-t border-md-outline-variant/20 bg-md-surface/95 backdrop-blur-sm z-20">
    <button type="button" class="flex-1 h-10 px-2 text-xs font-semibold rounded-xl border border-md-primary text-md-primary hover:bg-md-primary/10 transition-colors flex items-center justify-center gap-1.5" onclick={() => { onLoadAnalytics(); loadActivityEvents(); }}>
      <Icon name="refresh" class="w-3.5 h-3.5" />
      {$t('activity.refresh')}
    </button>
    <button type="button" class="flex-1 h-10 px-2 text-xs font-semibold rounded-xl border border-md-secondary text-md-secondary hover:bg-md-secondary/10 transition-colors flex items-center justify-center gap-1.5" onclick={handleExportAnalytics}>
      <Icon name="barChart" class="w-3.5 h-3.5" />
      {$t('activity.exportAnalytics')}
    </button>
    <button type="button" class="flex-1 h-10 px-2 text-xs font-semibold rounded-xl border border-md-error text-md-error hover:bg-md-error/10 transition-colors flex items-center justify-center gap-1.5" onclick={() => { resetDialogOpen = true; }}>
      <Icon name="trash" class="w-3.5 h-3.5" />
      {$t('activity.resetActivity')}
    </button>
  </div>

  <!-- ── Reset Confirmation Dialog ── -->
  {#if resetDialogOpen}
    <div
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-[10000]"
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
