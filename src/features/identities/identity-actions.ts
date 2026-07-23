import type { Browser } from 'wxt/browser';
import { generateDefaultAvatarDataUrl } from '@/utils/default-avatar.js';
import { generateLocalProfileExtras } from '@/utils/locale-profile.js';
import { logError } from '@/utils/logger.js';
import { withLock } from '@/utils/mutex.js';
import type { Identity } from '@/utils/types.js';

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
    useRandomPassword: true,
    pin: extras.pin,
    country: extras.country,
    city: extras.city,
    dateOfBirth: extras.dateOfBirth,
    // Fake profile picture so form file inputs can be filled immediately
    profilePicture: generateDefaultAvatarDataUrl('Default Identity', firstPick[0]),
    isDefault: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    userAgent: null,
  };
}

export async function loadIdentities(ext: Browser, setters: IdentitySetters): Promise<void> {
  try {
    const { identities = [] } = (await ext.storage.local.get(['identities'])) as {
      identities?: Identity[];
    };

    // Create default identity if none exist
    if (identities.length === 0) {
      const defaultIdentity = createDefaultIdentity();
      identities.push(defaultIdentity);
      await ext.storage.local.set({ identities });
    } else {
      // Enrich bare default identity once (country/DOB/ZIP/city/avatar) without network
      const def = identities.find((i) => i.isDefault) || identities[0];
      if (
        def &&
        (!def.country || !def.dateOfBirth || !def.pin || !def.city || !def.profilePicture)
      ) {
        const extras = generateLocalProfileExtras();
        const idx = identities.findIndex((i) => i.id === def.id);
        if (idx >= 0) {
          const firstLetter = (def.firstNames || def.name || 'D').trim()[0] || 'D';
          identities[idx] = {
            ...def,
            country: def.country || extras.country,
            dateOfBirth: def.dateOfBirth || extras.dateOfBirth,
            pin: def.pin || extras.pin,
            city: def.city || extras.city,
            profilePicture:
              def.profilePicture || generateDefaultAvatarDataUrl(def.name || def.id, firstLetter),
            updatedAt: Date.now(),
          };
          await ext.storage.local.set({ identities });
        }
      }
    }

    setters.setIdentities(identities);

    // Set selected identity
    const { selectedIdentityId } = (await ext.storage.local.get(['selectedIdentityId'])) as {
      selectedIdentityId?: string;
    };
    if (selectedIdentityId) {
      setters.setSelectedIdentityId(selectedIdentityId);
    } else if (identities.length > 0) {
      const defaultIdentity = identities.find((i) => i.isDefault) || identities[0];
      setters.setSelectedIdentityId(defaultIdentity.id);
      await ext.storage.local.set({ selectedIdentityId: defaultIdentity.id });
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
): Promise<void> {
  try {
    await withLock('identities_lock', async () => {
      const { identities = [] } = (await ext.storage.local.get(['identities'])) as {
        identities?: Identity[];
      };

      const index = identities.findIndex((i) => i.id === identity.id);
      if (index >= 0) {
        identities[index] = identity;
      } else {
        identities.push(identity);
      }

      await ext.storage.local.set({ identities });
      setters.setIdentities(identities);
    });
  } catch (error: unknown) {
    logError(
      'Failed to save identity:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

export async function deleteIdentity(
  ext: Browser,
  identityId: string,
  setters: IdentitySetters
): Promise<void> {
  try {
    await withLock('identities_lock', async () => {
      const { identities = [] } = (await ext.storage.local.get(['identities'])) as {
        identities?: Identity[];
      };

      const filtered = identities.filter((i) => i.id !== identityId);

      // Ensure at least one identity exists
      if (filtered.length === 0) {
        const defaultIdentity = createDefaultIdentity();
        filtered.push(defaultIdentity);
      }

      await ext.storage.local.set({ identities: filtered });
      setters.setIdentities(filtered);

      // Update selected identity if needed
      const { selectedIdentityId } = (await ext.storage.local.get(['selectedIdentityId'])) as {
        selectedIdentityId?: string;
      };
      if (selectedIdentityId === identityId) {
        const newSelected = filtered[0];
        setters.setSelectedIdentityId(newSelected.id);
        await ext.storage.local.set({ selectedIdentityId: newSelected.id });
      }
    });
  } catch (error: unknown) {
    logError(
      'Failed to delete identity:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

export async function selectIdentity(
  ext: Browser,
  identityId: string,
  setters: IdentitySetters
): Promise<void> {
  try {
    await ext.storage.local.set({ selectedIdentityId: identityId });
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
  fromIndex: number,
  toIndex: number
): Promise<void> {
  if (fromIndex === toIndex) return;
  try {
    await withLock('identities_lock', async () => {
      const { identities = [] } = (await ext.storage.local.get(['identities'])) as {
        identities?: Identity[];
      };
      if (fromIndex < 0 || fromIndex >= identities.length) return;
      if (toIndex < 0 || toIndex >= identities.length) return;

      const next = [...identities];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return;
      next.splice(toIndex, 0, moved);

      await ext.storage.local.set({ identities: next });
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
    const { identities = [], selectedIdentityId } = (await ext.storage.local.get([
      'identities',
      'selectedIdentityId',
    ])) as { identities?: Identity[]; selectedIdentityId?: string };

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
