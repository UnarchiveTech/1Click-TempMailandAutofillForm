<script lang="ts">
import { onMount } from 'svelte';
import { locale, t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/ui/components/icons/Icon.svelte';
import Btn from '@/ui/components/primitives/Btn.svelte';
import { type BrowserDetails, getBrowserDetails } from '@/utils/browser/browser-details.js';
import { localizedErrorMessageOrFallback } from '@/utils/errors.js';
import { logError } from '@/utils/logger.js';
import {
  requestIndexedDbLock,
  requestWebLockWithTimeout,
  type WebLocksLike,
} from '@/utils/mutex.js';
import {
  getNotificationPermissionStatus,
  openNotificationSettingsPage,
} from '@/utils/notifications/notification-permission.js';
import { aggregateCoalescerStats } from '@/utils/perf/coalescer-stats.js';
import { PERF_ENABLED } from '@/utils/perf/perf-marks.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import {
  LAYOUT_SPLIT_MIN,
  LAYOUT_WIDE_MIN,
  NAV_PLUS_ORGANIZE_MIN,
  NAV_SEVEN_MIN,
  NAV_SIX_MIN,
} from '@/utils/ui/breakpoints.js';
import { layoutMetricsStore } from '@/utils/ui/layout-state-store.js';
import { stageForWidth } from '@/utils/ui/nav-layout.js';

type Status = 'ok' | 'warn' | 'fail' | 'pending';

type Check = {
  id: string;
  label: string;
  status: Status;
  detail: string;
};

type ApiCapability = {
  path: string;
  optional: boolean;
  available: boolean;
  impact: ApiImpact;
  permission?: string;
  permissionGranted: boolean | 'unknown' | null;
};

type ApiImpact =
  | 'background'
  | 'savedData'
  | 'sessionData'
  | 'permissionChecks'
  | 'activeTab'
  | 'scheduledTasks'
  | 'notifications'
  | 'pageScripts'
  | 'contextMenu'
  | 'keyboardShortcuts'
  | 'toolbarBadge'
  | 'requestRules'
  | 'notificationSound';

type WebMcpCheckStatus = 'idle' | 'pending' | 'available' | 'unsupported' | 'unavailable';
type SiteAccessStatus =
  | 'checking'
  | 'connected'
  | 'restricted'
  | 'fileAccess'
  | 'permissionMissing'
  | 'requesting'
  | 'denied'
  | 'requestFailed'
  | 'reload'
  | 'reloading'
  | 'reloadFailed';
type SiteAccessTroubleshooter = {
  status: SiteAccessStatus;
  origin: string | null;
  originPattern: string | null;
  tabId: number | null;
};

const API_CAPABILITIES: Array<Pick<ApiCapability, 'path' | 'optional' | 'impact' | 'permission'>> =
  [
    { path: 'browser.runtime.sendMessage', optional: false, impact: 'background' },
    {
      path: 'browser.storage.local.get',
      optional: false,
      impact: 'savedData',
      permission: 'storage',
    },
    {
      path: 'browser.storage.session.get',
      optional: false,
      impact: 'sessionData',
      permission: 'storage',
    },
    { path: 'browser.permissions.getAll', optional: false, impact: 'permissionChecks' },
    { path: 'browser.tabs.query', optional: false, impact: 'activeTab' },
    { path: 'browser.tabs.sendMessage', optional: false, impact: 'activeTab' },
    {
      path: 'browser.alarms.create',
      optional: false,
      impact: 'scheduledTasks',
      permission: 'alarms',
    },
    {
      path: 'browser.alarms.onAlarm.addListener',
      optional: false,
      impact: 'scheduledTasks',
      permission: 'alarms',
    },
    {
      path: 'browser.notifications.create',
      optional: true,
      impact: 'notifications',
      permission: 'notifications',
    },
    {
      path: 'browser.scripting.executeScript',
      optional: true,
      impact: 'pageScripts',
      permission: 'scripting',
    },
    {
      path: 'browser.contextMenus.create',
      optional: true,
      impact: 'contextMenu',
      permission: 'contextMenus',
    },
    {
      path: 'browser.contextMenus.onClicked.addListener',
      optional: true,
      impact: 'contextMenu',
      permission: 'contextMenus',
    },
    {
      path: 'browser.commands.onCommand.addListener',
      optional: true,
      impact: 'keyboardShortcuts',
    },
    { path: 'browser.action.setBadgeText', optional: true, impact: 'toolbarBadge' },
    {
      path: 'browser.declarativeNetRequest.updateSessionRules',
      optional: true,
      impact: 'requestRules',
      permission: 'declarativeNetRequest',
    },
    {
      path: 'browser.offscreen.createDocument',
      optional: true,
      impact: 'notificationSound',
      permission: 'offscreen',
    },
  ];

function hasCallablePath(root: unknown, path: string): boolean {
  try {
    let value = root;
    for (const segment of path.split('.')) {
      if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
        return false;
      }
      value = Reflect.get(value, segment);
    }
    return typeof value === 'function';
  } catch {
    return false;
  }
}

function readApiCapabilities(): ApiCapability[] {
  return API_CAPABILITIES.map(({ path, optional, impact, permission }) => ({
    path,
    optional,
    impact,
    permission,
    permissionGranted: null,
    available: hasCallablePath({ browser }, path),
  }));
}

function getApiImpactLabel(impact: ApiImpact): string {
  switch (impact) {
    case 'background':
      return $t('diagnostics.apiImpacts.background');
    case 'savedData':
      return $t('diagnostics.apiImpacts.savedData');
    case 'sessionData':
      return $t('diagnostics.apiImpacts.sessionData');
    case 'permissionChecks':
      return $t('diagnostics.apiImpacts.permissionChecks');
    case 'activeTab':
      return $t('diagnostics.apiImpacts.activeTab');
    case 'scheduledTasks':
      return $t('diagnostics.apiImpacts.scheduledTasks');
    case 'notifications':
      return $t('diagnostics.apiImpacts.notifications');
    case 'pageScripts':
      return $t('diagnostics.apiImpacts.pageScripts');
    case 'contextMenu':
      return $t('diagnostics.apiImpacts.contextMenu');
    case 'keyboardShortcuts':
      return $t('diagnostics.apiImpacts.keyboardShortcuts');
    case 'toolbarBadge':
      return $t('diagnostics.apiImpacts.toolbarBadge');
    case 'requestRules':
      return $t('diagnostics.apiImpacts.requestRules');
    case 'notificationSound':
      return $t('diagnostics.apiImpacts.notificationSound');
  }
}

