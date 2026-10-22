import { describe, expect, test } from 'bun:test';
import { get } from 'svelte/store';
import {
  activeFabActionStore,
  type FloatingActionDescriptor,
  setActiveFabAction,
} from '@/ui/components/composites/fab-action-store.js';

describe('fab-action-store', () => {
  test('sets and clears active FAB action', () => {
    let clicked = false;
    const descriptor: FloatingActionDescriptor = {
      kind: 'createTag',
      icon: 'tag',
      labelKey: 'nav.fabCreateTag',
      onclick: () => {
        clicked = true;
      },
    };

    setActiveFabAction(descriptor);
    expect(get(activeFabActionStore)).toEqual(descriptor);

    descriptor.onclick();
    expect(clicked).toBe(true);

    setActiveFabAction(null);
    expect(get(activeFabActionStore)).toBeNull();
  });
});
