/**
 * Email filtering composable
 * Provides reactive email filtering with memoization for performance
 */

import { emailLabelKeyForEmail } from '@/utils/email/email-label-key.js';
import { isRealOtp } from '@/utils/otp/otp-code.js';
import { toMs } from '@/utils/time/time.js';
import type { Email } from '@/utils/types.js';

/** Bare address of a sender/recipient value, handling `"Name <addr>"` and bare addr. */
function addressFrom(value: string): string {
  const angle = /<([^<>]+)>/.exec(value);
  return (angle ? angle[1] : value).trim().toLowerCase();
}

/** Domain part of a sender/recipient value (uses the same `"Name <addr>"` handling). */
function addressDomain(value: string): string {
  const addr = addressFrom(value);
  const at = addr.lastIndexOf('@');
  return at >= 0 ? addr.slice(at + 1) : addr;
}

/**
 * Match a sender/recipient value against a filter term.
 * - `@`-containing terms (full addresses) match the bare address exactly.
 * - dot-containing terms (full domains) match on domain boundaries - exact
 *   domain or a subdomain - so `github.com` no longer matches
 *   `notgithub.com` or `github.com.evil.com`.
 * - dotless terms (partials, e.g. `acme`) keep substring matching so
 *   `from:acme` still finds `acme.com`.
 */
export function matchesAddressTerm(value: string | undefined, term: string): boolean {
  if (!term) return true;
  const v = (value || '').toLowerCase();
  const t = term.toLowerCase();
  if (t.includes('@')) return addressFrom(v) === t;
  if (!t.includes('.')) return v.includes(t);
  const domain = addressDomain(v);
  return domain === t || domain.endsWith(`.${t}`);
}

export interface EmailFilterOptions {
  searchQuery?: string;
  otpOnly?: boolean;
  unreadOnly?: boolean;
  hasAttachment?: boolean;
  senderDomain?: string;
  senderEmail?: string;
  recipient?: string;
  subject?: string;
  /** Exclude emails from this sender domain (!from:domain) */
  notSenderDomain?: string;
  /** Exclude emails from this sender email (!from:email) */
  notSenderEmail?: string;
  /** Exclude emails to this recipient (!to:address) */
  notRecipient?: string;
  /** Exclude emails whose subject contains this text (!subject:text) */
  notSubject?: string;
  selectedSenders?: string[];
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  /** Message labels keyed by email id (mailbox search) */
  emailLabelsById?: Record<string, string[]>;
  /** Fallback inbox for a bag searched outside the currently selected mailbox. */
  defaultRecipient?: string;
}

interface IndexedEmailText {
  subjectSource: string;
  fromSource: string;
  fromNameSource: string;
  bodyPlainSource: string;
  bodySource: string;
  receivedAtSource: Email['received_at'];
  normalized: Partial<Record<'subject' | 'from' | 'fromName' | 'bodyPlain' | 'body', string>>;
  receivedAtMs: number;
  codeUnits: number;
}

// A bounded, admission-only cache keeps repeated keystrokes from lowercasing
// the same full message bodies. It intentionally does not evict on overflow:
// evicting while scanning a corpus larger than the cap makes each pass churn
// through the whole cache and perform worse than having no index.
const MAX_EMAIL_TEXT_INDEX_ENTRIES = 4096;
const MAX_EMAIL_TEXT_INDEX_CODE_UNITS = 8 * 1024 * 1024;
const emailTextIndex = new Map<Email, IndexedEmailText>();
let emailTextIndexCodeUnits = 0;

