<script lang="ts">
import { t } from 'svelte-i18n';
import { messageTabDomId, type OpenedMessageTab } from '@/features/address/message-tabs.js';
import { loadLazyComponent } from '@/ui/blocks/layout/lazy-view.svelte.js';
import MessageDetailPane from '@/ui/blocks/layout/MessageDetailPane.svelte';
import SplitPaneEmptyState from '@/ui/blocks/layout/SplitPaneEmptyState.svelte';
import SplitViewShell from '@/ui/blocks/layout/SplitViewShell.svelte';
import { type ToastFn } from '@/ui/blocks/layout/use-toast.js';
import ViewFallback from '@/ui/blocks/layout/ViewFallback.svelte';
import MessageTabs from '@/ui/blocks/mail/MessageTabs.svelte';
import type {
  Address,
  CredentialsHistoryItem,
  Email,
  EmailPreviewMode,
  ProviderInstance,
  SavedSearchFilter,
} from '@/utils/types.js';

type Context = 'popup' | 'sidepanel' | 'app';
type EmailListTab = 'inbox' | 'archived' | 'deleted' | 'storedLocally' | 'all';
type ProviderFailoverHint = {
  addressId: string;
  show: boolean;
  otherProvidersOk: boolean;
  nextRetryAt: number;
  failCount: number;
};
type MailboxForwardedProps = {
  context: Context;
  selectedEmail: string;
  dropdownOpen: boolean;
  accounts: Address[];
  allAddresses: Address[];
  loading: boolean;
  searchQuery: string;
  sortBy: string;
  otpOnly: boolean;
  unreadOnly: boolean;
  hasAttachment: boolean;
  senderDomain: string;
  senderEmail: string;
  recipient: string;
  subject: string;
  notSenderDomain: string;
  notSenderEmail: string;
  notRecipient: string;
  notSubject: string;
  selectedSenders: string[];
  dateFrom: string;
  dateTo: string;
  activeThreadMessageId: string;
  activeThreadInbox: string;
  filteredEmails: Email[];
  emails: Email[];
  allStoredEmails: Record<string, Email[]>;
  latestOtp: string;
  latestOtpSender: string;
  latestOtpSenderName: string;
  otpContext: string;
  formDetected: boolean;
  savedSearchFilters: SavedSearchFilter[];
  savedLogins: CredentialsHistoryItem[];
  openSection: 'active' | 'archived' | 'expired' | null;
  onOpenMagicLink: (url: string, address?: string) => void;
  onRefillSavedLogin: (login: CredentialsHistoryItem) => void | Promise<void>;
  onSaveFilterQuick: () => void;
  onDropdownOpenChange: (open: boolean) => void;
  onSelectAddress: (email: string) => void | Promise<void>;
  onCopyEmail: () => void | Promise<void>;
  onOpenQrDialog: () => void;
  onCreateAddress: (provider?: string, instanceId?: string) => void | Promise<void>;
  emailPreviewMode: EmailPreviewMode;
  showToast: ToastFn;
  showConfirm: (
    message: string,
    onConfirm: () => void,
    options?: import('@/utils/ui/shared-ui.js').ConfirmDialogOptions
  ) => void;
  onRefreshMailbox: (id?: string) => Promise<void>;
  onToggleNotifications: () => void;
  onArchiveAddress: (account: Address) => void | Promise<void>;
  onUnarchiveAddress: (account: Address) => void | Promise<void>;
  onRemoveAddress: (address: string) => void | Promise<void>;
  onRestoreAddress: (address: string) => void | Promise<void>;
  onReloadAddresses: (skipEmailSelection?: boolean) => Promise<void>;
  onToggleAutoExtend: (account: Address) => void | Promise<void>;
  onExtendAddress: (account: Address) => void | Promise<void>;
  onAutofillForm: () => void;
  onCreateIdentity: () => void;
  scrollChromeHidden: boolean;
  onScrollDirection: (direction: 'up' | 'down', atTop?: boolean) => void;
  onOpenMessageDetail: (thread: Email[]) => void;
  onSearchChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onOtpOnlyChange: (value: boolean) => void;
  onUnreadOnlyChange: (value: boolean) => void;
  onHasAttachmentChange: (value: boolean) => void;
  onSenderDomainChange: (value: string) => void;
  onSelectedSendersChange: (value: string[]) => void;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onClearFilters: () => void | Promise<void>;
  onArchiveEmails: (messages: Email[]) => void | Promise<void>;
  onDeleteEmails: (messages: Email[]) => void | Promise<void>;
  onRestoreEmails: (messages: Email[]) => void | Promise<void>;
  onSaveFilter: (
    name: string,
    searchQuery: string,
    hasOTP: boolean,
    hasAttachment: boolean,
    senderDomain: string,
    dateFrom: string,
    dateTo: string,
    selectedSenders: string[],
    sortBy: string,
    recipient: string,
    subject: string,
    unreadOnly: boolean
  ) => void;
  onLoadFilter: (filter: SavedSearchFilter) => void;
  onRenameFilter: (id: string, name: string) => void;
  onDeleteFilter: (id: string) => void;
  onNavigateToManage: () => void | Promise<void>;
  autoRenew: boolean;
  onToggleAutoRenew: () => void | Promise<void>;
  onCopyOtpFromMessage: (otp: string) => void;
  onCreateRuleFromEmail: (from?: string) => void;
  onManageTags: () => void;
  onManageLabels: () => void;
};

