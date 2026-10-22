<script lang="ts">
import { onDestroy, onMount, tick, untrack } from 'svelte';
import { fly } from 'svelte/transition';
import { t } from 'svelte-i18n';
import Icon from '@/ui/components/icons/Icon.svelte';
import { logError } from '@/utils/logger.js';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';
import { toastStore } from '@/utils/ui/toastStore.js';
import type { Toast, ToastType } from './toast-types.js';

export type { Toast, ToastType } from './toast-types.js';

let { toast, onClose }: { toast: Toast; onClose: (id: string) => void } = $props();

let visible = $state(true);
let toastEl = $state<HTMLElement | null>(null);
let focusPaused = $state(false);
let remainingMs = untrack(() => toast.duration || 3000);
let timeoutId: ReturnType<typeof setTimeout> | null = null;
// Inner fade-out timer must be tracked too: the store can unmount this
// component while it is pending (stack capped at 3 / dedupe removal), and an
// uncleared timer would fire onClose after unmount.
let fadeTimeoutId: ReturnType<typeof setTimeout> | null = null;
// Skip the slide-in when the user prefers reduced motion.
let reducedMotion = $state(false);
onDestroy(() => toastStore.setFocused(toast.id, false));

onMount(() => {
  if (typeof window === 'undefined' || !window.matchMedia) return;
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion = mq.matches;
  const onChange = (e: MediaQueryListEvent) => {
    reducedMotion = e.matches;
  };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
});

$effect(() => {
  if (focusPaused) return;
  const startedAt = performance.now();
  timeoutId = setTimeout(() => {
    visible = false;
    fadeTimeoutId = setTimeout(() => onClose(toast.id), 300);
  }, remainingMs);

  return () => {
    if (timeoutId) clearTimeout(timeoutId);
    if (fadeTimeoutId) clearTimeout(fadeTimeoutId);
    remainingMs = Math.max(0, remainingMs - (performance.now() - startedAt));
  };
});

function handleClose() {
  toastStore.setFocused(toast.id, false);
  const hadFocus = toastEl?.contains(document.activeElement);
  if (timeoutId) clearTimeout(timeoutId);
  if (fadeTimeoutId) clearTimeout(fadeTimeoutId);
  visible = false;
  fadeTimeoutId = setTimeout(() => onClose(toast.id), 300);
  if (hadFocus)
    void tick().then(() => {
      // Undo/Close removes the focused control. Resume at a reachable page
      // control unless the action deliberately moved focus elsewhere.
      if (document.activeElement !== document.body && !toastEl?.contains(document.activeElement))
        return;
      const controls = document.querySelectorAll<HTMLElement>(
        '[data-row-primary], #inbox-search-input, #footer-contextual-fab'
      );
      Array.from(controls)
        .find((control) => control.getClientRects().length > 0)
        ?.focus();
    });
}
</script>

{#if visible}
  <div
    bind:this={toastEl}
    onfocusin={() => { focusPaused = true; toastStore.setFocused(toast.id, true); }}
    onfocusout={(event) => {
      if (!(event.relatedTarget instanceof Node) || !toastEl?.contains(event.relatedTarget)) {
        focusPaused = false;
        toastStore.setFocused(toast.id, false);
      }
    }}
    class="pointer-events-auto w-full flex items-center gap-2 px-3 h-10 rounded-xl border border-md-outline-variant/10 {ELEVATION.level2} min-w-0 max-w-[340px] bg-md-inverse-surface"
    transition:fly={{ y: reducedMotion ? 0 : 12, duration: reducedMotion ? 0 : 220 }}
  >
    <span
      class="sr-only"
      role={toast.type === 'error' ? 'alert' : 'status'}
      aria-atomic="true"
    >
      {toast.message}
    </span>
    {#if toast.type === 'success'}
      <Icon name="checkCircle" class="w-3.5 h-3.5 shrink-0 text-md-success" />
    {:else if toast.type === 'error'}
      <Icon name="warning" class="w-3.5 h-3.5 shrink-0 text-md-error" />
    {:else if toast.type === 'warning'}
      <Icon name="warning" class="w-3.5 h-3.5 shrink-0 text-md-warning" />
    {:else if toast.type === 'expired'}
      <Icon name="schedule" class="w-3.5 h-3.5 shrink-0 text-md-warning" />
    {:else if toast.type === 'archived'}
      <Icon name="archive" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'deleted'}
      <Icon name="delete" class="w-3.5 h-3.5 shrink-0 text-md-error" />
    {:else if toast.type === 'copy'}
      <Icon name="contentCopy" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'auto-renew'}
      <Icon name="autoRenew" class="w-3.5 h-3.5 shrink-0 text-md-success" />
    {:else if toast.type === 'back'}
      <Icon name="back" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'chart'}
      <Icon name="barChart" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'bell'}
      <Icon name="notifications" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'chevron-down'}
      <Icon name="chevronDown" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'chevron-up'}
      <Icon name="chevronUp" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'download'}
      <Icon name="download" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'edit'}
      <Icon name="edit" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'envelope'}
      <Icon name="mail" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'filter'}
      <Icon name="filter" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'flame'}
      <Icon name="localFireDepartment" class="w-3.5 h-3.5 shrink-0 text-md-warning" />
    {:else if toast.type === 'github'}
      <Icon name="github" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'globe'}
      <Icon name="globe" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'inbox'}
      <Icon name="inbox" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'lock'}
      <Icon name="lock" class="w-3.5 h-3.5 shrink-0 text-md-warning" />
    {:else if toast.type === 'mail'}
      <Icon name="mail" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'monitor'}
      <Icon name="monitor" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'moon'}
      <Icon name="darkMode" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'plus'}
      <Icon name="add" class="w-3.5 h-3.5 shrink-0 text-md-success" />
    {:else if toast.type === 'qr'}
      <Icon name="qrCode2" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'refresh'}
      <Icon name="refresh" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'search'}
      <Icon name="search" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'settings'}
      <Icon name="settings" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'shield'}
      <Icon name="shield" class="w-3.5 h-3.5 shrink-0 text-md-success" />
    {:else if toast.type === 'sun'}
      <Icon name="lightMode" class="w-3.5 h-3.5 shrink-0 text-md-warning" />
    {:else if toast.type === 'tag'}
      <Icon name="tag" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'user'}
      <Icon name="person" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else}
      <Icon name="info" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {/if}
    <p aria-hidden="true" class="flex-1 min-w-0 ui-support font-semibold text-md-inverse-on-surface truncate">{toast.message}</p>
    <div
      class="flex flex-nowrap items-center gap-2 shrink-0"
      use:responsiveButtonLayout
      data-action-tier="XS"
    >
      {#if toast.undoAction}
        <button
          class="h-8 text-md-inverse-primary hover:opacity-80 transition-opacity font-semibold"
          onclick={(e) => {
            e.stopPropagation();
            const res = toast.undoAction?.();
            if (res instanceof Promise) {
              res.catch((err) => {
                logError('Toast undo action failed', err);
              });
            }
            handleClose();
          }}
          aria-label={toast.actionLabel || $t('common.undo')}
        >
          {toast.actionLabel || $t('common.undo')}
        </button>
      {/if}
      <button
        class="h-8 flex items-center justify-center rounded-full text-md-inverse-on-surface/50 hover:text-md-inverse-on-surface transition-colors"
        onclick={(e) => { e.stopPropagation(); handleClose(); }}
        aria-label={$t('common.closeToast')}
      >
        <Icon name="close" class="w-4 h-4 text-md-inverse-on-surface/75" />
      </button>
    </div>
  </div>
{/if}
