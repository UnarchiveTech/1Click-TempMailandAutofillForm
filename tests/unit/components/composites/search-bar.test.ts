import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { addMessages, init, locale } from 'svelte-i18n';

let storageValues: Record<string, unknown> = {};
mock.module('wxt/browser', () => ({
  browser: {
    runtime: { id: 'test-ext' },
    storage: {
      local: {
        get: async () => structuredClone(storageValues),
        set: async (values: Record<string, unknown>) =>
          Object.assign(storageValues, structuredClone(values)),
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  },
}));

afterAll(() => mock.restore());

const { cleanupDom, renderComponent, setupDom, unmountComponent } = await import(
  '../../helpers/svelte-harness.js'
);
const toastModuleUrl = pathToFileURL(
  join(resolve(import.meta.dirname, '../../../..'), 'src/utils/ui/toastStore.js')
).href;
const { toastStore } = await import(toastModuleUrl);

const fixtures = [
  { code: 'en', targetKey: 'emailAddresses', expected: 'Search email addresses' },
  { code: 'ar', targetKey: 'emailAddresses', expected: 'البحث في عناوين البريد الإلكتروني' },
  { code: 'de', targetKey: 'emailAddresses', expected: 'E-Mail-Adressen suchen' },
  { code: 'es', targetKey: 'emailAddresses', expected: 'Buscar direcciones de correo' },
  { code: 'fr', targetKey: 'emailAddresses', expected: 'Rechercher des adresses e-mail' },
  { code: 'ja', targetKey: 'emailAddresses', expected: 'メールアドレスを検索' },
  { code: 'th', targetKey: 'emails', expected: 'ค้นหาอีเมล' },
  { code: 'zh', targetKey: 'countries', expected: '搜索国家/地区' },
];

const dictionaries = new Map<
  string,
  { common: { search: string }; searchPlaceholder: Record<string, string> }
>();
for (const { code } of fixtures) {
  const dictionary = JSON.parse(
    readFileSync(new URL(`../../../../src/locales/${code}.json`, import.meta.url), 'utf8')
  );
  dictionaries.set(code, dictionary);
  addMessages(code, dictionary);
}
init({ fallbackLocale: 'en', initialLocale: 'en' });

const mounted: unknown[] = [];
afterEach(async () => {
  for (const instance of mounted.splice(0)) await unmountComponent(instance);
  cleanupDom();
  storageValues = {};
  if (typeof window !== 'undefined') {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  }
});

describe('SearchBar portaled history keyboard order', () => {
  test('Tab enters history and Shift+Tab returns to its input', async () => {
    locale.set('en');
    storageValues = { searchHistoryByScope: { keyboard: ['github'] } };
    const dom = await render('src/ui/components/composites/SearchBar.svelte', {
      scope: 'keyboard',
      showVoiceSearch: false,
    });
    const input = dom.querySelector<HTMLInputElement>('input');
    if (!input) throw new Error('Missing search input');
    input.focus();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const history = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === 'github'
    );
    if (!history) throw new Error('Missing portaled history action');
    expect(dom.contains(history)).toBe(false);
    const enter = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    input.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(history);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(history.isConnected).toBe(true);
    history.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(document.activeElement).toBe(input);
  });

  test('Tab from the last history control dismisses it and resumes at the input', async () => {
    locale.set('en');
    storageValues = { searchHistoryByScope: { keyboard: ['github'] } };
    const dom = await render('src/ui/components/composites/SearchBar.svelte', {
      scope: 'keyboard',
      showVoiceSearch: false,
    });
    const input = dom.querySelector<HTMLInputElement>('input');
    if (!input) throw new Error('Missing search input');
    input.focus();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const remove = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove search"]'
    );
    if (!remove) throw new Error('Missing history removal control');
    remove.focus();
    const exit = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    remove.dispatchEvent(exit);
    expect(exit.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(input);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(remove.isConnected).toBe(false);
  });
});

describe('SearchBar speech recognition', () => {
  test('applies a final transcript and reports a denied microphone instead of failing silently', async () => {
    setupDom();
    locale.set('en');
    let current: FakeRecognition | undefined;
    class FakeRecognition {
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onresult:
        | ((event: {
            resultIndex: number;
            results: Array<{ isFinal: boolean; 0: { transcript: string } }>;
          }) => void)
        | null = null;
      start() {
        current = this;
        this.onstart?.();
      }
      stop() {
        this.onend?.();
      }
    }
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
    const changes: string[] = [];
    const messages: string[] = [];
    const unsubscribe = toastStore.subscribe((toasts: Array<{ message: string }>) => {
      messages.push(...toasts.map((toast) => toast.message));
    });
    try {
      const dom = await render('src/ui/components/composites/SearchBar.svelte', {
        onChange: (value: string) => changes.push(value),
      });
      const mic = dom.querySelector<HTMLButtonElement>('button[aria-label="Voice search"]');
      expect(mic).not.toBeNull();
      mic?.click();
      expect(current).toBeDefined();
      current?.onresult?.({
        resultIndex: 0,
        results: [{ isFinal: true, 0: { transcript: 'GitHub' } }],
      });
      expect(changes).toContain('GitHub');
      current?.onerror?.({ error: 'not-allowed' });
      expect(messages).toContain('Voice recognition failed or was denied');
    } finally {
      unsubscribe();
      toastStore.clear();
    }
  });
});

async function render(path: string, props: Record<string, unknown> = {}) {
  const component = await renderComponent(path, props);
  mounted.push(component.instance);
  return component.target;
}

function renderedPhrase(dom: Element): string | undefined {
  const overlay = dom.querySelector('[data-search-placeholder]');
  if (!overlay) return undefined;
  // Whitespace-only children of a flex container do not render. Keep every
  // translated space inside the text spans, including the template's spacing.
  return Array.from(overlay.querySelectorAll('span'))
    .filter((span) => !span.querySelector('span'))
    .map((span) => span.textContent)
    .join('');
}

describe('SearchBar localized phrases', () => {
  for (const { code, targetKey, expected } of fixtures) {
    test(`${code}: renders the whole phrase in the locale's word order`, async () => {
      locale.set(code);
      const target = dictionaries.get(code)?.searchPlaceholder[targetKey];
      expect(target).toBeDefined();
      const dom = await render('src/ui/components/composites/SearchBar.svelte', {
        animatedPlaceholders: [target],
        showVoiceSearch: false,
      });
      expect(renderedPhrase(dom)).toBe(expected);
      expect(dom.querySelector('input')?.getAttribute('placeholder')).toBe('');
    });
  }

  test('preserves a target containing commas and a slash instead of splitting it', async () => {
    locale.set('en');
    const dom = await render('src/ui/components/composites/SearchBar.svelte', {
      animatedPlaceholders: ['names, countries / regions'],
      showVoiceSearch: false,
    });
    expect(renderedPhrase(dom)).toBe('Search names, countries / regions');
  });

  test('the wrapper localizes its default placeholder and accessible name', async () => {
    locale.set('ar');
    const dom = await render('src/ui/components/composites/SearchFilterHeader.svelte', {
      value: '',
      showVoiceSearch: false,
    });
    expect(dom.querySelector('[data-search-placeholder]')).toBeNull();
    expect(dom.querySelector('input')?.getAttribute('placeholder')).toBe('بحث');
    expect(dom.querySelector('input')?.getAttribute('aria-label')).toBe('بحث');
  });

  test('typing hides the rotating phrase', async () => {
    locale.set('en');
    const dom = await render('src/ui/components/composites/SearchBar.svelte', {
      animatedPlaceholders: ['email addresses'],
      showVoiceSearch: false,
      value: 'shop.example',
    });
    expect(dom.querySelector('[data-search-placeholder]')).toBeNull();
    expect(dom.querySelector('input')?.value).toBe('shop.example');
  });

  test('an empty target list keeps the static placeholder visible', async () => {
    locale.set('en');
    const dom = await render('src/ui/components/composites/SearchBar.svelte', {
      placeholder: 'Search rules…',
      animatedPlaceholders: [''],
      showVoiceSearch: false,
    });
    expect(dom.querySelector('[data-search-placeholder]')).toBeNull();
    expect(dom.querySelector('input')?.getAttribute('placeholder')).toBe('Search rules…');
  });
});
