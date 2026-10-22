import { describe, expect, test } from 'bun:test';
import { collectVerificationMagicLinks } from '@/features/address/verification-items.js';
import type { Email } from '@/utils/types.js';

function email(id: string, received_at: number, links: NonNullable<Email['magicLinks']>): Email {
  return { id, received_at, magicLinks: links };
}

describe('collectVerificationMagicLinks', () => {
  test('collects all links and orders newest messages first', () => {
    const result = collectVerificationMagicLinks([
      email('older', 100, [
        { url: 'https://example.com/old', host: 'example.com', score: 8 },
        { url: 'https://example.com/shared', host: 'example.com', score: 10 },
      ]),
      email('newer', 200, [
        { url: 'https://example.com/new', host: 'example.com', score: 7 },
        { url: 'https://example.com/shared', host: 'example.com', score: 6 },
      ]),
    ]);

    expect(result.map((link) => link.url)).toEqual([
      'https://example.com/new',
      'https://example.com/shared',
      'https://example.com/old',
    ]);
    expect(result.find((link) => link.url.endsWith('/shared'))?.email.id).toBe('newer');
  });

  test('prefers the highest score when duplicate links have the same timestamp', () => {
    const result = collectVerificationMagicLinks([
      email('first', 100, [{ url: 'https://example.com/login', score: 4 }]),
      email('second', 100, [{ url: 'https://example.com/login', score: 9 }]),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.score).toBe(9);
    expect(result[0]?.email.id).toBe('second');
  });

  test('ignores archived and deleted messages', () => {
    const result = collectVerificationMagicLinks([
      {
        ...email('archived', 300, [{ url: 'https://example.com/archived', score: 10 }]),
        local_archived: true,
      },
      {
        ...email('deleted', 200, [{ url: 'https://example.com/deleted', score: 10 }]),
        local_deleted: true,
      },
      email('live', 100, [{ url: 'https://example.com/live', score: 10 }]),
    ]);

    expect(result.map((link) => link.url)).toEqual(['https://example.com/live']);
  });
});
