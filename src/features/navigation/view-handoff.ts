import { replaceCurrentLocation } from '@/features/navigation/url-utils.js';
import { isView, type View } from '@/features/types/view-types.js';
import type { Address } from '@/utils/types.js';

/**
 * Storage keys making up an open-view / identity handoff payload.
 * Includes openViewAt - the payload timestamp marker every writer mirrors
 * into BOTH areas alongside openView - so a session consume purges it with
 * the payload (write-once, read-once).
 */
const HANDOFF_KEYS = [
  'openView',
  'openIdentityCreate',
  'openIdentityEditId',
  'autofillTab',
  'openExtensionTarget',
  'openViewAt',
] as const;
const HANDOFF_TTL_MS = 2 * 60 * 1000;

function isFreshStoredHandoff(timestamp: unknown): boolean {
  return (
    typeof timestamp === 'number' &&
    Number.isFinite(timestamp) &&
    timestamp <= Date.now() &&
    Date.now() - timestamp <= HANDOFF_TTL_MS
  );
}

type StoredHandoff = {
  openView?: string;
  openIdentityCreate?: boolean;
  openIdentityEditId?: string;
  openExtensionTarget?: string;
  [key: string]: unknown;
};

/** Clear an older stored route when an explicit live navigation supersedes it. */
async function clearSupersededHandoffs(deps: ViewHandoffDeps): Promise<void> {
  for (const area of [deps.ext.storage.session, deps.ext.storage.local]) {
    try {
      const stored = (await area.get([...HANDOFF_KEYS])) as StoredHandoff;
      const hasRoute = !!(
        stored.openView ||
        stored.openIdentityCreate ||
        stored.openIdentityEditId
      );
      if (!hasRoute || (stored.openExtensionTarget === 'popup' && deps.context !== 'popup')) {
        continue;
      }
      const keys = HANDOFF_KEYS.filter((key) => stored[key] !== undefined);
      if (keys.length > 0) await area.remove(keys);
    } catch {
      // A forced navigation remains usable if storage is unavailable.
    }
  }
}

export interface ViewHandoffDeps {
  ext: Browser;
  context: string;
  /** Mutation callbacks for reactive state */
  setCurrentView: (v: View) => void;
  setAutofillTabValue: (v: 'profiles' | 'credentials' | 'sites') => void;
  incrementAutofillTabSignal: () => void;
  incrementIdentityCreateSignal: () => void;
  setIdentityEditIdSignal: (v: string) => void;
  setSelectedEmail: (v: string) => void;
  setDisplayedEmail: (v: string) => void;
  tick: () => Promise<void>;
}

