<script lang="ts">
import Icon from '@/components/icons/Icon.svelte';

interface Props {
  expiryTime: number; // Time remaining in minutes
  autoRenew: boolean;
  maxExpiryTime?: number; // Maximum expiry time for full progress (default: 60 minutes)
  onToggleAutoRenew?: () => void;
  themeColor?: string; // Primary theme color (default: Indigo #6366F1)
}

const {
  expiryTime,
  autoRenew,
  maxExpiryTime = 60,
  onToggleAutoRenew,
  themeColor = 'var(--md-primary)',
}: Props = $props();

// Calculate progress percentage (0-100)
const progressPercentage = $derived(Math.min(Math.max((expiryTime / maxExpiryTime) * 100, 0), 100));

// Calculate time remaining text
let timeText = $state('');
$effect(() => {
  const h = Math.floor(expiryTime / 60);
  const m = expiryTime % 60;
  if (h > 0) {
    timeText = m > 0 ? `${h}h ${m}m` : `${h}h`;
  } else {
    timeText = `${Math.ceil(expiryTime)}m`;
  }
});

// Status text based on auto-renew state
const statusText = $derived(autoRenew ? `Auto-renews in ${timeText}` : `Expires in ${timeText}`);

// Icon color based on auto-renew state
const iconColorClass = $derived(
  autoRenew ? 'text-[var(--md-primary)]' : 'text-md-on-surface-variant'
);

// Build the conic gradient: theme color sweeps clockwise to show progress, base color fills the rest
const borderGradient = $derived(
  `conic-gradient(from -90deg, ${themeColor} 0% ${progressPercentage}%, var(--ep-border-base) ${progressPercentage}% 100%)`
);
</script>

<style>
  /* Outer wrapper shows the conic gradient as the visible border */
  .expiry-pill-outer {
    display: inline-flex;
    padding: 2px;
    border-radius: 9999px;
    background: var(--border-gradient);
  }

  /* Inner content area — opaque background hides the gradient in the center */
  .expiry-pill {
    font-family: system-ui, sans-serif;
    padding: 0.25rem 0.5rem;
    border-radius: 9999px;
    background: var(--ep-bg);
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    min-width: 116px;
    height: 24px;
    color: var(--ep-text);
  }

  :global(:root) {
    --ep-border-base: var(--md-secondary-container);
    --ep-bg: var(--md-surface);
    --ep-text: var(--md-on-surface);
  }

  :global([data-theme="dark"]) {
    --ep-border-base: var(--md-secondary-container);
    --ep-bg: var(--md-surface);
    --ep-text: var(--md-on-surface);
  }

  .clock-button {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.125rem;
    border-radius: 0.75rem;
    cursor: pointer;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
  }

  .clock-button:hover {
    background-color: color-mix(in srgb, var(--md-primary, #445e91) 15%, transparent);
  }

  .icon-display {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    border-radius: 0.75rem;
  }

  .status-text {
    font-size: 0.6875rem;
    font-weight: 700;
    color: currentColor;
    padding-right: 0.25rem;
    white-space: nowrap;
  }
</style>

<div
  class="expiry-pill-outer"
  style="--border-gradient: {borderGradient}; --md-primary: {themeColor};"
>
  <div class="expiry-pill">
    {#if onToggleAutoRenew}
      <button
        class="clock-button {iconColorClass}"
        onclick={onToggleAutoRenew}
        aria-label={autoRenew ? 'Disable auto-renew' : 'Enable auto-renew'}
        title={autoRenew ? 'Disable auto-renew' : 'Enable auto-renew'}
      >
        <Icon name="autoRenew" />
      </button>
    {:else}
      <div class="icon-display {iconColorClass}">
        <Icon name="autoRenew" />
      </div>
    {/if}
    <span class="status-text">{statusText}</span>
  </div>
</div>
