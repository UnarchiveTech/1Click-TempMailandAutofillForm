export interface OnboardingSetters {
  onCreateInbox: (provider: string) => void | Promise<void>;
}

export async function handleCreateInbox(
  provider: string,
  ext: typeof browser,
  setters: OnboardingSetters
): Promise<void> {
  // Save selected provider so create uses the chosen one; mark complete only after success
  await ext.storage.local.set({ selectedProvider: provider });
  await setters.onCreateInbox(provider);
  await ext.storage.local.set({ onboardingComplete: true });
}
