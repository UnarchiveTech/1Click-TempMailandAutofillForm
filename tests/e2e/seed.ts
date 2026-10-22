/** Fresh timestamps for each context; long suites must not inherit expired OTPs. */
export function demoSeedStorage() {
  const now = Date.now();
  return {
    demoMode: true,
    onboardingComplete: true,
    addresses: [
      {
        id: 'demo-inbox-1',
        address: 'demo.user@example.com',
        provider: 'demo',
        status: 'active',
        accountStatus: 'active',
        autoExtend: true,
        createdAt: now - 3_600_000,
        expiresAt: now + 86_400_000,
        sidToken: 'demo-token-1',
        token: 'demo-token-1',
      },
    ],
    emailStorageAddressIndex: { 'demo-inbox-1': 'demo.user@example.com' },
    'storedEmailsByAddress_demo-inbox-1': [
      {
        id: 'demo-seed-1',
        from: 'security@github.com',
        from_name: 'GitHub',
        subject: 'Your verification code',
        body_plain: 'Your GitHub verification code is 482901.',
        body_html: '<p>Your GitHub verification code is 482901.</p>',
        received_at: now - 60_000,
        unread: true,
        otp: '482901',
        isOtp: true,
        original_inbox: 'demo.user@example.com',
      },
    ],
    emailStorageMetadata: {
      'demo-inbox-1': {
        messageCount: 1,
        unreadCount: 1,
        latestReceivedAt: now - 60_000,
        latestOtpAt: now - 60_000,
        hasMagicLink: false,
        revision: 1,
      },
    },
    readEmails: {},
    activeAddressId: 'demo-inbox-1',
    selectedEmail: 'demo.user@example.com',
  };
}
