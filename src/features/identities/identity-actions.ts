import { moveItemBefore } from '@/utils/array-utils.js';
import { t } from '@/utils/i18n/i18n-utils.js';
import { generateLocalProfileExtras } from '@/utils/i18n/locale-profile.js';
import { logError } from '@/utils/logger.js';
import { withLock } from '@/utils/mutex.js';
import { PREFERRED_EMAIL_RANDOM_ACTIVE } from '@/utils/provider/blocked-temp-mail-sites.js';
import { randomIntBetween, randomItem } from '@/utils/security/secure-random.js';
import { updateStoredObject } from '@/utils/storage/rmw.js';
import { filterPersistedIdentities, isPersistedIdentity } from '@/utils/storage/storage-keys.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { generateDefaultAvatarDataUrl } from '@/utils/theme/default-avatar.js';
import type { Identity } from '@/utils/types.js';

/** Built-in default usernames (augmented with random digits at creation). */
export function generateDefaultUsername(firstName?: string): string {
  const base =
    (firstName || randomItem(['alex', 'sam', 'jordan', 'casey', 'riley', 'morgan']) || 'user')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 10) || 'user';
  return `${base}${randomIntBetween(1000, 9999)}`;
}

export interface IdentityState {
  identities: Identity[];
  selectedIdentityId: string | null;
}

export interface IdentitySetters {
  setIdentities: (identities: Identity[]) => void;
  setSelectedIdentityId: (id: string | null) => void;
}

const DEFAULT_FIRST_NAMES = [
  'James',
  'John',
  'Robert',
  'Michael',
  'William',
  'David',
  'Richard',
  'Joseph',
  'Thomas',
  'Charles',
  'Mary',
  'Patricia',
  'Jennifer',
  'Linda',
  'Elizabeth',
  'Barbara',
  'Susan',
  'Jessica',
  'Sarah',
  'Karen',
];

const DEFAULT_LAST_NAMES = [
  'Smith',
  'Johnson',
  'Williams',
  'Brown',
  'Jones',
  'Garcia',
  'Miller',
  'Davis',
  'Rodriguez',
  'Martinez',
  'Anderson',
  'Taylor',
  'Thomas',
  'Moore',
  'Jackson',
  'Martin',
  'Lee',
  'Thompson',
  'White',
  'Harris',
];

export function createDefaultIdentity(): Identity {
  const firstNames = DEFAULT_FIRST_NAMES.join(', ');
  const lastNames = DEFAULT_LAST_NAMES.join(', ');
  // Country / DOB / ZIP / city - local-only detection + random samples (no network)
  const extras = generateLocalProfileExtras();

  const firstPick = DEFAULT_FIRST_NAMES[0] || 'D';
  return {
    id: `default_${Date.now()}`,
    name: 'Default Identity',
    firstNames,
    lastNames,
    username: generateDefaultUsername(firstPick),
    useRandomPassword: true,
    pin: extras.pin,
    country: extras.country,
    city: extras.city,
    dateOfBirth: extras.dateOfBirth,
    // Built-in default follows the mailbox the user currently selected.
    // A user-created identity can still explicitly choose the random-active option.
    preferredEmail: '',
    // Fake profile picture so form file inputs can be filled immediately
    profilePicture: generateDefaultAvatarDataUrl('Default Identity', firstPick[0]),
    isDefault: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    userAgent: null,
  };
}

/**
 * Does the list's default identity still lack generated profile extras
 * (country / DOB / PIN / city / username / avatar), or carry the retired
 * random-active sentinel as its preferred mailbox?
 *
 * Pure: the same question is asked of the list just read (to decide whether a
 * write is needed at all) and of the list storage holds when that write runs.
 */
function needsDefaultEnrichment(list: Identity[]): boolean {
  const def = list.find((i) => i.isDefault) || list[0];
  if (!def) return false;
  return (
    !def.country ||
    !def.dateOfBirth ||
    !def.pin ||
    !def.city ||
    !def.profilePicture ||
    !def.username ||
    def.preferredEmail === undefined ||
    // Older generated defaults used the random-active sentinel. Migrate
    // that built-in default back to current-active behavior.
    (def.isDefault && def.preferredEmail === PREFERRED_EMAIL_RANDOM_ACTIVE)
  );
}

