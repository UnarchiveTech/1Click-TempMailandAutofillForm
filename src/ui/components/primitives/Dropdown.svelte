<script lang="ts">
/**
 * Dropdown - reusable MD3 select / menu button with a custom menu surface.
 *
 * Replaces native <select> where MD3 state layers and consistent styling are
 * wanted. The trigger is a button (role=combobox) with an MD3 surface + state
 * layers; the menu is a body-portaled `position:fixed` surface (escapes
 * scroll/transform clipping) built on the global .menu-list / .menu-list-item
 * classes.
 *
 * Menu surface (MD3 menus spec): 4dp extra-small shape · surface-container ·
 * elevation level 2 · 8dp vertical padding · no outline. Items: 48dp height ·
 * 12dp leading/trailing padding · 24dp icons · Label Large · state layers
 * hover 8% / focus 10% / pressed 10% · selected secondary-container · disabled
 * 38%. Menu width 112dp (min) to 280dp (max).
 *
 * Trigger sizes:
 *   'xs' / 'sm' - compact labeled form fields.
 *   'button'    - MD3 Small button (40dp, 12dp shape, Label Large, 20dp icons,
 *                 16dp padding) for a control whose job is to open the menu.
 * Variants: 'filled' | 'outlined' | 'secondary' (MD3 filled tonal) |
 *           'elevated' (MD3 elevated button: surface-container-low, primary
 *           label, elevation level 1).
 *
 * Pass a `leading` snippet for content before the label (an avatar, for
 * example) - it is skipped from the accessible name, which stays the label.
 *
 * Keyboard: Enter/Space/↑/↓ open · ↑/↓ navigate · Enter/Space select ·
 * Home/End jump · Esc closes · Tab closes and moves focus on.
 */
import { onDestroy, type Snippet } from 'svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { PORTAL_Z } from '@/utils/ui/portal-layers.js';
import { rowSurface } from '@/utils/ui/row-surface.js';

export interface DropdownOption {
  value: string | number;
  label: string;
  hint?: string;
  disabled?: boolean;
}

interface Props {
  /** Selected value - bindable, or controlled via value + onchange. */
  value?: string | number;
  options?: DropdownOption[];
  /** Optional caption rendered above the field (MD3 label slot). */
  label?: string;
  placeholder?: string;
  /** Stable menu-trigger text; empty renders an icon-only trigger (supply ariaLabel). */
  triggerLabel?: string;
  disabled?: boolean;
  size?: 'xs' | 'sm' | 'button';
  variant?: 'filled' | 'outlined' | 'secondary' | 'elevated';
  /** Content rendered before the label inside the trigger (e.g. an avatar).
   * Purely presentational - the accessible name stays the label/placeholder. */
  leading?: Snippet;
  error?: string;
  id?: string;
  ariaLabel?: string;
  class?: string;
  maxHeight?: string;
  /** Menu surface z-index. Pass PORTAL_Z.dialogMenu when the trigger lives
   * inside a body-portaled dialog/overlay (z-10000) so the menu stacks above it. */
  zIndex?: number;
  onchange?: (value: string | number) => void;
}

let {
  value = $bindable(''),
  options = [] as DropdownOption[],
  label = '',
  placeholder = '',
  triggerLabel,
  disabled = false,
  size = 'sm',
  variant = 'filled',
  leading,
  error = '',
  id,
  ariaLabel,
  class: className = '',
  maxHeight = 'min(15rem, 60vh)',
  zIndex = PORTAL_Z.navMenu,
  onchange,
}: Props = $props();

let open = $state(false);
let highlight = $state(-1);
let triggerEl = $state<HTMLButtonElement | null>(null);
let menuEl = $state<HTMLDivElement | null>(null);
let menuTransformOrigin = $state('top center');
// The ID belongs to the component instance. A counter inside this instance
// script resets for every dropdown, so timestamp-based IDs collide when two
// fields mount in the same millisecond and misroute their accessible labels.
const instanceId = $props.id();
const listId = `dd-list-${instanceId}`;

const selected = $derived(options.find((o) => o.value === value) || null);
const activeDesc = $derived(
  open && highlight >= 0 && highlight < options.length ? `${listId}-opt-${highlight}` : undefined
);

