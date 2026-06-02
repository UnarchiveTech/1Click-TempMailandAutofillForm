/**
 * Shared type definitions for the 1Click: Temp Mail with Autofill extension.
 * Single source of truth — import from here in all entrypoints.
 */

export type MailProvider = string;

// ---- API Response Types ----

// Generic API response - provider-specific structures are in JSON configs

// ---- Storage Data Structures ----

export interface StoredEmails {
  [inboxAddress: string]: Email[];
}

export interface ArchivedEmails {
  [inboxAddress: string]: Email[];
}

export interface LastMessageTimestamps {
  [inboxId: string]: number;
}

export interface SeenEmailIds {
  [inboxAddress: string]: string[];
}

export interface PasswordSettings {
  useCustom: boolean;
  customPassword?: string;
}

export interface NameSettings {
  useCustom: boolean;
  firstName?: string;
  lastName?: string;
}

export interface DeveloperSettings {
  enableLogging: boolean;
}

export interface Keybinding {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export interface Keybindings {
  refreshInbox: Keybinding;
  createInbox: Keybinding;
  copyEmail: Keybinding;
  copyOtp: Keybinding;
  closeDialogs: Keybinding;
}

export const DEFAULT_KEYBINDINGS: Keybindings = {
  refreshInbox: { key: 'r', ctrlKey: true, metaKey: true },
  createInbox: { key: 'n', ctrlKey: true, metaKey: true },
  copyEmail: { key: 'c', ctrlKey: true, metaKey: true },
  copyOtp: { key: 'o', ctrlKey: true, metaKey: true },
  closeDialogs: { key: 'Escape' },
};

export interface StoredSettings {
  passwordSettings?: PasswordSettings;
  nameSettings?: NameSettings;
  autoCopy?: boolean;
  autoRenew?: boolean;
  selectedProvider?: MailProvider;
  selectedInstance?: string;
  customInstances?: ProviderInstance[];
  notificationSettings?: NotificationSettings;
  keybindings?: Keybindings;
  autoRefreshInterval?: number;
  themeMode?: 'light' | 'dark' | 'system';
  developerSettings?: DeveloperSettings;
  faviconCaching?: 'direct' | 'local';
  emailPreviewEnabled?: boolean;
  guerrillaDefaultDomain?: string;
}

export interface ProviderInstance {
  id: string;
  name: string;
  displayName: string;
  apiUrl: string;
  isCustom?: boolean;
}

export interface Analytics {
  createdAt?: string | number;
  accountsCreated: number;
  emailsReceived: number;
  otpsDetected: number;
  notificationsSent: number;
  // Performance metrics
  performance?: {
    emailFetchTimes: number[]; // Array of fetch times in milliseconds
    providerLatency: Record<string, number[]>; // Provider -> array of latency times in ms
    uiRenderTimes: number[]; // Array of UI render times in milliseconds
  };
}

export type ActivityEventType =
  | 'email_received'
  | 'otp_detected'
  | 'notification_sent'
  | 'account_created'
  | 'account_deleted'
  | 'auto_fill'
  | 'toast_notification'
  | 'auto_extend'
  | 'hard_reset';

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  timestamp: number;
  data: {
    inboxAddress?: string;
    emailId?: string;
    otp?: string;
    sender?: string;
    subject?: string;
    website?: string;
    message?: string; // For toast notifications
    toastType?: 'success' | 'error' | 'warning' | 'info'; // For toast notifications
  };
}

// ---- Domain Types ----

export type AccountStatus = 'active' | 'archived' | 'deleted';

export interface Account {
  id: string;
  /** The full email address, e.g. "foo@bar.com" */
  address: string;
  provider: MailProvider;
  token?: string; // Auth token (bearer, session, etc.)
  sidToken?: string; // Session token
  lastSequence?: number; // Sequence tracking for incremental fetching
  createdAt: number; // ms timestamp
  expiresAt: number; // ms timestamp
  expiryNotified?: boolean;
  autoExtend?: boolean;
  tag?: string;
  tagColor?: string;
  accountStatus?: AccountStatus; // Mutually exclusive: active | archived | deleted
  instanceUrl?: string; // For multi-instance providers
  // UI-specific properties
  expiry?: string; // Formatted expiry string
  received?: number; // Email count
  lastUsed?: string; // Formatted last used string
  status?: string; // Computed display status: active | archived | deleted | expired
  emailUser?: string;
}

