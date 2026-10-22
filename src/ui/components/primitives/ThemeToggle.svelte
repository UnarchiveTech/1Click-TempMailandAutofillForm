<script lang="ts">
/**
 * Theme mode strip (light / system / dark).
 * Long-press or right-click opens contrast menu: Low · Medium · High.
 * menuPlacement: 'bottom' (header) | 'top' (sidebar).
 * orientation: 'horizontal' (default) | 'vertical' - vertical stacks the
 * three mode buttons in a column with the active pill sliding along the
 * block axis (used by the collapsed icon-only sidebar rail).
 */
import { onDestroy } from 'svelte';
import { t } from 'svelte-i18n';
import type { ContrastLevel } from '@/features/theme/theme-actions.js';
import MenuList from '@/ui/components/composites/MenuList.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { PORTAL_Z_CLASS, portalFlyoutAction } from '@/utils/ui/portal-layers.js';

let {
  themeMode = 'auto',
  onThemeChange = (_m: 'light' | 'auto' | 'dark') => {},
  contrastLevel = 'standard' as ContrastLevel,
  onContrastChange = (_c: ContrastLevel) => {},
  menuPlacement = 'bottom' as 'bottom' | 'top',
  orientation = 'horizontal' as 'horizontal' | 'vertical',
}: {
  themeMode?: 'light' | 'auto' | 'dark';
  onThemeChange?: (mode: 'light' | 'auto' | 'dark') => void;
  contrastLevel?: ContrastLevel;
  onContrastChange?: (level: ContrastLevel) => void;
  menuPlacement?: 'bottom' | 'top';
  orientation?: 'horizontal' | 'vertical';
} = $props();

let menuOpen = $state(false);
let holdTimer: ReturnType<typeof setTimeout> | null = null;
const HOLD_MS = 450;

const CONTRAST_OPTIONS: { id: ContrastLevel; labelKey: string }[] = [
  { id: 'standard', labelKey: 'theme.contrastStandard' },
  { id: 'medium', labelKey: 'theme.contrastMedium' },
  { id: 'high', labelKey: 'theme.contrastHigh' },
];

/** Active-pill offset per mode: horizontal = inline-start, vertical = top.
 * Button is 1.75rem (w-7/h-7) with 2px track padding. */
const horizontalOffsets: Record<string, string> = {
  light: '2px',
  auto: 'calc(2px + 1.875rem)',
  dark: 'calc(2px + 3.75rem)',
};
const verticalOffsets: Record<string, string> = {
  light: '2px',
  auto: 'calc(2px + 1.875rem)',
  dark: 'calc(2px + 3.75rem)',
};

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
    class="theme-toggle-track relative flex gap-0.5 bg-md-surface-variant rounded-xl p-0.5 {orientation ===
    'vertical'
      ? 'flex-col'
      : 'items-center'}"
    role="group"
    aria-label={$t('theme.toggleAria')}
    oncontextmenu={openMenu}
    onpointerdown={onPointerDown}
    onpointerup={onPointerUp}
    onpointerleave={onPointerUp}
    onpointercancel={onPointerUp}
  >
    <span
      class="theme-pill absolute w-7 h-7 rounded-lg bg-md-primary {ELEVATION.level1} pointer-events-none transition-all duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)] {orientation ===
      'vertical'
        ? 'left-0.5 right-0.5 top-auto bottom-auto'
        : 'top-0.5 bottom-0.5 left-auto right-auto'}"
      style={orientation === 'vertical'
        ? `top: ${verticalOffsets[themeMode]};`
        : `inset-inline-start: ${horizontalOffsets[themeMode]};`}
    ></span>
    <button
      type="button"
      oncontextmenu={openMenu}
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
        name="lightMode"
        class="w-4 h-4 transition-transform duration-300 {themeMode === 'light'
          ? 'scale-110 rotate-12'
          : ''}"
      />
    </button>
    <button
      type="button"
      oncontextmenu={openMenu}
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
      oncontextmenu={openMenu}
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
        name="darkMode"
        class="w-4 h-4 transition-transform duration-300 {themeMode === 'dark'
          ? 'scale-110 -rotate-12'
          : ''}"
      />
    </button>
  </div>

  {#if menuOpen}
    <button
      type="button"
      use:portalFlyoutAction
      class="fixed inset-0 {PORTAL_Z_CLASS.navMenu} cursor-default bg-transparent border-0"
      aria-label={$t('common.close')}
      onclick={closeMenu}
    ></button>
    <MenuList
      floating={{ placement: menuPlacement === 'top' ? 'top-end' : 'bottom-end', onClose: closeMenu }}
      class="absolute {PORTAL_Z_CLASS.accountMenu} min-w-[9.5rem] {menuPlacement === 'bottom' ? 'top-full mt-1.5 end-0' : 'bottom-full mb-1.5 end-0'}"
      role="menu"
      ariaLabel={$t('theme.contrastMenu')}
    >
      <div class="px-2.5 py-1 text-xs font-bold text-md-on-surface-variant">
        {$t('theme.contrastMenu')}
      </div>
      {#each CONTRAST_OPTIONS as opt (opt.id)}
        <button
          type="button"
          role="menuitemradio"
          aria-checked={contrastLevel === opt.id}
          class="menu-list-item w-full flex items-center justify-between gap-3 px-3 min-h-12 text-sm text-start {contrastLevel === opt.id ? 'is-active' : ''}"
          onclick={(e) => {
            e.stopPropagation();
            pickContrast(opt.id);
          }}
        >
          <span class="flex-1 truncate font-medium">{$t(opt.labelKey)}</span>
          {#if contrastLevel === opt.id}
            <Icon name="checkCircle" class="w-3.5 h-3.5 shrink-0" />
          {/if}
        </button>
      {/each}
    </MenuList>
  {/if}
</div>
