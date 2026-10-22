<script lang="ts">
import Skeleton from '@/ui/components/primitives/Skeleton.svelte';

interface Props {
  className?: string;
  ariaLabel?: string;
}

let { className = '', ariaLabel }: Props = $props();
let rootEl = $state<HTMLElement | null>(null);
let rowCount = $state(3);

$effect(() => {
  const root = rootEl;
  if (!root) return;

  const updateRowCount = () => {
    // Reserve space for the heading, vertical padding, and row gaps, then fill
    // the remaining height with 72px rows plus their 12px gap.
    rowCount = Math.max(1, Math.floor((root.clientHeight - 56) / 84));
  };
  updateRowCount();
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(updateRowCount);
    observer.observe(root);
    return () => observer.disconnect();
  }
  window.addEventListener('resize', updateRowCount);
  return () => window.removeEventListener('resize', updateRowCount);
});
</script>

<div bind:this={rootEl} class={className} aria-busy="true" aria-label={ariaLabel}>
  <Skeleton width="42%" height="1.25rem" />
  {#each Array(rowCount) as _, i (i)}
    <Skeleton width={i === rowCount - 1 ? '78%' : '100%'} height="4.5rem" radius="0.75rem" />
  {/each}
</div>
