import { beforeEach, describe, expect, mock, test } from 'bun:test';

import type { ViewHandoffDeps } from '@/features/navigation/view-handoff.js';
import { applyOpenViewHandoff } from '@/features/navigation/view-handoff.js';

/**
 * applyOpenViewHandoff reads a payload from session first, then falls back to
 * local. openExtensionUiInternal writes session first and only falls back to
 * local when session storage is unavailable, so a
 * session consume must also purge the local mirror - otherwise the next open
 * replays the handoff through the local fallback.
 */

interface FakeStorageArea {
  data: Record<string, unknown>;
  get: (k: string | string[]) => Promise<Record<string, unknown>>;
  set: (v: Record<string, unknown>) => Promise<void>;
  remove: (k: string | string[]) => Promise<void>;
}

function makeArea(): FakeStorageArea {
  const area: FakeStorageArea = {
    data: {},
    async get(k) {
      if (typeof k === 'string') return { [k]: area.data[k] };
      const out: Record<string, unknown> = {};
      for (const key of k) out[key] = area.data[key];
      return out;
    },
    async set(v) {
      Object.assign(area.data, v);
    },
    async remove(k) {
      for (const key of typeof k === 'string' ? [k] : k) delete area.data[key];
    },
  };
  return area;
}

const HANDOFF_KEYS = [
  'openView',
  'openIdentityCreate',
  'openIdentityEditId',
  'autofillTab',
  'openExtensionTarget',
  'openViewAt',
];

function freshHandoff<T extends Record<string, unknown>>(payload: T): T & { openViewAt: number } {
  return { ...payload, openViewAt: Date.now() };
}

let session: FakeStorageArea;
let local: FakeStorageArea;
let deps: ViewHandoffDeps;
let viewCalls: string[];

beforeEach(() => {
  session = makeArea();
  local = makeArea();
  viewCalls = [];
  deps = {
    ext: { storage: { session, local } } as unknown as Browser,
    context: 'popup',
    setCurrentView: mock((v: string) => viewCalls.push(v)),
    setAutofillTabValue: mock(() => {}),
    incrementAutofillTabSignal: mock(() => {}),
    incrementIdentityCreateSignal: mock(() => {}),
    setIdentityEditIdSignal: mock(() => {}),
    setSelectedEmail: mock(() => {}),
    setDisplayedEmail: mock(() => {}),
    tick: mock(async () => {}),
  };
});

