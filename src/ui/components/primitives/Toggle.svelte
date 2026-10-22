<script lang="ts">
/**
 * MD3-style toggle switch (matches design: grey off / primary on + check thumb).
 * Default toggle used across the app.
 */
import { t } from 'svelte-i18n';
import Icon from '@/ui/components/icons/Icon.svelte';

let {
  checked = false,
  disabled = false,
  ariaLabel = undefined as string | undefined,
  id = undefined as string | undefined,
  onChange = (_next: boolean) => {},
  size = 'md' as 'sm' | 'md',
}: {
  checked?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  onChange?: (next: boolean) => void;
  size?: 'sm' | 'md';
} = $props();

function handleClick(e: MouseEvent) {
  e.stopPropagation();
  if (disabled) return;
  onChange(!checked);
}
</script>

<button
  type="button"
  role="switch"
  {id}
  aria-checked={checked}
  aria-label={ariaLabel ?? $t('common.toggle')}
  {disabled}
  class="md-toggle shrink-0 border-0 p-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed
    {size === 'sm' ? 'md-toggle-sm' : 'md-toggle-md'}
    {checked ? 'is-on' : ''}"
  onclick={handleClick}
>
  <span class="md-toggle-thumb" aria-hidden="true">
    {#if checked}
      <span class="md-toggle-check" aria-hidden="true">
        <Icon name="check" class="w-full h-full" />
      </span>
    {/if}
  </span>
</button>

<style>
  .md-toggle {
    position: relative;
    display: inline-flex;
    align-items: center;
    border-radius: 9999px;
    background-color: var(--md-surface-container-highest);
    box-shadow: inset 0 0 0 2px var(--md-outline);
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
    width: 3.25rem; /* 52px - MD3 standard switch width */
    height: 2rem; /* 32px - MD3 standard switch height */
  }
  .md-toggle-sm {
    width: 2.75rem; /* 44px */
    height: 1.5rem; /* 24px */
  }
  .md-toggle-thumb {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    inset-inline-start: 0.5rem;
    border-radius: 9999px;
    background: var(--md-outline);
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--md-primary);
    transition:
      inset-inline-start var(--motion-med, 200ms) var(--motion-spring, cubic-bezier(0.34, 1.4, 0.64, 1)),
      width var(--motion-fast, 120ms) var(--motion-ease, cubic-bezier(0.2, 0, 0, 1)),
      height var(--motion-fast, 120ms) var(--motion-ease, cubic-bezier(0.2, 0, 0, 1)),
      background-color var(--motion-med, 200ms) var(--motion-ease, cubic-bezier(0.2, 0, 0, 1)),
      transform var(--motion-fast, 120ms) var(--motion-ease, cubic-bezier(0.2, 0, 0, 1));
  }
  .md-toggle-md .md-toggle-thumb {
    width: 1rem; /* 16px unselected thumb */
    height: 1rem;
  }
  .md-toggle-sm .md-toggle-thumb {
    width: 0.75rem;
    height: 0.75rem;
    inset-inline-start: 0.375rem;
  }
  .md-toggle.is-on .md-toggle-thumb {
    background: var(--md-on-primary);
    color: var(--md-primary);
  }
  .md-toggle-md.is-on .md-toggle-thumb {
    width: 1.5rem; /* 24px selected thumb */
    height: 1.5rem;
    inset-inline-start: calc(100% - 0.25rem - 1.5rem);
  }
  .md-toggle-sm.is-on .md-toggle-thumb {
    width: 1.125rem;
    height: 1.125rem;
    inset-inline-start: calc(100% - 0.1875rem - 1.125rem);
  }
  .md-toggle-check {
    width: 70%;
    height: 70%;
  }
  .md-toggle-thumb::before {
    content: '';
    position: absolute;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: inherit;
    pointer-events: none;
    --switch-state-ink: var(--md-on-surface-variant);
  }
  .md-toggle.is-on .md-toggle-thumb::before {
    --switch-state-ink: var(--md-primary);
  }
  .md-toggle:hover:not(:disabled) .md-toggle-thumb::before {
    background: color-mix(in srgb, var(--switch-state-ink) 8%, transparent);
  }
  .md-toggle:active:not(:disabled) .md-toggle-thumb::before,
  .md-toggle:focus-visible .md-toggle-thumb::before {
    background: color-mix(in srgb, var(--switch-state-ink) 12%, transparent);
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
