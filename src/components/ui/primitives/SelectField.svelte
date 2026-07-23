<!--
  SelectField — MD3-aligned select primitive for consistent dropdowns.
-->
<script lang="ts">
interface Props {
  id?: string;
  value?: string | number;
  disabled?: boolean;
  size?: 'xs' | 'sm';
  error?: string;
  class?: string;
  ariaLabel?: string;
  onchange?: (e: Event & { currentTarget: HTMLSelectElement }) => void;
  children?: import('svelte').Snippet;
}

let {
  id,
  value = $bindable(''),
  disabled = false,
  size = 'sm',
  error = '',
  class: extraClass = '',
  ariaLabel,
  onchange,
  children,
}: Props = $props();

const sizeClasses: Record<NonNullable<Props['size']>, string> = {
  xs: 'px-2 py-1.5 text-xs',
  sm: 'px-3 py-2 text-sm',
};

const borderClass = $derived(
  error
    ? 'border-md-error focus:border-md-error'
    : 'border-md-outline-variant focus:border-md-primary'
);
</script>

<div class="relative {extraClass}">
  <select
    {id}
    bind:value
    {disabled}
    aria-label={ariaLabel}
    class="w-full bg-md-surface-variant/40 border rounded-xl text-md-on-surface outline-none transition-colors appearance-none pe-8 cursor-pointer disabled:opacity-50 {borderClass} {sizeClasses[size]}"
    {onchange}
  >
    {#if children}
      {@render children()}
    {/if}
  </select>
  <span
    class="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-md-on-surface/45 text-xs"
    aria-hidden="true">▾</span
  >
</div>
{#if error}
  <p class="mt-1 text-xs text-md-error">{error}</p>
{/if}
