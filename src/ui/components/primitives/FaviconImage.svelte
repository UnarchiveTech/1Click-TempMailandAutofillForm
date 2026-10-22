<script lang="ts">
import Avatar from '@/ui/components/primitives/Avatar.svelte';
import { getRootDomain } from '@/utils/security/root-domain.js';
import { avatarColor } from '@/utils/theme/avatar-color.js';
import { type AvatarTier, avatarPx, DEFAULT_AVATAR_TIER } from '@/utils/ui/avatar-size.js';
import {
  fetchFaviconViaBackground,
  GOOGLE_DEFAULT_HASH,
  getCachedFaviconUrl,
  getDomainFromEmail,
  getFaviconRequestUrl,
  getGoogleFaviconUrl,
  getStrippedDomain,
  hasRecentFaviconError,
  isFaviconCacheStale,
  peekCachedFaviconEntrySync,
  resolveFaviconEntryUrl,
  setFaviconCacheError,
  setFaviconCacheSuccess,
  warmFaviconMemoryMirror,
} from '@/utils/ui/favicon.js';

let {
  email = '',
  domain = '',
  size = DEFAULT_AVATAR_TIER,
  class: className = '',
  fallbackLetter = '?',
  /** Explicit override; when empty a Google-style color is hashed from email/domain. */
  fallbackColor = '',
  /** When false, no network / cache lookup - letter avatar only (saves bandwidth). */
  enabled = true,
  onLoad,
  onError,
}: {
  email?: string;
  domain?: string;
  /** A tier from the avatar size scale - never a raw px number. */
  size?: AvatarTier;
  class?: string;
  fallbackLetter?: string;
  fallbackColor?: string;
  enabled?: boolean;
  onLoad?: () => void;
  onError?: () => void;
} = $props();

// Resolve domain from email or direct domain prop
let resolvedDomain = $derived(domain || getDomainFromEmail(email));
/** Fallback shell: explicit override wins, otherwise a Google-style color. */
let resolvedFallbackColor = $derived(
  fallbackColor || avatarColor(email || resolvedDomain || fallbackLetter)
);
let px = $derived(avatarPx(size));
let fullDomain = $derived(resolvedDomain);
let strippedDomain = $derived(getStrippedDomain(fullDomain));
let rootDomain = $derived(getRootDomain(fullDomain));

// Build URLs for each attempt
let cachedUrl = $state<string | null>(null);
let fullUrl = $derived(getFaviconRequestUrl(fullDomain));
let strippedUrl = $derived(getFaviconRequestUrl(strippedDomain));
let rootUrl = $derived(getFaviconRequestUrl(rootDomain));
let googleUrl = $derived(getGoogleFaviconUrl(strippedDomain, px));

