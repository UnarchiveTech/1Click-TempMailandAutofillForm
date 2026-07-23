import { describe, expect, test } from 'bun:test';
import { exportAnalyticsToCSV } from '@/utils/csv-export';
import type { ActivityEvent, Analytics } from '@/utils/types';

describe('exportAnalyticsToCSV', () => {
  const baseAnalytics: Analytics = {
    createdAt: 1700000000000,
    accountsCreated: 5,
    emailsReceived: 42,
    otpsDetected: 10,
    notificationsSent: 30,
  };

  test('includes header and summary statistics', () => {
    const csv = exportAnalyticsToCSV(baseAnalytics, []);
    expect(csv).toContain('1Click Temp Mail - Analytics Export');
    expect(csv).toContain('SUMMARY STATISTICS');
    expect(csv).toContain('Inboxes Created,5');
    expect(csv).toContain('Emails Received,42');
    expect(csv).toContain('OTPs Detected,10');
    expect(csv).toContain('Notifications Sent,30');
  });

  test('includes tracking since date', () => {
    const csv = exportAnalyticsToCSV(baseAnalytics, []);
    expect(csv).toContain('Tracking Since,');
    expect(csv).not.toContain('N/A'); // createdAt is set
  });

  test('handles missing createdAt', () => {
    const analytics: Analytics = { ...baseAnalytics, createdAt: undefined };
    const csv = exportAnalyticsToCSV(analytics, []);
    expect(csv).toContain('Tracking Since,N/A');
  });

  test('includes performance metrics when available', () => {
    const analytics: Analytics = {
      ...baseAnalytics,
      performance: {
        emailFetchTimes: [100, 200, 150],
        providerLatency: { guerrilla: [50, 75], burner: [30, 40] },
        uiRenderTimes: [20, 30],
      },
    };
    const csv = exportAnalyticsToCSV(analytics, []);
    expect(csv).toContain('PERFORMANCE METRICS');
    expect(csv).toContain('Avg Email Fetch Time (ms),150.00');
    expect(csv).toContain('Avg UI Render Time (ms),25.00');
    expect(csv).toContain('Provider Latency (ms)');
    expect(csv).toContain('guerrilla,62.50');
    expect(csv).toContain('burner,35.00');
  });

  test('handles empty performance arrays', () => {
    const analytics: Analytics = {
      ...baseAnalytics,
      performance: { emailFetchTimes: [], providerLatency: {}, uiRenderTimes: [] },
    };
    const csv = exportAnalyticsToCSV(analytics, []);
    expect(csv).toContain('Avg Email Fetch Time (ms),N/A');
    expect(csv).toContain('Avg UI Render Time (ms),N/A');
  });

  test('includes activity events section header', () => {
    const csv = exportAnalyticsToCSV(baseAnalytics, []);
    expect(csv).toContain('ACTIVITY EVENTS');
    expect(csv).toContain('Timestamp,Type,Inbox Address,Sender,Subject,Website,Message,Toast Type');
  });

  test('includes activity events data', () => {
    const events: ActivityEvent[] = [
      {
        id: '1',
        type: 'email_received',
        timestamp: 1700000000000,
        data: {
          inboxAddress: 'test@guerrilla.com',
          sender: 'sender@test.com',
          subject: 'Test Email',
        },
      },
    ];
    const csv = exportAnalyticsToCSV(baseAnalytics, events);
    expect(csv).toContain('email_received');
    expect(csv).toContain('test@guerrilla.com');
    expect(csv).toContain('sender@test.com');
    expect(csv).toContain('Test Email');
  });

  test('escapes commas in CSV fields', () => {
    const events: ActivityEvent[] = [
      {
        id: '1',
        type: 'email_received',
        timestamp: 1700000000000,
        data: {
          subject: 'Hello, World',
          message: 'Test, message',
        },
      },
    ];
    const csv = exportAnalyticsToCSV(baseAnalytics, events);
    expect(csv).toContain('"Hello, World"');
    expect(csv).toContain('"Test, message"');
  });

  test('escapes quotes in CSV fields', () => {
    const events: ActivityEvent[] = [
      {
        id: '1',
        type: 'email_received',
        timestamp: 1700000000000,
        data: {
          subject: 'She said "hello"',
        },
      },
    ];
    const csv = exportAnalyticsToCSV(baseAnalytics, events);
    expect(csv).toContain('"She said ""hello"""');
  });

  test('escapes newlines in CSV fields', () => {
    const events: ActivityEvent[] = [
      {
        id: '1',
        type: 'email_received',
        timestamp: 1700000000000,
        data: {
          message: 'Line1\nLine2',
        },
      },
    ];
    const csv = exportAnalyticsToCSV(baseAnalytics, events);
    expect(csv).toContain('"Line1\nLine2"');
  });

  test('handles empty activity events', () => {
    const csv = exportAnalyticsToCSV(baseAnalytics, []);
    const lines = csv.split('\n');
    // Should have header line after ACTIVITY EVENTS header
    const eventsHeaderIdx = lines.findIndex((l) => l.startsWith('Timestamp,'));
    expect(eventsHeaderIdx).toBeGreaterThan(-1);
    // No data lines after header
    expect(lines.length).toBe(eventsHeaderIdx + 1);
  });

  test('handles multiple activity events', () => {
    const events: ActivityEvent[] = [
      { id: '1', type: 'email_received', timestamp: 1700000000000, data: {} },
      { id: '2', type: 'otp_detected', timestamp: 1700000001000, data: {} },
      { id: '3', type: 'account_created', timestamp: 1700000002000, data: {} },
    ];
    const csv = exportAnalyticsToCSV(baseAnalytics, events);
    expect(csv).toContain('email_received');
    expect(csv).toContain('otp_detected');
    expect(csv).toContain('account_created');
  });

  test('handles empty event data fields gracefully', () => {
    const events: ActivityEvent[] = [
      { id: '1', type: 'email_received', timestamp: 1700000000000, data: {} },
    ];
    const csv = exportAnalyticsToCSV(baseAnalytics, events);
    // Should not crash, fields should be empty strings
    const lines = csv.split('\n');
    const dataLines = lines.filter((l) => l.startsWith('20'));
    expect(dataLines.length).toBe(1);
  });
});
