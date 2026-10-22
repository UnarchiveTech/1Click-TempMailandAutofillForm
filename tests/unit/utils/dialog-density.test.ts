import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { dialogDensityFor, observeDialogDensity } from '@/utils/ui/dialog-density.js';

describe('dialog density', () => {
  test('uses the dialog width and available height, not the app surface name', () => {
    expect(dialogDensityFor(336, 600)).toBe('compact');
    expect(dialogDensityFor(404, 1000)).toBe('compact');
    expect(dialogDensityFor(448, 1000)).toBe('compact');
    expect(dialogDensityFor(560, 700)).toBe('compact');
    expect(dialogDensityFor(480, 720)).toBe('roomy');
    expect(dialogDensityFor(560, 900)).toBe('roomy');
  });

  test('updates on viewport resize and restores the surface on cleanup', () => {
    const dom = new JSDOM('<div id="overlay"><div class="dialog-surface"></div></div>');
    const overlay = dom.window.document.getElementById('overlay') as HTMLElement;
    const surface = overlay.firstElementChild as HTMLElement;
    Object.defineProperty(surface, 'clientWidth', { value: 560 });
    Object.defineProperty(dom.window, 'innerHeight', { value: 900, writable: true });
    const stop = observeDialogDensity(overlay);
    expect(surface.dataset.dialogDensity).toBe('roomy');
    Object.defineProperty(dom.window, 'innerHeight', { value: 600, writable: true });
    dom.window.dispatchEvent(new dom.window.Event('resize'));
    expect(surface.dataset.dialogDensity).toBe('compact');
    stop();
    expect(surface.hasAttribute('data-dialog-density')).toBe(false);
    Object.defineProperty(dom.window, 'innerHeight', { value: 900, writable: true });
    dom.window.dispatchEvent(new dom.window.Event('resize'));
    expect(surface.hasAttribute('data-dialog-density')).toBe(false);
    dom.window.close();
  });
});
