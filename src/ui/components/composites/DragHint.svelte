<script lang="ts">
import { onMount } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import Icon from '@/ui/components/icons/Icon.svelte';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { ELEVATION } from '@/utils/ui/elevation.js';

let {
  hintKey,
  text,
  visible = false,
  onDismiss = () => {},
}: {
  hintKey: string;
  text: string;
  visible?: boolean;
  onDismiss?: () => void;
} = $props();

let shown = $state(false);
let dismissed = $state(false);
let hideTimer: ReturnType<typeof setTimeout> | null = null;

onMount(() => {
  // The storage read below can resolve after unmount (cold-start stall):
  // without this flag it would set `shown` and arm hideTimer on a dead
  // component. (The $effect teardown already clears a *pending* hideTimer -
  // this guards the read that creates one.)
  let disposed = false;
  void (async () => {
    try {
      const result = (await browser.storage.local.get(hintKey)) as Record<string, boolean>;
      if (disposed) return;
      if (!result[hintKey]) {
        shown = true;
        hideTimer = setTimeout(() => {
          shown = false;
        }, 4000);
      }
    } catch {
      /* ignore */
      if (disposed) return;
      shown = true;
      hideTimer = setTimeout(() => {
        shown = false;
      }, 4000);
    }
  })();
  return () => {
    disposed = true;
  };
});

$effect(() => {
  if (!visible) {
    shown = false;
  }
});

async function persistDismiss(): Promise<void> {
  dismissed = true;
  shown = false;
  try {
    await writeWithRetry({ [hintKey]: true });
  } catch {
    // ignore
  }
  onDismiss();
}

$effect(() => {
  return () => {
    if (hideTimer) clearTimeout(hideTimer);
  };
});
</script>

{#if shown && !dismissed}
  <div
    class="absolute -top-7 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 bg-md-inverse-surface text-md-inverse-on-surface text-xs font-medium px-2 py-1 rounded-full {ELEVATION.level2} whitespace-nowrap pointer-events-auto"
    role="tooltip"
  >
    <Icon name="dragHandle" class="w-3 h-3" />
    {text}
    <button
      class="ms-1 text-md-inverse-on-surface/70 hover:text-md-inverse-on-surface"
      onclick={(e) => {
        e.stopPropagation();
        void persistDismiss();
      }}
      aria-label={$t('common.dismissHint')}
    >
      <Icon name="close" class="w-3 h-3" />
    </button>
    <div
      class="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-md-primary rotate-45"
    ></div>
  </div>
{/if}
