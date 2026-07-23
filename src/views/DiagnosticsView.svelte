<script lang="ts">
import { onMount } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';

let { onBack = () => {} } = $props<{
  onBack?: () => void;
}>();

type Status = 'ok' | 'warn' | 'fail' | 'pending';

type Check = {
  id: string;
  label: string;
  status: Status;
  detail: string;
};

let checks = $state<Check[]>([]);
let running = $state(true);
let lastRun = $state<number | null>(null);

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
      setCheck('sw', 'fail', ping?.error || $t('diagnostics.details.swFail'));
    }
  } catch (e) {
    setCheck('sw', 'fail', e instanceof Error ? e.message : $t('diagnostics.details.swFail'));
  }

  // 2) Permissions
  try {
    const perms = await browser.permissions.getAll();
    const list = (perms.permissions || []).join(', ') || '-';
    setCheck('perms', 'ok', list);
  } catch (e) {
    setCheck('perms', 'warn', e instanceof Error ? e.message : '-');
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
    setCheck('hosts', 'fail', e instanceof Error ? e.message : '-');
  }

  // 4) Content scripts on active tab
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) {
      setCheck('content', 'warn', $t('diagnostics.details.noHttpTab'));
    } else {
      try {
        const res = (await browser.tabs.sendMessage(tab.id, {
          type: 'checkFormDetected',
        })) as { formDetected?: boolean };
        setCheck(
          'content',
          'ok',
          $t('diagnostics.details.contentOk', {
            values: { form: res?.formDetected ? 'yes' : 'no' },
          })
        );
      } catch {
        setCheck('content', 'fail', $t('diagnostics.details.contentFail'));
      }
    }
  } catch (e) {
    setCheck('content', 'warn', e instanceof Error ? e.message : '-');
  }

  // 5) Storage APIs
  try {
    const key = `_diag_${Date.now()}`;
    await browser.storage.local.set({ [key]: true });
    const got = (await browser.storage.local.get([key])) as Record<string, unknown>;
    await browser.storage.local.remove([key]);
    if (got[key]) {
      try {
        await browser.storage.session.set({ [key]: 1 });
        await browser.storage.session.remove([key]);
        setCheck('storage', 'ok', $t('diagnostics.details.storageOk'));
      } catch {
        setCheck('storage', 'warn', $t('diagnostics.details.storageSessionWarn'));
      }
    } else {
      setCheck('storage', 'fail', $t('diagnostics.details.storageFail'));
    }
  } catch (e) {
    setCheck('storage', 'fail', e instanceof Error ? e.message : '-');
  }

  // 6) Messaging (already pinged SW; also check inboxes)
  try {
    const res = (await browser.runtime.sendMessage({ type: 'getInboxes' })) as {
      success?: boolean;
      inboxes?: unknown[];
      error?: string;
    };
    if (res?.success) {
      setCheck(
        'messaging',
        'ok',
        $t('diagnostics.details.messagingOk', {
          values: { n: Array.isArray(res.inboxes) ? res.inboxes.length : 0 },
        })
      );
    } else {
      setCheck('messaging', 'fail', res?.error || $t('diagnostics.details.messagingFail'));
    }
  } catch (e) {
    setCheck('messaging', 'fail', e instanceof Error ? e.message : '-');
  }

  // 7) Network (HTTPS fetch to a harmless endpoint)
  try {
    const r = await fetch('https://www.google.com/generate_204', {
      method: 'GET',
      cache: 'no-store',
    });
    if (r.ok || r.status === 204 || r.status === 0) {
      setCheck('network', 'ok', $t('diagnostics.details.networkOk'));
    } else {
      setCheck('network', 'warn', `HTTP ${r.status}`);
    }
  } catch (e) {
    setCheck(
      'network',
      'fail',
      e instanceof Error ? e.message : $t('diagnostics.details.networkFail')
    );
  }

  // 8) Recent extension errors (from storage if logger wrote them)
  try {
    const res = (await browser.storage.local.get(['_last_extension_error', 'enableLogging'])) as {
      _last_extension_error?: { message?: string; at?: number };
      enableLogging?: boolean;
    };
    if (res._last_extension_error?.message) {
      setCheck(
        'errors',
        'warn',
        `${res._last_extension_error.message}${res._last_extension_error.at ? ` (${new Date(res._last_extension_error.at).toLocaleString()})` : ''}`
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
    setCheck('errors', 'warn', e instanceof Error ? e.message : '-');
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
    setCheck('hover', 'warn', e instanceof Error ? e.message : '-');
  }

  lastRun = Date.now();
  running = false;
}

onMount(() => {
  void runDiagnostics();
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

<div class="flex flex-col h-full min-h-0">
  <!-- Title + actions - back lives in app header on this deep page -->
  <div class="px-2 py-3 border-b border-md-outline-variant/30 flex items-center gap-2 shrink-0">
    <h2 class="flex-1 min-w-0 text-sm font-bold text-md-on-surface">
      {$t('diagnostics.title')}
      <span class="block text-xs font-normal text-md-on-surface/50">{$t('diagnostics.subtitle')}</span>
    </h2>
    <button
      type="button"
      class="px-2 py-1 text-label-sm font-semibold rounded-lg bg-md-primary text-md-on-primary disabled:opacity-50"
      disabled={running}
      onclick={() => void runDiagnostics()}
    >
      {running ? $t('diagnostics.running') : $t('diagnostics.rerun')}
    </button>
  </div>

  <div class="flex-1 overflow-y-auto px-2 py-3 space-y-2">
    {#each checks as c (c.id)}
      <div class="rounded-xl bg-md-primary-container px-3 py-2.5 border border-md-outline-variant/20">
        <div class="flex items-center gap-2 mb-0.5">
          <span class="text-xs font-semibold text-md-on-surface flex-1">{c.label}</span>
          <span class="text-xs font-bold uppercase {statusColor(c.status)}">{statusLabel(c.status)}</span>
        </div>
        <p class="text-label-sm text-md-on-surface/65 break-words leading-snug">{c.detail}</p>
      </div>
    {/each}
    {#if lastRun}
      <p class="text-xs text-md-on-surface/40 text-center pt-2">
        {$t('diagnostics.lastRun', { values: { time: new Date(lastRun).toLocaleTimeString() } })}
      </p>
    {/if}
  </div>
</div>
