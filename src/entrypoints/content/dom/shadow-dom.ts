// Shared module to manage closed Shadow DOM host and root
import { getStorageViaBg } from '@/utils/content/content-bg-bridge.js';
import { CONTENT_DEFAULT_THEME_COLORS } from '@/utils/content/content-default-theme-colors.js';
import { CONTENT_TYPE_TOKENS } from '@/utils/content/content-typography.js';
import { CONTENT_Z } from '@/utils/ui/portal-layers.js';

let shadowRoot: ShadowRoot | null = null;
// Keep the host id session-random and unbranded. A stable prefix or marker
// gives every visited page a cheap extension-presence fingerprint.
const hostId = `_${Math.random().toString(36).substring(2, 15)}`;

// Session-randomized classes to avoid fingerprinting / page scraping
export const BUTTON_CLASS = `oc-btn-${Math.random().toString(36).substring(2, 8)}`;
export const CONTAINER_CLASS = `oc-container-${Math.random().toString(36).substring(2, 8)}`;
export const POPUP_CLASS = `oc-popup-${Math.random().toString(36).substring(2, 8)}`;

/**
 * Default light-standard palette for the injected UI - PRECOMPUTED from
 * generateThemeColorsSync(DEFAULT_THEME_SEED, false, 0) so the content
 * script never bundles the ~80 KB Material color solver. Regenerate with
 * `bun run generate-content-theme`; tests/unit/utils/theme/theme-generator.test.ts
 * fails if this drifts from the solver. The stored user theme still overrides
 * these defaults at runtime (see loadStoredTheme below).
 */
const DEFAULT_THEME_COLORS: Record<string, string> = { ...CONTENT_DEFAULT_THEME_COLORS };

// Theme tokens currently applied to the host. Defaults until the stored
// theme loads; the load caches into storedThemeColors so later host
// (re)creations paint final colors synchronously instead of flashing.
let activeThemeColors: Record<string, string> = DEFAULT_THEME_COLORS;
let storedThemeColors: Record<string, string> | null = null;
let themeLoadStarted = false;

const HOST_STYLE =
  'position:fixed!important;inset:0!important;width:0!important;height:0!important;overflow:visible!important;border:none!important;margin:0!important;padding:0!important;pointer-events:none!important;z-index:' +
  CONTENT_Z.popup +
  '!important;opacity:1!important;visibility:visible!important;display:block!important;transform:none!important;clip:auto!important;clip-path:none!important;filter:none!important;';

let hostGuardObserver: MutationObserver | null = null;
let hostEl: HTMLElement | null = null;

function applyHostStyle(host: HTMLElement): void {
  host.style.cssText = HOST_STYLE;
  // Re-apply critical props that aggressive sites may override via stylesheet
  host.style.setProperty('z-index', String(CONTENT_Z.popup), 'important');
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('pointer-events', 'none', 'important');
  host.style.setProperty('opacity', '1', 'important');
  host.style.setProperty('visibility', 'visible', 'important');
  host.style.setProperty('display', 'block', 'important');
  // The cssText assignment above wipes custom properties - re-apply the
  // active theme tokens so injected UI never drifts to the hardcoded CSS
  // fallbacks (#4c662b etc.) and jumps between palettes mid-session.
  for (const [key, value] of Object.entries(activeThemeColors)) {
    host.style.setProperty(key, value);
  }
  for (const [key, value] of Object.entries(CONTENT_TYPE_TOKENS)) {
    host.style.setProperty(key, value);
  }
}

/**
 * Load the stored theme once, at module scope, and apply it to the host
 * when it arrives. Kicking it off at content-script startup (not lazily at
 * first host creation) means it resolves - via the same background SW the
 * icon/translation messages use - long before any injected UI paints, so
 * the first paint already uses the FINAL palette. No visibility gating:
 * the UI can never be stuck hidden waiting on a hung background SW.
 */
async function loadStoredTheme(): Promise<void> {
  if (themeLoadStarted) return;
  themeLoadStarted = true;
  let colors: Record<string, string> = DEFAULT_THEME_COLORS;
  try {
    const result = (await getStorageViaBg(['themeColors'])) as {
      themeColors?: Record<string, string>;
    };
    const stored = result?.themeColors;
    if (stored && Object.keys(stored).length > 0) colors = stored;
  } catch {
    /* keep defaults */
  }
  storedThemeColors = colors;
  activeThemeColors = colors;
  if (hostEl?.isConnected) {
    for (const [key, value] of Object.entries(colors)) {
      hostEl.style.setProperty(key, value);
    }
  }
}

// Start the theme load immediately when the content script's module loads,
// ahead of any form detection / injection work.
void loadStoredTheme();

function ensureHostInBody(host: HTMLElement): void {
  try {
    if (!document.body) return;
    if (host.parentElement !== document.body) {
      document.body.appendChild(host);
    }
  } catch {
    /* ignore */
  }
}

function startHostGuard(host: HTMLElement): void {
  if (hostGuardObserver || typeof document === 'undefined') return;
  hostGuardObserver = new MutationObserver(() => {
    if (!host.isConnected) {
      try {
        document.body?.appendChild(host);
        applyHostStyle(host);
      } catch {
        /* ignore */
      }
    } else {
      // Re-assert styles if site stripped them
      try {
        if (host.style.display === 'none' || host.style.visibility === 'hidden') {
          applyHostStyle(host);
        }
      } catch {
        /* ignore */
      }
    }
  });
  try {
    hostGuardObserver.observe(document.documentElement, { childList: true, subtree: true });
  } catch {
    /* ignore */
  }
}

/** Re-assert host on top of SPA DOM churn (Canva etc.). */
export function protectShadowHost(): void {
  const root = getOrCreateShadowRoot();
  if (!root || !hostEl) return;
  ensureHostInBody(hostEl);
  applyHostStyle(hostEl);
}

export function getOrCreateShadowRoot(): ShadowRoot | null {
  if (typeof document === 'undefined') return null;

  // Recover if host was removed from DOM (SPA frameworks)
  let host = hostEl?.isConnected ? hostEl : document.getElementById(hostId);
  if (!host?.isConnected) {
    shadowRoot = null;
    host = document.createElement('div');
    host.id = hostId;
    applyHostStyle(host);
    // The stored theme was requested at module init; if it already resolved,
    // apply the cached tokens synchronously so first paint is final.
    if (storedThemeColors) {
      for (const [key, value] of Object.entries(storedThemeColors)) {
        host.style.setProperty(key, value);
      }
    }

    ensureHostInBody(host);
    hostEl = host;
    startHostGuard(host);
  } else {
    hostEl = host as HTMLElement;
    applyHostStyle(hostEl);
    ensureHostInBody(hostEl);
    startHostGuard(hostEl);
  }

  if (!shadowRoot) {
    try {
      shadowRoot = host.attachShadow({ mode: 'closed' });
    } catch {
      shadowRoot = (host as unknown as { _shadowRoot?: ShadowRoot | null })._shadowRoot || null;
      if (!shadowRoot) {
        try {
          // Host may already have shadow - recreate host
          host.remove();
          hostEl = null;
          shadowRoot = null;
          return getOrCreateShadowRoot();
        } catch {
          /* ignore */
          return null;
        }
      }
    }
  }
  return shadowRoot;
}