/**
 * Enrich the default identity in place and return the same list.
 *
 * A no-op when the record no longer needs it (another surface enriched it
 * after this load's read), so the write that follows cannot undo that work.
 */
function enrichDefaultIdentity(list: Identity[]): Identity[] {
  const def = list.find((i) => i.isDefault) || list[0];
  if (!def || !needsDefaultEnrichment(list)) return list;
  const extras = generateLocalProfileExtras();
  const idx = list.findIndex((i) => i.id === def.id);
  if (idx >= 0) {
    const firstLetter = (def.firstNames || def.name || 'D').trim()[0] || 'D';
    const firstName = (def.firstNames || 'user').split(',')[0]?.trim() || 'user';
    list[idx] = {
      ...def,
      country: def.country || extras.country,
      dateOfBirth: def.dateOfBirth || extras.dateOfBirth,
      pin: def.pin || extras.pin,
      city: def.city || extras.city,
      username: def.username || generateDefaultUsername(firstName),
      // Built-in default with no explicit preference follows the current
      // active mailbox. Preserve explicit choices for user identities.
      preferredEmail:
        def.preferredEmail === undefined ||
        (def.isDefault && def.preferredEmail === PREFERRED_EMAIL_RANDOM_ACTIVE)
          ? ''
          : def.preferredEmail,
      profilePicture:
        def.profilePicture || generateDefaultAvatarDataUrl(def.name || def.id, firstLetter),
      updatedAt: Date.now(),
    };
  }
  return list;
}