function readTextField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function indexedEmailText(email: Email): IndexedEmailText | undefined {
  const subjectSource = readTextField(email.subject);
  const fromSource = readTextField(email.from);
  const fromNameSource = readTextField(email.from_name);
  const bodyPlainSource = readTextField(email.body_plain);
  const bodySource = readTextField(email.body);
  const receivedAtSource = email.received_at;
  const existing = emailTextIndex.get(email);
  if (
    existing &&
    existing.subjectSource === subjectSource &&
    existing.fromSource === fromSource &&
    existing.fromNameSource === fromNameSource &&
    existing.bodyPlainSource === bodyPlainSource &&
    existing.bodySource === bodySource &&
    existing.receivedAtSource === receivedAtSource
  ) {
    return existing;
  }
  if (existing) {
    emailTextIndex.delete(email);
    emailTextIndexCodeUnits -= existing.codeUnits;
  }
  if (emailTextIndex.size >= MAX_EMAIL_TEXT_INDEX_ENTRIES) return undefined;

  const entry: IndexedEmailText = {
    subjectSource,
    fromSource,
    fromNameSource,
    bodyPlainSource,
    bodySource,
    receivedAtSource,
    normalized: {},
    receivedAtMs: toMs(receivedAtSource),
    codeUnits: 0,
  };
  emailTextIndex.set(email, entry);
  return entry;
}

function normalizedField(
  entry: IndexedEmailText,
  field: 'subject' | 'from' | 'fromName' | 'bodyPlain' | 'body',
  source: string
): string {
  const cached = entry.normalized[field];
  if (cached !== undefined) return cached;
  const normalized = source.toLowerCase();
  if (emailTextIndexCodeUnits + normalized.length <= MAX_EMAIL_TEXT_INDEX_CODE_UNITS) {
    entry.normalized[field] = normalized;
    entry.codeUnits += normalized.length;
    emailTextIndexCodeUnits += normalized.length;
  }
  return normalized;
}

/**
 * Filters and sorts emails based on provided criteria
 * @param emails - The array of emails to filter
 * @param options - Filtering and sorting options
 * @returns Filtered and sorted array of emails
 */
