<script lang="ts">
import { onDestroy, onMount, tick } from 'svelte';
import { locale, t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import { registerEscapeTier } from '@/features/keyboard-shortcuts/escape-stack.js';
import { ACTIVITY_DIALOG_KEYS, ACTIVITY_PAGE_KEYS } from '@/features/types/view-types.js';
import ActivityDashboardDialog from '@/ui/blocks/activity/ActivityDashboardDialog.svelte';
import ActivityExplorer from '@/ui/blocks/activity/ActivityExplorer.svelte';
import ConfirmDialog from '@/ui/blocks/dialogs/ConfirmDialog.svelte';
import FloatingAction from '@/ui/components/composites/FloatingAction.svelte';
import ScrollSpy from '@/ui/components/composites/ScrollSpy.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';
import IconButton from '@/ui/components/primitives/IconButton.svelte';
import Skeleton from '@/ui/components/primitives/Skeleton.svelte';
import {
  type ActivityCardPreference,
  type ActivityHistory,
  activityDay,
  activityWebsiteHost,
  normalizeActivityCards,
  parseActivityEvents,
  parseActivityHistory,
} from '@/utils/activity/activity-history.js';
import { clearActivityEvents, getActivitySnapshot } from '@/utils/activity/activity-tracker.js';
import { copyToClipboardAndSchedulePurge } from '@/utils/clipboard/clipboard.js';
import { downloadCSV, exportAnalyticsToCSV } from '@/utils/email/csv-export.js';
import { pluralKey } from '@/utils/i18n/i18n-plural.js';
import { humanizeViewId, viewDisplayLabelKey } from '@/utils/i18n/view-display-names.js';
import { logError } from '@/utils/logger.js';
import {
  EMAIL_STORAGE_ADDRESS_INDEX_KEY,
  getAddresses,
  getEmailMaps,
  isEmailStorageBagKey,
} from '@/utils/storage/storage-keys.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { formatBytes, getStorageUsage } from '@/utils/storage/storageMonitor.js';
import { formatMilliseconds, localDateStamp } from '@/utils/time/time-format.js';
import type { ActivityEvent, Address, Analytics, StorageTrendPoint } from '@/utils/types.js';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { PORTAL_Z_CLASS } from '@/utils/ui/portal-layers.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';
import { controlSurface } from '@/utils/ui/row-surface.js';
import { toastStore } from '@/utils/ui/toastStore.js';

function labelForVisit(viewId: string): string {
  const key = viewDisplayLabelKey(viewId);
  if (key) {
    const translated = $t(key) as string;
    if (translated && translated !== key) return translated;
  }
  return humanizeViewId();
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
  onOpenActivityEvent,
}: {
  context?: 'popup' | 'sidepanel' | 'app';
  onBack?: () => void;
  analytics?: Analytics;
  loading?: boolean;
  onLoadAnalytics?: () => void;
  onResetAnalytics?: () => void;
  onOpenActivityEvent?: (
    event: ActivityEvent,
    target: 'inbox' | 'message' | 'login' | 'settings'
  ) => Promise<void>;
} = $props();

let visitBreakdown = $derived.by(() => {
  const storedVisits = analytics.pageVisits ?? {};
  const knownPageVisitKeys = new Set<string>(ACTIVITY_PAGE_KEYS);
  const knownDialogVisitKeys = new Set<string>(ACTIVITY_DIALOG_KEYS);
  const pageVisits: [string, number][] = [
    ...ACTIVITY_PAGE_KEYS.map((viewId): [string, number] => [viewId, storedVisits[viewId] ?? 0]),
    ...(Object.entries(storedVisits) as [string, number][]).filter(
      ([key]) => !key.startsWith('dialog:') && !knownPageVisitKeys.has(key)
    ),
  ];
  const dialogVisits: [string, number][] = [
    ...ACTIVITY_DIALOG_KEYS.map((dialogId): [string, number] => [
      dialogId,
      storedVisits[dialogId] ?? 0,
    ]),
    ...(Object.entries(storedVisits) as [string, number][]).filter(
      ([key]) => key.startsWith('dialog:') && !knownDialogVisitKeys.has(key)
    ),
  ];

  pageVisits.sort((a, b) => b[1] - a[1]);
  dialogVisits.sort((a, b) => b[1] - a[1]);

  return {
    pageVisits,
    pageVisitsTotal: pageVisits.reduce((total, [, count]) => total + count, 0),
    pageVisitsMax: Math.max(1, ...pageVisits.map(([, count]) => count)),
    dialogVisits,
    dialogVisitsTotal: dialogVisits.reduce((total, [, count]) => total + count, 0),
    dialogVisitsMax: Math.max(1, ...dialogVisits.map(([, count]) => count)),
  };
});

let refreshInterval: ReturnType<typeof setInterval> | null = null;
let activityEvents = $state<ActivityEvent[]>([]);
let activityHistory = $state<ActivityHistory | null>(null);
let dashboardCards = $state(normalizeActivityCards(null));
let dashboardOpen = $state(false);
let dashboardSaving = $state(false);
let chartDay = $state<string | null>(null);
let chartHour = $state<number | null>(null);
let chartType = $state('all');
let chartQuery = $state('');
async function saveDashboard(cards: ActivityCardPreference[]) {
  if (dashboardSaving) return;
  const next = normalizeActivityCards(cards);
  const previous = dashboardCards;
  dashboardCards = next;
  dashboardSaving = true;
  try {
    await writeWithRetry({ activityDashboard: next });
    dashboardCards = next;
  } catch (error) {
    dashboardCards = previous;
    logError('Failed to save activity dashboard:', error);
    toastStore.error($t('toasts.operationFailed'));
  } finally {
    dashboardSaving = false;
  }
}
function clearChartFilter() {
  chartDay = null;
  chartHour = null;
  chartType = 'all';
  chartQuery = '';
}
async function filterChart(
  day: string | null = null,
  hour: number | null = null,
  type = 'all',
  query = ''
) {
  chartDay = day;
  chartHour = hour;
  chartType = type;
  chartQuery = query;
  await tick();
  const feed = activityScrollEl?.querySelector<HTMLElement>('#activity-section-feed');
  feed?.scrollIntoView({ block: 'start' });
  feed
    ?.querySelector<HTMLInputElement>('input[type="search"], input[type="text"]')
    ?.focus({ preventScroll: true });
}
let currentAddresses = $state<Address[]>([]);
let loadingEvents = $state(false);
let loadError = $state(false);
let activityLoadingListEl = $state<HTMLElement | null>(null);
let activityLoadingSkeletonCount = $state(4);

$effect(() => {
  const list = activityLoadingListEl;
  if (!loading || !list) return;

  const updateSkeletonCount = () => {
    // The summary placeholder cards are roughly 92px tall including their gap.
    activityLoadingSkeletonCount = Math.max(1, Math.ceil(list.clientHeight / 92));
  };
  updateSkeletonCount();
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(updateSkeletonCount);
    observer.observe(list);
    return () => observer.disconnect();
  }
  window.addEventListener('resize', updateSkeletonCount);
  return () => window.removeEventListener('resize', updateSkeletonCount);
});

/**
 * Mirrors the background's recordStorageTrend throttle window (1 hour).
 * Kept here so the UI can skip the recordStorageSnapshot round-trip when the
 * background would discard the sample anyway. analytics.ts owns the real value.
 */
const STORAGE_TREND_INTERVAL_MS = 3_600_000;

// Filter states
let svgWidth = $state(280);