export async function loadIdentities(ext: Browser, setters: IdentitySetters): Promise<void> {
  try {
    const stored = await ext.storage.local.get(['identities']);
    let identities = filterPersistedIdentities(stored.identities);

    // Create the built-in default identity only on first run (storage key
    // absent - e.g. during onboarding). When the user has explicitly deleted
    // every identity (key present as []), keep the empty state instead of
    // silently creating a replacement.
    //
    // Both corrections below write the WHOLE list, and a popup / sidepanel / app
    // tab can mount at the same time as another one creates an identity - so
    // each runs as a serialized read-modify-write against the list storage holds
    // when it runs, and the updater re-checks its own condition there (an
    // identity another surface just created is never overwritten or duplicated).
    if (stored.identities === undefined && identities.length === 0) {
      identities = await updateStoredObject(
        'identities',
        (current) => (current.length > 0 ? current : [createDefaultIdentity()]),
        filterPersistedIdentities
      );
    } else if (needsDefaultEnrichment(identities)) {
      identities = await updateStoredObject(
        'identities',
        enrichDefaultIdentity,
        filterPersistedIdentities
      );
    }

    setters.setIdentities(identities);

    // Set selected identity only when it points to a validated record. A stale
    // or malformed pointer must not drive autofill against an undefined profile.
    const selectedValue = await ext.storage.local.get(['selectedIdentityId']);
    const selectedIdentityId =
      typeof selectedValue.selectedIdentityId === 'string'
        ? selectedValue.selectedIdentityId
        : undefined;
    if (selectedIdentityId && identities.some((identity) => identity.id === selectedIdentityId)) {
      setters.setSelectedIdentityId(selectedIdentityId);
    } else if (identities.length > 0) {
      const defaultIdentity = identities.find((i) => i.isDefault) || identities[0];
      setters.setSelectedIdentityId(defaultIdentity.id);
      await writeWithRetry({ selectedIdentityId: defaultIdentity.id });
    } else {
      setters.setSelectedIdentityId(null);
      if (selectedIdentityId !== undefined) {
        await writeWithRetry({ selectedIdentityId: null });
      }
    }
  } catch (error: unknown) {
    logError(
      'Failed to load identities:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

export async function saveIdentity(
  ext: Browser,
  identity: Identity,
  setters: IdentitySetters
): Promise<boolean> {
  try {
    await withLock('identities_lock', async () => {
      const stored = await ext.storage.local.get(['identities']);
      const identities = filterPersistedIdentities(stored.identities);
      if (!isPersistedIdentity(identity)) {
        throw new Error(await t('errors.malformedIdentityRecord'));
      }

      const index = identities.findIndex((i) => i.id === identity.id);
      if (index >= 0) {
        identities[index] = identity;
      } else {
        identities.push(identity);
      }

      await writeWithRetry({ identities });
      setters.setIdentities(identities);
    });
    return true;
  } catch (error: unknown) {
    logError(
      'Failed to save identity:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
    return false;
  }
}

export async function deleteIdentities(
  ext: Browser,
  identityIds: Iterable<string>,
  setters: IdentitySetters
): Promise<boolean> {
  try {
    await withLock('identities_lock', async () => {
      const ids = new Set([...identityIds].filter(Boolean));
      const stored = await ext.storage.local.get(['identities']);
      const identities = filterPersistedIdentities(stored.identities);
      const filtered = identities.filter((identity) => !ids.has(identity.id));

      // Intentionally allow deleting the last identity - the view shows an
      // empty state instead of silently creating a replacement.
      await writeWithRetry({ identities: filtered });
      setters.setIdentities(filtered);

      // Reconcile the selected identity once after the whole batch is removed.
      const { selectedIdentityId } = (await ext.storage.local.get(['selectedIdentityId'])) as {
        selectedIdentityId?: string | null;
      };
      if (selectedIdentityId && ids.has(selectedIdentityId)) {
        const nextSelectedId = filtered[0]?.id ?? null;
        setters.setSelectedIdentityId(nextSelectedId);
        await writeWithRetry({ selectedIdentityId: nextSelectedId });
      }

      // Drop the deleted identities out of the intelligence stores so they
      // stop steering routing and stop occupying cap slots: the sticky map
      // and site-profile `lastIdentityId` would otherwise persist forever
      // (consumers re-validate against the live list, so this is tombstone
      // hygiene rather than a correctness fix). Best-effort: a purge failure
      // must never fail the delete itself.
      try {
        const { forgetIdentitiesFromIntelligence } = await import(
          '@/features/intelligence/storage.js'
        );
        await forgetIdentitiesFromIntelligence([...ids]);
      } catch (intelligenceError) {
        logError(
          'Failed to forget deleted identities from intelligence stores',
          undefined,
          intelligenceError instanceof Error
            ? intelligenceError
            : new Error(String(intelligenceError))
        );
      }
    });
    return true;
  } catch (error: unknown) {
    logError(
      'Failed to delete identities:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
    return false;
  }
}

export async function deleteIdentity(
  ext: Browser,
  identityId: string,
  setters: IdentitySetters
): Promise<boolean> {
  return deleteIdentities(ext, [identityId], setters);
}

export async function selectIdentity(
  _ext: Browser,
  identityId: string,
  setters: IdentitySetters
): Promise<void> {
  try {
    await writeWithRetry({ selectedIdentityId: identityId });
    setters.setSelectedIdentityId(identityId);
  } catch (error: unknown) {
    logError(
      'Failed to select identity:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

export async function reorderIdentities(
  ext: Browser,
  setters: IdentitySetters,
  sourceId: string,
  targetId: string
): Promise<void> {
  if (sourceId === targetId) return;
  try {
    await withLock('identities_lock', async () => {
      const stored = await ext.storage.local.get(['identities']);
      const identities = filterPersistedIdentities(stored.identities);
      // Resolve stable ids under the lock: another surface can reorder or
      // delete records between the key press and this storage read.
      const fromIndex = identities.findIndex((identity) => identity.id === sourceId);
      const toIndex = identities.findIndex((identity) => identity.id === targetId);
      if (fromIndex < 0 || fromIndex >= identities.length) return;
      if (toIndex < 0 || toIndex >= identities.length) return;

      const next = moveItemBefore(identities, fromIndex, toIndex);
      if (!next) return;

      await writeWithRetry({ identities: next });
      setters.setIdentities(next);
    });
  } catch (error: unknown) {
    logError(
      'Failed to reorder identities:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

export async function getSelectedIdentity(ext: Browser): Promise<Identity | null> {
  try {
    const stored = await ext.storage.local.get(['identities', 'selectedIdentityId']);
    const identities = filterPersistedIdentities(stored.identities);
    const selectedIdentityId =
      typeof stored.selectedIdentityId === 'string' ? stored.selectedIdentityId : undefined;

    if (!selectedIdentityId || identities.length === 0) {
      return null;
    }

    return identities.find((i) => i.id === selectedIdentityId) || null;
  } catch (error: unknown) {
    logError(
      'Failed to get selected identity:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
    return null;
  }
}
