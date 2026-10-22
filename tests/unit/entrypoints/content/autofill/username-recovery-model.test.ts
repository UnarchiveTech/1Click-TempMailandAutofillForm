import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import {
  acceptsUsername,
  classifyUsernameRejection,
  findUsernameRejection,
  proposeUsername,
} from '@/entrypoints/content/autofill/username-recovery-model.js';

const originalComputedStyle = globalThis.getComputedStyle;
let dom: JSDOM;
beforeEach(() => {
  dom?.window.close();
  dom = new JSDOM(
    '<form><div><input id="username" aria-describedby="error"><span id="error"></span></div><div><input type="email"><span role="alert">Email already exists</span></div></form>',
    { pretendToBeVisual: true }
  );
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  for (const element of dom.window.document.querySelectorAll('*')) {
    element.getBoundingClientRect = () => ({ width: 200, height: 40 }) as DOMRect;
  }
});
afterAll(() => {
  dom?.window.close();
  globalThis.getComputedStyle = originalComputedStyle;
});
function field(): HTMLInputElement {
  return dom.window.document.querySelector('input') as HTMLInputElement;
}
function error(text: string): void {
  errorElement().textContent = text;
}
function errorElement(): HTMLElement {
  const element = dom.window.document.getElementById('error');
  if (!element) throw new Error('Missing fixture error');
  return element;
}

describe('username rejection scope', () => {
  test('distinguishes taken usernames from invalid format and ordinary help', () => {
    expect(classifyUsernameRejection('Username is already taken')).toBe('taken');
    expect(classifyUsernameRejection('A user with that name already exists')).toBe('taken');
    expect(classifyUsernameRejection('Invalid username: use lowercase letters')).toBe('invalid');
    expect(classifyUsernameRejection('Your username is available')).toBeNull();
    expect(classifyUsernameRejection('Choose your username')).toBeNull();
  });
  test('supports site rejection messages in the supported languages', () => {
    for (const text of [
      'Benutzername bereits vergeben',
      'Nom déjà utilisé',
      'El usuario ya existe',
      'すでに使用されています',
      '用户名已占用',
      'ชื่อผู้ใช้ถูกใช้แล้ว',
      'اسم المستخدم موجود بالفعل',
    ]) {
      expect(classifyUsernameRejection(text)).toBe('taken');
    }
  });
  test('ignores an unrelated email rejection', () => {
    expect(findUsernameRejection(field())).toBeNull();
  });
  test('only uses related, visible errors', () => {
    error('Username already taken');
    expect(findUsernameRejection(field())).toBe('taken');
    errorElement().hidden = true;
    expect(findUsernameRejection(field())).toBeNull();
  });
  test('does not treat a format hint as a rejection until the field is invalid', () => {
    error('Username must contain letters');
    expect(findUsernameRejection(field())).toBeNull();
    field().setAttribute('aria-invalid', 'true');
    expect(findUsernameRejection(field())).toBe('invalid');
  });
  test('accepts a field-local alert without aria-describedby', () => {
    field().removeAttribute('aria-describedby');
    errorElement().setAttribute('role', 'alert');
    error('Username unavailable');
    expect(findUsernameRejection(field())).toBe('taken');
  });
  test('does not attribute a shared-container alert to username', () => {
    field().removeAttribute('aria-describedby');
    field().parentElement?.appendChild(dom.window.document.createElement('input'));
    errorElement().setAttribute('role', 'alert');
    error('Email already exists');
    expect(findUsernameRejection(field())).toBeNull();
  });
});
describe('replacement constraints', () => {
  test('honors explicit length and lowercase-only pattern', () => {
    field().minLength = 6;
    field().maxLength = 10;
    field().pattern = '[a-z]{6,10}';
    const candidate = proposeUsername(field(), 'MaryJane123', new Set(['maryjane123']));
    expect(candidate).toMatch(/^[a-z]{6,10}$/);
    expect(acceptsUsername(field(), candidate ?? '')).toBe(true);
  });
  test('supports numeric-only usernames', () => {
    field().minLength = 4;
    field().maxLength = 4;
    field().pattern = '[0-9]{4}';
    expect(proposeUsername(field(), 'alice', new Set())).toMatch(/^\d{4}$/);
  });
  test('never proposes the same rejected value, including different casing', () => {
    field().maxLength = 1;
    field().pattern = '[a-z]';
    const candidate = proposeUsername(field(), 'a', new Set(['a']));
    expect(candidate).not.toBe('a');
    expect(candidate).toMatch(/^[a-z]$/);
  });
  test('unsatisfiable lengths and complex patterns fall back to manual editing', () => {
    field().minLength = 12;
    field().maxLength = 3;
    expect(proposeUsername(field(), 'alice', new Set())).toBeNull();
    field().minLength = 3;
    field().maxLength = 3;
    field().pattern = 'XYZ';
    expect(proposeUsername(field(), 'alice', new Set())).toBeNull();
  });
  test('ignores stale custom server validity when validating a new candidate', () => {
    field().setCustomValidity('Username already taken');
    expect(acceptsUsername(field(), 'anotherUser')).toBe(true);
  });
});
