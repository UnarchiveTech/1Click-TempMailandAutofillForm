<!--
  InputField.svelte - Reusable text/password/email input primitive
  ================================================================
  Provides a uniform Material Design 3 input appearance:
    - Compact: outline-variant border, surface-variant wash, rounded corners
    - Outlined: 56px field, floating label, body-large text and extra-small shape
    - Both: primary focus cue, associated error text and native input semantics
  
  Supports:
    - Optional password toggle (set type="password" + showToggle)
    - Error state (pass error prop to show red border + message)
    - Leading icon slot
    - Fully accessible (label association via id/for)
-->
<script lang="ts">
import { t } from 'svelte-i18n';
import IconButton from '@/ui/components/primitives/IconButton.svelte';

interface Props {
  id?: string;
  /** Opt-in MD3 outlined field with a floating, associated label. */
  variant?: 'compact' | 'outlined';
  label?: string;
  type?: 'text' | 'password' | 'email' | 'search' | 'url' | 'number' | 'tel' | 'date';
  /** String for text fields; number supported when type="number" */
  value?: string | number;
  placeholder?: string;
  disabled?: boolean;
  /** Compact (xs) - for narrow forms/chips; default is sm */
  size?: 'xs' | 'sm';
  /** Show password-toggle eye button (only when type="password") */
  showToggle?: boolean;
  /** Red border + error message below the field */
  error?: string;
  autocomplete?: string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  maxlength?: number;
  class?: string;
  /** fired when value changes */
  oninput?: (e: Event & { currentTarget: HTMLInputElement }) => void;
  onkeydown?: (e: KeyboardEvent) => void;
  onpaste?: (e: ClipboardEvent) => void;
  onblur?: (e: FocusEvent & { currentTarget: HTMLInputElement }) => void;
}

let {
  id,
  variant = 'compact',
  label,
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
  maxlength,
  class: extraClass = '',
  oninput,
  onkeydown,
  onpaste,
  onblur,
}: Props = $props();

let revealed = $state(false);
const fieldId = $props.id();
const inputId = $derived(id || fieldId);
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

<div class="flex flex-col gap-1 {extraClass}">
  {#if label && variant !== 'outlined'}
    <label for={inputId} class="ui-label text-md-on-surface-variant">{label}</label>
  {/if}
  <div class="relative flex items-center" class:outlined-field={variant === 'outlined'}>
  <input
    id={inputId}
    type={effectiveType}
    bind:value
    placeholder={variant === 'outlined' && label ? ' ' : placeholder}
    aria-invalid={error ? true : undefined}
    aria-describedby={error ? `${inputId}-error` : undefined}
    {disabled}
    {min}
    {max}
    {step}
    {maxlength}
    autocomplete={autocomplete as never}
    class="{baseInput}{borderClass} {sizeClasses[size]} {showToggle && type === 'password' ? 'password-field' : ''}"
    {oninput}
    {onkeydown}
    {onpaste}
    {onblur}
  />
  {#if label && variant === 'outlined'}
    <label for={inputId}>{label}</label>
  {/if}
  {#if showToggle && type === 'password'}
    <IconButton
      icon={revealed ? 'visibilityOff' : 'visibility'}
      size="sm"
      class="absolute end-1"
      onclick={(e) => {
        e.stopPropagation();
        revealed = !revealed;
      }}
      disabled={disabled}
      ariaLabel={revealed ? $t('common.hidePassword') : $t('common.showPassword')}
      title={revealed ? $t('common.hidePassword') : $t('common.showPassword')}
      aria-pressed={revealed}
    />
  {/if}
  </div>
  {#if error}
    <p id={`${inputId}-error`} class="text-xs text-md-error" aria-live="polite">{error}</p>
  {/if}
</div>

<style>
  .password-field {
    min-height: 36px;
    padding-inline-end: 40px;
  }
  .outlined-field .password-field {
    padding-inline-end: 48px;
  }
  input:disabled {
    cursor: not-allowed;
  }
  input:focus {
    box-shadow: inset 0 0 0 1px var(--md-primary);
  }
  input[aria-invalid='true']:focus {
    box-shadow: inset 0 0 0 1px var(--md-error);
  }
  .outlined-field input {
    height: 56px;
    padding-inline: 16px;
    border-radius: var(--md-shape-extra-small, 4px);
    background: transparent;
    border-color: var(--md-outline);
    font-size: var(--md-type-body-large-size);
    line-height: var(--md-type-body-large-line);
    letter-spacing: var(--md-type-body-large-tracking);
  }
  .outlined-field label {
    position: absolute;
    inset-inline-start: 12px;
    padding-inline: 4px;
    color: var(--md-on-surface-variant);
    background: var(--input-label-surface, var(--md-surface-container-high));
    font-size: var(--md-type-body-large-size);
    pointer-events: none;
    transition: top 150ms, font-size 150ms, color 150ms;
    top: 16px;
  }
  .outlined-field input:focus + label,
  .outlined-field input:not(:placeholder-shown) + label {
    top: -8px;
    font-size: var(--md-type-body-small-size);
  }
  .outlined-field input:focus {
    border-color: var(--md-primary);
    box-shadow: inset 0 0 0 1px var(--md-primary);
  }
  .outlined-field input:focus + label { color: var(--md-primary); }
  .outlined-field input[aria-invalid='true'] {
    border-color: var(--md-error);
  }
  .outlined-field input[aria-invalid='true']:focus {
    box-shadow: inset 0 0 0 1px var(--md-error);
  }
  .outlined-field input[aria-invalid='true'] + label { color: var(--md-error); }
  .outlined-field input:disabled { opacity: 0.38; }
  .outlined-field input:disabled + label { opacity: 0.38; }
  @media (prefers-reduced-motion: reduce) {
    .outlined-field label { transition: none; }
  }
</style>
