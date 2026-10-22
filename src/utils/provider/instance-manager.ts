/**
 * Provider instance management
 * Reads instances from JSON config and handles storage operations
 */

import { browser } from 'wxt/browser';
import { DEFAULT_PROVIDER, loadProviderConfig } from '@/utils/email/email-service.js';
import { ProviderInstanceNotFoundError } from '@/utils/errors.js';
import { logError } from '@/utils/logger.js';
import { withLock } from '@/utils/mutex.js';
import { randomItem, randomToken } from '@/utils/security/secure-random.js';
import {
  disabledInstancesKey,
  getStorage,
  type ProviderStorageKey,
  selectedInstanceKey,
  setStorage,
} from '@/utils/storage/storage-keys.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import type { ProviderInstance } from '@/utils/types.js';

/**
 * Get instances for a provider from JSON config
 */
export function getProviderInstances(providerId: string): ProviderInstance[] {
  const config = loadProviderConfig(providerId);
  if (!config.multiInstance?.enabled) {
    return [];
  }
  return (
    config.multiInstance.instances?.map((inst) => ({
      ...inst,
      isCustom: false,
    })) || []
  );
}

/**
 * Get all instances for a provider (predefined + custom)
 */
export async function getProviderInstancesWithCustom(
  providerId: string
): Promise<ProviderInstance[]> {
  const predefinedInstances = getProviderInstances(providerId);
  const storageKey: ProviderStorageKey = `customInstances_${providerId}`;
  const result = await getStorage<ProviderInstance[]>(storageKey);
  const customInstances: ProviderInstance[] =
    result && typeof result === 'object' && Array.isArray(result[storageKey])
      ? result[storageKey]
      : [];
  return [...predefinedInstances, ...customInstances];
}

/**
 * Disabled (blacklist) instance ids for a provider. When absent/empty, ALL
 * instances are enabled. Migrates the legacy single-pin
 * `selectedInstance_<provider>` key (kept for backwards compatibility):
 *   • 'random' / missing → all enabled (empty blacklist)
 *   • a concrete id     → blacklist everything except that id (preserves the
 *                         user's current pin intent as "only this instance")
 */
export async function getDisabledInstances(providerId: string): Promise<string[]> {
  const key = disabledInstancesKey(providerId);
  const result = await getStorage<string[]>(key);
  const stored = result && typeof result === 'object' ? result[key] : undefined;
  if (Array.isArray(stored)) return stored;

  // No blacklist yet - migrate the legacy single-pin selection if present.
  const legacyKey = selectedInstanceKey(providerId);
  const legacyResult = await getStorage<string>(legacyKey);
  const legacy =
    legacyResult && typeof legacyResult === 'object' ? legacyResult[legacyKey] : undefined;

  if (typeof legacy === 'string' && legacy !== 'random') {
    const instances = await getProviderInstancesWithCustom(providerId);
    const blacklist = instances.map((i) => i.id).filter((id) => id !== legacy);
    await setStorage(key, blacklist);
    // Retire the legacy single-pin key so it can never re-assert a stale pin
    // (e.g. a pinned instance the user later disabled via the new checkboxes).
    await browser.storage.local.remove(legacyKey).catch(() => {});
    return blacklist;
  }

  await setStorage(key, []);
  await browser.storage.local.remove(legacyKey).catch(() => {});
  return [];
}

/**
 * Calculate the next disabled-instance blacklist for a checkbox toggle.
 * Returns null when disabling this instance would leave the provider with no
 * enabled instances. The input is never mutated.
 */
export function toggleDisabledInstance(
  disabled: Iterable<string>,
  instanceId: string,
  totalInstances: number
): Set<string> | null {
  const next = new Set(disabled);
  const willDisable = !next.has(instanceId);
  if (willDisable && totalInstances - next.size <= 1) return null;

  if (willDisable) next.add(instanceId);
  else next.delete(instanceId);
  return next;
}

/**
 * Persist the disabled-instance blacklist for a provider.
 */
export async function setDisabledInstances(providerId: string, disabled: string[]): Promise<void> {
  await setStorage(disabledInstancesKey(providerId), Array.from(new Set(disabled)));
}

