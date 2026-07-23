<script lang="ts">
import {
  fetchFaviconViaBackground,
  GOOGLE_DEFAULT_HASH,
  getCachedFaviconUrl,
  getDomainFromEmail,
  getFaviconUrl,
  getGoogleFaviconUrl,
  getRootDomain,
  getStrippedDomain,
  hasRecentFaviconError,
  isFaviconCacheStale,
  setFaviconCacheError,
  setFaviconCacheSuccess,
} from '@/utils/favicon.js';
import { logDebug } from '@/utils/logger.js';

let {
  email = '',
  domain = '',
  size = 32,
  class: className = '',
  fallbackLetter = '?',
  fallbackColor = 'bg-md-primary',
  /** When false, no network / cache lookup - letter avatar only (saves bandwidth). */
  enabled = true,
  onLoad,
  onError,
}: {
  email?: string;
  domain?: string;
  size?: number;
  class?: string;
  fallbackLetter?: string;
  fallbackColor?: string;
  enabled?: boolean;
  onLoad?: () => void;
  onError?: () => void;
} = $props();

// Resolve domain from email or direct domain prop
let resolvedDomain = $derived(domain || getDomainFromEmail(email));
let fullDomain = $derived(resolvedDomain);
let strippedDomain = $derived(getStrippedDomain(fullDomain));
let rootDomain = $derived(getRootDomain(fullDomain));

// Build URLs for each attempt
let cachedUrl = $state<string | null>(null);
let fullUrl = $derived(getFaviconUrl(fullDomain));
let strippedUrl = $derived(getFaviconUrl(strippedDomain));
let rootUrl = $derived(getFaviconUrl(rootDomain));
let googleUrl = $derived(getGoogleFaviconUrl(strippedDomain, size));

// State machine: cached → full → stripped → root → google → failed
// When revalidating, we keep showing cachedUrl until a new fetch succeeds.
let attempt = $state<'idle' | 'cached' | 'full' | 'stripped' | 'root' | 'google' | 'failed'>(
  'idle'
);
let googleBlobUrl = $state('');
let loaded = $state(false);
let hasRecentErr = $state(false);
/** True while we show cached icon and may revalidate after 24h */
let revalidating = $state(false);

// Reset when domain changes and fetch async cache state
$effect(() => {
  let isCancelled = false;

  // Fast path: favicons disabled - never hit network or cache
  if (!enabled || !rootDomain) {
    cachedUrl = null;
    googleBlobUrl = '';
    loaded = false;
    hasRecentErr = false;
    revalidating = false;
    attempt = 'failed';
    return;
  }

  googleBlobUrl = '';
  loaded = false;
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
    cachedUrl = url;

    if (url) {
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
  })();

  return () => {
    isCancelled = true;
  };
});

async function revalidateInBackground(isCancelled: () => boolean) {
  try {
    // Try direct → root → google; only replace cache on success
    for (const url of [fullUrl, rootUrl]) {
      if (isCancelled()) return;
      const result = await fetchFaviconViaBackground(url);
      if (result && result.hash !== GOOGLE_DEFAULT_HASH) {
        await setFaviconCacheSuccess(rootDomain, result.dataUrl, url);
        if (isCancelled()) return;
        cachedUrl = result.dataUrl;
        revalidating = false;
        return;
      }
    }
    if (isCancelled()) return;
    const google = await fetchFaviconViaBackground(googleUrl);
    if (google && google.hash !== GOOGLE_DEFAULT_HASH) {
      await setFaviconCacheSuccess(rootDomain, google.dataUrl);
      if (isCancelled()) return;
      cachedUrl = google.dataUrl;
      revalidating = false;
      return;
    }
    // Failure: keep old cache; error entry blocks retry for 24h
    await setFaviconCacheError(rootDomain);
    revalidating = false;
  } catch {
    revalidating = false;
  }
}

