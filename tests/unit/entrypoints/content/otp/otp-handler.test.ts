import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { cleanupDom, setupDom } from '../../../helpers/svelte-harness.js';

const showTooltip = mock(async (_input: HTMLInputElement, _text: string, _error: boolean) => {});
const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
mock.module('@/utils/i18n/content-i18n.js', () => ({ t: async (key: string) => key }));
mock.module('@/entrypoints/content/dom/tooltip.js', () => ({ showTooltip }));
afterAll(() => {
  mock.restore();
  cleanupDom();
  if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
  else Reflect.deleteProperty(globalThis, 'location');
});

const { findOtpInputs, fillOtp } = await import('@/entrypoints/content/otp/otp-handler.js');

beforeEach(() => {
  setupDom();
  cleanupDom();
  Object.defineProperty(globalThis, 'location', { configurable: true, value: window.location });
  document.body.innerHTML = '<h1>Enter the verification code</h1><form></form>';
  showTooltip.mockClear();
});

function boxes(count = 6, maxLength?: number): HTMLInputElement[] {
  const form = document.querySelector('form');
  if (!form) throw new Error('Missing test form');
  return Array.from({ length: count }, (_, i) => {
    const input = document.createElement('input');
    input.name = `userInput${i}`;
    input.inputMode = 'numeric';
    if (maxLength !== undefined) input.maxLength = maxLength;
    input.getBoundingClientRect = () =>
      ({ left: i * 40, top: 0, width: 32, height: 32 }) as DOMRect;
    form.append(input);
    return input;
  });
}

describe('segmented OTP fields', () => {
  test('finds default-size boxes without maxlength and fills each digit', async () => {
    const inputs = boxes();
    expect(inputs.every((input) => input.size === 20 && input.maxLength === -1)).toBe(true);
    expect(findOtpInputs()).toEqual(inputs);
    await fillOtp('123456');
    expect(inputs.map((input) => input.value)).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  test('autocomplete on the first digit still resolves the whole group', async () => {
    const inputs = boxes(6, 1);
    inputs[0].autocomplete = 'one-time-code';
    expect(findOtpInputs()).toEqual(inputs);
    await fillOtp('482901');
    expect(inputs.map((input) => input.value).join('')).toBe('482901');
  });

  test('an unbounded autocomplete field takes a whole code despite other numeric fields', async () => {
    const inputs = boxes();
    inputs[0].autocomplete = 'one-time-code';
    expect(findOtpInputs()).toEqual([inputs[0]]);
    await fillOtp('482901');
    expect(inputs[0].value).toBe('482901');
    expect(inputs.slice(1).every((input) => input.value === '')).toBe(true);
  });

  test('a keyword on only one digit still resolves the whole group', async () => {
    const inputs = boxes();
    inputs[0].name = 'otp';
    expect(findOtpInputs()).toEqual(inputs);
    await fillOtp('482901');
    expect(inputs.map((input) => input.value).join('')).toBe('482901');
  });

  test('numeric boxes on a page without OTP signals are not treated as codes', () => {
    boxes();
    document.body.querySelector('h1')?.remove();
    expect(findOtpInputs()).toEqual([]);
  });

  for (const code of ['12345', '1234567']) {
    test(`a ${code.length}-character code leaves six one-digit fields untouched`, async () => {
      const inputs = boxes(6, 1);
      inputs.forEach((input) => {
        input.value = '9';
      });
      await fillOtp(code);
      expect(inputs.map((input) => input.value)).toEqual(Array(6).fill('9'));
      expect(inputs.every((input) => input.maxLength === 1)).toBe(true);
      expect(showTooltip).toHaveBeenCalledWith(
        inputs[5],
        'contentAutofill.otpLengthMismatch',
        true
      );
    });
  }

  test('a wider final segment receives its current digit and the remainder exactly once', async () => {
    const inputs = boxes(4, 1);
    inputs.forEach((input, i) => {
      input.name = `otp${i}`;
    });
    inputs[3].maxLength = 3;
    await fillOtp('123456');
    expect(inputs.map((input) => input.value)).toEqual(['1', '2', '3', '456']);
    expect(inputs[3].maxLength).toBe(3);
  });
});
