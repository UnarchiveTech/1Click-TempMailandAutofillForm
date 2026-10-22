/**
 * Smart identity field mapping per domain.
 *
 * Merges three layers of domain-specific field overrides:
 * 1. Built-in defaults from `src/config/identity-field-maps.jsonc`
 * 2. User-defined overrides stored on the Identity (`domainFieldOverrides`)
 * 3. The identity's own default field values
 *
 * Layer precedence: identity defaults ← built-in domain defaults ← user overrides.
 *
 * Override value placeholders:
 * - `__use_identity_firstNames__` → the identity's own firstNames value
 * - `__use_identity_lastNames__`  → the identity's own lastNames value
 * - `__use_identity_username__`  → the identity's own username value
 * - `__use_identity_preferredEmail__` → the identity's own preferredEmail
 */

import type { Identity } from '@/utils/types.js';
import { hostMatchesDomainScope } from '@/utils/validation.js';
import defaultConfig from '../../config/identity-field-maps.jsonc';

/** A partial identity shape that can be overridden per-domain. */
export type OverridableIdentityFields = Partial<
  Pick<
    Identity,
    'firstNames' | 'lastNames' | 'username' | 'phone' | 'preferredEmail' | 'customPassword'
  >
>;

const PLACEHOLDER_RE = /^__use_identity_(.+?)__$/;

/**
 * Resolve per-domain field overrides for a given identity and domain.
 *
 * Returns a merged set of field values: identity defaults overlaid with any
 * applicable domain-specific overrides (built-in defaults + user overrides).
 */
export function resolveDomainFieldOverrides(
  identity: Identity | undefined,
  domain: string
): OverridableIdentityFields {
  if (!identity || !domain) return {};

  const normalizedDomain = domain.toLowerCase().trim();

  // Helper: do suffix/prefix match (e.g. "mail.linkedin.com" matches "linkedin.com")
  function domainMatches(key: string, target: string): boolean {
    return hostMatchesDomainScope(target, key);
  }

  // Find the best-matching domain key in a map
  function findMatchingKey(map: Record<string, OverridableIdentityFields>): string | null {
    // Exact match first
    if (map[normalizedDomain]) return normalizedDomain;
    // Best suffix match (longest key that matches as parent domain)
    let best: string | null = null;
    for (const key of Object.keys(map)) {
      if (domainMatches(key, normalizedDomain)) {
        if (!best || key.length > best.length) best = key;
      }
    }
    return best;
  }

  // Resolve placeholder values against the identity's own data
  function resolvePlaceholders(overrides: OverridableIdentityFields): OverridableIdentityFields {
    const result: OverridableIdentityFields = {};
    for (const [field, value] of Object.entries(overrides)) {
      if (typeof value === 'string' && PLACEHOLDER_RE.test(value)) {
        const identityField = PLACEHOLDER_RE.exec(value)?.[1];
        if (identityField) {
          const identityVal = (identity as unknown as Record<string, unknown>)[identityField];
          if (identityVal !== undefined) {
            (result as Record<string, unknown>)[field] = identityVal;
          }
        }
      } else {
        (result as Record<string, unknown>)[field] = value;
      }
    }
    return result;
  }

  // Collect applicable overrides, merging with layer precedence
  const merged: OverridableIdentityFields = {};

  // 1) Built-in defaults from JSON config
  const defaultConfigRecord = defaultConfig as unknown as Record<string, OverridableIdentityFields>;
  const builtInKey = findMatchingKey(defaultConfigRecord);
  if (builtInKey && defaultConfigRecord[builtInKey]) {
    Object.assign(merged, resolvePlaceholders(defaultConfigRecord[builtInKey]));
  }

  // 2) User-defined overrides on the identity
  if (identity.domainFieldOverrides) {
    const userKey = findMatchingKey(identity.domainFieldOverrides);
    if (userKey && identity.domainFieldOverrides[userKey]) {
      Object.assign(merged, resolvePlaceholders(identity.domainFieldOverrides[userKey]));
    }
  }

  return merged;
}
