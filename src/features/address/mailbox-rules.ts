/**
 * Inbox rules engine - "when a new message matches → label · auto-archive · silence".
 *
 * A rule matches a message by case-insensitive substring on the sender
 * (from / from_name), subject, or body - optionally restricted to an
 * allowlist of senders/domains - and applies one or more actions:
 *   - recipientAllowlist:  (condition) restrict the rule to messages arriving
 *                          at listed recipient addresses/domains - so different
 *                          disposable addresses can have different rules.
 *   - label:               adds a label to the message via the shared
 *                          `emailLabels` map (mailbox-scoped email key -> string[]).
 *   - autoArchiveDays:     schedules the RECIPIENT mailbox for auto-archive
 *                          N days after the first match, reusing the site-rule
 *                          archive schedule and independent archive alarm.
 *   - silenceNotifications: suppresses OS notifications for matching messages
 *                          (OTP delivery / auto-copy still fire - a verification
 *                          code is never silenced).
 *   - autoCopyOtp:         copies the newest OTP among matching messages to the
 *                          clipboard (one write per batch), independent of the
 *                          global autoCopy setting.
 *   - forwardTo:           opens the user's mail client with a prefilled
 *                          "Fwd: …" compose for the matching message (the app
 *                          has no outbound SMTP - this mirrors the manual
 *                          forward button's mailto: handoff). Rate-limited to
 *                          one compose per rule per minute so a mail burst
 *                          cannot spawn a tab storm.
 *
 * First enabled matching rule wins per message (list order = priority).
 */
import { browser } from 'wxt/browser';
import { validateMailboxRuleInput } from '@/features/intelligence/rule-validation.js';
import {
  archiveRuleSignature,
  reconcileArchiveSchedulesForRuleSet,
} from '@/features/intelligence/site-rules.js';
import { copyToClipboardFromBackground } from '@/utils/clipboard/clipboard.js';
import { emailLabelKeyForEmail } from '@/utils/email/email-label-key.js';
import { tSync } from '@/utils/i18n/i18n-background.js';
import { logError } from '@/utils/logger.js';
import { withLock } from '@/utils/mutex.js';
import { isRealOtp } from '@/utils/otp/otp-code.js';
import {
  normalizeVerificationPreferences,
  verificationExpiresAt,
} from '@/utils/otp/verification-policy.js';
import { updateEmailLabelsMap } from '@/utils/storage/storage-keys.js';
import { createLockedListRepository } from '@/utils/storage/storage-repository.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { toMs } from '@/utils/time/time.js';
import { formatFullDateTime } from '@/utils/time/time-format.js';
import type { Address, Email } from '@/utils/types.js';

export type MailboxRuleField =
  | 'sender'
  | 'senderOrRecipient'
  | 'recipient'
  | 'subject'
  | 'body'
  | 'anywhere';

export interface MailboxRule {
  id: string;
  name: string;
  enabled: boolean;
  /** Which part of the message the rule inspects. */
  field: MailboxRuleField;
  /** Version 2 gives Sender its literal meaning. Earlier rules searched both ends. */
  matchingVersion?: 2;
  /** Case-insensitive substring to search for. */
  contains: string;
  /**
   * Optional sender/domain allowlist: when non-empty, the rule only matches
   * messages whose sender is listed - as a full address (`a@x.com`), a bare
   * domain (`x.com`), or `@x.com`. Empty/undefined = no sender restriction.
   */
  senderAllowlist?: string[];
  /**
   * Optional RECIPIENT inbox address/domain allowlist: when non-empty, the
   * rule only matches messages delivered to a listed address - full address
   * (`foo@bar.com`), bare domain (`bar.com`), or `@bar.com`. Empty/undefined =
   * applies to every inbox.
   */
  recipientAllowlist?: string[];
  /** Label applied to matching emails ('' / undefined = none). */
  label?: string;
  /** Auto-archive the recipient mailbox N days after the first match (0/null = off). */
  autoArchiveDays?: number | null;
  /** Suppress OS notifications for matching messages. */
  silenceNotifications?: boolean;
  /** Copy the newest OTP among matching messages to the clipboard. */
  autoCopyOtp?: boolean;
  /** Destination email for the prefilled mailto: forward compose (undefined = off). */
  forwardTo?: string;
  createdAt: number;
  updatedAt: number;
}

