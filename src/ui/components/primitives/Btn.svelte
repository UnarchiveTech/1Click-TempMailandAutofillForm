<!--
  Btn.svelte - Reusable button primitive
  ==========================================
  Variants:
    primary        - filled brand colour (md-primary)
    secondary      - filled secondary (md-secondary)
    outline        - bordered, transparent fill
    ghost          - no border, light hover
    danger         - filled error colour (md-error)
    dangerOutline  - outlined error colour
    warning        - filled warning colour (md-warning)
    warningOutline - outlined warning colour (md-warning)
    tertiary       - filled tertiary colour (md-tertiary)
    primaryOutline - bordered primary accent (export/import style)
    tonal          - secondary container with matching on-container ink
    warningTonal   - soft warning tint (warning/20 fill, warning text)
    surface        - neutral container with matching surface ink

  Sizes:
    sm  - h-8 px-3 py-1.5 text-xs  (compact actions)
    md  - h-10 px-4 py-2  text-sm (DEFAULT - dialog buttons, nav actions)
    lg  - px-5 py-2.5 text-sm  (primary CTA on onboarding / full-width)

  ButtonGroup owns dimensions for grouped actions; size applies outside a group.
  label/icon provide shared markup without repeating fitting classes.
  Icon-only buttons (close X, snooze…) use IconButton; this component is for
  labelled buttons only. Both use the shared md-action state layers.
-->
<script lang="ts">
import type { Snippet } from 'svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';

interface Props {
  /** Visual treatment */
  variant?:
    | 'primary'
    | 'secondary'
    | 'outline'
    | 'ghost'
    | 'danger'
    | 'dangerOutline'
    | 'warning'
    | 'warningOutline'
    | 'tertiary'
    | 'primaryOutline'
    | 'tonal'
    | 'warningTonal'
    | 'surface';
  /** Use a div only for HTML5 drop targets that cannot use a native button. */
  as?: 'button' | 'div';
  label?: string;
  icon?: KnownIconName;
  dropActive?: boolean;
  dropTone?: 'warning' | 'danger' | 'primary' | 'tertiary';
  ondragover?: (e: DragEvent) => void;
  ondragenter?: (e: DragEvent) => void;
  ondragleave?: (e: DragEvent) => void;
  ondrop?: (e: DragEvent) => void;
  /** Height & text scale */
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  busy?: boolean;
  /** Backward-compatible alias used by existing callers. */
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
  /** Additional Tailwind classes (width overrides, flex, etc.) */
  class?: string;
  onclick?: (e: MouseEvent) => void;
  /** Backward-compatible event spelling used by existing callers. */
  onClick?: (e: MouseEvent) => void;
  children?: Snippet;
  /** Allow arbitrary HTML attributes like aria-label, data-*, etc. */
  [key: string]: unknown;
}

// Do not put fallback values in this `$props()` destructure. Svelte may model
// those defaults as lazy derived signals owned by the effect that instantiated
// this component (especially when Btn is rendered through a dialog snippet).
// Resolving defaults at read/render time keeps them owned by Btn itself and
// avoids `derived_inert` after the parent effect is destroyed.
let {
  variant,
  as,
  label,
  icon,
  dropActive,
  dropTone,
  size,
  disabled,
  busy,
  loading,
  type,
  class: extraClass,
  onclick,
  onClick,
  children,
  ...restProps
}: Props = $props();

// ── Base ──────────────────────────────────────────────────────────────────
const base =
  'md-action inline-flex items-center justify-center gap-1.5 font-medium rounded-xl transition-colors motion-press cursor-pointer ' +
  'disabled:opacity-50 disabled:pointer-events-none';

