<script lang="ts">
/**
 * Canonical ErrorBoundary for the extension UI.
 * - Root shell: revert last action + hard reset (export gate) + try again / refresh
 * - Nested views: optional fallback message + onRetry (scoped recovery)
 */
import type { Snippet } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/components/icons/Icon.svelte';
import Btn from '@/components/ui/primitives/Btn.svelte';
import { getLastBackupExportAt } from '@/features/settings/backup-actions.js';
import { hardResetFromBoundary, revertLastAction } from '@/utils/action-history.js';
import { logError } from '@/utils/logger.js';

let {
  children,
  fallback = '',
  onRetry,
  /** When false, hide hard-reset / revert (scoped boundaries) */
  fullRecovery = true,
}: {
  children: Snippet;
  fallback?: string;
  onRetry?: () => void;
  fullRecovery?: boolean;
} = $props();

let busy = $state(false);
let statusMsg = $state('');
let hardResetConfirm = $state(false);
let lastExportAt = $state<number | null>(null);

function handleError(err: unknown) {
  logError('Error caught by ErrorBoundary:', err);
}

async function onRevert(reset: () => void) {
  busy = true;
  statusMsg = '';
  try {
    const ok = await revertLastAction(browser);
    statusMsg = ok
      ? ($t('errorBoundary.revertSuccess') as string)
      : ($t('errorBoundary.revertFailed') as string);
    setTimeout(() => {
      reset();
      window.location.reload();
    }, 600);
  } catch {
    statusMsg = $t('errorBoundary.revertFailed') as string;
    busy = false;
  }
}

async function prepareHardReset() {
  try {
    lastExportAt = await getLastBackupExportAt(browser);
  } catch {
    lastExportAt = null;
  }
  hardResetConfirm = true;
}

async function onHardReset() {
  busy = true;
  hardResetConfirm = false;
  statusMsg = $t('errorBoundary.hardResetting') as string;
  try {
    await hardResetFromBoundary(browser);
  } catch {
    /* still reload */
  }
  setTimeout(() => window.location.reload(), 400);
}
</script>

<svelte:boundary onerror={handleError}>
  {@render children()}

  {#snippet failed(rawError, reset)}
    {@const error = rawError as Error}
    <div class="flex items-center justify-center min-h-[200px] h-full bg-md-error/10 p-4">
      <div class="max-w-md w-full bg-md-surface rounded-2xl shadow-lg p-6 border border-md-error/20">
        <div class="flex items-center gap-3 mb-4">
          <Icon name="alertTriangle" class="w-8 h-8 text-md-error shrink-0" />
          <h2 class="text-lg font-bold text-md-error">{$t('errorBoundary.title')}</h2>
        </div>
        <p class="text-sm text-md-on-surface/70 mb-3">
          {fallback || $t('errorBoundary.body')}
        </p>
        {#if error && error.message}
          <details class="bg-md-surface-container-low rounded-xl p-3 mb-4">
            <summary class="cursor-pointer font-medium text-sm text-md-on-surface/60">
              {$t('errorBoundary.details')}
            </summary>
            <pre class="mt-2 text-xs text-md-on-surface/50 overflow-auto whitespace-pre-wrap">{error.message}</pre>
          </details>
        {/if}
        {#if statusMsg}
          <p class="text-xs text-md-primary mb-3">{statusMsg}</p>
        {/if}

        {#if hardResetConfirm}
          <div class="mb-4 p-3 rounded-xl border border-md-error/30 bg-md-error/5 space-y-2">
            <p class="text-sm font-semibold text-md-error">{$t('errorBoundary.hardResetConfirmTitle')}</p>
            <p class="text-xs text-md-on-surface/70">
              {#if lastExportAt}
                {$t('errorBoundary.hardResetExportedHint', {
                  values: { date: new Date(lastExportAt).toLocaleString() },
                })}
              {:else}
                {$t('errorBoundary.hardResetNoExportWarn')}
              {/if}
            </p>
            <div class="flex gap-2 pt-1">
              <Btn
                variant="ghost"
                size="md"
                class="flex-1"
                disabled={busy}
                onclick={() => { hardResetConfirm = false; }}
              >
                {$t('common.cancel')}
              </Btn>
              <Btn
                variant="danger"
                size="md"
                class="flex-1"
                disabled={busy}
                onclick={() => { void onHardReset(); }}
              >
                {$t('errorBoundary.hardReset')}
              </Btn>
            </div>
          </div>
        {/if}

        <div class="flex flex-col gap-2">
          {#if fullRecovery}
            <Btn
              variant="primary"
              size="md"
              class="w-full"
              disabled={busy || hardResetConfirm}
              onclick={() => { void onRevert(reset); }}
            >
              {$t('errorBoundary.revertLast')}
            </Btn>
            <Btn
              variant="dangerOutline"
              size="md"
              class="w-full"
              disabled={busy || hardResetConfirm}
              onclick={() => { void prepareHardReset(); }}
            >
              {$t('errorBoundary.hardReset')}
            </Btn>
          {/if}
          <div class="flex gap-2">
            <Btn
              variant="ghost"
              size="md"
              class="flex-1"
              disabled={busy}
              onclick={() => { if (onRetry) onRetry(); reset(); }}
            >
              {$t('errorBoundary.tryAgain')}
            </Btn>
            <Btn
              variant="ghost"
              size="md"
              class="flex-1"
              disabled={busy}
              onclick={() => { window.location.reload(); }}
            >
              {$t('errorBoundary.refresh')}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  {/snippet}
</svelte:boundary>