export const MAILBOX_RULES_STORAGE_KEY = 'mailboxRules';

export interface MailboxRuleMatchStats {
  /** Number of messages matched by this rule (since stats tracking). */
  count: number;
  /** ms epoch of the most recent match. */
  lastMatchedAt: number;
  /** The rule's field at last match. */
  field: MailboxRuleField;
  /** Action failures are separate from matches; a match is not proof of success. */
  failedActions?: number;
  lastSucceeded?: MailboxRuleAction[];
}

export type MailboxRuleAction = 'label' | 'archive' | 'silence' | 'copy' | 'forward';

export const MAILBOX_RULES_STATS_KEY = 'mailboxRuleMatchStats';

export async function loadMailboxRuleStats(): Promise<Record<string, MailboxRuleMatchStats>> {
  try {
    const res = (await browser.storage.local.get([MAILBOX_RULES_STATS_KEY])) as Record<
      string,
      unknown
    >;
    const stats = res[MAILBOX_RULES_STATS_KEY] as Record<string, MailboxRuleMatchStats> | undefined;
    return stats && typeof stats === 'object' ? stats : {};
  } catch {
    return {};
  }
}

/**
 * Batch-record match counts for rules (one storage write per apply run).
 * Best-effort display data - must never break the mail pipeline.
 */
export async function recordMailboxRuleMatches(
  counts: Map<
    string,
    { n: number; field: MailboxRuleField; failedActions?: number; succeeded?: MailboxRuleAction[] }
  >
): Promise<void> {
  if (counts.size === 0) return;
  try {
    await withLock('mailbox_rule_stats_lock', async () => {
      const stats = await loadMailboxRuleStats();
      const now = Date.now();
      for (const [id, { n, field, failedActions = 0, succeeded = [] }] of counts) {
        const prev = stats[id];
        stats[id] = {
          count: (prev?.count ?? 0) + n,
          lastMatchedAt: now,
          field,
          failedActions: (prev?.failedActions ?? 0) + failedActions,
          lastSucceeded: succeeded,
        };
      }
      await writeWithRetry({ [MAILBOX_RULES_STATS_KEY]: stats });
    });
  } catch {
    /* ignore */
  }
}

/** Drop a rule's match stats (keeps the stats map bounded to live rules). */
export async function clearMailboxRuleStats(ruleIds?: Iterable<string>): Promise<void> {
  try {
    await withLock('mailbox_rule_stats_lock', async () => {
      const stats = await loadMailboxRuleStats();
      if (!ruleIds) {
        if (Object.keys(stats).length > 0) {
          await writeWithRetry({ [MAILBOX_RULES_STATS_KEY]: {} });
        }
        return;
      }
      let changed = false;
      for (const id of ruleIds) {
        if (id in stats) {
          delete stats[id];
          changed = true;
        }
      }
      if (changed) await writeWithRetry({ [MAILBOX_RULES_STATS_KEY]: stats });
    });
  } catch {
    /* ignore */
  }
}
const MAX_MAILBOX_RULES = 40;

const mailboxRulesRepository = () =>
  createLockedListRepository<MailboxRule>(browser.storage.local, MAILBOX_RULES_STORAGE_KEY, {
    maxItems: MAX_MAILBOX_RULES,
    overflow: 'reject',
    lockName: 'mailbox_rules_lock',
    onSaved: async (previous, next) => {
      await reconcileArchiveSchedulesForRuleSet(previous, next, 'mailbox');
      const liveIds = new Set(next.map((rule) => rule.id));
      await clearMailboxRuleStats(
        previous.filter((rule) => !liveIds.has(rule.id)).map((rule) => rule.id)
      );
    },
    parse: (value) =>
      Array.isArray(value)
        ? value
            .filter(
              (rule): rule is MailboxRule =>
                !!rule &&
                typeof rule === 'object' &&
                typeof (rule as MailboxRule).id === 'string' &&
                typeof (rule as MailboxRule).contains === 'string'
            )
            .map((rule) =>
              rule.field === 'sender' && rule.matchingVersion !== 2
                ? { ...rule, field: 'senderOrRecipient' as const }
                : rule
            )
        : [],
  });

