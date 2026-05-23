// Shared time store for reactive time updates across components
// This consolidates multiple setInterval calls into a single source of truth

let currentTime = Date.now();
let intervalId: ReturnType<typeof setInterval> | null = null;
const subscribers = new Set<() => void>();

// Start the interval when first component subscribes
function startInterval() {
  if (intervalId === null) {
    intervalId = setInterval(() => {
      currentTime = Date.now();
      // Notify all subscribers
      for (const callback of subscribers) {
        callback();
      }
    }, 1000); // Update every second
  }
}

// Stop the interval when no components are subscribed
function stopInterval() {
  if (subscribers.size === 0 && intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

/**
 * Hook to get the current reactive time
 * Automatically manages the interval lifecycle
 */
export function useCurrentTime() {
  return {
    get currentTime() {
      return currentTime;
    },
    subscribe(callback: () => void) {
      subscribers.add(callback);
      startInterval();
      return () => {
        subscribers.delete(callback);
        stopInterval();
      };
    },
  };
}
