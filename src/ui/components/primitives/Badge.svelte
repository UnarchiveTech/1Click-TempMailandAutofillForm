<script lang="ts">
import type { Snippet } from 'svelte';
import { t } from 'svelte-i18n';
import Icon from '@/ui/components/icons/Icon.svelte';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';
import { getContrastColor } from '@/utils/theme/color-utils.js';

export type BadgeVariant =
  | 'primary'
  | 'success'
  | 'warning'
  | 'error'
  | 'neutral'
  | 'outline'
  | 'tag';

let {
  variant = 'neutral',
  size = 'md',
  customColor = '',
  label = '',
  icon = undefined as KnownIconName | undefined,
  onRemove,
  class: className = '',
  children,
}: {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  customColor?: string;
  label?: string;
  icon?: KnownIconName;
  onRemove?: () => void;
  class?: string;
  children?: Snippet;
} = $props();

const variantClasses: Record<BadgeVariant, string> = {
  primary: 'bg-md-primary/15 text-md-primary border-md-primary/20',
  success: 'bg-md-success/15 text-md-success border-md-success/20',
  warning: 'bg-md-warning/15 text-md-warning border-md-warning/20',
  error: 'bg-md-error/15 text-md-error border-md-error/20',
  neutral: 'bg-md-surface-variant/40 text-md-on-surface/75 border-md-outline-variant/20',
  outline: 'border border-md-outline-variant/40 text-md-on-surface/80 bg-transparent',
  tag: 'bg-md-surface-container-high text-md-on-surface border-md-outline-variant/30',
};

const sizeClasses = {
  sm: 'px-1.5 py-0.5 text-label-sm gap-1',
  md: 'px-2.5 py-1 text-xs gap-1.5',
};

let inlineStyle = $derived(
  customColor ? `background-color: ${customColor}; color: ${getContrastColor(customColor)};` : ''
);
</script>

<span
  class="inline-flex items-center font-medium rounded-full border transition-colors select-none {sizeClasses[size]} {customColor ? '' : variantClasses[variant]} {className}"
  style={inlineStyle}
>
  {#if icon && variant !== 'tag'}
    <Icon name={icon} class={size === 'sm' ? 'w-3 h-3 shrink-0' : 'w-3.5 h-3.5 shrink-0'} />
  {/if}

  {#if label}
    <span class="inline-flex items-center min-w-0">{#if variant === 'tag'}<span aria-hidden="true">#</span>{/if}<span>{label}</span></span>
  {:else if children}
    {@render children()}
  {/if}

  {#if onRemove}
    <button
      type="button"
      class="flex items-center justify-center hover:opacity-75 focus:outline-none shrink-0"
      onclick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      aria-label={$t('common.remove')}
    >
      <Icon name="close" class={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
    </button>
  {/if}
</span>