export async function loadMailboxRules(): Promise<MailboxRule[]> {
  try {
    return await mailboxRulesRepository().load();
  } catch {
    /* ignore */
    return [];
  }
}

export async function saveMailboxRules(rules: MailboxRule[]): Promise<void> {
  await mailboxRulesRepository().save(rules);
}

export async function upsertMailboxRule(
  partial: Partial<MailboxRule> & { contains: string }
): Promise<MailboxRule> {
  const validation = validateMailboxRuleInput(partial);
  if (validation) throw new Error(validation);
  let result: MailboxRule | undefined;
  await mailboxRulesRepository().update((rules) => {
    const now = Date.now();
    if (partial.id) {
      const idx = rules.findIndex((r) => r.id === partial.id);
      if (idx >= 0) {
        result = {
          ...rules[idx],
          ...partial,
          contains: partial.contains.trim(),
          updatedAt: now,
          matchingVersion: 2,
        };
        const next = [...rules];
        next[idx] = result;
        return next;
      }
    }
    result = {
      id: `inbox-rule_${now}_${Math.random().toString(36).slice(2, 8)}`,
      name: partial.name || partial.contains,
      enabled: partial.enabled !== false,
      field: partial.field ?? 'sender',
      matchingVersion: 2,
      contains: partial.contains.trim(),
      senderAllowlist: partial.senderAllowlist?.length ? [...partial.senderAllowlist] : undefined,
      recipientAllowlist: partial.recipientAllowlist?.length
        ? [...partial.recipientAllowlist]
        : undefined,
      label: partial.label || undefined,
      autoArchiveDays: partial.autoArchiveDays ?? null,
      silenceNotifications: partial.silenceNotifications === true,
      autoCopyOtp: partial.autoCopyOtp === true,
      forwardTo: partial.forwardTo || undefined,
      createdAt: now,
      updatedAt: now,
    };
    return [result, ...rules];
  });
  return result as MailboxRule;
}

export async function deleteMailboxRule(id: string): Promise<void> {
  await mailboxRulesRepository().removeWhere((rule) => rule.id === id);
  await clearMailboxRuleStats([id]);
}

/**
 * Move a rule up (-1) or down (+1) in the list. List order IS priority
 * (first enabled match wins), so this reorders which rule fires first.
 * Out-of-range moves and unknown ids are no-ops.
 */
export async function moveMailboxRule(id: string, delta: -1 | 1): Promise<void> {
  await mailboxRulesRepository().update((rules) => {
    const idx = rules.findIndex((r) => r.id === id);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= rules.length) return rules;
    const next = [...rules];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    return next;
  });
}

/** Whether a single rule matches a message (case-insensitive substring). */
export function ruleMatchesMessage(
  rule: MailboxRule,
  msg: Email,
  /** Delivery address the message arrived at (inbox address or original_inbox). */
  recipient?: string
): boolean {
  if (!rule.enabled || !rule.contains) return false;
  const needle = rule.contains.toLowerCase();
  let haystack = '';
  if (rule.field === 'sender') {
    haystack = `${msg.from || ''} ${msg.from_name || ''}`;
  } else if (rule.field === 'recipient') {
    haystack = msg.original_inbox || recipient || '';
  } else if (rule.field === 'senderOrRecipient') {
    haystack = `${msg.from || ''} ${msg.from_name || ''} ${msg.original_inbox || ''} ${recipient || ''}`;
  } else if (rule.field === 'anywhere') {
    // “Anywhere” scans everything visible on the message: sender, recipient,
    // subject, and body.
    haystack = `${msg.from || ''} ${msg.from_name || ''} ${msg.original_inbox || ''} ${recipient || ''} ${msg.subject || ''} ${msg.body_plain || msg.body || ''}`;
  } else if (rule.field === 'subject') {
    haystack = msg.subject || '';
  } else {
    haystack = msg.body_plain || msg.body || '';
  }
  return haystack.toLowerCase().includes(needle);
}

/**
 * Extract the bare sender address from a From header, which may be
 * `user@x.com` or `"Name <user@x.com>"`. Returns null when unparsable.
 */
