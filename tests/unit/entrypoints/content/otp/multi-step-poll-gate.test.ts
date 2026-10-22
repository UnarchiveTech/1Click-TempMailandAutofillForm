/**
 * Unit tests for the multi-step OTP watcher's amortized storage-poll gate.
 *
 * The 1.2s poll keeps SW wakes for STEP DETECTION (DOM-only), but its
 * per-tick `latestOtp` storage read was redundant: the background's fillOTP
 * broadcast is the primary delivery path while a wait panel is mounted, and
 * the panel reads storage once at open. These tests pin
 * `shouldOtpStoragePoll` - read only on the inputs-appeared transition, or
 * at the 10s fallback cadence - so the accounting stays: with a mounted
 * panel, a 10-minute watch drops ~500 storage reads to ~60.
 */

import { describe, expect, test } from 'bun:test';
import {
  MULTI_STEP_OTP_STORAGE_POLL_MIN_GAP_MS,
  shouldOtpStoragePoll,
} from '@/entrypoints/content/otp/multi-step-otp.js';

describe('multi-step OTP storage-poll gate', () => {
  const GAP = MULTI_STEP_OTP_STORAGE_POLL_MIN_GAP_MS;

  test('fallback cadence is 10s', () => {
    expect(GAP).toBe(10_000);
  });

  test('no OTP inputs - never reads, even past the gap', () => {
    expect(shouldOtpStoragePoll(false, false, 0, 60_000)).toBe(false);
    expect(shouldOtpStoragePoll(false, true, 0, 60_000)).toBe(false);
  });

  test('inputs present but unchanged - waits for the gap', () => {
    expect(shouldOtpStoragePoll(true, true, 1_000, 1_000 + GAP - 1)).toBe(false);
    expect(shouldOtpStoragePoll(true, true, 1_000, 1_000 + GAP)).toBe(true);
  });

  test('inputs-appeared transition reads immediately, even inside the gap', () => {
    expect(shouldOtpStoragePoll(true, false, 1_000, 1_050)).toBe(true);
  });

  test('inputs-disappeared transition does not read', () => {
    expect(shouldOtpStoragePoll(false, true, 1_000, 1_050)).toBe(false);
  });
});
