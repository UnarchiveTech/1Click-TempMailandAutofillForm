<script lang="ts">
import { fly } from 'svelte/transition';
import { t } from 'svelte-i18n';
import Icon from '@/components/icons/Icon.svelte';

export type ToastType =
  | 'success'
  | 'error'
  | 'warning'
  | 'info'
  | 'expired'
  | 'archived'
  | 'deleted'
  | 'copy'
  | 'auto-renew'
  | 'back'
  | 'chart'
  | 'bell'
  | 'chevron-down'
  | 'chevron-up'
  | 'download'
  | 'edit'
  | 'envelope'
  | 'filter'
  | 'flame'
  | 'github'
  | 'globe'
  | 'inbox'
  | 'lock'
  | 'mail'
  | 'monitor'
  | 'moon'
  | 'plus'
  | 'qr'
  | 'refresh'
  | 'search'
  | 'settings'
  | 'shield'
  | 'sun'
  | 'tag'
  | 'user';

export type Toast = {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
  undoAction?: (() => void | Promise<void>) | null;
  /** Optional label for the action button (defaults to Undo) */
  actionLabel?: string | null;
};

let { toast, onClose }: { toast: Toast; onClose: (id: string) => void } = $props();

let visible = $state(true);
let timeoutId: ReturnType<typeof setTimeout> | null = null;

$effect(() => {
  const toastDuration = toast.duration || 3000;
  timeoutId = setTimeout(() => {
    visible = false;
    setTimeout(() => onClose(toast.id), 300);
  }, toastDuration);

  return () => {
    if (timeoutId) clearTimeout(timeoutId);
  };
});

function handleClose() {
  if (timeoutId) clearTimeout(timeoutId);
  visible = false;
  setTimeout(() => onClose(toast.id), 300);
}

function getBgColor() {
  switch (toast.type) {
    case 'success':
      return 'bg-md-success/10 border-md-success/20';
    case 'error':
      return 'bg-md-error/10 border-md-error/20';
    case 'warning':
      return 'bg-md-warning/10 border-md-warning/20';
    case 'info':
      return 'bg-md-primary/10 border-md-primary/20';
    case 'expired':
      return 'bg-md-warning/10 border-md-warning/20';
    case 'archived':
      return 'bg-md-primary/10 border-md-primary/20';
    case 'deleted':
      return 'bg-md-error/10 border-md-error/20';
    case 'copy':
      return 'bg-md-primary/10 border-md-primary/20';
    case 'auto-renew':
      return 'bg-md-success/10 border-md-success/20';
    case 'back':
      return 'bg-md-primary/10 border-md-primary/20';
    case 'chart':
      return 'bg-md-primary/10 border-md-primary/20';
    case 'bell':
      return 'bg-md-primary/10 border-md-primary/20';
    case 'chevron-down':
      return 'bg-md-primary/10 border-md-primary/20';
    case 'chevron-up':
      return 'bg-md-primary/10 border-md-primary/20';
    case 'download':
      return 'bg-md-primary/10 border-md-primary/20';
    case 'edit':
      return 'bg-md-primary/10 border-md-primary/20';
    case 'envelope':
      return 'bg-md-primary/10 border-md-primary/20';
    case 'filter':
      return 'bg-md-primary/10 border-md-primary/20';
    case 'flame':
      return 'bg-md-warning/10 border-md-warning/20';
    case 'github':
      return 'bg-md-primary/10 border-md-primary/20';
    case 'globe':
      return 'bg-md-primary/10 border-md-primary/20';
    case 'inbox':
      return 'bg-md-primary/10 border-md-primary/20';
    case 'lock':
      return 'bg-md-warning/10 border-md-warning/20';
    case 'mail':
      return 'bg-md-primary/10 border-md-primary/20';
    case 'monitor':
      return 'bg-md-primary/10 border-md-primary/20';
    case 'moon':
      return 'bg-md-primary/10 border-md-primary/20';
    case 'plus':
      return 'bg-md-success/10 border-md-success/20';
    case 'qr':
      return 'bg-md-primary/10 border-md-primary/20';
    case 'refresh':
      return 'bg-md-primary/10 border-md-primary/20';
    case 'search':
      return 'bg-md-primary/10 border-md-primary/20';
    case 'settings':
      return 'bg-md-primary/10 border-md-primary/20';
    case 'shield':
      return 'bg-md-success/10 border-md-success/20';
    case 'sun':
      return 'bg-md-warning/10 border-md-warning/20';
    case 'tag':
      return 'bg-md-primary/10 border-md-primary/20';
    case 'user':
      return 'bg-md-primary/10 border-md-primary/20';
    default:
      return 'bg-md-primary/10 border-md-primary/20';
  }
}

