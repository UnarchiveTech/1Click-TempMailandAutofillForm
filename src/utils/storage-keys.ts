/**
 * Type-safe storage key definitions
 */

/**
 * Dynamic storage key patterns for provider-specific settings
 */
export type ProviderStorageKey = `customInstances_${string}` | `selectedInstance_${string}`;

/**
 * All possible storage keys in the application
 */
export type StorageKey =
  | ProviderStorageKey
  | 'selectedProvider'
  | 'useCustomPassword'
  | 'customPassword'
  | 'useCustomName'
  | 'customFirstName'
  | 'customLastName'
  | 'autoCopy'
  | 'autoRenew'
  | 'customColor'
  | 'providerInstances'
  | 'emailRetentionDays'
  | 'showDeveloperSettings'
  | 'enableLogging'
  | 'identities'
  | 'savedSearchFilters'
  | string; // Fallback for any other string key

/**
 * Type-safe storage get operation
 */
export async function getStorage<T>(key: StorageKey): Promise<Record<string, T>> {
  const result = await browser.storage.local.get([key]);
  return result as Record<string, T>;
}

/**
 * Type-safe storage set operation
 */
export async function setStorage(key: StorageKey, value: unknown): Promise<void> {
  await browser.storage.local.set({ [key]: value });
}
