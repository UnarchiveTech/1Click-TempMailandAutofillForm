<script lang="ts">
/**
 * Reusable presentational language-picker menu (composite).
 *
 * Pure UI only - all logic (locale subscription, storage persistence, request
 * links) lives in the consuming feature block (`LanguageSwitcher`). Reuse this
 * composite anywhere a language picker is needed with a different behaviour.
 *
 * The menu is BODY-PORTALED and `position: fixed` against the viewport, for two
 * measured reasons (both seen on the built extension):
 *
 *  - an in-place flyout is CLIPPED by the scroll container it lives in, so the
 *    last languages were unreachable when the Settings page was short - the menu
 *    is capped to the space actually available and scrolls inside its own box;
 *  - an in-place flyout is also JAILED by any stacking context between it and the
 *    view root, which is how it came to paint behind the floating nav island
 *    (`.view-crossfade` kept a transform from its entry animation). Portaled to
 *    the body it takes `PORTAL_Z.menu` in the root stacking context, where the
 *    island (`PORTAL_Z.chrome`) is below it by the scale's own ordering.
 *
 * It re-places on scroll (capture, so a scrolled ancestor counts) and on resize,
 * keeps its alignment logical (`align="end"` follows the direction), and closes
 * on a pointer press outside itself or on Escape.
 */
import { t } from 'svelte-i18n';
import Icon from '@/ui/components/icons/Icon.svelte';
import { ELEVATION } from '@/utils/ui/elevation.js';
import { PORTAL_Z_CLASS, portalFlyoutAction } from '@/utils/ui/portal-layers.js';
import { rowSurface } from '@/utils/ui/row-surface.js';

export type LanguageOption = { code: string; name: string; country: string };

let {
  languages = [] as LanguageOption[],
  currentLanguage = 'en',
  onSelect = (_code: string) => {},
  onRequestLanguage = () => {},
  align = 'end' as 'start' | 'end',
  class: className = '',
}: {
  languages?: LanguageOption[];
  currentLanguage?: string;
  onSelect?: (code: string) => void;
  onRequestLanguage?: () => void;
  /** Dropdown alignment relative to the trigger (start = left, end = right). */
  align?: 'start' | 'end';
  class?: string;
} = $props();

/** `w-52` - the menu's fixed width, needed to place it before the browser paints. */
const MENU_WIDTH = 208;
/** `mt-2` - the gap between the trigger and the menu. */
const GAP_PX = 8;
/** Clear of the viewport edge. */
const MARGIN_PX = 8;
/** A shorter menu than this is not worth flipping for; it scrolls instead. */
const MIN_HEIGHT_PX = 160;
/** The tallest the menu is allowed to get, so it never outgrows the viewport. */
const MAX_HEIGHT_PX = 360;

let isOpen = $state(false);
let triggerEl: HTMLButtonElement | null = $state(null);
let menuEl: HTMLDivElement | null = $state(null);
/** Placement is measured, so the menu stays hidden until it has one. */
let placed = $state(false);
let style = $state('');

function close() {
  isOpen = false;
}

/**
 * Place the fixed menu against the trigger: below it when there is room, above
 * it when there is more room there, horizontally per `align` in the CURRENT
 * direction, and never taller than the space it has - which is what keeps the
 * last item reachable instead of clipped.
 */
function place() {
  const trigger = triggerEl;
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  const rtl = getComputedStyle(trigger).direction === 'rtl';
  const below = window.innerHeight - rect.bottom - GAP_PX - MARGIN_PX;
  const above = rect.top - GAP_PX - MARGIN_PX;
  const up = below < MIN_HEIGHT_PX && above > below;
  const maxHeight = Math.max(
    MIN_HEIGHT_PX,
    Math.min(MAX_HEIGHT_PX, Math.max(below, up ? above : 0))
  );
  // `align="end"` is the inline end of the trigger: its right edge in LTR, its
  // left edge in RTL.
  const inlineEnd = align === 'end' ? rtl : !rtl;
  const rawLeft = inlineEnd ? rect.right - MENU_WIDTH : rect.left;
  const left = Math.max(MARGIN_PX, Math.min(rawLeft, window.innerWidth - MENU_WIDTH - MARGIN_PX));
  const top = up ? Math.max(MARGIN_PX, rect.top - GAP_PX - maxHeight) : rect.bottom + GAP_PX;
  style = `top: ${Math.round(top)}px; left: ${Math.round(left)}px; max-height: ${Math.round(maxHeight)}px;`;
  placed = true;
}