function getTextColor() {
  switch (toast.type) {
    case 'success':
      return 'text-md-success';
    case 'error':
      return 'text-md-error';
    case 'warning':
      return 'text-md-warning';
    case 'info':
      return 'text-md-primary';
    case 'expired':
      return 'text-md-warning';
    case 'archived':
      return 'text-md-primary';
    case 'deleted':
      return 'text-md-error';
    case 'copy':
      return 'text-md-primary';
    case 'auto-renew':
      return 'text-md-success';
    case 'back':
      return 'text-md-primary';
    case 'chart':
      return 'text-md-primary';
    case 'bell':
      return 'text-md-primary';
    case 'chevron-down':
      return 'text-md-primary';
    case 'chevron-up':
      return 'text-md-primary';
    case 'download':
      return 'text-md-primary';
    case 'edit':
      return 'text-md-primary';
    case 'envelope':
      return 'text-md-primary';
    case 'filter':
      return 'text-md-primary';
    case 'flame':
      return 'text-md-warning';
    case 'github':
      return 'text-md-primary';
    case 'globe':
      return 'text-md-primary';
    case 'inbox':
      return 'text-md-primary';
    case 'lock':
      return 'text-md-warning';
    case 'mail':
      return 'text-md-primary';
    case 'monitor':
      return 'text-md-primary';
    case 'moon':
      return 'text-md-primary';
    case 'plus':
      return 'text-md-success';
    case 'qr':
      return 'text-md-primary';
    case 'refresh':
      return 'text-md-primary';
    case 'search':
      return 'text-md-primary';
    case 'settings':
      return 'text-md-primary';
    case 'shield':
      return 'text-md-success';
    case 'sun':
      return 'text-md-warning';
    case 'tag':
      return 'text-md-primary';
    case 'user':
      return 'text-md-primary';
    default:
      return 'text-md-primary';
  }
}
</script>

{#if visible}
  <div
    class="pointer-events-auto w-full flex items-center gap-2 px-3 h-10 rounded-xl border border-md-outline-variant/10 shadow-md min-w-0 max-w-[340px] bg-md-inverse-surface"
    transition:fly={{ y: 12, duration: 220 }}
  >
    {#if toast.type === 'success'}
      <Icon name="checkCircle" class="w-3.5 h-3.5 shrink-0 text-md-success" />
    {:else if toast.type === 'error'}
      <Icon name="alertTriangle" class="w-3.5 h-3.5 shrink-0 text-md-error" />
    {:else if toast.type === 'warning'}
      <Icon name="warning" class="w-3.5 h-3.5 shrink-0 text-md-warning" />
    {:else if toast.type === 'expired'}
      <Icon name="clock" class="w-3.5 h-3.5 shrink-0 text-md-warning" />
    {:else if toast.type === 'archived'}
      <Icon name="archive" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'deleted'}
      <Icon name="trash" class="w-3.5 h-3.5 shrink-0 text-md-error" />
    {:else if toast.type === 'copy'}
      <Icon name="copy" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'auto-renew'}
      <Icon name="autoRenew" class="w-3.5 h-3.5 shrink-0 text-md-success" />
    {:else if toast.type === 'back'}
      <Icon name="back" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'chart'}
      <Icon name="barChart" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'bell'}
      <Icon name="bell" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'chevron-down'}
      <Icon name="chevronDown" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'chevron-up'}
      <Icon name="chevronUp" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'download'}
      <Icon name="download" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'edit'}
      <Icon name="edit" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'envelope'}
      <Icon name="envelope" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'filter'}
      <Icon name="filter" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'flame'}
      <Icon name="flame" class="w-3.5 h-3.5 shrink-0 text-md-warning" />
    {:else if toast.type === 'github'}
      <Icon name="gitHub" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
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
      <Icon name="moon" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'plus'}
      <Icon name="plus" class="w-3.5 h-3.5 shrink-0 text-md-success" />
    {:else if toast.type === 'qr'}
      <Icon name="qr" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'refresh'}
      <Icon name="refresh" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'search'}
      <Icon name="search" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'settings'}
      <Icon name="settings" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'shield'}
      <Icon name="shield" class="w-3.5 h-3.5 shrink-0 text-md-success" />
    {:else if toast.type === 'sun'}
      <Icon name="sun" class="w-3.5 h-3.5 shrink-0 text-md-warning" />
    {:else if toast.type === 'tag'}
      <Icon name="tag" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else if toast.type === 'user'}
      <Icon name="user" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {:else}
      <Icon name="infoCircle" class="w-3.5 h-3.5 shrink-0 text-md-primary" />
    {/if}
    <p class="flex-1 min-w-0 text-label-sm font-semibold text-md-inverse-on-surface leading-tight truncate">{toast.message}</p>
    <div class="flex items-center gap-1.5 shrink-0">
      {#if toast.undoAction}
        <button
          class="text-md-inverse-primary hover:opacity-80 transition-opacity text-xs font-semibold uppercase tracking-wide"
          onclick={(e) => {
            e.stopPropagation();
            const res = toast.undoAction?.();
            if (res instanceof Promise) {
              res.catch((err) => {
                console.error('Toast undo action failed:', err);
              });
            }
            handleClose();
          }}
          aria-label={toast.actionLabel || $t('common.undo') || 'Undo action'}
        >
          {toast.actionLabel || $t('common.undo') || 'Undo'}
        </button>
      {/if}
      <button
        class="text-md-inverse-on-surface/50 hover:text-md-inverse-on-surface transition-colors"
        onclick={(e) => { e.stopPropagation(); handleClose(); }}
        aria-label="Close toast"
      >
        <Icon name="x" class="w-3.5 h-3.5 text-md-inverse-on-surface/75" />
      </button>
    </div>
  </div>
{/if}
