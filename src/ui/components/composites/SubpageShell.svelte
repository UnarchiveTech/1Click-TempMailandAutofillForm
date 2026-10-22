<script lang="ts">
import type { Snippet } from 'svelte';
import { t } from 'svelte-i18n';
import Icon from '@/ui/components/icons/Icon.svelte';
import { Btn } from '@/ui/components/primitives';

let {
  onBack = () => {},
  title,
  hint,
  resetLabel,
  onReset = undefined,
  children,
}: {
  onBack?: () => void;
  /** Header title - consumers pass the already-translated string (e.g. `$t('settings.xTitle')`). */
  title: string;
  /** Optional subtitle under the title. */
  hint?: string;
  /** Optional Reset button label; the button only renders when onReset is also provided. */
  resetLabel?: string;
  onReset?: () => void;
  children: Snippet;
} = $props();
</script>

<div class="scroll-frame flex flex-col h-full min-h-0 bg-md-surface text-md-on-surface">
  <!-- Header -->
  <div class="scroll-edge flex items-center gap-2 py-3 border-b border-md-outline-variant/20 shrink-0">
    <button
      type="button"
      class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70 transition-colors"
      onclick={onBack}
      aria-label={$t('common.back')}
    >
      <Icon name="chevronLeft" class="w-5 h-5" />
    </button>
    <div class="flex-1 min-w-0">
      <h1 class="text-sm font-semibold text-md-on-surface truncate">{title}</h1>
      {#if hint}
        <p class="text-xs text-md-on-surface/50 truncate">{hint}</p>
      {/if}
    </div>
    {#if resetLabel && onReset}
      <Btn variant="outline" size="sm" onclick={onReset}>
        {resetLabel}
      </Btn>
    {/if}
  </div>

  <!-- Content -->
  <div class="scroll-body scroll-body-framed flex-1 min-h-0 overflow-y-auto py-3 space-y-4">
    {@render children()}

    <!-- Dynamic End-of-Page Spacer -->
    <div
      class="w-full shrink-0 transition-[height] duration-200 ease-in-out pointer-events-none"
      style="height: calc(var(--bottom-safe-area, 0px) + 16px);"
      aria-hidden="true"
    ></div>
  </div>
</div>
