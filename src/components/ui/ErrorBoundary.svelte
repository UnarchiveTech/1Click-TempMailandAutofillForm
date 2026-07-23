<script lang="ts">
/**
 * Re-export of the canonical layout ErrorBoundary (scoped mode).
 * Prefer importing from `@/components/layout/ErrorBoundary.svelte` for new code.
 */
import type { Snippet } from 'svelte';
import LayoutErrorBoundary from '@/components/layout/ErrorBoundary.svelte';

let {
  children,
  fallback = '',
  onRetry,
}: {
  children: Snippet;
  fallback?: string;
  onRetry?: () => void;
} = $props();
</script>

<LayoutErrorBoundary {fallback} {onRetry} fullRecovery={false}>
  {@render children()}
</LayoutErrorBoundary>
