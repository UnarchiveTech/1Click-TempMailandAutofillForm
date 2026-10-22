import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { get } from 'svelte/store';
import { t } from 'svelte-i18n';

afterAll(() => {
  mock.restore();
});
const store: Record<string, unknown> = {};
type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
const listeners = new Set<ChangeListener>();
const writes: string[] = [];
const area = {
  get: async (keys?: string | string[] | null) => {
    if (keys == null) return { ...store };
    return Object.fromEntries(
      (Array.isArray(keys) ? keys : [keys]).map((key) => [key, store[key]])
    );
  },
  set: async (items: Record<string, unknown>) => {
    writes.push(...Object.keys(items));
    Object.assign(store, items);
    const changes = Object.fromEntries(
      Object.entries(items).map(([key, newValue]) => [key, { newValue }])
    );
    for (const listener of listeners) listener(changes, 'local');
  },
  remove: async (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
  },
};
const browser = {
  runtime: {
    id: 'test-extension',
    sendMessage: async () => ({ success: false }),
    getURL: (file: string) => `https://extension.test/${file}`,
  },
  storage: {
    local: area,
    session: area,
    onChanged: {
      addListener: (listener: ChangeListener) => {
        listeners.add(listener);
      },
      removeListener: (listener: ChangeListener) => {
        listeners.delete(listener);
      },
    },
  },
};
mock.module('wxt/browser', () => ({ browser }));
await import('@/utils/i18n/i18n.js');
const { waitLocale } = await import('svelte-i18n');
await waitLocale();
const { renderComponent, unmountComponent, cleanupDom } = await import(
  '../../helpers/svelte-harness.js'
);
let mounted: unknown;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await settle();
  }
  expect(check()).toBe(true);
}
const textButton = (root: ParentNode, text: string) =>
  Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent?.trim() === text
  );
async function mount(file: string, props: Record<string, unknown> = {}) {
  const component = await renderComponent(file, props);
  mounted = component.instance;
  await settle();
  return component.target;
}
beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  writes.length = 0;
});
afterEach(async () => {
  if (mounted) await unmountComponent(mounted);
  mounted = undefined;
  cleanupDom();
});

describe('documented controls use their saved state', () => {
  test('changing only a label color persists without rewriting assignments', async () => {
    store.emailLabelCatalog = [{ name: 'Receipts', color: '#123456' }];
    store.emailLabels = { 'user@example.test_mail': ['Receipts'] };
    const target = await mount('src/ui/views/OrganizeView.svelte', { initialTab: 'labels' });
    await until(() => !!textButton(target, get(t)('labelManagement.rename')));
    textButton(target, get(t)('labelManagement.rename'))?.click();
    await settle();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const color = dialog?.querySelector<HTMLInputElement>('input[type="color"]');
    expect(color).toBeDefined();
    if (!color) throw new Error('Missing color editor');
    color.value = '#654321';
    color.dispatchEvent(new Event('input', { bubbles: true }));
    writes.length = 0;
    textButton(dialog as Element, get(t)('common.save'))?.click();
    await until(
      () => (store.emailLabelCatalog as Array<{ color: string }>)[0]?.color === '#654321'
    );
    expect(writes).not.toContain('emailLabels');
    expect(store.emailLabels).toEqual({ 'user@example.test_mail': ['Receipts'] });
  });

  test('an identity domain draft opens empty, accepts a domain, and survives save', async () => {
    const identity = {
      id: 'profile',
      name: 'Profile',
      firstNames: 'Alex',
      lastNames: 'Example',
      username: 'alex',
      country: 'US',
      city: 'Example',
      dateOfBirth: '1990-01-01',
      pin: '1234',
      preferredEmail: '',
      profilePicture: 'data:image/png;base64,AA==',
      useRandomPassword: true,
      isDefault: true,
      createdAt: 1,
      updatedAt: 1,
    };
    store.identities = [identity];
    const target = await mount('src/ui/views/autofill/IdentitiesView.svelte');
    await until(() => !!target.querySelector(`button[aria-label="${get(t)('identities.edit')}"]`));
    target
      .querySelector<HTMLButtonElement>(`button[aria-label="${get(t)('identities.edit')}"]`)
      ?.click();
    await until(() => !!textButton(document.body, get(t)('identities.addDomainOverride')));
    textButton(document.body, get(t)('identities.addDomainOverride'))?.click();
    await settle();
    const domain = document.querySelector<HTMLInputElement>(
      `input[placeholder="${get(t)('identities.domainPlaceholder')}"]`
    );
    expect(domain).not.toBeNull();
    if (!domain) throw new Error('Missing domain draft');
    expect(domain.value).toBe('');
    domain.value = 'example.test';
    domain.dispatchEvent(new Event('input', { bubbles: true }));
    const draft = domain.closest('.mb-2');
    expect(draft).not.toBeNull();
    textButton(draft as Element, get(t)('common.add'))?.click();
    await settle();
    const save = document.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(save).not.toBeNull();
    save?.click();
    await until(
      () =>
        !!(store.identities as Array<{ domainFieldOverrides?: Record<string, unknown> }>)[0]
          ?.domainFieldOverrides?.['example.test']
    );
  });

  test('message reader hides each configured action and follows changes and removal', async () => {
    const ids = [
      'button-star-header',
      'button-archive-detail',
      'button-delete-detail',
      'button-download',
      'button-forward',
      'button-mark-unread',
      'button-print-detail',
    ];
    store.toolbarButtonVisibility = {
      star: false,
      archive: false,
      delete: false,
      download: false,
      forward: false,
      markUnread: false,
      print: false,
    };
    const target = await mount('src/ui/views/mailbox/MailView.svelte', {
      selectedThread: [
        {
          id: 'mail',
          from: 'sender@example.test',
          subject: 'Message',
          body: 'Hello',
          received_at: Date.now(),
        },
      ],
    });
    await settle();
    for (const id of ids) expect(target.querySelector(`#${id}`)).toBeNull();
    await area.set({ toolbarButtonVisibility: { archive: true, star: false } });
    await until(() => !!target.querySelector('#button-archive-detail'));
    expect(target.querySelector('#button-star-header')).toBeNull();
    for (const id of ids.filter((id) => id !== 'button-star-header'))
      expect(target.querySelector(`#${id}`)).not.toBeNull();
    await area.set({ toolbarButtonVisibility: undefined });
    await until(() => !!target.querySelector('#button-star-header'));
    for (const id of ids) expect(target.querySelector(`#${id}`)).not.toBeNull();
  });
});
