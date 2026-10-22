import type { ActivityEvent, ActivityEventType } from '@/utils/types.js';

export const ACTIVITY_DETAIL_LIMIT = 100;
export const ACTIVITY_HISTORY_DAYS = 90;
const EVENT_TYPES: readonly ActivityEventType[] = [
  'email_received',
  'otp_detected',
  'notification_sent',
  'address_created',
  'account_created',
  'account_deleted',
  'auto_fill',
  'toast_notification',
  'auto_extend',
  'hard_reset',
];

/** Narrow persisted records before they reach date formatters and keyed UI lists. */
export function parseActivityEvents(value: unknown): ActivityEvent[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .flatMap((raw): ActivityEvent[] => {
      if (
        !raw ||
        typeof raw !== 'object' ||
        typeof raw.id !== 'string' ||
        !raw.id ||
        seen.has(raw.id) ||
        !EVENT_TYPES.includes(raw.type) ||
        typeof raw.timestamp !== 'number' ||
        !Number.isFinite(raw.timestamp) ||
        raw.timestamp < 0 ||
        raw.timestamp > 8.64e15 ||
        !raw.data ||
        typeof raw.data !== 'object' ||
        Array.isArray(raw.data)
      )
        return [];
      seen.add(raw.id);
      const data: ActivityEvent['data'] = {};
      for (const key of [
        'address',
        'emailId',
        'otp',
        'sender',
        'subject',
        'website',
        'message',
        'provider',
        'errorCode',
      ] as const) {
        if (typeof raw.data[key] === 'string') data[key] = raw.data[key];
      }
      if (['success', 'error', 'warning', 'info'].includes(raw.data.toastType))
        data.toastType = raw.data.toastType;
      if (raw.data.outcome === 'success' || raw.data.outcome === 'failure')
        data.outcome = raw.data.outcome;
      return [
        {
          id: raw.id,
          type: raw.type === 'account_created' ? 'address_created' : raw.type,
          timestamp: raw.timestamp,
          data,
        },
      ];
    })
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, ACTIVITY_DETAIL_LIMIT);
}
export interface ActivityDay {
  day: string;
  counts: Partial<Record<ActivityEventType, number>>;
  failures: number;
}
export interface ActivityHistory {
  version: 1;
  startedAt: number;
  days: ActivityDay[];
}
export function activityDay(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function activityWebsiteHost(value: string): string {
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname
      .toLowerCase()
      .replace(/^www\./, '');
  } catch {
    return value
      .trim()
      .toLowerCase()
      .replace(/^www\./, '');
  }
}
export function isActivityFailure(event: ActivityEvent): boolean {
  return event.data.toastType === 'error' || event.data.outcome === 'failure';
}
export function pruneActivityHistory(history: ActivityHistory, now = Date.now()): ActivityHistory {
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - ACTIVITY_HISTORY_DAYS + 1);
  const days = history.days
    .filter((day) => day.day >= activityDay(cutoff.getTime()) && day.day <= activityDay(now))
    .map((day) => ({ ...day, counts: { ...day.counts } }));
  return {
    version: 1,
    startedAt: Math.min(now, Math.max(cutoff.getTime(), history.startedAt)),
    days,
  };
}
export function appendActivityHistory(
  history: ActivityHistory,
  event: ActivityEvent,
  now = Date.now()
): ActivityHistory {
  const next = pruneActivityHistory(history, now);
  const days = next.days;
  if (activityDay(event.timestamp) >= activityDay(next.startedAt) && event.timestamp <= now) {
    const key = activityDay(event.timestamp);
    let bucket = days.find((day) => day.day === key);
    if (!bucket) {
      bucket = { day: key, counts: {}, failures: 0 };
      days.push(bucket);
    }
    const type = event.type === 'account_created' ? 'address_created' : event.type;
    bucket.counts[type] = (bucket.counts[type] ?? 0) + 1;
    if (isActivityFailure(event)) bucket.failures++;
  }
  days.sort((a, b) => a.day.localeCompare(b.day));
  return { ...next, days };
}
export function seedActivityHistory(events: ActivityEvent[], now = Date.now()): ActivityHistory {
  let history: ActivityHistory = {
    version: 1,
    startedAt: Math.min(now, ...events.map((event) => event.timestamp)),
    days: [],
  };
  for (const event of events) history = appendActivityHistory(history, event, now);
  return history;
}
export function parseActivityHistory(value: unknown): ActivityHistory | null {
  if (!value || typeof value !== 'object') return null;
  const history = value as Partial<ActivityHistory>;
  if (
    history.version !== 1 ||
    typeof history.startedAt !== 'number' ||
    !Number.isFinite(history.startedAt) ||
    history.startedAt < 0 ||
    !Array.isArray(history.days)
  )
    return null;
  const seen = new Set<string>();
  if (
    history.days.length > ACTIVITY_HISTORY_DAYS ||
    history.days.some((day) => {
      if (
        !day ||
        typeof day !== 'object' ||
        typeof day.day !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(day.day) ||
        activityDay(new Date(`${day.day}T12:00:00`).getTime()) !== day.day ||
        seen.has(day.day) ||
        !day.counts ||
        typeof day.counts !== 'object' ||
        Array.isArray(day.counts) ||
        !Number.isSafeInteger(day.failures) ||
        day.failures < 0
      )
        return true;
      seen.add(day.day);
      return Object.entries(day.counts).some(
        ([type, count]) =>
          !EVENT_TYPES.includes(type as ActivityEventType) ||
          !Number.isSafeInteger(count) ||
          count < 0
      );
    })
  )
    return null;
  return history as ActivityHistory;
}