// Interactive chart hovers (hover + tap-to-pin for touchscreens, where hover never fires)
let activeTimelineHover = $state<number | null>(null);
let pinnedTimelineIdx = $state<number | null>(null);
let activeDonutHover = $state<number | null>(null);
let pinnedHour = $state<number | null>(null);

// Scrollspy navigation sections (summary merged into visual)
const ACTIVITY_SECTIONS: { id: string; labelKey: string; icon: KnownIconName }[] = [
  { id: 'visual', labelKey: 'activity.visual', icon: 'barChart' },
  { id: 'performance', labelKey: 'activity.performance', icon: 'localFireDepartment' },
  { id: 'storage', labelKey: 'activity.storage', icon: 'database' },
  { id: 'feed', labelKey: 'activity.recentActivity', icon: 'notifications' },
];
let activityScrollEl = $state<HTMLElement | null>(null);
let activeSpySection = $state('visual');

// The shared dropdowns own Escape. Pinned chart points register separately.
$effect(() => {
  if (pinnedTimelineIdx === null && pinnedHour === null) return;
  return registerEscapeTier('activity.pin', () => {
    pinnedTimelineIdx = null;
    pinnedHour = null;
  });
});

const sectionTitleClass =
  'text-sm font-semibold text-md-on-surface flex items-center gap-2 mb-2 pt-1';

let resetDialogOpen = $state(false);

async function handleReset() {
  try {
    await Promise.all([clearActivityEvents(), onResetAnalytics()]);
    const snapshot = await getActivitySnapshot();
    activityEvents = snapshot.events;
    activityHistory = snapshot.history;
    clearChartFilter();
    loadError = false;
  } catch (error) {
    logError('Failed to reset activity data:', error);
    loadError = true;
  } finally {
    resetDialogOpen = false;
  }
}

async function handleExportAnalytics() {
  try {
    const csvContent = exportAnalyticsToCSV(analytics, activityEvents, storageSnapshot);
    const filename = `1click-analytics-${localDateStamp()}.csv`;
    downloadCSV(csvContent, filename);
  } catch (error) {
    logError('Failed to export analytics:', error);
    toastStore.error($t('activity.exportFailed'));
  }
}

/** Contextual FAB action: reload analytics + activity feed + storage snapshot. */
function handleFabRefresh() {
  onLoadAnalytics();
  void loadActivityEvents();
  void loadStorageSnapshot();
}

async function recordRenderTime(renderTime: number) {
  try {
    await browser.runtime.sendMessage({ type: 'recordUIRenderTime', renderTime });
  } catch (error) {
    logError('Failed to record UI render time:', error);
  }
}

async function loadActivityEvents() {
  const startTime = performance.now();
  loadingEvents = activityHistory === null;
  loadError = false;
  try {
    const snapshot = await getActivitySnapshot();
    activityEvents = snapshot.events;
    activityHistory = snapshot.history;
    currentAddresses = await getAddresses();
  } catch (error) {
    logError('Failed to load activity events:', error);
    loadError = true;
  } finally {
    loadingEvents = false;
    const renderTime = performance.now() - startTime;
    await recordRenderTime(renderTime);
  }
}

// Storage snapshot (mirrors Settings → Data section summary).
let storageBytes = $state(0);
let storedEmailCount = $state(0);
let identityCount = $state(0);
let mailCountByAddress = $state<Record<string, number>>({});
let storageSnapshot = $derived({
  addresses: currentAddresses.length,
  emails: storedEmailCount,
  identities: identityCount,
  bytes: storageBytes,
});

async function loadStorageSnapshot() {
  try {
    const { storedEmails, archivedEmails } = await getEmailMaps();
    let emailCount = 0;
    const perAddress: Record<string, number> = {};
    for (const [address, list] of Object.entries(storedEmails)) {
      emailCount += list.length;
      perAddress[address] = (perAddress[address] ?? 0) + list.length;
    }
    for (const [address, list] of Object.entries(archivedEmails)) {
      emailCount += list.length;
      perAddress[address] = (perAddress[address] ?? 0) + list.length;
    }
    storedEmailCount = emailCount;
    mailCountByAddress = perAddress;
    const stored = await browser.storage.local.get(['identities']);
    identityCount = Array.isArray(stored.identities) ? stored.identities.length : 0;
    storageBytes = await getStorageUsage();
    // Sample the footprint for the trend sparkline (background throttles to 1/hour).
    // Skip the round-trip when the background would no-op anyway: the last trend
    // point is younger than the background's 1-hour throttle window.
    const storageTrend = analytics.storageTrend ?? [];
    const lastPoint = storageTrend[storageTrend.length - 1];
    if (!lastPoint || Date.now() - lastPoint.t >= STORAGE_TREND_INTERVAL_MS) {
      try {
        await browser.runtime.sendMessage({
          type: 'recordStorageSnapshot',
          bytes: storageBytes,
          emails: storedEmailCount,
        });
      } catch (error) {
        logError('Failed to record storage snapshot:', error);
      }
    }
  } catch {
    /* ignore */
  }
}

function setupInterval(ms: number) {
  if (refreshInterval) clearTimeout(refreshInterval);
  if (ms > 0) {
    const loop = () => {
      onLoadAnalytics();
      loadActivityEvents().finally(() => {
        if (ms > 0) refreshInterval = setTimeout(loop, ms);
      });
    };
    refreshInterval = setTimeout(loop, ms);
  }
}

/**
 * Coalesce bursty storage writes (e.g. a multi-address inbox check writes one
 * bag key per `storage.set`) into a single snapshot reload.
 */
let snapshotRefreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleStorageSnapshotRefresh() {
  if (snapshotRefreshTimer) clearTimeout(snapshotRefreshTimer);
  snapshotRefreshTimer = setTimeout(() => {
    snapshotRefreshTimer = null;
    void loadStorageSnapshot();
  }, 250);
}

const onStorageChange = (
  changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
  areaName: string
) => {
  if (areaName !== 'local') return;
  if (changes.activityEvents) activityEvents = parseActivityEvents(changes.activityEvents.newValue);
  if (changes.activityDailyHistory)
    activityHistory = parseActivityHistory(changes.activityDailyHistory.newValue);
  if (changes.activityDashboard)
    dashboardCards = normalizeActivityCards(changes.activityDashboard.newValue);
  if (changes.autoRefreshInterval) {
    const ms =
      typeof changes.autoRefreshInterval.newValue === 'number'
        ? changes.autoRefreshInterval.newValue
        : 30000;
    setupInterval(ms);
  }
  // The snapshot is cached and refreshed only when data it displays changed:
  // email bags (stored/archived), the address index (an index shrink with
  // retained bags drops counted mail without any bag-key write), or identities.
  const relevant = Object.keys(changes).some(
    (key) =>
      isEmailStorageBagKey(key) || key === EMAIL_STORAGE_ADDRESS_INDEX_KEY || key === 'identities'
  );
  if (relevant) scheduleStorageSnapshotRefresh();
};

onMount(() => {
  const mountStartTime = performance.now();
  browser.storage.local
    .get(['autoRefreshInterval', 'activityDashboard'])
    .then((res) => {
      const ms = typeof res.autoRefreshInterval === 'number' ? res.autoRefreshInterval : 30000;
      setupInterval(ms);
      dashboardCards = normalizeActivityCards(res.activityDashboard);
    })
    .catch((error) => {
      logError('Failed to load activity preferences:', error);
      toastStore.error($t('toasts.operationFailed'));
    });
  browser.storage.onChanged.addListener(onStorageChange);

  // Load immediately on mount
  onLoadAnalytics();
  loadActivityEvents();
  void loadStorageSnapshot();
  const mountRenderTime = performance.now() - mountStartTime;
  recordRenderTime(mountRenderTime);
});

