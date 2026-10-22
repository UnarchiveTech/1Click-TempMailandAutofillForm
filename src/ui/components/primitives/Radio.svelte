<script lang="ts">
/**
 * Radio - MD3 radio button with hover/pressed state layers.
 *
 * Renders a real (visually-hidden) <input type="radio"> for semantics and
 * label-activation plus the radioButtonChecked / radioButtonUnchecked glyph. Native radios
 * use bind:group; this component instead takes checked + onchange - the parent
 * owns the group value (e.g. checked={group === 'a'} onchange={() => group = 'a'}).
 */
import Icon from '@/ui/components/icons/Icon.svelte';

interface Props {
  checked?: boolean;
  disabled?: boolean;
  /** Radio group name (form semantics). */
  name?: string;
  value?: string;
  /** 'md' = 40px target / 24px glyph, 'sm' = 32px target / 20px glyph */
  size?: 'sm' | 'md';
  id?: string;
  class?: string;
  ariaLabel?: string;
  onchange?: (e: Event & { currentTarget: HTMLInputElement }) => void;
}

let {
  checked = $bindable(false),
  disabled = false,
  name,
  value,
  size = 'md',
  id,
  class: className = '',
  ariaLabel,
  onchange,
}: Props = $props();

const target = $derived(size === 'sm' ? 'w-8 h-8' : 'w-10 h-10');
const glyph = $derived(size === 'sm' ? 'w-5 h-5' : 'w-6 h-6');
</script>

<span
  class="relative inline-flex shrink-0 items-center justify-center align-middle rounded-full select-none {target} {disabled ? 'opacity-40' : ''} {className}"
>
  <input
    {id}
    {name}
    {value}
    type="radio"
    class="md-choice-input absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed m-0"
    checked={checked}
    {disabled}
    aria-label={ariaLabel}
    onchange={(e) => {
      checked = e.currentTarget.checked;
      onchange?.(e);
    }}
  />
  <span
    class="md-choice-state flex items-center justify-center rounded-full pointer-events-none transition-colors {target} {checked
      ? 'text-md-primary'
      : 'text-md-on-surface-variant'}"
    aria-hidden="true"
  >
    <Icon name={checked ? 'radioButtonChecked' : 'radioButtonUnchecked'} class={glyph} />
  </span>
</span>
