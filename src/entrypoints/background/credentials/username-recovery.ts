import { browser } from 'wxt/browser';
import { logError } from '@/utils/logger.js';
import { withLock } from '@/utils/mutex.js';
import { isRecord } from '@/utils/storage/storage-keys.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import type { CredentialsHistoryItem } from '@/utils/types.js';

export interface PendingUsernameUpdate {
  credentialId: string;
  domain: string;
  expectedUsername: string;
  username: string;
}

/** Patch one pending signup, never replace a captured credential snapshot. */
export async function updatePendingSignupUsername(
  update: PendingUsernameUpdate
): Promise<{ success: boolean; error?: string }> {
  if (
    !update.credentialId ||
    update.credentialId.length > 512 ||
    !update.domain ||
    update.domain.length > 512 ||
    typeof update.expectedUsername !== 'string' ||
    update.expectedUsername.length > 512 ||
    typeof update.username !== 'string' ||
    !update.username.trim() ||
    update.username.length > 512
  )
    return { success: false, error: 'errors.invalidRequestFormat' };

  return withLock('login_info_lock', async () => {
    const result = await browser.storage.local.get('loginInfo');
    const loginInfo: CredentialsHistoryItem[] = Array.isArray(result.loginInfo)
      ? result.loginInfo
      : [];
    const index = loginInfo.findIndex(
      (item) =>
        item?.id === update.credentialId &&
        typeof item.domain === 'string' &&
        item.domain.toLowerCase() === update.domain.toLowerCase()
    );
    const current = loginInfo[index];
    if (
      !current ||
      current.verified ||
      !['pending_submit', 'submitted', 'failed', 'undetected'].includes(
        current.signupStatus || ''
      ) ||
      current.username !== update.expectedUsername
    ) {
      return { success: false, error: 'errors.invalidRequestFormat' };
    }
    loginInfo[index] = { ...current, username: update.username };
    await writeWithRetry({ loginInfo });

    // The session is shared across tabs. Do not change another site's session
    // or revive a stale session that a later fill already replaced.
    await withLock('session_credentials_lock', async () => {
      const session = await browser.storage.session.get('sessionCredentials');
      if (
        isRecord(session.sessionCredentials) &&
        session.sessionCredentials.signupCredentialId === update.credentialId &&
        session.sessionCredentials.username === update.expectedUsername
      ) {
        await browser.storage.session.set({
          sessionCredentials: { ...session.sessionCredentials, username: update.username },
        });
      }
    }).catch((error: unknown) => {
      // The durable login already succeeded. A session failure must not make
      // the client retry a compare-and-set that has now legitimately changed.
      logError('Pending username saved but session update failed', error);
    });
    return { success: true };
  });
}
