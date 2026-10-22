/**
 * Inbox expiry management
 * Handles inbox expiry checking, auto-renewal, and expiry notifications
 */

import { browser } from 'wxt/browser';
import { addAutoExtendEvent } from '@/utils/activity/activity-tracker.js';
import { EmailService, loadProviderConfig } from '@/utils/email/email-service.js';
import { AddressCreationError } from '@/utils/errors.js';
import { tSync } from '@/utils/i18n/i18n-background.js';
import { logError } from '@/utils/logger.js';
import { withAddressLock } from '@/utils/mutex.js';
import { createBrowserNotification } from '@/utils/notifications/notification-permission.js';
import { perfEnd, perfStart } from '@/utils/perf/perf-marks.js';
import {
  DEFAULT_PRE_EXPIRY_WINDOW_MINUTES,
  deriveAddressTiming,
  effectivePreExpiryWindowMs,
} from '@/utils/provider/provider-expiry.js';
import {
  getAddresses,
  getArchivedAddressOverflow,
  getMaxArchivedAddresses,
  getRawAddresses,
  setAddresses,
  setArchivedAddressOverflow,
} from '@/utils/storage/storage-keys.js';
import type { Address, NotificationSettings } from '@/utils/types.js';
import { clearStoredEmails, restoreArchivedEmailsToStored } from './email-storage.js';
import { registerExpiryAlarmListeners, scheduleNextExpiryAlarm } from './expiry-alarms.js';
import { getRenewalFailureUpdates } from './renewal-retry.js';

type NotificationType = 'expired' | 'renewed' | 'expiring-soon';

let expiryAlarmListenerRegistered = false;
/** Reentrancy guard: checkAddressExpiry is invoked from the immediate SW-start
 * pass, the checkAddressExpiry alarm, AND the checkEmails piggyback - overlapping
 * runs would double-renew and double-notify. Skip while one is in flight. */
let expiryCheckRunning = false;

/** One notification card per mailbox: the warning, renewal, and expiry states
 * of the same address replace each other instead of stacking a new card per
 * event. Click behavior is unchanged (no click routing exists for these). */
function addressNotificationId(addressId: string): string {
  return `address-expiry:${addressId}`;
}

function createAddressNotification(
  type: NotificationType,
  address: string,
  soundEnabled: boolean,
  notificationId: string
): void {
  const messages: Record<NotificationType, { title: string; message: string }> = {
    expired: {
      title: tSync('notifications.addressExpiredTitle'),
      message: tSync('notifications.addressExpiredMessage', { address }),
    },
    renewed: {
      title: tSync('notifications.addressRenewedTitle'),
      message: tSync('notifications.addressRenewedMessage', { address }),
    },
    'expiring-soon': {
      title: tSync('notifications.addressExpiringSoonTitle'),
      message: tSync('notifications.addressExpiringSoonMessage', { address }),
    },
  };
  const { title, message } = messages[type];
  createBrowserNotification(notificationId, {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title,
    message,
    priority: 1,
    // Respect the soundEnabled toggle: mute the OS notification chime.
    silent: !soundEnabled,
  });
}

