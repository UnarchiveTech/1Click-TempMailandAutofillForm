<script lang="ts">
import { t } from 'svelte-i18n';

interface Props {
  autoRenew: boolean;
  onToggle?: () => void;
}

const { autoRenew, onToggle }: Props = $props();
</script>

<style>
  .pill-toggle {
    display: inline-flex;
    align-items: center;
    border-radius: 9999px;
    border: 1px solid var(--md-outline-variant, #c4c6d0);
    background: var(--md-surface-container-low, #f7f2fa);
    user-select: none;
    gap: 0;
    overflow: hidden;
  }

  .pill-option {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.2rem 0.6rem;
    /* MD3 label-medium */
    font-size: var(--md-type-label-medium-size, 0.75rem);
    line-height: var(--md-type-label-medium-line, 1rem);
    font-weight: 700;
    font-family: inherit;
    border-radius: 9999px;
    z-index: 2;
    transition: color 0.2s;
    white-space: nowrap;
    cursor: pointer;
    background: transparent;
    border: 0;
  }

  .pill-option.active {
    color: var(--md-primary, #445e91);
  }

  .pill-option.inactive {
    color: var(--md-on-surface-variant, #44474f);
    opacity: 0.5;
  }

  .pill-label {
    font-size: var(--md-type-label-medium-size, 0.75rem);
    line-height: var(--md-type-label-medium-line, 1rem);
    font-weight: 700;
    font-family: inherit;
    color: var(--md-on-surface, #1b1b1f);
    padding: 0 0.5rem;
    white-space: nowrap;
    align-self: center;
  }

  .pill-track {
    display: inline-flex;
    position: relative;
    padding: 2px 3px;
    border-radius: 9999px;
    background: var(--md-secondary-container, #e2e5f0);
  }

  .pill-highlight {
    position: absolute;
    top: 2px;
    bottom: 2px;
    /* Physical left used intentionally with transform-free width; flipped via logical start below */
    border-radius: 9999px;
    background: var(--md-surface, #ffffff);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
    z-index: 1;
    transition:
      inset-inline-start 0.2s ease,
      width 0.2s ease;
    pointer-events: none;
  }
</style>

<div class="pill-toggle" role="group" aria-label={$t('account.autoRenew')}>
  <!-- Label (no vertical divider) -->
  <span class="pill-label">{$t('account.autoRenew')}</span>

  <!-- Sliding track — use inset-inline for RTL -->
  <div class="pill-track">
    <div
      class="pill-highlight"
      style="inset-inline-start: {autoRenew ? '2px' : 'calc(50% + 1px)'}; width: calc(50% - 3px);"
    ></div>

    <!-- ON option -->
    <button
      type="button"
      class="pill-option {autoRenew ? 'active' : 'inactive'}"
      onclick={(e) => { e.stopPropagation(); if (!autoRenew) onToggle?.(); }}
      aria-pressed={autoRenew}
    >
      {$t('common.on')}
    </button>

    <!-- OFF option -->
    <button
      type="button"
      class="pill-option {!autoRenew ? 'active' : 'inactive'}"
      onclick={(e) => { e.stopPropagation(); if (autoRenew) onToggle?.(); }}
      aria-pressed={!autoRenew}
    >
      {$t('common.off')}
    </button>
  </div>
</div>
