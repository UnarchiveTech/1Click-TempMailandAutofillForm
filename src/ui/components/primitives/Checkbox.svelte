<script lang="ts">
/**
 * Checkbox - MD3 checkbox with hover/pressed state layers.
 *
 * Renders a real (visually-hidden) <input type="checkbox"> so label-activation,
 * form semantics and keyboard toggling behave exactly like a native checkbox,
 * plus the MD3 filled selected box and contrasting checkmark. Drop-in replacement for native
 * checkboxes: supports checked (bindable), onchange (native event), disabled,
 * size.
 *
 * The native input covers the hit area. Both direct clicks and an enclosing
 * label use native activation, with exactly one change event per toggle.
 */
import Icon from '@/ui/components/icons/Icon.svelte';

interface Props {
  checked?: boolean;
  disabled?: boolean;
  /** Compact glyphs, or MD3's 18px box / 40px state layer / 48px touch target. */
  size?: 'sm' | 'md' | 'touch';
  id?: string;
  class?: string;
  ariaLabel?: string;
  onchange?: (e: Event & { currentTarget: HTMLInputElement }) => void;
}

let {
  checked = $bindable(false),
  disabled = false,
  size = 'md',
  id,
  class: className = '',
  ariaLabel,
  onchange,
}: Props = $props();

const target = $derived(size === 'touch' ? 'w-12 h-12' : size === 'sm' ? 'w-8 h-8' : 'w-10 h-10');
</script>

<span
  class="relative inline-flex shrink-0 items-center justify-center align-middle select-none rounded-full {target} {className}"
>
  <input
    {id}
    type="checkbox"
    class="md-choice-input absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed m-0"
    {checked}
    {disabled}
    aria-label={ariaLabel}
    onchange={(event) => {
      // A consumer may reject the toggle by restoring the native value.
      // Mirror that final value so both the bound state and glyph agree.
      onchange?.(event);
      checked = event.currentTarget.checked;
    }}
  />
  <span
    class="md-choice-state flex items-center justify-center rounded-full pointer-events-none transition-colors {size === 'touch' ? 'w-10 h-10' : target} {checked ? 'text-md-primary' : 'text-md-on-surface-variant'}"
    aria-hidden="true"
  >
    <span class="checkbox-box" class:checked class:disabled>
      {#if checked}<Icon name="check" class="w-full h-full" />{/if}
    </span>
  </span>
</span>

<style>
  .checkbox-box {
    width: 18px;
    height: 18px;
    border: 2px solid var(--md-on-surface-variant);
    border-radius: 2px;
    box-sizing: border-box;
  }
  .checkbox-box.checked {
    border-width: 0;
    border-color: transparent;
    background: var(--md-primary);
    color: var(--md-on-primary);
  }
  .checkbox-box.disabled {
    border-color: color-mix(in srgb, var(--md-on-surface) 38%, transparent);
  }
  .checkbox-box.checked.disabled {
    border-color: transparent;
    background: color-mix(in srgb, var(--md-on-surface) 38%, transparent);
    color: var(--md-surface);
  }
  @media (forced-colors: active) {
    .checkbox-box { border-color: CanvasText; }
    .checkbox-box.checked { background: CanvasText; color: Canvas; }
    .checkbox-box.disabled { border-color: GrayText; }
    .checkbox-box.checked.disabled { background: GrayText; color: Canvas; }
  }
</style>
