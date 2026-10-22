import { isView, type View } from '@/features/types/view-types.js';

export const PAGE_ZOOM_MIN = 0.75;
export const PAGE_ZOOM_MAX = 1.5;
export const PAGE_ZOOM_STEP = 0.1;

export interface PageZoomSetting {
  enabled: boolean;
  scale: number;
}

export type PageZoomSettings = Partial<Record<View, PageZoomSetting>>;
export type PageZoomDirection = -1 | 0 | 1;

/** Clamp stored and user-selected zoom to the range supported by the UI. */
export function normalizePageZoomScale(value: unknown, fallback = 1): number {
  const safeFallback = Number.isFinite(fallback) ? fallback : 1;
  const scale = typeof value === 'number' && Number.isFinite(value) ? value : safeFallback;
  return Math.round(Math.min(PAGE_ZOOM_MAX, Math.max(PAGE_ZOOM_MIN, scale)) * 100) / 100;
}

/** Reject stale or malformed persisted page ids before they reach view logic. */
export function normalizePageZoomSettings(value: unknown): PageZoomSettings {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};

  const normalized: PageZoomSettings = {};
  for (const [view, rawSetting] of Object.entries(value)) {
    if (
      !isView(view) ||
      rawSetting === null ||
      typeof rawSetting !== 'object' ||
      Array.isArray(rawSetting)
    )
      continue;

    const setting = rawSetting as Record<string, unknown>;
    normalized[view] = {
      enabled: typeof setting.enabled === 'boolean' ? setting.enabled : true,
      scale: normalizePageZoomScale(setting.scale),
    };
  }

  return normalized;
}

/** Return the saved page preference, inheriting the legacy global scale. */
export function getPageZoomSetting(
  settings: PageZoomSettings,
  view: View,
  fallbackScale = 1
): PageZoomSetting {
  const saved = settings[view];
  return {
    enabled: saved?.enabled ?? true,
    scale: normalizePageZoomScale(saved?.scale, fallbackScale),
  };
}

export function updatePageZoomSetting(
  settings: PageZoomSettings,
  view: View,
  patch: Partial<PageZoomSetting>,
  fallbackScale = 1
): PageZoomSettings {
  const current = getPageZoomSetting(settings, view, fallbackScale);
  return {
    ...settings,
    [view]: {
      enabled: patch.enabled ?? current.enabled,
      scale: normalizePageZoomScale(patch.scale ?? current.scale, fallbackScale),
    },
  };
}

export function changePageZoom(
  settings: PageZoomSettings,
  view: View,
  direction: PageZoomDirection,
  fallbackScale = 1
): PageZoomSettings {
  const current = getPageZoomSetting(settings, view, fallbackScale);
  const scale =
    direction === 0 ? 1 : normalizePageZoomScale(current.scale + direction * PAGE_ZOOM_STEP);
  return updatePageZoomSetting(settings, view, { scale }, fallbackScale);
}
