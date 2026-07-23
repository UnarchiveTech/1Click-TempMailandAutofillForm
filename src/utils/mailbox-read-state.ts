import type { Email } from './types.js';

export type MailboxReadState = {
  total: number;
  unread: number;
  read: number;
  /** True when at least one unread message exists → Mark All Read is useful */
  canMarkAllRead: boolean;
  /** True when at least one read message exists → Mark All Unread is useful */
  canMarkAllUnread: boolean;
};

/**
 * Derive enable/disable for Mark All as Read / Mark All as Unread.
 * - All read → disable Mark All Read
 * - All unread → disable Mark All Unread
 * - Mix → both enabled
 * - Empty mailbox → both disabled
 */
export function getMailboxReadState(emails: Email[] | null | undefined): MailboxReadState {
  const list = Array.isArray(emails) ? emails : [];
  const total = list.length;
  const unread = list.filter((e) => !!e.unread).length;
  const read = total - unread;
  return {
    total,
    unread,
    read,
    canMarkAllRead: unread > 0,
    canMarkAllUnread: read > 0,
  };
}
