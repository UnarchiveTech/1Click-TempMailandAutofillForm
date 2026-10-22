<script lang="ts">
import { onMount } from 'svelte';
import { t } from 'svelte-i18n';
import { browser } from 'wxt/browser';
import SubpageShell from '@/ui/components/composites/SubpageShell.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { normalizeAutoArrangeMore } from '@/utils/ui/more-menu-layout.js';
import {
  DEFAULT_NAV_ORDER,
  type NavIndicatorMode,
  navItemFor,
  normalizeNavIndicatorModes,
  normalizeNavOrder,
  normalizePrimaryItemsPref,
  type PrimaryItemsPref,
} from '@/utils/ui/nav-layout.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';

let {
  onBack = () => {},
  showToast = (_msg: string) => {},
}: {
  onBack?: () => void;
  showToast?: (msg: string) => void;
} = $props();

/**
 * Single source of truth: the canonical nav order + item labels/icons live in
 * src/utils/ui/nav-layout.ts (the same list the Footer and Sidebar render). This
 * view only reads from it, so the reorder UI can never drift from the real nav.
 */
type NavItemId = (typeof DEFAULT_NAV_ORDER)[number];

/** The choices for how many items stay primary before the rest collapse into More. */
const PREFS: PrimaryItemsPref[] = ['auto', 1, 2, 3];

let navOrder = $state<NavItemId[]>([...DEFAULT_NAV_ORDER]);

/** 'auto' = fit as many as the width allows; 1|2|3 = force that many primary. */
let minPrimary = $state<PrimaryItemsPref>('auto');

/** Submenu-only auto-arrange for fewer rows (pill order never changes). */
let autoArrange = $state(true);
let navIndicatorModes = $state<Record<string, NavIndicatorMode>>(
  normalizeNavIndicatorModes(undefined)
);

/** The three keys this page edits, read and followed as one set. */
const PREF_KEYS = [
  'customNavOrder',
  'minPrimaryItems',
  'autoArrangeMore',
  'navIndicatorModes',
] as const;

function applyPrefs(next: Record<string, unknown>) {
  navOrder = normalizeNavOrder(next.customNavOrder);
  minPrimary = normalizePrimaryItemsPref(next.minPrimaryItems);
  autoArrange = normalizeAutoArrangeMore(next.autoArrangeMore);
  navIndicatorModes = normalizeNavIndicatorModes(next.navIndicatorModes);
}

