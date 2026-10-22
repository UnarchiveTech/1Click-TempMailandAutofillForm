import { describe, expect, test } from 'bun:test';
import {
  changePageZoom,
  getPageZoomSetting,
  normalizePageZoomScale,
  normalizePageZoomSettings,
  PAGE_ZOOM_MAX,
  PAGE_ZOOM_MIN,
  updatePageZoomSetting,
} from '@/features/settings/page-zoom.js';

describe('page zoom settings', () => {
  test('defaults pages to enabled and inherits the previous global scale', () => {
    expect(getPageZoomSetting({}, 'mailbox', 1.2)).toEqual({ enabled: true, scale: 1.2 });
  });

  test('normalizes untrusted persisted ids and zoom values', () => {
    expect(
      normalizePageZoomSettings({
        mailbox: { enabled: false, scale: 9 },
        settings: { enabled: 'yes', scale: 0.2 },
        unknownPage: { enabled: false, scale: 1.3 },
        analytics: null,
        about: [],
      })
    ).toEqual({
      mailbox: { enabled: false, scale: PAGE_ZOOM_MAX },
      settings: { enabled: true, scale: PAGE_ZOOM_MIN },
    });
    expect(normalizePageZoomSettings([])).toEqual({});
  });

  test('clamps scales and rounds them to hundredths', () => {
    expect(normalizePageZoomScale(1.234)).toBe(1.23);
    expect(normalizePageZoomScale(Number.NaN, 1.1)).toBe(1.1);
    expect(normalizePageZoomScale(Number.NaN, Number.NaN)).toBe(1);
    expect(normalizePageZoomScale(Number.POSITIVE_INFINITY)).toBe(1);
  });

  test('changes one page and preserves the others', () => {
    const initial = {
      mailbox: { enabled: false, scale: 1.3 },
      addresses: { enabled: true, scale: 0.9 },
    } as const;

    const updated = changePageZoom(initial, 'addresses', 1);

    expect(updated.addresses).toEqual({ enabled: true, scale: 1 });
    expect(updated.mailbox).toEqual(initial.mailbox);
  });

  test('resets the selected page to 100% and keeps its enabled state', () => {
    const reset = changePageZoom({ mailbox: { enabled: false, scale: 1.4 } }, 'mailbox', 0);

    expect(reset.mailbox).toEqual({ enabled: false, scale: 1 });
  });

  test('updates the page enabled flag without changing its scale', () => {
    expect(updatePageZoomSetting({}, 'mailbox', { enabled: false }, 1.25).mailbox).toEqual({
      enabled: false,
      scale: 1.25,
    });
  });
});
