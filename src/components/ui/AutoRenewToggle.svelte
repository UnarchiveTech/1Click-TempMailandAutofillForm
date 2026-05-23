<script lang="ts">
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
    font-size: 10px;
    font-weight: 700;
    font-family: system-ui, sans-serif;
    border-radius: 9999px;
    z-index: 2;
    transition: color 0.2s;
    white-space: nowrap;
    cursor: pointer;
    background: transparent;
    border: 0;
    line-height: 1;
  }

  .pill-option.active {
    color: var(--md-primary, #445e91);
  }

  .pill-option.inactive {
    color: var(--md-on-surface-variant, #44474f);
    opacity: 0.5;
  }

  .pill-label {
    font-size: 10px;
    font-weight: 700;
    font-family: system-ui, sans-serif;
    color: var(--md-on-surface, #1b1b1f);
    padding: 0 0.5rem;
    white-space: nowrap;
    align-self: center;
  }

  .pill-sep {
    width: 1px;
    align-self: stretch;
    background: var(--md-outline-variant, #c4c6d0);
    opacity: 0.4;
    margin: 3px 0;
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
    border-radius: 9999px;
    background: var(--md-surface, #ffffff);
    box-shadow: 0 1px 3px rgba(0,0,0,0.15);
    z-index: 1;
    transition: left 0.2s ease, width 0.2s ease;
    pointer-events: none;
  }
</style>

<div class="pill-toggle" role="group" aria-label="Auto-renew toggle">
  <!-- Label -->
  <span class="pill-label">Auto-Renew</span>

  <!-- Separator -->
  <span class="pill-sep"></span>

  <!-- Sliding track -->
  <div class="pill-track">
    <div
      class="pill-highlight"
      style="left: {autoRenew ? '2px' : 'calc(50% + 1px)'}; width: calc(50% - 3px);"
    ></div>

    <!-- ON option -->
    <button
      class="pill-option {autoRenew ? 'active' : 'inactive'}"
      onclick={(e) => { e.stopPropagation(); if (!autoRenew) onToggle?.(); }}
      aria-pressed={autoRenew}
    >
      On
    </button>

    <!-- OFF option -->
    <button
      class="pill-option {!autoRenew ? 'active' : 'inactive'}"
      onclick={(e) => { e.stopPropagation(); if (autoRenew) onToggle?.(); }}
      aria-pressed={!autoRenew}
    >
      Off
    </button>
  </div>
</div>
