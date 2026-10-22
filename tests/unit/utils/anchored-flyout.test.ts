import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { clearEscapeTiers } from '@/features/keyboard-shortcuts/escape-stack.js';
import {
  anchoredFlyout,
  flyoutContains,
  hasInlineFlyoutSpace,
} from '@/utils/ui/anchored-flyout.js';
import { PORTAL_Z } from '@/utils/ui/portal-layers.js';
import { cleanupDom, setupDom } from '../helpers/svelte-harness.js';

let releases: Array<() => void> = [];
beforeEach(() => {
  setupDom();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
});
afterEach(() => {
  for (const release of releases.reverse()) release();
  releases = [];
  clearEscapeTiers();
  cleanupDom();
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON() {},
  } as DOMRect;
}
function elements(top = 540, contentHeight = 160) {
  const owner = document.createElement('div');
  const trigger = document.createElement('button');
  const menu = document.createElement('div');
  owner.append(trigger, menu);
  document.body.append(owner);
  owner.getBoundingClientRect = () => rect(300, top, 32, 32);
  trigger.getBoundingClientRect = owner.getBoundingClientRect;
  menu.getBoundingClientRect = () => rect(300, top + 36, 220, contentHeight);
  Object.defineProperty(menu, 'scrollHeight', { configurable: true, value: contentHeight });
  return { owner, trigger, menu };
}

describe('anchored menu contract', () => {
  test('portals beyond clipping ancestors and flips above a bottom trigger', () => {
    const { owner, trigger, menu } = elements();
    owner.style.overflow = 'hidden';
    owner.style.transform = 'translateX(0)';
    const action = anchoredFlyout(menu, { anchor: trigger });
    releases.push(() => action.destroy?.());
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.position).toBe('fixed');
    expect(menu.style.left).toBe('132px');
    expect(menu.style.top).toBe('376px');
    expect(Number(menu.style.zIndex)).toBeGreaterThan(PORTAL_Z.chrome);
    expect(flyoutContains(owner, menu)).toBe(true);
  });
  test('long menus scroll inside the available viewport', () => {
    const { trigger, menu } = elements(540, 1000);
    const action = anchoredFlyout(menu, { anchor: trigger });
    releases.push(() => action.destroy?.());
    expect(menu.style.top).toBe('8px');
    expect(Number.parseFloat(menu.style.maxHeight)).toBeLessThan(600);
    expect(menu.style.overflowY).toBe('auto');
  });
  test('nested ownership keeps child actions inside the root menu', () => {
    const { owner, trigger, menu } = elements(100);
    menu.setAttribute('role', 'menu');
    const parent = anchoredFlyout(menu, { anchor: trigger });
    releases.push(() => parent.destroy?.());
    const child = document.createElement('div');
    child.getBoundingClientRect = () => rect(0, 0, 220, 100);
    Object.defineProperty(child, 'scrollHeight', { value: 100 });
    menu.append(child);
    const action = anchoredFlyout(child, { placement: 'inline-start' });
    releases.push(() => action.destroy?.());
    expect(flyoutContains(owner, child)).toBe(true);
    expect(flyoutContains(menu, child)).toBe(true);
    expect(Number(child.style.zIndex)).toBe(PORTAL_Z.submenu);
  });
  test('Escape dismisses only the top submenu and prevents popup dismissal', () => {
    const { trigger, menu } = elements(100);
    let parentClosed = 0;
    let childClosed = 0;
    const parent = anchoredFlyout(menu, {
      anchor: trigger,
      onClose: () => {
        parentClosed++;
      },
    });
    releases.push(() => parent.destroy?.());
    const child = document.createElement('div');
    menu.append(child);
    const action = anchoredFlyout(child, {
      onClose: () => {
        childClosed++;
      },
    });
    releases.push(() => action.destroy?.());
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(childClosed).toBe(1);
    expect(parentClosed).toBe(0);
    expect(event.defaultPrevented).toBe(true);
  });
  test('dialog menus stay above their modal and release ownership on destroy', () => {
    const { owner, trigger, menu } = elements();
    owner.setAttribute('aria-modal', 'true');
    const action = anchoredFlyout(menu, { anchor: trigger });
    expect(Number(menu.style.zIndex)).toBe(PORTAL_Z.dialogMenu);
    action.destroy?.();
    expect(flyoutContains(owner, menu)).toBe(false);
  });
  test('narrow layouts do not hover-open a panel over its own trigger', () => {
    const { trigger } = elements(100);
    expect(hasInlineFlyoutSpace(trigger, 320)).toBe(false);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    expect(hasInlineFlyoutSpace(trigger, 320)).toBe(true);
  });
});
