import { describe, expect, test } from 'bun:test';
import {
  normalizeSavedLoginCredential,
  senderTabHostname,
} from '@/entrypoints/background/runtime/message-handler';
import type { RuntimeMessageSender } from '@/utils/types.js';

describe('normalizeSavedLoginCredential', () => {
  test('accepts minimal valid credential', () => {
    const cred = normalizeSavedLoginCredential({
      email: 'user@temp.mail',
      domain: 'signup.example.com',
      timestamp: 1_700_000_000_000,
    });
    expect(cred).toEqual({
      domain: 'signup.example.com',
      timestamp: 1_700_000_000_000,
      email: 'user@temp.mail',
      username: null,
    });
  });

  test('rejects missing domain or identity', () => {
    expect(normalizeSavedLoginCredential({ email: 'a@b.com' })).toBeNull();
    expect(normalizeSavedLoginCredential({ domain: 'example.com' })).toBeNull();
  });

  test('strips unknown fields', () => {
    const cred = normalizeSavedLoginCredential({
      email: 'user@temp.mail',
      domain: 'example.com',
      evil: '<script>',
      password: 'secret',
      signupStatus: 'pending_submit',
      policyUrls: ['https://example.com/terms'],
      filledFields: ['email', 'password'],
    });
    expect(cred?.password).toBe('secret');
    expect(cred?.signupStatus).toBe('pending_submit');
    expect(cred?.policyUrls).toEqual(['https://example.com/terms']);
    expect((cred as Record<string, unknown>).evil).toBeUndefined();
  });

  test('rejects invalid signupStatus', () => {
    const cred = normalizeSavedLoginCredential({
      email: 'user@temp.mail',
      domain: 'example.com',
      signupStatus: 'hacked',
    });
    expect(cred?.signupStatus).toBeUndefined();
  });

  test('drops non-http(s) policyUrls (javascript:/data: cannot reach tabs.create)', () => {
    const cred = normalizeSavedLoginCredential({
      email: 'user@temp.mail',
      domain: 'example.com',
      policyUrls: [
        'https://example.com/terms',
        'http://example.com/privacy',
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox(1)',
      ],
    });
    expect(cred?.policyUrls).toEqual(['https://example.com/terms', 'http://example.com/privacy']);
  });

  test('caps policyUrls length and count so a page cannot fill storage.local', () => {
    const giant = `https://example.com/${'a'.repeat(10_000)}`;
    const cred = normalizeSavedLoginCredential({
      email: 'user@temp.mail',
      domain: 'example.com',
      policyUrls: Array.from({ length: 50 }, (_, i) => `${giant}/${i}`),
    });
    expect(cred?.policyUrls).toHaveLength(20);
    for (const u of cred?.policyUrls ?? []) {
      expect(u.length).toBeLessThanOrEqual(2048);
    }
    expect(cred?.policyUrls?.[0]).toMatch(/^https:\/\/example\.com\/a+$/);
  });

  test('caps string field lengths (page-controlled strings cannot bloat storage)', () => {
    const blob = 'x'.repeat(5000);
    const cred = normalizeSavedLoginCredential({
      email: `user@${blob}.com`,
      domain: blob,
      name: blob,
      phone: blob,
      website: blob,
      password: blob,
      country: blob,
      filledFields: Array.from({ length: 80 }, () => blob),
    });
    expect(cred?.domain.length).toBeLessThanOrEqual(512);
    expect(cred?.email?.length).toBeLessThanOrEqual(512);
    expect(cred?.name?.length).toBeLessThanOrEqual(512);
    expect(cred?.phone?.length).toBeLessThanOrEqual(512);
    expect(cred?.website?.length).toBeLessThanOrEqual(512);
    expect(cred?.password?.length).toBeLessThanOrEqual(512);
    expect(cred?.filledFields).toHaveLength(50);
    for (const f of cred?.filledFields ?? []) expect(f.length).toBeLessThanOrEqual(128);
  });
});

describe('senderTabHostname', () => {
  test('extracts hostname from tab URL', () => {
    const sender: RuntimeMessageSender = {
      tab: { id: 1, url: 'https://accounts.example.com/signup' },
    };
    expect(senderTabHostname(sender)).toBe('accounts.example.com');
  });
});
