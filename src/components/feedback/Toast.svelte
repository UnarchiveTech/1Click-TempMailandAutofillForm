<script lang="ts">
import { fly } from 'svelte/transition';
import { t } from 'svelte-i18n';
import IconAlertTriangle from '@/components/icons/IconAlertTriangle.svelte';
import IconArchive from '@/components/icons/IconArchive.svelte';
import IconAutoRenew from '@/components/icons/IconAutoRenew.svelte';
import IconBack from '@/components/icons/IconBack.svelte';
import IconBarChart from '@/components/icons/IconBarChart.svelte';
import IconBell from '@/components/icons/IconBell.svelte';
import IconCheckCircle from '@/components/icons/IconCheckCircle.svelte';
import IconChevronDown from '@/components/icons/IconChevronDown.svelte';
import IconChevronUp from '@/components/icons/IconChevronUp.svelte';
import IconClock from '@/components/icons/IconClock.svelte';
import IconCopy from '@/components/icons/IconCopy.svelte';
import IconDownload from '@/components/icons/IconDownload.svelte';
import IconEdit from '@/components/icons/IconEdit.svelte';
import IconEditSquare from '@/components/icons/IconEditSquare.svelte';
import IconEnvelope from '@/components/icons/IconEnvelope.svelte';
import IconFilter from '@/components/icons/IconFilter.svelte';
import IconFlame from '@/components/icons/IconFlame.svelte';
import IconGitHub from '@/components/icons/IconGitHub.svelte';
import IconGlobe from '@/components/icons/IconGlobe.svelte';
import IconInbox from '@/components/icons/IconInbox.svelte';
import IconInfo from '@/components/icons/IconInfo.svelte';
import IconInfoCircle from '@/components/icons/IconInfoCircle.svelte';
import IconLock from '@/components/icons/IconLock.svelte';
import IconMail from '@/components/icons/IconMail.svelte';
import IconMonitor from '@/components/icons/IconMonitor.svelte';
import IconMoon from '@/components/icons/IconMoon.svelte';
import IconPlus from '@/components/icons/IconPlus.svelte';
import IconQr from '@/components/icons/IconQr.svelte';
import IconRefresh from '@/components/icons/IconRefresh.svelte';
import IconSearch from '@/components/icons/IconSearch.svelte';
import IconSettings from '@/components/icons/IconSettings.svelte';
import IconShield from '@/components/icons/IconShield.svelte';
import IconSun from '@/components/icons/IconSun.svelte';
import IconTag from '@/components/icons/IconTag.svelte';
import IconTrash from '@/components/icons/IconTrash.svelte';
import IconUser from '@/components/icons/IconUser.svelte';
import IconWarning from '@/components/icons/IconWarning.svelte';
import IconX from '@/components/icons/IconX.svelte';

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

$effect(() => {
  const toastDuration = toast.duration || 3000;
  const timeout = setTimeout(() => {
    visible = false;
    setTimeout(() => onClose(toast.id), 300);
  }, toastDuration);

  return () => {
    clearTimeout(timeout);
  };
});

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
    class="flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg min-w-[280px] max-w-[325px] w-[325px]"
    style="background-color: var(--md-primary);"
    transition:fly={{ y: -20, duration: 300 }}
  >
    {#if toast.type === 'success'}
      <IconCheckCircle class="w-5 h-5 shrink-0 mt-0.5 text-md-success" />
    {:else if toast.type === 'error'}
      <IconAlertTriangle class="w-5 h-5 shrink-0 mt-0.5 text-md-error" />
    {:else if toast.type === 'warning'}
      <IconWarning class="w-5 h-5 shrink-0 mt-0.5 text-md-warning" />
    {:else if toast.type === 'expired'}
      <IconClock class="w-5 h-5 shrink-0 mt-0.5 text-md-warning" />
    {:else if toast.type === 'archived'}
      <IconArchive class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'deleted'}
      <IconTrash class="w-5 h-5 shrink-0 mt-0.5 text-md-error" />
    {:else if toast.type === 'copy'}
      <IconCopy class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'auto-renew'}
      <IconAutoRenew class="w-5 h-5 shrink-0 mt-0.5 text-md-success" />
    {:else if toast.type === 'back'}
      <IconBack class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'chart'}
      <IconBarChart class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'bell'}
      <IconBell class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'chevron-down'}
      <IconChevronDown class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'chevron-up'}
      <IconChevronUp class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'download'}
      <IconDownload class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'edit'}
      <IconEdit class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'envelope'}
      <IconEnvelope class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'filter'}
      <IconFilter class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'flame'}
      <IconFlame class="w-5 h-5 shrink-0 mt-0.5 text-md-warning" />
    {:else if toast.type === 'github'}
      <IconGitHub class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'globe'}
      <IconGlobe class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'inbox'}
      <IconInbox class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'lock'}
      <IconLock class="w-5 h-5 shrink-0 mt-0.5 text-md-warning" />
    {:else if toast.type === 'mail'}
      <IconMail class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'monitor'}
      <IconMonitor class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'moon'}
      <IconMoon class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'plus'}
      <IconPlus class="w-5 h-5 shrink-0 mt-0.5 text-md-success" />
    {:else if toast.type === 'qr'}
      <IconQr class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'refresh'}
      <IconRefresh class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'search'}
      <IconSearch class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'settings'}
      <IconSettings class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'shield'}
      <IconShield class="w-5 h-5 shrink-0 mt-0.5 text-md-success" />
    {:else if toast.type === 'sun'}
      <IconSun class="w-5 h-5 shrink-0 mt-0.5 text-md-warning" />
    {:else if toast.type === 'tag'}
      <IconTag class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else if toast.type === 'user'}
      <IconUser class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {:else}
      <IconInfoCircle class="w-5 h-5 shrink-0 mt-0.5 text-md-primary" />
    {/if}
    <div class="flex-1 min-w-0">
      <p class="text-sm font-medium text-white">{toast.message}</p>
    </div>
    <div class="flex items-center gap-2 shrink-0">
      {#if toast.undoAction}
        <button
          class="text-white/80 hover:text-white transition-colors text-xs font-medium"
          onclick={() => {
            toast.undoAction?.();
            visible = false;
            setTimeout(() => onClose(toast.id), 300);
          }}
          aria-label="Undo action"
        >
          Undo
        </button>
      {/if}
      <button
        class="text-white/50 hover:text-white transition-colors"
        onclick={() => { visible = false; setTimeout(() => onClose(toast.id), 300); }}
        aria-label="Close toast"
      >
        <IconX class="w-4 h-4 text-white" />
      </button>
    </div>
  </div>
{/if}
