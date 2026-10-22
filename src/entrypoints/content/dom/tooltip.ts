import { TOAST_DEFAULT_DURATION_MS } from '@/utils/content/content-constants.js';
import { CONTENT_Z } from '@/utils/ui/portal-layers.js';
import { getOrCreateShadowRoot } from './shadow-dom.js';

function hostRoot(): ShadowRoot | HTMLElement {
  return getOrCreateShadowRoot() || document.body;
}

type FeedbackOverlayRecord = {
  element: HTMLElement;
  fadeTimer: ReturnType<typeof setTimeout> | null;
  removeTimer: ReturnType<typeof setTimeout> | null;
  onDispose?: () => void;
};

const feedbackOverlays = new Set<FeedbackOverlayRecord>();

function disposeOverlay(record: FeedbackOverlayRecord): void {
  if (record.fadeTimer) clearTimeout(record.fadeTimer);
  if (record.removeTimer) clearTimeout(record.removeTimer);
  record.fadeTimer = null;
  record.removeTimer = null;
  record.onDispose?.();
  feedbackOverlays.delete(record);
  record.element.remove();
}

function registerOverlay(
  element: HTMLElement,
  durationMs: number,
  fadeDurationMs: number,
  exitTransform: string,
  onDispose?: () => void
): () => void {
  const record: FeedbackOverlayRecord = {
    element,
    fadeTimer: null,
    removeTimer: null,
    onDispose,
  };
  feedbackOverlays.add(record);
  record.fadeTimer = setTimeout(() => {
    record.fadeTimer = null;
    if (!element.isConnected) {
      disposeOverlay(record);
      return;
    }
    element.style.opacity = '0';
    element.style.transform = exitTransform;
    record.removeTimer = setTimeout(() => {
      record.removeTimer = null;
      disposeOverlay(record);
    }, fadeDurationMs);
  }, durationMs);
  return () => disposeOverlay(record);
}

function positionAnchorOverlay(overlay: HTMLElement, anchor: HTMLElement, gap: number): boolean {
  if (!overlay.isConnected || !anchor.isConnected) return false;
  const anchorRect = anchor.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  const below = anchorRect.bottom + gap;
  const top =
    below + overlayRect.height <= window.innerHeight - 8
      ? below
      : Math.max(8, anchorRect.top - overlayRect.height - gap);
  const maxLeft = Math.max(8, window.innerWidth - overlayRect.width - 8);
  overlay.style.top = `${top}px`;
  overlay.style.left = `${Math.max(8, Math.min(anchorRect.left, maxLeft))}px`;
  return true;
}

/** Keep short-lived feedback attached through scrolling and page layout changes. */
function observeAnchorOverlay(
  overlay: HTMLElement,
  anchor: HTMLElement,
  gap: number,
  dispose: () => void
): () => void {
  let frame: number | null = null;
  const reposition = () => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (!positionAnchorOverlay(overlay, anchor, gap)) dispose();
    });
  };
  const onScroll = () => reposition();
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onScroll);

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(reposition);
    resizeObserver.observe(anchor);
    resizeObserver.observe(overlay);
  }

  let mutationObserver: MutationObserver | null = null;
  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    mutationObserver = new MutationObserver((records) => {
      if (records.some((record) => !overlay.contains(record.target))) reposition();
    });
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden'],
    });
  }

  return () => {
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onScroll);
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
  };
}

function removeExistingOverlays(attribute: string): void {
  for (const record of [...feedbackOverlays]) {
    if (record.element.hasAttribute(attribute)) disposeOverlay(record);
  }
}

/** Remove all content-script feedback overlays and cancel their pending timers. */
export function clearInjectedFeedback(): void {
  for (const record of [...feedbackOverlays]) disposeOverlay(record);
}

export async function showTooltip(
  element: HTMLElement,
  message: string,
  _isError: boolean
): Promise<void> {
  if (!element.isConnected) return;
  removeExistingOverlays('data-1click-tooltip');
  const tooltip = document.createElement('div');
  const reduceMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  tooltip.className = 'autofill-tooltip';
  tooltip.setAttribute('data-1click-tooltip', '1');
  tooltip.textContent = message;
  tooltip.style.cssText = `
    position: fixed;
    background-color: var(--md-inverse-surface);
    color: var(--md-inverse-on-surface);
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 14px;
    z-index: ${CONTENT_Z.tooltip};
    max-width: min(250px, calc(100vw - 16px));
    box-shadow: 0 2px 10px color-mix(in srgb, var(--md-shadow) 20%, transparent);
    opacity: 0;
    transform: translateY(3px);
    transition: ${reduceMotion ? 'none' : 'opacity 140ms cubic-bezier(0.2, 0, 0, 1), transform 140ms cubic-bezier(0.2, 0, 0, 1)'};
    font-family: system-ui, sans-serif;
    pointer-events: none;
  `;

  let disposeTooltip = () => {};
  const reposition = () => {
    if (!tooltip.isConnected) return;
    if (!element.isConnected) {
      disposeTooltip();
      return;
    }
    const rect = element.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const above = rect.top - tooltipRect.height - 8;
    const below = rect.bottom + 8;
    const top =
      above >= 8
        ? above
        : Math.min(below, Math.max(8, window.innerHeight - tooltipRect.height - 8));
    const left = Math.max(
      8,
      Math.min(
        rect.left + rect.width / 2 - tooltipRect.width / 2,
        window.innerWidth - tooltipRect.width - 8
      )
    );
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  };

  hostRoot().appendChild(tooltip);
  const repositionOnViewportChange = () => reposition();
  disposeTooltip = registerOverlay(
    tooltip,
    TOAST_DEFAULT_DURATION_MS,
    300,
    'translateY(-2px)',
    () => {
      window.removeEventListener('scroll', repositionOnViewportChange, true);
      window.removeEventListener('resize', repositionOnViewportChange);
    }
  );
  window.addEventListener('scroll', repositionOnViewportChange, true);
  window.addEventListener('resize', repositionOnViewportChange);
  reposition();
  if (reduceMotion) {
    tooltip.style.opacity = '1';
    tooltip.style.transform = 'none';
  } else {
    requestAnimationFrame(() => {
      if (!tooltip.isConnected) return;
      tooltip.style.opacity = '1';
      tooltip.style.transform = 'translateY(0)';
    });
  }
}

