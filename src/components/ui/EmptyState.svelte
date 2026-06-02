<script lang="ts">
import { t } from 'svelte-i18n';

let {
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon?: string;
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
} = $props();
</script>

<div class="flex flex-col items-center justify-center py-12 px-6 text-center">
  {#if icon}
    <div class="w-20 h-20 rounded-2xl bg-md-surface-container-low flex items-center justify-center mb-4">
      {@html icon}
    </div>
  {/if}
  
  {#if title}
    <h3 class="text-lg font-semibold text-md-on-surface mb-2">{title}</h3>
  {/if}
  
  {#if description}
    <p class="text-sm text-md-on-surface/60 mb-6 max-w-sm">{description}</p>
  {/if}
  
  {#if actionLabel && onAction}
    <button class="px-3 py-1.5 text-sm rounded-xl bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors" onclick={(e) => { e.stopPropagation(); onAction(); }}>
      {actionLabel}
    </button>
  {/if}
</div>
