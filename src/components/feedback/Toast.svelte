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
  undoAction?: (() => void) | null;
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
    class="flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg min-w-[280px] max-w-[325px] w-[325px] bg-md-primary"
    transition:fly={{ y: -20, duration: 300 }}
  >
    {#if toast.type === 'success'}
      <Icon name="checkCircle" class="w-5 h-5 shrink-0 mt-0.5 text-md-success" />
    {:else if toast.type === 'error'}
      <Icon name="alertTriangle" class="w-5 h-5 shrink-0 mt-0.5 text-md-error" />
    {:else if toast.type === 'warning'}
      <Icon name="warning" class="w-5 h-5 shrink-0 mt-0.5 text-md-warning" />
    {:else if toast.type === 'expired'}
      <Icon name="clock" class="w-5 h-5 shrink-0 mt-0.5 text-md-warning" />
    {:else if toast.type === 'archived'}
      <Icon name="archive" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'deleted'}
      <Icon name="trash" class="w-5 h-5 shrink-0 mt-0.5 text-md-error" />
    {:else if toast.type === 'copy'}
      <Icon name="copy" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'auto-renew'}
      <Icon name="autoRenew" class="w-5 h-5 shrink-0 mt-0.5 text-md-success" />
    {:else if toast.type === 'back'}
      <Icon name="back" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'chart'}
      <Icon name="barChart" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'bell'}
      <Icon name="bell" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'chevron-down'}
      <Icon name="chevronDown" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'chevron-up'}
      <Icon name="chevronUp" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'download'}
      <Icon name="download" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'edit'}
      <Icon name="edit" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'envelope'}
      <Icon name="envelope" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'filter'}
      <Icon name="filter" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'flame'}
      <Icon name="flame" class="w-5 h-5 shrink-0 mt-0.5 text-md-warning" />
    {:else if toast.type === 'github'}
      <Icon name="gitHub" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'globe'}
      <Icon name="globe" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'inbox'}
      <Icon name="inbox" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'lock'}
      <Icon name="lock" class="w-5 h-5 shrink-0 mt-0.5 text-md-warning" />
    {:else if toast.type === 'mail'}
      <Icon name="mail" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'monitor'}
      <Icon name="monitor" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'moon'}
      <Icon name="moon" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'plus'}
      <Icon name="plus" class="w-5 h-5 shrink-0 mt-0.5 text-md-success" />
    {:else if toast.type === 'qr'}
      <Icon name="qr" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'refresh'}
      <Icon name="refresh" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'search'}
      <Icon name="search" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'settings'}
      <Icon name="settings" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'shield'}
      <Icon name="shield" class="w-5 h-5 shrink-0 mt-0.5 text-md-success" />
    {:else if toast.type === 'sun'}
      <Icon name="sun" class="w-5 h-5 shrink-0 mt-0.5 text-md-warning" />
    {:else if toast.type === 'tag'}
      <Icon name="tag" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'user'}
      <Icon name="user" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else}
      <Icon name="infoCircle" class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {/if}
    <div class="flex-1 min-w-0">
      <p class="text-sm font-medium text-white">{toast.message}</p>
    </div>
    <div class="flex items-center gap-2 shrink-0">
      {#if toast.undoAction}
        <button
          class="text-white/80 hover:text-white transition-colors text-xs font-medium"
          onclick={(e) => {
          e.stopPropagation();
          toast.undoAction?.();
          handleClose();
        }}
        aria-label="Undo action"
      >
        Undo
      </button>
    {/if}
    <button
      class="text-white/50 hover:text-white transition-colors"
      onclick={(e) => { e.stopPropagation(); handleClose(); }}
      aria-label="Close toast"
    >
        <Icon name="x" class="w-4 h-4 text-white" />
      </button>
    </div>
  </div>
{/if}