const fieldClass = $derived.by(() => {
  //'button' = MD3 Small button metrics: 40dp height, medium (12dp = rounded-lg)
  // shape, Label Large label, 8dp icon gap, 16dp leading/trailing padding.
  // The radius lives per size so the field sizes keep their existing shape.
  const sizeClass =
    size === 'button'
      ? triggerLabel === ''
        ? 'h-10 gap-0 px-2 text-sm font-medium rounded-lg'
        : 'h-10 gap-2 px-4 text-sm font-medium tracking-[var(--md-type-label-large-tracking)] rounded-lg'
      : size === 'xs'
        ? 'px-2 py-1.5 text-xs rounded-xl'
        : 'px-3 py-2 text-sm rounded-xl';
  const common =
    // MD3 disabled content is 38% of on-surface.
    'md-action w-full flex items-center gap-2 text-start transition-colors cursor-pointer disabled:opacity-[0.38] disabled:cursor-not-allowed';
  let surface: string;
  if (variant === 'elevated') {
    // MD3 elevated button: surface-container-low container, primary label,
    // elevation level 1, no outline.
    surface = error
      ? 'bg-md-error-container text-md-on-error-container border border-md-error font-medium'
      : `bg-md-surface-container-low text-md-primary border border-transparent ${ELEVATION.level1}`;
  } else if (variant === 'secondary') {
    surface = error
      ? 'bg-md-error-container text-md-on-error-container border border-md-error font-medium'
      : 'bg-md-secondary-container text-md-on-secondary-container border border-transparent font-medium';
  } else if (variant === 'outlined') {
    surface = error
      ? 'bg-md-surface-variant/40 text-md-on-surface border border-md-error'
      : 'bg-md-surface-variant/40 text-md-on-surface border border-md-outline';
  } else {
    // filled (MD3 filled field)
    surface = error
      ? 'bg-md-error-container text-md-on-error-container border border-md-error'
      : 'bg-md-surface-container-high text-md-on-surface border border-transparent';
  }
  const stateLayer = open ? ' ring-2 ring-inset ring-md-primary border-md-primary' : '';
  return `${common} ${surface} ${sizeClass}${stateLayer}`;
});

function openMenu() {
  if (disabled || options.length === 0) return;
  highlight = options.findIndex((o) => o.value === value);
  if (highlight < 0 || options[highlight]?.disabled) highlight = firstEnabled();
  open = true;
  // Safari does not focus buttons on a pointer click. Own focus explicitly so
  // arrows/Escape work immediately after opening in every browser engine.
  triggerEl?.focus();
}

function closeMenu(returnFocus = true) {
  open = false;
  highlight = -1;
  if (returnFocus) triggerEl?.focus();
}

function select(option: DropdownOption) {
  if (option.disabled) return;
  value = option.value;
  onchange?.(option.value);
  closeMenu();
}

function firstEnabled(): number {
  return options.findIndex((o) => !o.disabled);
}

function lastEnabled(): number {
  for (let i = options.length - 1; i >= 0; i--) if (!options[i]?.disabled) return i;
  return -1;
}

function nextEnabled(start: number): number {
  let i = start;
  for (let n = 0; n < options.length; n++) {
    if (!options[i]?.disabled) return i;
    i = (i + 1) % options.length;
  }
  return start;
}

function prevEnabled(start: number): number {
  let i = start;
  for (let n = 0; n < options.length; n++) {
    if (!options[i]?.disabled) return i;
    i = (i - 1 + options.length) % options.length;
  }
  return start;
}

function handleTriggerKeydown(e: KeyboardEvent) {
  if (disabled) return;
  if (!open) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openMenu();
    }
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    // Stop propagation so a wrapping dialog's window-level Escape handler
    // doesn't close the dialog while the menu is still open (matches native
    // <select> - Escape only dismisses the open listbox).
    e.stopPropagation();
    closeMenu();
    return;
  }
  if (e.key === 'Tab') {
    closeMenu();
    return; // let the browser move focus on
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    highlight = nextEnabled(highlight < 0 ? 0 : (highlight + 1) % options.length);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    highlight = prevEnabled(
      highlight < 0 ? options.length - 1 : (highlight - 1 + options.length) % options.length
    );
  } else if (e.key === 'Home') {
    e.preventDefault();
    highlight = firstEnabled();
  } else if (e.key === 'End') {
    e.preventDefault();
    highlight = lastEnabled();
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    const opt = options[highlight];
    if (opt) select(opt);
  }
}

function onDocPointerDown(e: PointerEvent) {
  if (!open) return;
  const target = e.target as Node | null;
  if (triggerEl?.contains(target) || menuEl?.contains(target)) return;
  closeMenu(false);
}

$effect(() => {
  if (!open) return;
  document.addEventListener('pointerdown', onDocPointerDown);
  return () => document.removeEventListener('pointerdown', onDocPointerDown);
});

// Keep the highlighted option visible inside the scrollable menu.
$effect(() => {
  if (!open || highlight < 0 || !menuEl) return;
  menuEl.querySelector(`#${listId}-opt-${highlight}`)?.scrollIntoView({ block: 'nearest' });
});

