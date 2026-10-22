import { describe, expect, test } from 'bun:test';
import {
  type ClearClipboardOutcome,
  clearClipboardNow,
  remainingPurgeRecords,
} from '@/utils/clipboard/clear-clipboard.js';
import type { ClipboardPurgeRecord } from '@/utils/clipboard/clipboard.js';

const purgeRecord = (copiedAt?: number): ClipboardPurgeRecord => ({
  hash: 'hash',
  purgeAt: 1_000,
  ...(copiedAt === undefined ? {} : { copiedAt }),
});

describe('clearClipboardNow', () => {
  test('reports unavailable when the clipboard cannot write', async () => {
    let settled = false;
    const outcome = await clearClipboardNow({
      clipboard: null,
      settle: async () => {
        settled = true;
      },
    });

    expect(outcome).toBe<ClearClipboardOutcome>('unavailable');
    expect(settled).toBe(false);
  });

  test('reports unavailable when the write is rejected, and settles nothing', async () => {
    const written: string[] = [];
    let settled = false;
    const outcome = await clearClipboardNow({
      clipboard: {
        writeText: async (value) => {
          written.push(value);
          throw new Error('document is not focused');
        },
      },
      settle: async () => {
        settled = true;
      },
    });

    expect(written).toEqual(['']);
    expect(outcome).toBe<ClearClipboardOutcome>('unavailable');
    expect(settled).toBe(false);
  });

  test('never claims a clear it could not read back', async () => {
    let settled = false;
    const outcome = await clearClipboardNow({
      clipboard: {
        writeText: async () => {},
        // No readText at all: the platform can write but not verify.
      },
      settle: async () => {
        settled = true;
      },
    });

    expect(outcome).toBe<ClearClipboardOutcome>('unverified');
    expect(settled).toBe(false);
  });

  test('treats a rejected read as unverified', async () => {
    let settled = false;
    const outcome = await clearClipboardNow({
      clipboard: {
        writeText: async () => {},
        readText: async () => {
          throw new Error('clipboard read denied');
        },
      },
      settle: async () => {
        settled = true;
      },
    });

    expect(outcome).toBe<ClearClipboardOutcome>('unverified');
    expect(settled).toBe(false);
  });

  test('treats a non-empty read-back as unverified (another writer raced the wipe)', async () => {
    let settled = false;
    const outcome = await clearClipboardNow({
      clipboard: {
        writeText: async () => {},
        readText: async () => 'something the user copied since',
      },
      settle: async () => {
        settled = true;
      },
    });

    expect(outcome).toBe<ClearClipboardOutcome>('unverified');
    expect(settled).toBe(false);
  });

  test('clears and settles the queue only after a verified empty read-back', async () => {
    let written = '';
    let settleStartedAt = 0;
    const outcome = await clearClipboardNow({
      clipboard: {
        writeText: async (value) => {
          written = value;
        },
        readText: async () => '',
      },
      now: () => 4_242,
      settle: async (startedAt) => {
        settleStartedAt = startedAt;
      },
    });

    expect(written).toBe('');
    expect(outcome).toBe<ClearClipboardOutcome>('cleared');
    expect(settleStartedAt).toBe(4_242);
  });

  test('stays cleared when settling the queue fails (the wipe already succeeded)', async () => {
    const outcome = await clearClipboardNow({
      clipboard: {
        writeText: async () => {},
        readText: async () => '',
      },
      settle: async () => {
        throw new Error('storage unavailable');
      },
    });

    expect(outcome).toBe<ClearClipboardOutcome>('cleared');
  });
});

describe('remainingPurgeRecords', () => {
  test('keeps only records copied after the clear began', () => {
    const older = purgeRecord(900);
    const sameInstant = purgeRecord(1_000);
    const newer = purgeRecord(1_001);
    const legacy = purgeRecord();

    expect(remainingPurgeRecords([older, sameInstant, newer, legacy], 1_000)).toEqual([newer]);
  });

  test('keeps every record when all copies landed after the clear began', () => {
    const first = purgeRecord(1_001);
    const second = purgeRecord(2_000);

    expect(remainingPurgeRecords([first, second], 1_000)).toEqual([first, second]);
  });

  test('drops everything when the queue is already empty', () => {
    expect(remainingPurgeRecords([], 1_000)).toEqual([]);
  });
});
