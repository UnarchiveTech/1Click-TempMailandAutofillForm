<script lang="ts">
/**
 * Reusable MD3 linear progress indicator.
 *
 * Determinate (`value`) renders a fill proportional to `value` (0-100) and is
 * announced via `role="progressbar"` with `aria-valuenow`. `indeterminate`
 * renders an animated sweeping fill for unknown-duration work (no numeric
 * readout) - pass it when an operation has no incremental progress signal.
 *
 * Usage:
 *   <ProgressBar value={42} label={$t('backup.exporting')} showValue />
 *   <ProgressBar indeterminate label={$t('backup.importing')} />
 */
export type ProgressTone = 'primary' | 'success' | 'warning' | 'error';
export type ProgressProps = {
  /** Completed percentage (0-100) for a determinate bar. */
  value?: number;
  /** Unknown-duration operation → animated sweep, no percentage readout. */
  indeterminate?: boolean;
  /** Optional short label shown above the bar. */
  label?: string;
  /** Show the rounded percentage at the right of the label row (determinate only). */
  showValue?: boolean;
  /** Bar thickness. */
  size?: 'sm' | 'md';
  /** MD3 fill tone. */
  tone?: ProgressTone;
};

let {
  value = 0,
  indeterminate = false,
  label,
  showValue = false,
  size = 'md',
  tone = 'primary',
  class: className = '',
}: ProgressProps & { class?: string } = $props();

const heights: Record<NonNullable<ProgressProps['size']>, string> = {
  sm: 'h-1.5',
  md: 'h-2',
};
const fills: Record<ProgressTone, string> = {
  primary: 'bg-md-primary',
  success: 'bg-md-success',
  warning: 'bg-md-warning',
  error: 'bg-md-error',
};

const clamped = $derived(Math.min(100, Math.max(0, value)));
const shownPct = $derived(Math.round(clamped));
const isDeterminate = $derived(!indeterminate);
</script>

<div class="w-full {className}">
  {#if label || (showValue && isDeterminate)}
    <div class="flex items-center justify-between gap-2 mb-1 ui-support font-medium">
      {#if label}
        <span class="min-w-0 truncate text-md-on-surface/70">{label}</span>
      {/if}
      {#if showValue && isDeterminate}
        <span class="shrink-0 font-mono text-md-primary">{shownPct}%</span>
      {/if}
    </div>
  {/if}
  <div
    class="w-full {heights[size]} overflow-hidden rounded-full bg-md-surface-variant/40"
    role="progressbar"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={isDeterminate ? clamped : undefined}
    aria-valuetext={indeterminate && label ? label : undefined}
  >
    {#if indeterminate}
      <div class="pb-indeterminate w-1/3 h-full rounded-full {fills[tone]}"></div>
    {:else}
      <div
        class="h-full rounded-full transition-all duration-150 {fills[tone]}"
        style="width: {clamped}%;"
      ></div>
    {/if}
  </div>
</div>

<style>
  .pb-indeterminate {
    animation: pb-slide 1.2s ease-in-out infinite;
  }
  @keyframes pb-slide {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(400%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pb-indeterminate {
      animation: none;
    }
  }
</style>
