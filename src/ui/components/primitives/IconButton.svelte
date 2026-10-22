<script lang="ts">
/**
 * Shared icon-only button. In action rows this stays a normal descendant
 * `<button>` so the row's responsiveButtonLayout can measure and size it; the tier
 * belongs on the row, not on this primitive.
 */
import Icon from '@/ui/components/icons/Icon.svelte';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';

interface Props {
  icon: KnownIconName;
  /** Localized accessible name for the icon-only control. */
  ariaLabel: string;
  title?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'standard' | 'filled' | 'tonal' | 'outlined' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  class?: string;
  iconClass?: string;
  filled?: boolean;
  onclick?: (event: MouseEvent) => void;
  /** Backward-compatible event spelling used by existing controls. */
  onClick?: (event: MouseEvent) => void;
  [key: string]: unknown;
}

let {
  icon,
  ariaLabel,
  title,
  size,
  variant,
  disabled,
  type,
  class: extraClass,
  iconClass,
  filled,
  onclick,
  onClick,
  ...restProps
}: Props = $props();

const base =
  'md-action inline-flex shrink-0 items-center justify-center rounded-full transition-colors ' +
  'disabled:pointer-events-none disabled:opacity-50';

const sizeClasses: Record<NonNullable<Props['size']>, string> = {
  sm: 'size-8',
  md: 'size-10',
  lg: 'size-12',
};

const iconSizeClasses: Record<NonNullable<Props['size']>, string> = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-6 h-6',
};

const variantClasses: Record<NonNullable<Props['variant']>, string> = {
  standard: 'bg-transparent text-md-on-surface-variant',
  filled: 'bg-md-primary text-md-on-primary',
  tonal: 'bg-md-secondary-container text-md-on-secondary-container',
  outlined: 'border border-md-outline bg-transparent text-md-on-surface-variant',
  danger: 'bg-transparent text-md-error',
};

function buttonClass(
  buttonSize: NonNullable<Props['size']>,
  buttonVariant: NonNullable<Props['variant']>,
  additionalClass: string
): string {
  return [base, sizeClasses[buttonSize], variantClasses[buttonVariant], additionalClass]
    .filter(Boolean)
    .join(' ');
}

function handleClick(event: MouseEvent): void {
  event.stopPropagation();
  (onclick ?? onClick)?.(event);
}
</script>

<button
  type={type ?? 'button'}
  class={buttonClass(size ?? 'md', variant ?? 'standard', extraClass ?? '')}
  aria-label={ariaLabel}
  {title}
  {disabled}
  onclick={handleClick}
  {...restProps}
>
  <span class="pointer-events-none inline-flex items-center justify-center" aria-hidden="true">
    <Icon name={icon} class={iconClass ?? iconSizeClasses[size ?? 'md']} {filled} />
  </span>
</button>
