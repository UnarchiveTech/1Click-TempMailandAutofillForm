import { beforeEach, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { detectHumanVerification } from '@/entrypoints/content/autofill/challenge-detector';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://example.test/',
});
const w = dom.window;
// JSDOM has no layout engine. Model visible boxes; individual tests override
// this geometry for empty provider placeholders and hidden ancestors.
w.Element.prototype.getBoundingClientRect = () => new w.DOMRect(0, 0, 300, 40);
Object.assign(globalThis, {
  window: w,
  document: w.document,
  HTMLElement: w.HTMLElement,
  Document: w.Document,
  getComputedStyle: w.getComputedStyle.bind(w),
});

beforeEach(() => {
  document.title = '';
});

describe('detectHumanVerification', () => {
  test('detects a branded Cloudflare waiting page without generic verification prose', () => {
    document.title = 'Just a moment...';
    document.body.innerHTML =
      '<h1 id="challenge_title">We’ll have you designing again soon</h1><script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>';
    expect(detectHumanVerification()).toEqual({
      detected: true,
      provider: 'generic',
      signal: 'prompt',
    });
    document.title = 'Create account';
    expect(detectHumanVerification()).toEqual({ detected: false });
  });
  test('a waiting-page title and challenge heading alone are insufficient', () => {
    document.title = 'Just a moment...';
    document.body.innerHTML = '<h1 id="challenge_title">Create your account</h1>';
    expect(detectHumanVerification()).toEqual({ detected: false });
  });
  test('an empty configured hCaptcha placeholder is not a rendered challenge', () => {
    document.body.innerHTML =
      '<form><input name="username"><div class="h-captcha" data-sitekey="public-test-key"></div></form>';
    const placeholder = document.querySelector('.h-captcha');
    if (!placeholder) throw new Error('Missing test placeholder');
    placeholder.getBoundingClientRect = () => new w.DOMRect(0, 0, 448, 0);
    expect(detectHumanVerification()).toEqual({ detected: false });
    placeholder.innerHTML = '<iframe title="Human verification"></iframe>';
    placeholder.getBoundingClientRect = () => new w.DOMRect(0, 0, 448, 80);
    expect(detectHumanVerification()).toEqual({
      detected: true,
      provider: 'hcaptcha',
      signal: 'widget',
    });
  });
  test('a hidden first marker does not mask a later rendered challenge', () => {
    document.body.innerHTML =
      '<div hidden><div class="h-captcha"></div></div><div class="h-captcha"></div>';
    const hiddenMarker = document.querySelector('.h-captcha');
    if (!hiddenMarker) throw new Error('Missing test marker');
    hiddenMarker.getBoundingClientRect = () => new w.DOMRect(0, 0, 0, 0);
    expect(detectHumanVerification()).toEqual({
      detected: true,
      provider: 'hcaptcha',
      signal: 'widget',
    });
  });
  test('a provider privacy notice is not an active challenge', () => {
    document.body.innerHTML =
      '<form><input name="username"><div class="mw-htmlform-field-HTMLHCaptchaField cdx-field">This site is protected by hCaptcha and its Privacy Policy and Terms of Service apply.</div></form>';
    expect(detectHumanVerification()).toEqual({ detected: false });
    for (const name of ['g-recaptcha', 'hcaptcha', 'cf-turnstile']) {
      document.body.innerHTML = `<p id="${name}-notice" class="${name}-privacy">Provider privacy policy</p>`;
      expect(detectHumanVerification()).toEqual({ detected: false });
    }
  });
  test('custom provider widget names still require verification when configured', () => {
    document.body.innerHTML =
      '<div class="custom-hcaptcha-widget" data-sitekey="public-test-key"></div>';
    expect(detectHumanVerification()).toEqual({
      detected: true,
      provider: 'hcaptcha',
      signal: 'widget',
    });
  });
  test('detects the full-page verification heading before any form exists', () => {
    document.title = 'Just a moment...';
    document.body.innerHTML = '<div role="main"><h2>Performing security verification</h2></div>';
    expect(detectHumanVerification()).toEqual({
      detected: true,
      provider: 'generic',
      signal: 'prompt',
    });
  });
  test('does not mistake a normal security article for a full-page challenge', () => {
    document.title = 'Cloudflare security guide';
    document.body.innerHTML = '<main><h2>Verifying you are human</h2></main>';
    expect(detectHumanVerification()).toEqual({ detected: false });
  });
  test('ignores a completed page with a hidden pending heading', () => {
    document.title = 'Just a moment...';
    document.body.innerHTML =
      '<main><h2 hidden>Verifying you are human</h2><h2>Verification successful. Waiting for the website to respond</h2></main>';
    expect(detectHumanVerification()).toEqual({ detected: false });
  });
  test('detects a reCAPTCHA widget', () => {
    document.body.innerHTML = '<div class="g-recaptcha" data-sitekey="public-test-key"></div>';

    expect(detectHumanVerification()).toEqual({
      detected: true,
      provider: 'recaptcha',
      signal: 'widget',
    });
  });

  test('detects a hCaptcha response field', () => {
    document.body.innerHTML = '<textarea name="h-captcha-response"></textarea>';

    expect(detectHumanVerification()).toEqual({
      detected: true,
      provider: 'hcaptcha',
      signal: 'response-field',
    });
  });

  test('detects a hidden reCAPTCHA response field', () => {
    document.body.innerHTML =
      '<textarea name="g-recaptcha-response" style="display:none"></textarea>';

    expect(detectHumanVerification()).toEqual({
      detected: true,
      provider: 'recaptcha',
      signal: 'response-field',
    });
  });

  test('allows retry after a reCAPTCHA response is populated', () => {
    document.body.innerHTML =
      '<div class="g-recaptcha"></div><textarea name="g-recaptcha-response" style="display:none"></textarea>';
    const response = document.querySelector<HTMLTextAreaElement>('textarea');
    if (response) response.value = 'completed-token';

    expect(detectHumanVerification()).toEqual({ detected: false });
  });

  test('allows retry when a widget remains mounted after hCaptcha completion', () => {
    document.body.innerHTML =
      '<div class="h-captcha"></div><textarea name="h-captcha-response" style="display:none"></textarea>';
    const response = document.querySelector<HTMLTextAreaElement>('textarea');
    if (response) response.value = 'completed-token';

    expect(detectHumanVerification()).toEqual({ detected: false });
  });

  test('detects a Cloudflare Turnstile iframe', () => {
    document.body.innerHTML =
      '<iframe src="https://challenges.cloudflare.com/turnstile/v0/api.js"></iframe>';

    expect(detectHumanVerification()).toEqual({
      detected: true,
      provider: 'turnstile',
      signal: 'widget',
    });
  });

  test('detects a generic human-verification dialog', () => {
    document.body.innerHTML = '<div role="dialog">Complete the security check to continue</div>';

    expect(detectHumanVerification()).toEqual({
      detected: true,
      provider: 'generic',
      signal: 'prompt',
    });
  });

  test('ignores hidden challenge markers', () => {
    document.body.innerHTML = '<div class="g-recaptcha" hidden></div>';

    expect(detectHumanVerification()).toEqual({ detected: false });
  });

  test('does not classify ordinary security documentation as a challenge', () => {
    document.body.innerHTML = '<p>Our security check protects your account.</p>';

    expect(detectHumanVerification()).toEqual({ detected: false });
  });

  test('supports scanning a form root without touching token values', () => {
    document.body.innerHTML =
      '<form><input name="email"><div class="cf-turnstile" data-sitekey="public-test-key"></div></form>';
    const form = document.querySelector('form');

    expect(form).not.toBeNull();
    expect(detectHumanVerification(form || undefined)).toEqual({
      detected: true,
      provider: 'turnstile',
      signal: 'widget',
    });
    expect(document.querySelector('[name="email"]')?.getAttribute('value')).toBeNull();
  });

  test('allows retry when completed response field is attached outside the form element', () => {
    document.body.innerHTML =
      '<form id="signup"><input name="email"><div class="cf-turnstile"></div></form>' +
      '<input type="hidden" name="cf-turnstile-response" value="completed-turnstile-token">';
    const form = document.querySelector('form');

    expect(detectHumanVerification(form || undefined)).toEqual({ detected: false });
  });
});
