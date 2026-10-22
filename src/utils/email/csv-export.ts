import type { ActivityEvent, Analytics, CredentialsHistoryItem, Identity } from '../types.js';

/**
 * Convert analytics data to CSV format
 * @param analytics - Analytics summary data
 * @param activityEvents - Detailed activity events
 * @returns CSV string
 */
export interface AnalyticsStorageSnapshot {
  addresses: number;
  emails: number;
  identities: number;
  /** Bytes used in extension storage */
  bytes: number;
}

export function exportAnalyticsToCSV(
  analytics: Analytics,
  activityEvents: ActivityEvent[],
  storageSnapshot?: AnalyticsStorageSnapshot
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
  lines.push(`Extension Opens,${analytics.extensionOpens || 0}`);
  lines.push(`Emails Read,${analytics.emailsRead || 0}`);
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
        // Provider names come from provider configs (bundled or imported via
        // the config wizard), so they take the same formula-injection escaper
        // as the event rows below - a name like "=HYPERLINK(…)" must not
        // survive into a CSV that spreadsheet apps execute on open.
        lines.push(`${escapeCsvField(provider)},${escapeCsvField(avgLatency)}`);
      }
    }
    lines.push('');
  }

  // Add storage snapshot section when the caller has one (mirrors Settings → Data).
  if (storageSnapshot) {
    lines.push('STORAGE SNAPSHOT');
    lines.push(`Addresses,${storageSnapshot.addresses}`);
    lines.push(`Stored Emails,${storageSnapshot.emails}`);
    lines.push(`Identities,${storageSnapshot.identities}`);
    lines.push(`Storage Used (bytes),${storageSnapshot.bytes}`);
    lines.push('');
  }

  // Add activity events section
  lines.push('ACTIVITY EVENTS');
  lines.push('Timestamp,Type,Inbox Address,Sender,Subject,Website,Message,Toast Type');

  for (const event of activityEvents) {
    const timestamp = new Date(event.timestamp).toISOString();
    const type = event.type;
    const address = event.data.address || '';
    const sender = event.data.sender || '';
    const subject = event.data.subject || '';
    const website = event.data.website || '';
    const message = event.data.message || '';
    const toastType = event.data.toastType || '';

    // Neutralize formula injection and escape commas/quotes/newlines via the
    // shared escaper (always-quoted - same rules as the Bitwarden/identity
    // exports, so every CSV this module emits quotes identically).
    lines.push(
      [
        escapeCsvField(timestamp),
        escapeCsvField(type),
        escapeCsvField(address),
        escapeCsvField(sender),
        escapeCsvField(subject),
        escapeCsvField(website),
        escapeCsvField(message),
        escapeCsvField(toastType),
      ].join(',')
    );
  }

  return lines.join('\n');
}

/**
 * Escape a CSV field value safely against formula injection and delimiters.
 * Always quotes (and emits "" for empty) - the unified escaper contract the
 * analytics, Bitwarden and identity exports share.
 */
export function escapeCsvField(field: string | null | undefined): string {
  if (!field) return '""';
  let val = String(field);
  if (/^[=+\-@\t\r]/.test(val)) {
    val = `'${val}`;
  }
  if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return `"${val}"`;
}

/**
 * Export saved logins to Bitwarden / 1Password compatible CSV format.
 */
export function exportLoginsToBitwardenCSV(logins: CredentialsHistoryItem[]): string {
  const lines: string[] = [];
  lines.push(
    'folder,favorite,type,name,notes,fields,login_uri,login_username,login_password,login_totp'
  );

  for (const login of logins) {
    const name = login.name || login.domain || 'Saved Login';
    const uri = login.website || (login.domain ? `https://${login.domain}` : '');
    const username = login.email || login.username || '';
    const password = login.password || '';
    const totp = login.totpSecret || '';

    lines.push(
      [
        '""', // folder
        '0', // favorite
        'login', // type
        escapeCsvField(name),
        '""', // notes
        '""', // fields
        escapeCsvField(uri),
        escapeCsvField(username),
        escapeCsvField(password),
        escapeCsvField(totp),
      ].join(',')
    );
  }

  return lines.join('\n');
}

/**
 * Export synthetic identities to CSV format.
 */
export function exportIdentitiesToCSV(identities: Identity[]): string {
  const lines: string[] = [];
  lines.push('id,name,firstNames,lastNames,phone,pin,country,gender,dateOfBirth');

  for (const identity of identities) {
    const raw = identity as unknown as Record<string, unknown>;
    lines.push(
      [
        escapeCsvField(identity.id),
        escapeCsvField(identity.name),
        escapeCsvField(identity.firstNames),
        escapeCsvField(identity.lastNames),
        escapeCsvField(identity.phone),
        escapeCsvField(identity.pin),
        escapeCsvField(raw.country as string),
        escapeCsvField(raw.gender as string),
        escapeCsvField(raw.dateOfBirth as string),
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