describe('applyOpenViewHandoff mirror purge', () => {
  test('consuming a session payload also purges its local mirror (no replay on next open)', async () => {
    // openExtensionUiInternal mirrored the same payload into session + local
    // (the local copy is written only on session-less browsers, but the purge
    // below must still handle it defensively).
    const payload = freshHandoff({ openView: 'mailbox' });
    session.set(payload);
    local.set(payload);

    await applyOpenViewHandoff(deps);

    // Consumed once from session…
    expect(viewCalls).toEqual(['mailbox']);
    for (const key of HANDOFF_KEYS) expect(session.data[key]).toBeUndefined();
    // …and the local mirror (incl. the openViewAt marker) is gone so it cannot
    // replay: storage surface stays write-once, read-once.
    for (const key of HANDOFF_KEYS) expect(local.data[key]).toBeUndefined();

    // Next open (no payload anywhere): no navigation replay.
    await applyOpenViewHandoff(deps);
    expect(viewCalls).toEqual(['mailbox']);
  });

  test('session purge does not wipe local-only pre-set state (omnibox autofillTab)', async () => {
    // openExtensionView mirrors ONLY openView into session; the caller
    // pre-set autofillTab='credentials' local-only BEFORE it. The session
    // consume must leave that local pre-set for the in-flow tab read.
    session.set(freshHandoff({ openView: 'autofill' }));
    local.set({ autofillTab: 'credentials' });

    await applyOpenViewHandoff(deps);

    expect(viewCalls).toEqual(['autofill']);
    // Credentials intent preserved through the surviving local autofillTab.
    expect(deps.setAutofillTabValue).toHaveBeenCalledWith('credentials');
    expect(local.data.autofillTab).toBeUndefined(); // consumed by the tab-pref read
  });

  test('full identity mirror in session purges every mirrored local key', async () => {
    const payload = freshHandoff({
      openView: 'autofill',
      autofillTab: 'profiles',
      openIdentityCreate: true,
      openExtensionTarget: 'popup',
    });
    session.set(payload);
    local.set(payload);

    await applyOpenViewHandoff(deps);

    expect(viewCalls).toEqual(['autofill']);
    for (const key of HANDOFF_KEYS) expect(local.data[key]).toBeUndefined();

    await applyOpenViewHandoff(deps);
    expect(viewCalls).toEqual(['autofill']); // no replay
  });

  test('local-only cold-open payload is still consumed via the fallback', async () => {
    // background/index.ts cold-open writes openView+autofillTab to local only.
    await local.set(freshHandoff({ openView: 'autofill', autofillTab: 'credentials' }));

    await applyOpenViewHandoff(deps);

    expect(viewCalls).toEqual(['autofill']);
    for (const key of HANDOFF_KEYS) expect(local.data[key]).toBeUndefined();
    await applyOpenViewHandoff(deps);
    expect(viewCalls).toEqual(['autofill']);
  });

  test('popup-targeted identity payload is left alone for the popup by an app context', async () => {
    const payload = freshHandoff({
      openView: 'autofill',
      autofillTab: 'profiles',
      openIdentityCreate: true,
      openExtensionTarget: 'popup',
    });
    session.set(payload);
    local.set(payload);
    deps = { ...deps, context: 'app' };

    await applyOpenViewHandoff(deps);

    // App/sidepanel must not consume the popup-only payload.
    expect(viewCalls).toEqual([]);
    expect(session.data.openExtensionTarget).toBe('popup');
    expect(local.data.openExtensionTarget).toBe('popup');
    // The timestamp marker rides with the unconsumed payload too.
    expect(session.data.openViewAt).toBe(payload.openViewAt);
    expect(local.data.openViewAt).toBe(payload.openViewAt);
  });

  test('session availability failure leaves the local mirror for the local fallback', async () => {
    const payload = freshHandoff({ openView: 'mailbox' });
    session.set(payload);
    local.set(payload);
    // Session reads throw (session-less browser) - consumer must fall back.
    session.get = mock(async () => {
      throw new Error('session unavailable');
    });

    await applyOpenViewHandoff(deps);

    expect(viewCalls).toEqual(['mailbox']);
    // The local fallback consume clears the whole payload incl. the marker.
    for (const key of HANDOFF_KEYS) expect(local.data[key]).toBeUndefined();
    await applyOpenViewHandoff(deps);
    expect(viewCalls).toEqual(['mailbox']);
  });

  test('unknown openView id is rejected instead of blanking the main pane', async () => {
    // A stale/garbage payload must not reach setCurrentView: AppShell's
    // `{:else}` fallback renders content only for `mailbox`, so an unknown id
    // would leave the app with a blank main pane until the next navigation.
    local.set(freshHandoff({ openView: 'definitelyNotAView' }));
    await applyOpenViewHandoff(deps);
    expect(viewCalls).toEqual([]);

    // Same guard on the URL-param path.
    deps = { ...deps, context: 'popup' };
    local.set({});
    await applyOpenViewHandoff(deps, { openView: 'garbage' });
    expect(viewCalls).toEqual([]);
  });

  test('an explicit handoff clears superseded stored payloads instead of replaying them later', async () => {
    session.set(freshHandoff({ openView: 'mailbox' }));
    local.set(freshHandoff({ openView: 'mailbox' }));

    await applyOpenViewHandoff(deps, { openView: 'autofill' });

    expect(viewCalls).toEqual(['autofill']);
    for (const key of HANDOFF_KEYS) {
      expect(session.data[key]).toBeUndefined();
      expect(local.data[key]).toBeUndefined();
    }

    await applyOpenViewHandoff(deps);
    expect(viewCalls).toEqual(['autofill']);
  });

  test('a URL-provided view also clears the older pending handoff', async () => {
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    const originalHistory = Object.getOwnPropertyDescriptor(globalThis, 'history');
    Object.defineProperty(globalThis, 'location', {
      value: { href: 'chrome-extension://extension-id/app.html?view=autofill' },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'history', {
      value: { replaceState: () => {} },
      configurable: true,
    });
    session.set(freshHandoff({ openView: 'mailbox' }));
    local.set(freshHandoff({ openView: 'mailbox' }));

    try {
      await applyOpenViewHandoff(deps);
      expect(viewCalls).toEqual(['autofill']);
      for (const key of HANDOFF_KEYS) {
        expect(session.data[key]).toBeUndefined();
        expect(local.data[key]).toBeUndefined();
      }
    } finally {
      if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
      else Reflect.deleteProperty(globalThis, 'location');
      if (originalHistory) Object.defineProperty(globalThis, 'history', originalHistory);
      else Reflect.deleteProperty(globalThis, 'history');
    }
  });

  test('explicit app navigation preserves a pending popup-only handoff', async () => {
    deps = { ...deps, context: 'app' };
    const popupPayload = freshHandoff({
      openView: 'autofill',
      openExtensionTarget: 'popup',
    });
    session.set(popupPayload);
    local.set(popupPayload);

    await applyOpenViewHandoff(deps, { openView: 'mailbox' });

    expect(viewCalls).toEqual(['mailbox']);
    expect(session.data.openExtensionTarget).toBe('popup');
    expect(local.data.openExtensionTarget).toBe('popup');
  });

  test('legacy activity alias maps to the canonical analytics view', async () => {
    local.set(freshHandoff({ openView: 'activity' }));
    await applyOpenViewHandoff(deps);
    expect(viewCalls).toEqual(['analytics']);
  });

  test('openViewAt marker is purged from both areas once the payload is consumed', async () => {
    // Background writers always emit the timestamp marker with openView:
    // openExtensionView ({ openView, openViewAt }, both areas) and
    // openExtensionUiInternal (viewPayload incl. openViewAt; local copy written
    // only on session-less browsers).
    const payload = freshHandoff({ openView: 'mailbox' });
    session.set(payload);
    local.set(payload);

    await applyOpenViewHandoff(deps);

    // Payload applied, marker gone from both namespaces - no residual copies.
    expect(viewCalls).toEqual(['mailbox']);
    expect(session.data.openViewAt).toBeUndefined();
    expect(local.data.openViewAt).toBeUndefined();

    // A fresh handoff with a new timestamp still triggers and consumes.
    session.set(freshHandoff({ openView: 'mailbox' }));
    await applyOpenViewHandoff(deps);
    expect(session.data.openViewAt).toBeUndefined();
    expect(viewCalls).toEqual(['mailbox', 'mailbox']);
  });
});
