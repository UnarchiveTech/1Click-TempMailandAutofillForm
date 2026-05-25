<script lang="ts">
import type { Snippet } from 'svelte';
import IconAlertTriangle from '@/components/icons/IconAlertTriangle.svelte';
import { logError } from '@/utils/logger.js';

interface Props {
  children: Snippet;
  fallback?: string;
  onRetry?: () => void;
}

let { children, fallback = 'Something went wrong', onRetry }: Props = $props();

let error = $state<Error | null>(null);
let errorInfo = $state<string>('');

export function setError(err: Error, info: string) {
  error = err;
  errorInfo = info;
  logError('ErrorBoundary caught error:', { error: err, info });
}

export function clearError() {
  error = null;
  errorInfo = '';
}

function handleRetry() {
  clearError();
  if (onRetry) {
    onRetry();
  }
}
</script>

{#if !error}
  {@render children()}
{/if}

{#if error}
  <div class="flex flex-col items-center justify-center p-8 min-h-[200px] bg-md-error-container/10 rounded-xl border border-md-error/20">
    <div class="w-12 h-12 rounded-full bg-md-error/10 flex items-center justify-center mb-4">
      <IconAlertTriangle class="w-6 h-6 text-md-error" />
    </div>
    <h3 class="text-base font-semibold text-md-error mb-2">Error</h3>
    <p class="text-sm text-md-on-surface/70 text-center mb-4">{fallback}</p>
    {#if errorInfo}
      <p class="text-xs text-md-on-surface/50 text-center mb-4 font-mono">{errorInfo}</p>
    {/if}
    <div class="flex gap-2">
      {#if onRetry}
        <button
          class="px-4 py-2 text-sm font-semibold rounded-lg bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-colors"
          onclick={handleRetry}
        >
          Retry
        </button>
      {/if}
      <button
        class="px-4 py-2 text-sm font-semibold rounded-lg bg-md-secondary-container text-md-on-surface hover:bg-md-secondary-container/80 transition-colors"
        onclick={clearError}
      >
        Dismiss
      </button>
    </div>
  </div>
{/if}

<style>
  :global(.error-boundary-fallback) {
    animation: fadeIn 0.3s ease-in;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
