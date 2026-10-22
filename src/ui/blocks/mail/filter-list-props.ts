import type { Email, SavedSearchFilter } from '@/utils/types.js';

/**
 * Signature of the `onSaveFilter` callback - 12 positional args, shared
 * by FilterList and MailboxView. FilterList is the consumer; MailboxView
 * forwards through, so both must agree on the exact shape.
 */
export type SaveFilterFn = (
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

/**
 * The mailbox filter/search surface shared between FilterList (the UI that
 * renders it) and MailboxView (the host that owns the state and forwards it
 * down). Single source of truth - never re-declare these inline in either
 * component, or a prop rename can silently drift between the two.
 */
export interface FilterQueryProps {
  searchQuery?: string;
  sortBy?: string;
  otpOnly?: boolean;
  unreadOnly?: boolean;
  hasAttachment?: boolean;
  senderDomain?: string;
  senderEmail?: string;
  recipient?: string;
  subject?: string;
  notSenderDomain?: string;
  notSenderEmail?: string;
  notRecipient?: string;
  notSubject?: string;
  selectedSenders?: string[];
  dateFrom?: string;
  dateTo?: string;
  emails?: Email[];
  savedSearchFilters?: SavedSearchFilter[];
  onSearchChange?: (v: string) => void;
  onSortChange?: (v: string) => void;
  onOtpOnlyChange?: (v: boolean) => void;
  onUnreadOnlyChange?: (v: boolean) => void;
  onHasAttachmentChange?: (v: boolean) => void;
  onSenderDomainChange?: (v: string) => void;
  onSelectedSendersChange?: (v: string[]) => void;
  onDateFromChange?: (v: string) => void;
  onDateToChange?: (v: string) => void;
  onClearFilters?: () => void;
  onSaveFilter?: SaveFilterFn;
  onLoadFilter?: (filter: SavedSearchFilter) => void;
  onRenameFilter?: (id: string, name: string) => void;
  onDeleteFilter?: (id: string) => void;
  onRefreshMailbox?: () => void | Promise<void>;
  onToggleNotifications?: () => void;
  notificationsEnabled?: boolean;
}
