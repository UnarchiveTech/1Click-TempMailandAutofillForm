/**
 * Provider instance management
 * Reads instances from JSON config and handles storage operations
 */

import { browser } from 'wxt/browser';
import { DEFAULT_PROVIDER, loadProviderConfig } from '@/utils/email-service.js';
import { ProviderInstanceNotFoundError } from '@/utils/errors.js';
import { logError, logWarn } from '@/utils/logger.js';
import { withLock } from '@/utils/mutex.js';
import { randomItem, randomToken } from '@/utils/secure-random.js';
import { getStorage, type ProviderStorageKey, setStorage } from '@/utils/storage-keys.js';
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
 * Get selected instance for a provider
 */
export async function getSelectedProviderInstance(
  providerId: string
): Promise<ProviderInstance | null> {
  const storageKey: ProviderStorageKey = `selectedInstance_${providerId}`;
  const result = await getStorage<string>(storageKey);
  const selectedInstance = result && typeof result === 'object' ? result[storageKey] : undefined;

  const instances = await getProviderInstancesWithCustom(providerId);

  if (!selectedInstance || typeof selectedInstance !== 'string') {
    await setStorage(storageKey, 'random');
    const randomInstance = randomItem(instances);
    return randomInstance || null;
  }

  if (selectedInstance === 'random') {
    const randomInstance = randomItem(instances);
    return randomInstance || null;
  }

  const selected = instances.find((instance) => instance.id === selectedInstance);
  if (!selected) {
    logWarn(
      `Selected instance ${selectedInstance} not found for provider ${providerId}, falling back to random`
    );
    await setStorage(storageKey, 'random');
    const randomInstance = randomItem(instances);
    return randomInstance || null;
  }
  return selected;
}

/**
 * Set selected instance for a provider
 */
export async function setProviderInstance(providerId: string, instanceId: string): Promise<void> {
  const instances = await getProviderInstancesWithCustom(providerId);
  const instance = instances.find((i) => i.id === instanceId);
  if (!instance) {
    throw new ProviderInstanceNotFoundError(instanceId);
  }
  const storageKey: ProviderStorageKey = `selectedInstance_${providerId}`;
  await setStorage(storageKey, instanceId);
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
    const newInstance: ProviderInstance = {
      ...instance,
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
      await browser.storage.local.set({ selectedProvider: DEFAULT_PROVIDER });
    }
  } catch (error: unknown) {
    logError(
      'Error initializing default provider:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}