function getApiStatusLabel(api: ApiCapability): string {
  if (!api.available) {
    return api.optional
      ? $t('diagnostics.apiOptionalUnavailable')
      : $t('diagnostics.apiRequiredUnavailable');
  }
  if (api.permission && api.permissionGranted === null) return $t('diagnostics.apiChecking');
  if (api.permission && api.permissionGranted === 'unknown') {
    return $t('diagnostics.apiPermissionCheckFailed');
  }
  if (api.permission && api.permissionGranted === false) {
    return $t('diagnostics.apiPermissionMissing');
  }
  return $t('diagnostics.apiAvailable');
}

function getApiStatusColor(api: ApiCapability): string {
  if (!api.available) return api.optional ? 'text-md-warning' : 'text-md-error';
  if (api.permission && api.permissionGranted === 'unknown') return 'text-md-on-surface/40';
  if (api.permission && api.permissionGranted === false) return 'text-md-warning';
  if (api.permission && api.permissionGranted === null) return 'text-md-on-surface/40';
  return 'text-md-success';
}

function getSiteAccessMessage(status: SiteAccessStatus): string {
  switch (status) {
    case 'checking':
      return $t('diagnostics.siteAccessChecking');
    case 'connected':
      return $t('diagnostics.siteAccessConnected');
    case 'restricted':
      return $t('diagnostics.siteAccessRestricted');
    case 'fileAccess':
      return $t('diagnostics.siteAccessFileUrl');
    case 'permissionMissing':
      return $t('diagnostics.siteAccessMissing');
    case 'requesting':
      return $t('diagnostics.siteAccessRequesting');
    case 'denied':
      return $t('diagnostics.siteAccessDenied');
    case 'requestFailed':
      return $t('diagnostics.siteAccessRequestFailed');
    case 'reload':
      return $t('diagnostics.siteAccessReload');
    case 'reloading':
      return $t('diagnostics.siteAccessReloading');
    case 'reloadFailed':
      return $t('diagnostics.siteAccessReloadFailed');
  }
}

function getSiteAccessMessageColor(status: SiteAccessStatus): string {
  if (status === 'connected') return 'text-md-success';
  if (status === 'permissionMissing' || status === 'denied' || status === 'requestFailed') {
    return 'text-md-warning';
  }
  if (status === 'reload' || status === 'reloadFailed') return 'text-md-warning';
  return 'text-md-on-surface/60';
}

async function checkActivePageWebMcp() {
  webMcpCheckStatus = 'pending';
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) {
      webMcpCheckStatus = 'unavailable';
      return;
    }

    const [result] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        const doc = document as Document & {
          modelContext?: { registerTool?: unknown };
        };
        const nav = navigator as Navigator & {
          modelContext?: { registerTool?: unknown };
        };
        return (
          typeof doc.modelContext?.registerTool === 'function' ||
          typeof nav.modelContext?.registerTool === 'function'
        );
      },
    });
    webMcpCheckStatus = result?.result === true ? 'available' : 'unsupported';
  } catch {
    // Restricted pages and missing host permission mean this page cannot be inspected.
    webMcpCheckStatus = 'unavailable';
  }
}

function getSiteOriginPermission(url: string): { origin: string; pattern: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return {
      origin: parsed.origin,
      pattern: `${parsed.protocol}//${parsed.hostname}/*`,
    };
  } catch {
    return null;
  }
}

async function requestActiveSiteAccess() {
  const previous = siteAccess;
  if (!previous?.originPattern) return;
  const originPattern = previous.originPattern;
  siteAccess = { ...previous, status: 'requesting' };
  try {
    const granted = await browser.permissions.request({ origins: [originPattern] });
    siteAccess = { ...previous, status: granted ? 'reload' : 'denied' };
    setCheck(
      'content',
      'warn',
      granted ? $t('diagnostics.siteAccessReload') : $t('diagnostics.siteAccessDenied')
    );
  } catch (error) {
    logError('Diagnostics: site permission request failed', error);
    siteAccess = { ...previous, status: 'requestFailed' };
    setCheck('content', 'warn', $t('diagnostics.siteAccessRequestFailed'));
  }
}

async function reloadActiveSite() {
  const previous = siteAccess;
  if (!previous || previous.tabId == null) return;
  const tabId = previous.tabId;
  siteAccess = { ...previous, status: 'reloading' };
  try {
    await browser.tabs.reload(tabId);
  } catch (error) {
    logError('Diagnostics: active site reload failed', error);
    siteAccess = { ...previous, status: 'reloadFailed' };
    setCheck('content', 'warn', $t('diagnostics.siteAccessReloadFailed'));
  }
}

let checks = $state<Check[]>([]);
let apiCapabilities = $state<ApiCapability[]>([]);
let webMcpCheckStatus = $state<WebMcpCheckStatus>('idle');
let siteAccess = $state<SiteAccessTroubleshooter | null>(null);
let running = $state(true);
let lastRun = $state<number | null>(null);
let browserDetails = $state<BrowserDetails | null>(null);
let browserDetailsLoading = $state(true);

async function loadBrowserDetails() {
  browserDetailsLoading = true;
  try {
    browserDetails = await getBrowserDetails();
  } catch (error) {
    logError('Diagnostics: browser information lookup failed', error);
    browserDetails = { name: null, version: null, chromiumVersion: null };
  } finally {
    browserDetailsLoading = false;
  }
}

/** Live layout metrics published by AppLayout's updateWide (single owner). */
let metrics = $derived($layoutMetricsStore);
let navStage = $derived(stageForWidth(metrics.width));
/** Human label for the current nav stage (localized via diagnostics.navStage.*). */
let navStageLabel = $derived.by(() => {
  switch (navStage) {
    case 'seven':
      return $t('diagnostics.navStage.seven');
    case 'six':
      return $t('diagnostics.navStage.six');
    case 'plus_organize':
      return $t('diagnostics.navStage.plusOrganize');
    default:
      return $t('diagnostics.navStage.compact');
  }
});

