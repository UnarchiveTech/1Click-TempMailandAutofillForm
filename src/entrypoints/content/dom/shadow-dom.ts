// Shared module to manage closed Shadow DOM host and root
import { browser } from 'wxt/browser';

let shadowRoot: ShadowRoot | null = null;
const hostId = `oc-host-${Math.random().toString(36).substring(2, 15)}`;

// Session-randomized classes to avoid fingerprinting / page scraping
export const BUTTON_CLASS = `oc-btn-${Math.random().toString(36).substring(2, 8)}`;
export const CONTAINER_CLASS = `oc-container-${Math.random().toString(36).substring(2, 8)}`;
export const POPUP_CLASS = `oc-popup-${Math.random().toString(36).substring(2, 8)}`;

const DEFAULT_THEME_COLORS: Record<string, string> = {
  '--md-primary': '#4c662b',
  '--md-on-primary': '#ffffff',
  '--md-primary-container': '#cdeda3',
  '--md-on-primary-container': '#354e16',
  '--md-secondary': '#586249',
  '--md-on-secondary': '#ffffff',
  '--md-secondary-container': '#dce7c8',
  '--md-on-secondary-container': '#404a33',
  '--md-tertiary': '#386663',
  '--md-on-tertiary': '#ffffff',
  '--md-tertiary-container': '#bcece7',
  '--md-on-tertiary-container': '#1f4e4b',
  '--md-error': '#ba1a1a',
  '--md-on-error': '#ffffff',
  '--md-error-container': '#ffdad6',
  '--md-on-error-container': '#93000a',
  '--md-background': '#f9faef',
  '--md-on-background': '#1a1c16',
  '--md-surface': '#f9faef',
  '--md-on-surface': '#1a1c16',
  '--md-surface-variant': '#e1e4d5',
  '--md-on-surface-variant': '#44483d',
  '--md-outline': '#75796c',
  '--md-outline-variant': '#c5c8ba',
  '--md-inverse-surface': '#2f312a',
  '--md-inverse-on-surface': '#f1f2e6',
  '--md-inverse-primary': '#b1d18a',
  '--md-surface-container-lowest': '#ffffff',
  '--md-surface-container-low': '#f3f4e9',
  '--md-surface-container': '#eeefe3',
  '--md-surface-container-high': '#e8e9de',
  '--md-surface-container-highest': '#e2e3d8',
  '--md-success': '#306b25',
  '--md-on-success': '#ffffff',
  '--md-warning': '#795900',
  '--md-on-warning': '#ffffff',
};

export function getOrCreateShadowRoot(): ShadowRoot | null {
  if (typeof document === 'undefined') return null;
  if (shadowRoot) return shadowRoot;

  let host = document.getElementById(hostId);
  if (!host) {
    host = document.createElement('div');
    host.id = hostId;
    // Set host to be completely non-blocking, overlayed, and invisible
    // Fixed overlay host: children use position:fixed + pointer-events:auto
    host.style.cssText =
      'position:fixed;inset:0;width:0;height:0;overflow:visible;border:none;margin:0;padding:0;pointer-events:none;z-index:2147483646;';

    // Apply theme tokens immediately (sync defaults) so first paint is never unstyled
    for (const [key, value] of Object.entries(DEFAULT_THEME_COLORS)) {
      host.style.setProperty(key, value);
    }
    void (async () => {
      try {
        const result = await browser.storage.local.get(['themeColors']);
        const colors = (result.themeColors || DEFAULT_THEME_COLORS) as Record<string, string>;
        for (const [key, value] of Object.entries(colors)) {
          host.style.setProperty(key, value);
        }
      } catch {
        /* keep defaults */
      }
    })();

    // Listen for dynamic theme changes
    try {
      browser.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes.themeColors && host) {
          const newColors = changes.themeColors.newValue || DEFAULT_THEME_COLORS;
          for (const [key, value] of Object.entries(newColors)) {
            host.style.setProperty(key, value as string);
          }
        }
      });
    } catch {
      // ignore listener errors in non-extension contexts
    }

    document.body.appendChild(host);
  }

  if (!shadowRoot) {
    try {
      shadowRoot = host.attachShadow({ mode: 'closed' });
    } catch {
      // biome-ignore lint/suspicious/noExplicitAny: access private _shadowRoot fallback
      shadowRoot = (host as any)._shadowRoot;
    }
  }
  return shadowRoot;
}