async function handleGoogleFetch() {
  const result = await fetchFaviconViaBackground(googleUrl);
  if (!result || result.hash === GOOGLE_DEFAULT_HASH) {
    logDebug('Google favicon is default or failed', { domain: fullDomain });
    await setFaviconCacheError(rootDomain);
    // Keep any previous cached icon if present
    if (cachedUrl) {
      attempt = 'cached';
    } else {
      attempt = 'failed';
      loaded = false;
      onError?.();
    }
  } else {
    logDebug('Google favicon is valid', { domain: fullDomain });
    googleBlobUrl = result.dataUrl;
    await setFaviconCacheSuccess(rootDomain, result.dataUrl);
    attempt = 'google';
  }
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
  if (revalidating) return;
  attempt = 'full';
}
</script>

<!-- Favicon resolution: cache (stale-ok) → full → stripped → root → google → letter fallback -->
<div
  class="{className} relative flex items-center justify-center overflow-hidden rounded-full"
  style="width: {size}px; height: {size}px;"
>
  <!-- Letter always present under favicon; real icon stacks above only when loaded -->
  <span
    class="absolute inset-0 z-[1] flex items-center justify-center font-bold select-none text-white {fallbackColor}"
    style="font-size: {Math.max(8, Math.round(size * 0.45))}px; line-height: 1;"
    aria-hidden="true"
  >
    {(fallbackLetter || '?').slice(0, 1).toUpperCase()}
  </span>

  {#if enabled && !hasRecentErr && attempt !== 'failed' && attempt !== 'idle'}
    {#if (attempt === 'cached' || revalidating) && cachedUrl}
      <img
        src={cachedUrl}
        alt=""
        class="relative z-[2] w-full h-full object-cover {loaded ? 'opacity-100' : 'opacity-0'}"
        onload={handleLoad}
        onerror={() => {
          // Do not clear success cache - try network chain while letter shows
          advanceFromCachedError();
          handleError();
        }}
      />
    {:else if attempt === 'full'}
      <img
        src={fullUrl}
        alt=""
        class="relative z-[2] w-full h-full object-cover {loaded ? 'opacity-100' : 'opacity-0'}"
        onload={async () => {
          handleLoad();
          try {
            const result = await fetchFaviconViaBackground(fullUrl);
            if (result && result.hash !== GOOGLE_DEFAULT_HASH) {
              await setFaviconCacheSuccess(rootDomain, result.dataUrl, fullUrl);
            }
          } catch {
            /* ignore cache write */
          }
        }}
        onerror={() => {
          logDebug('favicon full failed', { domain: fullDomain });
          attempt = 'stripped';
        }}
      />
    {:else if attempt === 'stripped'}
      <img
        src={strippedUrl}
        alt=""
        class="relative z-[2] w-full h-full object-cover {loaded ? 'opacity-100' : 'opacity-0'}"
        onload={handleLoad}
        onerror={() => {
          logDebug('favicon stripped failed', { domain: fullDomain });
          attempt = 'root';
        }}
      />
    {:else if attempt === 'root'}
      <img
        src={rootUrl}
        alt=""
        class="relative z-[2] w-full h-full object-cover {loaded ? 'opacity-100' : 'opacity-0'}"
        onload={handleLoad}
        onerror={() => {
          logDebug('favicon root failed, trying google', { domain: fullDomain });
          void handleGoogleFetch();
        }}
      />
    {:else if attempt === 'google' && googleBlobUrl}
      <img
        src={googleBlobUrl}
        alt=""
        class="relative z-[2] w-full h-full object-cover {loaded ? 'opacity-100' : 'opacity-0'}"
        onload={handleLoad}
        onerror={() => {
          logDebug('favicon google failed', { domain: fullDomain });
          void setFaviconCacheError(rootDomain);
          if (cachedUrl) {
            attempt = 'cached';
          } else {
            attempt = 'failed';
            loaded = false;
            handleError();
          }
        }}
      />
    {/if}
  {/if}
</div>
