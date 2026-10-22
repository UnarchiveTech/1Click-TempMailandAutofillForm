import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { getExternalSubmitDestination } from '@/entrypoints/content/autofill/submit-destination.js';

let dom: JSDOM;

beforeAll(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://shop.example.com/signup',
  });
  const { window } = dom;
  for (const key of [
    'window',
    'document',
    'location',
    'HTMLFormElement',
    'HTMLButtonElement',
    'HTMLInputElement',
  ] as const) {
    Object.defineProperty(globalThis, key, {
      value: window[key],
      configurable: true,
      writable: true,
    });
  }
});

afterAll(() => {
  dom.window.close();
});

describe('getExternalSubmitDestination', () => {
  test('does not warn for same-site subdomain destinations', () => {
    document.body.innerHTML = '<form action="https://accounts.example.com/register"></form>';
    const form = document.querySelector('form') as HTMLFormElement;

    expect(getExternalSubmitDestination(form)).toBeNull();
  });

  test('warns when the base action sends credentials to another tenant', () => {
    dom.reconfigure({ url: 'https://a.github.io/signup' });
    document.body.innerHTML = '<form action="https://b.github.io/register"></form>';
    const form = document.querySelector('form') as HTMLFormElement;

    expect(getExternalSubmitDestination(form)).toEqual({
      currentSite: 'a.github.io',
      destinationSites: ['b.github.io'],
    });
  });

  test('includes submit-button formaction overrides and ignores non-submit controls', () => {
    dom.reconfigure({ url: 'https://shop.example.com/signup' });
    document.body.innerHTML = `
      <form id="signup" action="/register">
        <button type="button" formaction="https://unrelated.example/ignore">Cancel</button>
        <button type="submit" formaction="https://accounts.other.test/create">Continue</button>
      </form>
      <input type="image" form="signup" formaction="https://backup.other.test/create" alt="Submit">`;
    const form = document.querySelector('form') as HTMLFormElement;

    expect(getExternalSubmitDestination(form)).toEqual({
      currentSite: 'shop.example.com',
      destinationSites: ['accounts.other.test', 'backup.other.test'],
    });
  });

  test('warns on HTTPS to HTTP downgrade even on the same site', () => {
    dom.reconfigure({ url: 'https://shop.example.com/signup' });
    document.body.innerHTML = '<form action="http://shop.example.com/register"></form>';
    const form = document.querySelector('form') as HTMLFormElement;

    expect(getExternalSubmitDestination(form)?.destinationSites).toEqual([
      'http://shop.example.com',
    ]);
  });
});
