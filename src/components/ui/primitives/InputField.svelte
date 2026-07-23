<!--
  InputField.svelte — Reusable text/password/email input primitive
  ================================================================
  Provides a uniform Material Design 3 input appearance:
    - Border: md-outline-variant, highlights md-primary on focus
    - Background: md-surface-variant/40 (matches all current dialogs)
    - Font size: text-sm by default (standardized); use size="xs" for compact forms
    - Border radius: rounded-xl (consistent with button tokens)
  
  Supports:
    - Optional password toggle (set type="password" + showToggle)
    - Error state (pass error prop to show red border + message)
    - Leading icon slot
    - Fully accessible (label association via id/for)
-->
<script lang="ts">
import Icon from '@/components/icons/Icon.svelte';

interface Props {
  id?: string;
  type?: 'text' | 'password' | 'email' | 'search' | 'url' | 'number' | 'tel' | 'date';
  /** String for text fields; number supported when type="number" */
  value?: string | number;
  placeholder?: string;
  disabled?: boolean;
  /** Compact (xs) — for narrow forms/chips; default is sm */
  size?: 'xs' | 'sm';
  /** Show password-toggle eye button (only when type="password") */
  showToggle?: boolean;
  /** Red border + error message below the field */
  error?: string;
  autocomplete?: string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  class?: string;
  /** fired when value changes */
  oninput?: (e: Event & { currentTarget: HTMLInputElement }) => void;
  onkeydown?: (e: KeyboardEvent) => void;
}

let {
  id,
  type = 'text',
  value = $bindable('' as string | number),
  placeholder = '',
  disabled = false,
  size = 'sm',
  showToggle = false,
  error = '',
  autocomplete,
  min,
  max,
  step,
  class: extraClass = '',
  oninput,
  onkeydown,
}: Props = $props();

let revealed = $state(false);
let effectiveType = $derived(type === 'password' && revealed ? 'text' : type);

const sizeClasses: Record<NonNullable<Props['size']>, string> = {
  xs: 'px-3 py-1.5 text-xs',
  sm: 'px-3 py-2 text-sm',
};

const baseInput =
  'w-full bg-md-surface-variant/40 border rounded-xl text-md-on-surface ' +
  'focus:outline-none transition-colors ';

const borderClass = $derived(
  error
    ? 'border-md-error focus:border-md-error'
    : 'border-md-outline-variant focus:border-md-primary'
);
</script>

<div class="relative flex items-center {extraClass}">
  <input
    {id}
    type={effectiveType}
    bind:value
    {placeholder}
    {disabled}
    {min}
    {max}
    {step}
    autocomplete={autocomplete as never}
    class="{baseInput}{borderClass} {sizeClasses[size]} {showToggle ? 'pe-8' : ''}"
    {oninput}
    {onkeydown}
  />
  {#if showToggle && type === 'password'}
    <button
      type="button"
      class="absolute end-2.5 text-md-on-surface/40 hover:text-md-on-surface transition-colors"
      tabindex="-1"
      onclick={(e) => {
        e.stopPropagation();
        revealed = !revealed;
      }}
      aria-label={revealed ? 'Hide password' : 'Show password'}
    >
      <Icon name={revealed ? 'eyeOff' : 'eye'} class="w-3.5 h-3.5" />
    </button>
  {/if}
</div>
{#if error}
  <p class="mt-1 text-xs text-md-error">{error}</p>
{/if}
