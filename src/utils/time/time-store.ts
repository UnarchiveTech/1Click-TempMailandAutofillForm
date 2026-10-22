import { writable } from 'svelte/store';

/**
 * A ticking time store: emits the current epoch time (ms) once per second.
 * Lazy by design - the interval only runs while at least one component is
 * subscribed, and stops automatically when the last subscriber leaves.
 */
const timeStore = writable(Date.now(), (set) => {
  // Freshen immediately on activation so a late-mounting component never
  // sees the module-load timestamp.
  set(Date.now());
  const interval = setInterval(() => set(Date.now()), 1000);
  return () => {
    clearInterval(interval);
  };
});

/** Shared ticking clock - subscribe reactively with `$timeStore` in components. */
export function useCurrentTime() {
  return timeStore;
}
