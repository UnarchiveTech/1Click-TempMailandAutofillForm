<!--
  Btn.svelte — Reusable button primitive
  ==========================================
  Variants:
    primary      — filled brand colour (md-primary)
    secondary    — filled secondary (md-secondary)
    outline      — bordered, transparent fill
    ghost        — no border, light hover
    danger       — filled error colour (md-error)
    dangerOutline — outlined error colour

  Sizes:
    sm  — px-3 py-1.5 text-xs  (chips, compact toolbars)
    md  — px-4 py-2   text-sm  (DEFAULT — dialog buttons, nav actions)
    lg  — px-5 py-2.5 text-sm  (primary CTA on onboarding / full-width)

  All dialog action buttons should use size="md" (the default).
  Icon-only buttons (close X, snooze…) should use the raw <button> with the
  icon-btn CSS utility or manually apply size classes; this component is for
  labelled buttons only.
-->
<script lang="ts">
import type { Snippet } from 'svelte';

interface Props {
  /** Visual treatment */
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'dangerOutline';
  /** Height & text scale */
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  busy?: boolean;
  type?: 'button' | 'submit' | 'reset';
  /** Additional Tailwind classes (width overrides, flex, etc.) */
  class?: string;
  onclick?: (e: MouseEvent) => void;
  children: Snippet;
  /** Allow arbitrary HTML attributes like aria-label, data-*, etc. */
  [key: string]: unknown;
}

let {
  variant = 'primary',
  size = 'md',
  disabled = false,
  busy = false,
  type = 'button',
  class: extraClass = '',
  onclick,
  children,
  ...restProps
}: Props = $props();

// ── Base ──────────────────────────────────────────────────────────────────
const base =
  'inline-flex items-center justify-center gap-1.5 font-medium rounded-xl transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary/50 ' +
  'disabled:opacity-50 disabled:pointer-events-none';

// ── Variants ──────────────────────────────────────────────────────────────
const variantMap: Record<NonNullable<Props['variant']>, string> = {
  primary: 'bg-md-primary text-md-on-primary hover:bg-md-primary/90',
  secondary: 'bg-md-secondary text-md-on-secondary hover:bg-md-secondary/90',
  outline: 'border border-md-outline-variant/40 text-md-on-surface hover:bg-md-surface-variant/40',
  ghost: 'bg-transparent text-md-on-surface hover:bg-md-surface-variant/50',
  danger: 'bg-md-error text-md-on-error hover:bg-md-error/90',
  dangerOutline: 'border border-md-error text-md-error hover:bg-md-error/10',
};

// ── Sizes ─────────────────────────────────────────────────────────────────
const sizeMap: Record<NonNullable<Props['size']>, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-sm',
};

// Use $derived so the class recomputes whenever variant/size/extraClass change
let cls = $derived(
  [base, variantMap[variant], sizeMap[size], extraClass].filter(Boolean).join(' ')
);
</script>

<button
  {type}
  class={cls}
  disabled={disabled || busy}
  onclick={(e) => {
    e.stopPropagation();
    if (onclick) onclick(e);
  }}
  {...restProps}
>
  {@render children()}
</button>