// --- Unified-size: avoid dual sizing (class w-*/h-* vs inline style) and
// position conflict (caller `absolute` vs hardcoded `relative`).
// Require a real class boundary (start or whitespace) so `max-w-*` / `inset-*`
// prefixes do not false-positive as explicit sizing/positioning.
let hasPositionClass = $derived(
  /(?:^|\s)(?:absolute|fixed|relative|sticky)(?:\s|$)/.test(className)
);
let hasSizeClass = $derived(
  /(?:^|\s)w-(?:\d|full|\[|auto|screen)/.test(className) ||
    /(?:^|\s)h-(?:\d|full|\[|auto|screen)/.test(className)
);
let positionClass = $derived(hasPositionClass ? '' : 'relative');
// As in Avatar: a size class must be this tier's own box or a fill, and
// `bun run check-avatar-sizes` fails any other pair.
let sizeStyle = $derived(hasSizeClass ? '' : `width:${px}px;height:${px}px;`);

// State machine: cached → full → stripped → root → google → failed
// When revalidating, we keep showing cachedUrl until a new fetch succeeds.
let attempt = $state<'idle' | 'cached' | 'full' | 'stripped' | 'root' | 'google' | 'failed'>(
  'idle'
);
let loaded = $state(false);
let hasRecentErr = $state(false);
/** True while we show cached icon and may revalidate after 24h */
let revalidating = $state(false);

// --- Anti-flash: warm in-memory mirror fast path -------------------------
//
// The previous flow ALWAYS painted the letter avatar first: the effect had to
// await three browser.storage.local reads before it could set `attempt`, so
// the cached <img> mounted one frame+ later - the visible avatar→favicon
// flash. The mirror (hydrated at context start) lets us resolve a cached icon
// SYNCHRONOUSLY:
//
//  • `syncCachedUrl` is snapshotted in this effect's root synchronously, so
//    the very first paint already sees the cached entry if the mirror holds
//    one for this domain.
//  • The effect takes the sync fast path on mirror hits and keeps the async
//    path only for the truly-cold case (fresh context, mirror not yet
//    hydrated - the async read warms it for every subsequent component).
//  • For mirror hits the letter avatar is NOT rendered underneath the img - a
//    data: URL is either instant or broken, never slow, so a placeholder
//    behind it would only re-introduce a (shorter) flash. Non-cached network
//    attempts keep the avatar behind the fading img exactly as before.
let syncCachedUrl = $derived.by(() => {
  const url = resolveFaviconEntryUrl(peekCachedFaviconEntrySync(rootDomain));
  return url?.startsWith('data:image/') ? url : null;
});

function isLocalImageDataUrl(url: string | null): url is string {
  return !!url && url.startsWith('data:image/');
}

/** Cached icon failed to render (e.g. corrupt data: URL) - restore the letter. */
let cachedFailed = $state(false);

/** A cached favicon img is mounted (or about to be) - hide the letter shell. */
let hasVisibleFavicon = $derived(
  enabled &&
    !cachedFailed &&
    (loaded ||
      (cachedUrl !== null && (attempt === 'cached' || revalidating)) ||
      (syncCachedUrl !== null && (attempt === 'idle' || attempt === 'cached' || revalidating)))
);

// Reset when domain changes and fetch async cache state
$effect(() => {
  let isCancelled = false;

  // Fast path: favicons disabled - never hit network or cache
  if (!enabled || !rootDomain) {
    cachedUrl = null;
    loaded = false;
    hasRecentErr = false;
    revalidating = false;
    attempt = 'failed';
    return;
  }

  // Warm the context-wide mirror (fire-and-forget; no-ops once ready) and
  // re-snapshot so this component benefits the moment hydration lands.
  void warmFaviconMemoryMirror();

  // Synchronous fast path: mirror hit → mount the cached <img> at first paint.
  if (syncCachedUrl) {
    cachedUrl = syncCachedUrl;
    loaded = false;
    cachedFailed = false;
    hasRecentErr = false;
    revalidating = false;
    attempt = 'cached';
    void (async () => {
      const [err, stale] = await Promise.all([
        hasRecentFaviconError(rootDomain),
        isFaviconCacheStale(rootDomain),
      ]);
      if (isCancelled) return;
      hasRecentErr = err;
      if (stale && !err) {
        revalidating = true;
        void revalidateInBackground(() => isCancelled);
      }
    })();
    return () => {
      isCancelled = true;
    };
  }

  loaded = false;
  cachedFailed = false;
  revalidating = false;
  attempt = 'idle';

  void (async () => {
    const [url, err, stale] = await Promise.all([
      getCachedFaviconUrl(rootDomain),
      hasRecentFaviconError(rootDomain),
      isFaviconCacheStale(rootDomain),
    ]);
    if (isCancelled) return;

    hasRecentErr = err;
    cachedUrl = isLocalImageDataUrl(url) ? url : null;

    if (cachedUrl) {
      // Keep showing old icon; only revalidate if stale and not in error backoff
      attempt = 'cached';
      if (stale && !err) {
        revalidating = true;
        // Background revalidate without clearing cachedUrl on failure
        void revalidateInBackground(() => isCancelled);
      }
      return;
    }

    // No cache - full resolution chain
    if (err) {
      attempt = 'failed';
      return;
    }
    attempt = 'full';
    void fetchFaviconChain(() => isCancelled);
  })();

  return () => {
    isCancelled = true;
  };
});

async function revalidateInBackground(isCancelled: () => boolean) {
  try {
    if (await fetchFaviconChain(isCancelled)) return;
    if (isCancelled()) return;
    // Failure: keep old cache; error entry blocks retry for 24h
    await setFaviconCacheError(rootDomain);
    revalidating = false;
  } catch {
    /* ignore */
    revalidating = false;
    if (cachedFailed) {
      attempt = 'failed';
      onError?.();
    }
  }
}

async function fetchFaviconChain(isCancelled: () => boolean): Promise<boolean> {
  const candidates = [
    { url: fullUrl, attempt: 'full' as const },
    { url: strippedUrl, attempt: 'stripped' as const },
    { url: rootUrl, attempt: 'root' as const },
    { url: googleUrl, attempt: 'google' as const },
  ];
  const visited = new Set<string>();

  for (const candidate of candidates) {
    if (!candidate.url || visited.has(candidate.url)) continue;
    visited.add(candidate.url);
    if (isCancelled()) return false;
    attempt = candidate.attempt;
    const result = await fetchFaviconViaBackground(candidate.url);
    if (isCancelled()) return false;
    if (!result || (candidate.attempt === 'google' && result.hash === GOOGLE_DEFAULT_HASH)) {
      continue;
    }

    await setFaviconCacheSuccess(
      rootDomain,
      result.dataUrl,
      candidate.attempt === 'google' ? undefined : candidate.url
    );
    if (isCancelled()) return false;
    cachedUrl = result.dataUrl;
    cachedFailed = false;
    attempt = 'cached';
    loaded = false;
    revalidating = false;
    return true;
  }

  if (!isCancelled()) {
    attempt = cachedUrl && !cachedFailed ? 'cached' : 'failed';
    if (!cachedUrl || cachedFailed) onError?.();
  }
  return false;
}

function handleLoad() {
  loaded = true;
  onLoad?.();
}

function handleError() {
  loaded = false;
  onError?.();
}

function advanceFromCachedError() {
  // Cached image failed to render - try network chain, but do not delete cache yet
  if (revalidating) {
    // Stale icon broken during revalidation: restore the letter avatar instead
    // of leaving a blank circle behind the stuck cached img.
    cachedFailed = true;
    return;
  }
  cachedFailed = true;
  loaded = false;
  attempt = 'full';
  void fetchFaviconChain(() => false);
}
</script>

<!--
  Favicon resolution: sync mirror / cache (stale-ok) → full → stripped → root → google → letter fallback.

  Anti-flash contract:
  • Cached (mirror/storage) favicon: the letter avatar is NOT rendered at all -
    the <img> mounts at first paint (data: URLs are instant or broken).
  • Uncached network chains keep the letter until guarded fetching supplies
    a local image. Cached images paint without a load-event opacity gate:
    hiding both the letter and an opacity-zero cached image leaves a blank slot.
-->
<div
  class="{className} {positionClass} flex items-center justify-center overflow-hidden rounded-full"
  style={sizeStyle}
>
  <!-- Delegates to single Avatar source - same 0.52 ratio / dark palette / centering everywhere.
       Hidden once a cached favicon is visible (see hasVisibleFavicon) to kill the flash. -->
  {#if !hasVisibleFavicon}
    <Avatar
      size={size}
      letter={fallbackLetter}
      email={email || resolvedDomain}
      color={resolvedFallbackColor}
      class="absolute inset-0 w-full h-full pointer-events-none"
    />
  {/if}

  {#if enabled && cachedUrl && !cachedFailed}
    <img
      src={cachedUrl}
      alt=""
      class="relative w-full h-full object-contain"
      onload={handleLoad}
      onerror={() => {
        // Cache entries are data URLs only; a corrupt entry triggers a fresh
        // guarded background fetch while the letter avatar remains visible.
        advanceFromCachedError();
        handleError();
      }}
    />
  {/if}
</div>
