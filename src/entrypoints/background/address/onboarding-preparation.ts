import { browser } from 'wxt/browser';
import {
  EmailService,
  getAllProviderConfigs,
  loadProviderConfig,
  loadProviderOverridesFromStorage,
} from '@/utils/email/email-service.js';
import { logError, logWarn } from '@/utils/logger.js';
import { withLock } from '@/utils/mutex.js';
import { getEnabledInstances } from '@/utils/provider/instance-manager.js';
import { getAddresses } from '@/utils/storage/storage-keys.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import type { Address } from '@/utils/types.js';
import { adoptPreparedAddress, createAddress } from './address-manager.js';

const KEY = 'onboardingPreparedDrafts';
const LOCK = 'onboarding_preparation_lock';
const ALARM = 'onboarding_preparation_cleanup';
const TTL = 10 * 60_000;
interface Draft {
  owner: string;
  expiresAt: number;
  record: Address;
}
interface Session {
  active: boolean;
  expiresAt: number;
  jobs: Map<string, Promise<Address | undefined>[]>;
}
// Port-owned sessions expire after ten minutes and are removed on disconnect.
const sessions = new Map<string, Session>();

async function readDrafts(): Promise<Draft[]> {
  const stored = await browser.storage.session.get(KEY);
  return Array.isArray(stored[KEY]) ? (stored[KEY] as Draft[]) : [];
}
async function saveDrafts(drafts: Draft[]): Promise<void> {
  await writeWithRetry({ [KEY]: drafts }, { area: browser.storage.session });
}
async function scheduleCleanup(): Promise<void> {
  const deadlines = [...sessions.values()]
    .filter((session) => session.active)
    .map((session) => session.expiresAt);
  if (deadlines.length) await browser.alarms.create(ALARM, { when: Math.min(...deadlines) });
  else await browser.alarms.clear(ALARM);
}
async function forgetDraft(record: Address): Promise<void> {
  const { demoMode } = await browser.storage.local.get('demoMode');
  if (demoMode) return;
  const saved = await getAddresses();
  // Adopted and pre-existing inboxes, including archived ones, are protected.
  if (
    saved.some(
      (item) => item.id === record.id || item.address.toLowerCase() === record.address.toLowerCase()
    )
  )
    return;
  const config = loadProviderConfig(record.provider);
  if (!config.operations?.forgetMe) return;
  try {
    await new EmailService(config, browser).executeOperation('forgetMe', {
      instanceUrl: record.instanceUrl,
      auth: { token: record.sidToken || record.token || '' },
      variables: { email_addr: record.address },
    });
  } catch (error) {
    logWarn('Provider could not discard an unused onboarding inbox', {
      provider: record.provider,
      error: String(error),
    });
  }
}
async function cleanDrafts(): Promise<void> {
  await withLock(LOCK, async () => {
    const drafts = await readDrafts();
    const keep: Draft[] = [];
    for (const draft of drafts) {
      if (sessions.get(draft.owner)?.active && draft.expiresAt > Date.now()) keep.push(draft);
      else await forgetDraft(draft.record);
    }
    await saveDrafts(keep);
  });
  await scheduleCleanup();
}

/** Adopt one chosen-provider draft, or leave normal creation available. */
export async function adoptOnboardingAddress(
  owner: string,
  provider: string
): Promise<Address | null> {
  const session = sessions.get(owner);
  if (!session?.active || session.expiresAt <= Date.now()) return null;
  try {
    const jobs = session.jobs.get(provider) || [];
    await new Promise<void>((resolve, reject) => {
      let remaining = jobs.length;
      if (!remaining) {
        reject(new Error('No prepared inbox'));
        return;
      }
      for (const job of jobs) {
        void job.then(
          (record) => {
            if (record) resolve();
            else if (--remaining === 0) reject(new Error('No prepared inbox'));
          },
          () => {
            if (--remaining === 0) reject(new Error('No prepared inbox'));
          }
        );
      }
    });
  } catch {
    return null; /* All instances failed; use normal creation. */
  }
  return withLock(LOCK, async () => {
    if (!session.active) return null;
    const drafts = await readDrafts();
    const draft = drafts.find(
      (item) =>
        item.owner === owner &&
        item.record.provider === provider &&
        item.expiresAt > Date.now() &&
        (!item.record.expiresAt || item.record.expiresAt > Date.now())
    );
    if (!draft) return null;
    const { demoMode } = await browser.storage.local.get('demoMode');
    if (demoMode || (await getAddresses()).length) return null;
    await adoptPreparedAddress(draft.record);
    try {
      await saveDrafts(drafts.filter((item) => item !== draft));
    } catch (error) {
      logWarn('Adopted inbox is saved; draft metadata cleanup will retry', {
        error: String(error),
      });
    }
    return draft.record;
  });
}

export function setupOnboardingPreparation(): void {
  browser.runtime.onConnect.addListener((port) => {
    if (
      port.name !== 'onboarding-preparation' ||
      port.sender?.id !== browser.runtime.id ||
      !/^(?:chrome-extension|moz-extension|safari-web-extension|extension):\/\//.test(
        port.sender.url || ''
      )
    )
      return;
    const owner = crypto.randomUUID();
    const session: Session = { active: true, expiresAt: Date.now() + TTL, jobs: new Map() };
    sessions.set(owner, session);
    port.onDisconnect.addListener(() => {
      session.active = false;
      sessions.delete(owner);
      void cleanDrafts().catch((error) => logError('Onboarding draft cleanup failed', error));
    });
    void (async () => {
      await cleanDrafts();
      const { demoMode, onboardingComplete } = await browser.storage.local.get([
        'demoMode',
        'onboardingComplete',
      ]);
      if (!session.active || demoMode || onboardingComplete || (await getAddresses()).length)
        return;
      await loadProviderOverridesFromStorage(browser);
      await scheduleCleanup();
      for (const provider of getAllProviderConfigs()) {
        const instances = provider.multiInstance?.enabled
          ? await getEnabledInstances(provider.id)
          : [undefined];
        if (!session.active) break;
        const jobs = instances.map((instance) =>
          (async () => {
            let record: Address | undefined;
            try {
              record = await createAddress(provider.id, instance?.id, undefined, [], {
                cancelled: () => !session.active || session.expiresAt <= Date.now(),
              });
              const prepared = record;
              return await withLock(LOCK, async () => {
                if (
                  !session.active ||
                  session.expiresAt <= Date.now() ||
                  (await getAddresses()).length
                ) {
                  await forgetDraft(prepared);
                  return undefined;
                }
                const drafts = await readDrafts();
                drafts.push({ owner, expiresAt: session.expiresAt, record: prepared });
                await saveDrafts(drafts);
                return prepared;
              });
            } catch (error) {
              if (record) await forgetDraft(record);
              if (session.active)
                logWarn('Onboarding inbox preparation failed', {
                  provider: provider.id,
                  error: String(error),
                });
              return undefined;
            }
          })()
        );
        session.jobs.set(provider.id, jobs);
      }
      if (session.active) port.postMessage({ sessionId: owner });
    })().catch((error) => logError('Could not prepare onboarding inboxes', error));
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM) return;
    for (const [owner, session] of sessions) {
      if (session.expiresAt <= Date.now()) {
        session.active = false;
        sessions.delete(owner);
      }
    }
    void cleanDrafts().catch((error) => logError('Expired onboarding draft cleanup failed', error));
  });
}