type MailboxSplitViewProps = MailboxForwardedProps & {
  layoutWide: boolean;
  layoutSplit: boolean;
  layoutVerticalSplit: boolean;
  splitModeFlash: boolean;
  showSplitPane: boolean;
  splitPaneCollapsed: boolean;
  hideDetailWhileSelecting: boolean;
  splitListWidthPx: number;
  displayedEmail?: string;
  emailListTab?: EmailListTab;
  activeLabelFilter?: string | null;
  selectedThread: Email[];
  openMessageTabs: OpenedMessageTab[];
  activeMessageTabKey: string;
  onSelectMessageTab: (key: string) => void;
  onCloseMessageTab: (key: string) => void;
  onMessageScroll: (key: string, scrollTop: number) => void;
  providerFailoverHint: ProviderFailoverHint | null;
  selectedProvider: string;
  selectedProviderInstance: string | null;
  providerInstances: ProviderInstance[];
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  expiryWarningThreshold: number;
  autoRefreshInterval: number;
  defaultDomain: string;
  mailProviderSplitOpen: boolean;
  hasPrevMessage: boolean;
  hasNextMessage: boolean;
  onProviderChange: (provider: string) => void | Promise<void>;
  onSetAutoRenew: (value: boolean) => void;
  onSetNotificationsEnabled: (value: boolean) => void;
  onSetSoundEnabled: (value: boolean) => void;
  onSetExpiryWarningThreshold: (value: number) => void;
  onSetAutoRefreshInterval: (value: number) => void;
  onSetEmailPreviewMode: (value: EmailPreviewMode) => void;
  onSetProviderInstance: (value: string) => void;
  onAddCustomInstance: (name: string, url: string) => void;
  onLoadProviderInstances: () => void | Promise<void>;
  onSetDefaultDomain: (value: string) => void;
  onSaveSettings: () => void | Promise<void>;
  onToggleSplitPane: () => void;
  onWidthChange: (width: number) => void;
  onExpandSplitPane: () => void;
  onSetMailProviderSplitOpen: (open: boolean) => void;
  onCloseMessageDetail: () => void;
  onMarkUnread: (mode: 'split') => void;
  onArchiveThread: (mode: 'split') => void;
  onDeleteThread: (mode: 'split') => void;
  onPrevMessage: () => void;
  onNextMessage: () => void;
  onSearchText: (query: string) => void;
};

let {
  layoutWide,
  layoutSplit,
  layoutVerticalSplit,
  splitModeFlash,
  showSplitPane,
  splitPaneCollapsed,
  hideDetailWhileSelecting,
  splitListWidthPx,
  displayedEmail = $bindable(''),
  emailListTab = $bindable<EmailListTab>('inbox'),
  activeLabelFilter = $bindable<string | null>(null),
  selectedThread,
  openMessageTabs,
  activeMessageTabKey,
  onSelectMessageTab,
  onCloseMessageTab,
  onMessageScroll,
  providerFailoverHint,
  selectedProvider,
  selectedProviderInstance,
  providerInstances,
  autoRenew,
  notificationsEnabled,
  soundEnabled,
  expiryWarningThreshold,
  autoRefreshInterval,
  emailPreviewMode,
  defaultDomain,
  allAddresses,
  openSection,
  mailProviderSplitOpen,
  hasPrevMessage,
  hasNextMessage,
  onProviderChange,
  onSetAutoRenew,
  onSetNotificationsEnabled,
  onSetSoundEnabled,
  onSetExpiryWarningThreshold,
  onSetAutoRefreshInterval,
  onSetEmailPreviewMode,
  onSetProviderInstance,
  onAddCustomInstance,
  onLoadProviderInstances,
  onSetDefaultDomain,
  onSaveSettings,
  onToggleSplitPane,
  onWidthChange,
  onExpandSplitPane,
  onSetMailProviderSplitOpen,
  onCloseMessageDetail,
  onMarkUnread,
  onArchiveThread,
  onDeleteThread,
  onPrevMessage,
  onNextMessage,
  onSearchText,
  ...mailboxProps
}: MailboxSplitViewProps = $props();