export interface Email {
  id: string;
  subject?: string;
  body?: string;
  body_html?: string;
  body_plain?: string;
  from?: string;
  from_name?: string;
  received_at: number; // Unix seconds
  otp?: string | null;
  archived?: boolean;
  archived_at?: number;
  stored_at?: number; // ms timestamp (when we stored it)
  original_inbox?: string;
  local_only?: boolean; // Email only exists locally, not in API
  // Local-only soft archive/delete (separate from `archived` which is server-side)
  local_archived?: boolean;
  local_archived_at?: number;
  local_deleted?: boolean;
  local_deleted_at?: number;
  // UI-specific properties
  time?: string; // Formatted time string
  isOtp?: boolean;
  unread?: boolean;
  date?: string; // Formatted date string
  tags?: string[]; // Custom user-defined labels
}

export interface SavedLogin {
  id: string;
  website: string;
  email: string;
  password: string;
  otp?: string;
}

export interface Identity {
  id: string;
  name: string;
  firstNames: string;
  lastNames: string;
  useRandomPassword: boolean;
  customPassword?: string;
  phone?: string;
  pin?: string;
  domainHints?: string[];
  isDefault: boolean;
  createdAt: number;
}

export interface NotificationSettings {
  enabled: boolean;
  soundEnabled: boolean;
  expiryWarningThreshold: number; // in milliseconds (default: 1 hour)
}

export interface SessionCredentials {
  website?: string;
  email?: string;
  username?: string;
  password?: string;
  name?: string;
  phone?: string;
}

export interface EmailFilters {
  searchQuery?: string;
  hasOTP?: boolean;
  senderDomain?: string;
  dateFrom?: number;
  dateTo?: number;
}

export interface SavedSearchFilter {
  id: string;
  name: string;
  searchQuery: string;
  hasOTP: boolean;
  senderDomain: string;
  selectedSenders?: string[];
  dateFrom: string;
  dateTo: string;
  sortBy?: string;
  createdAt: number;
}

// ---- Component Props Interfaces ----

export interface MainViewProps {
  selectedEmail: string;
  emails: Email[];
  loading: boolean;
  latestOtp: string;
  otpContext: string;
  notificationsEnabled: boolean;
  inboxes: Account[];
  onCreateInbox: () => void;
  onRefreshInbox: () => void;
  onToggleNotifications: () => void;
  onCopyEmail: () => void;
  onOpenQrDialog: () => void;
  onOpenEmailDetail: (account: Account) => void;
  onEditAccount: (account: Account) => void;
  onExtendAccount: (account: Account) => void;
  onRemoveAccount: (address: string) => void;
  onArchiveAccount: (account: Account) => void;
  onOpenArchivedEmails: () => void;
  onOpenExpiredEmails: () => void;
  onCopyOtp: () => void;
  onOpenMessageDetail: (message: Email) => void;
  onClearFilters: () => void;
  dropdownOpen: boolean;
  domainMenuOpen: boolean;
  domainMenuPosition: { x: number; y: number };
  filteredEmails: Email[];
  searchQuery: string;
  otpOnly: boolean;
  onSearchChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onOtpOnlyChange: (checked: boolean) => void;
  onSelectProvider: (provider: string) => void;
  onCloseDropdown: () => void;
  onCloseDomainMenu: () => void;
}

export interface FilterListProps {
  searchQuery: string;
  sortBy: string;
  otpOnly: boolean;
  onSearchChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onOtpOnlyChange: (checked: boolean) => void;
}

export interface ArchivedEmailsProps {
  onBack: () => void;
  archivedSearch: string;
  filteredArchivedEmails: Email[];
  onSearchChange: (value: string) => void;
  onRestore: (email: Email) => void;
  onDelete: (email: Email) => void;
  onClearSearch: () => void;
}

export interface EmailDetailProps {
  onBack: () => void;
  currentEmailDetail: Account | null;
  emails: Email[];
  loading: boolean;
  onOpenMessageDetail: (mail: Email) => void;
  onRefreshMessages: () => void;
  onExportEmail: () => void;
}

export interface MessageDetailProps {
  onBack: () => void;
  selectedMessage: Email | null;
}

export interface LoginInfoProps {
  onBack: () => void;
  savedLogins: SavedLogin[];
  onDelete: (id: string) => void;
}

export interface SettingsProps {
  onBack: () => void;
  useCustomPassword: boolean;
  customPassword: string;
  useCustomName: boolean;
  customFirstName: string;
  customLastName: string;
  autoCopy: boolean;
  autoRenew: boolean;
  selectedProvider: string;
  savingSettings: boolean;
  loading: boolean;
  onSaveSettings: () => void;
  onHardReset: () => void;
  providerInstances: ProviderInstance[];
  selectedInstance: string | null;
  onSetInstance: (instanceId: string) => void;
  onExportData: () => void;
  onImportData: () => void;
  onProviderChange: (provider: string) => void;
  onAddCustomInstance: (name: string, url: string) => void;
  onLoadInstances: () => void;
}