onDestroy(() => {
  if (refreshInterval) {
    clearTimeout(refreshInterval);
  }
  if (snapshotRefreshTimer) {
    clearTimeout(snapshotRefreshTimer);
  }
  browser.storage.onChanged.removeListener(onStorageChange);
});

function getEventIcon(type: ActivityEvent['type']): KnownIconName {
  switch (type) {
    case 'email_received':
      return 'mail';
    case 'otp_detected':
      return 'mail';
    case 'notification_sent':
      return 'notifications';
    case 'address_created':
      return 'barChart';
    case 'account_deleted':
      return 'barChart';
    case 'auto_fill':
      return 'schedule';
    case 'toast_notification':
      return 'notifications';
    case 'auto_extend':
      return 'refresh';
    case 'hard_reset':
      return 'refresh';
    default:
      return 'mail';
  }
}

function getEventTitle(type: ActivityEvent['type'], data: ActivityEvent['data']) {
  const tr = $t;
  const sender = data.sender || tr('activity.unknownSender');
  switch (type) {
    case 'email_received':
      return tr('activity.eventEmailReceived', { values: { sender } });
    case 'otp_detected':
      return tr('activity.eventOtpDetected', { values: { sender } });
    case 'notification_sent':
      return tr('activity.eventNotificationSent', { values: { sender } });
    case 'address_created':
      return tr('activity.eventAccountCreated', { values: { address: data.address } });
    case 'account_deleted':
      return tr('activity.eventAccountDeleted', { values: { address: data.address } });
    case 'auto_fill':
      return tr('activity.eventAutoFill', { values: { website: data.website } });
    case 'toast_notification':
      return data.message || tr('activity.notification');
    case 'auto_extend':
      return tr('activity.eventAutoExtended', { values: { address: data.address } });
    case 'hard_reset':
      return tr('activity.eventHardReset');
    default:
      return tr('activity.eventUnknown');
  }
}

function getEventSubtitle(type: ActivityEvent['type'], data: ActivityEvent['data']) {
  const tr = $t;
  const fallbackSubject = tr('activity.noSubject');
  switch (type) {
    case 'email_received':
      return data.subject || fallbackSubject;
    case 'otp_detected':
      return data.subject || fallbackSubject;
    case 'notification_sent':
      return data.subject || fallbackSubject;
    case 'address_created':
      return data.address;
    case 'account_deleted':
      return data.address;
    case 'auto_fill':
      return data.website;
    case 'toast_notification':
      return data.provider || tr('activity.toastInfo');
    case 'auto_extend':
      return data.address;
    case 'hard_reset':
      return tr('activity.allDataCleared');
    default:
      return '';
  }
}

function formatTime(timestamp: number) {
  const tr = $t;
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) return tr('activity.timeJustNow');
  if (diff < 3600000) {
    const n = Math.floor(diff / 60000);
    return tr(
      pluralKey(
        { oneKey: 'activity.timeMinutesAgo', otherKey: 'activity.timeMinutesAgoPlural' },
        n
      ),
      { values: { n } }
    );
  }
  if (diff < 86400000) {
    const n = Math.floor(diff / 3600000);
    return tr(
      pluralKey({ oneKey: 'activity.timeHoursAgo', otherKey: 'activity.timeHoursAgoPlural' }, n),
      { values: { n } }
    );
  }
  return new Date(timestamp).toLocaleDateString($locale || 'en');
}

async function copyOtp(otp: string) {
  try {
    const copied = await copyToClipboardAndSchedulePurge(otp);
    if (copied) toastStore.success($t('common.copied'));
    else toastStore.error($t('inbox.copyFailed'));
  } catch (error) {
    logError('Failed to copy activity code:', error);
    toastStore.error($t('toasts.operationFailed'));
  }
}

// ── Derived Calculations for Visual Analytics ──

// 1. Time Saved circular gauge
const timeSaved = $derived.by(() => {
  const addresses = analytics.accountsCreated || 0;
  const otps = analytics.otpsDetected || 0;
  let autofills = 0;
  activityEvents.forEach((e) => {
    if (e.type === 'auto_fill') autofills++;
  });

  const totalSeconds = addresses * 10 + otps * 15 + autofills * 20;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const targetSeconds = 3600; // 1 hour target
  const percent = Math.min((totalSeconds / targetSeconds) * 100, 100);
  const circumference = 2 * Math.PI * 40;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  return {
    totalSeconds,
    hours,
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

  currentAddresses.forEach((record) => {
    if (record.expiresAt <= now) {
      expired++;
    } else if (record.expiresAt <= now + 15 * 60 * 1000) {
      expiringSoon++;
    } else {
      active++;
    }
  });

  const total = currentAddresses.length;
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

    const label = d.toLocaleDateString($locale || 'en', { weekday: 'short' });
    days.push({ label, start, end });
  }

  let maxTotal = 5;
  const formattedDays = days.map((day) => {
    let addresses = 0;
    let emails = 0;
    let otps = 0;

    const summary = activityHistory?.days.find((bucket) => bucket.day === activityDay(day.start));
    if (summary) {
      addresses = summary.counts.address_created ?? 0;
      emails = summary.counts.email_received ?? 0;
      otps = summary.counts.otp_detected ?? 0;
    }

    const total = addresses + emails + otps;
    if (total > maxTotal) maxTotal = total;

    return {
      label: day.label,
      day: activityDay(day.start),
      addresses,
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
    if (e.type === 'address_created') created++;
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
        color: 'var(--md-outline-variant)',
        label: $t('activity.chartNoData'),
        percent: 0,
        count: 0,
        type: 'all',
      },
    ];
  }

  const items = [
    {
      label: $t('activity.chartCreated'),
      count: created,
      color: 'var(--md-primary)',
      type: 'address_created',
    },
    {
      label: $t('activity.chartReceived'),
      count: received,
      color: 'var(--md-secondary)',
      type: 'received',
    },
    {
      label: $t('activity.chartAutofilled'),
      count: autofilled,
      color: 'var(--md-tertiary)',
      type: 'auto_fill',
    },
    {
      label: $t('activity.notifications'),
      count: notification,
      color: 'var(--md-error)',
      type: 'notification',
    },
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
      type: item.type,
    };
  });

  return segments.filter((s) => s.count > 0);
});

