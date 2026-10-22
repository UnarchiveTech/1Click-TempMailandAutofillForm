<script lang="ts">
/**
 * Cross-browser MD3 color picker popover (replaces native input[type=color]).
 * Shows a swatch trigger; opens a panel with hex input + preset palette + optional hue slider.
 */
import { t } from 'svelte-i18n';
import Icon from '@/ui/components/icons/Icon.svelte';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';
import IconButton from '@/ui/components/primitives/IconButton.svelte';
import InputField from '@/ui/components/primitives/InputField.svelte';
import { getContrastColor } from '@/utils/theme/color-utils.js';
import { beginDialogLifecycle } from '@/utils/ui/dialog-lifecycle.js';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { PORTAL_Z_CLASS, portalFlyoutAction } from '@/utils/ui/portal-layers.js';
import { sanitizeColor } from '@/utils/validation.js';

let {
  value = $bindable(''),
  ariaLabel = '',
  presets = [
    '#4c662b',
    '#445e91',
    '#7d5260',
    '#006a6a',
    '#8b5000',
    '#ba1a1a',
    '#6750a4',
    '#006e1c',
    '#984061',
    '#006493',
  ] as string[],
  onChange = (_hex: string) => {},
  allowClear = true,
  presentation = 'popover',
  disabled = false,
  triggerSize = 'compact',
  triggerIcon,
}: {
  value?: string;
  ariaLabel?: string;
  presets?: string[];
  onChange?: (hex: string) => void;
  allowClear?: boolean;
  /** Accessible outlined native color field, without a nested flyout. */
  presentation?: 'popover' | 'field';
  disabled?: boolean;
  triggerSize?: 'compact' | 'touch';
  triggerIcon?: KnownIconName;
} = $props();

let open = $state(false);
let hexDraft = $state('');
let hexError = $state('');
let rootEl = $state<HTMLElement | null>(null);
let triggerEl = $state<HTMLButtonElement | null>(null);
let panelEl = $state<HTMLDivElement | null>(null);
let panelStyle = $state('');
const pickerId = $props.id();
const accessibleLabel = $derived(ariaLabel || $t('preferences.chooseThemeColor'));
const panelLayer = $derived(
  open && rootEl?.closest('[aria-modal="true"]') ? PORTAL_Z_CLASS.dialogMenu : PORTAL_Z_CLASS.menu
);

const safeColor = $derived(sanitizeColor(value));
const displayColor = $derived(safeColor || 'var(--md-primary)');

$effect(() => {
  hexDraft = value?.startsWith('#') ? value : value || '';
  hexError = '';
});

function isValidHex(hex: string) {
  return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(hex);
}

function commitHex(raw: string) {
  if (!isValidHex(raw.trim())) {
    hexError = $t('preferences.invalidHex');
    return;
  }
  let h = raw.trim();
  // Expand #rgb
  if (/^#[0-9a-fA-F]{3}$/.test(h)) {
    h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  }
  const safe = sanitizeColor(h);
  if (safe) {
    value = safe;
    onChange(safe);
    hexDraft = safe;
    hexError = '';
  }
}

function pick(hex: string) {
  value = hex;
  onChange(hex);
  hexDraft = hex;
  hexError = '';
}

function clear() {
  value = '';
  onChange('');
  hexDraft = '';
  open = false;
  triggerEl?.focus();
}

const onDoc = (e: MouseEvent) => {
  if (!open || !rootEl) return;
  if (!rootEl.contains(e.target as Node) && !panelEl?.contains(e.target as Node)) {
    open = false;
  }
};

// $effect must live at the component top level (Svelte 5) - created inside
// onMount it would not be owned by the component and its cleanup would never
// run, leaking the document mousedown listener.
$effect(() => {
  if (open) {
    document.addEventListener('mousedown', onDoc);
  } else {
    document.removeEventListener('mousedown', onDoc);
  }
  return () => document.removeEventListener('mousedown', onDoc);
});

