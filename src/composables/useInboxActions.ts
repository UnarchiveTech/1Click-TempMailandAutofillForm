import type { Browser } from 'wxt/browser';
import type { ToastType } from '@/components/feedback/Toast.svelte';
import type { InboxSetters } from '@/features/inbox/inbox-actions.js';
import {
  checkMessages as checkMessagesAction,
  copyEmail as copyEmailAction,
  copyOtp as copyOtpAction,
  loadInboxes as loadInboxesAction,
  refreshInbox as refreshInboxAction,
  selectAccount as selectAccountAction,
  toggleNotifications as toggleNotificationsAction,
} from '@/features/inbox/inbox-actions.js';
import type { Account } from '@/utils/types.js';

/**
 * Configuration options for component-specific behavior
 */
export interface InboxActionsConfig {
  /** Callback after account selection (e.g., to close dropdown) */
  onSelectAccount?: () => void;
  /** Custom logic for determining active inbox ID */
  getActiveInboxId?: (selectedEmail: string, accounts: Account[]) => string | undefined;
}

/**
 * Reactive state references using Svelte 5 runes
 * Using getters to ensure we always access current reactive values
 */
export interface InboxActionsState {
  /** Extension context */
  readonly ext: Browser;
  /** Inbox setters object */
  readonly inboxSetters: InboxSetters;
  /** Search query (reactive) */
  get searchQuery(): string;
  /** OTP-only filter (reactive) */
  get otpOnly(): boolean;
  /** Notifications enabled (reactive) */
  get notificationsEnabled(): boolean;
  /** Selected email address (reactive) */
  get selectedEmail(): string;
  /** Latest OTP (reactive) */
  get latestOtp(): string;
  /** Toast notification function */
  readonly showToast: (message: string, type?: ToastType) => void;
  /** Selected addresses set (reactive) */
  get selectedAddresses(): Set<string>;
  /** Accounts array (reactive) */
  get accounts(): Account[];
  /** All inboxes array (reactive) */
  get allInboxes(): Account[];
  /** Management accounts array (reactive) */
  get mgmtAccounts(): Account[];
}

/**
 * Modern Svelte 5 composable for shared inbox actions
 *
 * Addresses declaration order, component-specific logic, and reactivity issues by:
 * - Using getters for reactive state access to avoid stale closure issues
 * - Accepting configuration callbacks for component-specific behavior
 * - Encapsulating internal flags like _skipEmailSelection
 *
 * @param state - Reactive state references using Svelte 5 runes (getters ensure current values)
 * @param config - Optional configuration for component-specific behavior
 * @returns Object containing all inbox action functions
 *
 * @example
 * ```ts
 * const inboxActions = useInboxActions(
 *   {
 *     ext,
 *     inboxSetters,
 *     get searchQuery() { return searchQuery; },
 *     get otpOnly() { return otpOnly; },
 *     // ... other state
 *   },
 *   {
 *     onSelectAccount: () => { dropdownOpen = false; },
 *     getActiveInboxId: (selectedEmail, accounts) => { ... },
 *   }
 * );
 *
 * const { loadInboxes, selectAccount, copyEmail } = inboxActions;
 * ```
 */
export function useInboxActions(state: InboxActionsState, config: InboxActionsConfig = {}) {
  const { ext, inboxSetters, showToast } = state;

  let _skipEmailSelection = false;

  /**
   * Load inboxes from extension storage
   */
  async function loadInboxes(skipEmailSelection?: boolean) {
    if (skipEmailSelection !== undefined) {
      _skipEmailSelection = skipEmailSelection;
    }
    await loadInboxesAction(ext, inboxSetters, _skipEmailSelection);
  }

  /**
   * Check emails for active inbox
   * Uses current reactive values via getters
   */
  async function checkMessages(inboxId: string) {
    await checkMessagesAction(ext, inboxId, state.searchQuery, state.otpOnly, inboxSetters);
  }

  /**
   * Select account with optional component-specific callback
   * Uses current reactive values via getters
   */
  async function selectAccount(address: string) {
    await selectAccountAction(
      ext,
      address,
      {
        accounts: state.accounts,
        allInboxes: state.allInboxes,
        emails: [],
        latestOtp: state.latestOtp,
        latestOtpSender: '',
        latestOtpSenderName: '',
        otpContext: '',
        selectedEmail: state.selectedEmail,
        loading: false,
        loadingInboxes: false,
        loadingEmails: false,
        notificationsEnabled: state.notificationsEnabled,
      },
      inboxSetters
    );
    // Component-specific behavior via callback
    config.onSelectAccount?.();
  }

  /**
   * Copy email address
   * Uses current reactive values via getters
   */
  function copyEmail() {
    copyEmailAction(state.selectedEmail, (message) => showToast(message));
  }

  /**
   * Refresh inbox with optional custom logic for determining active inbox ID
   * Uses current reactive values via getters
   */
  async function refreshInbox(activeInboxId?: string) {
    // Use custom logic if provided, otherwise default behavior
    if (!activeInboxId && config.getActiveInboxId) {
      activeInboxId = config.getActiveInboxId(state.selectedEmail, state.accounts);
    } else if (!activeInboxId && state.selectedEmail) {
      // Default: find account by address
      const currentAccount = state.accounts.find((a) => a.address === state.selectedEmail);
      if (currentAccount) {
        activeInboxId = currentAccount.id;
      }
    }
    await refreshInboxAction(ext, inboxSetters, activeInboxId);
  }

  /**
   * Copy OTP code
   * Uses current reactive values via getters
   */
  function copyOtp() {
    copyOtpAction(state.latestOtp, (message) => showToast(message));
  }

  /**
   * Toggle notifications
   * Uses current reactive values via getters
   */
  async function toggleNotifications() {
    await toggleNotificationsAction(ext, state.notificationsEnabled, inboxSetters);
  }

  /**
   * Set skip email selection flag (for createInbox)
   */
  function setSkipEmailSelection(skip: boolean) {
    _skipEmailSelection = skip;
  }

  return {
    loadInboxes,
    checkMessages,
    selectAccount,
    copyEmail,
    refreshInbox,
    copyOtp,
    toggleNotifications,
    setSkipEmailSelection,
  };
}
