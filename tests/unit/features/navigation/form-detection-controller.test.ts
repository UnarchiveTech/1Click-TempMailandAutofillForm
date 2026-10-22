import { describe, expect, test } from 'bun:test';
import type { browser } from 'wxt/browser';
import { createFormDetectionController } from '@/features/navigation/form-detection-controller';

test('reports a gate-only verification page before any form appears and clears on a normal page', async () => {
  const detected: boolean[] = [];
  const required: boolean[] = [];
  let response = { formDetected: false, verificationRequired: true };
  let activate: ((info: { tabId: number }) => void) | undefined;
  const ext = {
    tabs: {
      query: async () => [{ id: 1 }],
      sendMessage: async () => response,
      onActivated: {
        addListener: (handler: typeof activate) => {
          activate = handler;
        },
        removeListener: () => {},
      },
      onUpdated: { addListener: () => {}, removeListener: () => {} },
    },
    runtime: { onMessage: { addListener: () => {}, removeListener: () => {} } },
  } as unknown as typeof browser;
  const controller = createFormDetectionController({
    ext,
    setDetected: (value) => detected.push(value),
    setVerificationRequired: (value) => required.push(value),
  });
  try {
    await controller.start();
    expect(detected).toEqual([false]);
    expect(required).toEqual([true]);
    response = { formDetected: true, verificationRequired: false };
    activate?.({ tabId: 2 });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(detected[detected.length - 1]).toBe(true);
    expect(required[required.length - 1]).toBe(false);
  } finally {
    controller.stop();
  }
});

describe('verification-state freshness', () => {
  test('an old tab response cannot restore a stale challenge warning', async () => {
    let activate: ((info: { tabId: number }) => void) | undefined;
    let releaseOld: (value: { formDetected: boolean; verificationRequired: boolean }) => void =
      () => {};
    const oldResponse = new Promise<{ formDetected: boolean; verificationRequired: boolean }>(
      (resolve) => {
        releaseOld = resolve;
      }
    );
    const required: boolean[] = [];
    const ext = {
      tabs: {
        query: async () => [{ id: 1 }],
        sendMessage: async (id: number) =>
          id === 2 ? oldResponse : { formDetected: false, verificationRequired: false },
        onActivated: {
          addListener: (handler: typeof activate) => {
            activate = handler;
          },
          removeListener: () => {},
        },
        onUpdated: { addListener: () => {}, removeListener: () => {} },
      },
      runtime: { onMessage: { addListener: () => {}, removeListener: () => {} } },
    } as unknown as typeof browser;
    const controller = createFormDetectionController({
      ext,
      setDetected: () => {},
      setVerificationRequired: (value) => required.push(value),
    });
    try {
      await controller.start();
      activate?.({ tabId: 2 });
      activate?.({ tabId: 3 });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      releaseOld({ formDetected: false, verificationRequired: true });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(required.every((value) => value === false)).toBe(true);
    } finally {
      controller.stop();
    }
  });
});

test('active-tab presence pushes beat an older poll without losing its verification result', async () => {
  let message: ((value: unknown, sender: { tab?: { id?: number } }) => void) | undefined;
  let activate: ((info: { tabId: number }) => void) | undefined;
  let release: (value: { formDetected: boolean; verificationRequired: boolean }) => void = () => {};
  const pending = new Promise<{ formDetected: boolean; verificationRequired: boolean }>(
    (resolve) => {
      release = resolve;
    }
  );
  const detected: boolean[] = [];
  const required: boolean[] = [];
  let calls = 0;
  const ext = {
    tabs: {
      query: async () => [{ id: 1 }],
      sendMessage: async () => (++calls === 1 ? { formDetected: false } : pending),
      onActivated: {
        addListener: (handler: typeof activate) => {
          activate = handler;
        },
        removeListener: () => {},
      },
      onUpdated: { addListener: () => {}, removeListener: () => {} },
    },
    runtime: {
      onMessage: {
        addListener: (handler: typeof message) => {
          message = handler;
        },
        removeListener: () => {},
      },
    },
  } as unknown as typeof browser;
  const controller = createFormDetectionController({
    ext,
    setDetected: (value) => detected.push(value),
    setVerificationRequired: (value) => required.push(value),
  });
  try {
    await controller.start();
    message?.({ type: 'formPresence', formDetected: true }, { tab: { id: 2 } });
    expect(detected).toEqual([false]);
    message?.({ type: 'formPresence', formDetected: true }, {});
    expect(detected).toEqual([false]);
    activate?.({ tabId: 1 });
    message?.({ type: 'formPresence', formDetected: true }, { tab: { id: 1 } });
    release({ formDetected: false, verificationRequired: true });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(detected[detected.length - 1]).toBe(true);
    expect(required[required.length - 1]).toBe(true);
  } finally {
    controller.stop();
  }
});