export function parseSenderAddress(raw: string | undefined): string | null {
  const angle = /<([^<>]+)>/.exec(raw || '');
  const addr = (angle ? angle[1] : raw || '').trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+$/.test(addr) ? addr : null;
}

/** Domain part of a parsed sender address ('' for invalid). */
export function senderDomain(addr: string | null): string {
  if (!addr) return '';
  const at = addr.lastIndexOf('@');
  return at >= 0 ? addr.slice(at + 1) : '';
}

/**
 * Sender/domain allowlist condition: true when the rule has no allowlist, or
 * the message sender matches an entry as a full address, a bare domain, or an
 * `@domain` suffix (all case-insensitive).
 */
export function rulePassesAllowlist(rule: MailboxRule, msg: Email): boolean {
  const list = rule.senderAllowlist;
  if (!list || list.length === 0) return true;
  const addr = parseSenderAddress(msg.from);
  if (!addr) return false;
  return allowlistMatches(list, addr);
}

/**
 * Recipient inbox address/domain condition: true when the rule has no
 * recipient allowlist, or the delivery address matches an entry as a full
 * address, a bare domain, or an `@domain` suffix (all case-insensitive).
 */
export function rulePassesRecipientAllowlist(
  rule: MailboxRule,
  recipient: string | undefined
): boolean {
  const list = rule.recipientAllowlist;
  if (!list || list.length === 0) return true;
  const addr = parseSenderAddress(recipient);
  if (!addr) return false;
  return allowlistMatches(list, addr);
}

/** Shared entry matching for sender/recipient allowlists. */
function allowlistMatches(list: string[], addr: string): boolean {
  const domain = senderDomain(addr);
  for (const raw of list) {
    const entry = (raw || '').trim().toLowerCase();
    if (!entry) continue;
    if (entry === addr) return true;
    if (entry.startsWith('@') && addr.endsWith(entry)) return true;
    if (domain && entry === domain) return true;
  }
  return false;
}

/**
 * First enabled matching rule for a message (list order = priority).
 * `recipient` is the delivery address the message arrived at (inbox address
 * or the message's `original_inbox`); undefined = no recipient condition.
 */
export function matchMailboxRule(
  msg: Email,
  rules: MailboxRule[],
  recipient?: string
): MailboxRule | null {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!rulePassesRecipientAllowlist(rule, recipient)) continue;
    if (ruleMatchesMessage(rule, msg, recipient) && rulePassesAllowlist(rule, msg)) return rule;
  }
  return null;
}

export interface MailboxRuleApplyResult {
  /** Email ids whose rule requested notification silence. */
  silencedIds: Set<string>;
  /** Number of messages that matched a rule. */
  matchedCount: number;
  /** When a rule scheduled a mailbox auto-archive (ms epoch), if any. */
  archiveAt?: number;
  /** Number of forward composes opened (rate-limited per rule). */
  forwardedCount: number;
  /** 1 when the newest matching OTP was copied to the clipboard this batch. */
  otpCopiedCount: number;
  failedActions: number;
}

/**
 * Evaluate the inbox rules against freshly-arrived messages and apply their
 * actions: merge labels into the shared emailLabels map, schedule the recipient
 * mailbox for auto-archive via the site-rule schedule (consumed by the
 * periodic alarm sweep), and return the set of silenced message ids so the
 * caller can suppress their OS notifications.
 *
 * Never throws - rule failures must not break the mail pipeline.
 */