export async function applyOpenViewHandoff(
  deps: ViewHandoffDeps,
  forced?: {
    openView?: string;
    openIdentityCreate?: boolean;
    openIdentityEditId?: string;
    autofillTab?: string;
  }
): Promise<void> {
  let openView = forced?.openView || '';
  let openIdentityCreate = !!forced?.openIdentityCreate;
  let openIdentityEditId = forced?.openIdentityEditId || '';
  let handoffAutofillTab = forced?.autofillTab || '';
  let explicitHandoff = !!(openView || openIdentityCreate || openIdentityEditId);

  // Cold-start: app.html?view=autofill&identityCreate=1&identityEdit=id&tab=profiles
  if (!openView && !openIdentityCreate && !openIdentityEditId) {
    try {
      const u = new URL(typeof location !== 'undefined' ? location.href : '');
      openView = u.searchParams.get('view') || '';
      handoffAutofillTab = u.searchParams.get('tab') || handoffAutofillTab;
      if (u.searchParams.get('identityCreate') === '1') {
        openIdentityCreate = true;
        openView = openView || 'autofill';
      }
      const edit = u.searchParams.get('identityEdit') || '';
      if (edit) {
        openIdentityEditId = edit;
        openView = openView || 'autofill';
      }
      explicitHandoff = !!(openView || openIdentityCreate || openIdentityEditId);
      // Strip handoff params so refresh does not re-open dialogs
      if (openView || openIdentityCreate || openIdentityEditId) {
        for (const k of ['view', 'tab', 'identityCreate', 'identityEdit', 'reason']) {
          u.searchParams.delete(k);
        }
        replaceCurrentLocation(u);
      }
    } catch {
      /* ignore URL parse */
    }
  }

  if (
    explicitHandoff &&
    (openIdentityCreate ||
      openIdentityEditId ||
      openView === 'activity' ||
      openView === 'loginInfo' ||
      isView(openView))
  ) {
    // The explicit URL/message target wins over an older pending payload. Drop
    // that superseded payload from both storage areas so it cannot replay on a
    // later open, while preserving popup-only handoffs in app/sidepanel.
    await clearSupersededHandoffs(deps);
  }

  if (!openView && !openIdentityCreate && !openIdentityEditId) {
    try {
      const s = (await deps.ext.storage.session.get([
        'openView',
        'openIdentityCreate',
        'openIdentityEditId',
        'autofillTab',
        'openExtensionTarget',
        'openViewAt',
      ])) as {
        openView?: string;
        openIdentityCreate?: boolean;
        openIdentityEditId?: string;
        autofillTab?: string;
        openExtensionTarget?: string;
        openViewAt?: number;
      };
      // Popup-only identity handoffs must not be consumed by an already-open
      // app or sidepanel instance. Leave the payload for the popup to read.
      if (s.openExtensionTarget !== 'popup' || deps.context === 'popup') {
        const hasRoute = !!(s.openView || s.openIdentityCreate || s.openIdentityEditId);
        if (hasRoute && !isFreshStoredHandoff(s.openViewAt)) {
          await deps.ext.storage.session.remove(HANDOFF_KEYS.filter((key) => s[key] !== undefined));
          const staleMirroredKeys = HANDOFF_KEYS.filter((key) => s[key] !== undefined);
          if (staleMirroredKeys.length > 0) await deps.ext.storage.local.remove(staleMirroredKeys);
        } else {
          openView = s.openView || '';
          openIdentityCreate = !!s.openIdentityCreate;
          openIdentityEditId = s.openIdentityEditId || '';
          handoffAutofillTab = s.autofillTab || handoffAutofillTab;
        }
        if (openView || openIdentityCreate || openIdentityEditId) {
          await deps.ext.storage.session.remove([
            'openView',
            'openIdentityCreate',
            'openIdentityEditId',
            'autofillTab',
            'openExtensionTarget',
            'openViewAt',
          ]);
          // Mirror cleanup, key-scoped: openExtensionUiInternal mirrors the
          // payload into local ONLY when session storage is unavailable, and a
          // leftover copy would replay this handoff through the local fallback
          // on the next open. But other writers (omnibox/context-menu via
          // openExtensionView) mirror ONLY openView into session while
          // pre-setting autofillTab etc. local-only - so purge local keys
          // exclusively for those present in the consumed session payload.
          const mirroredKeys = HANDOFF_KEYS.filter((k) => s[k] !== undefined);
          if (mirroredKeys.length > 0) {
            await deps.ext.storage.local.remove(mirroredKeys);
          }
        }
      }
    } catch {
      /* session may fail */
    }
  }
  if (!openView && !openIdentityCreate && !openIdentityEditId) {
    const s = (await deps.ext.storage.local.get([
      'openView',
      'openIdentityCreate',
      'openIdentityEditId',
      'autofillTab',
      'openExtensionTarget',
      'openViewAt',
    ])) as {
      openView?: string;
      openIdentityCreate?: boolean;
      openIdentityEditId?: string;
      autofillTab?: string;
      openExtensionTarget?: string;
      openViewAt?: number;
    };
    // Keep popup-targeted identity payloads away from app/sidepanel views.
    if (s.openExtensionTarget !== 'popup' || deps.context === 'popup') {
      const hasRoute = !!(s.openView || s.openIdentityCreate || s.openIdentityEditId);
      if (hasRoute && !isFreshStoredHandoff(s.openViewAt)) {
        await deps.ext.storage.local.remove(HANDOFF_KEYS.filter((key) => s[key] !== undefined));
      } else {
        openView = s.openView || '';
        openIdentityCreate = !!s.openIdentityCreate;
        openIdentityEditId = s.openIdentityEditId || '';
        handoffAutofillTab = s.autofillTab || handoffAutofillTab;
      }
      if (openView || openIdentityCreate || openIdentityEditId) {
        await deps.ext.storage.local.remove([
          'openView',
          'openIdentityCreate',
          'openIdentityEditId',
          'autofillTab',
          'openExtensionTarget',
          'openViewAt',
        ]);
      }
    }
  }
  if (!openView && !openIdentityCreate && !openIdentityEditId) return;

  // Legacy alias + validation. An unknown view id (stale storage payload,
  // garbage URL param) must not reach `setCurrentView` - AppShell's `{:else}`
  // fallback renders main-pane content only for `mailbox`, so anything else
  // unknown blanks the app. 'activity' predates the canonical 'analytics' id.
  if (openView === 'activity') openView = 'analytics';
  if (openView && !isView(openView)) return;

  if (
    openView === 'identities' ||
    openView === 'autofill' ||
    openIdentityCreate ||
    openIdentityEditId
  ) {
    // Prefer profiles tab for identity create/edit handoff
    let tabPref = handoffAutofillTab || 'profiles';
    try {
      if (!openIdentityCreate && !openIdentityEditId && !handoffAutofillTab) {
        const t = (await deps.ext.storage.local.get(['autofillTab'])) as {
          autofillTab?: string;
        };
        tabPref = t.autofillTab || tabPref;
      }
      await deps.ext.storage.local.remove(['autofillTab']);
    } catch {
      /* ignore */
    }
    if (
      !openIdentityCreate &&
      !openIdentityEditId &&
      openView !== 'loginInfo' &&
      tabPref === 'sites'
    ) {
      deps.setAutofillTabValue('sites');
    } else if (
      !openIdentityCreate &&
      !openIdentityEditId &&
      (openView === 'loginInfo' || tabPref === 'credentials')
    ) {
      deps.setAutofillTabValue('credentials');
    } else {
      deps.setAutofillTabValue('profiles');
    }
    deps.setCurrentView('autofill');
    deps.incrementAutofillTabSignal();
    // Bump after view switch so IdentitiesView mounts then sees the signal
    await deps.tick();
    await deps.tick();
    if (openIdentityCreate) deps.incrementIdentityCreateSignal();
    if (openIdentityEditId) {
      // Clear then set so re-editing the same id always fires IdentitiesView effect
      deps.setIdentityEditIdSignal('');
      await deps.tick();
      deps.setIdentityEditIdSignal(openIdentityEditId);
    }
  } else if (openView === 'loginInfo') {
    deps.setCurrentView('autofill');
    deps.setAutofillTabValue('credentials');
    deps.incrementAutofillTabSignal();
  } else if (isView(openView)) {
    // Validated (and the legacy 'activity' alias normalized) above - from here the
    // handoff target IS a catalog view, which is what `setCurrentView` accepts.
    // Re-checking narrows the string for the compiler; an empty `openView` cannot
    // reach this branch (the identity handoff took the branch above).
    deps.setCurrentView(openView);
  }

  // Sync selected mailbox from activeAddressId (context menu create / address pick)
  try {
    const { activeAddressId, addresses = [] } = (await deps.ext.storage.local.get([
      'activeAddressId',
      'addresses',
    ])) as { activeAddressId?: string; addresses?: Address[] };
    if (activeAddressId) {
      const acct = addresses.find((a: Address) => a.id === activeAddressId);
      if (acct?.address) {
        deps.setSelectedEmail(acct.address);
        deps.setDisplayedEmail(acct.address);
      }
    }
  } catch {
    /* ignore */
  }
}
