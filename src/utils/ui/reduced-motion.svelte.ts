import { onMount } from 'svelte';

/** A reactive view of the operating system's reduced-motion preference. */
export function useReducedMotion() {
  let reducedMotion = $state(false);

  onMount(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      reducedMotion = query.matches;
    };

    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  });

  return {
    get enabled() {
      return reducedMotion;
    },
  };
}
