import { browser } from 'wxt/browser';
import type { View } from '@/features/types/view-types.js';
import { isSettingsSplitView } from '@/ui/views/view-registry.js';
import { normalizeUiDensity, type UiDensity } from '@/utils/storage/storage-keys.js';
import { LAYOUT_SPLIT_MIN, LAYOUT_WIDE_MIN } from '@/utils/ui/breakpoints.js';
import { setLayoutMetrics } from '@/utils/ui/layout-state-store.js';

export interface LayoutMeasurementDeps {
  getContext: () => 'popup' | 'sidepanel' | 'app';
  getRootElement: () => HTMLElement | null;
  getLayoutWide: () => boolean;
  getLayoutSplit: () => boolean;
  getCurrentView: () => View;
  getSelectedThreadLength: () => number;
  getCurrentEmailDetail: () => unknown;
  getSplitSecondaryView: () => View | null;
  setLayoutWide: (value: boolean) => void;
  setNavShellWidth: (value: number) => void;
  setLayoutSplit: (value: boolean) => void;
  setSplitModeFlash: (value: boolean) => void;
  setCurrentView: (value: View) => void;
  setSplitSecondaryView: (value: View | null) => void;
  setSplitPaneCollapsed: (value: boolean) => void;
  setSplitListWidthPx: (value: number) => void;
  setUiDensity: (value: UiDensity) => void;
  getSplitPaneCollapsed: () => boolean;
}

export interface LayoutMeasurementController {
  start: () => void;
  stop: () => void;
}

export function createLayoutMeasurementController(
  deps: LayoutMeasurementDeps
): LayoutMeasurementController {
  let observer: ResizeObserver | null = null;
  let frame: number | null = null;
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const updateWide = () => {
    if (stopped) return;
    const wasSplit = deps.getLayoutSplit();
    const wasWide = deps.getLayoutWide();
    const width = deps.getRootElement()?.getBoundingClientRect().width ?? window.innerWidth;
    const context = deps.getContext();
    const wide = context !== 'popup' && width >= LAYOUT_WIDE_MIN;
    const split = context !== 'popup' && width >= LAYOUT_SPLIT_MIN;
    deps.setLayoutWide(wide);
    deps.setLayoutSplit(split);
    // Keep nav measurements available even when the visual layout is narrow.
    const navShellWidth = width;
    deps.setNavShellWidth(navShellWidth);
    setLayoutMetrics({
      width,
      context,
      layoutWide: wide,
      layoutSplit: split,
      layoutVerticalSplit: wide && !split,
      navShellWidth,
    });

    if (split !== wasSplit || wide !== wasWide) {
      deps.setSplitModeFlash(true);
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        flashTimer = null;
        if (!stopped) deps.setSplitModeFlash(false);
      }, 220);
    }

    const currentView = deps.getCurrentView();
    if (wide && !wasWide) {
      if (currentView === 'mailView' && deps.getSelectedThreadLength() > 0) {
        deps.setCurrentView('mailbox');
      } else if (currentView === 'addressView' && deps.getCurrentEmailDetail()) {
        deps.setCurrentView('addresses');
      } else if (isSettingsSplitView(currentView)) {
        deps.setSplitSecondaryView(currentView);
        deps.setCurrentView('settings');
      }
    } else if (!wide && wasWide) {
      if (currentView === 'mailbox' && deps.getSelectedThreadLength() > 0) {
        deps.setCurrentView('mailView');
      } else if (currentView === 'addresses' && deps.getCurrentEmailDetail()) {
        deps.setCurrentView('addressView');
      } else if (currentView === 'settings' && deps.getSplitSecondaryView()) {
        deps.setCurrentView(deps.getSplitSecondaryView() as View);
        deps.setSplitSecondaryView(null);
      }
      if (deps.getCurrentView() === 'addresses' && !deps.getCurrentEmailDetail()) {
        deps.setCurrentView('mailbox');
      }
    }
  };

  const schedule = () => {
    if (stopped || frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      updateWide();
    });
  };

  const onDensityStorage = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local') return;
    if ('uiDensity' in changes) deps.setUiDensity(normalizeUiDensity(changes.uiDensity?.newValue));
  };

  return {
    start: () => {
      stopped = false;
      updateWide();
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(schedule);
        const root = deps.getRootElement();
        if (root) observer.observe(root);
      }
      window.addEventListener('resize', schedule, { passive: true });
      browser.storage.onChanged.addListener(onDensityStorage);
      void browser.storage.local
        .get(['uiDensity', 'splitListWidthPx', 'splitPaneCollapsed'])
        .then((result) => {
          if (stopped) return;
          const density = (result as { uiDensity?: string }).uiDensity;
          deps.setUiDensity(normalizeUiDensity(density));
          const width = (result as { splitListWidthPx?: number }).splitListWidthPx;
          if (typeof width === 'number' && width >= 260) deps.setSplitListWidthPx(width);
          const collapsed = (result as { splitPaneCollapsed?: boolean }).splitPaneCollapsed;
          if (typeof collapsed === 'boolean') {
            const hasDetail =
              deps.getSelectedThreadLength() > 0 ||
              !!deps.getCurrentEmailDetail() ||
              deps.getSplitSecondaryView() !== null;
            deps.setSplitPaneCollapsed(hasDetail ? false : collapsed);
          }
          if (observer) {
            const root = deps.getRootElement();
            if (root) observer.observe(root);
          }
        })
        .catch(() => {
          /* ignore unavailable layout preferences */
        });
    },
    stop: () => {
      stopped = true;
      window.removeEventListener('resize', schedule);
      browser.storage.onChanged.removeListener(onDensityStorage);
      observer?.disconnect();
      observer = null;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = null;
    },
  };
}