function placePanel() {
  if (!triggerEl || !panelEl) return;
  const rect = triggerEl.getBoundingClientRect();
  const width = Math.min(240, innerWidth - 16);
  const below = innerHeight - rect.bottom - 16;
  const above = rect.top - 16;
  const up = below < panelEl.scrollHeight && above > below;
  const height = Math.min(panelEl.scrollHeight, Math.max(0, up ? above : below));
  const rtl = getComputedStyle(triggerEl).direction === 'rtl';
  const left = Math.max(8, Math.min(rtl ? rect.left : rect.right - width, innerWidth - width - 8));
  const top = up ? Math.max(8, rect.top - height - 8) : rect.bottom + 8;
  panelStyle = `width:${width}px;left:${left}px;top:${top}px;max-height:${height}px;`;
}

$effect(() => {
  if (!open || !panelEl) return;
  placePanel();
  const lifecycle = beginDialogLifecycle({ lockBodyScroll: false });
  lifecycle.attach(panelEl);
  window.addEventListener('scroll', placePanel, true);
  window.addEventListener('resize', placePanel);
  return () => {
    lifecycle.cleanup();
    window.removeEventListener('scroll', placePanel, true);
    window.removeEventListener('resize', placePanel);
  };
});

$effect(() => {
  if (disabled) open = false;
});

function handlePanelKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  open = false;
  triggerEl?.focus();
}

function handlePresetKeydown(event: KeyboardEvent, index: number) {
  let next = index;
  const rtl = getComputedStyle(event.currentTarget as HTMLElement).direction === 'rtl';
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = presets.length - 1;
  else if (event.key === 'ArrowRight') next += rtl ? -1 : 1;
  else if (event.key === 'ArrowLeft') next += rtl ? 1 : -1;
  else if (event.key === 'ArrowDown') next += 5;
  else if (event.key === 'ArrowUp') next -= 5;
  else return;
  event.preventDefault();
  event.stopPropagation();
  next = (next + presets.length) % presets.length;
  pick(presets[next]);
  panelEl?.querySelectorAll<HTMLButtonElement>('[data-color-preset]')[next]?.focus();
}
</script>

