<script lang="ts">
import { onMount } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';

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
  void (async () => {
    try {
      const result = (await browser.storage.local.get(hintKey)) as Record<string, boolean>;
      if (!result[hintKey]) {
        shown = true;
        hideTimer = setTimeout(() => {
          shown = false;
        }, 4000);
      }
    } catch {
      shown = true;
      hideTimer = setTimeout(() => {
        shown = false;
      }, 4000);
    }
  })();
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
    await browser.storage.local.set({ [hintKey]: true });
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
    class="absolute -top-7 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 bg-md-primary text-md-on-primary text-[10px] font-medium px-2 py-1 rounded-full shadow-md whitespace-nowrap pointer-events-auto"
    role="tooltip"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      class="w-3 h-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="M8 9l4-4 4 4M8 15l4 4 4-4" />
    </svg>
    <span>{text}</span>
    <button
      class="ml-1 text-md-on-primary/70 hover:text-md-on-primary"
      onclick={(e) => {
        e.stopPropagation();
        void persistDismiss();
      }}
      aria-label="Dismiss hint"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="w-3 h-3"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M6 18L18 6" />
      </svg>
    </button>
    <div
      class="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-md-primary rotate-45"
    ></div>
  </div>
{/if}