onMount(() => {
  void browser.storage.local.get([...PREF_KEYS]).then((res) => applyPrefs(res));

  // Another surface (a second settings page, the popup, another device over
  // sync) can change these keys while this page is open. Without a listener this
  // view keeps rendering what it read at mount, and its own
  // `if (autoArrange === v) return` / `if (minPrimary === p) return` guards then
  // SWALLOW the click the user meant as a change: the stale page shows ON, the
  // user clicks ON, the guard reads "no change" and writes nothing, and the
  // stored OFF stands. Follow storage, exactly as the shell's navbar-preferences
  // controller does.
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local') return;
    if (changes.customNavOrder) navOrder = normalizeNavOrder(changes.customNavOrder.newValue);
    if (changes.minPrimaryItems) {
      minPrimary = normalizePrimaryItemsPref(changes.minPrimaryItems.newValue);
    }
    if (changes.autoArrangeMore) {
      autoArrange = normalizeAutoArrangeMore(changes.autoArrangeMore.newValue);
    }
    if (changes.navIndicatorModes) {
      navIndicatorModes = normalizeNavIndicatorModes(changes.navIndicatorModes.newValue);
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
});

async function selectPref(p: PrimaryItemsPref) {
  if (minPrimary === p) return;
  minPrimary = p;
  await writeWithRetry({ minPrimaryItems: p });
  showToast($t('common.saved'));
}

async function selectAutoArrange(v: boolean) {
  if (autoArrange === v) return;
  autoArrange = v;
  await writeWithRetry({ autoArrangeMore: v });
  showToast($t('common.saved'));
}

async function selectIndicatorMode(id: NavItemId, mode: NavIndicatorMode) {
  if (navIndicatorModes[id] === mode) return;
  navIndicatorModes = { ...navIndicatorModes, [id]: mode };
  await writeWithRetry({ navIndicatorModes: $state.snapshot(navIndicatorModes) });
  showToast($t('common.saved'));
}

async function moveUp(idx: number) {
  if (idx <= 0) return;
  const copy = [...navOrder];
  const item = copy[idx];
  copy[idx] = copy[idx - 1];
  copy[idx - 1] = item;
  navOrder = copy;
  await saveOrder();
}

async function moveDown(idx: number) {
  if (idx >= navOrder.length - 1) return;
  const copy = [...navOrder];
  const item = copy[idx];
  copy[idx] = copy[idx + 1];
  copy[idx + 1] = item;
  navOrder = copy;
  await saveOrder();
}

async function saveOrder() {
  await writeWithRetry({ customNavOrder: $state.snapshot(navOrder) });
  showToast($t('common.saved'));
}

async function resetOrder() {
  navOrder = [...DEFAULT_NAV_ORDER];
  navIndicatorModes = normalizeNavIndicatorModes(undefined);
  await writeWithRetry({
    customNavOrder: DEFAULT_NAV_ORDER,
    navIndicatorModes: $state.snapshot(navIndicatorModes),
  });
  showToast($t('common.reset'));
}
</script>

<SubpageShell
  onBack={onBack}
  title={$t('settings.navbarOrderTitle')}
  hint={$t('settings.navbarOrderHint')}
  resetLabel={$t('common.reset')}
  onReset={() => void resetOrder()}
>
    <!-- Items list -->
    <div class="space-y-2">
      <div class="flex items-center gap-2 mb-1">
        <Icon name="dragHandle" class="w-4 h-4 text-md-primary" />
        <span role="heading" aria-level="2" class="text-sm font-medium text-md-on-surface">{$t('settings.primaryNavItems')}</span>
      </div>
      <p class="text-xs text-md-on-surface/50">
        <span class="font-medium">{$t('settings.navIndicatorTitle')}:</span>
        {$t('settings.navIndicatorHint')}
      </p>
      <div class="space-y-1.5">
      {#each navOrder as id, idx (id)}
        {@const item = navItemFor(id)}
        <div class="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-md-surface-container-low border border-md-outline-variant/20 shadow-xs">
          <div class="flex items-center gap-3 min-w-0 flex-1 basis-40">
            <span class="text-xs font-bold text-md-on-surface/40 w-4 text-center">{idx + 1}</span>
            <Icon name={item.iconName} class="w-4 h-4 text-md-primary" />
            <span class="text-sm font-medium text-md-on-surface truncate">{$t(item.labelKey)}</span>
          </div>
          <div class="flex items-center gap-1 ms-auto">
            <div
              role="group"
              aria-label={$t('settings.navIndicatorFor', { values: { item: $t(item.labelKey) } })}
              class="flex gap-0.5 p-0.5 rounded-lg bg-md-surface-container border border-md-outline-variant/20 me-1"
            >
              {#each ['dot', 'count'] as mode (mode)}
                <button
                  type="button"
                  aria-pressed={navIndicatorModes[id] === mode}
                  class="px-2 py-1 rounded-md ui-label transition-colors {navIndicatorModes[id] === mode
                    ? 'bg-md-primary text-md-on-primary'
                    : 'text-md-on-surface/70 hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70'}"
                  onclick={() => void selectIndicatorMode(id, mode as NavIndicatorMode)}
                >
                  {$t(mode === 'dot' ? 'settings.navIndicatorDot' : 'settings.navIndicatorCount')}
                </button>
              {/each}
            </div>
            <div class="flex flex-nowrap items-center gap-2" use:responsiveButtonLayout data-action-tier="XS">
              <button
                type="button"
                class="h-8 flex items-center justify-center rounded-full hover:bg-md-surface-variant/60 active:bg-md-surface-variant/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              disabled={idx === 0}
              onclick={() => void moveUp(idx)}
              aria-label={$t('common.moveUp')}
            >
              <Icon name="chevronUp" class="w-5 h-5" />
            </button>
              <button
                type="button"
                class="h-8 flex items-center justify-center rounded-full hover:bg-md-surface-variant/60 active:bg-md-surface-variant/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              disabled={idx === navOrder.length - 1}
              onclick={() => void moveDown(idx)}
              aria-label={$t('common.moveDown')}
            >
              <Icon name="chevronDown" class="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      {/each}
    </div>
  </div>

    <!-- Primary items preference -->
    <div class="space-y-2">
      <div class="flex items-center gap-2 mb-1">
        <Icon name="dragHandle" class="w-4 h-4 text-md-primary" />
        <span role="heading" aria-level="2" class="text-sm font-medium text-md-on-surface">{$t('settings.primaryItemsPrefTitle')}</span>
      </div>
      <div
        role="group"
        aria-label={$t('settings.primaryItemsPrefTitle')}
        class="flex gap-1.5 p-1 rounded-xl bg-md-surface-container-low border border-md-outline-variant/20"
      >
        {#each PREFS as p (p)}
          <button
            type="button"
            aria-pressed={minPrimary === p}
            class="flex-1 px-2 py-1.5 rounded-lg ui-label transition-colors {minPrimary === p
              ? 'bg-md-primary text-md-on-primary'
              : 'text-md-on-surface/70 hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70'}"
            onclick={() => void selectPref(p)}
          >
            {p === 'auto' ? ($t('settings.primaryItemsPrefAuto')) : p}
          </button>
        {/each}
      </div>
      <p class="text-xs text-md-on-surface/50">{$t('settings.primaryItemsPrefHint')}</p>
    </div>

    <!-- More-submenu auto-arrange -->
    <div class="space-y-2">
      <div class="flex items-center gap-2 mb-1">
        <Icon name="dragHandle" class="w-4 h-4 text-md-primary" />
        <span role="heading" aria-level="2" class="text-sm font-medium text-md-on-surface">{$t('settings.autoArrangeMoreTitle')}</span>
      </div>
      <div
        role="group"
        aria-label={$t('settings.autoArrangeMoreTitle')}
        class="flex gap-1.5 p-1 rounded-xl bg-md-surface-container-low border border-md-outline-variant/20"
      >
        {#each [true, false] as v (v)}
          <button
            type="button"
            aria-pressed={autoArrange === v}
            class="flex-1 px-2 py-1.5 rounded-lg ui-label transition-colors {autoArrange === v
              ? 'bg-md-primary text-md-on-primary'
              : 'text-md-on-surface/70 hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70'}"
            onclick={() => void selectAutoArrange(v)}
          >
            {v ? ($t('common.on')) : ($t('common.off'))}
          </button>
        {/each}
      </div>
      <p class="text-xs text-md-on-surface/50">{$t('settings.autoArrangeMoreHint')}</p>
    </div>

  <!-- Responsiveness rules hint -->
  <div class="p-3 rounded-xl bg-md-tertiary-container/30 text-xs text-md-on-surface/70 space-y-1 leading-relaxed">
    <p class="font-bold">💡 {$t('settings.responsiveOrderHintTitle')}:</p>
    <p>{$t('settings.responsiveOrderHintBody')}</p>
  </div>

</SubpageShell>
