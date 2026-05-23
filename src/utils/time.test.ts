import { formatDate, formatTimeLeft, getEmailStatus, timeAgo } from './time';
import type { Account } from './types';

describe('timeAgo', () => {
  test('returns empty string for falsy timestamp', () => {
    expect(timeAgo(0)).toBe('');
    expect(timeAgo(null as unknown as number)).toBe('');
  });

  test('returns seconds ago for recent timestamps', () => {
    const now = Date.now();
    const timestamp = Math.floor((now - 30000) / 1000); // 30 seconds ago
    const result = timeAgo(timestamp);
    expect(result).toMatch(/\d+s ago/); // Match any seconds ago
  });

  test('returns minutes ago for timestamps within an hour', () => {
    const now = Date.now();
    const timestamp = Math.floor((now - 1800000) / 1000); // 30 minutes ago
    expect(timeAgo(timestamp)).toBe('30m ago');
  });

  test('returns hours ago for timestamps within a day', () => {
    const now = Date.now();
    const timestamp = Math.floor((now - 7200000) / 1000); // 2 hours ago
    expect(timeAgo(timestamp)).toBe('2h ago');
  });

  test('returns days ago for timestamps over a day', () => {
    const now = Date.now();
    const timestamp = Math.floor((now - 172800000) / 1000); // 2 days ago
    expect(timeAgo(timestamp)).toBe('2d ago');
  });
});

describe('formatDate', () => {
  // eslint-disable-next-line lint/style/useTemplate
  test('returns Never for falsy timestamp', () => {
    expect(formatDate(0)).toBe('Never');
    expect(formatDate(null as unknown as string)).toBe('Never');
  });

  test('returns Today for today', () => {
    const today = new Date();
    expect(formatDate(today.toISOString())).toBe('Today');
  });

  test('returns Yesterday for yesterday', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(formatDate(yesterday.toISOString())).toBe('Yesterday');
  });

  test('returns days ago for within a week', () => {
    const date = new Date();
    date.setDate(date.getDate() - 3);
    expect(formatDate(date.toISOString())).toBe('3 days ago');
  });

  test('returns locale date string for older dates', () => {
    const date = new Date();
    date.setDate(date.getDate() - 10);
    expect(formatDate(date.toISOString())).toBe(date.toLocaleDateString());
  });
});

describe('formatTimeLeft', () => {
  test('returns Expired for falsy or negative milliseconds', () => {
    expect(formatTimeLeft(0)).toBe('Expired');
    expect(formatTimeLeft(-1000)).toBe('Expired');
  });

  test('returns formatted time with hours and minutes', () => {
    expect(formatTimeLeft(3600000 + 1800000)).toBe('1:30'); // 1h 30m
    expect(formatTimeLeft(7200000 + 30000)).toBe('2:00'); // 2h 30s
  });

  test('returns minutes only for less than an hour', () => {
    expect(formatTimeLeft(1800000)).toBe('30m'); // 30 minutes
    expect(formatTimeLeft(300000)).toBe('5m'); // 5 minutes
  });
});

describe('getEmailStatus', () => {
  test('returns archived for archived inbox', () => {
    const inbox: Account = {
      id: 'test',
      address: 'test@example.com',
      provider: 'test',
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      accountStatus: 'archived',
    };
    expect(getEmailStatus(inbox)).toBe('archived');
  });

  test('returns expired for expired inbox', () => {
    const inbox: Account = {
      id: 'test',
      address: 'test@example.com',
      provider: 'test',
      createdAt: Date.now(),
      expiresAt: Date.now() - 3600000,
    };
    expect(getEmailStatus(inbox)).toBe('expired');
  });

  test('returns active for active inbox', () => {
    const inbox: Account = {
      id: 'test',
      address: 'test@example.com',
      provider: 'test',
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    };
    expect(getEmailStatus(inbox)).toBe('active');
  });
});
