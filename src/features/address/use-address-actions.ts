import type { AddressSetters, LoadAddressesOptions } from '@/features/address/address-actions.js';
import {
  checkMessages as checkMessagesAction,
  copyEmail as copyEmailAction,
  copyOtp as copyOtpAction,
  loadAddresses as loadAddressesAction,
  refreshMailbox as refreshMailboxAction,
  selectAddress as selectAddressAction,
  toggleNotifications as toggleNotificationsAction,
} from '@/features/address/address-actions.js';
import type { ToastType } from '@/ui/blocks/feedback/toast-types.js';
import type { Address } from '@/utils/types.js';

/**
 * Configuration options for component-specific behavior
 */
export interface AddressActionsConfig {
  /** Callback after account selection (e.g., to close dropdown) */
  onSelectAddress?: () => void;
  /** Custom logic for determining active inbox ID */
  getActiveAddressId?: (selectedEmail: string, accounts: Address[]) => string | undefined;
}

/**
 * Reactive state references using Svelte 5 runes
 * Using getters to ensure we always access current reactive values
 */
export interface AddressActionsState {
  /** Extension context */
  readonly ext: Browser;
  /** Inbox setters object */
  readonly addressSetters: AddressSetters;
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
  /** Addresses array (reactive) */
  get accounts(): Address[];
  /** All addresses array (reactive) */
  get allAddresses(): Address[];
  /** Management accounts array (reactive) */
  get mgmtAddresses(): Address[];
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
 * const addressActions = useAddressActions(
 *   {
 *     ext,
 *     addressSetters,
 *     get searchQuery() { return searchQuery; },
 *     get otpOnly() { return otpOnly; },
 *     // ... other state
 *   },
 *   {
 *     onSelectAddress: () => { dropdownOpen = false; },
 *     getActiveAddressId: (selectedEmail, accounts) => { ... },
 *   }
 * );
 *
 * const { loadAddresses, selectAddress, copyEmail } = addressActions;
 * ```
 */
export function useAddressActions(state: AddressActionsState, config: AddressActionsConfig = {}) {
  const { ext, addressSetters, showToast } = state;

  /**
   * Load addresses from extension storage.
   * Defaults to selecting the active inbox (skipEmailSelection = false) - the
   * flag must be passed per-call, never held as sticky state (a transient
   * `loadAddresses(true)` from a storage listener used to leak into later
   * no-arg calls and leave `selectedEmail` empty after a backup import).
   */
  async function loadAddresses(skipEmailSelection?: boolean, options?: LoadAddressesOptions) {
    await loadAddressesAction(ext, addressSetters, skipEmailSelection === true, options);
  }

  /**
   * Check emails for active inbox
   * Uses current reactive values via getters
   */
  async function checkMessages(addressId: string) {
    await checkMessagesAction(ext, addressId, state.searchQuery, state.otpOnly, addressSetters);
  }

  /**
   * Select account with optional component-specific callback
   * Uses current reactive values via getters
   */
  async function selectAddress(address: string) {
    // Snapshot live lists at call time (getters) so prev/next always resolves the account
    const accountsSnap = state.accounts;
    const allAddressesSnap = state.allAddresses;
    await selectAddressAction(
      ext,
      address,
      {
        accounts: accountsSnap,
        allAddresses: allAddressesSnap,
        emails: [],
        latestOtp: state.latestOtp,
        latestOtpSender: '',
        latestOtpSenderName: '',
        otpContext: '',
        selectedEmail: address,
        loading: false,
        loadingAddresses: false,
        loadingEmails: false,
        notificationsEnabled: state.notificationsEnabled,
      },
      addressSetters
    );
    // Component-specific behavior via callback
    config.onSelectAddress?.();
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
  async function refreshMailbox(activeAddressId?: string) {
    // Use custom logic if provided, otherwise default behavior
    if (!activeAddressId && config.getActiveAddressId) {
      activeAddressId = config.getActiveAddressId(state.selectedEmail, state.accounts);
    } else if (!activeAddressId && state.selectedEmail) {
      // Default: find account by address
      const currentAddress = state.accounts.find((a) => a.address === state.selectedEmail);
      if (currentAddress) {
        activeAddressId = currentAddress.id;
      }
    }
    await refreshMailboxAction(ext, addressSetters, activeAddressId);
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
    await toggleNotificationsAction(state.notificationsEnabled, addressSetters);
  }

  return {
    loadAddresses,
    checkMessages,
    selectAddress,
    copyEmail,
    refreshMailbox,
    copyOtp,
    toggleNotifications,
  };
}