export type ActivityPeriod = 'all' | 'today' | 'week' | 'month' | 'custom';
export function activityPeriodBounds(
  period: ActivityPeriod,
  from: string,
  to: string,
  now = Date.now()
) {
  if (period === 'custom') return { from, to };
  if (period === 'all') return { from: '', to: '' };
  const first = new Date(now);
  first.setDate(first.getDate() - (period === 'week' ? 6 : period === 'month' ? 29 : 0));
  return { from: activityDay(first.getTime()), to: activityDay(now) };
}
export function matchesActivityEvent(
  event: ActivityEvent,
  filters: {
    query: string;
    type: string;
    chartType?: string;
    address: string;
    failures: boolean;
    from: string;
    to: string;
    hour: number | null;
    day: string | null;
  },
  translatedText = ''
): boolean {
  const day = activityDay(event.timestamp);
  if (
    (filters.from && day < filters.from) ||
    (filters.to && day > filters.to) ||
    (filters.day && day !== filters.day)
  )
    return false;
  if (filters.hour !== null && new Date(event.timestamp).getHours() !== filters.hour) return false;
  const type = event.type === 'account_created' ? 'address_created' : event.type;
  const groups: Record<string, readonly string[]> = {
    notification: ['notification_sent', 'toast_notification', 'auto_extend'],
    received: ['email_received', 'otp_detected'],
  };
  if (
    [filters.type, filters.chartType ?? 'all'].some(
      (filter) => filter !== 'all' && !(groups[filter]?.includes(type) ?? type === filter)
    )
  )
    return false;
  if (
    filters.address !== 'all' &&
    event.data.address?.toLowerCase() !== filters.address.toLowerCase()
  )
    return false;
  if (filters.failures && !isActivityFailure(event)) return false;
  const query = filters.query.trim().toLowerCase();
  return (
    !query ||
    [
      translatedText,
      type,
      event.data.address,
      event.data.sender,
      event.data.subject,
      event.data.website,
      event.data.provider,
      event.data.message,
      event.data.errorCode,
    ].some((text) => text?.toLowerCase().includes(query))
  );
}

export const ACTIVITY_CARD_IDS = [
  'timeSaved',
  'expiry',
  'timeline',
  'breakdown',
  'sites',
  'latency',
  'hours',
] as const;
export type ActivityCardId = (typeof ACTIVITY_CARD_IDS)[number];
export interface ActivityCardPreference {
  id: ActivityCardId;
  visible: boolean;
}
export function normalizeActivityCards(value: unknown): ActivityCardPreference[] {
  const result: ActivityCardPreference[] = [];
  if (Array.isArray(value))
    for (const item of value) {
      if (
        item &&
        ACTIVITY_CARD_IDS.includes(item.id) &&
        !result.some((card) => card.id === item.id)
      )
        result.push({ id: item.id, visible: item.visible !== false });
    }
  for (const id of ACTIVITY_CARD_IDS)
    if (!result.some((card) => card.id === id)) result.push({ id, visible: true });
  return result;
}