{#if presentation === 'field'}
  <label class="color-field" class:color-field-disabled={disabled}>
    <span class="color-field-label">{accessibleLabel}</span>
    <span class="color-field-swatch" style:background={displayColor} aria-hidden="true"></span>
    <span class="text-sm font-mono text-md-on-surface" aria-hidden="true">{value}</span>
    <Icon name="edit" class="w-6 h-6 ms-auto text-md-on-surface-variant" />
    <input
      type="color"
      aria-label={accessibleLabel}
      {disabled}
      value={sanitizeColor(value) || '#6750a4'}
      oninput={(e) => pick(e.currentTarget.value)}
    />
  </label>
{:else}
<div class="color-picker relative inline-flex items-center gap-1" bind:this={rootEl}>
  <button
    bind:this={triggerEl}
    type="button"
    class="md-action {triggerSize === 'touch' ? 'w-12 h-12 border-8' : 'w-10 h-10 border-4'} rounded-full border-md-secondary-container shrink-0 disabled:opacity-40 inline-flex items-center justify-center"
    style="background-color: {displayColor}; color:{safeColor ? getContrastColor(safeColor) : 'var(--md-on-primary)'}"
    aria-label={accessibleLabel}
    aria-expanded={open}
    aria-controls={`${pickerId}-panel`}
    aria-haspopup="dialog"
    {disabled}
    onclick={(e) => {
      e.stopPropagation();
      open = !open;
    }}
  >
    {#if triggerIcon}<Icon name={triggerIcon} class="w-4 h-4" />{/if}
  </button>
  {#if allowClear && value}
    <IconButton icon="close" size="sm" ariaLabel={$t('preferences.resetColor')} title={$t('preferences.resetColor')} {disabled} onclick={clear} />
  {/if}

  {#if open}
    <div
      bind:this={panelEl}
      use:portalFlyoutAction
      id={`${pickerId}-panel`}
      style={panelStyle}
      class="dialog-padding scroll-body fixed {panelLayer} rounded-2xl border border-md-outline-variant bg-md-surface-container {ELEVATION.level2} space-y-2.5 overflow-y-auto color-picker-panel"
      role="dialog"
      tabindex="-1"
      aria-label={accessibleLabel}
      onkeydown={handlePanelKeydown}
    >
      {#if presets.length > 0}
      <div class="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label={accessibleLabel}>
        {#each presets as hex, i (hex)}
          <button
            type="button"
            class="md-action w-8 h-8 rounded-full border-2 border-transparent flex items-center justify-center"
            style="background-color: {hex};color:{getContrastColor(hex)}"
            aria-label={hex}
            role="radio"
            data-color-preset={hex}
            aria-checked={value?.toLowerCase() === hex.toLowerCase()}
            tabindex={value?.toLowerCase() === hex.toLowerCase() || (!presets.some((p: string) => p.toLowerCase() === value?.toLowerCase()) && i === 0) ? 0 : -1}
            onclick={(e) => { e.stopPropagation(); pick(hex); }}
            onkeydown={(e) => handlePresetKeydown(e, i)}
          >
            {#if value?.toLowerCase() === hex.toLowerCase()}<Icon name="check" class="w-5 h-5" />{/if}
          </button>
        {/each}
      </div>
      {/if}
      <div class="flex items-center gap-1.5">
        <span
          class="w-7 h-7 rounded-lg border border-md-outline-variant shrink-0"
          style="background: {sanitizeColor(hexDraft) || 'transparent'};"
        ></span>
          <InputField
            id={`${pickerId}-hex`}
            label={accessibleLabel}
            class="flex-1 min-w-0"
            error={hexError}
            placeholder="#4c662b"
            maxlength={9}
            bind:value={hexDraft}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitHex(hexDraft);
              }
            }}
            onblur={() => commitHex(hexDraft)}
          />
      </div>
      <!-- Native picker as progressive enhancement for free color selection -->
      <label
        class="md-action relative flex items-center justify-center gap-2 w-full min-h-10 py-1.5 rounded-xl text-sm font-semibold bg-md-secondary-container text-md-on-secondary-container cursor-pointer focus-within:outline-2 focus-within:outline-md-primary focus-within:outline-offset-[-2px]"
      >
        <Icon name="edit" class="w-3.5 h-3.5" />
        {accessibleLabel}
        <input
          type="color"
          class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label={accessibleLabel}
          {disabled}
          value={value?.startsWith('#') && value.length >= 7 ? value.slice(0, 7) : '#4c662b'}
          oninput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            pick(v);
          }}
        />
      </label>
    </div>
  {/if}
</div>
{/if}

<style>
  .color-field {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 56px;
    padding-inline: 16px;
    border: 1px solid var(--md-outline);
    border-radius: var(--md-shape-extra-small, 4px);
    cursor: pointer;
  }
  .color-field-label {
    position: absolute;
    top: -8px;
    inset-inline-start: 12px;
    padding-inline: 4px;
    background: var(--input-label-surface, var(--md-surface-container-high));
    font-size: var(--md-type-body-small-size);
    color: var(--md-on-surface-variant);
  }
  .color-field-swatch {
    width: 24px;
    height: 24px;
    border-radius: var(--md-shape-full);
    border: 1px solid var(--md-outline-variant);
  }
  .color-field input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: inherit;
  }
  .color-field:focus-within {
    border-color: var(--md-primary);
    box-shadow: inset 0 0 0 1px var(--md-primary);
  }
  .color-field:focus-within .color-field-label { color: var(--md-primary); }
  .color-field-disabled { opacity: 0.38; cursor: default; }
  .color-picker-panel {
    animation: color-picker-in 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  /* No fill mode (see the entry-animation rule in src/styles.css): a retaining
     fill keeps this panel a stacking context forever, which jails anything
     overlaid inside it. */
  @keyframes color-picker-in {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(0.96);
    }
    to {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .color-picker-panel {
      animation: none;
    }
  }
</style>
