import { afterEach, describe, expect, test } from 'bun:test';
import { observeResizeOnFrame } from '@/utils/ui/resize-observer.js';

type ResizeObserverMock = {
  callback: ResizeObserverCallback;
  observed: Element | null;
  disconnected: boolean;
  trigger: (entries: ResizeObserverEntry[]) => void;
};

const globals = globalThis as unknown as {
  ResizeObserver?: typeof ResizeObserver;
  requestAnimationFrame?: typeof requestAnimationFrame;
  cancelAnimationFrame?: typeof cancelAnimationFrame;
};

const originalResizeObserver = globals.ResizeObserver;
const originalRequestAnimationFrame = globals.requestAnimationFrame;
const originalCancelAnimationFrame = globals.cancelAnimationFrame;

const observers: ResizeObserverMock[] = [];
const frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;

class MockResizeObserver implements ResizeObserver {
  private readonly entry: ResizeObserverMock;

  constructor(callback: ResizeObserverCallback) {
    this.entry = {
      callback,
      observed: null,
      disconnected: false,
      trigger: (entries) => callback(entries, this),
    };
    observers.push(this.entry);
  }

  observe(target: Element): void {
    this.entry.observed = target;
  }

  unobserve(): void {}

  disconnect(): void {
    this.entry.disconnected = true;
  }

  trigger(entries: ResizeObserverEntry[]): void {
    this.entry.trigger(entries);
  }
}

function installMocks() {
  observers.length = 0;
  frames.clear();
  nextFrameId = 1;
  globals.ResizeObserver = MockResizeObserver;
  globals.requestAnimationFrame = (callback) => {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  };
  globals.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };
}

function flushFrames() {
  for (const [id, callback] of Array.from(frames)) {
    frames.delete(id);
    callback(0);
  }
}

afterEach(() => {
  globals.ResizeObserver = originalResizeObserver;
  globals.requestAnimationFrame = originalRequestAnimationFrame;
  globals.cancelAnimationFrame = originalCancelAnimationFrame;
});

describe('observeResizeOnFrame', () => {
  test('defers observer mutations until the next frame and cancels cleanup', () => {
    installMocks();
    const calls: ResizeObserverEntry[][] = [];
    const stop = observeResizeOnFrame({} as Element, (entries) => calls.push(entries));
    const entry = {
      target: {} as Element,
      contentRect: { width: 100, height: 40 },
    } as ResizeObserverEntry;

    observers[0].trigger([entry]);
    expect(calls).toHaveLength(0);
    expect(frames.size).toBe(1);

    flushFrames();
    expect(calls).toEqual([[entry]]);

    observers[0].trigger([entry]);
    stop();
    flushFrames();
    expect(calls).toHaveLength(1);
    expect(observers[0].disconnected).toBe(true);
  });
});