$effect(() => {
  if (!isOpen) {
    placed = false;
    return;
  }
  place();
  const replace = () => place();
  // Capture, so a scroll of ANY ancestor (the Settings page) re-places the menu.
  window.addEventListener('scroll', replace, true);
  window.addEventListener('resize', replace);
  const onPointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null;
    if (target && (menuEl?.contains(target) || triggerEl?.contains(target))) return;
    close();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('keydown', onKeyDown);
  return () => {
    window.removeEventListener('scroll', replace, true);
    window.removeEventListener('resize', replace);
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('keydown', onKeyDown);
  };
});

function toggleDropdown() {
  isOpen = !isOpen;
}
</script>

<div class="relative {className}">
  <button
    bind:this={triggerEl}
    class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-md-surface-variant active:brightness-95 transition-colors"
    onclick={(e) => { e.stopPropagation(); toggleDropdown(); }}
    aria-label={$t('preferences.language')}
    aria-expanded={isOpen}
    aria-haspopup="listbox"
  >
    <img
      src="https://flagcdn.com/w40/{languages.find((lang: LanguageOption) => lang.code === currentLanguage)?.country}.png"
      alt=""
      class="w-6 h-4 rounded-sm object-cover"
      loading="lazy"
    />
    <span class="text-sm font-medium">{languages.find((lang: LanguageOption) => lang.code === currentLanguage)?.name}</span>
    <Icon name="chevronDown" class="w-4 h-4 {isOpen ? 'rotate-180' : ''} transition-transform" />
  </button>
</div>

{#if isOpen}
  <div
    bind:this={menuEl}
    use:portalFlyoutAction
    class="fixed w-52 bg-md-surface rounded-xl {ELEVATION.level2} border border-md-outline-variant {PORTAL_Z_CLASS.menu} overflow-y-auto {placed ? '' : 'invisible'}"
    style={style}
    role="listbox"
    aria-label={$t('preferences.language')}
  >
    {#each languages as lang}
      <button
        class="w-full flex items-center gap-3 px-4 py-3 text-start {rowSurface({ active: currentLanguage === lang.code })}"
        onclick={(e) => { e.stopPropagation(); isOpen = false; onSelect(lang.code); }}
        aria-label={$t('common.switchToLanguage', { values: { lang: lang.name } })}
        aria-current={currentLanguage === lang.code ? 'true' : undefined}
      >
        <img
          src="https://flagcdn.com/w40/{lang.country}.png"
          alt=""
          class="w-6 h-4 rounded-sm object-cover"
          loading="lazy"
        />
        <span class="text-sm font-medium">{lang.name}</span>
        {#if currentLanguage === lang.code}
          <Icon name="check" class="w-4 h-4 text-md-primary ms-auto" />
        {/if}
      </button>
    {/each}
    <div class="h-px bg-md-outline-variant/40"></div>
    <button
      type="button"
      class="w-full flex items-center gap-3 px-4 py-3 hover:bg-md-primary/10 active:bg-md-primary/30 transition-colors text-start text-md-primary"
      onclick={(e) => { e.stopPropagation(); isOpen = false; onRequestLanguage(); }}
    >
      <Icon name="globe" class="w-5 h-5 shrink-0 opacity-80" />
      <span class="text-sm font-semibold">{$t('preferences.requestLanguage')}</span>
    </button>
  </div>
{/if}
