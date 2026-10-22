import { verificationExpiresAt } from '@/utils/otp/verification-policy.js';
import { getRootDomain } from '@/utils/security/root-domain.js';
import { toMs } from '@/utils/time/time.js';
import type { Email } from '@/utils/types.js';

export interface VerificationItem {
  id: string;
  kind: 'otp' | 'link';
  value: string;
  address: string;
  website: string;
  email: Email;
  receivedAt: number;
  expiresAt: number;
  status: 'current' | 'earlier' | 'expired';
}

export interface VerificationGroup {
  key: string;
  sections: Array<{ key: string; items: VerificationItem[] }>;
  count: number;
}

function senderWebsite(email: Email): string {
  const sender = (email as Email & { from_address?: string }).from_address || email.from || '';
  const address = sender.match(/<([^<>]+)>/)?.[1] || sender;
  const host = address
    .slice(address.lastIndexOf('@') + 1)
    .trim()
    .toLowerCase();
  return host.includes('.') && !/[\s<>/]/.test(host) ? getRootDomain(host) : '';
}

/** History retains earlier messages, but a newer message reserves its lane even after expiry. */
export function collectVerificationItems(
  inboxes: Array<{ address: string; emails: Email[] }>,
  maxAgeMinutes: number,
  now: number
): VerificationItem[] {
  const items: VerificationItem[] = [];
  const seen = new Set<string>();
  for (const inbox of inboxes) {
    for (const email of inbox.emails) {
      if (email.local_deleted) continue;
      const appendItem = (
        kind: VerificationItem['kind'],
        value: string,
        website: string,
        expiry?: number
      ) => {
        const id = JSON.stringify([inbox.address.toLowerCase(), email.id, kind, value]);
        if (seen.has(id)) return;
        seen.add(id);
        const expiresAt = verificationExpiresAt(email.received_at, expiry, maxAgeMinutes, now);
        items.push({
          id,
          kind,
          value,
          address: inbox.address,
          website,
          email: { ...email, original_inbox: email.original_inbox || inbox.address },
          receivedAt: toMs(email.received_at),
          expiresAt,
          status: expiresAt > now ? 'current' : 'expired',
        });
      };
      if (email.otp?.trim() && email.otp !== '------') {
        appendItem('otp', email.otp, senderWebsite(email), email.otpExpiresAt);
      }
      for (const link of email.magicLinks || []) {
        try {
          const url = new URL(link.url);
          if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
          appendItem(
            'link',
            link.url,
            getRootDomain(url.hostname),
            link.expiresAt || email.otpExpiresAt
          );
        } catch {
          // Invalid provider URLs are not actionable verification links.
        }
      }
    }
  }
  // Stable ties preserve the provider's newest-first order when its clock has
  // only second precision. Message IDs are not chronological across providers.
  items.sort((a, b) => b.receivedAt - a.receivedAt);
  const latestByLane = new Map<string, string>();
  for (const item of items) {
    // Do not conflate unidentified senders or codes with magic links.
    const lane = JSON.stringify([
      item.address.toLowerCase(),
      item.website || item.email.from || item.email.id,
      item.kind,
    ]);
    const latestId = latestByLane.get(lane);
    if (!latestId) latestByLane.set(lane, item.email.id);
    if (
      item.status === 'current' &&
      (item.email.local_archived || (latestId && latestId !== item.email.id))
    ) {
      item.status = 'earlier';
    }
  }
  return items;
}

/** O(n) map construction; rows are already sorted newest first. */
export function groupVerificationItems(
  items: VerificationItem[],
  mode: 'address' | 'website',
  currentAddress = ''
): VerificationGroup[] {
  const groups = new Map<string, Map<string, VerificationItem[]>>();
  for (const item of items) {
    const outer = mode === 'address' ? item.address : item.website;
    const inner = mode === 'address' ? item.website : item.address;
    let sections = groups.get(outer);
    if (!sections) {
      sections = new Map();
      groups.set(outer, sections);
    }
    const rows = sections.get(inner) || [];
    if (!sections.has(inner)) sections.set(inner, rows);
    rows.push(item);
  }
  const result = [...groups].map(([key, sections]) => ({
    key,
    sections: [...sections].map(([sectionKey, rows]) => ({ key: sectionKey, items: rows })),
    count: [...sections.values()].reduce((sum, rows) => sum + rows.length, 0),
  }));
  if (mode === 'address')
    result.sort(
      (a, b) =>
        Number(b.key.toLowerCase() === currentAddress.toLowerCase()) -
        Number(a.key.toLowerCase() === currentAddress.toLowerCase())
    );
  return result;
}

export interface VerificationMagicLink {
  url: string;
  label?: string;
  score: number;
  host: string;
  email: Email;
  expiresAt: number | null;
}

/**
 * Collect all distinct magic links from live messages, preferring the newest
 * occurrence of a URL and then the highest-confidence match for equal dates.
 */
export function collectVerificationMagicLinks(emails: Email[]): VerificationMagicLink[] {
  const byUrl = new Map<string, VerificationMagicLink>();

  for (const email of Array.isArray(emails) ? emails : []) {
    if (email.local_archived || email.local_deleted) continue;
    for (const link of email.magicLinks || []) {
      const candidate: VerificationMagicLink = {
        url: link.url,
        label: link.label,
        score: link.score,
        host: link.host || '',
        email,
        expiresAt: link.expiresAt || email.otpExpiresAt || null,
      };
      const existing = byUrl.get(candidate.url);
      const candidateReceivedAt = email.received_at || 0;
      const existingReceivedAt = existing?.email.received_at || 0;
      if (
        !existing ||
        candidateReceivedAt > existingReceivedAt ||
        (candidateReceivedAt === existingReceivedAt && candidate.score > existing.score)
      ) {
        byUrl.set(candidate.url, candidate);
      }
    }
  }

  return [...byUrl.values()].sort(
    (a, b) => (b.email.received_at || 0) - (a.email.received_at || 0) || b.score - a.score
  );
}
