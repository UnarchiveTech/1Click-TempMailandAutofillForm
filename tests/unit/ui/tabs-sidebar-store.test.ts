import { describe, expect, test } from 'bun:test';
import { get } from 'svelte/store';
import {
  setSidebarActiveTabs,
  sidebarActiveTabsStore,
} from '@/ui/components/composites/tabs-sidebar-store.js';

describe('tabs-sidebar-store', () => {
  test('publishes and clears active page tabs for sidebar', () => {
    let lastClicked = '';
    const mockState = {
      tabs: [
        { id: 'tab1', label: 'Tab 1', badge: 5 },
        { id: 'tab2', label: 'Tab 2', badge: 0 },
      ],
      activeTab: 'tab1',
      onchange: (id: string) => {
        lastClicked = id;
      },
    };

    setSidebarActiveTabs(mockState);
    expect(get(sidebarActiveTabsStore)).toEqual(mockState);

    mockState.onchange('tab2');
    expect(lastClicked).toBe('tab2');

    setSidebarActiveTabs(null);
    expect(get(sidebarActiveTabsStore)).toBeNull();
  });

  test('skips identical publications but delivers a changed callback', () => {
    setSidebarActiveTabs(null);
    let notifications = 0;
    let picked = '';
    const state = {
      tabs: [{ id: 'one', label: 'One' }],
      activeTab: 'one',
      onchange: () => {
        picked = 'old';
      },
    };
    const unsubscribe = sidebarActiveTabsStore.subscribe(() => {
      notifications++;
    });
    try {
      setSidebarActiveTabs(state);
      const afterFirst = notifications;
      setSidebarActiveTabs({ ...state, tabs: [...state.tabs] });
      expect(notifications).toBe(afterFirst);
      setSidebarActiveTabs({
        ...state,
        onchange: () => {
          picked = 'new';
        },
      });
      expect(notifications).toBe(afterFirst + 1);
      get(sidebarActiveTabsStore)?.onchange('one');
      expect(picked).toBe('new');
    } finally {
      unsubscribe();
      setSidebarActiveTabs(null);
    }
  });
});