// ── Variants ──────────────────────────────────────────────────────────────
const variantMap: Record<NonNullable<Props['variant']>, string> = {
  primary: 'bg-md-primary text-md-on-primary',
  secondary: 'bg-md-secondary text-md-on-secondary',
  outline: 'border border-md-outline bg-transparent text-md-on-surface',
  ghost: 'bg-transparent text-md-on-surface',
  danger: 'bg-md-error text-md-on-error',
  dangerOutline: 'border border-md-error bg-transparent text-md-error',
  warning: 'bg-md-warning text-md-on-warning',
  warningOutline: 'border border-md-warning bg-transparent text-md-warning',
  tertiary: 'bg-md-tertiary text-md-on-tertiary',
  primaryOutline: 'border border-md-primary bg-transparent text-md-primary',
  tonal: 'bg-md-secondary-container text-md-on-secondary-container',
  warningTonal: 'bg-md-warning/20 text-md-warning',
  surface: 'bg-md-surface-container-high text-md-on-surface',
};

const dropColors = {
  warning: 'ring-md-warning',
  danger: 'ring-md-error',
  primary: 'ring-md-primary',
  tertiary: 'ring-md-tertiary',
};

// A filled target needs its own contrasting ink, not a ring in its fill color.
const filledDropColors: Partial<Record<NonNullable<Props['variant']>, string>> = {
  primary: 'ring-md-on-primary',
  secondary: 'ring-md-on-secondary',
  tertiary: 'ring-md-on-tertiary',
  danger: 'ring-md-on-error',
  warning: 'ring-md-on-warning',
  tonal: 'ring-md-on-secondary-container',
};

function dropClass(): string {
  if (!dropActive) return '';
  const color = filledDropColors[variant ?? 'primary'] ?? dropColors[dropTone ?? 'primary'];
  return `ring-2 ring-inset ${color}`;
}

function isDisabled(): boolean {
  return disabled === true || busy === true || loading === true;
}

function activate(e: MouseEvent): void {
  e.stopPropagation();
  if (!isDisabled()) (onclick ?? onClick)?.(e);
}

// ── Sizes ─────────────────────────────────────────────────────────────────
const sizeMap: Record<NonNullable<Props['size']>, string> = {
  sm: 'h-8 px-3 py-1.5 text-xs',
  md: 'h-10 px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-sm',
};

// Keep this as a plain function rather than a component-local $derived.
// Btn is frequently rendered through ModalDialog snippets; those snippets can
// be evaluated from an effect that is later destroyed, which makes a derived
// class value inert and produces Svelte's `derived_inert` runtime warning.
function buttonClass(
  buttonVariant: NonNullable<Props['variant']>,
  buttonSize: NonNullable<Props['size']>,
  additionalClass: string
): string {
  return [base, variantMap[buttonVariant], sizeMap[buttonSize], additionalClass]
    .filter(Boolean)
    .join(' ');
}
</script>

<svelte:element
  this={as ?? 'button'}
  type={as === 'div' ? undefined : (type ?? 'button')}
  role={as === 'div' ? 'button' : undefined}
  tabindex={as === 'div' ? (isDisabled() ? -1 : 0) : undefined}
  class="{buttonClass(variant ?? 'primary', size ?? 'md', extraClass ?? '')} {dropClass()}"
  disabled={as === 'div' ? undefined : isDisabled()}
  aria-disabled={isDisabled() || undefined}
  onclick={activate}
  onkeydown={(e: KeyboardEvent) => {
    if (as === 'div' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      e.stopPropagation();
      if (!isDisabled()) (e.currentTarget as HTMLElement).click();
    }
  }}
  {...restProps}
>
  {#if icon}<span class="btn-glyph shrink-0 pointer-events-none" aria-hidden="true"><Icon name={icon} class="w-5 h-5" /></span>{/if}
  {#if label !== undefined}<span class="btn-label leading-tight whitespace-nowrap overflow-visible pointer-events-none">{label}</span>{/if}
  {#if children}{@render children()}{/if}
</svelte:element>

<style>
.btn-glyph { display: inline-flex; align-items: center; justify-content: center; }
[aria-disabled='true'] { opacity: 0.5; pointer-events: none; }
</style>
