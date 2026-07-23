import type { ActivityEvent, Analytics } from './types.js';

/**
 * Convert analytics data to CSV format
 * @param analytics - Analytics summary data
 * @param activityEvents - Detailed activity events
 * @returns CSV string
 */
export function exportAnalyticsToCSV(
  analytics: Analytics,
  activityEvents: ActivityEvent[]
): string {
  const lines: string[] = [];

  // Add summary section
  lines.push('1Click Temp Mail - Analytics Export');
  lines.push(`Export Date,${new Date().toISOString()}`);
  lines.push('');
  lines.push('SUMMARY STATISTICS');
  lines.push(`Inboxes Created,${analytics.accountsCreated}`);
  lines.push(`Emails Received,${analytics.emailsReceived}`);
  lines.push(`OTPs Detected,${analytics.otpsDetected}`);
  lines.push(`Notifications Sent,${analytics.notificationsSent}`);
  lines.push(
    `Tracking Since,${analytics.createdAt ? new Date(analytics.createdAt).toISOString() : 'N/A'}`
  );
  lines.push('');

  // Add performance metrics if available
  if (analytics.performance) {
    lines.push('PERFORMANCE METRICS');
    const avgEmailFetch =
      analytics.performance.emailFetchTimes.length > 0
        ? (
            analytics.performance.emailFetchTimes.reduce((a, b) => a + b, 0) /
            analytics.performance.emailFetchTimes.length
          ).toFixed(2)
        : 'N/A';
    lines.push(`Avg Email Fetch Time (ms),${avgEmailFetch}`);

    const avgUIRender =
      analytics.performance.uiRenderTimes.length > 0
        ? (
            analytics.performance.uiRenderTimes.reduce((a, b) => a + b, 0) /
            analytics.performance.uiRenderTimes.length
          ).toFixed(2)
        : 'N/A';
    lines.push(`Avg UI Render Time (ms),${avgUIRender}`);

    if (Object.keys(analytics.performance.providerLatency).length > 0) {
      lines.push('');
      lines.push('Provider Latency (ms)');
      for (const [provider, latencies] of Object.entries(analytics.performance.providerLatency)) {
        const avgLatency =
          Array.isArray(latencies) && latencies.length > 0
            ? (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)
            : 'N/A';
        lines.push(`${provider},${avgLatency}`);
      }
    }
    lines.push('');
  }

  // Add activity events section
  lines.push('ACTIVITY EVENTS');
  lines.push('Timestamp,Type,Inbox Address,Sender,Subject,Website,Message,Toast Type');

  for (const event of activityEvents) {
    const timestamp = new Date(event.timestamp).toISOString();
    const type = event.type;
    const inboxAddress = event.data.inboxAddress || '';
    const sender = event.data.sender || '';
    const subject = event.data.subject || '';
    const website = event.data.website || '';
    const message = event.data.message || '';
    const toastType = event.data.toastType || '';

    // Neutralize formula injection and escape commas/quotes/newlines in CSV fields
    const escapeField = (field: string) => {
      let val = field;
      if (/^[=+\-@\t\r]/.test(val)) {
        val = `'${val}`;
      }
      if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    lines.push(
      [
        escapeField(timestamp),
        escapeField(type),
        escapeField(inboxAddress),
        escapeField(sender),
        escapeField(subject),
        escapeField(website),
        escapeField(message),
        escapeField(toastType),
      ].join(',')
    );
  }

  return lines.join('\n');
}

/**
 * Download CSV file
 * @param csvContent - CSV string content
 * @param filename - Name of the file to download
 */
export function downloadCSV(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}