export interface AnalyticsProps {
  onBack: () => void;
  analytics: Analytics;
  loading: boolean;
  onLoadAnalytics: () => void;
}

// ---- Export / Import ----

export interface EmailHistoryItem {
  email: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface CredentialsHistoryItem {
  domain: string;
  timestamp: number;
  email?: string | null;
  username?: string | null;
  name?: string | null;
  phone?: string | null;
  website?: string | null;
  password?: string;
  inboxId?: string;
  identityId?: string;
  [key: string]: unknown;
}

export interface ExportData {
  version: string;
  exportDate: string;
  data: {
    emailHistory: EmailHistoryItem[];
    loginInfo: CredentialsHistoryItem[];
    settings: {
      darkMode: boolean;
      activeAccountId?: string;
    };
    accounts: Account[];
  };
}

export interface ExportResult {
  success: boolean;
  error?: string;
}

export interface ImportResult {
  success: boolean;
  error?: string;
}

export interface DataManager {
  exportData: () => Promise<ExportResult>;
  importData: (file: File) => Promise<ImportResult>;
}

// ---- Background message shapes ----

export type BackgroundMessage =
  | {
      type: 'createInbox';
      provider?: MailProvider;
      user?: string;
      instanceId?: string;
      emailUser?: string;
    }
  | { type: 'checkEmails'; inboxId: string; filters?: EmailFilters }
  | { type: 'deleteInbox'; inboxId: string; preserveEmails?: boolean }
  | { type: 'restoreInbox'; inboxId: string }
  | { type: 'getInboxes' }
  | { type: 'setProvider'; provider: MailProvider }
  | { type: 'updateInboxTag'; inboxId: string; tag: string; color?: string | null }
  | { type: 'archiveInbox'; inboxId: string }
  | { type: 'unarchiveInbox'; inboxId: string }
  | { type: 'getProvider' }
  | { type: 'clearSessionCredentials' }
  | { type: 'updateSessionCredentials'; credentials: Partial<SessionCredentials> }
  | { type: 'getAnalytics' }
  | { type: 'renewInbox'; inboxId: string }
  | { type: 'fetchFavicon'; url: string }
  | { action: 'hardReset' }
  | { action: 'getProviderInstances'; provider?: string }
  | { action: 'addCustomInstance'; instance: Omit<ProviderInstance, 'id' | 'isCustom'> }
  | { action: 'removeCustomInstance'; instanceId: string }
  | { action: 'getSelectedInstance' }
  | { action: 'setSelectedInstance'; instanceId: string }
  | { action: 'setInstance'; instanceId: string }
  | { action: 'removeCustomProviderInstance'; instanceId: string }
  | { action: 'getSelectedProviderInstance' }
  | { action: 'setSelectedProviderInstance'; instanceId: string }
  | { action: 'initializeDefaultProvider' }
  | {
      action: 'providerApiCall';
      provider: string;
      func: string;
      params?: Record<string, unknown>;
      sidToken?: string;
    }
  | { action: 'getArchivedEmails'; inboxAddress?: string }
  | { action: 'getStorageUsage' }
  | { action: 'getEmailsToBeDeleted'; retentionDays?: number }
  | {
      action: 'cleanupOldStoredEmails';
      activeRetentionDays?: number;
      archivedRetentionDays?: number;
    };

// ---- Content script message shapes ----

export type ContentMessage =
  | { type: 'clearSessionCredentials' }
  | { type: 'updateSessionCredentials'; credentials: Partial<SessionCredentials> }
  | { type: 'fillOTP'; otp: string }
  | { type: 'checkFormDetected' }
  | { type: 'autofillForm' }
  | { action: 'startSignup' };

// ---- Combined message type for runtime ----

export type RuntimeMessage = BackgroundMessage | ContentMessage;

// ---- Browser Runtime Types ----

export interface RuntimeMessageSender {
  id?: string;
  url?: string;
  tab?: {
    id: number;
    url?: string;
  };
  frameId?: number;
}

export type MessageResponse = unknown;

export interface Alarm {
  name: string;
  scheduledTime: number;
  periodInMinutes?: number;
}

export interface Tab {
  id: number;
  url?: string;
  title?: string;
}
