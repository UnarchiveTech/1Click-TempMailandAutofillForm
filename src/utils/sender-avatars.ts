/**
 * Smart sender/domain avatar stack for addresses list & mail detail.
 * Ranks unique sender domains by mail volume in a recent window,
 * falling back to earlier mail when the window is empty.
 */

import type { Email } from '@/utils/types.js';

export type SenderAvatar = {
  /** Domain or email used for favicon lookup */
  email: string;
  domain: string;
  letter: string;
  count: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function extractDomain(from: string): string {
  const raw = (from || '').trim().toLowerCase();
  if (!raw) return '';
  // email form
  const at = raw.lastIndexOf('@');
  if (at >= 0) return raw.slice(at + 1).replace(/[>)\]]+$/, '');
  // bare domain
  return raw.replace(/^https?:\/\//, '').split('/')[0] || raw;
}

function letterFrom(from: string, fromName?: string): string {
  const src = (fromName || from || '?').trim();
  return (src[0] || '?').toUpperCase();
}

/**
 * Rank domains by message count in [now - windowMs, now].
 * If no messages in the window, use the full history.
 * Returns top `max` domains + remainder count of unique domains beyond max.
 */
export function getDomainAvatarStack(
  emails: Email[] | unknown,
  max = 4,
  windowMs = DAY_MS
): { senders: SenderAvatar[]; remainder: number } {
  const list = Array.isArray(emails) ? (emails as Email[]) : [];
  if (list.length === 0) return { senders: [], remainder: 0 };

  const now = Date.now();
  // received_at is unix seconds in this codebase
  const inWindow = list.filter((m) => {
    const ts = m.received_at > 1e12 ? m.received_at : m.received_at * 1000;
    return now - ts <= windowMs;
  });
  const pool = inWindow.length > 0 ? inWindow : list;

  const counts = new Map<string, { count: number; sampleEmail: string; letter: string }>();
  for (const msg of pool) {
    if (!msg.from) continue;
    const domain = extractDomain(msg.from);
    if (!domain) continue;
    const prev = counts.get(domain);
    if (prev) {
      prev.count += 1;
    } else {
      counts.set(domain, {
        count: 1,
        sampleEmail: msg.from,
        letter: letterFrom(msg.from, msg.from_name),
      });
    }
  }

  const ranked = [...counts.entries()]
    .map(([domain, v]) => ({
      domain,
      email: v.sampleEmail,
      letter: v.letter,
      count: v.count,
    }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));

  const senders = ranked.slice(0, max);
  const remainder = Math.max(0, ranked.length - max);
  return { senders, remainder };
}