/**
 * Instances eligible for email generation for a provider (all minus blacklist).
 * Returns [] when the provider has no instances at all.
 */
export async function getEnabledInstances(providerId: string): Promise<ProviderInstance[]> {
  const instances = await getProviderInstancesWithCustom(providerId);
  if (instances.length === 0) return [];
  const disabled = new Set(await getDisabledInstances(providerId));
  return instances.filter((i) => !disabled.has(i.id));
}

/**
 * Get the random pick among the provider's ENABLED instances (null when none).
 * Kept for backwards compatibility - the pool semantics now drive creation.
 */
export async function getSelectedProviderInstance(
  providerId: string
): Promise<ProviderInstance | null> {
  const enabled = await getEnabledInstances(providerId);
  return enabled.length > 0 ? (randomItem(enabled) ?? null) : null;
}

/**
 * Set selected instance for a provider (legacy single-pin API).
 * Backed by the blacklist: pinning an id disables all others;
 * 'random' clears the blacklist (all enabled).
 */
export async function setProviderInstance(providerId: string, instanceId: string): Promise<void> {
  if (instanceId === 'random') {
    await setDisabledInstances(providerId, []);
    return;
  }
  const instances = await getProviderInstancesWithCustom(providerId);
  const instance = instances.find((i) => i.id === instanceId);
  if (!instance) {
    throw new ProviderInstanceNotFoundError(instanceId);
  }
  await setDisabledInstances(
    providerId,
    instances.map((i) => i.id).filter((id) => id !== instanceId)
  );
}

/**
 * Add custom instance for a provider
 */
export async function addCustomProviderInstance(
  providerId: string,
  instance: Omit<ProviderInstance, 'id' | 'isCustom'>
): Promise<void> {
  await withLock('custom_instances_lock', async () => {
    const storageKey: ProviderStorageKey = `customInstances_${providerId}`;
    const result = await getStorage<ProviderInstance[]>(storageKey);
    const customInstances: ProviderInstance[] = result[storageKey] || [];
    // Strip query strings from apiUrl to prevent leaking tokens in stored instance URLs
    let sanitizedApiUrl = instance.apiUrl;
    try {
      const u = new URL(instance.apiUrl);
      u.search = '';
      u.hash = '';
      sanitizedApiUrl = u.toString().replace(/\/$/, '');
    } catch {
      /* invalid URL - keep as-is for validation to catch */
    }
    const newInstance: ProviderInstance = {
      ...instance,
      apiUrl: sanitizedApiUrl,
      id: `custom_${providerId}_${Date.now()}_${randomToken(6)}`,
      isCustom: true,
    };
    customInstances.push(newInstance);
    await setStorage(storageKey, customInstances);
  });
}

/**
 * Remove custom instance for a provider
 */
export async function removeCustomProviderInstance(
  providerId: string,
  instanceId: string
): Promise<void> {
  await withLock('custom_instances_lock', async () => {
    const storageKey: ProviderStorageKey = `customInstances_${providerId}`;
    const result = await getStorage<ProviderInstance[]>(storageKey);
    const customInstances: ProviderInstance[] = result[storageKey] || [];
    const filtered = customInstances.filter(
      (instance: ProviderInstance) => instance.id !== instanceId
    );
    await setStorage(storageKey, filtered);

    // Also purge the deleted instance's id from the disabled-instances
    // blacklist so removal doesn't leave a zombie entry behind forever.
    const disabledKey = disabledInstancesKey(providerId);
    const disabledResult = await getStorage<string[]>(disabledKey);
    const disabled: string[] = Array.isArray(disabledResult[disabledKey])
      ? disabledResult[disabledKey]
      : [];
    if (disabled.includes(instanceId)) {
      await setStorage(
        disabledKey,
        disabled.filter((id) => id !== instanceId)
      );
    }
  });
}

/**
 * Initialize default provider settings
 */
export async function initializeDefaultProvider(): Promise<void> {
  try {
    const { selectedProvider } = (await browser.storage.local.get(['selectedProvider'])) as {
      selectedProvider?: string;
    };
    if (!selectedProvider) {
      await writeWithRetry({ selectedProvider: DEFAULT_PROVIDER });
    }
  } catch (error: unknown) {
    logError(
      'Error initializing default provider:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}
