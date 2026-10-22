import { tick } from 'svelte';
import { logError } from '@/utils/logger.js';

export interface KeyboardReorderOptions {
  id: string;
  ids: readonly string[] | (() => readonly string[]);
  disabled?: boolean;
  hint: string;
  /** Same before-target convention as pointer reordering. */
  moveBefore: (sourceId: string, targetId: string) => void | Promise<void>;
}

/** Keyboard alternative to dragging a row, preserving the focused record. */
export function keyboardReorder(node: HTMLElement, initial: KeyboardReorderOptions) {
  let options = initial;
  let busy = false;
  const previousTitle = node.getAttribute('title');
  const previousKeys = node.getAttribute('aria-keyshortcuts');
  function update(next: KeyboardReorderOptions) {
    options = next;
    if (next.disabled) {
      node.removeAttribute('aria-keyshortcuts');
      if (previousTitle === null) node.removeAttribute('title');
      else node.setAttribute('title', previousTitle);
      return;
    }
    node.setAttribute('aria-keyshortcuts', 'Alt+Shift+ArrowUp Alt+Shift+ArrowDown');
    node.title = previousTitle ? `${previousTitle} · ${next.hint}` : next.hint;
  }
  async function onKeydown(event: KeyboardEvent) {
    if (
      options.disabled ||
      !event.altKey ||
      !event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      !['ArrowUp', 'ArrowDown'].includes(event.key)
    )
      return;
    if (
      event.target instanceof HTMLElement &&
      event.target.closest('input, textarea, select, [contenteditable="true"]')
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    // Read the order only when moving, rather than mapping the whole list for
    // every rendered row on every update.
    const ids = typeof options.ids === 'function' ? options.ids() : options.ids;
    const index = ids.indexOf(options.id);
    const neighbour = ids[index + (event.key === 'ArrowUp' ? -1 : 1)];
    if (index < 0 || !neighbour) return;
    const focused = document.activeElement;
    busy = true;
    try {
      // Down swaps the following row before this one, avoiding a no-op when
      // inserting this row before the immediately following target.
      await options.moveBefore(
        event.key === 'ArrowUp' ? options.id : neighbour,
        event.key === 'ArrowUp' ? neighbour : options.id
      );
      await tick();
      // An asynchronous save must not pull focus back after the user tabs away.
      if (document.activeElement === focused || document.activeElement === document.body) {
        if (focused instanceof HTMLElement && focused.isConnected) focused.focus();
        else if (node.isConnected) node.querySelector<HTMLElement>('[data-row-primary]')?.focus();
      }
    } catch (error) {
      logError('Keyboard row reorder failed', error);
    } finally {
      busy = false;
    }
  }
  update(initial);
  node.addEventListener('keydown', onKeydown);
  return {
    update,
    destroy() {
      node.removeEventListener('keydown', onKeydown);
      if (previousTitle === null) node.removeAttribute('title');
      else node.setAttribute('title', previousTitle);
      if (previousKeys === null) node.removeAttribute('aria-keyshortcuts');
      else node.setAttribute('aria-keyshortcuts', previousKeys);
    },
  };
}
