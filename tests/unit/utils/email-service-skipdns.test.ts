import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';

import { EmailService, type ProviderConfig } from '@/utils/email/email-service';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mock the SSRF validator BEFORE email-service loads ──────────────────────
// We only need to observe the skipDns decision; the real DNS re-resolution is
// intentionally bypassed (and would hit the network).
const capturedSkipDns: boolean[] = [];
mock.module('@/utils/provider/instance-validation.js', () => ({
  validateFetchUrl: mock(async (_url: string, opts?: { skipDns?: boolean }) => {
    capturedSkipDns.push(!!opts?.skipDns);
    return { ok: true };
  }),
}));

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  capturedSkipDns.length = 0;
});

function makeConfig(overrides: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: 'burner',
    name: 'SkipDns Test',
    apiUrl: '{instanceUrl}',
    auth: { type: 'none' } as ProviderConfig['auth'],
    multiInstance: {
      enabled: true,
      instances: [
        {
          id: 'alphac',
          name: 'alphac',
          displayName: 'Alphac',
          apiUrl: 'https://alphac.qzz.io/api/v2',
        },
        {
          id: 'raceco',
          name: 'raceco',
          displayName: 'Raceco',
          apiUrl: 'https://raceco.dpdns.org/api/v2',
        },
      ],
    },
    ...overrides,
  } as unknown as ProviderConfig;
}

async function safeFetchVia(
  service: EmailService,
  url: string
): Promise<{ skipDns: boolean; threw: boolean }> {
  globalThis.fetch = mock(
    async () => new Response(null, { status: 200 })
  ) as unknown as typeof fetch;
  try {
    const fetcher = service as unknown as {
      safeFetch: (url: string, options: RequestInit) => Promise<Response>;
    };
    await fetcher.safeFetch(url, {});
    return { skipDns: capturedSkipDns[capturedSkipDns.length - 1] ?? false, threw: false };
  } catch {
    return { skipDns: capturedSkipDns[capturedSkipDns.length - 1] ?? false, threw: true };
  }
}

const NOOP_BROWSER = {} as unknown as Browser;

describe('safeFetch skipDns (templated {instanceUrl} hosts)', () => {
  test('skips the DNS round-trip for a bundled multi-instance host', async () => {
    const service = new EmailService(makeConfig({}), NOOP_BROWSER);
    const { skipDns, threw } = await safeFetchVia(service, 'https://alphac.qzz.io/api/v2/emails');
    expect(threw).toBe(false);
    expect(skipDns).toBe(true);
  });

  test('still runs the full DNS validation for a custom (non-bundled) host', async () => {
    const service = new EmailService(makeConfig({}), NOOP_BROWSER);
    const { skipDns, threw } = await safeFetchVia(service, 'https://custom.attacker.io/api/emails');
    expect(threw).toBe(false);
    expect(skipDns).toBe(false);
  });

  test('a bundled non-templated apiUrl skips DNS for its own host only', async () => {
    const service = new EmailService(
      makeConfig({
        id: 'guerrilla',
        apiUrl: 'https://api.guerrillamail.com/ajax.php',
        multiInstance: { enabled: false, instances: [] },
      }),
      NOOP_BROWSER
    );
    const own = await safeFetchVia(
      service,
      'https://api.guerrillamail.com/ajax.php?f=get_email_address'
    );
    expect(own.skipDns).toBe(true);
    const other = await safeFetchVia(service, 'https://other.example.com/x');
    expect(other.skipDns).toBe(false);
  });

  test('unrelated host with the same suffix still gets DNS validation', async () => {
    const service = new EmailService(makeConfig({}), NOOP_BROWSER);
    // Bundled host is alphac.qzz.io - a sibling subdomain must NOT match.
    const { skipDns } = await safeFetchVia(service, 'https://evil.qzz.io/phish');
    expect(skipDns).toBe(false);
  });
});
