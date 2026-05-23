<script lang="ts">
import {
  clearFaviconCache,
  fetchFaviconViaBackground,
  GOOGLE_DEFAULT_HASH,
  getCachedFaviconUrl,
  getDomainFromEmail,
  getFaviconUrl,
  getGoogleFaviconUrl,
  getRootDomain,
  getStrippedDomain,
  hasRecentFaviconError,
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
  onLoad,
  onError,
}: {
  email?: string;
  domain?: string;
  size?: number;
  class?: string;
  fallbackLetter?: string;
  fallbackColor?: string;
  onLoad?: () => void;
  onError?: () => void;
} = $props();

// Resolve domain from email or direct domain prop
let resolvedDomain = $derived(domain || getDomainFromEmail(email));
let fullDomain = $derived(resolvedDomain);
let strippedDomain = $derived(getStrippedDomain(fullDomain));
let rootDomain = $derived(getRootDomain(fullDomain));

// Build URLs for each attempt
let cachedUrl = $derived(getCachedFaviconUrl(rootDomain));
let fullUrl = $derived(getFaviconUrl(fullDomain));
let strippedUrl = $derived(getFaviconUrl(strippedDomain));
let rootUrl = $derived(getFaviconUrl(rootDomain));
let googleUrl = $derived(getGoogleFaviconUrl(strippedDomain, size));

// State machine: cached → full → stripped → root → google → failed
let attempt = $state<'cached' | 'full' | 'stripped' | 'root' | 'google' | 'failed'>('cached');
let googleBlobUrl = $state('');
let loaded = $state(false);
let hasRecentErr = $derived(hasRecentFaviconError(rootDomain));

// Reset when domain changes
$effect(() => {
  const hasCache = !!cachedUrl;
  attempt = hasCache ? 'cached' : 'full';
  googleBlobUrl = '';
  loaded = false;
});

async function handleGoogleFetch() {
  const result = await fetchFaviconViaBackground(googleUrl);
  if (!result || result.hash === GOOGLE_DEFAULT_HASH) {
    logDebug('Google favicon is default or failed', { domain: fullDomain });
    setFaviconCacheError(rootDomain);
    attempt = 'failed';
    loaded = false;
    onError?.();
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
</script>

<!-- 6-step favicon resolution: cache → full → stripped → root → google → fallback -->
<div class={className} style="width: {size}px; height: {size}px;">
  {#if !hasRecentErr && attempt !== 'failed'}
    {#if attempt === 'cached' && cachedUrl}
      <img
        src={cachedUrl}
        alt=""
        class="w-full h-full"
        onload={handleLoad}
        onerror={() => {
          clearFaviconCache(rootDomain);
          setFaviconCacheError(rootDomain);
          attempt = 'full';
          handleError();
        }}
      />
    {:else if attempt === 'full'}
      <img
        src={fullUrl}
        alt=""
        class="w-full h-full"
        onload={handleLoad}
        onerror={() => {
          logDebug('favicon full failed', { domain: fullDomain });
          attempt = 'stripped';
        }}
      />
    {:else if attempt === 'stripped'}
      <img
        src={strippedUrl}
        alt=""
        class="w-full h-full"
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
        class="w-full h-full"
        onload={handleLoad}
        onerror={() => {
          logDebug('favicon root failed, trying google', { domain: fullDomain });
          handleGoogleFetch();
        }}
      />
    {:else if attempt === 'google' && googleBlobUrl}
      <img
        src={googleBlobUrl}
        alt=""
        class="w-full h-full"
        onload={handleLoad}
        onerror={() => {
          logDebug('favicon google failed', { domain: fullDomain });
          setFaviconCacheError(rootDomain);
          attempt = 'failed';
          loaded = false;
          handleError();
        }}
      />
    {/if}
  {/if}

  <!-- Letter avatar fallback when all 6 steps fail or while loading -->
  {#if !loaded}
    <div class="w-full h-full flex items-center justify-center text-white text-lg font-bold {fallbackColor}">
      {fallbackLetter}
    </div>
  {/if}
</div>