// Portal to document.body + position under the trigger while open. Fixed
// positioning escapes the scroll container (overflow clipping) and any
// CSS-transform ancestor; reposition on every scroll (capture phase catches
// container scrolls too) and on resize, and clamp to the viewport.
$effect(() => {
  if (!open || !menuEl || !triggerEl) return;
  if (menuEl.parentElement !== document.body) document.body.appendChild(menuEl);
  const el = menuEl;
  const pos = () => {
    const t = triggerEl;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const mw = el.offsetWidth || 160;
    const mh = el.offsetHeight || 200;
    const opensAbove = r.bottom + 6 + mh > window.innerHeight - 8;
    let top = r.bottom + 6;
    if (opensAbove) top = Math.max(8, r.top - mh - 6);
    menuTransformOrigin = opensAbove ? 'bottom center' : 'top center';
    const left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8));
    // MD3 menus are 112-280dp wide: the trigger widens the menu only up to
    // the spec's 280dp maximum.
    el.style.minWidth = `${Math.min(r.width, 280)}px`;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  };
  pos();
  const raf = requestAnimationFrame(pos); // re-measure after minWidth applies
  window.addEventListener('scroll', pos, { capture: true, passive: true });
  window.addEventListener('resize', pos);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('scroll', pos, { capture: true });
    window.removeEventListener('resize', pos);
  };
});

onDestroy(() => {
  try {
    if (menuEl && menuEl.parentElement === document.body) menuEl.remove();
  } catch {
    /* ignore */
  }
});
</script>

<div class="relative {className}">
  {#if label}
    <span id={`${listId}-label`} class="block text-sm text-md-on-surface-variant mb-1 px-1">{label}</span>
  {/if}
  <button
    bind:this={triggerEl}
    {id}
    type="button"
    role="combobox"
    aria-expanded={open}
    aria-haspopup="listbox"
    aria-controls={listId}
    aria-activedescendant={activeDesc}
    aria-label={ariaLabel || (!label ? placeholder : undefined)}
    aria-labelledby={!ariaLabel && label ? `${listId}-label` : undefined}
    aria-describedby={error ? `${listId}-error` : undefined}
    aria-invalid={!!error}
    disabled={disabled}
    class={fieldClass}
    onclick={(e) => {
      e.stopPropagation();
      if (open) closeMenu();
      else openMenu();
    }}
    onkeydown={handleTriggerKeydown}
  >
    {#if leading}
      {@render leading()}
    {/if}
    {#if triggerLabel !== ''}
      <span class="flex-1 truncate">
        {triggerLabel ?? selected?.label ?? placeholder}
      </span>
    {/if}
    <Icon
      name="chevronDown"
      class="w-5 h-5 shrink-0 motion-safe:transition-transform duration-150 {open
        ? 'rotate-180'
        : ''}"
    />
  </button>
  {#if error}
    <p id={`${listId}-error`} class="mt-1 text-xs text-md-error" aria-live="polite">{error}</p>
  {/if}
</div>

{#if open}
  <div
    bind:this={menuEl}
    id={listId}
    role="listbox"
    aria-label={ariaLabel || label || placeholder}
    tabindex="-1"
    onkeydown={handleTriggerKeydown}
    class="menu-list motion-menu-in rounded bg-md-surface-container {ELEVATION.level2} overflow-y-auto py-2 w-max min-w-[112px] max-w-[min(17.5rem,calc(100vw-16px))]"
    style="position:fixed; z-index:{zIndex}; max-height:{maxHeight}; transform-origin:{menuTransformOrigin};"
  >
    {#each options as option, i (option.value)}
      <button
        type="button"
        id={`${listId}-opt-${i}`}
        role="option"
        tabindex="-1"
        aria-selected={option.value === value}
        aria-disabled={option.disabled || undefined}
        disabled={option.disabled}
        class="menu-list-item w-full flex items-center gap-3 px-3 min-h-12 text-sm text-start {rowSurface({ active: i === highlight && !option.disabled })} {option.disabled ? 'is-disabled' : ''}"
        onpointerdown={(e) => {
          // The combobox owns keyboard focus; its options are active descendants.
          if (e.button === 0) e.preventDefault();
        }}
        onmousemove={() => {
          if (!option.disabled) highlight = i;
        }}
        onclick={(e) => {
          e.stopPropagation();
          select(option);
        }}
      >
        <span class="flex-1 min-w-0">
          <span class="block truncate font-medium">{option.label}</span>
          {#if option.hint}
            <span class="block text-xs text-md-on-surface/50 truncate">{option.hint}</span>
          {/if}
        </span>
        {#if option.value === value}
          <Icon name="check" class="w-6 h-6 shrink-0" />
        {/if}
      </button>
    {/each}
  </div>
{/if}
