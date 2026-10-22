import { expect, test } from 'bun:test';
import { createShortcutDiscovery } from '@/features/keyboard-shortcuts/shortcut-discovery.js';

const release = { key: '/', code: 'Slash' } as KeyboardEvent;

test('non-Slash layouts dismiss on the original physical key even after Shift release', async () => {
  const calls: Array<boolean | string> = [];
  const controller = createShortcutDiscovery(
    (open) => calls.push(open),
    () => calls.push('sheet'),
    () => true,
    15
  );
  controller.press('Comma');
  await new Promise((resolve) => setTimeout(resolve, 30));
  controller.release({ key: 'Shift', code: 'ShiftLeft' } as KeyboardEvent);
  controller.release(release);
  expect(calls).toEqual([true]);
  controller.release({ key: ',', code: 'Comma' } as KeyboardEvent);
  expect(calls).toEqual([true, false]);
});
test('tap opens the complete sheet, while hold reveals and release dismisses hints', async () => {
  const calls: Array<boolean | string> = [];
  const controller = createShortcutDiscovery(
    (open) => calls.push(open),
    () => calls.push('sheet'),
    () => true,
    15
  );
  controller.press();
  controller.release(release);
  expect(calls).toEqual(['sheet']);
  calls.length = 0;
  controller.press();
  controller.press();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(calls).toEqual([true]);
  controller.release(release);
  expect(calls).toEqual([true, false]);
});

test('cancel and a newly opened modal prevent a delayed reveal or accidental tap', async () => {
  const calls: Array<boolean | string> = [];
  let allowed = true;
  const controller = createShortcutDiscovery(
    (open) => calls.push(open),
    () => calls.push('sheet'),
    () => allowed,
    15
  );
  controller.press();
  controller.cancel();
  controller.release(release);
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(calls).toEqual([]);
  controller.press();
  allowed = false;
  await new Promise((resolve) => setTimeout(resolve, 30));
  controller.release(release);
  expect(calls).toEqual([]);
});
