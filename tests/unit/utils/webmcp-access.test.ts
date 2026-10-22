import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

const local: Record<string, unknown> = {};
const session: Record<string, unknown> = {};
let tab = { url: 'https://shop.example.test/signup', status: 'complete' };
function area(store: Record<string, unknown>) {
  return {
    get: async (keys: string | string[]) =>
      Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, store[key]])),
    set: async (items: Record<string, unknown>) => {
      Object.assign(store, items);
    },
    remove: async (key: string) => {
      delete store[key];
    },
  };
}
mock.module('wxt/browser', () => ({
  browser: {
    storage: { local: area(local), session: area(session) },
    tabs: { get: async () => tab },
  },
}));
mock.module('@/utils/mutex.js', () => ({
  withLock: async (_key: string, operation: () => Promise<unknown>) => operation(),
}));
afterAll(() => mock.restore());
const {
  setWebmcpAccessChoice,
  getWebmcpAccessChoice,
  isWebmcpAccessAllowed,
  clearWebmcpOnce,
  persistentWebmcpAccess,
} = await import('@/utils/browser/webmcp-access.js');
beforeEach(() => {
  for (const key of Object.keys(local)) delete local[key];
  for (const key of Object.keys(session)) delete session[key];
  tab = { url: 'https://shop.example.test/signup', status: 'complete' };
});
describe('site email-tool consent', () => {
  test('permanent consent is exact-host; legacy domain grants remain directional', async () => {
    await setWebmcpAccessChoice(7, tab.url, 'always');
    expect(await isWebmcpAccessAllowed(8, tab.url)).toBe(true);
    expect(await isWebmcpAccessAllowed(8, 'https://child.shop.example.test/')).toBe(false);
    expect(persistentWebmcpAccess('shop.example.test', ['example.test'], {})).toBe(true);
    expect(persistentWebmcpAccess('other.test', ['example.test'], {})).toBe(false);
  });
  test('once is scoped to its tab and exact document URL, then revoked on navigation or close', async () => {
    await setWebmcpAccessChoice(7, tab.url, 'once');
    expect(await getWebmcpAccessChoice(7, tab.url)).toBe('once');
    expect(await isWebmcpAccessAllowed(7, tab.url)).toBe(true);
    expect(await isWebmcpAccessAllowed(8, tab.url)).toBe(false);
    expect(await isWebmcpAccessAllowed(7, 'https://shop.example.test/other')).toBe(false);
    await clearWebmcpOnce(7);
    expect(await isWebmcpAccessAllowed(7, tab.url)).toBe(false);
  });
  test('never and once override inherited grants without revoking neighbouring sites', async () => {
    local.webmcpAccessList = ['example.test'];
    await setWebmcpAccessChoice(7, tab.url, 'never');
    expect(await getWebmcpAccessChoice(7, tab.url)).toBe('never');
    expect(await isWebmcpAccessAllowed(7, tab.url)).toBe(false);
    expect(await isWebmcpAccessAllowed(8, 'https://neighbour.example.test/')).toBe(true);
    await setWebmcpAccessChoice(7, tab.url, 'once');
    expect(await isWebmcpAccessAllowed(8, tab.url)).toBe(false);
    await clearWebmcpOnce(7);
    expect(await isWebmcpAccessAllowed(7, tab.url)).toBe(false);
  });
  test('navigation during consent and invalid page contexts fail closed', async () => {
    await expect(setWebmcpAccessChoice(7, 'https://old.test/', 'once')).rejects.toThrow(
      'site-changed'
    );
    expect(await isWebmcpAccessAllowed(undefined, tab.url)).toBe(false);
    expect(await isWebmcpAccessAllowed(7, 'file:///secret')).toBe(false);
    expect(await isWebmcpAccessAllowed(7, 'invalid')).toBe(false);
    tab.status = 'loading';
    await expect(setWebmcpAccessChoice(7, tab.url, 'once')).rejects.toThrow('site-changed');
  });
});