export async function applyMailboxRulesToNewMessages(
  record: Address | undefined,
  messages: Email[]
): Promise<MailboxRuleApplyResult> {
  const result: MailboxRuleApplyResult = {
    silencedIds: new Set(),
    matchedCount: 0,
    forwardedCount: 0,
    otpCopiedCount: 0,
    failedActions: 0,
  };
  if (!messages.length) return result;

  let rules: MailboxRule[] = [];
  try {
    rules = await loadMailboxRules();
  } catch {
    return result;
  }
  if (!rules.some((r) => r.enabled)) return result;

  const labelUpdates = new Map<string, { label: string; ruleId: string }>();
  const archivePlans = new Set<string>();
  const now = Date.now();
  let maxAgeMinutes = 0;
  try {
    maxAgeMinutes = normalizeVerificationPreferences(
      (await browser.storage.local.get('verificationPreferences')).verificationPreferences
    ).maxAgeMinutes;
  } catch (error) {
    logError('Mailbox rule could not read OTP expiry preferences; skipping automatic copy', error);
  }
  /** Newest OTP among messages matched by an autoCopyOtp rule (one copy per batch). */
  let otpToCopy: { otp: string; receivedAt: number; ruleId: string } | null = null;
  /** Per-rule match counts for this batch (aggregated → one stats write). */
  const ruleMatchCounts = new Map<
    string,
    { n: number; field: MailboxRuleField; failedActions?: number; succeeded?: MailboxRuleAction[] }
  >();
  const markFailed = (ruleId: string) => {
    result.failedActions++;
    const entry = ruleMatchCounts.get(ruleId);
    if (entry) entry.failedActions = (entry.failedActions ?? 0) + 1;
  };
  const markSucceeded = (ruleId: string, action: MailboxRuleAction) => {
    const entry = ruleMatchCounts.get(ruleId);
    if (!entry) return;
    entry.succeeded ??= [];
    if (!entry.succeeded.includes(action)) entry.succeeded.push(action);
  };

  for (const msg of messages) {
    // Recipient = the mailbox the message actually arrived at (may differ from
    // the polling inbox for forwarded/reassigned mail).
    const recipient = msg.original_inbox || record?.address;
    const rule = matchMailboxRule(msg, rules, recipient);
    if (!rule) continue;
    result.matchedCount++;
    const matchEntry = ruleMatchCounts.get(rule.id);
    if (matchEntry) matchEntry.n++;
    else ruleMatchCounts.set(rule.id, { n: 1, field: rule.field });
    if (rule.label)
      labelUpdates.set(emailLabelKeyForEmail(msg, record?.address), {
        label: rule.label,
        ruleId: rule.id,
      });
    if (rule.silenceNotifications) {
      result.silencedIds.add(msg.id);
      markSucceeded(rule.id, 'silence');
    }
    if (
      rule.autoCopyOtp &&
      maxAgeMinutes > 0 &&
      isRealOtp(msg.otp) &&
      verificationExpiresAt(msg.received_at, msg.otpExpiresAt, maxAgeMinutes, now) > now &&
      (!otpToCopy || toMs(msg.received_at) > otpToCopy.receivedAt)
    ) {
      otpToCopy = { otp: msg.otp, receivedAt: toMs(msg.received_at), ruleId: rule.id };
    }
    if (rule.autoArchiveDays && rule.autoArchiveDays > 0) archivePlans.add(rule.id);
    if (rule.forwardTo && now - (lastForwardAt.get(rule.id) || 0) >= FORWARD_COOLDOWN_MS) {
      lastForwardAt.set(rule.id, now);
      try {
        await browser.tabs.create({ url: buildForwardMailtoUrl(msg, rule.forwardTo) });
        result.forwardedCount++;
        markSucceeded(rule.id, 'forward');
      } catch (error) {
        markFailed(rule.id);
        logError('Mailbox rule could not open forwarding draft', error);
      }
    }
  }

  // Labels: merge into the shared emailLabels map so per-message labels survive
  // re-renders and the EmailList/MessageDetail label UI picks them up.
  if (labelUpdates.size > 0) {
    try {
      await updateEmailLabelsMap((map) => {
        const next = { ...map };
        for (const [msgId, { label }] of labelUpdates) {
          const labels = next[msgId] || [];
          if (!labels.includes(label)) next[msgId] = [...labels, label];
        }
        return next;
      });
      for (const { ruleId } of labelUpdates.values()) markSucceeded(ruleId, 'label');
    } catch (err) {
      for (const { ruleId } of labelUpdates.values()) markFailed(ruleId);
      logError(
        'Failed to apply mailbox-rule labels',
        undefined,
        err instanceof Error ? err : new Error(String(err))
      );
    }
  }

  // Auto-copy OTP: a single clipboard write per batch with the newest code,
  // independent of the global autoCopy setting (explicit rule opt-in).
  if (otpToCopy) {
    try {
      if (await copyToClipboardFromBackground(otpToCopy.otp)) {
        result.otpCopiedCount = 1;
        markSucceeded(otpToCopy.ruleId, 'copy');
      } else {
        markFailed(otpToCopy.ruleId);
        logError('Mailbox rule clipboard copy failed');
      }
    } catch (error) {
      markFailed(otpToCopy.ruleId);
      logError('Mailbox rule clipboard copy failed', error);
    }
  }

  // Auto-archive: retain the first matching message's deadline for this
  // address/rule pair instead of pushing the archive date out on every poll.
  if (archivePlans.size && record?.id) {
    try {
      const { scheduleAddressArchiveInDays } = await import(
        '@/features/intelligence/site-rules.js'
      );
      result.archiveAt = await withLock('mailbox_rules_lock', async () => {
        // A rule can be disabled/deleted while the mail side effects are running.
        let earliest: number | undefined;
        for (const current of await loadMailboxRules()) {
          if (!archivePlans.has(current.id) || !current.enabled || !current.autoArchiveDays)
            continue;
          const deadline = await scheduleAddressArchiveInDays(
            record.id,
            current.autoArchiveDays,
            {
              ruleId: current.id,
              ruleKind: 'mailbox',
              ruleSignature: archiveRuleSignature(current, 'mailbox'),
              domain: record.address,
            },
            { preserveFirstDeadline: true }
          );
          if (deadline !== null) {
            earliest = Math.min(earliest ?? deadline, deadline);
            markSucceeded(current.id, 'archive');
          }
        }
        return earliest;
      });
    } catch (error) {
      for (const id of archivePlans) markFailed(id);
      logError('Mailbox rule could not schedule inbox archive', error);
    }
  }

  await recordMailboxRuleMatches(ruleMatchCounts);
  return result;
}

