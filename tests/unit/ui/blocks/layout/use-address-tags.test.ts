import { describe, expect, test } from 'bun:test';
import {
  type AddressTagsDeps,
  createAddressTagsController,
} from '@/ui/blocks/layout/use-address-tags.svelte.js';
import type { Address } from '@/utils/types.js';

function makeHarness() {
  const sends: Array<{
    type: string;
    addressIds?: string[];
    addressId?: string;
    tag: string;
    color?: string;
  }> = [];
  let response: unknown = { success: true };
  const toastCalls: Array<{ message: string; type?: string }> = [];
  let loaded = 0;

  const targets: Address[] = [
    { id: 'inbox-1', address: 'a@x.com', provider: 'g' } as Address,
    { id: 'inbox-2', address: 'b@x.com', provider: 'g' } as Address,
  ];

  const ext = {
    runtime: {
      id: 'test-addr-tags',
      sendMessage: async (msg: {
        type: string;
        addressIds?: string[];
        addressId?: string;
        tag: string;
        color?: string;
      }) => {
        sends.push(msg);
        return response;
      },
      onMessage: { addListener() {}, removeListener() {} },
    },
  } as unknown as Browser;

  const deps: AddressTagsDeps = {
    ext,
    get: {
      allAddresses: () => targets,
      selectedAddresses: () => new Set(targets.map((t) => t.id)),
      currentEmailDetail: () => targets[0] ?? null,
      tagTarget: () => targets[0] ?? null,
      tagTargets: () => targets,
    },
    set: {
      tagDialogOpen: () => {},
      tagTarget: () => {},
      tagTargets: () => {},
      currentEmailDetail: () => {},
    },
    loadAddresses: async () => {
      loaded += 1;
    },
    logDebug: () => {},
    showToast: (message, type) => toastCalls.push({ message: String(message), type }),
  };

  const controller = createAddressTagsController(deps);
  return {
    controller,
    deps,
    ext,
    sends,
    toastCalls,
    targets,
    setResponse: (v: unknown) => {
      response = v;
    },
    loaded: () => loaded,
  };
}

describe('createAddressTagsController.saveAddressViewTags', () => {
  test('returns true and reloads when every target is accepted - ONE batched message', async () => {
    const h = makeHarness();
    const tags = [
      { name: 'work', color: '#333333' },
      { name: 'finance', color: '#10B981' },
    ];
    const ok = await h.controller.saveAddressViewTags(tags);
    expect(ok).toBe(true);
    // Batching contract: a single updateAddressesTag round-trip carrying all
    // target ids (previously this sent one updateAddressTag message per target,
    // each re-reading/writing the full address list in its own lock pass).
    expect(h.sends.length).toBe(1);
    expect(h.sends[0].type).toBe('updateAddressesTag');
    expect(h.sends[0].addressIds).toEqual(['inbox-1', 'inbox-2']);
    expect(h.loaded()).toBe(1);
    expect(h.toastCalls.length).toBe(0);
  });

  test('a single missing target fails the batch with keep-open semantics', async () => {
    const h = makeHarness();
    h.setResponse({ success: false, error: 'errors.addressNotFound', missing: ['inbox-2'] });
    const ok = await h.controller.saveAddressViewTags([{ name: 'work', color: '#333333' }]);
    expect(ok).toBe(false);
    expect(h.sends.length).toBe(1);
    expect(h.loaded()).toBe(0);
    expect(h.toastCalls.length).toBe(1);
    expect(h.toastCalls[0].type).toBe('error');
  });

  test('returns false, toasts, and does NOT reload when the background rejects (stale addressId)', async () => {
    const h = makeHarness();
    h.setResponse({ success: false, error: 'errors.addressNotFound' });
    const ok = await h.controller.saveAddressViewTags([{ name: 'work', color: '#333333' }]);
    expect(ok).toBe(false);
    // Rejection must not fake-apply by reloading.
    expect(h.loaded()).toBe(0);
    expect(h.toastCalls.length).toBe(1);
    expect(h.toastCalls[0].type).toBe('error');
  });

  test('returns false and toasts on transport error', async () => {
    const h = makeHarness();
    h.ext.runtime.sendMessage = async () => {
      throw new Error('extension context invalidated');
    };
    const ok = await h.controller.saveAddressViewTags([{ name: 'work', color: '#333333' }]);
    expect(ok).toBe(false);
    expect(h.loaded()).toBe(0);
    expect(h.toastCalls.length).toBe(1);
  });

  test('true when there is nothing to save (dialog simply closes)', async () => {
    const h = makeHarness();
    h.controller.closeAddressViewTagDialog();
    const depsEmpty = {
      ...h.deps,
      get: { ...h.deps.get, tagTarget: () => null, tagTargets: () => [] },
    };
    const c2 = createAddressTagsController(depsEmpty);
    expect(await c2.saveAddressViewTags([{ name: 'work', color: '#333333' }])).toBe(true);
  });
});
