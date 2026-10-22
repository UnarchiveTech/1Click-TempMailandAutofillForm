import { emailLabelKeyForEmail } from '@/utils/email/email-label-key.js';
import { toMs } from '@/utils/time/time.js';
import type { Email } from '@/utils/types.js';

/** Resolve label usage to real messages, including archived mail, once per refresh. */
export function buildLabelUsage(
  labels: Record<string, string[]>,
  maps: { storedEmails: Record<string, Email[]>; archivedEmails: Record<string, Email[]> }
): Record<string, Email[]> {
  const result: Record<string, Email[]> = Object.create(null);
  const seen = new Set<string>();
  for (const [map, archived] of [
    [maps.storedEmails, false],
    [maps.archivedEmails, true],
  ] as const) {
    for (const [address, messages] of Object.entries(map)) {
      for (const message of messages || []) {
        const key = emailLabelKeyForEmail(message, address);
        if (!key || message.local_deleted || seen.has(key)) continue;
        seen.add(key);
        const names = labels[key] ?? labels[message.id] ?? [];
        if (names.length === 0) continue;
        const email = {
          ...message,
          original_inbox: message.original_inbox || address,
          local_archived: archived || message.local_archived,
        };
        for (const name of new Set(names)) {
          result[name] ??= [];
          result[name].push(email);
        }
      }
    }
  }
  for (const messages of Object.values(result))
    messages.sort((a, b) => toMs(b.received_at) - toMs(a.received_at));
  return result;
}