export function filterEmails(emails: Email[], options: EmailFilterOptions): Email[] {
  const {
    searchQuery = '',
    otpOnly = false,
    unreadOnly = false,
    hasAttachment = false,
    senderDomain = '',
    senderEmail = '',
    recipient = '',
    subject = '',
    notSenderDomain = '',
    notSenderEmail = '',
    notRecipient = '',
    notSubject = '',
    selectedSenders = [],
    dateFrom = '',
    dateTo = '',
    sortBy = 'newest',
    emailLabelsById = {},
    defaultRecipient = '',
  } = options;

  // Normalize query/filter values once per filter pass instead of once per email.
  // Mailbox searches can run over thousands of messages, so this avoids repeated
  // allocations and string scans without changing matching semantics.
  const normalizedSearchQuery = searchQuery.toLowerCase();
  const normalizedSenderDomain = senderDomain.toLowerCase();
  const normalizedSenderEmail = senderEmail.toLowerCase();
  const normalizedRecipient = recipient.toLowerCase();
  const normalizedSubject = subject.toLowerCase();
  const normalizedNotSenderDomain = notSenderDomain.toLowerCase();
  const normalizedNotSenderEmail = notSenderEmail.toLowerCase();
  const normalizedNotRecipient = notRecipient.toLowerCase();
  const normalizedNotSubject = notSubject.toLowerCase();
  const normalizedSelectedSenders = selectedSenders.map((sender) => sender.toLowerCase());
  const fromDateMs = dateFrom ? new Date(dateFrom).getTime() : undefined;
  const toDateMs = dateTo ? new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1 : undefined;

  const filtered = emails.filter((email) => {
    // Avoid paying cache lookup and validation costs when the result set is
    // larger than the number of entries the bounded cache can cover.
    const indexedText =
      normalizedSearchQuery && emails.length <= MAX_EMAIL_TEXT_INDEX_ENTRIES
        ? indexedEmailText(email)
        : undefined;
    const normalizedFrom =
      normalizedSelectedSenders.length > 0 ? readTextField(email.from).toLowerCase() : '';
    // Search query filter (after parsing shortcuts)
    // Per-message labels (if present) are searchable. Avoid building the label
    // blob when there is no search query at all.
    let matchesSearch = true;
    if (normalizedSearchQuery) {
      const labelEntry = emailLabelsById[emailLabelKeyForEmail(email, defaultRecipient)];
      const storedLabels = (Array.isArray(labelEntry) ? labelEntry : []).join(' ');
      const labelsField = (email as { labels?: unknown }).labels;
      const tagsField = (email as { tags?: unknown }).tags;
      const labelBlob = [
        storedLabels,
        (email as { label?: string }).label,
        Array.isArray(labelsField) ? labelsField.join(' ') : '',
        (email as { tag?: string }).tag,
        Array.isArray(tagsField) ? tagsField.join(' ') : '',
        (email as { emailLabel?: string }).emailLabel,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      matchesSearch =
        (indexedText
          ? normalizedField(indexedText, 'subject', readTextField(email.subject))
          : readTextField(email.subject).toLowerCase()
        ).includes(normalizedSearchQuery) ||
        (indexedText
          ? normalizedField(indexedText, 'from', readTextField(email.from))
          : readTextField(email.from).toLowerCase()
        ).includes(normalizedSearchQuery) ||
        (indexedText
          ? normalizedField(indexedText, 'fromName', readTextField(email.from_name))
          : readTextField(email.from_name).toLowerCase()
        ).includes(normalizedSearchQuery) ||
        (indexedText
          ? normalizedField(indexedText, 'bodyPlain', readTextField(email.body_plain))
          : readTextField(email.body_plain).toLowerCase()
        ).includes(normalizedSearchQuery) ||
        (indexedText
          ? normalizedField(indexedText, 'body', readTextField(email.body))
          : readTextField(email.body).toLowerCase()
        ).includes(normalizedSearchQuery) ||
        (labelBlob.length > 0 && labelBlob.includes(normalizedSearchQuery));
    }

    // OTP-only filter (exclude the '------' placeholder that means "no code")
    const matchesOtp = !otpOnly || email.isOtp || isRealOtp(email.otp);
    const matchesUnread = !unreadOnly || email.unread === true;

    // Has-attachment filter (metadata only - some providers can't download)
    const matchesAttachment =
      !hasAttachment ||
      (Array.isArray(email.attachments) && email.attachments.length > 0) ||
      email.hasAttachment === true;

    // Sender domain filter
    const matchesDomain =
      !normalizedSenderDomain || matchesAddressTerm(email.from, normalizedSenderDomain);

    // Sender email filter (exact match on the bare address, RFC-style safe)
    const matchesSenderEmail =
      !normalizedSenderEmail || addressFrom(email.from || '') === normalizedSenderEmail;

    // Recipient filter (to:address)
    const recipientValue =
      email.original_inbox || (email as Email & { address?: string }).address || defaultRecipient;
    const matchesRecipient =
      !normalizedRecipient || matchesAddressTerm(recipientValue, normalizedRecipient);

    // Subject filter
    const matchesSubject =
      !normalizedSubject || email.subject?.toLowerCase().includes(normalizedSubject);

    // Excluded sender domain (!from:domain)
    const matchesNotDomain =
      !normalizedNotSenderDomain || !matchesAddressTerm(email.from, normalizedNotSenderDomain);

    // Excluded sender email (!from:email)
    const matchesNotSenderEmail =
      !normalizedNotSenderEmail || addressFrom(email.from || '') !== normalizedNotSenderEmail;

    // Excluded recipient (!to:address)
    const matchesNotRecipient =
      !normalizedNotRecipient || !matchesAddressTerm(recipientValue, normalizedNotRecipient);

    // Excluded subject text (!subject:text)
    const matchesNotSubject =
      !normalizedNotSubject || !email.subject?.toLowerCase().includes(normalizedNotSubject);

    // Selected senders filter (multi-select)
    const matchesSelectedSenders =
      normalizedSelectedSenders.length === 0 ||
      normalizedSelectedSenders.some((sender) => normalizedFrom.includes(sender));

    // Date range filter
    const receivedAtMs = indexedText?.receivedAtMs ?? toMs(email.received_at);
    const matchesDateRange =
      (fromDateMs === undefined || receivedAtMs >= fromDateMs) &&
      (toDateMs === undefined || receivedAtMs <= toDateMs);

    return (
      matchesSearch &&
      matchesOtp &&
      matchesUnread &&
      matchesAttachment &&
      matchesDomain &&
      matchesSenderEmail &&
      matchesRecipient &&
      matchesSubject &&
      matchesNotDomain &&
      matchesNotSenderEmail &&
      matchesNotRecipient &&
      matchesNotSubject &&
      matchesSelectedSenders &&
      matchesDateRange
    );
  });

  // Always copy before sort so we never mutate a shared array reference
  const sorted = [...filtered];
  let sortKeys: Map<Email, string> | undefined;
  let sortTimestamps: Map<Email, number> | undefined;
  if (sortBy === 'newest' || sortBy === 'oldest' || !sortBy) {
    sortTimestamps = new Map();
    for (const email of sorted) sortTimestamps.set(email, toMs(email.received_at));
  } else if (sortBy === 'senderNameAsc' || sortBy === 'senderNameDesc') {
    sortKeys = new Map();
    for (const email of sorted) {
      sortKeys.set(
        email,
        (readTextField(email.from_name) || readTextField(email.from)).toLowerCase()
      );
    }
  } else if (sortBy === 'senderEmailAsc' || sortBy === 'senderEmailDesc') {
    sortKeys = new Map();
    for (const email of sorted) sortKeys.set(email, readTextField(email.from).toLowerCase());
  } else if (sortBy === 'subjectAsc' || sortBy === 'subjectDesc') {
    sortKeys = new Map();
    for (const email of sorted) sortKeys.set(email, readTextField(email.subject).toLowerCase());
  }
  const byId = (a: Email, b: Email) => String(a.id).localeCompare(String(b.id));

  sorted.sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case 'oldest':
        cmp =
          (sortTimestamps?.get(a) ?? toMs(a.received_at)) -
          (sortTimestamps?.get(b) ?? toMs(b.received_at));
        break;
      case 'senderNameAsc':
        cmp = (sortKeys?.get(a) || '').localeCompare(sortKeys?.get(b) || '');
        break;
      case 'senderNameDesc':
        cmp = (sortKeys?.get(b) || '').localeCompare(sortKeys?.get(a) || '');
        break;
      case 'senderEmailAsc':
        cmp = (sortKeys?.get(a) || '').localeCompare(sortKeys?.get(b) || '');
        break;
      case 'senderEmailDesc':
        cmp = (sortKeys?.get(b) || '').localeCompare(sortKeys?.get(a) || '');
        break;
      case 'subjectAsc':
        cmp = (sortKeys?.get(a) || '').localeCompare(sortKeys?.get(b) || '');
        break;
      case 'subjectDesc':
        cmp = (sortKeys?.get(b) || '').localeCompare(sortKeys?.get(a) || '');
        break;
      default: // 'newest' and unknown sorts
        cmp =
          (sortTimestamps?.get(b) ?? toMs(b.received_at)) -
          (sortTimestamps?.get(a) ?? toMs(a.received_at));
        break;
    }
    return cmp !== 0 ? cmp : byId(a, b);
  });

  return sorted;
}

