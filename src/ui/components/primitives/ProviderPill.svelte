<script lang="ts">
import { loadProviderConfig } from '@/utils/email/email-service.js';
import { instanceLabelFor } from '@/utils/provider/provider-instance.js';
import { AVATAR_BOX } from '@/utils/ui/avatar-size.js';
import FaviconImage from './FaviconImage.svelte';

let {
  provider = '',
  instanceUrl = '',
  variant = 'pill',
}: {
  provider?: string;
  instanceUrl?: string;
  variant?: 'pill' | 'inline';
} = $props();

const providerName = $derived.by(() => {
  if (!provider) return '';
  try {
    const config = loadProviderConfig(provider);
    return config.displayName || provider;
  } catch {
    /* ignore */
    return provider;
  }
});

/** Bracket suffix - display name for configured instances, host otherwise, '' for own/no instance. */
const instanceLabel = $derived(instanceLabelFor(provider, instanceUrl));

const faviconDomain = $derived.by(() => {
  if (instanceUrl) {
    try {
      return new URL(instanceUrl).hostname;
    } catch {
      /* fall through */
    }
  }
  try {
    const config = loadProviderConfig(provider);
    // Field is `websiteUrl` - reading `website` here always missed and the pill
    // fell back to the raw provider id as a favicon URL (broken image).
    const site = config.websiteUrl || '';
    if (site) {
      try {
        return new URL(site.startsWith('http') ? site : `https://${site}`).hostname;
      } catch {
        /* ignore */
        return site;
      }
    }
  } catch {
    /* ignore */
  }
  return provider;
});
</script>

<span
  class="inline-flex items-center gap-1 text-xs font-medium min-w-0 {variant === 'pill' ? 'px-2.5 py-1 rounded-full bg-md-surface-variant text-md-on-surface' : 'leading-tight'}"
  title={instanceLabel ? `${providerName} (${instanceLabel})` : providerName}
>
  <span class="{AVATAR_BOX.xs} rounded-full flex items-center justify-center overflow-hidden bg-md-surface flex-shrink-0">
    <FaviconImage
      domain={faviconDomain}
      size="xs"
      class="object-cover"
      fallbackLetter={providerName[0]?.toUpperCase() ?? 'P'}
    />
  </span>
  <span class="truncate min-w-0">{providerName}</span>
  {#if instanceLabel}
    <span class="{variant === 'pill' ? 'text-md-on-surface/50 shrink-0' : 'truncate min-w-0'}">({instanceLabel})</span>
  {/if}
</span>
