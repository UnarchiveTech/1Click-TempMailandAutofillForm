import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

let generatedName = '';
let nameSettings: unknown;
mock.module('wxt/browser', () => ({
  browser: {
    runtime: {
      id: 'test-extension',
      sendMessage: async (message: { type: string }) => {
        if (message.type === 'generateIdentityField')
          return { success: true, value: generatedName };
        if (message.type === 'getStorageViaBg') return { success: true, data: { nameSettings } };
        return { success: true };
      },
    },
  },
}));
afterAll(() => {
  mock.restore();
});

const { getNamesToFill } = await import('@/entrypoints/content/autofill/form-filler.js');
beforeEach(() => {
  generatedName = '';
  nameSettings = undefined;
});

describe('name autofill', () => {
  test('preserves every part of a generated multi-word name', async () => {
    generatedName = '  Mary   Jane Smith  ';
    expect(await getNamesToFill()).toEqual({
      firstName: 'Mary',
      lastName: 'Jane Smith',
      fullName: 'Mary   Jane Smith',
    });
  });
  test('a single name still returns a string for lastName', async () => {
    generatedName = 'Prince';
    expect(await getNamesToFill()).toEqual({
      firstName: 'Prince',
      lastName: '',
      fullName: 'Prince',
    });
  });
  test('a missing generated name produces no undefined fields', async () => {
    expect(await getNamesToFill()).toEqual({ firstName: '', lastName: '', fullName: '' });
  });
  test('custom first and last names retain their explicit boundaries', async () => {
    nameSettings = { useCustom: true, firstName: 'Mary Jane', lastName: 'Smith Jones' };
    expect(await getNamesToFill()).toEqual({
      firstName: 'Mary Jane',
      lastName: 'Smith Jones',
      fullName: 'Mary Jane Smith Jones',
    });
  });
});
