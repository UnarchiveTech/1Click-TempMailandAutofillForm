<script lang="ts">
import { t } from 'svelte-i18n';
import {
  getPageZoomSetting,
  PAGE_ZOOM_MAX,
  PAGE_ZOOM_MIN,
  type PageZoomDirection,
  type PageZoomSettings,
} from '@/features/settings/page-zoom.js';
import type { View } from '@/features/types/view-types.js';
import { ACTIVITY_PAGE_KEYS } from '@/features/types/view-types.js';
import SettingCard from '@/ui/components/composites/SettingCard.svelte';
import Icon from '@/ui/components/icons/Icon.svelte';
import { Toggle } from '@/ui/components/primitives';
import { viewDisplayLabelKey } from '@/utils/i18n/view-display-names.js';

let {
  onBack = () => {},
  globalZoomEnabled = false,
  globalZoomScale = 1,
  pageZoomSettings = {},
  onTogglePageZoom = () => {},
  onChangePageZoom = () => {},
}: {
  onBack?: () => void;
  globalZoomEnabled?: boolean;
  globalZoomScale?: number;
  pageZoomSettings?: PageZoomSettings;
  onTogglePageZoom?: (view: View, enabled: boolean) => void;
  onChangePageZoom?: (view: View, direction: PageZoomDirection) => void;
} = $props();

function pageLabelKey(view: View): string {
  if (view === 'addressView') return 'preferences.pageZoomAddressDetail';
  if (view === 'mailView') return 'preferences.pageZoomMessageDetail';
  return viewDisplayLabelKey(view) ?? 'common.unknown';
}
</script>

<div class="scroll-frame h-full min-h-0 flex flex-col bg-md-surface text-md-on-surface">
  <div class="scroll-edge flex items-center gap-2 py-3 border-b border-md-outline-variant/20 shrink-0">
    <button
      type="button"
      class="p-1.5 rounded-full hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70 text-md-on-surface transition-colors"
      aria-label={$t('common.back')}
      onclick={(event) => {
        event.stopPropagation();
        onBack();
      }}
    >
      <Icon name="chevronLeft" class="w-5 h-5 rtl-flip" />
    </button>
    <div class="min-w-0">
      <h2 class="text-sm font-semibold text-md-on-surface">{$t('preferences.pageZoomTitle')}</h2>
      <p class="text-xs text-md-on-surface/50">{$t('preferences.pageZoomDescription')}</p>
    </div>
  </div>

  <div class="scroll-body scroll-body-framed flex-1 min-h-0 overflow-y-auto py-3 space-y-3">
    {#if !globalZoomEnabled}
      <p class="rounded-xl border border-md-outline-variant/30 bg-md-surface-container-low px-3 py-2 text-xs text-md-on-surface-variant">
        {$t('preferences.pageZoomMasterRequired')}
      </p>
    {/if}

    <div class="space-y-2">
      {#each ACTIVITY_PAGE_KEYS as view (view)}
        {@const labelKey = pageLabelKey(view)}
        {@const setting = getPageZoomSetting(pageZoomSettings, view, globalZoomScale)}
        {@const pageLabel = $t(labelKey)}
        <SettingCard
          variant="row"
          title={pageLabel}
          description={$t('preferences.pageZoomRowDescription')}
        >
          {#snippet action()}
            <div class="flex items-center gap-1.5">
              <button
                type="button"
                class="w-8 h-8 flex items-center justify-center rounded-full text-md-on-surface hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                aria-label={$t('preferences.zoomOutPage', { values: { page: pageLabel } })}
                title={$t('preferences.zoomOutPage', { values: { page: pageLabel } })}
                disabled={!setting.enabled || setting.scale <= PAGE_ZOOM_MIN}
                onclick={(event) => {
                  event.stopPropagation();
                  onChangePageZoom(view, -1);
                }}
              >
                <span aria-hidden="true" class="text-lg leading-none">−</span>
              </button>
              <output
                class="min-w-12 text-center text-xs font-medium tabular-nums text-md-on-surface"
                aria-label={$t('preferences.zoomLevelPage', {
                  values: { page: pageLabel, percent: Math.round(setting.scale * 100) },
                })}
              >
                {Math.round(setting.scale * 100)}%
              </output>
              <button
                type="button"
                class="w-8 h-8 flex items-center justify-center rounded-full text-md-on-surface hover:bg-md-surface-variant/50 active:bg-md-surface-variant/70 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                aria-label={$t('preferences.zoomInPage', { values: { page: pageLabel } })}
                title={$t('preferences.zoomInPage', { values: { page: pageLabel } })}
                disabled={!setting.enabled || setting.scale >= PAGE_ZOOM_MAX}
                onclick={(event) => {
                  event.stopPropagation();
                  onChangePageZoom(view, 1);
                }}
              >
                <Icon name="add" class="w-4 h-4" />
              </button>
              <Toggle
                checked={setting.enabled}
                ariaLabel={$t('preferences.zoomTogglePage', { values: { page: pageLabel } })}
                onChange={(enabled) => onTogglePageZoom(view, enabled)}
              />
            </div>
          {/snippet}
        </SettingCard>
      {/each}
    </div>
  </div>
</div>
