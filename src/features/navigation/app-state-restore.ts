import { type AutofillTab, isView, type View } from '@/features/types/view-types.js';
import { isSettingsSplitView } from '@/ui/views/view-registry.js';
import { isVaultLocked } from '@/utils/storage/vault-lock.js';
import type { Address, Email } from '@/utils/types.js';

export const PENDING_EMAIL_OPEN_TTL_MS = 5 * 60 * 1000;

interface ExpandedAppState {
  currentView?: View;
  settingsSubpage?: string | null;
  previousViewBeforeSubpage?: View | null;
  openMessageInSplit?: boolean;
  mailProviderSplitOpen?: boolean;
  mgmtTab?: string;
  autofillTab?: AutofillTab;
  organizeTab?: 'tags' | 'labels' | 'filters';
  mgmtSearch?: string;
  selectedEmail?: string;
  selectedThread?: Email[];
  currentEmailDetail?: Address | null;
  archivedSearch?: string;
}

export interface AppStateRestoreDeps {
  ext: Browser;
  context: 'popup' | 'sidepanel' | 'app';
  getLayoutSplit: () => boolean;
  getLayoutVerticalSplit: () => boolean;
  getAllAddresses: () => Address[];
  getEmails: () => Email[];
  getCurrentView: () => View;
  setCurrentView: (value: View) => void;
  setSettingsSubpage: (value: string | null) => void;
  setPreviousViewBeforeSubpage: (value: View | null) => void;
  setMgmtTab: (value: string) => void;
  setAutofillTab?: (value: AutofillTab) => void;
  setOrganizeTab?: (value: 'tags' | 'labels' | 'filters') => void;
  setMgmtSearch: (value: string) => void;
  setArchivedSearch: (value: string) => void;
  setSelectedThread: (value: Email[]) => void;
  setCurrentEmailDetail: (value: Address | null) => void;
  setSplitSecondaryView: (value: View | null) => void;
  setMailProviderSplitOpen: (value: boolean) => void;
  setSplitPaneCollapsed: (value: boolean) => void;
  setLoading: (value: boolean) => void;
  selectAddress: (address: string) => Promise<void>;
  checkMessages: (addressId: string) => Promise<void>;
  openMessageDetail: (thread: Email[]) => void;
  evaluateProviderFailoverAfterRefresh: (addressId: string) => Promise<void>;
  tick: () => Promise<void>;
}

export interface AppStateRestoreController {
  restore: (initialEmailHydration: Promise<void>) => Promise<Email[] | null>;
  stop: () => void;
}

