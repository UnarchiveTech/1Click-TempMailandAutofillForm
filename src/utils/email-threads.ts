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

function toMs(receivedAt: number): number {
  return receivedAt > 1_000_000_000_000 ? receivedAt : receivedAt * 1000;
}

/**
 * Group an array of emails into threads using subject-based heuristics.
 * Two emails belong to the same thread if:
 *   - their normalized subjects match, AND
 *   - they share at least one participant (from/to address), OR
 *   - they are within 72 hours of each other
 *
 * Uses a Map keyed by normalized subject for O(1) candidate lookup
 * instead of iterating all threads per email.
 */
export function groupEmailsByThread(emails: Email[]): EmailThread[] {
  // Map: normalized subject → array of threads with that subject
  const subjectThreads = new Map<string, EmailThread[]>();
  const allThreads: EmailThread[] = [];

  // Sort newest-first so first assignment wins for latestEmail
  const sorted = [...emails].sort((a, b) => toMs(b.received_at) - toMs(a.received_at));

  for (const email of sorted) {
    const norm = normalizeSubject(email.subject || '');
    const candidates = subjectThreads.get(norm);

    let matched: EmailThread | null = null;

    if (candidates) {
      const emailParticipants = new Set([email.from, email.from_name].filter(Boolean));
      const emailMs = toMs(email.received_at);

      for (const thread of candidates) {
        // Participant overlap check
        const overlap = thread.participants.some((p) => emailParticipants.has(p));

        // Time proximity: within 72 hours of the latest email in this thread
        const threadLatestMs = toMs(thread.latestEmail.received_at);
        const withinWindow = Math.abs(threadLatestMs - emailMs) < 72 * 60 * 60 * 1000;

        if (overlap || withinWindow) {
          matched = thread;
          break;
        }
      }
    }

    if (matched) {
      matched.emails.push(email);
      if (email.unread) matched.unreadCount++;
      if (email.from && !matched.participants.includes(email.from))
        matched.participants.push(email.from);
    } else {
      const threadId = `thread-${norm}-${email.id}`;
      const thread: EmailThread = {
        id: threadId,
        normalizedSubject: norm,
        emails: [email],
        latestEmail: email,
        unreadCount: email.unread ? 1 : 0,
        participants: [email.from].filter(Boolean) as string[],
      };
      allThreads.push(thread);
      if (!subjectThreads.has(norm)) {
        subjectThreads.set(norm, []);
      }
      subjectThreads.get(norm)!.push(thread);
    }
  }

  // Sort threads by latest email timestamp descending
  return allThreads.sort(
    (a, b) => toMs(b.latestEmail.received_at) - toMs(a.latestEmail.received_at)
  );
}