// ── Forward-to-email action ─────────────────────────────────────────────────

/**
 * One forwarded compose per rule per window - prevents a mail burst from
 * spawning a tab storm while still forwarding each new burst.
 */
export const FORWARD_COOLDOWN_MS = 60_000;

/** ruleId → last forward time (module state; reset by tests via resetForwardCooldowns). */
const lastForwardAt = new Map<string, number>();

/** Reset the per-rule forward cooldowns (used by tests). */
export function resetForwardCooldowns(): void {
  lastForwardAt.clear();
}

/**
 * Build a prefilled `mailto:` compose URL for a forwarded message - the same
 * handoff the manual forward button uses (the app has no outbound SMTP).
 */
/**
 * Copy text to the clipboard from the background with durable background purge.
 * Delegates to copyToClipboardFromBackground in clipboard.ts.
 */
export async function copyOtpToClipboard(otp: string): Promise<boolean> {
  return await copyToClipboardFromBackground(otp);
}

export function buildForwardMailtoUrl(msg: Email, destination: string): string {
  // The forwarded body is user-facing mail content, so every stand-in comes
  // from the SAME keys the manual forward button uses (MailView) - an English
  // default here would silently win over those keys for the rule-driven path.
  const noSubject = tSync('notifications.noSubject');
  const subject = encodeURIComponent(
    `${tSync('inbox.emailActions.forwardSubjectPrefix')} ${msg.subject || noSubject}`
  );
  const body = encodeURIComponent(
    `\n\n${tSync('inbox.emailActions.forwardHeader')}\n` +
      `${tSync('inbox.emailActions.forwardFromLabel')} ${msg.from || tSync('notifications.unknownSender')}\n` +
      `${tSync('inbox.emailActions.forwardDateLabel')} ${msg.received_at ? formatFullDateTime(msg.received_at) : tSync('common.unknown')}\n` +
      `${tSync('inbox.emailActions.forwardSubjectLabel')} ${msg.subject || noSubject}\n\n` +
      `${msg.body_plain || msg.body || tSync('inbox.emailActions.forwardNoContent')}`
  );
  // `@` must stay literal in the mailto To: field - some clients render an
  // encoded %40 as the literal recipient text instead of decoding it.
  const to = encodeURIComponent(destination).replace(/%40/gi, '@');
  return `mailto:${to}?subject=${subject}&body=${body}`;
}
