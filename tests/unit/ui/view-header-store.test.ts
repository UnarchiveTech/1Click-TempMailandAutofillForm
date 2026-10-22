import { describe, expect, test } from 'bun:test';
import { get } from 'svelte/store';
import {
  activeViewHeaderStore,
  setActiveViewHeader,
} from '@/ui/components/composites/view-header-store.js';

describe('view-header-store', () => {
  test('sets and clears dynamic view header state', () => {
    let backed = false;
    const headerState = {
      title: 'Custom Title',
      subtitle: 'Custom Subtitle',
      showBack: true,
      onBack: () => {
        backed = true;
      },
    };

    setActiveViewHeader(headerState);
    expect(get(activeViewHeaderStore)).toEqual(headerState);

    headerState.onBack();
    expect(backed).toBe(true);

    setActiveViewHeader(null);
    expect(get(activeViewHeaderStore)).toBeNull();
  });
});