export function createAppStateRestoreController(
  deps: AppStateRestoreDeps
): AppStateRestoreController {
  let stopped = false;
  let remapTimer: ReturnType<typeof setTimeout> | undefined;
  const isWide = () => deps.getLayoutSplit() || deps.getLayoutVerticalSplit();
  const remap = (thread: Email[]) => {
    if (stopped) return;
    const fresh = thread
      .map((m) => deps.getEmails().find((e) => e.id === m.id))
      .filter((e): e is Email => !!e);
    deps.setSelectedThread(fresh.length ? fresh : thread);
    deps.setSplitPaneCollapsed(false);
  };

  async function restoreExpanded(): Promise<Email[] | null> {
    if (deps.context !== 'app' || stopped) return null;
    let restoredThread: Email[] | null = null;
    const stateResult = (await deps.ext.storage.local.get(['expandedAppState'])) as {
      expandedAppState?: ExpandedAppState;
    };
    const state = stateResult.expandedAppState;
    if (state) {
      await deps.ext.storage.local.remove(['expandedAppState']);
      const isThread =
        state.openMessageInSplit ||
        state.currentView === 'mailView' ||
        state.currentView === 'mailbox';
      if (isThread && state.selectedThread?.length) restoredThread = state.selectedThread;
      if (state.mgmtTab) deps.setMgmtTab(state.mgmtTab);
      if (
        state.autofillTab === 'profiles' ||
        state.autofillTab === 'credentials' ||
        state.autofillTab === 'sites'
      )
        deps.setAutofillTab?.(state.autofillTab);
      if (
        state.organizeTab === 'tags' ||
        state.organizeTab === 'labels' ||
        state.organizeTab === 'filters'
      )
        deps.setOrganizeTab?.(state.organizeTab);
      if (state.mgmtSearch !== undefined) deps.setMgmtSearch(state.mgmtSearch);
      if (state.archivedSearch !== undefined) deps.setArchivedSearch(state.archivedSearch);
      if (
        state.selectedEmail &&
        deps.getAllAddresses().some((a) => a.address === state.selectedEmail)
      ) {
        await deps.selectAddress(state.selectedEmail);
      }
      if (state.settingsSubpage) {
        deps.setSettingsSubpage(state.settingsSubpage);
        deps.setPreviousViewBeforeSubpage(state.previousViewBeforeSubpage ?? null);
      }
      if (restoredThread) {
        deps.setCurrentView(isWide() ? 'mailbox' : 'mailView');
        deps.setSelectedThread(restoredThread);
        deps.setSplitPaneCollapsed(false);
        void deps.tick().then(() => remap(restoredThread as Email[]));
        remapTimer = setTimeout(() => {
          remapTimer = undefined;
          remap(restoredThread as Email[]);
        }, 600);
      } else if (state.currentView === 'addressView' && state.currentEmailDetail) {
        deps.setCurrentEmailDetail(state.currentEmailDetail);
        deps.setCurrentView(isWide() ? 'addresses' : 'addressView');
      } else if (typeof state.currentView === 'string' && isView(state.currentView)) {
        if (isWide() && isSettingsSplitView(state.currentView)) {
          deps.setSplitSecondaryView(state.currentView);
          deps.setCurrentView('settings');
        } else deps.setCurrentView(state.currentView);
      }
      if (state.mailProviderSplitOpen && isWide()) {
        const view = deps.getCurrentView();
        if (view === 'mailbox' || view === 'settings' || view === 'addresses')
          deps.setMailProviderSplitOpen(true);
      }
      if (
        restoredThread?.length ||
        (typeof state.currentView === 'string' &&
          isView(state.currentView) &&
          isWide() &&
          (isSettingsSplitView(state.currentView) || state.mailProviderSplitOpen))
      )
        deps.setSplitPaneCollapsed(false);
    }
    const expandedEmail = (await deps.ext.storage.local.get([
      'expandedEmailId',
      'expandedInboxAddress',
      'expandedInboxId',
      'expandedMessage',
    ])) as {
      expandedEmailId?: string;
      expandedInboxAddress?: string;
      expandedInboxId?: string;
      expandedMessage?: Email;
    };
    if (expandedEmail.expandedMessage || expandedEmail.expandedEmailId) {
      await deps.ext.storage.local.remove([
        'expandedEmailId',
        'expandedInboxAddress',
        'expandedInboxId',
        'expandedMessage',
      ]);
      const address = deps
        .getAllAddresses()
        .find(
          (a) =>
            a.id === expandedEmail.expandedInboxId ||
            a.address === expandedEmail.expandedInboxAddress
        );
      if (address) await deps.selectAddress(address.address);
      const email =
        expandedEmail.expandedMessage ||
        deps.getEmails().find((e) => e.id === expandedEmail.expandedEmailId);
      if (email && !stopped) deps.openMessageDetail([email]);
    }
    return restoredThread;
  }

  async function handlePending(restoredThread: Email[] | null, hydration: Promise<void>) {
    const pending = (await deps.ext.storage.local.get(['pendingEmailOpen'])) as {
      pendingEmailOpen?: { emailId: string; addressId: string; expiresAt?: number };
    };
    if (stopped) return;
    if (pending.pendingEmailOpen) {
      const pendingRequest = pending.pendingEmailOpen;
      if (
        typeof pendingRequest.emailId !== 'string' ||
        typeof pendingRequest.addressId !== 'string' ||
        typeof pendingRequest.expiresAt !== 'number' ||
        !Number.isFinite(pendingRequest.expiresAt) ||
        pendingRequest.expiresAt <= Date.now() ||
        pendingRequest.expiresAt > Date.now() + PENDING_EMAIL_OPEN_TTL_MS
      ) {
        await deps.ext.storage.local.remove(['pendingEmailOpen']);
        return;
      }
      if (await isVaultLocked()) {
        await deps.ext.storage.local.remove(['pendingEmailOpen']);
        return;
      }
      // Wait for address hydration before deciding that the one-shot target is
      // missing. Otherwise a slow restore can either lose the request or leave
      // it pending forever after the authoritative address list is available.
      await hydration;
      if (stopped) return;
      // Hydration can outlast the pending-open TTL, so recheck immediately
      // before consuming the request and switching mailboxes.
      if (pendingRequest.expiresAt <= Date.now() || (await isVaultLocked())) {
        await deps.ext.storage.local.remove(['pendingEmailOpen']);
        return;
      }
      const address = deps.getAllAddresses().find((a) => a.id === pendingRequest.addressId);
      if (!address) {
        await deps.ext.storage.local.remove(['pendingEmailOpen']);
        return;
      }
      await deps.ext.storage.local.remove(['pendingEmailOpen']);
      await deps.selectAddress(address.address);
      deps.setLoading(true);
      try {
        await deps.checkMessages(address.id);
      } finally {
        deps.setLoading(false);
      }
      if (!stopped) {
        const email = deps.getEmails().find((e) => e.id === pendingRequest.emailId);
        if (email) deps.openMessageDetail([email]);
      }
      return;
    }
    const active = (await deps.ext.storage.local.get(['activeAddressId'])) as {
      activeAddressId?: string;
    };
    if (!active.activeAddressId) return;
    await hydration;
    if (stopped) return;
    void deps
      .checkMessages(active.activeAddressId)
      .then(() => {
        if (stopped) return;
        if (restoredThread?.length) {
          remap(restoredThread);
          const view = deps.getCurrentView();
          if (view === 'mailbox' || view === 'mailView')
            deps.setCurrentView(isWide() ? 'mailbox' : 'mailView');
        }
        void deps
          .evaluateProviderFailoverAfterRefresh(active.activeAddressId as string)
          .catch(() => {
            /* failover evaluation is advisory */
          });
      })
      .catch(() => {
        // The refresh owns its user-facing error handling; restoration should
        // not create an unhandled rejection or leave its saved state unusable.
      });
  }

  return {
    restore: async (hydration) => {
      const thread = await restoreExpanded();
      await handlePending(thread, hydration);
      return thread;
    },
    stop: () => {
      stopped = true;
      if (remapTimer) {
        clearTimeout(remapTimer);
        remapTimer = undefined;
      }
    },
  };
}
