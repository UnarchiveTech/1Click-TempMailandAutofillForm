import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import {
  isFormSurfaceAttributeChange,
  nodeHasFormSurface,
} from '@/entrypoints/content/content-frame-gate';

const dom = new JSDOM('<!doctype html><body></body>');
const doc = dom.window.document;
beforeEach(() => {
  doc.body.replaceChildren();
});
afterAll(() => dom.window.close());

describe('form surface mutation detection', () => {
  test('recognizes directly inserted fields, not only their wrappers', () => {
    for (const tag of ['form', 'input', 'select', 'textarea']) {
      expect(nodeHasFormSurface(doc.createElement(tag))).toBe(true);
    }
    expect(nodeHasFormSurface(doc.createTextNode('Sign in'))).toBe(false);
    expect(nodeHasFormSurface(doc.createElement('p'))).toBe(false);
  });
  test('recognizes a newly inserted host whose form is already in an open shadow', () => {
    const host = doc.createElement('div');
    host.attachShadow({ mode: 'open' }).innerHTML = '<form><input type="password"></form>';
    expect(nodeHasFormSurface(host)).toBe(true);
  });
  test('ignores extension-owned UI', () => {
    const injected = doc.createElement('div');
    injected.setAttribute('data-oneclick-injected', '');
    injected.innerHTML = '<input type="text">';
    expect(nodeHasFormSurface(injected)).toBe(false);
  });
  test('reacts to visibility changes but not field icon padding or positioning', () => {
    const input = doc.createElement('input');
    const change = (oldValue: string, css: string) => {
      input.style.cssText = css;
      return isFormSurfaceAttributeChange({
        type: 'attributes',
        target: input,
        attributeName: 'style',
        oldValue,
      });
    };
    expect(change('', 'padding-inline-end:28px')).toBe(false);
    expect(change('top:10px', 'top:20px')).toBe(false);
    expect(change('display:none', 'display:block')).toBe(true);
    expect(change('visibility:hidden', 'visibility:visible')).toBe(true);
    expect(change('opacity:0', 'opacity:1')).toBe(true);
  });
  test('reacts to hidden, disabled and class changes on a form surface', () => {
    const form = doc.createElement('form');
    for (const attributeName of ['hidden', 'disabled', 'class'])
      expect(
        isFormSurfaceAttributeChange({
          type: 'attributes',
          target: form,
          attributeName,
          oldValue: '',
        })
      ).toBe(true);
  });
});