// MailboxView is the popup's default view and by far the largest component - it
// loads as its own chunk (prefetched from AppShell at startup) instead of being
// baked into the shell. MailProviderView only renders in the split provider pane.
const mailboxView = loadLazyComponent(() => import('@/ui/views/mailbox/MailboxView.svelte'));
const mailProviderView = loadLazyComponent(
  () => import('@/ui/views/settings/MailProviderView.svelte')
);
const messageTabsId = $props.id();
const activeTab = $derived(openMessageTabs.find((tab) => tab.key === activeMessageTabKey));
</script>

{#snippet mainPane()}
  {#if mailboxView.component}
    {@const MailboxViewCmp = mailboxView.component}
    <MailboxViewCmp
      {...mailboxProps}
      bind:displayedEmail
      bind:emailListTab={emailListTab}
      bind:activeLabelFilter={activeLabelFilter}
      {defaultDomain}
      {allAddresses}
      {openSection}
      {emailPreviewMode}
      {providerFailoverHint}
      {autoRenew}
      {notificationsEnabled}
    />
  {:else}
    <ViewFallback failed={mailboxView.failed} />
  {/if}
{/snippet}

{#snippet detailPane()}
  {#if mailProviderSplitOpen}
    {#if mailProviderView.component}
      {@const MailProviderViewCmp = mailProviderView.component}
      <MailProviderViewCmp
        onBack={() => onSetMailProviderSplitOpen(false)}
        {selectedProvider}
        {autoRenew}
        {notificationsEnabled}
        {soundEnabled}
        {expiryWarningThreshold}
        {autoRefreshInterval}
        {emailPreviewMode}
        {providerInstances}
        {selectedProviderInstance}
        {defaultDomain}
        {allAddresses}
        onProviderChange={onProviderChange}
        onSetAutoRenew={onSetAutoRenew}
        onSetNotificationsEnabled={onSetNotificationsEnabled}
        onSetSoundEnabled={onSetSoundEnabled}
        onSetExpiryWarningThreshold={onSetExpiryWarningThreshold}
        onSetAutoRefreshInterval={onSetAutoRefreshInterval}
        onSetEmailPreviewMode={onSetEmailPreviewMode}
        onSetProviderInstance={onSetProviderInstance}
        onAddCustomInstance={onAddCustomInstance}
        onLoadProviderInstances={onLoadProviderInstances}
        onSetDefaultDomain={onSetDefaultDomain}
        onSaveSettings={onSaveSettings}
      />
    {:else}
      <ViewFallback failed={mailProviderView.failed} />
    {/if}
  {:else}
    {#if openMessageTabs.length > 0}
      <MessageTabs tabs={openMessageTabs} activeKey={activeMessageTabKey} idPrefix={messageTabsId} onSelect={onSelectMessageTab} onClose={onCloseMessageTab} />
    {/if}
    <div
      id={`${messageTabsId}-panel`}
      role={activeTab ? 'tabpanel' : 'region'}
      aria-labelledby={activeTab ? messageTabDomId(messageTabsId, activeMessageTabKey) : undefined}
      aria-label={!activeTab ? $t('inbox.messageTabsLabel') : undefined}
      tabindex="-1"
      class="flex min-h-0 flex-1 flex-col"
      data-message-tab-panel
    >
    {#if selectedThread.length > 0}
    {#key activeMessageTabKey}
    <MessageDetailPane
      mode="split"
      context={mailboxProps.context}
      selectedThread={selectedThread}
      hasPrev={hasPrevMessage}
      hasNext={hasNextMessage}
      mailboxAddress={selectedThread[0]?.original_inbox || mailboxProps.selectedEmail}
      messageScrollKey={activeMessageTabKey}
      scrollTop={activeTab?.scrollTop || 0}
      onScrollTopChange={onMessageScroll}
      onBack={onCloseMessageDetail}
      onPrev={onPrevMessage}
      onNext={onNextMessage}
      onCreateRule={mailboxProps.onCreateRuleFromEmail}
      onManageLabels={mailboxProps.onManageLabels}
      onMarkUnread={() => onMarkUnread('split')}
      onArchive={() => onArchiveThread('split')}
      onDelete={() => onDeleteThread('split')}
      onSearchText={onSearchText}
      showToast={(message) => mailboxProps.showToast(message)}
    />
    {/key}
    {:else}
      <SplitPaneEmptyState kind="mailbox" />
    {/if}
    </div>
  {/if}
{/snippet}

<SplitViewShell
  {layoutSplit}
  {layoutVerticalSplit}
  {splitModeFlash}
  {showSplitPane}
  {splitPaneCollapsed}
  {hideDetailWhileSelecting}
  {splitListWidthPx}
  detailClass="flex-1 overflow-hidden flex flex-col rounded-xl bg-md-surface"
  main={mainPane}
  detail={detailPane}
  onToggleSplitPane={onToggleSplitPane}
  onWidthChange={onWidthChange}
  onExpandSplitPane={onExpandSplitPane}
/>
