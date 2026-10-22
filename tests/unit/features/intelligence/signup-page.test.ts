import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { detectSignupPage, detectSignupWizardStep } from '@/features/intelligence/signup-page.js';

const dom = new JSDOM('<!doctype html><body></body>', {
  url: 'https://accounts.example.com/verify-email?next=/dashboard',
  pretendToBeVisual: true,
});
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true });
Object.defineProperty(globalThis, 'location', { value: dom.window.location, configurable: true });
Object.defineProperty(dom.window.Element.prototype, 'getBoundingClientRect', {
  value: () => ({ width: 200, height: 40 }),
  configurable: true,
});
beforeEach(() => {
  document.body.innerHTML = '';
  document.title = '';
});
afterAll(() => {
  dom.window.close();
});

describe('visible signup outcome evidence', () => {
  test('welcome titles and redirect parameters never prove account creation', () => {
    document.title = 'Welcome — verify email';
    expect(detectSignupWizardStep()).toBe('form');
    expect(detectSignupPage().accountCreated).toBe(false);
  });
  test('hidden old success and unsuccessful registration are not success', () => {
    document.body.innerHTML =
      '<div hidden><p>Registration complete</p></div><p role="alert">Registration unsuccessful</p>';
    expect(detectSignupPage()).toEqual({
      accountCreated: false,
      failed: true,
      emailVerification: 'unknown',
    });
  });
  test('negated success is not success', () => {
    document.body.innerHTML =
      '<p>Your email address has not been confirmed</p><p>Account was not created</p>';
    expect(detectSignupPage().emailVerification).toBe('unknown');
    expect(detectSignupPage().accountCreated).toBe(false);
  });
  test('email confirmation takes priority over created account', () => {
    document.body.innerHTML =
      '<h1>Your account has been created.</h1><p>Check your email and click the confirmation link.</p>';
    expect(detectSignupWizardStep()).toBe('otp');
    expect(detectSignupPage()).toEqual({
      accountCreated: true,
      failed: false,
      emailVerification: 'pending',
    });
  });
  test('magic-link waiting paragraphs require no OTP input', () => {
    document.body.innerHTML = '<p>Check your inbox. Click the confirmation link.</p>';
    expect(detectSignupPage().emailVerification).toBe('pending');
  });
  test('active verification wins over a visible older confirmation message', () => {
    document.body.innerHTML =
      '<p>Your email has been confirmed.</p><h2>Enter verification code</h2><input autocomplete="one-time-code">';
    expect(detectSignupPage().emailVerification).toBe('pending');
    expect(detectSignupWizardStep()).toBe('otp');
  });
  test('initial form future-verification help is not a waiting page', () => {
    document.body.innerHTML =
      '<input type="email"><input type="password"><p>Verify your email address after signup</p>';
    expect(detectSignupPage().emailVerification).toBe('unknown');
  });
  test('explicit confirmation is separate from account-created text', () => {
    document.body.innerHTML = '<p>Your email address has been confirmed.</p>';
    expect(detectSignupPage().emailVerification).toBe('confirmed');
    expect(detectSignupWizardStep()).toBe('done');
  });
  test.each(['display:none', 'visibility:hidden', 'opacity:0'])(
    'hidden ancestor %s is ignored',
    (style) => {
      document.body.innerHTML = `<div style="${style}"><p>Your email has been verified</p></div>`;
      expect(detectSignupPage().emailVerification).toBe('unknown');
    }
  );
});