// 5. Top Sites Filled
const topWebsites = $derived.by(() => {
  const counts: Record<string, number> = {};
  activityEvents.forEach((e) => {
    if (e.type === 'auto_fill' && e.data.website) {
      const domain = activityWebsiteHost(e.data.website);
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

/** Hour ticks for the heatmap axis, formatted in the active locale (no hardcoded AM/PM). */
let heatmapAxisLabels = $derived(
  [0, 4, 8, 12, 16, 20, 23].map((hour) =>
    new Intl.DateTimeFormat($locale ?? 'en', { hour: 'numeric' }).format(new Date(2000, 0, 1, hour))
  )
);

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

function inlineAverage(values: number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/**
 * Performance-section display values. Prefers the background's aggregated
 * getPerformanceSummary (single source of truth); falls back to the same
 * math inline when the summary is unavailable (e.g. right after a reset).
 * null means "no samples" → rendered as notAvailable.
 */
const perfRows = $derived.by(() => {
  const perf = analytics.performance;
  const summary = analytics.performanceSummary;
  const emailFetchTimes = perf?.emailFetchTimes ?? [];
  const uiRenderTimes = perf?.uiRenderTimes ?? [];
  const providerLatency: Record<string, number | null> = {};
  for (const [provider, latencies] of Object.entries(perf?.providerLatency ?? {})) {
    providerLatency[provider] =
      Array.isArray(latencies) && latencies.length > 0
        ? summary
          ? (summary.avgProviderLatency[provider] ?? inlineAverage(latencies))
          : inlineAverage(latencies)
        : null;
  }
  return {
    emailFetch:
      emailFetchTimes.length > 0
        ? summary
          ? summary.avgEmailFetchTime
          : inlineAverage(emailFetchTimes)
        : null,
    uiRender:
      uiRenderTimes.length > 0
        ? summary
          ? summary.avgUIRenderTime
          : inlineAverage(uiRenderTimes)
        : null,
    providerLatency,
  };
});

/**
 * Storage trend sparkline data from the background-sampled history.
 * null means fewer than 2 samples → rendered as the collecting placeholder.
 */
const storageTrend = $derived.by(() => {
  const points = (analytics.storageTrend ?? []).slice(-14);
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const pct =
    first.bytes > 0 ? ((last.bytes - first.bytes) / first.bytes) * 100 : last.bytes > 0 ? 100 : 0;
  const values = points.map((p: StorageTrendPoint) => p.bytes);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const coords = points.map((p: StorageTrendPoint, i: number) => ({
    x: 4 + (i / (points.length - 1 || 1)) * 92,
    y: 24 - ((p.bytes - min) / range) * 20,
  }));
  const path = coords
    .map(
      (c: { x: number; y: number }, i: number) =>
        `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`
    )
    .join(' ');
  const end = coords[coords.length - 1];
  return {
    path,
    endX: end.x,
    endY: end.y,
    pctRounded: Math.round(Math.abs(pct)),
    state: pct > 0.5 ? ('up' as const) : pct < -0.5 ? ('down' as const) : ('flat' as const),
  };
});

/** Per-address stored-mail counts (stored + archived), heaviest first. */
const topAddressesByMail = $derived.by(() => {
  const sorted = Object.entries(mailCountByAddress)
    .map(([address, count]) => ({ address, count }))
    .sort((a, b) => b.count - a.count);
  const maxCount = sorted.length > 0 ? sorted[0].count : 1;
  return sorted.map((item) => ({ ...item, percent: (item.count / maxCount) * 100 }));
});

let addressesExpanded = $state(false);
</script>

{#if loading}
  <div bind:this={activityLoadingListEl} class="scroll-body flex-1 overflow-y-auto py-3 space-y-4">
    {#each Array(activityLoadingSkeletonCount) as _, i (i)}
      <div class="rounded-xl bg-md-surface-container-low p-4 space-y-2">
        <Skeleton width="6rem" height="0.75rem" />
        <Skeleton width="8rem" height="2rem" />
      </div>
    {/each}
  </div>
{:else if loadError}
  <div class="flex-1 flex flex-col items-center justify-center space-y-4 text-center h-full">
    <Icon name="close" class="w-12 h-12 text-md-error opacity-60" />
    <p class="text-sm text-md-on-surface/70">{$t('activity.loadError')}</p>
    <button
      class="px-4 py-2 bg-md-primary text-md-on-primary rounded-xl font-semibold text-sm hover:opacity-90"
      onclick={() => { loadError = false; void loadActivityEvents(); }}
    >
      {$t('common.retry')}
    </button>
  </div>
{:else}
<div class="scroll-frame flex flex-col h-full relative min-h-0">
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
    class="scroll-body scroll-body-framed @container flex-1 h-full min-h-0 overflow-y-auto py-3 space-y-4 flex flex-col"
  >
    <!-- Page heading -->
    <header class="flex flex-col gap-3 @md:flex-row @md:items-center @md:justify-between">
      <div class="flex flex-1 min-w-0 items-start justify-between gap-2">
        <h1 class="pt-0.5 text-title-lg text-md-on-surface">
          {$t('activity.title')}
          <span class="block ui-support font-normal text-md-on-surface-variant mt-0.5">{$t('activity.subtitle')}</span>
        </h1>
        <IconButton icon="settings" ariaLabel={$t('activityExplorer.dashboard')} onclick={() => { dashboardOpen = true; }} />
      </div>
      <div
        class="flex w-full gap-2 @md:w-auto"
        role="toolbar"
        aria-label={$t('activity.title')}
        use:responsiveButtonLayout
        data-action-tier="S"
      >
        <button
          type="button"
          class="md-action flex-1 min-w-0 rounded-xl bg-md-secondary-container px-3 py-2 text-xs font-semibold text-md-on-secondary-container transition-colors @md:flex-none"
          onclick={handleExportAnalytics}
        >
          <span class="flex items-center justify-center gap-1.5">
            <Icon name="barChart" class="w-4 h-4 shrink-0" />
            <span>{$t('activity.exportAnalytics')}</span>
          </span>
        </button>
        <button
          type="button"
          class="md-action flex-1 min-w-0 rounded-xl border border-md-error px-3 py-2 text-xs font-semibold text-md-error transition-colors @md:flex-none"
          onclick={() => { resetDialogOpen = true; }}
        >
          <span class="flex items-center justify-center gap-1.5">
            <Icon name="delete" class="w-4 h-4 shrink-0" />
            <span>{$t('activity.resetActivity')}</span>
          </span>
        </button>
      </div>
    </header>

    <!-- ── Visual Analytics Dashboard (includes former summary totals) ── -->
    <section id="activity-section-visual" data-section="visual" class="space-y-3 scroll-mt-2">
      <h2 class={sectionTitleClass}>
        <Icon name="barChart" class="w-4 h-4 text-md-primary" />
        {$t('activity.visual')}
      </h2>

      <!-- Totals (moved from summary) -->
      <p class="ui-support text-md-on-surface-variant">{$t('activityExplorer.allTime')}</p>
      <div data-activity-grid="totals" class="activity-totals-grid gap-px overflow-hidden rounded-2xl border border-md-outline-variant/30 bg-md-outline-variant/30">
        <div class="flex min-w-0 flex-col justify-center gap-1 bg-md-surface-container-low px-3 py-3">
          <div class="text-xl font-bold tabular-nums text-md-primary">{$t('activity.timeSavedFormat', { values: { h: timeSaved.hours, m: timeSaved.minutes } })}</div>
          <div class="truncate text-label-sm text-md-on-surface/55">{$t('activity.timeSavedLabel')}</div>
        </div>
        <div class="flex min-w-0 flex-col justify-center gap-1 bg-md-surface-container-low px-3 py-3">
          <div class="text-xl font-bold tabular-nums text-md-primary">{analytics.accountsCreated}</div>
          <div class="truncate text-label-sm text-md-on-surface/55">{$t('activity.addresses')}</div>
        </div>
        <div class="flex min-w-0 flex-col justify-center gap-1 bg-md-surface-container-low px-3 py-3">
          <div class="text-xl font-bold tabular-nums text-md-secondary">{analytics.emailsReceived}</div>
          <div class="truncate text-label-sm text-md-on-surface/55">{$t('activity.emails')}</div>
        </div>
        <div class="flex min-w-0 flex-col justify-center gap-1 bg-md-surface-container-low px-3 py-3">
          <div class="text-xl font-bold tabular-nums text-md-tertiary">{analytics.otpsDetected}</div>
          <div class="truncate text-label-sm text-md-on-surface/55">{$t('activity.otps')}</div>
        </div>
        <div class="flex min-w-0 flex-col justify-center gap-1 bg-md-surface-container-low px-3 py-3">
          <div class="text-xl font-bold tabular-nums text-md-primary">{analytics.extensionOpens || 0}</div>
          <div class="truncate text-label-sm text-md-on-surface/55">{$t('activity.extensionOpens')}</div>
        </div>
        <div class="flex min-w-0 flex-col justify-center gap-1 bg-md-surface-container-low px-3 py-3">
          <div class="text-xl font-bold tabular-nums text-md-secondary">{analytics.emailsRead || 0}</div>
          <div class="truncate text-label-sm text-md-on-surface/55">{$t('activity.emailsRead')}</div>
        </div>
    </div>

      <div data-activity-grid="visits" class="activity-card-grid gap-2">
          <section class="rounded-2xl border border-md-outline-variant/25 bg-md-surface-container-low p-3">
            <header class="mb-3 flex items-center gap-2.5">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-md-secondary-container text-md-on-secondary-container">
                <Icon name="gridView" class="h-4 w-4" />
              </span>
              <div class="min-w-0 flex-1">
                <h3 class="text-sm font-semibold text-md-on-surface">{$t('activity.pageVisits')}</h3>
              </div>
              <span class="shrink-0 rounded-full bg-md-secondary-container px-2.5 py-1 text-label-sm font-semibold tabular-nums text-md-on-secondary-container">
                {visitBreakdown.pageVisitsTotal}
              </span>
            </header>
            <div class="scroll-body max-h-44 space-y-3 overflow-y-auto px-1">
              {#each visitBreakdown.pageVisits as [viewId, count] (viewId)}
                <div class="min-w-0">
                  <div class="mb-1 flex items-center justify-between gap-2 text-label-sm">
                    <span class="truncate text-md-on-surface/75">{labelForVisit(viewId)}</span>
                    <span class="shrink-0 font-semibold tabular-nums text-md-on-surface">{count}</span>
                  </div>
                  <div
                    class="h-1.5 overflow-hidden rounded-full bg-md-surface-container-high"
                    role="meter"
                    aria-label={labelForVisit(viewId)}
                    aria-valuemin="0"
                    aria-valuemax={visitBreakdown.pageVisitsMax}
                    aria-valuenow={count}
                  >
                    <div
                      class="h-full rounded-full bg-md-secondary transition-[width] duration-300"
                      style={`width: ${(count / visitBreakdown.pageVisitsMax) * 100}%`}
                    ></div>
                  </div>
                </div>
              {/each}
            </div>
          </section>
          <section class="rounded-2xl border border-md-outline-variant/25 bg-md-surface-container-low p-3">
            <header class="mb-3 flex items-center gap-2.5">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-md-tertiary-container text-md-on-tertiary-container">
                <Icon name="layers" class="h-4 w-4" />
              </span>
              <div class="min-w-0 flex-1">
                <h3 class="text-sm font-semibold text-md-on-surface">{$t('activity.dialogVisits')}</h3>
              </div>
              <span class="shrink-0 rounded-full bg-md-tertiary-container px-2.5 py-1 text-label-sm font-semibold tabular-nums text-md-on-tertiary-container">
                {visitBreakdown.dialogVisitsTotal}
              </span>
            </header>
            <div class="scroll-body max-h-44 space-y-3 overflow-y-auto px-1">
              {#each visitBreakdown.dialogVisits as [viewId, count] (viewId)}
                <div class="min-w-0">
                  <div class="mb-1 flex items-center justify-between gap-2 text-label-sm">
                    <span class="truncate text-md-on-surface/75">{labelForVisit(viewId)}</span>
                    <span class="shrink-0 font-semibold tabular-nums text-md-on-surface">{count}</span>
                  </div>
                  <div
                    class="h-1.5 overflow-hidden rounded-full bg-md-surface-container-high"
                    role="meter"
                    aria-label={labelForVisit(viewId)}
                    aria-valuemin="0"
                    aria-valuemax={visitBreakdown.dialogVisitsMax}
                    aria-valuenow={count}
                  >
                    <div
                      class="h-full rounded-full bg-md-tertiary transition-[width] duration-300"
                      style={`width: ${(count / visitBreakdown.dialogVisitsMax) * 100}%`}
                    ></div>
                  </div>
                </div>
              {/each}
            </div>
          </section>
      </div>

    <!-- Chart columns follow their own pane's available width, including
         sidebar and rail changes, without a fixed two-column ceiling. -->
    <div data-activity-grid="charts" class="activity-card-grid gap-3">
      {#each dashboardCards.filter((card) => card.visible) as card (card.id)}
        {#if card.id === 'timeSaved'}{@render timeSavedCard()}
        {:else if card.id === 'expiry'}{@render expiryCard()}
        {:else if card.id === 'timeline'}{@render timelineCard()}
        {:else if card.id === 'breakdown'}{@render breakdownCard()}
        {:else if card.id === 'sites'}{@render sitesCard()}
        {:else if card.id === 'latency'}{@render latencyCard()}
        {:else if card.id === 'hours'}{@render hoursCard()}{/if}
      {/each}
      <!-- Chart 1: Time Saved Gauge -->
      {#snippet timeSavedCard()}
      <div data-activity-card="timeSaved" class="bg-md-surface-container-low rounded-2xl p-4 border border-md-outline-variant/20 flex flex-col justify-between min-h-48">
        <div class="flex items-center gap-2 mb-2">
          <Icon name="schedule" class="w-4 h-4 text-md-primary" />
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
                stroke="var(--md-outline-variant)"
                stroke-width="8"
                class="opacity-30"
              />
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="transparent"
                stroke="var(--md-primary)"
                stroke-width="8"
                stroke-dasharray={timeSaved.strokeDasharray}
                stroke-dashoffset={timeSaved.strokeDashoffset}
                stroke-linecap="round"
                class="transition-all duration-700 ease-out"
              />
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center">
              <span class="text-sm font-bold text-md-primary leading-none">
                {$t('time.durationM', { values: { m: timeSaved.minutes } })}
              </span>
              <span class="text-xs text-md-on-surface/50 font-medium leading-none mt-0.5">
                {$t('time.durationS', { values: { s: timeSaved.seconds } })}
              </span>
            </div>
          </div>
          <div class="flex-1 min-w-0 flex flex-col justify-center">
            <div class="text-xl font-bold text-md-on-surface">
              {Math.round(timeSaved.totalSeconds / 60)} <span class="text-xs font-normal text-md-on-surface/60">{$t('activity.minSaved')}</span>
            </div>
            <p class="ui-support text-md-on-surface-variant mt-1">
              {$t('activity.timeSavedDescription')}
            </p>
          </div>
        </div>
      </div>

      <!-- Chart 2: Inbox Expiry Outlook -->
      {/snippet}
      {#snippet expiryCard()}
      <div data-activity-card="expiry" class="bg-md-surface-container-low rounded-2xl p-4 border border-md-outline-variant/20 flex flex-col justify-between min-h-48">
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
                <div class="h-full bg-[var(--md-primary)] transition-all duration-500" style="width: {expiryOutlook.activePercent}%" title={$t('activity.legendActive')}></div>
              {/if}
              {#if expiryOutlook.expiringSoon > 0}
                <div class="h-full bg-[var(--md-tertiary)] transition-all duration-500" style="width: {expiryOutlook.expiringSoonPercent}%" title={$t('activity.legendExpiringSoon')}></div>
              {/if}
              {#if expiryOutlook.expired > 0}
                <div class="h-full bg-[var(--md-error)] transition-all duration-500 opacity-60" style="width: {expiryOutlook.expiredPercent}%" title={$t('activity.legendExpired')}></div>
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
      {/snippet}
      {#snippet timelineCard()}
      <div data-activity-card="timeline" class="bg-md-surface-container-low rounded-2xl p-4 border border-md-outline-variant/20 flex flex-col justify-between min-h-56">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <Icon name="barChart" class="w-4 h-4 text-md-primary" />
            <span class="text-xs font-semibold text-md-on-surface/80">{$t('activity.activityTimeline')}</span>
          </div>
          {#if (activeTimelineHover ?? pinnedTimelineIdx) !== null}
            {@const hoveredDay = timelineData.days[(activeTimelineHover ?? pinnedTimelineIdx) as number]}
            <span class="text-xs bg-md-primary-container text-md-on-primary-container px-2 py-0.5 rounded-full transition-opacity duration-200">
              {hoveredDay.label}: {$t(
                pluralKey(
                  { oneKey: 'activity.timelineEvents', otherKey: 'activity.timelineEventsPlural' },
                  hoveredDay.total
                ),
                { values: { n: hoveredDay.total } }
              )}
            </span>
          {/if}
        </div>

        <div class="flex-1 flex items-end justify-between relative px-1 pb-1 pt-2" bind:clientWidth={svgWidth}>
          <div class="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-10 pb-5 pt-3">
            <div class="border-b border-md-outline w-full"></div>
            <div class="border-b border-md-outline w-full"></div>
            <div class="border-b border-md-outline w-full"></div>
          </div>

          <svg viewBox="0 0 {svgWidth || 280} 100" class="w-full h-24 overflow-visible z-10">
            {#each timelineData.days as day, idx}
              {@const maxH = 80}
              {@const colW = (svgWidth || 280) / 7}
              {@const xPos = idx * colW + (colW / 2) - 8}
              {@const addressH = (day.addresses / timelineData.max) * maxH}
              {@const emailH = (day.emails / timelineData.max) * maxH}
              {@const otpH = (day.otps / timelineData.max) * maxH}
              
              <g
                role="button"
                tabindex="0"
                aria-label="{day.label}: {$t(
                  pluralKey(
                    { oneKey: 'activity.timelineEvents', otherKey: 'activity.timelineEventsPlural' },
                    day.total
                  ),
                  { values: { n: day.total } }
                )}"
                class="cursor-pointer group"
                onmouseenter={() => activeTimelineHover = idx}
                onmouseleave={() => activeTimelineHover = null}
                onclick={() => { pinnedTimelineIdx = idx; void filterChart(day.day); }}
                onkeydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    pinnedTimelineIdx = idx; void filterChart(day.day);
                  }
                }}
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

                {#if addressH > 0}
                  <rect
                    x={xPos}
                    y={80 - addressH}
                    width="16"
                    height={addressH}
                    fill="var(--md-primary)"
                    rx="1.5"
                  />
                {/if}
                {#if emailH > 0}
                  <rect
                    x={xPos}
                    y={80 - addressH - emailH}
                    width="16"
                    height={emailH}
                    fill="var(--md-secondary)"
                    rx="1.5"
                  />
                {/if}
                {#if otpH > 0}
                  <rect
                    x={xPos}
                    y={80 - addressH - emailH - otpH}
                    width="16"
                    height={otpH}
                    fill="var(--md-tertiary)"
                    rx="1.5"
                  />
                {/if}

                {#if day.total === 0}
                  <rect
                    x={xPos}
                    y="79"
                    width="16"
                    height="2"
                    fill="var(--md-outline-variant)"
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
            <span>{$t('activity.addresses')}</span>
          </div>
          <div class="flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded bg-[var(--md-secondary)]"></span>
            <span>{$t('activity.emails')}</span>
          </div>
          <div class="flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded bg-[var(--md-tertiary)]"></span>
            <span>{$t('activity.otps')}</span>
          </div>
        </div>
      </div>

      <!-- Chart 4: Event Breakdown -->
      {/snippet}
      {#snippet breakdownCard()}
      <div data-activity-card="breakdown" class="bg-md-surface-container-low rounded-2xl p-4 border border-md-outline-variant/20 flex flex-col justify-between min-h-56">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <Icon name="mail" class="w-4 h-4 text-md-secondary" />
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
                stroke="var(--md-outline-variant)"
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
              <span class="text-label-sm text-md-on-surface/50 font-semibold leading-none mt-1">
                {$t('activity.total')}
              </span>
            </div>
          </div>

          <div class="flex flex-col gap-1 min-w-0">
            {#each donutSegments as segment, idx}
              <button
                type="button"
                class="md-action rounded-lg flex items-center gap-1.5 text-start p-1"
                title={$t('activityExplorer.showActivity')}
                disabled={segment.count === 0}
                onclick={() => void filterChart(null, null, segment.type)}
                onmouseenter={() => activeDonutHover = idx}
                onmouseleave={() => activeDonutHover = null}
              >
                <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: {segment.color}"></span>
                <div class="flex flex-col min-w-0">
                  <span class="text-xs font-semibold text-md-on-surface/90 leading-none truncate">{segment.label}</span>
                  <span class="text-label-sm text-md-on-surface/50 leading-none mt-0.5">{segment.count} ({segment.percent}%)</span>
                </div>
              </button>
            {/each}
        </div>
      </div>

      </div>

      <!-- Chart 5: Top Sites Filled -->
      {/snippet}
      {#snippet sitesCard()}
      <div data-activity-card="sites" class="bg-md-surface-container-low rounded-2xl p-4 border border-md-outline-variant/20 flex flex-col justify-between min-h-56">
        <div class="flex items-center gap-2 mb-3">
          <Icon name="globe" class="w-4 h-4 text-md-primary" />
          <span class="text-xs font-semibold text-md-on-surface/80">{$t('activity.topWebsites')}</span>
        </div>

        <div class="flex-1 flex flex-col justify-between space-y-2 pb-1">
          {#each topWebsites as site, idx}
            <button type="button" class="md-action rounded-lg p-1 text-start space-y-1 w-full" title={$t('activityExplorer.showActivity')} onclick={() => void filterChart(null, null, 'auto_fill', site.domain)}>
              <div class="flex justify-between items-center text-label-sm">
                <div class="flex items-center gap-1.5 min-w-0">
                  <span class="text-xs font-bold text-md-primary/70 bg-md-primary-container/50 px-1 py-px rounded">#{idx + 1}</span>
                  <span class="text-md-on-surface truncate font-medium">{site.domain}</span>
                </div>
                <span class="text-md-on-surface/60 font-semibold shrink-0">{$t('activity.fillCount', { values: { n: site.count } })}</span>
              </div>
              <div class="w-full h-1.5 rounded-full bg-md-outline-variant/20 overflow-hidden">
                <div 
                  class="h-full bg-[var(--md-primary)] rounded-full transition-all duration-700 ease-out" 
                  style="width: {site.percent}%"
                ></div>
              </div>
            </button>
          {:else}
            <div class="flex-1 flex items-center justify-center ui-support text-md-on-surface-variant text-center">
              {$t('activity.noWebsitesAutofilled')}
            </div>
          {/each}
        </div>
      </div>

      <!-- Chart 6: Email Fetch Latency -->
      {/snippet}
      {#snippet latencyCard()}
      <div data-activity-card="latency" class="bg-md-surface-container-low rounded-2xl p-4 border border-md-outline-variant/20 flex flex-col justify-between min-h-56">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <Icon name="schedule" class="w-4 h-4 text-md-tertiary" />
            <span class="text-xs font-semibold text-md-on-surface/80">{$t('activity.fetchLatencyMs')}</span>
          </div>
          <span class="text-xs text-md-on-surface/60 font-semibold">
            {$t('activity.avgValue', {
              values: {
                n: latencyData.times.length > 0
                  ? (latencyData.times.reduce((a: number, b: number) => a + b, 0) / latencyData.times.length).toFixed(0)
                  : 0,
              },
            })}
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
                <stop offset="0%" stop-color="var(--md-tertiary)" stop-opacity="0.3"/>
                <stop offset="100%" stop-color="var(--md-tertiary)" stop-opacity="0.0"/>
              </linearGradient>
            </defs>

            {#if latencyData.areaPath}
              <path d={latencyData.areaPath} fill="url(#latency-grad)" />
            {/if}

            {#if latencyData.linePath}
              <path
                d={latencyData.linePath}
                fill="none"
                stroke="var(--md-tertiary)"
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
                  fill="var(--md-surface)"
                  stroke="var(--md-tertiary)"
                  stroke-width="1.8"
                  class="transition-all duration-150 group-hover/point:r-5 group-hover/point:stroke-width-2.5"
                />
                <title>{formatMilliseconds(point.value)}</title>
              </g>
            {/each}

            <line x1="20" y1="100" x2="280" y2="100" stroke="var(--md-outline-variant)" stroke-width="1" class="opacity-40" />
          </svg>
        </div>

        <div class="text-label-sm text-md-on-surface/50 text-center border-t border-md-outline-variant/10 pt-1.5 mt-1 shrink-0">
          {$t('activity.latencyRange', {
            values: {
              min: latencyData.times.length > 0 ? Math.min(...latencyData.times) : 0,
              max: latencyData.times.length > 0 ? Math.max(...latencyData.times) : 0,
              n: latencyData.times.length,
            },
          })}
        </div>
      </div>

      <!-- Full-width heatmap follows the regular cards to avoid empty grid cells. -->
      {/snippet}
      {#snippet hoursCard()}
      <div data-activity-card="hours" class="activity-full-row bg-md-surface-container-low rounded-2xl p-4 border border-md-outline-variant/20 space-y-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <Icon name="schedule" class="w-4 h-4 text-md-primary" />
            <span class="text-xs font-semibold text-md-on-surface/80">{$t('activity.heatmapTitle')}</span>
          </div>
          <span class="text-xs text-md-on-surface/50 font-mono">{$t('activity.heatmapSubtitle')}</span>
        </div>

        <div class="grid grid-cols-12 @md:grid-cols-24 gap-1 items-end h-24 pt-2">
          {#each hourlyHeatmap.buckets as bucket}
            {@const intensity = bucket.count > 0 ? Math.max(0.25, bucket.count / hourlyHeatmap.maxCount) : 0.08}
            {@const formattedHour = `${bucket.hour.toString().padStart(2, '0')}:00`}
            <div
              role="button"
              tabindex="0"
              aria-label="{formattedHour}: {$t(
                pluralKey(
                  { oneKey: 'activity.timelineEvents', otherKey: 'activity.timelineEventsPlural' },
                  bucket.count
                ),
                { values: { n: bucket.count } }
              )}"
              class="group relative flex flex-col items-center justify-end h-full w-full rounded-md transition-all duration-150 hover:scale-105 cursor-pointer"
              style="background-color: color-mix(in srgb, var(--md-primary) {Math.round(intensity * 100)}%, transparent);"
              onclick={() => { pinnedHour = bucket.hour; void filterChart(null, bucket.hour); }}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  pinnedHour = bucket.hour; void filterChart(null, bucket.hour);
                }
              }}
            >
              <div
                class="w-full bg-md-primary rounded-t transition-all"
                style="height: {hourlyHeatmap.maxCount > 0 ? (bucket.count / hourlyHeatmap.maxCount) * 100 : 0}%; opacity: {intensity};"
              ></div>

              <!-- Tooltip on hover / tap-pin -->
              <div class="absolute bottom-full mb-1 {pinnedHour === bucket.hour ? 'flex' : 'hidden group-hover:flex'} flex-col items-center {PORTAL_Z_CLASS.chrome} pointer-events-none">
                <div class="bg-md-inverse-surface text-md-inverse-on-surface text-xs rounded-lg px-2 py-1 {ELEVATION.level2} whitespace-nowrap border border-md-outline-variant/30 font-mono">
                  <span class="font-bold text-md-primary">{formattedHour}</span>: {$t('activity.heatmapTooltip', { values: { count: bucket.count, otps: bucket.otps } })}
                </div>
              </div>
            </div>
          {/each}
        </div>

        <div class="flex items-center justify-between text-xs text-md-on-surface/40 pt-1 border-t border-md-outline-variant/10">
          {#each heatmapAxisLabels as label}
            <span>{label}</span>
          {/each}
        </div>
      </div>
      {/snippet}
    </div>
  </section>

  <!-- ── Performance Metrics ── -->
  <section id="activity-section-performance" data-section="performance" class="space-y-2 scroll-mt-2">
    <h2 class={sectionTitleClass}>
      <Icon name="schedule" class="w-4 h-4 text-md-primary" />
      {$t('activity.performance')}
    </h2>
    {#if perfRows.emailFetch !== null || perfRows.uiRender !== null || Object.keys(perfRows.providerLatency).length > 0}
      <div data-activity-grid="performance" class="activity-card-grid gap-3 bg-md-surface-container-low rounded-xl px-3 py-3 border border-md-outline-variant/20">
        <!-- Email Fetch Time -->
        <div class="flex items-center justify-between">
          <div class="text-xs text-md-on-surface/70">{$t('activity.avgEmailFetch')}</div>
          <div class="text-sm font-semibold text-md-primary">
            {perfRows.emailFetch !== null ? formatMilliseconds(perfRows.emailFetch) : $t('activity.notAvailable')}
          </div>
        </div>

        <!-- UI Render Time -->
        <div class="flex items-center justify-between">
          <div class="text-xs text-md-on-surface/70">{$t('activity.avgUiRender')}</div>
          <div class="text-sm font-semibold text-md-secondary">
            {perfRows.uiRender !== null ? formatMilliseconds(perfRows.uiRender) : $t('activity.notAvailable')}
          </div>
        </div>

        <!-- Provider Latency -->
        {#if Object.keys(perfRows.providerLatency).length > 0}
          <div>
            <div class="text-xs text-md-on-surface/70 mb-2">{$t('activity.providerLatency')}</div>
            {#each Object.entries(perfRows.providerLatency) as [provider, avg]}
              <div class="flex items-center justify-between mb-1 last:mb-0">
                <div class="text-xs text-md-on-surface/60 capitalize">{provider}</div>
                <div class="text-xs font-medium text-md-tertiary">
                  {avg !== null ? formatMilliseconds(avg) : $t('activity.notAvailable')}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <div class="bg-md-surface-container-low rounded-xl px-3 py-4 border border-md-outline-variant/20 text-center text-xs text-md-on-surface/50">
        {$t('activity.notAvailable')}
      </div>
    {/if}
  </section>

  <!-- ── Storage Snapshot (mirrors Settings → Data section) ── -->
  <section id="activity-section-storage" data-section="storage" class="space-y-2 scroll-mt-2">
    <h2 class={sectionTitleClass}>
      <Icon name="database" class="w-4 h-4 text-md-primary" />
      {$t('activity.storage')}
    </h2>
    <div class="bg-md-surface-container-low rounded-xl px-3 py-3 border border-md-outline-variant/20">
      <div class="text-xs font-medium text-md-on-surface/60 mb-2">{$t('preferences.storageSnapshotTitle')}</div>
      <div data-activity-grid="storage" class="activity-totals-grid gap-x-3 gap-y-1.5">
        <div class="flex items-center justify-between gap-2 text-xs">
          <span class="text-md-on-surface/60 min-w-0 truncate">{$t('preferences.storageAddresses')}</span>
          <span class="font-medium text-md-on-surface tabular-nums shrink-0">{storageSnapshot.addresses}</span>
        </div>
        <div class="flex items-center justify-between gap-2 text-xs">
          <span class="text-md-on-surface/60 min-w-0 truncate">{$t('preferences.storageEmails')}</span>
          <span class="font-medium text-md-on-surface tabular-nums shrink-0">{storageSnapshot.emails}</span>
        </div>
        <div class="flex items-center justify-between gap-2 text-xs">
          <span class="text-md-on-surface/60 min-w-0 truncate">{$t('preferences.storageIdentities')}</span>
          <span class="font-medium text-md-on-surface tabular-nums shrink-0">{storageSnapshot.identities}</span>
        </div>
        <div class="flex items-center justify-between gap-2 text-xs">
          <span class="text-md-on-surface/60 min-w-0 truncate">{$t('preferences.storageUsed')}</span>
          <span class="font-medium text-md-on-surface tabular-nums shrink-0">{formatBytes(storageSnapshot.bytes)}</span>
        </div>
      </div>

      <!-- Footprint trend -->
      <div class="mt-2 pt-2 border-t border-md-outline-variant/20">
        <div class="text-xs font-medium text-md-on-surface/60 mb-1.5">{$t('activity.storageTrendTitle')}</div>
        {#if storageTrend}
          <div class="flex items-center gap-3">
            <svg viewBox="0 0 100 28" class="w-24 h-7 shrink-0" aria-hidden="true">
              <path
                d={storageTrend.path}
                fill="none"
                stroke={storageTrend.state === 'down' ? 'var(--md-tertiary)' : 'var(--md-primary)'}
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <circle cx={storageTrend.endX} cy={storageTrend.endY} r="2.5" fill="var(--md-primary)" />
            </svg>
            <span
              class="text-xs font-semibold tabular-nums {storageTrend.state === 'up'
                ? 'text-md-error'
                : storageTrend.state === 'down'
                  ? 'text-md-tertiary'
                  : 'text-md-on-surface/60'}"
            >
              {#if storageTrend.state === 'up'}
                {$t('activity.storageTrendUp', { values: { pct: storageTrend.pctRounded } })}
              {:else if storageTrend.state === 'down'}
                {$t('activity.storageTrendDown', { values: { pct: storageTrend.pctRounded } })}
              {:else}
                {$t('activity.storageTrendFlat')}
              {/if}
            </span>
          </div>
        {:else}
          <div class="ui-support text-md-on-surface-variant">{$t('activity.storageTrendEmpty')}</div>
        {/if}
      </div>

      <!-- Per-address breakdown -->
      {#if topAddressesByMail.length > 0}
        <div class="mt-2 pt-2 border-t border-md-outline-variant/20">
          <div class="text-xs font-medium text-md-on-surface/60 mb-1.5">{$t('activity.topAddressesTitle')}</div>
          <div class="space-y-2">
            {#each (addressesExpanded ? topAddressesByMail : topAddressesByMail.slice(0, 5)) as item}
              <div class="space-y-1">
                <div class="flex justify-between items-center gap-2 text-label-sm">
                  <span class="text-md-on-surface truncate font-medium min-w-0">{item.address}</span>
                  <span class="text-md-on-surface/60 font-semibold shrink-0 tabular-nums">
                    {$t('activity.topAddressesCount', { values: { n: item.count } })}
                  </span>
                </div>
                <div class="w-full h-1.5 rounded-full bg-md-outline-variant/20 overflow-hidden">
                  <div
                    class="h-full bg-[var(--md-secondary)] rounded-full transition-all duration-700 ease-out"
                    style="width: {item.percent}%"
                  ></div>
                </div>
              </div>
            {/each}
          </div>
          {#if topAddressesByMail.length > 5}
            <button
              type="button"
              class="mt-2 text-xs font-semibold text-md-primary hover:underline bg-transparent border-0 p-0"
              onclick={() => (addressesExpanded = !addressesExpanded)}
            >
              {addressesExpanded ? $t('activity.showLess') : $t('activity.showMore')}
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </section>

  <!-- ── Activity Timeline ── -->
  <section id="activity-section-feed" data-section="feed" class="space-y-2 scroll-mt-2">
    <h2 class={sectionTitleClass}>
      <Icon name="schedule" class="w-4 h-4 text-md-primary" />
      {$t('activity.recentActivity')}
    </h2>
    <ActivityExplorer events={activityEvents} history={activityHistory} loading={loadingEvents} {chartDay} {chartHour} {chartType} {chartQuery} onClearChart={clearChartFilter} onOpen={onOpenActivityEvent} titleFor={getEventTitle} subtitleFor={getEventSubtitle} iconFor={getEventIcon} timeFor={formatTime} onCopy={copyOtp} />
  </section>

  <!-- ── Since Info ── -->
  {#if analytics.createdAt}
    <div class="bg-md-surface-container-low rounded-xl px-3 py-2.5 border border-md-outline-variant/20">
      <div class="text-xs font-semibold text-md-on-surface/40 mb-1.5">{$t('activity.trackingSince')}</div>
      <div class="text-sm text-md-on-surface">{new Date(analytics.createdAt).toLocaleDateString($locale || 'en')}</div>
    </div>
  {/if}

  <!-- End-of-list spacer keeps the final content clear of the floating navigation. -->
  <div
    class="w-full shrink-0 transition-[height] duration-200 ease-in-out pointer-events-none"
    style="height: calc(var(--bottom-safe-area, 0px) + 12px);"
    aria-hidden="true"
  ></div>

</div>

  <!-- ── Reset Confirmation Dialog ── -->
  <ConfirmDialog
    confirmDialog={resetDialogOpen
      ? {
          title: $t('activity.resetDialogTitle'),
          message: $t('activity.resetDialogBody'),
          confirmLabel: $t('common.reset'),
          onConfirm: handleReset,
          destructive: true,
        }
      : null}
    onClose={() => { resetDialogOpen = false; }}
  />

</div>
{/if}

<!-- Contextual FAB: reload analytics (replaces the old toolbar Refresh pill) -->
<ActivityDashboardDialog open={dashboardOpen} cards={dashboardCards} saving={dashboardSaving} onClose={() => { dashboardOpen = false; }} onChange={saveDashboard} />
<FloatingAction
  kind="refresh"
  icon="refresh"
  labelKey="common.refresh"
  onclick={handleFabRefresh}
/>

<style>
  .activity-card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
    align-items: stretch;
  }
  .activity-totals-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr));
  }
  .activity-card-grid > *,
  .activity-totals-grid > * {
    min-width: 0;
  }
  .activity-full-row { grid-column: 1 / -1; }
</style>
