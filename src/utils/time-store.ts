import { writable } from 'svelte/store';

let currentTimeValue = Date.now();
let activeCount = 0;

const timeStore = writable(currentTimeValue, (set) => {
  const interval = setInterval(() => {
    const now = Date.now();
    currentTimeValue = now;
    set(now);
  }, 1000);

  return () => {
    clearInterval(interval);
  };
});

const customSubscribers = new Set<() => void>();

/**
 * Hook to get the current reactive time
 * Automatically manages the interval lifecycle
 */
export function useCurrentTime() {
  return {
    get currentTime() {
      // Use cached currentTimeValue if store is active; fallback to Date.now() if inactive
      return activeCount > 0 ? currentTimeValue : Date.now();
    },
    subscribe(callback: () => void) {
      customSubscribers.add(callback);
      activeCount++;

      // Also subscribe to timeStore to start/keep it active
      const unsubscribeTime = timeStore.subscribe((val) => {
        currentTimeValue = val;
        callback();
      });

      let unsubscribed = false;
      return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        customSubscribers.delete(callback);
        activeCount = Math.max(0, activeCount - 1);
        unsubscribeTime();
      };
    },
  };
}
