/**
 * lazy-view.svelte.ts
 *
 * Dynamic-import wrapper for view components. Views are the heaviest part of
 * the popup/sidepanel/app shell bundle; statically importing all of them from
 * AppLayout forced every entrypoint to download the entire UI graph up front
 * (the 1.3 MB "styles" shell chunk). Loading views via `import()` splits each
 * view into its own parallel-fetchable, individually cacheable chunk so the
 * shell's own parse/render path is decoupled from the view graph.
 * NOTE: chunks are still prefetched eagerly at mount (see below) - total
 * first-open bytes are unchanged; the win is parallel fetching + caching,
 * not deferred network.
 *
 * Usage (in a .svelte component):
 *
 *   const mailbox = loadLazyComponent(() => import('@/ui/views/mailbox/MailboxView.svelte'));
 *
 *   {#if mailbox.component}
 *     {@const MailboxViewCmp = mailbox.component}
 *     <MailboxViewCmp {...props} />
 *   {:else}
 *     <ViewFallback failed={mailbox.failed} />
 *   {/if}
 *
 * The component type is inferred from the loader, so the capitalized
 * `{@const}` alias keeps full prop type checking at the call site (same trick
 * as `QrDialogComponentType` in the shell overlays).
 *
 * The loader starts as soon as the owning component initialises - every view
 * chunk is prefetched eagerly at mount, in parallel with the rest of the
 * shell, so switching views is then a cached-module lookup.
 */

export type LazyComponentState<T> = {
  /** Resolved component, or null while the chunk is loading. */
  component: T | null;
  /** True when the dynamic import rejected (extension context lost, CSP, …). */
  failed: boolean;
};

/**
 * Kick off a dynamic `import()` and expose the resolved component through
 * $state so the caller can render it with `<svelte:component>`. Safe to call
 * multiple times for the same module - the bundler module cache dedupes it.
 */
export function loadLazyComponent<T>(loader: () => Promise<{ default: T }>): LazyComponentState<T> {
  const state = $state<LazyComponentState<T>>({ component: null, failed: false });
  loader()
    .then((mod) => {
      state.component = mod.default;
    })
    .catch((error) => {
      state.failed = true;
      console.error('[lazy-view] failed to load view chunk:', error);
    });
  return state;
}
