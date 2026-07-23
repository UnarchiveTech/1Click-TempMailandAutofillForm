<script lang="ts">
/**
 * Composite empty state — mailbox folders, split panes, organize lists, etc.
 * Prefer `iconName` (Icon component) over raw HTML `icon`.
 */
import Icon from '@/components/icons/Icon.svelte';

let {
  icon,
  iconName = '' as string,
  title = '',
  description = '',
  actionLabel = '',
  onAction = undefined as (() => void) | undefined,
  compact = false,
}: {
  /** Raw SVG HTML (legacy). Prefer iconName. */
  icon?: string;
  /** Icon component name from Icon.svelte */
  iconName?: string;
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Tighter padding for split panes / narrow columns */
  compact?: boolean;
} = $props();
</script>

<div
  class="empty-state flex flex-col items-center justify-center flex-1 min-h-0 w-full text-center
    {compact ? 'py-6 px-4' : 'py-8 px-6'}"
  role="status"
>
  {#if iconName}
    <div
      class="rounded-2xl bg-md-surface-container-low flex items-center justify-center mb-3 shrink-0
        {compact ? 'w-14 h-14' : 'w-20 h-20'}"
    >
      <Icon
        name={iconName}
        class="text-md-on-surface/40 {compact ? 'w-7 h-7' : 'w-8 h-8'}"
      />
    </div>
  {:else if icon}
    <div
      class="rounded-2xl bg-md-surface-container-low flex items-center justify-center mb-3 shrink-0
        {compact ? 'w-14 h-14' : 'w-20 h-20'}"
    >
      {@html icon}
    </div>
  {/if}

  {#if title}
    <h3
      class="font-semibold text-md-on-surface mb-1.5
        {compact ? 'text-base' : 'text-lg'}"
    >
      {title}
    </h3>
  {/if}

  {#if description}
    <p class="text-sm text-md-on-surface/60 max-w-sm {actionLabel && onAction ? 'mb-5' : ''}">
      {description}
    </p>
  {/if}

  {#if actionLabel && onAction}
    <button
      type="button"
      class="px-3 py-1.5 text-sm rounded-xl bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors"
      onclick={(e) => {
        e.stopPropagation();
        onAction();
      }}
    >
      {actionLabel}
    </button>
  {/if}
</div>
