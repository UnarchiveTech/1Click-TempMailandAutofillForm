import { describe, expect, test } from 'bun:test';
import {
  type MessageTabsState,
  messageTabKey,
  openMessageTab,
  rememberMessageScroll,
  removeMessageTabs,
} from '@/features/address/message-tabs.js';
import type { Email } from '@/utils/types.js';

const empty = (): MessageTabsState => ({ tabs: [], activeKey: '' });
const mail = (id: string, owner = 'a@example.com'): Email => ({
  id,
  subject: id,
  original_inbox: owner,
  received_at: 1,
});

describe('open message tabs', () => {
  test('opening an existing message focuses it without duplicating or losing scroll', () => {
    let state = openMessageTab(empty(), [mail('one')], '');
    state = rememberMessageScroll(state, state.activeKey, 250);
    state = openMessageTab(state, [mail('two')], '');
    state = openMessageTab(state, [{ ...mail('one'), subject: 'Updated' }], '');
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs[0].scrollTop).toBe(250);
    expect(state.tabs[0].thread[0].subject).toBe('Updated');
    expect(state.activeKey).toBe(state.tabs[0].key);
  });

  test('same ID in two inboxes creates distinct tabs while address casing deduplicates', () => {
    let state = openMessageTab(empty(), [mail('42')], '');
    state = openMessageTab(state, [mail('42', 'b@example.com')], '');
    state = openMessageTab(state, [mail('42', 'A@EXAMPLE.COM')], '');
    expect(state.tabs).toHaveLength(2);
    expect(messageTabKey([mail('Ab')])).not.toBe(messageTabKey([mail('ab')]));
  });

  test('missing ownership is stamped once and retained after an inbox switch', () => {
    const message: Email = { id: '42', received_at: 1 };
    const state = openMessageTab(empty(), [message], 'a@example.com');
    expect(message.original_inbox).toBeUndefined();
    expect(state.tabs[0].thread[0].original_inbox).toBe('a@example.com');
    const reopened = openMessageTab(state, state.tabs[0].thread, 'b@example.com');
    expect(reopened.tabs).toHaveLength(1);
    expect(reopened.tabs[0].mailboxAddress).toBe('a@example.com');
  });

  test('closing the active tab selects the next neighbour, or the previous last tab', () => {
    let state = empty();
    for (const id of ['one', 'two', 'three']) state = openMessageTab(state, [mail(id)], '');
    state = openMessageTab(state, [mail('two')], '');
    state = removeMessageTabs(state, new Set([state.activeKey]));
    expect(state.tabs.find((tab) => tab.key === state.activeKey)?.thread[0].id).toBe('three');
    state = removeMessageTabs(state, new Set([state.activeKey]));
    expect(state.tabs[0].thread[0].id).toBe('one');
    state = removeMessageTabs(state, new Set([state.activeKey]));
    expect(state).toEqual(empty());
  });

  test('closing an inactive tab preserves the active message', () => {
    let state = openMessageTab(empty(), [mail('one')], '');
    state = openMessageTab(state, [mail('two')], '');
    const active = state.activeKey;
    state = removeMessageTabs(state, new Set([state.tabs[0].key]));
    expect(state.activeKey).toBe(active);
  });

  test('bulk removal chooses the original nearest surviving neighbour', () => {
    let state = empty();
    for (const id of ['one', 'two', 'three', 'four', 'five'])
      state = openMessageTab(state, [mail(id)], '');
    state = openMessageTab(state, [mail('three')], '');
    state = removeMessageTabs(state, new Set([state.tabs[1].key, state.tabs[2].key]));
    expect(state.tabs.find((tab) => tab.key === state.activeKey)?.thread[0].id).toBe('four');
  });

  test('closed tabs ignore late scroll callbacks and invalid positions cannot persist', () => {
    let state = openMessageTab(empty(), [mail('one')], '');
    const key = state.activeKey;
    state = rememberMessageScroll(state, key, Number.NaN);
    expect(state.tabs[0].scrollTop).toBe(0);
    state = removeMessageTabs(state, new Set([key]));
    expect(rememberMessageScroll(state, key, 999)).toBe(state);
    expect(openMessageTab(state, [], '')).toBe(state);
  });
});
