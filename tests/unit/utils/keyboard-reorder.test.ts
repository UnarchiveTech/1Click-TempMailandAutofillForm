import { beforeEach, expect, test } from 'bun:test';
import { keyboardReorder } from '@/utils/ui/keyboard-reorder.js';
import { cleanupDom, setupDom } from '../helpers/svelte-harness.js';

setupDom();
beforeEach(() => cleanupDom());

test('downward keyboard movement swaps the next row before the focused row', async () => {
  const node = document.createElement('div');
  const button = document.createElement('button');
  node.appendChild(button);
  document.body.appendChild(node);
  button.focus();
  const moves: string[][] = [];
  const action = keyboardReorder(node, {
    id: 'a',
    ids: ['a', 'b', 'c'],
    hint: 'Move',
    moveBefore: (source, target) => {
      moves.push([source, target]);
    },
  });
  const event = new KeyboardEvent('keydown', {
    key: 'ArrowDown',
    altKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  button.dispatchEvent(event);
  await Promise.resolve();
  expect(event.defaultPrevented).toBe(true);
  expect(moves).toEqual([['b', 'a']]);
  expect(node.getAttribute('aria-keyshortcuts')).toContain('Alt+Shift+ArrowDown');
  action.destroy();
  expect(node.hasAttribute('aria-keyshortcuts')).toBe(false);
});

test('upward movement uses stable ids and leaves disabled or typing controls alone', () => {
  const node = document.createElement('div');
  const input = document.createElement('input');
  node.appendChild(input);
  const moves: string[][] = [];
  const options = {
    id: 'b',
    ids: ['a', 'b', 'c'],
    hint: 'Move',
    moveBefore: (source: string, target: string) => {
      moves.push([source, target]);
    },
  };
  const action = keyboardReorder(node, options);
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, shiftKey: true, bubbles: true })
  );
  expect(moves).toEqual([]);
  action.update({ ...options, disabled: true });
  node.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, shiftKey: true })
  );
  expect(moves).toEqual([]);
  action.update(options);
  node.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, shiftKey: true })
  );
  expect(moves).toEqual([['b', 'a']]);
  action.destroy();
});

test('a delayed reorder reads current ids and does not steal focus from another control', async () => {
  const node = document.createElement('div');
  const button = document.createElement('button');
  const elsewhere = document.createElement('button');
  node.appendChild(button);
  document.body.append(node, elsewhere);
  button.focus();
  let ids = ['a', 'b', 'c'];
  const moves: string[][] = [];
  let finish: (() => void) | undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const action = keyboardReorder(node, {
    id: 'a',
    ids: () => ids,
    hint: 'Move',
    moveBefore: async (source, target) => {
      moves.push([source, target]);
      await done;
    },
  });
  ids = ['a', 'c', 'b'];
  button.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      altKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
  );
  expect(moves).toEqual([['c', 'a']]);
  elsewhere.focus();
  finish?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.activeElement).toBe(elsewhere);
  action.destroy();
});
