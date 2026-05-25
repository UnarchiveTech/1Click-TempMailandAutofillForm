import { type Component, mount } from 'svelte';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';

export default defineUnlistedScript(() => {});

interface BrowserAPI {
  runtime?: {
    sendMessage?: (...args: unknown[]) => Promise<unknown>;
  };
  storage?: {
    local?: {
      get?: (...args: unknown[]) => Promise<unknown>;
      set?: (...args: unknown[]) => Promise<unknown>;
    };
  };
  tabs?: {
    query?: (...args: unknown[]) => Promise<unknown>;
  };
}

// Cross-browser support: use webextension-polyfill, fallback to chrome
async function init(Component: Component) {
  let api: BrowserAPI | undefined;
  try {
    const browser = await import('webextension-polyfill');
    api = browser.default as BrowserAPI;
  } catch (_e) {
    api = (window as { chrome?: BrowserAPI }).chrome;
  }
  (window as { browser?: BrowserAPI; chrome?: BrowserAPI }).browser = api;
  (window as { browser?: BrowserAPI; chrome?: BrowserAPI }).chrome = api;
  mount(Component, {
    target: document.getElementById('app')!,
  });
}

export function mountEntrypoint(Component: Component) {
  init(Component);
}
