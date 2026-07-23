<script lang="ts">
/**
 * MD3-style toggle switch (matches design: grey off / primary on + check thumb).
 * Default toggle used across the app.
 */
let {
  checked = false,
  disabled = false,
  ariaLabel = 'Toggle',
  id = undefined as string | undefined,
  onChange = (_next: boolean) => {},
  size = 'md' as 'sm' | 'md',
} = $props<{
  checked?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  onChange?: (next: boolean) => void;
  size?: 'sm' | 'md';
}>();

function handleClick(e: MouseEvent) {
  e.stopPropagation();
  if (disabled) return;
  onChange(!checked);
}

function handleKeydown(e: KeyboardEvent) {
  if (disabled) return;
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    onChange(!checked);
  }
}
</script>

<button
  type="button"
  role="switch"
  {id}
  aria-checked={checked}
  aria-label={ariaLabel}
  {disabled}
  class="md-toggle shrink-0 border-0 p-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed
    {size === 'sm' ? 'md-toggle-sm' : 'md-toggle-md'}
    {checked ? 'is-on' : ''}"
  onclick={handleClick}
  onkeydown={handleKeydown}
>
  <span class="md-toggle-thumb" aria-hidden="true">
    {#if checked}
      <svg class="md-toggle-check" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M5 12.5l4.5 4.5L19 7.5"
          stroke="currentColor"
          stroke-width="2.75"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    {/if}
  </span>
</button>

<style>
  .md-toggle {
    position: relative;
    display: inline-flex;
    align-items: center;
    border-radius: 9999px;
    background-color: color-mix(in srgb, var(--md-outline-variant) 85%, var(--md-surface));
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--md-outline) 35%, transparent);
    transition:
      background-color var(--motion-med, 200ms) var(--motion-ease, cubic-bezier(0.2, 0, 0, 1)),
      box-shadow var(--motion-med, 200ms) var(--motion-ease, cubic-bezier(0.2, 0, 0, 1));
    flex-shrink: 0;
  }
  .md-toggle.is-on {
    background-color: var(--md-primary);
    box-shadow: none;
  }
  .md-toggle-md {
    width: 2.75rem; /* 44px */
    height: 1.5rem; /* 24px */
  }
  .md-toggle-sm {
    width: 2.25rem;
    height: 1.25rem;
  }
  .md-toggle-thumb {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    inset-inline-start: 0.1875rem;
    border-radius: 9999px;
    background: color-mix(in srgb, var(--md-on-surface-variant) 75%, var(--md-surface));
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.18);
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--md-primary);
    transition:
      inset-inline-start var(--motion-med, 200ms) var(--motion-spring, cubic-bezier(0.34, 1.4, 0.64, 1)),
      background-color var(--motion-med, 200ms) var(--motion-ease, cubic-bezier(0.2, 0, 0, 1)),
      transform var(--motion-fast, 120ms) var(--motion-ease, cubic-bezier(0.2, 0, 0, 1));
  }
  .md-toggle-md .md-toggle-thumb {
    width: 1.125rem; /* 18px */
    height: 1.125rem;
  }
  .md-toggle-sm .md-toggle-thumb {
    width: 0.9375rem;
    height: 0.9375rem;
  }
  .md-toggle.is-on .md-toggle-thumb {
    background: #fff;
    color: var(--md-primary);
  }
  .md-toggle-md.is-on .md-toggle-thumb {
    inset-inline-start: calc(100% - 0.1875rem - 1.125rem);
  }
  .md-toggle-sm.is-on .md-toggle-thumb {
    inset-inline-start: calc(100% - 0.1875rem - 0.9375rem);
  }
  .md-toggle-check {
    width: 70%;
    height: 70%;
  }
  .md-toggle:hover:not(:disabled):not(.is-on) {
    background-color: color-mix(in srgb, var(--md-outline-variant) 95%, var(--md-on-surface));
  }
  .md-toggle.is-on:hover:not(:disabled) {
    filter: brightness(1.06);
  }
  .md-toggle:active:not(:disabled) .md-toggle-thumb {
    transform: translateY(-50%) scale(0.92);
  }
  .md-toggle:focus-visible {
    outline: 2px solid var(--md-primary);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .md-toggle,
    .md-toggle-thumb {
      transition: none;
    }
  }
</style>
