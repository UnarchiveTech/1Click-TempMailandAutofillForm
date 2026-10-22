import { describe, expect, test } from 'bun:test';
import { exportAnalyticsToCSV } from '@/utils/email/csv-export';
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
    expect(csv).toContain('"guerrilla","62.50"');
    expect(csv).toContain('"burner","35.00"');
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
          address: 'test@guerrilla.com',
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

  test('escapes provider-latency rows against formula injection (provider name is config-controlled)', () => {
    const analytics: Analytics = {
      ...baseAnalytics,
      performance: {
        emailFetchTimes: [],
        providerLatency: {
          '=HYPERLINK("http://evil.example","click")': [50, 75],
          '@SUM(1+1)': [30, 40],
        },
        uiRenderTimes: [],
      },
    };
    const csv = exportAnalyticsToCSV(analytics, []);
    // The leading = and @ must be neutralized with the guard apostrophe, and
    // the row must stay properly quoted so the embedded quotes/commas cannot
    // break out of the field.
    expect(csv).toContain('"\'=HYPERLINK(""http://evil.example"",""click"")","62.50"');
    expect(csv).toContain('"\'@SUM(1+1)","35.00"');
    // And the raw payload must never start a row unguarded (line-anchored
    // check - the neutralized "'=…" form IS allowed and asserted above).
    const providerSection = csv.slice(csv.indexOf('Provider Latency (ms)'));
    expect(providerSection).not.toMatch(/(^|\n)=HYPERLINK/);
    expect(providerSection).not.toMatch(/(^|\n)@SUM/);
  });

  test('escapes commas and quotes in a hostile provider name without breaking the row shape', () => {
    const analytics: Analytics = {
      ...baseAnalytics,
      performance: {
        emailFetchTimes: [],
        providerLatency: { 'my, "provider"': [10, 20] },
        uiRenderTimes: [],
      },
    };
    const csv = exportAnalyticsToCSV(analytics, []);
    expect(csv).toContain('"my, ""provider""","15.00"');
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

  test('analytics export uses the same quote-when-needed rules as the identity exports', () => {
    const events: ActivityEvent[] = [
      {
        id: '1',
        type: 'email_received',
        timestamp: 1700000000000,
        data: { subject: 'Plain subject', sender: '@risky' },
      },
    ];
    const csv = exportAnalyticsToCSV(baseAnalytics, events);
    // Non-delimiter fields are always-quoted (unified escaper contract), the
    // formula-injection guard applies identically to leading @.
    expect(csv).toContain('"Plain subject"');
    expect(csv).toContain(`"'@risky"`);
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
      { id: '3', type: 'address_created', timestamp: 1700000002000, data: {} },
    ];
    const csv = exportAnalyticsToCSV(baseAnalytics, events);
    expect(csv).toContain('email_received');
    expect(csv).toContain('otp_detected');
    expect(csv).toContain('address_created');
  });

  test('handles empty event data fields gracefully', () => {
    const events: ActivityEvent[] = [
      { id: '1', type: 'email_received', timestamp: 1700000000000, data: {} },
    ];
    const csv = exportAnalyticsToCSV(baseAnalytics, events);
    // Should not crash; empty fields become "" (unified escaper contract).
    const lines = csv.split('\n');
    const dataLines = lines.filter((l) => l.includes('email_received'));
    expect(dataLines.length).toBe(1);
    expect(dataLines[0]).toContain(',"",');
  });
});
