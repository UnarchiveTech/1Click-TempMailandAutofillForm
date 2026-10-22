/**
 * Email-body scoped zoom.
 *
 * Page-level browser zoom (Ctrl+wheel / Ctrl+=/-/0) is intentionally blocked
 * for the whole extension UI (see AppLayout's preventUiZoom/preventUiWheelZoom).
 * Letting the browser zoom run over the message would scale the ENTIRE MailView
 * - headers, toolbars, sidebars included - because browser zoom is viewport-wide
 * and can never target a single element.
 *
 * Instead, when one of those gestures happens with the pointer/focus over the
 * mail body, we preventDefault() the browser zoom and apply the standard CSS
 * `zoom` property to just the `.email-body` host element (the EmailBody shadow
 * host). Everything outside the body keeps its size; images and tables inside
 * scale along with the text, like a real zoom. The last-used scale is persisted
 * so newly opened messages start at the user's preferred size.
 */

import { browser } from 'wxt/browser';
import { writeWithRetry } from '@/utils/storage/storage-write.js';

export const EMAIL_BODY_ZOOM_MIN = 0.5;
export const EMAIL_BODY_ZOOM_MAX = 3;
export const EMAIL_BODY_ZOOM_STEP = 0.1;

const STORAGE_KEY = 'emailBodyZoom';
/** Marks a host the user explicitly scaled, so re-renders don't reset it. */
const SCALE_ATTR = 'data-zoom-scale';

let defaultZoom = 1;
let defaultLoaded = false;
let defaultLoadPromise: Promise<number> | null = null;
let defaultRevision = 0;

function clamp(scale: number): number {
  const rounded = Math.round(scale * 100) / 100;
  return Math.min(EMAIL_BODY_ZOOM_MAX, Math.max(EMAIL_BODY_ZOOM_MIN, rounded));
}

function readScale(host: HTMLElement): number {
  const raw = Number(host.getAttribute(SCALE_ATTR));
  return Number.isFinite(raw) && raw > 0 ? clamp(raw) : defaultZoom;
}

function writeScale(host: HTMLElement, scale: number): number {
  const next = clamp(scale);
  host.setAttribute(SCALE_ATTR, String(next));
  if (next === 1) host.style.removeProperty('zoom');
  else host.style.setProperty('zoom', String(next));
  return next;
}

function persistDefault(scale: number): void {
  defaultZoom = scale;
  defaultLoaded = true;
  defaultRevision++;
  try {
    // Non-critical preference - a storage failure must never break zooming.
    // The retry wrapper absorbs transient hiccups; a permanent failure is
    // still swallowed here (the zoom keeps working either way).
    void writeWithRetry({ [STORAGE_KEY]: scale }).catch(() => {
      /* ignore */
    });
  } catch {
    /* ignore */
  }
}

/**
 * Outermost `.email-body` host in the event's composed path, or null.
 * Scanned from the document end inward so a stray `email-body` class inside
 * the message markup itself can never shadow the real host. Small
 * `[data-selectable-text]` spans in the UI chrome (copy buttons, address
 * fields) deliberately do NOT match - zoom stays limited to message content.
 */
export function findEmailBodyHost(event: Event): HTMLElement | null {
  const path = event.composedPath();
  for (let i = path.length - 1; i >= 0; i--) {
    const node = path[i];
    if (node instanceof Element && node.matches('.email-body')) return node as HTMLElement;
  }
  return null;
}

/** Step the body's zoom in (+1) or out (-1); persists as the new default. */
export function stepEmailBodyZoom(host: HTMLElement, direction: 1 | -1): number {
  const next = writeScale(host, readScale(host) + direction * EMAIL_BODY_ZOOM_STEP);
  persistDefault(next);
  return next;
}

/** Reset one body to 100%; persists as the new default. */
export function resetEmailBodyZoom(host: HTMLElement): void {
  writeScale(host, 1);
  persistDefault(1);
}

/** Current persisted default scale (1 until storage has been read). */
export function getDefaultEmailBodyZoom(): number {
  return defaultZoom;
}

/** Load the persisted default once; safe to call on every render. */
export async function ensureDefaultEmailBodyZoomLoaded(): Promise<number> {
  if (defaultLoaded) return defaultZoom;
  if (defaultLoadPromise) return defaultLoadPromise;
  const revision = defaultRevision;
  defaultLoadPromise = (async () => {
    try {
      const result = (await browser.storage.local.get([STORAGE_KEY])) as Record<string, unknown>;
      if (revision === defaultRevision) {
        const stored = Number(result[STORAGE_KEY]);
        if (Number.isFinite(stored) && stored > 0) defaultZoom = clamp(stored);
        defaultLoaded = true;
      }
    } catch {
      // Keep the current scale and allow a later render to retry the read.
    }
    return defaultZoom;
  })().finally(() => {
    defaultLoadPromise = null;
  });
  return defaultLoadPromise;
}

/**
 * Apply the persisted default to a freshly rendered body. Skips hosts the
 * user already scaled by hand so re-renders never clobber a live gesture.
 */
export async function applyPersistedBodyZoom(host: HTMLElement | null): Promise<void> {
  if (!host || typeof document === 'undefined') return;
  await ensureDefaultEmailBodyZoomLoaded();
  if (!host.isConnected || host.hasAttribute(SCALE_ATTR)) return;
  const scale = getDefaultEmailBodyZoom();
  if (scale !== 1) writeScale(host, scale);
}
