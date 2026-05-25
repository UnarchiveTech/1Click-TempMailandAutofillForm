import type { Email } from './types.js';

export interface EmailThread {
  id: string;
  normalizedSubject: string;
  emails: Email[];
  latestEmail: Email;
  unreadCount: number;
  participants: string[];
}

/**
 * Strip common reply/forward prefixes and normalize whitespace
 */
export function normalizeSubject(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/^(re|fwd?|fw|aw|回复|回覆|答复|vidarebefordra|sv|vs|tr|rif):\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Group an array of emails into threads using subject-based heuristics.
 * Two emails belong to the same thread if:
 *   - their normalized subjects match, AND
 *   - they share at least one participant (from/to address), OR
 *   - they are within 72 hours of each other
 */
export function groupEmailsByThread(emails: Email[]): EmailThread[] {
  const threads: Map<string, EmailThread> = new Map();

  // Sort newest-first so latest email is easy to track
  const sorted = [...emails].sort((a, b) => {
    const aMs = a.received_at > 1_000_000_000_000 ? a.received_at : a.received_at * 1000;
    const bMs = b.received_at > 1_000_000_000_000 ? b.received_at : b.received_at * 1000;
    return bMs - aMs;
  });

  for (const email of sorted) {
    const norm = normalizeSubject(email.subject || '');

    // Try to find a matching thread
    let matched: EmailThread | null = null;
    for (const thread of threads.values()) {
      if (thread.normalizedSubject !== norm) continue;

      // Participant overlap check
      const emailParticipants = new Set([email.from, email.from_name].filter(Boolean));
      const overlap = thread.participants.some((p) => emailParticipants.has(p));

      // Time proximity: within 72 hours of the latest email in this thread
      const threadLatestMs =
        thread.latestEmail.received_at > 1_000_000_000_000
          ? thread.latestEmail.received_at
          : thread.latestEmail.received_at * 1000;
      const emailMs =
        email.received_at > 1_000_000_000_000 ? email.received_at : email.received_at * 1000;
      const withinWindow = Math.abs(threadLatestMs - emailMs) < 72 * 60 * 60 * 1000;

      if (overlap || withinWindow) {
        matched = thread;
        break;
      }
    }

    if (matched) {
      matched.emails.push(email);
      if (email.unread) matched.unreadCount++;
      if (email.from && !matched.participants.includes(email.from))
        matched.participants.push(email.from);
      // latestEmail is already the newest (sorted newest-first, first assignment wins)
    } else {
      const threadId = `thread-${norm}-${email.id}`;
      threads.set(threadId, {
        id: threadId,
        normalizedSubject: norm,
        emails: [email],
        latestEmail: email,
        unreadCount: email.unread ? 1 : 0,
        participants: [email.from].filter(Boolean) as string[],
      });
    }
  }

  // Sort threads by latest email timestamp descending
  return Array.from(threads.values()).sort((a, b) => {
    const aMs =
      a.latestEmail.received_at > 1_000_000_000_000
        ? a.latestEmail.received_at
        : a.latestEmail.received_at * 1000;
    const bMs =
      b.latestEmail.received_at > 1_000_000_000_000
        ? b.latestEmail.received_at
        : b.latestEmail.received_at * 1000;
    return bMs - aMs;
  });
}
