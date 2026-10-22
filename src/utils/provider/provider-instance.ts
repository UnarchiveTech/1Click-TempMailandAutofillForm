import { loadProviderConfig } from '@/utils/email/email-service.js';

/** Host part of an instance URL, or the raw string when it isn't a valid URL. */
export function instanceHostOf(instanceUrl: string): string {
  if (!instanceUrl) return '';
  try {
    return new URL(instanceUrl).hostname || instanceUrl;
  } catch {
    /* ignore */
    return instanceUrl;
  }
}

/**
 * The bracket suffix for a provider pill, derived purely from provider config:
 *
 *   - no instance                    → ''            ("Guerrilla Mail")
 *   - provider's own instance/domain → ''            ("Burner.kiwi" on burner.kiwi)
 *   - configured third-party instance → displayName  ("Burner.kiwi (Alphac)")
 *   - unlisted/custom instance       → host          ("Burner.kiwi (selfhost.example.org)")
 *
 * "Own" means the instance host matches the provider's website host or one of
 * its own domains (multiDomain). Nothing here is hardcoded per provider.
 */
export function instanceLabelFor(provider: string, instanceUrl: string): string {
  const host = instanceHostOf(instanceUrl);
  if (!host) return '';

  let config: ReturnType<typeof loadProviderConfig>;
  try {
    config = loadProviderConfig(provider);
  } catch {
    // Unknown provider - can't judge "own"; fall back to the host.
    return host;
  }

  // Provider-owned hosts: its own website + its own domains.
  const owned = new Set<string>();
  if (config.websiteUrl) {
    try {
      owned.add(new URL(config.websiteUrl).hostname.toLowerCase());
    } catch {
      /* ignore */
    }
  }
  for (const d of config.multiDomain?.domains || []) {
    if (d) owned.add(d.toLowerCase());
  }
  if (owned.has(host.toLowerCase())) return '';

  const instances = config.multiInstance?.instances || [];
  const match =
    instances.find((i) => i.apiUrl === instanceUrl) ||
    instances.find((i) => {
      try {
        return new URL(i.apiUrl).hostname.toLowerCase() === host.toLowerCase();
      } catch {
        /* ignore */
        return false;
      }
    });
  return match?.displayName || host;
}
