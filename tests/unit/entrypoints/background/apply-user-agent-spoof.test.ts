import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});

interface InjectOptions {
  target: { tabId: number };
  world: string;
  func: (userAgent: string, platform: string) => void;
  args: [string, string];
}

const storageGet = mock(async (_keys: string[]) => ({}) as Record<string, unknown>);
const executeScript = mock(async (_options: InjectOptions) => [{ result: undefined }]);
const logError = mock((..._args: unknown[]) => {});

mock.module('wxt/browser', () => ({
  browser: {
    storage: { local: { get: storageGet } },
    scripting: { executeScript },
  },
}));
mock.module('@/utils/logger.js', () => ({ logError }));

const { applyUserAgentSpoofToTab, resolveSpoofedUserAgent } = await import(
  '@/entrypoints/background/apply-user-agent-spoof.js'
);

/** A real preset string (USER_AGENT_PRESETS.chrome_mac) - `isSafeUserAgentString` accepts it. */
const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** Seed the two storage keys the resolver reads. */
function seedActiveIdentity(userAgent?: string) {
  storageGet.mockImplementation(
    async () =>
      ({
        identities: [{ id: 'identity-1', ...(userAgent ? { userAgent } : {}) }],
        selectedIdentityId: 'identity-1',
      }) as Record<string, unknown>
  );
}

async function capturedInjection(): Promise<InjectOptions> {
  const [call] = executeScript.mock.calls;
  if (!call) throw new Error('executeScript was never called');
  return call[0];
}

describe('resolveSpoofedUserAgent', () => {
  beforeEach(() => {
    storageGet.mockReset();
    executeScript.mockReset();
    logError.mockReset();
  });

  test('returns the active identity spoof with the platform inferred from it', async () => {
    seedActiveIdentity(MAC_UA);
    await expect(resolveSpoofedUserAgent()).resolves.toEqual({
      userAgent: MAC_UA,
      platform: 'MacIntel',
    });
  });

  test('is null when no identity carries a User-Agent', async () => {
    seedActiveIdentity();
    await expect(resolveSpoofedUserAgent()).resolves.toBeNull();
  });

  test('refuses a User-Agent that is not safe for page-world injection', async () => {
    // `isSafeUserAgentString` rejects script-breaking characters and anything
    // that is neither a known preset nor a printable Mozilla-style string.
    seedActiveIdentity('Mozilla/5.0 </script><script>alert(1)</script>');
    await expect(resolveSpoofedUserAgent()).resolves.toBeNull();
  });
});

describe('applyUserAgentSpoofToTab', () => {
  beforeEach(() => {
    storageGet.mockReset();
    executeScript.mockReset();
    executeScript.mockImplementation(async (_options: InjectOptions) => [{ result: undefined }]);
    logError.mockReset();
  });

  test('installs the override in the tab MAIN world, where no page CSP applies', async () => {
    seedActiveIdentity(MAC_UA);

    await expect(applyUserAgentSpoofToTab(7)).resolves.toBe(true);

    const options = await capturedInjection();
    expect(options.target).toEqual({ tabId: 7 });
    // The whole point of this path: MAIN world is what the page's CSP cannot
    // block, unlike the inline <script> the content script tries first.
    expect(options.world).toBe('MAIN');
    expect(options.args).toEqual([MAC_UA, 'MacIntel']);
  });

  test('does not inject when the identity has no spoof to install', async () => {
    seedActiveIdentity();

    await expect(applyUserAgentSpoofToTab(7)).resolves.toBe(false);
    expect(executeScript).not.toHaveBeenCalled();
  });

  test('reports failure instead of throwing when the injection is refused', async () => {
    seedActiveIdentity(MAC_UA);
    executeScript.mockImplementation(async () => {
      throw new Error('Cannot access contents of the page');
    });

    await expect(applyUserAgentSpoofToTab(7)).resolves.toBe(false);
    // A silent false here would restore the blind spot this path exists to close.
    expect(logError).toHaveBeenCalledTimes(1);
  });

  test('the injected function overrides the page navigator with no closure of its own', async () => {
    seedActiveIdentity(MAC_UA);
    await applyUserAgentSpoofToTab(7);
    const { func } = await capturedInjection();

    // `executeScript` serializes `func` and runs it in another world, so it may
    // not reference any outer binding. Invoking it here is the in-process
    // equivalent: a closure would throw a ReferenceError.
    const page = navigator as Navigator & { userAgentData?: unknown };
    const saved = {
      userAgent: Object.getOwnPropertyDescriptor(page, 'userAgent'),
      platform: Object.getOwnPropertyDescriptor(page, 'platform'),
      userAgentData: Object.getOwnPropertyDescriptor(page, 'userAgentData'),
    };
    try {
      Object.defineProperty(page, 'userAgent', {
        value: 'real',
        configurable: true,
        writable: true,
      });
      Object.defineProperty(page, 'platform', {
        value: 'real',
        configurable: true,
        writable: true,
      });
      Object.defineProperty(page, 'userAgentData', {
        value: { brands: [] },
        configurable: true,
        writable: true,
      });

      func('spoofed-ua', 'Win32');

      expect(page.userAgent).toBe('spoofed-ua');
      expect(page.platform).toBe('Win32');
      // Hidden, so sites fall back to the (spoofed) navigator.userAgent.
      expect(page.userAgentData).toBeUndefined();
    } finally {
      for (const [key, descriptor] of Object.entries(saved)) {
        if (descriptor) Object.defineProperty(page, key, descriptor);
        else delete (page as unknown as Record<string, unknown>)[key];
      }
    }
  });
});
