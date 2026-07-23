<script lang="ts">
/**
 * Theme mode strip (light / system / dark).
 * Long-press or right-click opens contrast menu: Low · Medium · High.
 * menuPlacement: 'bottom' (header) | 'top' (sidebar).
 */
import { onDestroy } from 'svelte';
import { t } from 'svelte-i18n';
import Icon from '@/components/icons/Icon.svelte';
import type { ContrastLevel } from '@/features/theme/theme-actions.js';

let {
  themeMode = 'system',
  onThemeChange = (_m: 'light' | 'auto' | 'dark') => {},
  contrastLevel = 'standard' as ContrastLevel,
  onContrastChange = (_c: ContrastLevel) => {},
  menuPlacement = 'bottom' as 'bottom' | 'top',
} = $props<{
  themeMode?: 'light' | 'auto' | 'dark';
  onThemeChange?: (mode: 'light' | 'auto' | 'dark') => void;
  contrastLevel?: ContrastLevel;
  onContrastChange?: (level: ContrastLevel) => void;
  menuPlacement?: 'bottom' | 'top';
}>();

let menuOpen = $state(false);
let holdTimer: ReturnType<typeof setTimeout> | null = null;
const HOLD_MS = 450;

const CONTRAST_OPTIONS: { id: ContrastLevel; labelKey: string }[] = [
  { id: 'standard', labelKey: 'theme.contrastLow' },
  { id: 'medium', labelKey: 'theme.contrastMedium' },
  { id: 'high', labelKey: 'theme.contrastHigh' },
];

function clearHold() {
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}

function openMenu(e?: Event) {
  e?.preventDefault();
  e?.stopPropagation();
  clearHold();
  menuOpen = true;
}

function closeMenu() {
  menuOpen = false;
}

function pickContrast(level: ContrastLevel) {
  onContrastChange(level);
  closeMenu();
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  clearHold();
  holdTimer = setTimeout(() => {
    holdTimer = null;
    menuOpen = true;
  }, HOLD_MS);
}

function onPointerUp() {
  clearHold();
}

onDestroy(() => clearHold());
</script>

<div class="theme-toggle-wrap relative" role="presentation">
  <div
    class="theme-toggle-track relative flex items-center gap-0.5 bg-md-surface-variant rounded-xl p-0.5"
    role="group"
    aria-label={$t('theme.toggleAria')}
    oncontextmenu={openMenu}
    onpointerdown={onPointerDown}
    onpointerup={onPointerUp}
    onpointerleave={onPointerUp}
    onpointercancel={onPointerUp}
  >
    <span
      class="theme-pill absolute top-0.5 bottom-0.5 w-7 rounded-lg bg-md-primary shadow-sm pointer-events-none transition-all duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)]"
      style="inset-inline-start: {themeMode === 'light'
        ? '2px'
        : themeMode === 'auto'
          ? 'calc(2px + 1.875rem)'
          : 'calc(2px + 3.75rem)'};"
    ></span>
    <button
      type="button"
      class="relative z-[1] w-7 h-7 flex items-center justify-center rounded-lg transition-colors duration-200 {themeMode ===
      'light'
        ? 'text-md-on-primary'
        : 'text-md-on-surface/50 hover:text-md-on-surface'} active:scale-95"
      title={$t('theme.light')}
      aria-label={$t('theme.light')}
      aria-pressed={themeMode === 'light'}
      onclick={(e) => {
        e.stopPropagation();
        if (menuOpen) return;
        onThemeChange('light');
      }}
    >
      <Icon
        name="sun"
        class="w-4 h-4 transition-transform duration-300 {themeMode === 'light'
          ? 'scale-110 rotate-12'
          : ''}"
      />
    </button>
    <button
      type="button"
      class="relative z-[1] w-7 h-7 flex items-center justify-center rounded-lg transition-colors duration-200 {themeMode ===
      'auto'
        ? 'text-md-on-primary'
        : 'text-md-on-surface/50 hover:text-md-on-surface'} active:scale-95"
      title={$t('theme.system')}
      aria-label={$t('theme.system')}
      aria-pressed={themeMode === 'auto'}
      onclick={(e) => {
        e.stopPropagation();
        if (menuOpen) return;
        onThemeChange('auto');
      }}
    >
      <Icon
        name="monitor"
        class="w-4 h-4 transition-transform duration-300 {themeMode === 'auto' ? 'scale-110' : ''}"
      />
    </button>
    <button
      type="button"
      class="relative z-[1] w-7 h-7 flex items-center justify-center rounded-lg transition-colors duration-200 {themeMode ===
      'dark'
        ? 'text-md-on-primary'
        : 'text-md-on-surface/50 hover:text-md-on-surface'} active:scale-95"
      title={$t('theme.dark')}
      aria-label={$t('theme.dark')}
      aria-pressed={themeMode === 'dark'}
      onclick={(e) => {
        e.stopPropagation();
        if (menuOpen) return;
        onThemeChange('dark');
      }}
    >
      <Icon
        name="moon"
        class="w-4 h-4 transition-transform duration-300 {themeMode === 'dark'
          ? 'scale-110 -rotate-12'
          : ''}"
      />
    </button>
  </div>

  {#if menuOpen}
    <button
      type="button"
      class="fixed inset-0 z-[90] cursor-default bg-transparent border-0"
      aria-label={$t('common.close')}
      onclick={closeMenu}
    ></button>
    <div
      class="absolute z-[100] min-w-[9.5rem] rounded-xl border border-md-outline-variant/40 bg-md-surface-container shadow-xl py-1
        {menuPlacement === 'bottom' ? 'top-full mt-1.5 end-0' : 'bottom-full mb-1.5 end-0'}"
      role="menu"
      aria-label={$t('theme.contrastMenu')}
    >
      <div class="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-md-on-surface/45">
        {$t('theme.contrastMenu')}
      </div>
      {#each CONTRAST_OPTIONS as opt (opt.id)}
        <button
          type="button"
          role="menuitemradio"
          aria-checked={contrastLevel === opt.id}
          class="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-sm text-start transition-colors
            {contrastLevel === opt.id
              ? 'bg-md-secondary-container text-md-on-secondary-container font-semibold'
              : 'text-md-on-surface hover:bg-md-surface-variant/60'}"
          onclick={(e) => {
            e.stopPropagation();
            pickContrast(opt.id);
          }}
        >
          <span>{$t(opt.labelKey)}</span>
          {#if contrastLevel === opt.id}
            <Icon name="checkCircle" class="w-3.5 h-3.5 shrink-0" />
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
