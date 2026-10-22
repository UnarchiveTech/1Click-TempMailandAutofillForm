/** Public fixtures only. Never read a user's backup in the public build. */
export function createWebDemoSeed(host: string, language = 'en'): Record<string, unknown> {
  const now = Date.now();
  const address = 'alex.demo@example.com';
  return {
    demoMode: true,
    preferredLanguage: language,
    language,
    onboardingComplete: true,
    notificationsEnabled: false,
    soundEnabled: false,
    autoRefreshInterval: 0,
    selectedProvider: 'demo',
    activeAddressId: 'demo-inbox-1',
    selectedEmail: address,
    addresses: [
      {
        id: 'demo-inbox-1',
        address,
        provider: 'demo',
        accountStatus: 'active',
        createdAt: now,
        expiresAt: now + 86_400_000,
      },
    ],
    emailStorageAddressIndex: { 'demo-inbox-1': address },
    'storedEmailsByAddress_demo-inbox-1': [],
    emailStorageMetadata: {},
    selectedIdentityId: 'demo-identity',
    identities: [
      {
        id: 'demo-identity',
        name: 'Alex Morgan',
        firstNames: 'Alex',
        lastNames: 'Morgan',
        username: 'alex_morgan_demo',
        useRandomPassword: true,
        isDefault: true,
        country: 'US',
        createdAt: now,
      },
    ],
    loginInfo: [],
    otpOptInList: [host],
    smartAutofillSettings: {
      humanLikeFilling: false,
      humanLikeTiming: false,
      dryRunPreview: true,
      smartOtpAttach: true,
      localeAwareData: true,
      autoClickSubmitButtons: false,
    },
  };
}
