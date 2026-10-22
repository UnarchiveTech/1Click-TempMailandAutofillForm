import type { Email } from '@/utils/types.js';

export interface OpenedMessageTab {
  key: string;
  thread: Email[];
  mailboxAddress: string;
  scrollTop: number;
}

export interface MessageTabsState {
  tabs: OpenedMessageTab[];
  activeKey: string;
}

export function messageTabKey(thread: Email[], fallbackAddress = ''): string {
  const message = thread[0];
  if (!message) return '';
  return JSON.stringify([
    (message.original_inbox || fallbackAddress).toLowerCase(),
    String(message.id),
  ]);
}

export function messageTabDomId(prefix: string, key: string): string {
  return `${prefix}-tab-${encodeURIComponent(key)}`;
}

export function openMessageTab(
  state: MessageTabsState,
  thread: Email[],
  address: string
): MessageTabsState {
  if (!thread.length) return state;
  const mailboxAddress = thread[0].original_inbox || address;
  const scoped = thread.map((message) => ({
    ...message,
    original_inbox: message.original_inbox || mailboxAddress,
  }));
  const key = messageTabKey(scoped);
  const existing = state.tabs.find((tab) => tab.key === key);
  const tab: OpenedMessageTab = {
    key,
    thread: scoped,
    mailboxAddress,
    scrollTop: existing?.scrollTop ?? 0,
  };
  return {
    tabs: existing
      ? state.tabs.map((item) => (item.key === key ? tab : item))
      : [...state.tabs, tab],
    activeKey: key,
  };
}

export function removeMessageTabs(state: MessageTabsState, keys: Set<string>): MessageTabsState {
  const index = state.tabs.findIndex((tab) => tab.key === state.activeKey);
  const tabs = state.tabs.filter((tab) => !keys.has(tab.key));
  if (tabs.length === state.tabs.length) return state;
  const activeKey = tabs.some((tab) => tab.key === state.activeKey)
    ? state.activeKey
    : state.tabs.slice(index + 1).find((tab) => !keys.has(tab.key))?.key ||
      state.tabs
        .slice(0, Math.max(0, index))
        .reverse()
        .find((tab) => !keys.has(tab.key))?.key ||
      tabs[0]?.key ||
      '';
  return { tabs, activeKey };
}

export function rememberMessageScroll(
  state: MessageTabsState,
  key: string,
  scrollTop: number
): MessageTabsState {
  const value = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  if (!state.tabs.some((tab) => tab.key === key && tab.scrollTop !== value)) return state;
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.key === key ? { ...tab, scrollTop: value } : tab)),
  };
}