/**
 * Creates a reactive email filter with memoization
 * @param emails - Reactive array of emails
 * @param options - Reactive filter options
 * @returns Reactive filtered emails
 */
export function useEmailFilter(
  emails: () => Email[],
  options: () => EmailFilterOptions
): () => Email[] {
  let cacheKey = '';
  let cachedResult: Email[] = [];
  let hasCachedResult = false;

  return () => {
    const currentEmails = emails();
    const currentOptions = options();
    const emailSig = currentEmails
      .map(
        (e) =>
          `${e.id}:${e.unread ? 1 : 0}:${e.received_at}:${e.local_archived ? 1 : 0}:${e.local_deleted ? 1 : 0}:${e.subject || ''}:${e.from || ''}:${e.from_name || ''}:${e.isOtp ? 1 : 0}:${e.otp || ''}:${e.hasAttachment ? 1 : 0}:${e.attachments?.length ?? 0}:${e.original_inbox || ''}`
      )
      .join('|');
    const key = `${JSON.stringify(currentOptions)}#${currentEmails.length}#${emailSig}`;

    if (hasCachedResult && key === cacheKey) {
      return cachedResult;
    }

    const result = filterEmails(currentEmails, currentOptions);
    cacheKey = key;
    cachedResult = result;
    hasCachedResult = true;
    return result;
  };
}
