import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { RuntimeMessage, RuntimeMessageSender } from '@/utils/types.js';

const update = mock(async () => ({ success: true }));
mock.module('@/entrypoints/background/credentials/username-recovery.js', () => ({
  updatePendingSignupUsername: update,
}));
mock.module('wxt/browser', () => ({
  browser: {
    runtime: { id: 'own-extension', onMessage: { addListener() {} } },
    storage: { local: { get: async () => ({}) }, session: { get: async () => ({}) } },
  },
}));
afterAll(() => {
  mock.restore();
});
const { handlers, CONTENT_SCRIPT_ALLOWED_HANDLERS } = await import(
  '@/entrypoints/background/runtime/message-handler.js'
);
beforeEach(() => {
  update.mockClear();
});
const message: Extract<RuntimeMessage, { type: 'updatePendingSignupUsername' }> = {
  type: 'updatePendingSignupUsername',
  credentialId: 'signup-1',
  domain: 'signup.example',
  expectedUsername: 'alice',
  username: 'alice2',
};
async function send(sender: RuntimeMessageSender, payload = message): Promise<unknown> {
  const handler = handlers.updatePendingSignupUsername;
  if (!handler) throw new Error('Recovery handler not registered');
  let response: unknown;
  await handler(payload, sender, (value) => {
    response = value;
  });
  return response;
}
describe('username recovery sender boundary', () => {
  test('registered content handler accepts its own site', async () => {
    expect(CONTENT_SCRIPT_ALLOWED_HANDLERS.has('updatePendingSignupUsername')).toBe(true);
    expect(
      await send({
        id: 'own-extension',
        url: 'https://signup.example/create-account',
        tab: { id: 1 },
      })
    ).toEqual({ success: true });
    expect(update).toHaveBeenCalledTimes(1);
  });
  test('another site cannot mutate the signup record', async () => {
    expect(
      await send({ id: 'own-extension', url: 'https://other.example/', tab: { id: 1 } })
    ).toEqual({ success: false, error: 'errors.domainMismatch' });
    expect(update).not.toHaveBeenCalled();
  });
  test('missing sender origin cannot enter storage', async () => {
    expect(await send({ id: 'own-extension', tab: { id: 1 } })).toEqual({
      success: false,
      error: 'errors.domainMismatch',
    });
    expect(update).not.toHaveBeenCalled();
  });
  test('an unrelated iframe cannot inherit the parent tab domain', async () => {
    expect(
      await send({
        id: 'own-extension',
        url: 'https://other.example/frame',
        tab: { id: 1, url: 'https://signup.example/' },
      })
    ).toEqual({ success: false, error: 'errors.domainMismatch' });
    expect(update).not.toHaveBeenCalled();
  });
});