let testNotifyBusy = $state(false);
let testNotifyResult = $state('');
/** True when the browser blocked notifications - result renders as a clickable warning. */
let notificationsBlocked = $state(false);
let voiceListening = $state(false);
let voiceResult = $state('');
let voiceSupported = $state(false);
let voiceRec: {
  stop: () => void;
  start: () => void;
  onresult:
    | ((ev: {
        resultIndex: number;
        results: ArrayLike<{ isFinal?: boolean; 0?: { transcript?: string } }>;
      }) => void)
    | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
} | null = null;

function getSpeechRecognitionCtor(): (new () => NonNullable<typeof voiceRec>) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => NonNullable<typeof voiceRec>;
    webkitSpeechRecognition?: new () => NonNullable<typeof voiceRec>;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function setCheck(id: string, status: Status, detail: string, label?: string) {
  const idx = checks.findIndex((c) => c.id === id);
  const item: Check = {
    id,
    label: label || checks[idx]?.label || id,
    status,
    detail,
  };
  if (idx === -1) checks = [...checks, item];
  else {
    const next = [...checks];
    next[idx] = item;
    checks = next;
  }
}

async function runDiagnostics() {
  running = true;
  webMcpCheckStatus = 'idle';
  siteAccess = null;
  apiCapabilities = readApiCapabilities();
  checks = [
    { id: 'sw', label: $t('diagnostics.checks.serviceWorker'), status: 'pending', detail: '…' },
    { id: 'perms', label: $t('diagnostics.checks.permissions'), status: 'pending', detail: '…' },
    {
      id: 'hosts',
      label: $t('diagnostics.checks.hostPermissions'),
      status: 'pending',
      detail: '…',
    },
    {
      id: 'content',
      label: $t('diagnostics.checks.contentScripts'),
      status: 'pending',
      detail: '…',
    },
    { id: 'storage', label: $t('diagnostics.checks.storage'), status: 'pending', detail: '…' },
    { id: 'mutex', label: $t('diagnostics.checks.mutex'), status: 'pending', detail: '…' },
    { id: 'messaging', label: $t('diagnostics.checks.messaging'), status: 'pending', detail: '…' },
    { id: 'network', label: $t('diagnostics.checks.network'), status: 'pending', detail: '…' },
    { id: 'errors', label: $t('diagnostics.checks.errors'), status: 'pending', detail: '…' },
    { id: 'hover', label: $t('diagnostics.checks.hover'), status: 'pending', detail: '…' },
  ];

  // 1) Service worker / background
  try {
    const ping = (await browser.runtime.sendMessage({ type: 'getProvider' })) as {
      success?: boolean;
      provider?: string;
      error?: string;
    };
    if (ping?.success) {
      setCheck(
        'sw',
        'ok',
        $t('diagnostics.details.swOk', { values: { provider: ping.provider || '-' } })
      );
    } else {
      // The background payload is opaque English prose - log it, never render it.
      logError('Diagnostics: background ping failed', ping?.error);
      setCheck('sw', 'fail', $t('diagnostics.details.swFail'));
    }
  } catch (e) {
    logError('Diagnostics: service worker check failed', e);
    setCheck('sw', 'fail', localizedErrorMessageOrFallback(e, $t, 'diagnostics.details.swFail'));
  }

  // 2) Permissions
  try {
    const perms = await browser.permissions.getAll();
    const list = (perms.permissions || []).join(', ') || '-';
    const grantedPermissions = new Set<string>(perms.permissions || []);
    apiCapabilities = apiCapabilities.map((api) => ({
      ...api,
      permissionGranted: api.permission ? grantedPermissions.has(api.permission) : null,
    }));
    setCheck('perms', 'ok', list);
  } catch (e) {
    logError('Diagnostics: permissions check failed', e);
    apiCapabilities = apiCapabilities.map((api) => ({
      ...api,
      permissionGranted: api.permission ? 'unknown' : null,
    }));
    setCheck(
      'perms',
      'warn',
      localizedErrorMessageOrFallback(e, $t, 'diagnostics.details.checkFailed')
    );
  }

  // 3) Host permissions
  try {
    const perms = await browser.permissions.getAll();
    const origins = perms.origins || [];
    if (origins.length === 0) {
      setCheck('hosts', 'warn', $t('diagnostics.details.noHosts'));
    } else {
      setCheck(
        'hosts',
        'ok',
        origins.slice(0, 8).join(', ') + (origins.length > 8 ? ` (+${origins.length - 8})` : '')
      );
    }
  } catch (e) {
    logError('Diagnostics: host permissions check failed', e);
    setCheck(
      'hosts',
      'fail',
      localizedErrorMessageOrFallback(e, $t, 'diagnostics.details.checkFailed')
    );
  }

  // 4) Content scripts on active tab
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null || !tab.url || !/^https?:/i.test(tab.url)) {
      siteAccess = {
        status: tab?.url?.startsWith('file:') ? 'fileAccess' : 'restricted',
        origin: null,
        originPattern: null,
        tabId: tab?.id ?? null,
      };
      setCheck('content', 'warn', $t('diagnostics.details.noHttpTab'));
    } else {
      const sitePermission = getSiteOriginPermission(tab.url);
      const currentSiteAccess: SiteAccessTroubleshooter = {
        status: 'checking',
        origin: sitePermission?.origin ?? null,
        originPattern: sitePermission?.pattern ?? null,
        tabId: tab.id,
      };
      siteAccess = currentSiteAccess;
      let hasSitePermission: boolean | null = null;
      if (sitePermission) {
        try {
          hasSitePermission = await browser.permissions.contains({
            origins: [sitePermission.pattern],
          });
        } catch (error) {
          logError('Diagnostics: active site permission check failed', error);
        }
      }

      try {
        const res = (await browser.tabs.sendMessage(tab.id, {
          type: 'checkFormDetected',
        })) as { formDetected?: boolean };
        siteAccess = { ...currentSiteAccess, status: 'connected' };
        setCheck(
          'content',
          'ok',
          $t('diagnostics.details.contentOk', {
            values: { form: res?.formDetected ? $t('common.yes') : $t('common.no') },
          })
        );
      } catch {
        if (hasSitePermission === false && sitePermission) {
          siteAccess = { ...currentSiteAccess, status: 'permissionMissing' };
          setCheck('content', 'warn', $t('diagnostics.siteAccessMissing'));
        } else {
          siteAccess = { ...currentSiteAccess, status: 'reload' };
          setCheck('content', 'fail', $t('diagnostics.details.contentFail'));
        }
      }
    }
  } catch (e) {
    logError('Diagnostics: content-script check failed', e);
    siteAccess = {
      status: 'restricted',
      origin: null,
      originPattern: null,
      tabId: null,
    };
    setCheck(
      'content',
      'warn',
      localizedErrorMessageOrFallback(e, $t, 'diagnostics.details.contentFail')
    );
  }

  // 5) Storage
  try {
    const key = `_diag_${Date.now()}`;
    await writeWithRetry({ [key]: 1 });
    await browser.storage.local.remove(key);
    try {
      await browser.storage.session?.set?.({ [key]: 1 });
      await browser.storage.session?.remove?.(key);
      setCheck('storage', 'ok', $t('diagnostics.details.storageOk'));
    } catch {
      /* ignore */
      setCheck('storage', 'warn', $t('diagnostics.details.storageSessionWarn'));
    }
  } catch (e) {
    logError('Diagnostics: storage check failed', e);
    setCheck(
      'storage',
      'fail',
      localizedErrorMessageOrFallback(e, $t, 'diagnostics.details.storageFail')
    );
  }

  // 6) Cross-context mutex: exercise Web Locks when exposed, otherwise verify
  // the IndexedDB fallback used by withLock in browsers without that API.
  try {
    const webLocks = (globalThis as { navigator?: { locks?: WebLocksLike } }).navigator?.locks;
    let callbackRan = false;
    if (webLocks && typeof webLocks.request === 'function') {
      await requestWebLockWithTimeout(
        webLocks,
        `diagnostics_mutex_probe_${Date.now()}`,
        async () => {
          callbackRan = true;
          return true;
        },
        3_000
      );
      if (!callbackRan) throw new Error('Web Locks probe did not execute');
      setCheck('mutex', 'ok', $t('diagnostics.details.mutexWebLocksOk'));
    } else {
      await requestIndexedDbLock(
        `diagnostics_mutex_probe_${Date.now()}`,
        async () => {
          callbackRan = true;
          return true;
        },
        3_000
      );
      if (!callbackRan) throw new Error('IndexedDB mutex probe did not execute');
      setCheck('mutex', 'ok', $t('diagnostics.details.mutexFallbackOk'));
    }
  } catch (e) {
    logError('Diagnostics: cross-context mutex check failed', e);
    setCheck('mutex', 'fail', $t('diagnostics.details.mutexFail'));
  }

  // 7) Messaging
  try {
    const res = (await browser.runtime.sendMessage({ type: 'getAddresses' })) as {
      success?: boolean;
      addresses?: unknown[];
      error?: string;
    };
    if (res?.success) {
      setCheck(
        'messaging',
        'ok',
        $t('diagnostics.details.messagingOk', {
          values: { n: Array.isArray(res.addresses) ? res.addresses.length : 0 },
        })
      );
    } else {
      logError('Diagnostics: getAddresses failed', res?.error);
      setCheck('messaging', 'fail', $t('diagnostics.details.messagingFail'));
    }
  } catch (e) {
    logError('Diagnostics: messaging check failed', e);
    setCheck(
      'messaging',
      'fail',
      localizedErrorMessageOrFallback(e, $t, 'diagnostics.details.messagingFail')
    );
  }

  // 8) Network
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const resp = await fetch('https://www.google.com/generate_204', {
        method: 'GET',
        signal: ctrl.signal,
        cache: 'no-store',
      });
      if (resp.ok || resp.status === 204) {
        setCheck('network', 'ok', $t('diagnostics.details.networkOk'));
      } else {
        setCheck('network', 'warn', `HTTP ${resp.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    logError('Diagnostics: network check failed', e);
    setCheck(
      'network',
      'fail',
      localizedErrorMessageOrFallback(e, $t, 'diagnostics.details.networkFail')
    );
  }

  // 9) Errors
  try {
    const res = (await browser.storage.local.get(['_last_extension_error', 'enableLogging'])) as {
      _last_extension_error?: { message?: string; at?: number };
      enableLogging?: boolean;
    };
    if (res._last_extension_error?.message) {
      setCheck(
        'errors',
        'warn',
        `${$t('diagnostics.details.errorsRecorded')}${res._last_extension_error.at ? ` (${new Date(res._last_extension_error.at).toLocaleString($locale || 'en')})` : ''}`
      );
    } else {
      setCheck(
        'errors',
        'ok',
        res.enableLogging
          ? $t('diagnostics.details.errorsNoneLoggingOn')
          : $t('diagnostics.details.errorsNone')
      );
    }
  } catch (e) {
    logError('Diagnostics: stored-error check failed', e);
    setCheck(
      'errors',
      'warn',
      localizedErrorMessageOrFallback(e, $t, 'diagnostics.details.checkFailed')
    );
  }

  // Hover / fine pointer capability (affects hover-only UI like action peek)
  try {
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const anyHover = window.matchMedia('(hover: hover)').matches;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    if (fine) {
      setCheck('hover', 'ok', $t('diagnostics.details.hoverFine'));
    } else if (anyHover) {
      setCheck('hover', 'warn', $t('diagnostics.details.hoverLimited'));
    } else {
      setCheck(
        'hover',
        'warn',
        coarse ? $t('diagnostics.details.hoverNoneTouch') : $t('diagnostics.details.hoverNone')
      );
    }
  } catch (e) {
    logError('Diagnostics: hover capability check failed', e);
    setCheck(
      'hover',
      'warn',
      localizedErrorMessageOrFallback(e, $t, 'diagnostics.details.hoverNone')
    );
  }

  lastRun = Date.now();
  running = false;
}

async function sendTestNotification() {
  testNotifyBusy = true;
  testNotifyResult = '';
  notificationsBlocked = false;
  try {
    // Check the browser/OS permission level first - when the user blocked
    // notifications for this extension, creating one would silently no-op.
    const permission = await getNotificationPermissionStatus();
    if (permission === 'denied') {
      notificationsBlocked = true;
      testNotifyResult = $t('diagnostics.testNotificationBlocked');
      return;
    }
    const id = `diag_test_${Date.now()}`;
    const runtime = browser.runtime as { getURL?: (path: string) => string };
    await browser.notifications.create(id, {
      type: 'basic',
      iconUrl:
        typeof runtime.getURL === 'function'
          ? runtime.getURL('/icons/icon128.png')
          : 'icons/icon128.png',
      title: $t('diagnostics.testNotificationTitle'),
      message: $t('diagnostics.testNotificationBody'),
    });
    testNotifyResult = $t('diagnostics.testNotificationOk');
    setTimeout(() => {
      void browser.notifications.clear(id).catch(() => {});
    }, 8000);
  } catch (e) {
    logError('Diagnostics: test notification failed', e);
    testNotifyResult = $t('diagnostics.testNotificationFail');
  } finally {
    testNotifyBusy = false;
  }
}

async function handleOpenNotificationSettings() {
  const opened = await openNotificationSettingsPage();
  if (!opened) {
    // Browser blocked the chrome:// / about: navigation - give manual steps.
    testNotifyResult = $t('diagnostics.testNotificationSettingsManual');
  }
}

// ── Dev-only perf report (perf-marks ring buffer, merged contexts) ──────
interface PerfReportMark {
  name: string;
  at: number;
  durMs: number;
  meta?: Record<string, string | number | boolean>;
}
interface PerfReportRow extends PerfReportMark {
  context: string;
}
// ── Dev-only: content→background message counters (per page load) ──────
interface MessageCountEntry {
  type: string;
  count: number;
  lastAt: number;
}

let msgCountRows = $state<MessageCountEntry[]>([]);
let msgCountPage = $state('');
let msgCountTotal = $state(0);

// ── Dev-only: read-coalescer hit rate (bg.readCoalesced / bg.readRun marks) ──
interface CoalescerStatRow {
  family: string;
  hits: number;
  runs: number;
  hitRate: number;
}

let coalescerRows = $state<CoalescerStatRow[]>([]);

function applyMessageCounts(counts: unknown): void {
  if (!counts || typeof counts !== 'object') {
    msgCountRows = [];
    msgCountPage = '';
    msgCountTotal = 0;
    return;
  }
  const c = counts as { page?: unknown; total?: unknown; entries?: unknown };
  msgCountPage = typeof c.page === 'string' ? c.page : '';
  msgCountTotal = typeof c.total === 'number' ? c.total : 0;
  msgCountRows = Array.isArray(c.entries)
    ? c.entries.filter(
        (e): e is MessageCountEntry =>
          !!e && typeof e === 'object' && typeof (e as MessageCountEntry).type === 'string'
      )
    : [];
}

let perfRows = $state<PerfReportRow[]>([]);
let perfLoading = $state(false);
let perfLoadError = $state(false);

async function loadPerfReport(): Promise<void> {
  perfLoading = true;
  perfLoadError = false;
  try {
    const res = (await browser.runtime.sendMessage({ type: 'getPerfReport' })) as
      | {
          success?: boolean;
          swMarks?: PerfReportMark[];
          tabMarks?: Array<{ context: string; mark: PerfReportMark }>;
          tabCounts?: unknown;
        }
      | undefined;
    if (!res?.success) {
      perfLoadError = true;
      perfRows = [];
      coalescerRows = [];
      applyMessageCounts(null);
      return;
    }
    const rows: PerfReportRow[] = [];
    for (const mark of res.swMarks ?? []) rows.push({ ...mark, context: 'sw' });
    for (const entry of res.tabMarks ?? []) {
      if (entry?.mark) rows.push({ ...entry.mark, context: entry.context });
    }
    rows.sort((a, b) => a.at - b.at);
    perfRows = rows.slice(-100);
    // Hit-rate stat aggregates the FULL rings, not the last-100 slice shown
    // above: the coalescer counters are tiny (one mark per read) and the
    // interesting signal is the whole page load, not the newest marks.
    coalescerRows = aggregateCoalescerStats([
      ...(res.swMarks ?? []),
      ...(res.tabMarks ?? []).map((e) => e?.mark).filter((m): m is PerfReportMark => !!m),
    ]).map((s) => ({ ...s }));
    applyMessageCounts(res.tabCounts);
  } catch {
    perfLoadError = true;
    perfRows = [];
    coalescerRows = [];
    applyMessageCounts(null);
  } finally {
    perfLoading = false;
  }
}

function perfRowLabel(row: PerfReportRow): string {
  const ctx =
    row.context === 'sw' ? $t('diagnostics.perf.contextSw') : $t('diagnostics.perf.contextContent');
  const dur =
    row.durMs > 0
      ? $t('diagnostics.perf.span', { values: { ms: row.durMs } })
      : $t('diagnostics.perf.point');
  const meta = row.meta
    ? Object.entries(row.meta)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(' ')
    : '';
  return meta ? `${ctx} · ${row.name} · ${dur} · ${meta}` : `${ctx} · ${row.name} · ${dur}`;
}

function stopVoiceTest() {
  try {
    voiceRec?.stop();
  } catch {
    /* ignore */
  }
  voiceListening = false;
}

function startVoiceTest() {
  if (voiceListening) {
    stopVoiceTest();
    return;
  }
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    voiceSupported = false;
    voiceResult = $t('diagnostics.voiceUnsupported');
    return;
  }
  voiceResult = $t('diagnostics.voiceListening');
  const rec = new Ctor();
  voiceRec = rec;
  rec.continuous = false;
  rec.interimResults = true;
  rec.lang = document.documentElement.lang || navigator.language || 'en-US';
  rec.onend = () => {
    voiceListening = false;
  };
  rec.onerror = () => {
    voiceListening = false;
    voiceResult = $t('diagnostics.voiceFail');
  };
  rec.onresult = (event) => {
    let transcript = '';
    let isFinal = false;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const row = event.results[i];
      transcript += row[0]?.transcript || '';
      if (row.isFinal) isFinal = true;
    }
    const text = transcript.trim();
    if (!text) return;
    voiceResult = isFinal ? $t('diagnostics.voiceHeard', { values: { text } }) : text;
  };
  try {
    rec.start();
    voiceListening = true;
  } catch {
    /* ignore */
    voiceListening = false;
    voiceResult = $t('diagnostics.voiceFail');
  }
}

onMount(() => {
  voiceSupported = !!getSpeechRecognitionCtor();
  void runDiagnostics();
  void loadBrowserDetails();
  if (PERF_ENABLED) void loadPerfReport();
  return () => stopVoiceTest();
});

function statusColor(s: Status): string {
  if (s === 'ok') return 'text-md-success';
  if (s === 'warn') return 'text-md-warning';
  if (s === 'fail') return 'text-md-error';
  return 'text-md-on-surface/40';
}

function statusLabel(s: Status): string {
  if (s === 'ok') return $t('diagnostics.status.ok');
  if (s === 'warn') return $t('diagnostics.status.warn');
  if (s === 'fail') return $t('diagnostics.status.fail');
  return $t('diagnostics.status.pending');
}
</script>

<div class="scroll-frame flex flex-col h-full min-h-0">
  <!-- Title + actions - back lives in app header on this deep page -->
  <div class="scroll-edge py-3 border-b border-md-outline-variant/30 flex items-center gap-2 shrink-0">
    <h2 class="flex-1 min-w-0 text-sm font-bold text-md-on-surface">
      {$t('diagnostics.title')}
      <span class="block text-xs font-normal text-md-on-surface/50">{$t('diagnostics.subtitle')}</span>
    </h2>
    <button
      type="button"
      class="px-3 py-2 ui-label rounded-lg bg-md-primary text-md-on-primary disabled:opacity-50"
      disabled={running}
      onclick={() => void runDiagnostics()}
    >
      {running ? $t('diagnostics.running') : $t('diagnostics.rerun')}
    </button>
  </div>

  <div class="scroll-body scroll-body-framed flex-1 overflow-y-auto py-3 space-y-2">
    <div class="rounded-xl border border-md-outline-variant/30 bg-md-surface-container-low px-3 py-3 space-y-2">
      <div class="flex items-center gap-2">
        <Icon name="info" class="w-4 h-4 shrink-0 text-md-on-surface/50" />
        <span class="text-xs font-bold text-md-on-surface/50 flex-1">
          {$t('diagnostics.browserInfoTitle')}
        </span>
      </div>
      <div class="grid grid-cols-2 gap-x-3 gap-y-1.5 ui-support">
        <div class="text-md-on-surface/50">{$t('diagnostics.browserName')}</div>
        <div class="text-md-on-surface text-end break-words">
          {browserDetailsLoading
            ? $t('diagnostics.browserInfoLoading')
            : browserDetails?.name || $t('diagnostics.browserInfoUnavailable')}
        </div>
        <div class="text-md-on-surface/50">{$t('diagnostics.browserVersion')}</div>
        <div class="text-md-on-surface text-end font-mono break-words">
          {browserDetailsLoading
            ? $t('diagnostics.browserInfoLoading')
            : browserDetails?.version || $t('diagnostics.browserInfoUnavailable')}
        </div>
        {#if browserDetails?.chromiumVersion}
          <div class="text-md-on-surface/50">{$t('diagnostics.chromiumVersion')}</div>
          <div class="text-md-on-surface text-end font-mono break-words">
            {browserDetails.chromiumVersion}
          </div>
        {/if}
      </div>
      <p class="text-xs text-md-on-surface/40 leading-snug">
        {$t('diagnostics.browserInfoNote')}
      </p>
    </div>

    <section
      class="rounded-xl border border-md-outline-variant/30 bg-md-surface-container-low px-3 py-3 space-y-2"
      aria-labelledby="diagnostics-api-title"
    >
      <div class="flex items-center gap-2">
        <Icon name="info" class="w-4 h-4 shrink-0 text-md-on-surface/50" />
        <h3 id="diagnostics-api-title" class="text-xs font-bold text-md-on-surface/50 flex-1">
          {$t('diagnostics.apiSupportTitle')}
        </h3>
      </div>
      <p class="text-xs text-md-on-surface/45 leading-snug">
        {$t('diagnostics.apiSupportNote')}
      </p>
      <ul class="space-y-1.5" aria-label={$t('diagnostics.apiSupportTitle')}>
        {#each apiCapabilities as api (api.path)}
          <li class="space-y-1 ui-support">
            <div class="flex items-start gap-2">
              <span class="min-w-0 flex-1 font-mono text-xs text-md-on-surface-variant break-all">
                {api.path}
              </span>
              <span class="shrink-0 text-end text-xs font-semibold {getApiStatusColor(api)}">
                {getApiStatusLabel(api)}
              </span>
            </div>
            <p class="text-xs text-md-on-surface-variant">
              {$t('diagnostics.apiAffectedFeature')}: {getApiImpactLabel(api.impact)}
            </p>
            {#if api.permissionGranted === false}
              <p class="text-sm text-md-warning">{$t('diagnostics.apiPermissionHelp')}</p>
            {/if}
          </li>
        {/each}
      </ul>
      <div class="border-t border-md-outline-variant/20 pt-2 space-y-1.5">
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="min-w-0 flex-1 font-mono text-xs text-md-on-surface-variant break-all">
            WebMCP · document.modelContext / navigator.modelContext
          </span>
          <Btn
            variant="tonal"
            class="shrink-0"
            disabled={webMcpCheckStatus === 'pending'}
            onclick={() => void checkActivePageWebMcp()}
          >
            {webMcpCheckStatus === 'pending'
              ? $t('diagnostics.webMcpChecking')
              : $t('diagnostics.webMcpCheckPage')}
          </Btn>
        </div>
        {#if webMcpCheckStatus !== 'idle'}
          <p
            class="text-sm {webMcpCheckStatus === 'available'
              ? 'text-md-success'
              : webMcpCheckStatus === 'unsupported'
                ? 'text-md-warning'
                : 'text-md-on-surface/55'}"
            aria-live="polite"
          >
            {webMcpCheckStatus === 'pending'
              ? $t('diagnostics.webMcpChecking')
              : webMcpCheckStatus === 'available'
                ? $t('diagnostics.webMcpAvailable')
                : webMcpCheckStatus === 'unsupported'
                  ? $t('diagnostics.webMcpUnsupported')
                  : $t('diagnostics.webMcpUnavailable')}
          </p>
        {/if}
      </div>
    </section>

    <!-- Live layout / breakpoint ladder readout -->
    <div class="rounded-xl border border-md-outline-variant/30 bg-md-surface-container-low px-3 py-3 space-y-2">
      <div class="flex items-center gap-2">
        <Icon name="monitor" class="w-4 h-4 shrink-0 text-md-on-surface/50" />
        <span class="text-xs font-bold text-md-on-surface/50 flex-1">
          {$t('diagnostics.layoutTitle')}
        </span>
        <span class="text-xs font-semibold text-md-on-surface/40" aria-live="polite">
          {$t('diagnostics.layoutLive')}
        </span>
      </div>
      <div class="grid grid-cols-2 gap-x-3 gap-y-1.5 ui-support">
        <div class="text-md-on-surface/50">{$t('diagnostics.layoutWidth')}</div>
        <div class="text-md-on-surface font-semibold text-end font-mono" aria-live="polite">
          {Math.round(metrics.width)}px
        </div>
        <div class="text-md-on-surface/50">{$t('diagnostics.layoutContext')}</div>
        <div class="text-md-on-surface text-end">{metrics.context}</div>
        <div class="text-md-on-surface/50">{$t('diagnostics.layoutNavStage')}</div>
        <div class="text-md-on-surface text-end" aria-live="polite">{navStageLabel}</div>
        <div class="text-md-on-surface/50">{$t('diagnostics.layoutWide')}</div>
        <div
          class="text-end font-semibold {metrics.layoutWide ? 'text-md-success' : 'text-md-on-surface/60'}"
          aria-live="polite"
        >
          {metrics.layoutWide ? $t('common.on') : $t('common.off')}
        </div>
        <div class="text-md-on-surface/50">{$t('diagnostics.layoutSplit')}</div>
        <div
          class="text-end font-semibold {metrics.layoutSplit ? 'text-md-success' : 'text-md-on-surface/60'}"
          aria-live="polite"
        >
          {metrics.layoutSplit ? $t('common.on') : $t('common.off')}
        </div>
        <div class="text-md-on-surface/50">{$t('diagnostics.layoutVerticalSplit')}</div>
        <div
          class="text-end font-semibold {metrics.layoutVerticalSplit ? 'text-md-success' : 'text-md-on-surface/60'}"
          aria-live="polite"
        >
          {metrics.layoutVerticalSplit ? $t('common.on') : $t('common.off')}
        </div>
      </div>
      <p class="text-xs text-md-on-surface/40 leading-snug">
        {$t('diagnostics.layoutThresholds', {
          values: {
            wide: LAYOUT_WIDE_MIN,
            split: LAYOUT_SPLIT_MIN,
            navPlusOrganize: NAV_PLUS_ORGANIZE_MIN,
            navSix: NAV_SIX_MIN,
            navSeven: NAV_SEVEN_MIN,
          },
        })}
      </p>
    </div>

    {#if PERF_ENABLED}
      <!-- Dev-only: perf marks from the SW + active tab ring buffers -->
      <div class="rounded-xl border border-md-outline-variant/30 bg-md-surface-container-low px-3 py-3 space-y-2">
        <div class="flex items-center gap-2">
          <Icon name="barChart" class="w-4 h-4 shrink-0 text-md-on-surface/50" />
          <span class="text-xs font-bold text-md-on-surface/50 flex-1">
            {$t('diagnostics.perf.title')}
          </span>
          <button
            type="button"
            class="px-3 py-2 ui-label rounded-lg border border-md-outline-variant/40 text-md-on-surface-variant hover:bg-md-surface-variant/40 active:bg-md-surface-variant/60 transition-colors"
            disabled={perfLoading}
            onclick={() => void loadPerfReport()}
          >
            {perfLoading ? $t('diagnostics.perf.loading') : $t('common.refresh')}
          </button>
        </div>
        {#if perfLoadError}
          <p class="text-sm text-md-warning px-1">{$t('diagnostics.perf.error')}</p>
        {:else if perfRows.length === 0}
          <p class="ui-support text-md-on-surface-variant px-1">{$t('diagnostics.perf.empty')}</p>
        {:else}
          <div class="max-h-56 overflow-y-auto rounded-lg bg-md-surface/60 px-2 py-1.5">
            <ul class="space-y-1 font-mono text-xs text-md-on-surface-variant">
              {#each perfRows as row, i (row.context + row.name + row.at + i)}
                <li class="break-all whitespace-pre-wrap">{perfRowLabel(row)}</li>
              {/each}
            </ul>
          </div>
          <p class="text-xs text-md-on-surface-variant px-1">{$t('diagnostics.perf.hint')}</p>
        {/if}

        <!-- Dev-only: per-page-load content→background message counters -->
        <div class="space-y-1 px-1 pt-1 border-t border-md-outline-variant/20">
          <p class="text-sm font-medium text-md-on-surface">
            {$t('diagnostics.perf.msgsTitle')}
          </p>
          <!-- Read-coalescer hit rate: bg.readCoalesced (shared runs) vs bg.readRun (misses) -->
          <div class="space-y-1 px-1 pt-1 border-t border-md-outline-variant/20">
            <p class="text-sm font-medium text-md-on-surface">
              {$t('diagnostics.perf.coalescerTitle')}
            </p>
            {#if coalescerRows.length === 0}
              <p class="text-xs text-md-on-surface-variant">
                {$t('diagnostics.perf.coalescerEmpty')}
              </p>
            {:else}
              <ul class="font-mono text-xs text-md-on-surface-variant">
                {#each coalescerRows as row (row.family)}
                  <li class="break-all">
                    {$t('diagnostics.perf.coalescerRow', {
                      values: {
                        family: row.family,
                        pct: Math.round(row.hitRate * 100),
                        hits: row.hits,
                        runs: row.runs,
                      },
                    })}
                  </li>
                {/each}
              </ul>
              <p class="text-xs text-md-on-surface-variant">
                {$t('diagnostics.perf.coalescerHint')}
              </p>
            {/if}
          </div>

          {#if msgCountRows.length === 0}
            <p class="text-xs text-md-on-surface-variant">{$t('diagnostics.perf.msgsEmpty')}</p>
          {:else}
            <p class="text-xs text-md-on-surface-variant">
              {$t('diagnostics.perf.msgsTotal', { values: { n: msgCountTotal } })}
              {#if msgCountPage}
                · {$t('diagnostics.perf.msgsPage', { values: { page: msgCountPage } })}
              {/if}
            </p>
            <ul class="font-mono text-xs text-md-on-surface-variant">
              {#each msgCountRows as entry (entry.type)}
                <li class="break-all">
                  {$t('diagnostics.perf.msgsType', {
                    values: { type: entry.type, n: entry.count },
                  })}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Manual feature tests -->
    <div class="rounded-xl border border-md-outline-variant/30 bg-md-surface-container-low px-3 py-3 space-y-2.5">
      <div class="text-xs font-bold text-md-on-surface/50">
        {$t('diagnostics.testsTitle')}
      </div>
      <div class="flex flex-col gap-2">
        <button
          type="button"
          class="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-md-primary/10 text-md-primary text-xs font-semibold hover:bg-md-primary/15 active:bg-md-primary/35 transition-colors disabled:opacity-50"
          disabled={testNotifyBusy}
          onclick={() => void sendTestNotification()}
        >
          <Icon name="notifications" class="w-4 h-4 shrink-0" />
          <span class="flex-1 text-start">{$t('diagnostics.sendTestNotification')}</span>
        </button>
        {#if testNotifyResult}
          {#if notificationsBlocked}
            <button
              type="button"
              aria-live="polite"
              class="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-md-error/10 text-md-error ui-label hover:bg-md-error/15 active:bg-md-error/35 transition-colors"
              onclick={() => void handleOpenNotificationSettings()}
            >
              <Icon name="notificationsOff" class="w-4 h-4 shrink-0" />
              <span class="flex-1 text-start">{testNotifyResult}</span>
              <Icon name="chevronRight" class="w-3.5 h-3.5 shrink-0" />
            </button>
          {:else}
            <p class="ui-support text-md-on-surface-variant px-1" aria-live="polite">{testNotifyResult}</p>
          {/if}
        {/if}

        <button
          type="button"
          class="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 {voiceListening
            ? 'bg-md-error/15 text-md-error'
            : voiceSupported
              ? 'bg-md-secondary-container text-md-on-secondary-container hover:brightness-105 active:brightness-95'
              : 'bg-md-surface-variant/50 text-md-on-surface/40 cursor-not-allowed'}"
          disabled={!voiceSupported && !voiceListening}
          onclick={() => startVoiceTest()}
        >
          <Icon name={voiceListening ? 'close' : 'mic'} class="w-4 h-4 shrink-0" />
          <span class="flex-1 text-start">
            {voiceListening
              ? $t('diagnostics.stopVoiceTest')
              : $t('diagnostics.testVoiceRecognition')}
          </span>
        </button>
        {#if voiceResult}
          <p class="ui-support text-md-on-surface-variant px-1 break-words">{voiceResult}</p>
        {:else if !voiceSupported}
          <p class="ui-support text-md-on-surface-variant px-1">{$t('diagnostics.voiceUnsupported')}</p>
        {/if}
      </div>
    </div>

    {#each checks as c (c.id)}
      <div class="rounded-xl bg-md-surface-container-low px-3 py-2.5 border border-md-outline-variant/20">
        <div class="flex items-center gap-2 mb-0.5">
          <span class="text-xs font-semibold text-md-on-surface flex-1">{c.label}</span>
          <span class="text-xs font-bold {statusColor(c.status)}">{statusLabel(c.status)}</span>
        </div>
        <p class="ui-support text-md-on-surface-variant break-words">{c.detail}</p>
      </div>
      {#if c.id === 'content' && siteAccess}
        <section
          class="rounded-xl border border-md-outline-variant/30 bg-md-surface-container-low px-3 py-3 space-y-2"
          aria-labelledby="diagnostics-site-access-title"
        >
          <h3 id="diagnostics-site-access-title" class="text-xs font-bold text-md-on-surface/65">
            {$t('diagnostics.siteAccessTitle')}
          </h3>
          {#if siteAccess.origin}
            <p class="font-mono text-xs text-md-on-surface-variant break-all">
              {siteAccess.origin}
            </p>
          {/if}
          <p class="ui-support {getSiteAccessMessageColor(siteAccess.status)}" aria-live="polite">
            {getSiteAccessMessage(siteAccess.status)}
          </p>
          {#if ['permissionMissing', 'denied', 'requestFailed', 'requesting'].includes(siteAccess.status)}
            <button
              type="button"
              class="rounded-lg px-3 py-2 ui-label bg-md-primary text-md-on-primary disabled:opacity-50"
              disabled={siteAccess.status === 'requesting'}
              onclick={() => void requestActiveSiteAccess()}
            >
              {$t('diagnostics.siteAccessRequest')}
            </button>
          {:else if ['reload', 'reloadFailed', 'reloading'].includes(siteAccess.status)}
            <button
              type="button"
              class="rounded-lg px-3 py-2 ui-label bg-md-primary text-md-on-primary disabled:opacity-50"
              disabled={siteAccess.status === 'reloading'}
              onclick={() => void reloadActiveSite()}
            >
              {$t('diagnostics.siteAccessReloadButton')}
            </button>
          {/if}
        </section>
      {/if}
    {/each}
    {#if lastRun}
      <p class="text-xs text-md-on-surface/40 text-center pt-2">
        {$t('diagnostics.lastRun', { values: { time: new Date(lastRun).toLocaleTimeString($locale || 'en') } })}
      </p>
    {/if}
  </div>
</div>
