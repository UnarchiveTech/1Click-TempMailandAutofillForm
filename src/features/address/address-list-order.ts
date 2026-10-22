import { toMs } from '@/utils/time/time.js';
import type { Address, Email } from '@/utils/types.js';

export type AddressListOrder = 'custom' | 'expiry' | 'unread' | 'recent';

/** Sort a copy for display only. Ties retain the user's stored custom order. */
export function orderAddressList(
  addresses: Address[],
  order: AddressListOrder,
  emails: Record<string, Email[]>,
  countUnread: (messages: Email[]) => number
): Address[] {
  if (order === 'custom') return addresses;
  const bags = new Map(
    Object.entries(emails).map(([address, messages]) => [address.toLowerCase(), messages])
  );
  const metrics = new Map(
    addresses.map((address) => {
      const messages = emails[address.address] || bags.get(address.address.toLowerCase()) || [];
      const metric =
        order === 'expiry'
          ? address.expiresAt > 0
            ? address.expiresAt
            : Number.POSITIVE_INFINITY
          : order === 'unread'
            ? countUnread(messages)
            : messages.reduce(
                (latest, email) => Math.max(latest, toMs(email.received_at) || 0),
                address.createdAt || 0
              );
      return [address.id, metric] as const;
    })
  );
  return [...addresses].sort((a, b) => {
    const first = metrics.get(a.id) ?? 0;
    const second = metrics.get(b.id) ?? 0;
    if (first === second) return 0;
    return order === 'expiry' ? first - second : second - first;
  });
}