/**
 * Stronger than a tooltip: fixed chip under the field for “email already used”.
 */
export function showConflictChip(anchor: HTMLElement, message: string, durationMs = 6000): void {
  if (!anchor.isConnected) return;
  removeExistingOverlays('data-1click-conflict-chip');
  const chip = document.createElement('div');
  const reduceMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  chip.setAttribute('data-1click-conflict-chip', '1');
  chip.setAttribute('role', 'status');
  chip.textContent = message;
  chip.style.cssText = `
    position: fixed;
    z-index: ${CONTENT_Z.tooltip};
    max-width: min(320px, calc(100vw - 16px));
    padding: 8px 12px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    font-family: system-ui, sans-serif;
    line-height: 1.3;
    color: var(--md-on-error-container);
    background: var(--md-error-container);
    border: 1px solid color-mix(in srgb, var(--md-error) 40%, transparent);
    box-shadow: 0 4px 14px color-mix(in srgb, var(--md-shadow) 18%, transparent);
    opacity: 0;
    transform: translateY(3px);
    transition: ${reduceMotion ? 'none' : 'opacity 140ms cubic-bezier(0.2, 0, 0, 1), transform 140ms cubic-bezier(0.2, 0, 0, 1)'};
    pointer-events: none;
  `;
  hostRoot().appendChild(chip);
  positionAnchorOverlay(chip, anchor, 6);
  if (reduceMotion) {
    chip.style.opacity = '1';
    chip.style.transform = 'none';
  } else {
    requestAnimationFrame(() => {
      if (!chip.isConnected) return;
      chip.style.opacity = '1';
      chip.style.transform = 'translateY(0)';
    });
  }
  let stopTracking = () => {};
  const dispose = registerOverlay(chip, durationMs, 280, 'translateY(-2px)', () => stopTracking());
  stopTracking = observeAnchorOverlay(chip, anchor, 6, dispose);
}

/**
 * Micro-status after autofill: identity · email · provider
 */
export function showFillMicroStatus(anchor: HTMLElement, text: string, durationMs = 5000): void {
  if (!anchor.isConnected) return;
  removeExistingOverlays('data-1click-fill-status');
  const bar = document.createElement('div');
  const reduceMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  bar.setAttribute('data-1click-fill-status', '1');
  bar.setAttribute('role', 'status');
  bar.textContent = text;
  bar.style.cssText = `
    position: fixed;
    z-index: ${CONTENT_Z.tooltip};
    max-width: min(360px, calc(100vw - 16px));
    padding: 8px 12px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 600;
    font-family: system-ui, sans-serif;
    line-height: 1.35;
    color: var(--md-on-primary-container);
    background: var(--md-primary-container);
    border: 1px solid color-mix(in srgb, var(--md-primary) 35%, transparent);
    box-shadow: 0 4px 14px color-mix(in srgb, var(--md-shadow) 14%, transparent);
    opacity: 0;
    transform: translateY(3px);
    transition: ${reduceMotion ? 'none' : 'opacity 140ms cubic-bezier(0.2, 0, 0, 1), transform 140ms cubic-bezier(0.2, 0, 0, 1)'};
    pointer-events: none;
    white-space: normal;
  `;
  hostRoot().appendChild(bar);
  positionAnchorOverlay(bar, anchor, 8);
  if (reduceMotion) {
    bar.style.opacity = '1';
    bar.style.transform = 'none';
  } else {
    requestAnimationFrame(() => {
      if (!bar.isConnected) return;
      bar.style.opacity = '1';
      bar.style.transform = 'translateY(0)';
    });
  }
  let stopTracking = () => {};
  const dispose = registerOverlay(bar, durationMs, 280, 'translateY(-2px)', () => stopTracking());
  stopTracking = observeAnchorOverlay(bar, anchor, 8, dispose);
}