export async function checkAddressExpiry(): Promise<void> {
  if (expiryCheckRunning) return;
  expiryCheckRunning = true;
  const checkStart = perfStart('bg.checkAddressExpiry');
  const renewalAttempts = new Map<string, number>();
  try {
    const {
      addresses = [],
      notificationSettings = {
        enabled: true,
        soundEnabled: true,
        expiryWarningThreshold: 60 * 60 * 1000,
      },
      preExpiryWindowMinutes,
      renewalFailurePolicy = 'retry',
    } = (await browser.storage.local.get([
      'addresses',
      'notificationSettings',
      'preExpiryWindowMinutes',
      'renewalFailurePolicy',
    ])) as {
      addresses?: Address[];
      notificationSettings?: NotificationSettings;
      /** User-configurable auto-renew lead time in minutes (1-30). */
      preExpiryWindowMinutes?: number;
      /** Archive after the first failed renewal, or wait until the address expires. */
      renewalFailurePolicy?: 'retry' | 'archive';
    };

    if (addresses.length === 0) return;

    const now = Date.now();
    const updatedAddresses = [...addresses];
    const warningThreshold = notificationSettings.expiryWarningThreshold || 60 * 60 * 1000; // Default to 1 hour
    const modifiedAddresses = new Map<string, Partial<Address>>();
    const addressesToArchiveEmails = new Set<string>();

    for (let i = 0; i < updatedAddresses.length; i++) {
      const record = updatedAddresses[i];
      if (record.accountStatus === 'deleted') continue;
      // "Expired" is tracked independently of the expiring-soon warning: the
      // legacy single flag meant a prior warning silently ate the expired /
      // renewal-failure notification - the address died without the user ever
      // being told. The flags are set only when the notice is actually SHOWN:
      // marking them while notifications are disabled would silently eat the
      // backfill - the user re-enables later and is never told about the
      // expiry they missed.
      const notifyExpiredOnce = () => {
        const alreadyNotified = record.expiredNotified ?? false;
        if (notificationSettings?.enabled && !alreadyNotified) {
          createAddressNotification(
            'expired',
            record.address,
            notificationSettings.soundEnabled !== false,
            addressNotificationId(record.id)
          );
          modifiedAddresses.set(record.id, {
            ...modifiedAddresses.get(record.id),
            expiredNotified: true,
            expiryNotified: true,
          });
          updatedAddresses[i] = {
            ...updatedAddresses[i],
            expiredNotified: true,
            expiryNotified: true,
          };
        }
      };

      // A dormant auto-archive can still owe an expiry notice if notifications
      // were disabled when it expired. Backfill that notice without renewing,
      // re-archiving, or notifying about an inbox the user manually archived.
      if (record.accountStatus === 'archived' && !record.autoExtend) {
        if (
          record.archiveReason !== undefined &&
          record.archiveReason !== 'manual' &&
          record.expiresAt !== undefined &&
          record.expiresAt <= now
        ) {
          notifyExpiredOnce();
        }
        continue;
      }

      const archiveAfterRenewalFailure = (failureAt: number) => {
        const renewalLabel = loadProviderConfig(record.provider).expiry?.renewalLabel;
        const archiveReason =
          renewalLabel === 'autoExtend' ? 'auto-extend-failed' : 'auto-renew-failed';
        // A manually archived address stays a manual archive when the owner
        // explicitly chose to keep it archived after renewal. Failure/retry
        // details are still recorded, but must not turn a later success into
        // an automatic unarchive.
        if (
          record.accountStatus === 'archived' &&
          record.archiveReason === 'manual' &&
          record.unarchiveAfterRenewal !== true
        ) {
          return;
        }
        if (record.accountStatus === 'archived' && record.archiveReason === archiveReason) return;
        const archiveUpdates: Partial<Address> = {
          accountStatus: 'archived',
          archiveReason,
          archivedAt: Math.max(failureAt, (record.archivedAt ?? 0) + 1),
        };
        modifiedAddresses.set(record.id, {
          ...modifiedAddresses.get(record.id),
          ...archiveUpdates,
        });
        updatedAddresses[i] = { ...updatedAddresses[i], ...archiveUpdates };
        if (record.accountStatus !== 'archived') addressesToArchiveEmails.add(record.id);
      };

      const isExpired = !!(record.expiresAt && record.expiresAt <= now);
      // Adaptive pre-expiry window: uses measured renewal latency (own or a
      // sibling's - same provider/instance - since network latency is a property
      // of the provider, not the address) so auto-renew fires early enough to
      // complete before the mailbox expires. The user-configurable lead time
      // (1-30 min) replaces the provider minimum as the floor.
      const preExpiryWindow = effectivePreExpiryWindowMs(
        record,
        addresses,
        loadProviderConfig(record.provider),
        typeof preExpiryWindowMinutes === 'number' && preExpiryWindowMinutes > 0
          ? preExpiryWindowMinutes
          : DEFAULT_PRE_EXPIRY_WINDOW_MINUTES
      );
      const isNearingExpiry = !!(
        record.expiresAt &&
        record.autoExtend &&
        record.expiresAt - now <= preExpiryWindow
      );

      if (isExpired || isNearingExpiry) {
        if (record.autoExtend) {
          const providerConfig = loadProviderConfig(record.provider);
          const renewalMethod = providerConfig.expiry?.renewalMethod;
          const supportsRenewal =
            providerConfig.expiry?.renewable === true ||
            providerConfig.capabilities?.supportsRenew === true;
          if (!supportsRenewal || !renewalMethod) {
            // A provider is only renewable when it declares both the capability
            // and an operation. Treating `renewable: true` without a method as
            // success used to reset expiresAt without making any API request.
            // Provider doesn't support a usable renewal path, keep as expired
            // (don't auto-archive).
            if (isExpired) {
              notifyExpiredOnce();
            } else if (
              !(record.expiringSoonNotified ?? record.expiryNotified ?? false) &&
              notificationSettings?.enabled
            ) {
              // Nearing expiry with no renewal coming - warn now so the address
              // doesn't die silently. (The T-1h fall-through below covers the
              // wider window; this covers the pre-expiry window for addresses that
              // weren't warned there, e.g. autoExtend enabled late.)
              createAddressNotification(
                'expiring-soon',
                record.address,
                notificationSettings.soundEnabled !== false,
                addressNotificationId(record.id)
              );
              modifiedAddresses.set(record.id, {
                ...modifiedAddresses.get(record.id),
                expiringSoonNotified: true,
                expiryNotified: true,
              });
              updatedAddresses[i] = {
                ...updatedAddresses[i],
                expiringSoonNotified: true,
                expiryNotified: true,
              };
            }
            continue;
          }
          // Exponential backoff after a failed attempt - wait out the delay
          // instead of hammering the provider every minute. The UI shows
          // "next try in X" from this timestamp.
          const nextRetryAt = (record as Address & { nextRetryAt?: number }).nextRetryAt;
          if (nextRetryAt && now < nextRetryAt) {
            // The wait spaces out NETWORK attempts; it must not postpone telling
            // the user the mailbox is gone. An expiry that lands inside the
            // backoff window would otherwise go unreported until the retry
            // fires (up to 30 min). Notify once, without disturbing the
            // schedule - auto-renew still never archives the address.
            if (isExpired) {
              notifyExpiredOnce();
              archiveAfterRenewalFailure(record.lastFailureAt ?? now);
            } else if (renewalFailurePolicy === 'archive' && (record.renewalFailCount ?? 0) > 0) {
              // The user may have changed the policy while this inbox was
              // waiting for its next retry; apply it to the existing failure.
              archiveAfterRenewalFailure(record.lastFailureAt ?? now);
            }
            continue;
          }
          try {
            // Auto-renew inbox using EmailService
            const config = loadProviderConfig(record.provider);
            const service = new EmailService(config, browser);

            if (!record.token && !record.sidToken) {
              throw new AddressCreationError(record.provider, {
                addressId: record.id,
                reason: 'missing-token',
              });
            }

            const currentUser = record.emailUser || record.address.split('@')[0];

            // Persist a short-lived progress marker so the open extension UI
            // can distinguish an active provider request from a countdown.
            // Re-read under the address lock: a user may have archived,
            // disabled renewal, or deleted this address since the scan began.
            const renewalStartedAt = Date.now();
            const markedInProgress = await withAddressLock(async () => {
              const latestAddresses = await getAddresses();
              const latestIndex = latestAddresses.findIndex((address) => address.id === record.id);
              if (latestIndex < 0) return false;
              const latest = latestAddresses[latestIndex];
              if (
                latest.accountStatus === 'deleted' ||
                !latest.autoExtend ||
                latest.archivedAt !== record.archivedAt
              ) {
                return false;
              }
              latestAddresses[latestIndex] = { ...latest, renewalInProgressAt: renewalStartedAt };
              await setAddresses(latestAddresses);
              return true;
            });
            if (!markedInProgress) continue;
            renewalAttempts.set(record.id, renewalStartedAt);

            // Measure actual renewal latency for the adaptive auto-renew window.
            const renewalStart = Date.now();
            let renewalResponse: Record<string, unknown> = {};

            renewalResponse = await service.executeOperation(renewalMethod, {
              auth: { token: (record.token || record.sidToken) as string },
              variables: { emailUser: currentUser },
              // Renewable multi-instance providers must renew against the same
              // instance that created the mailbox; omitting this silently sends
              // the request to the literal `{instanceUrl}` endpoint.
              ...(record.instanceUrl ? { instanceUrl: record.instanceUrl } : {}),
            });
            const measuredLatencyMs = Date.now() - renewalStart;

            const capturedCookieToken =
              config.auth?.type === 'cookie' && config.auth.cookieName
                ? service.getSessionCookies()[config.auth.cookieName]
                : undefined;
            const newSidToken =
              typeof renewalResponse.token === 'string' && renewalResponse.token.trim()
                ? renewalResponse.token
                : capturedCookieToken || record.token || record.sidToken;
            // BUG FIX: force renewal base to now so the new window is always future.
            const timing = deriveAddressTiming(renewalResponse, providerConfig, Date.now(), {
              renewalBaseNow: true,
            });

            const prevCount = updatedAddresses[i].renewalCount ?? 0;
            const renewalUpdates = {
              token: newSidToken,
              sidToken: newSidToken,
              emailUser: currentUser,
              expiresAt: timing.expiresAt,
              expiryNotified: false,
              // Fresh window → reset the per-state flags so the next expiry
              // cycle can warn again.
              expiringSoonNotified: false,
              expiredNotified: false,
              renewalCount: prevCount + 1,
              renewalLatencyMs: measuredLatencyMs,
              lastRenewalAt: Date.now(),
              // A successful renewal ends any failure streak and clears the
              // retry backoff - the next failure starts fresh instead of
              // inheriting a stale cumulative count.
              renewalFailCount: 0,
              lastFailureAt: undefined,
              nextRetryAt: undefined,
              accountStatus: 'active' as const,
            };

            modifiedAddresses.set(record.id, {
              ...modifiedAddresses.get(record.id),
              ...renewalUpdates,
            });

            updatedAddresses[i] = {
              ...updatedAddresses[i],
              ...renewalUpdates,
            };

            // A routine renewal is not news - the mailbox just keeps working,
            // so it stays silent. Only a renewal that ends a failure streak
            // notifies: the user was told something was wrong, so the recovery
            // must be reported too. `record` still holds the pre-attempt
            // snapshot (success builds a new object above), so this reads the
            // streak as it was before this attempt.
            const preAttempt = record as Address & { renewalFailCount?: number };
            if (notificationSettings?.enabled && (preAttempt.renewalFailCount ?? 0) > 0) {
              createAddressNotification(
                'renewed',
                record.address,
                notificationSettings.soundEnabled !== false,
                addressNotificationId(record.id)
              );
            }
            void addAutoExtendEvent(record.address, record.provider);
          } catch (renewError: unknown) {
            logError('Failed to auto-renew inbox', {
              address: record.address,
              error: renewError,
            });
            // Once expired, move the inbox to Archived so the status explains
            // why it left Live. Keep autoExtend + retry metadata: retries
            // continue, and success returns the inbox to Live.
            // Only failures within the streak window are consecutive - a stale
            // failure (previous outage, browser asleep between checks) starts
            // a fresh streak at 1 instead of stacking onto the backoff.
            const failureUpdates = getRenewalFailureUpdates(record);
            if (isExpired || renewalFailurePolicy === 'archive') {
              archiveAfterRenewalFailure(failureUpdates.lastFailureAt ?? now);
            }
            modifiedAddresses.set(record.id, {
              ...modifiedAddresses.get(record.id),
              ...failureUpdates,
            });
            updatedAddresses[i] = {
              ...updatedAddresses[i],
              ...failureUpdates,
            };
            // A failed renewal during the lead window does not mean the inbox
            // has expired yet. Only emit the expired notification once the
            // actual expiry timestamp has passed; otherwise issue the normal
            // warning without setting expiredNotified.
            if (isExpired) {
              notifyExpiredOnce();
            } else if (
              // Once per failure STREAK, not once per retry: every backoff step
              // re-enters this block while the address is still inside its lead
              // window, so without this the user gets the identical notice on
              // each retry (1, 2, 4 … 30 min apart). `nextFailCount === 1` is
              // the first failure of a fresh streak - deliberately NOT the
              // notified flags: a renewal failure that follows an earlier T-1h
              // warning is new information and must still be reported (pinned
              // by expiry-notifications.test.ts "notifies even after a prior
              // expiring-soon warning").
              failureUpdates.renewalFailCount === 1 &&
              notificationSettings?.enabled
            ) {
              createAddressNotification(
                'expiring-soon',
                record.address,
                notificationSettings.soundEnabled !== false,
                addressNotificationId(record.id)
              );
              modifiedAddresses.set(record.id, {
                ...modifiedAddresses.get(record.id),
                expiringSoonNotified: true,
                expiryNotified: true,
              });
              updatedAddresses[i] = {
                ...updatedAddresses[i],
                expiringSoonNotified: true,
                expiryNotified: true,
              };
            }
            continue;
          }
        } else {
          // Not auto-renewing: apply user preference (archive by default, or delete permanently)
          notifyExpiredOnce();
          try {
            const { expiryAction = 'archive' } = (await browser.storage.local.get([
              'expiryAction',
            ])) as { expiryAction?: 'archive' | 'delete' };
            if (expiryAction === 'delete') {
              // Match an explicit permanent delete: remove the inbox record,
              // credentials, email bags, and related metadata through the same
              // lifecycle path as a user-initiated delete. Import lazily to
              // avoid the address-manager <-> expiry-manager startup cycle.
              const { deleteAddress } = await import('./address-manager.js');
              const deleted = await deleteAddress(record.id);
              if (!deleted.success) {
                logError('Failed to permanently delete expired inbox; archiving instead', {
                  addressId: record.id,
                  error: deleted.error,
                });
                modifiedAddresses.set(record.id, {
                  ...modifiedAddresses.get(record.id),
                  accountStatus: 'archived',
                  archiveReason: 'expired',
                  archivedAt: Math.max(Date.now(), (record.archivedAt ?? 0) + 1),
                  expiryNotified: true,
                });
                updatedAddresses[i] = {
                  ...updatedAddresses[i],
                  accountStatus: 'archived',
                  archiveReason: 'expired',
                  archivedAt: Math.max(Date.now(), (record.archivedAt ?? 0) + 1),
                  expiryNotified: true,
                };
                addressesToArchiveEmails.add(record.id);
              }
            } else {
              // Default: archive after expiry
              modifiedAddresses.set(record.id, {
                ...modifiedAddresses.get(record.id),
                accountStatus: 'archived',
                archiveReason: 'expired',
                archivedAt: Math.max(Date.now(), (record.archivedAt ?? 0) + 1),
                expiryNotified: true,
              });
              updatedAddresses[i] = {
                ...updatedAddresses[i],
                accountStatus: 'archived',
                archiveReason: 'expired',
                archivedAt: Math.max(Date.now(), (record.archivedAt ?? 0) + 1),
                expiryNotified: true,
              };
              addressesToArchiveEmails.add(record.id);
            }
            // Archiving moves mail into the saved-email store. Permanent
            // deletion already purged both stored and archived mail above.
          } catch (err) {
            // Storage read failed - fall back to archive to prevent zombie expired state
            logError('Failed to read expiryAction from storage, defaulting to archive', err);
            modifiedAddresses.set(record.id, {
              ...modifiedAddresses.get(record.id),
              accountStatus: 'archived',
              archiveReason: 'expired',
              archivedAt: Math.max(Date.now(), (record.archivedAt ?? 0) + 1),
              expiryNotified: true,
            });
            updatedAddresses[i] = {
              ...updatedAddresses[i],
              accountStatus: 'archived',
              archiveReason: 'expired',
              archivedAt: Math.max(Date.now(), (record.archivedAt ?? 0) + 1),
              expiryNotified: true,
            };
            addressesToArchiveEmails.add(record.id);
          }
          continue;
        }
      }

      const currentAddressState = updatedAddresses[i];
      const timeLeft = currentAddressState.expiresAt ? currentAddressState.expiresAt - now : null;
      if (
        timeLeft !== null &&
        timeLeft <= warningThreshold &&
        !(currentAddressState.expiringSoonNotified ?? currentAddressState.expiryNotified ?? false)
      ) {
        // The flags are set only when the warning is actually shown (same
        // backfill rule as notifyExpiredOnce above): a disabled-notifications
        // period must not consume the one warning the user will get.
        if (notificationSettings?.enabled) {
          createAddressNotification(
            'expiring-soon',
            currentAddressState.address,
            notificationSettings.soundEnabled !== false,
            addressNotificationId(currentAddressState.id)
          );
          modifiedAddresses.set(currentAddressState.id, {
            ...modifiedAddresses.get(currentAddressState.id),
            expiringSoonNotified: true,
            expiryNotified: true,
          });
          updatedAddresses[i] = {
            ...currentAddressState,
            expiringSoonNotified: true,
            expiryNotified: true,
          };
        }
      }
    }

    if (modifiedAddresses.size > 0) {
      await withAddressLock(async () => {
        const currentAddresses = await getAddresses();
        let changed = false;
        for (const [id, updates] of modifiedAddresses) {
          const idx = currentAddresses.findIndex((inb) => inb.id === id);
          if (idx !== -1) {
            const scannedRecord = addresses.find((address) => address.id === id);
            const currentRecord = currentAddresses[idx];
            if (currentRecord.accountStatus === 'deleted') continue;
            const renewalSucceeded = typeof updates.lastRenewalAt === 'number';
            const archiveChanged = currentRecord.archivedAt !== scannedRecord?.archivedAt;
            // The address may have been manually archived or restored while
            // this check awaited provider/network work. Discard stale failure /
            // expiry patches. A successful remote renewal still must persist
            // its new expiry and token, but it must not undo that user action.
            const renewalSettingChanged = currentRecord.autoExtend !== scannedRecord?.autoExtend;
            if ((archiveChanged || renewalSettingChanged) && !renewalSucceeded) continue;
            const shouldReactivate =
              renewalSucceeded &&
              currentRecord.accountStatus === 'archived' &&
              currentRecord.autoExtend === true &&
              (currentRecord.archiveReason !== 'manual' ||
                currentRecord.unarchiveAfterRenewal === true) &&
              !archiveChanged;
            if (shouldReactivate) {
              await restoreArchivedEmailsToStored(currentRecord.address);
            }
            if (
              updates.accountStatus === 'archived' &&
              currentRecord.accountStatus !== 'archived' &&
              addressesToArchiveEmails.has(id)
            ) {
              try {
                await clearStoredEmails(currentRecord.address);
              } catch (error) {
                logError('Failed to archive expired inbox mail', error);
              }
            }
            const appliedUpdates = { ...updates };
            if (
              renewalSucceeded &&
              currentRecord.accountStatus === 'archived' &&
              !shouldReactivate
            ) {
              // The renewal may finish after the user disables auto-renew or
              // manually re-archives the inbox. Record the server's new lease,
              // but keep the current archived state and its reason.
              appliedUpdates.accountStatus = 'archived';
            }
            const nextRecord = { ...currentRecord, ...appliedUpdates };
            if (renewalAttempts.has(id)) delete nextRecord.renewalInProgressAt;
            if (shouldReactivate) {
              delete nextRecord.archiveReason;
              delete nextRecord.archivedAt;
              delete nextRecord.unarchiveAfterRenewal;
            } else if (renewalSucceeded && currentRecord.archiveReason === 'manual') {
              delete nextRecord.unarchiveAfterRenewal;
            }
            currentAddresses[idx] = nextRecord;
            changed = true;
          }
        }
        if (changed) {
          // User-settable cap (0 = keep all archived mailboxes). When the cap is
          // exceeded the OLDEST archived records are moved to the recoverable
          // overflow list - never destroyed - so the user can restore/renew an
          // evicted address (it may still be live and receiving mail).
          const maxArchived = await getMaxArchivedAddresses();
          const archived = currentAddresses
            .filter((inb) => inb.accountStatus === 'archived')
            .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
          if (maxArchived > 0 && archived.length > maxArchived) {
            let toRemove = archived.length - maxArchived;
            const overflow = await getArchivedAddressOverflow();
            const overflowIds = new Set(overflow.map((o) => o.id));
            // Evict from the RAW (still-encrypted) inbox list, never the
            // decrypted `currentAddresses`: overflow records must keep their
            // `_enc_:` tokens so credentials never sit in plaintext in
            // storage.local, and survive a vault-locked eviction (where
            // getAddresses() would have blanked them to undefined).
            const rawArchivedById = new Map(
              (await getRawAddresses())
                .filter((record) => record.accountStatus === 'archived')
                .map((record) => [record.id, record])
            );
            for (const archivedRecord of archived) {
              if (toRemove <= 0) break;
              const record = rawArchivedById.get(archivedRecord.id);
              if (!record) continue;
              if (!overflowIds.has(record.id)) {
                overflow.push(record);
                overflowIds.add(record.id);
              }
              // Drop the evicted record from the persisted inbox list too.
              const dropIdx = currentAddresses.findIndex((c) => c.id === record.id);
              if (dropIdx !== -1) currentAddresses.splice(dropIdx, 1);
              toRemove--;
            }
            await setArchivedAddressOverflow(overflow);
          }
          await setAddresses(currentAddresses);
        }
      });
    }
  } catch (error: unknown) {
    logError(
      'Error in inbox expiry check:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  } finally {
    if (renewalAttempts.size > 0) {
      try {
        await withAddressLock(async () => {
          const currentAddresses = await getAddresses();
          let changed = false;
          for (const [id, startedAt] of renewalAttempts) {
            const index = currentAddresses.findIndex((address) => address.id === id);
            if (index < 0 || currentAddresses[index].renewalInProgressAt !== startedAt) continue;
            const address = { ...currentAddresses[index] };
            delete address.renewalInProgressAt;
            currentAddresses[index] = address;
            changed = true;
          }
          if (changed) await setAddresses(currentAddresses);
        });
      } catch (error) {
        logError('Failed to clear renewal progress markers', error);
      }
    }
    perfEnd('bg.checkAddressExpiry', checkStart);
    expiryCheckRunning = false;
    // The check may have renewed an address (moving its expiry), consumed the
    // fired event, or archived one - re-derive the next wake from truth.
    void scheduleNextExpiryAlarm();
  }
}

export function setupAddressExpiryCheck(): void {
  // Retire the legacy periodic alarm from pre-scheduler versions first. Leaving
  // it alive would still wake the worker every minute even though no listener
  // consumes it, defeating the single-deadline scheduler.
  void browser.alarms
    .clear('checkAddressExpiry')
    .catch((error) =>
      logError(
        'Failed to clear legacy expiry alarm:',
        undefined,
        error instanceof Error ? error : new Error(String(error))
      )
    );

  // Event-driven scheduling: a single one-shot alarm at the earliest pending
  // address event replaces the former 1-minute periodic alarm (which woke the
  // service worker 60×/hour regardless of whether anything was pending). The
  // schedule re-derives from storage on every SW start, address write, and
  // post-check state move; the immediate pass below still catches anything
  // that came due while the worker slept.
  void scheduleNextExpiryAlarm();
  registerExpiryAlarmListeners(() => checkAddressExpiry());

  // Immediate pass on SW start (user opened extension / browser woke SW)
  void checkAddressExpiry();

  if (!expiryAlarmListenerRegistered) {
    // Also run expiry when email check wakes the SW (piggyback) - mail fetch
    // already wakes the worker at the user's chosen interval, so expiry work
    // rides along for free.
    browser.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === 'checkEmails') {
        try {
          await checkAddressExpiry();
        } catch {
          /* ignore */
        }
      }
    });
    expiryAlarmListenerRegistered = true;
  }
}
