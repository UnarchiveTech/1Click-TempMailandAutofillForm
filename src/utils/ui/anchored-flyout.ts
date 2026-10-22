import { registerEscapeTier, topEscapeTierId } from '@/features/keyboard-shortcuts/escape-stack.js';
import { PORTAL_Z } from './portal-layers.js';

export interface AnchoredFlyoutOptions {
  /** Defaults to the local wrapper, captured before the menu is portaled. */
  anchor?: HTMLElement | (() => HTMLElement | null);
  placement?:
    | 'bottom-start'
    | 'bottom-end'
    | 'top-start'
    | 'top-end'
    | 'inline-start'
    | 'inline-end';
  matchWidth?: boolean;
  onClose?: () => void;
  /** Context menus retain their click coordinates instead of following a button. */
  point?: { x: number; y: number };
}

// Weak ownership links die with the menu, and are removed on teardown as well.
// Portaling must not turn a submenu or a search result into an outside click.
const owners = new WeakMap<HTMLElement, HTMLElement>();
let nextId = 0;

/** Hover must not replace the row beneath the pointer with an overlapping panel. */
export function hasInlineFlyoutSpace(trigger: HTMLElement, width: number): boolean {
  const menu = trigger.closest('[role="menu"]') || trigger;
  const rect = menu.getBoundingClientRect();
  return rect.left >= width + 12 || window.innerWidth - rect.right >= width + 12;
}

export function flyoutContains(owner: HTMLElement | null, target: EventTarget | null): boolean {
  if (!owner || !(target instanceof Node)) return false;
  let current: Node | null = target;
  const visited = new Set<Node>();
  while (current && !visited.has(current)) {
    if (owner.contains(current)) return true;
    visited.add(current);
    current =
      current instanceof HTMLElement
        ? owners.get(current) || current.parentNode
        : current.parentNode;
  }
  return false;
}

/** Body portal + measured, viewport-bounded placement for custom menus.
 * Keeps nested menus above their parent, including inside modal dialogs. */
export function anchoredFlyout(node: HTMLElement, options?: AnchoredFlyoutOptions) {
  if (!options || !node.parentElement) return {};
  let config = options;
  const owner = node.parentElement;
  const initialStyle = getComputedStyle(node);
  const initialWidth = node.getBoundingClientRect().width || node.scrollWidth;
  const heightLimit = Number.parseFloat(initialStyle.maxHeight) || Number.POSITIVE_INFINITY;
  const parentMenu = owner.closest<HTMLElement>('[data-anchored-flyout], [role="menu"]');
  const parentLayer = parentMenu ? Number.parseFloat(getComputedStyle(parentMenu).zIndex) || 0 : 0;
  const inDialog = !!owner.closest('[aria-modal="true"]') || parentLayer >= PORTAL_Z.dialog;
  const authoredLayer = Number.parseFloat(initialStyle.zIndex) || 0;
  node.style.zIndex = String(
    inDialog
      ? PORTAL_Z.dialogMenu
      : authoredLayer >= PORTAL_Z.dialog
        ? PORTAL_Z.dialog
        : parentMenu
          ? PORTAL_Z.submenu
          : PORTAL_Z.accountMenu
  );
  node.dir = getComputedStyle(owner).direction;
  owners.set(node, owner);
  node.dataset.anchoredFlyout = '';
  document.body.appendChild(node);
  const id = `anchored-flyout:${++nextId}`;
  let raf = 0;
  let destroyed = false;

  const anchor = () =>
    typeof config.anchor === 'function' ? config.anchor() : config.anchor || owner;
  const place = () => {
    const trigger = anchor();
    if (!trigger?.isConnected || destroyed) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const gap = 4;
    const width = Math.max(
      0,
      Math.min(config.matchWidth ? rect.width : initialWidth, window.innerWidth - margin * 2)
    );
    const rtl = getComputedStyle(trigger).direction === 'rtl';
    node.style.position = 'fixed';
    node.style.margin = '0';
    node.style.inset = 'auto';
    node.style.transform = 'none';
    node.style.translate = 'none';
    node.style.minWidth = '0';
    node.style.width = `${width}px`;
    node.style.maxWidth = `${window.innerWidth - margin * 2}px`;
    node.style.overflowY = 'auto';
    node.style.overscrollBehavior = 'contain';
    const placement = config.placement || 'bottom-start';
    let left = placement.endsWith('end') !== rtl ? rect.right - width : rect.left;
    let top = rect.bottom + gap;
    let available = window.innerHeight - top - margin;
    let overlap = false;
    if (config.point) {
      left = config.point.x;
      top = config.point.y;
      available = window.innerHeight - margin * 2;
    } else if (placement.startsWith('inline')) {
      const preferLeft = (placement === 'inline-start') !== rtl;
      const fitsLeft = rect.left - gap - width >= margin;
      const fitsRight = rect.right + gap + width <= window.innerWidth - margin;
      overlap = !fitsLeft && !fitsRight;
      left = overlap
        ? rect.left
        : (preferLeft && fitsLeft) || !fitsRight
          ? rect.left - gap - width
          : rect.right + gap;
      top = rect.top;
      available = window.innerHeight - margin * 2;
    } else {
      const above = rect.top - gap - margin;
      const desired = Math.min(node.scrollHeight, heightLimit);
      const up = placement.startsWith('top')
        ? above >= Math.min(desired, available)
        : available < desired && above > available;
      if (up) {
        available = above;
        top = rect.top - gap - Math.min(desired, available);
      }
    }
    const maxHeight = Math.max(0, Math.min(heightLimit, available));
    node.style.maxHeight = `${maxHeight}px`;
    const height = Math.min(node.scrollHeight, maxHeight);
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
    node.style.left = `${Math.round(left)}px`;
    node.style.top = `${Math.round(top)}px`;
    node.dataset.flyoutPlacement = overlap ? 'overlap' : placement;
  };
  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(place);
  };
  const close = () => config.onClose?.();
  const releaseEscape = config.onClose ? registerEscapeTier(id, close) : () => {};
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !config.onClose || topEscapeTierId() !== id) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const trigger = anchor();
    const focusTarget = trigger?.matches('button, input, [tabindex]')
      ? trigger
      : trigger?.querySelector<HTMLElement>('button, input, [tabindex]');
    focusTarget?.focus({ preventScroll: true });
    // Focus handlers may open suggestions; the explicit dismissal wins last.
    close();
  };
  const onPointer = (event: PointerEvent) => {
    if (
      !flyoutContains(node, event.target) &&
      (config.point || !flyoutContains(anchor(), event.target))
    )
      close();
  };
  window.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onPointer, true);
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, true);
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  observer?.observe(node);
  const trigger = anchor();
  if (trigger) observer?.observe(trigger);
  place();
  schedule();
  return {
    update(next?: AnchoredFlyoutOptions) {
      if (next) {
        config = next;
        schedule();
      }
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      releaseEscape();
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      owners.delete(node);
      node.remove();
    },
  };
}
