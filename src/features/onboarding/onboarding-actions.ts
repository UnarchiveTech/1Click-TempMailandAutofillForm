import type { browser } from 'wxt/browser';
import { writeWithRetry } from '@/utils/storage/storage-write.js';

export interface OnboardingSetters {
  onCreateAddress: (provider: string) => void | Promise<void>;
}

export async function handleCreateAddress(
  provider: string,
  _ext: typeof browser,
  setters: OnboardingSetters
): Promise<void> {
  // Save selected provider so create uses the chosen one; mark complete only after success
  await writeWithRetry({ selectedProvider: provider });
  await setters.onCreateAddress(provider);
  await writeWithRetry({ onboardingComplete: true });
}
