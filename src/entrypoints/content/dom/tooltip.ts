import { TOAST_DEFAULT_DURATION_MS } from '@/utils/constants.js';
import { getOrCreateShadowRoot } from './shadow-dom.js';

function hostRoot(): ShadowRoot | HTMLElement {
  return getOrCreateShadowRoot() || document.body;
}

export async function showTooltip(
  element: HTMLElement,
  message: string,
  _isError: boolean
): Promise<void> {
  const tooltip = document.createElement('div');
  tooltip.className = 'autofill-tooltip';
  tooltip.textContent = message;
  tooltip.style.cssText = `
    position: fixed;
    background-color: var(--md-inverse-surface, #313033);
    color: var(--md-inverse-on-surface, #f4eff4);
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 14px;
    z-index: 10001;
    max-width: 250px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    transition: opacity 0.3s;
    font-family: system-ui, sans-serif;
    pointer-events: none;
  `;

  const rect = element.getBoundingClientRect();
  tooltip.style.top = `${Math.max(8, rect.top - 40)}px`;
  tooltip.style.left = `${Math.max(8, rect.left + rect.width / 2 - 125)}px`;

  hostRoot().appendChild(tooltip);

  setTimeout(() => {
    tooltip.style.opacity = '0';
    setTimeout(() => {
      if (tooltip.parentNode) {
        tooltip.parentNode.removeChild(tooltip);
      }
    }, 300);
  }, TOAST_DEFAULT_DURATION_MS);
}

/**
 * Stronger than a tooltip: fixed chip under the field for “email already used”.
 */
export function showConflictChip(anchor: HTMLElement, message: string, durationMs = 6000): void {
  for (const n of document.querySelectorAll('[data-1click-conflict-chip]')) {
    n.remove();
  }
  const chip = document.createElement('div');
  chip.setAttribute('data-1click-conflict-chip', '1');
  chip.setAttribute('role', 'status');
  chip.textContent = message;
  chip.style.cssText = `
    position: fixed;
    z-index: 10002;
    max-width: min(320px, calc(100vw - 16px));
    padding: 8px 12px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    font-family: system-ui, sans-serif;
    line-height: 1.3;
    color: #410002;
    background: #ffdad6;
    border: 1px solid #ffb4ab;
    box-shadow: 0 4px 14px rgba(0,0,0,0.18);
    pointer-events: none;
  `;
  const rect = anchor.getBoundingClientRect();
  chip.style.top = `${rect.bottom + 6}px`;
  chip.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 328))}px`;
  hostRoot().appendChild(chip);
  setTimeout(() => {
    chip.style.opacity = '0';
    chip.style.transition = 'opacity 0.25s';
    setTimeout(() => chip.remove(), 280);
  }, durationMs);
}

/**
 * Micro-status after autofill: identity · email · provider
 */
export function showFillMicroStatus(anchor: HTMLElement, text: string, durationMs = 5000): void {
  for (const n of document.querySelectorAll('[data-1click-fill-status]')) {
    n.remove();
  }
  const bar = document.createElement('div');
  bar.setAttribute('data-1click-fill-status', '1');
  bar.setAttribute('role', 'status');
  bar.textContent = text;
  bar.style.cssText = `
    position: fixed;
    z-index: 10002;
    max-width: min(360px, calc(100vw - 16px));
    padding: 8px 12px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 600;
    font-family: system-ui, sans-serif;
    line-height: 1.35;
    color: var(--md-on-primary-container, #1d192b);
    background: var(--md-primary-container, #e8def8);
    border: 1px solid color-mix(in srgb, var(--md-primary, #6750a4) 35%, transparent);
    box-shadow: 0 4px 14px rgba(0,0,0,0.14);
    pointer-events: none;
    white-space: normal;
  `;
  const rect = anchor.getBoundingClientRect();
  bar.style.top = `${rect.bottom + 8}px`;
  bar.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 368))}px`;
  hostRoot().appendChild(bar);
  setTimeout(() => {
    bar.style.opacity = '0';
    bar.style.transition = 'opacity 0.25s';
    setTimeout(() => bar.remove(), 280);
  }, durationMs);
}
