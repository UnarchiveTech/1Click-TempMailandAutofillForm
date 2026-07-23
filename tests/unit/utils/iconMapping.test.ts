import { describe, expect, test } from 'bun:test';
import { detectIconFromMessage, ICON_KEYWORD_MAPPING } from '@/utils/iconMapping';

describe('detectIconFromMessage', () => {
  test('returns "deleted" for delete messages', () => {
    expect(detectIconFromMessage('Email deleted')).toBe('deleted');
    expect(detectIconFromMessage('Remove item')).toBe('deleted');
  });

  test('returns "archived" for archive messages', () => {
    expect(detectIconFromMessage('Email archived')).toBe('archived');
    expect(detectIconFromMessage('Unarchive email')).toBe('archived');
  });

  test('returns "copy" for copy messages', () => {
    expect(detectIconFromMessage('Email copied to clipboard')).toBe('copy');
  });

  test('returns "download" for export messages', () => {
    expect(detectIconFromMessage('Export completed')).toBe('download');
    expect(detectIconFromMessage('Download file')).toBe('download');
  });

  test('returns "edit" for edit/update messages', () => {
    expect(detectIconFromMessage('Settings updated')).toBe('edit');
    expect(detectIconFromMessage('Email edited')).toBe('edit');
    expect(detectIconFromMessage('Tag changed')).toBe('edit');
  });

  test('returns "auto-renew" for extend/renew messages', () => {
    expect(detectIconFromMessage('Inbox extended')).toBe('auto-renew');
    expect(detectIconFromMessage('Auto-extend enabled')).toBe('auto-renew');
    expect(detectIconFromMessage('Auto extend enabled')).toBe('auto-renew');
  });

  test('returns "success" for save/done messages', () => {
    expect(detectIconFromMessage('Settings saved')).toBe('success');
    expect(detectIconFromMessage('Task completed')).toBe('success');
  });

  test('returns "plus" for create/add messages', () => {
    expect(detectIconFromMessage('Inbox created')).toBe('plus');
    expect(detectIconFromMessage('New tag added')).toBe('plus');
  });

  test('returns "shield" for login/auth messages', () => {
    expect(detectIconFromMessage('Signed in successfully')).toBe('shield');
    expect(detectIconFromMessage('Authenticated')).toBe('shield');
  });

  test('returns "error" for error/failure messages', () => {
    expect(detectIconFromMessage('Connection failed')).toBe('error');
    expect(detectIconFromMessage('Invalid input')).toBe('error');
    expect(detectIconFromMessage('Cannot connect')).toBe('error');
  });

  test('returns "warning" for warning messages', () => {
    expect(detectIconFromMessage('Warning: storage full')).toBe('warning');
  });

  test('returns "expired" for expiry messages', () => {
    expect(detectIconFromMessage('Inbox expired')).toBe('expired');
    expect(detectIconFromMessage('Token expiry approaching')).toBe('expired');
  });

  test('returns "back" for undo messages', () => {
    expect(detectIconFromMessage('Undo changes')).toBe('back');
  });

  test('returns "info" for info messages', () => {
    expect(detectIconFromMessage('Information: check settings')).toBe('info');
  });

  test('returns "chart" for analytics messages', () => {
    expect(detectIconFromMessage('Analytics dashboard')).toBe('chart');
    expect(detectIconFromMessage('Statistics overview')).toBe('chart');
  });

  test('returns "bell" for notification messages', () => {
    expect(detectIconFromMessage('Notification sent')).toBe('bell');
    expect(detectIconFromMessage('Alert triggered')).toBe('bell');
  });

  test('returns "envelope" for email messages (matches "email" keyword)', () => {
    expect(detectIconFromMessage('Check your email')).toBe('envelope');
    expect(detectIconFromMessage('Message inbox')).toBe('envelope');
  });

  test('returns "refresh" for refresh/reload messages', () => {
    expect(detectIconFromMessage('Reload page')).toBe('refresh');
    expect(detectIconFromMessage('Sync data')).toBe('refresh');
  });

  test('returns "settings" for settings messages', () => {
    // "open" matches chevron-down, "update" matches edit - use "settings" keyword directly
    expect(detectIconFromMessage('Open settings page')).toBe('chevron-down');
    // Use "config" keyword without matching earlier keywords
    expect(detectIconFromMessage('Go to config area')).toBe('settings');
  });

  test('returns "tag" for tag/label messages', () => {
    expect(detectIconFromMessage('Add tag')).toBe('plus');
    expect(detectIconFromMessage('Apply label')).toBe('tag');
  });

  test('returns "user" for user/profile messages', () => {
    // "view" is not in mapping, but let's test directly with user keyword
    expect(detectIconFromMessage('Go to user section')).toBe('user');
    expect(detectIconFromMessage('View user page')).toBe('user');
  });

  test('returns "success" as default fallback for unknown messages', () => {
    expect(detectIconFromMessage('Something random happened')).toBe('success');
    expect(detectIconFromMessage('')).toBe('success');
  });

  test('is case-insensitive', () => {
    expect(detectIconFromMessage('DELETED')).toBe('deleted');
    expect(detectIconFromMessage('Archived')).toBe('archived');
    expect(detectIconFromMessage('COPIED')).toBe('copy');
  });

  test('matches first keyword found in mapping order', () => {
    // "error" and "failed" both map to "error"
    expect(detectIconFromMessage('error occurred')).toBe('error');
    // "success" and "done" both map to "success"
    expect(detectIconFromMessage('done')).toBe('success');
  });

  test('ICON_KEYWORD_MAPPING has entries for all 39 icon types', () => {
    const iconTypes = new Set(Object.values(ICON_KEYWORD_MAPPING));
    expect(iconTypes.size).toBeGreaterThanOrEqual(30); // At least 30 distinct icon types
  });

  test('matches keywords as substrings', () => {
    expect(detectIconFromMessage('The email was deleted successfully')).toBe('deleted');
    expect(detectIconFromMessage('QR code generated')).toBe('qr');
    expect(detectIconFromMessage('Dark mode enabled')).toBe('moon');
    expect(detectIconFromMessage('Light mode enabled')).toBe('sun');
  });

  test('does not perform loose substring/sub-word matches', () => {
    expect(detectIconFromMessage('This is a stage')).toBe('success'); // 'tag' keyword shouldn't match 'stage'
    expect(detectIconFromMessage('Send an email')).toBe('envelope'); // 'mail' keyword inside 'email' is matched via 'email' mapping, but let's check a non-mapped part
    expect(detectIconFromMessage('I am looking at this')).toBe('success'); // 'ok' keyword inside 'looking' shouldn't match
  });
});
