/** Execute a browser's production UI AND background bundles over test-only transport. */
import { readFileSync, realpathSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import {
  installPreviewApi,
  type PreviewEnvironment,
  type PreviewRequest,
  type PreviewWindow,
} from '../../src/utils/browser/preview-api';

export type BuildTarget = PreviewEnvironment['target'];
export const PREVIEW_ORIGIN = 'http://localhost:5173';
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};

export function extensionUrl(idOrBase: string, file = ''): string {
  return idOrBase.startsWith('http:')
    ? `${idOrBase.replace(/\/$/, '')}/${file.replace(/^\//, '')}`
    : `chrome-extension://${idOrBase}/${file.replace(/^\//, '')}`;
}

export function buildPath(target: BuildTarget): string {
  return resolve(process.env.E2E_BUILD_ROOT || '.output', `${target}-mv3`);
}

export async function installBuildPreview(
  context: BrowserContext,
  target: BuildTarget
): Promise<string> {
  const root = realpathSync(buildPath(target));
  const baseUrl = `${PREVIEW_ORIGIN}/__e2e__/${target}`;
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  const messages = JSON.parse(readFileSync(join(root, '_locales/en/messages.json'), 'utf8'));
  const environment: PreviewEnvironment = { baseUrl, target, manifest, messages };
  const storage: Record<string, Record<string, unknown>> = {
    local: Object.create(null),
    session: Object.create(null),
    sync: Object.create(null),
  };
  const alarms = new Map<string, Record<string, unknown>>();
  const alarmTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const surfaceRecords = new Map<string, unknown>();
  const tabIds = new Map<Page, number>();
  let nextTabId = 1;
  let background: Page | undefined;
  let offscreen: Page | undefined;
  let activePage: Page | undefined;
  let closing = false;
  let clipboard = '';
  const permissions = new Set((manifest.permissions ?? []) as string[]);
  const origins = new Set((manifest.host_permissions ?? []) as string[]);
  const tabId = (page: Page) => {
    let id = tabIds.get(page);
    if (id === undefined) {
      id = nextTabId++;
      tabIds.set(page, id);
      page.once('close', () => tabIds.delete(page));
    }
    return id;
  };
  const tabPages = () =>
    context.pages().filter((page) => page !== background && page !== offscreen && !page.isClosed());
  const tabRecord = (page: Page) => {
    const pages = tabPages();
    return {
      id: tabId(page),
      url: page.url(),
      active:
        page === (activePage && pages.includes(activePage) ? activePage : pages[pages.length - 1]),
      windowId: 1,
    };
  };
  const dispatch = async (page: Page, event: string, args: unknown[]) => {
    try {
      return await page.evaluate(
        ({ event, args }) =>
          (globalThis as unknown as Partial<PreviewWindow>).__previewDispatch?.(event, args),
        { event, args }
      );
    } catch (error) {
      // Native delivery drops a destination that has navigated or closed.
      // An unrelated listener error must still reject and fail the scenario.
      if (
        closing ||
        page.isClosed() ||
        (error instanceof Error &&
          /Execution context was destroyed|Frame was detached|Target page, context or browser has been closed/.test(
            error.message
          ))
      )
        return undefined;
      throw error;
    }
  };
  const emit = async (event: string, args: unknown[]) => {
    if (closing) return;
    await Promise.all(
      context
        .pages()
        .filter((page) => !page.isClosed() && page.url().startsWith(PREVIEW_ORIGIN))
        .map((page) => dispatch(page, event, args))
    );
  };
  const trackActivation = (page: Page) => {
    activePage = page;
    const bringToFront = page.bringToFront.bind(page);
    page.bringToFront = async () => {
      await bringToFront();
      activePage = page;
      await emit('tabs.onActivated', [{ tabId: tabId(page), windowId: 1 }]);
    };
  };
  context.on('page', trackActivation);
  const sender = (page: Page) => ({
    id: 'e2e-preview-extension',
    url: page.url().startsWith(baseUrl)
      ? `${target === 'firefox' ? 'moz-extension' : target === 'safari' ? 'safari-web-extension' : 'chrome-extension'}://e2e-preview-extension/${page.url().slice(baseUrl.length + 1)}`
      : page.url(),
    tab: tabRecord(page),
    frameId: 0,
  });

  // Ordinary preview pages lack extension host permissions. Keep favicon DNS
  // and image dependencies deterministic without contacting external services.
  await context.route('https://dns.google/resolve?*', async (route) => {
    const query = new URL(route.request().url()).searchParams;
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        Status: 0,
        Answer:
          query.get('type') === 'A'
            ? [{ name: query.get('name'), type: 1, TTL: 60, data: '93.184.216.34' }]
            : [],
      }),
    });
  });
  for (const pattern of ['https://t0.gstatic.com/**', 'https://www.google.com/s2/favicons*']) {
    await context.route(pattern, (route) =>
      route.fulfill({
        contentType: 'image/png',
        headers: { 'access-control-allow-origin': '*' },
        body: readFileSync(join(root, 'icons/icon32.png')),
      })
    );
  }
  // Only bare health endpoints are stubbed: API operations carry query
  // parameters or additional paths and must not be mistaken for a ping.
  for (const url of [
    'https://example.com/demo',
    'https://api.guerrillamail.com/ajax.php',
    'https://alphac.qzz.io/api/v2',
    'https://raceco.dpdns.org/api/v2',
    'https://burner.kiwi/api/v2',
  ]) {
    await context.route(url, (route) => {
      if (!['GET', 'HEAD'].includes(route.request().method())) return route.fallback();
      return route.fulfill({
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: '{}',
      });
    });
  }
  await context.route('https://www.google.com/generate_204', (route) =>
    route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
  );

  await context.route(`${PREVIEW_ORIGIN}/**`, async (route) => {
    const rawPath = new URL(route.request().url()).pathname;
    if (rawPath.startsWith('/demo/')) {
      await route.fallback();
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(rawPath);
    } catch {
      await route.fulfill({ status: 400, body: 'Invalid path' });
      return;
    }
    const prefix = `${new URL(baseUrl).pathname}/`;
    const name = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname.slice(1);
    if (name === 'background.html') {
      await route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><script src="background.js"></script></body></html>',
      });
      return;
    }
    try {
      const file = realpathSync(resolve(root, name));
      const delta = relative(root, file);
      if (isAbsolute(delta) || delta === '..' || delta.startsWith(`..${sep}`))
        throw new Error('File outside build');
      await route.fulfill({
        contentType: TYPES[extname(file)] ?? 'application/octet-stream',
        body: readFileSync(file),
      });
    } catch {
      await route.fulfill({ status: 404, body: 'Missing build resource' });
    }
  });
  await context.addInitScript(installPreviewApi, environment);
  // Reproduce the primary static document_end content entry on every web
  // navigation, including reloads and email-confirmation destinations. A
  // one-time addScriptTag cannot exercise those native extension lifecycles.
  const contentEntry = readFileSync(join(root, 'content-scripts/content.js'), 'utf8');
  await context.addInitScript({
    content: `(() => {
      if (!/^https?:$/.test(location.protocol) || location.href.startsWith(${JSON.stringify(baseUrl)})) return;
      const run = () => { ${contentEntry}\n };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
      else run();
    })();`,
  });
  await context.exposeBinding('__previewHost', async ({ page }, request: PreviewRequest) => {
    const { method, args } = request;
    const [first, second] = args;
    if (method === 'clipboard.readText') return clipboard;
    if (method === 'clipboard.writeText') {
      clipboard = String(first);
      return undefined;
    }
    if (method.startsWith('storage.')) {
      const [, area, operation] = method.split('.');
      const data = storage[area];
      if (!data) throw new Error(`Unknown storage area: ${area}`);
      const keys =
        first == null
          ? Object.keys(data)
          : typeof first === 'string'
            ? [first]
            : Array.isArray(first)
              ? (first as string[])
              : Object.keys(first as object);
      if (operation === 'get')
        return Object.fromEntries(
          keys
            .filter(
              (key) => key in data || (first && !Array.isArray(first) && typeof first === 'object')
            )
            .map((key) => [key, key in data ? data[key] : (first as Record<string, unknown>)[key]])
        );
      if (operation === 'getBytesInUse')
        return Buffer.byteLength(
          JSON.stringify(
            Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]))
          )
        );
      if (operation === 'setAccessLevel') return undefined;
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> =
        Object.create(null);
      if (operation === 'set') {
        for (const [key, value] of Object.entries(first as object)) {
          if (JSON.stringify(data[key]) === JSON.stringify(value)) continue;
          changes[key] = { oldValue: data[key], newValue: value };
          data[key] = structuredClone(value);
        }
      } else if (operation === 'remove' || operation === 'clear') {
        for (const key of operation === 'clear' ? Object.keys(data) : keys) {
          if (!(key in data)) continue;
          changes[key] = { oldValue: data[key] };
          delete data[key];
        }
      } else throw new Error(`Unsupported storage operation: ${operation}`);
      if (Object.keys(changes).length) await emit('storage.onChanged', [changes, area]);
      return undefined;
    }
    if (method === 'runtime.sendMessage') {
      if (!background) throw new Error('Production background is not initialized');
      // Native runtime messaging reaches every other extension context, not
      // just the background. Content formPresence pushes are consumed directly
      // by the open popup as well as by the background badge handler.
      const recipients = context
        .pages()
        .filter(
          (candidate) =>
            candidate !== page && !candidate.isClosed() && candidate.url().startsWith(baseUrl)
        );
      return new Promise<unknown>((resolveReply, reject) => {
        let remaining = recipients.length;
        if (!remaining) resolveReply(undefined);
        for (const candidate of recipients) {
          void dispatch(candidate, 'runtime.onMessage', [first, sender(page)]).then((reply) => {
            remaining -= 1;
            // One native response wins; an unrelated listener can keep its
            // own channel open without delaying a completed background reply.
            if (reply !== undefined || remaining === 0) resolveReply(reply);
          }, reject);
        }
      });
    }
    if (method === 'runtime.getPlatformInfo')
      return {
        os: process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux',
        arch: 'x86-64',
      };
    if (method === 'runtime.getBrowserInfo')
      return {
        name: 'Firefox',
        vendor: 'Mozilla',
        version: context.browser()?.version() ?? 'unknown',
        buildID: 'e2e',
      };
    if (method === 'runtime.getContexts')
      return offscreen && !offscreen.isClosed()
        ? [{ contextType: 'OFFSCREEN_DOCUMENT', documentUrl: offscreen.url() }]
        : [];
    if (method === 'tabs.query') {
      const query = (first ?? {}) as { active?: boolean };
      return tabPages()
        .map(tabRecord)
        .filter((tab) => query.active === undefined || tab.active === query.active);
    }
    if (method === 'tabs.get')
      return tabPages()
        .map(tabRecord)
        .find((tab) => tab.id === first);
    if (method === 'tabs.create') {
      const created = await context.newPage();
      const url = new URL((first as { url: string }).url, `${baseUrl}/`).href;
      // Native tabs.create resolves with an id before the new document loads.
      // Waiting for load here lets a confirmation report outrun the caller's
      // registration of that id as its verification tab.
      void created.goto(url).catch((error) => {
        if (!closing && !created.isClosed()) console.error('Preview tab navigation failed', error);
      });
      return { ...tabRecord(created), url };
    }
    if (method === 'tabs.update' || method === 'tabs.remove' || method === 'tabs.sendMessage') {
      const recipient = tabPages().find((candidate) => tabId(candidate) === first);
      if (!recipient) throw new Error(`Preview tab ${first} does not exist`);
      if (method === 'tabs.sendMessage')
        return dispatch(recipient, 'runtime.onMessage', [second, sender(page)]);
      if (method === 'tabs.remove') {
        await recipient.close();
        return undefined;
      }
      if ((second as { url?: string })?.url)
        await recipient.goto(new URL((second as { url: string }).url, `${baseUrl}/`).href);
      return tabRecord(recipient);
    }
    if (method === 'scripting.executeScript') {
      const details = first as {
        target: { tabId: number };
        files?: string[];
        func?: string;
        args?: unknown[];
      };
      const recipient = tabPages().find((candidate) => tabId(candidate) === details.target.tabId);
      if (!recipient) throw new Error('Script target does not exist');
      if (details.files)
        for (const file of details.files)
          await recipient.addScriptTag({ url: `${baseUrl}/${file}` });
      const result = details.func
        ? await recipient.evaluate(
            ({ code, values }) => new Function(`return (${code})(...arguments)`)(...values),
            { code: details.func, values: details.args ?? [] }
          )
        : undefined;
      return [{ frameId: 0, result }];
    }
    if (method.startsWith('permissions.')) {
      const details = (first ?? {}) as { permissions?: string[]; origins?: string[] };
      if (method === 'permissions.getAll')
        return { permissions: [...permissions], origins: [...origins] };
      if (method === 'permissions.contains')
        return (
          (details.permissions ?? []).every((item) => permissions.has(item)) &&
          (details.origins ?? []).every((item) => origins.has(item) || origins.has('<all_urls>'))
        );
      if (method === 'permissions.request' || method === 'permissions.remove') {
        const add = method === 'permissions.request';
        for (const item of details.permissions ?? []) {
          if (add) permissions.add(item);
          else permissions.delete(item);
        }
        for (const item of details.origins ?? []) {
          if (add) origins.add(item);
          else origins.delete(item);
        }
        await emit(add ? 'permissions.onAdded' : 'permissions.onRemoved', [details]);
        return true;
      }
    }
    if (method.startsWith('alarms.')) {
      const name = typeof first === 'string' ? first : '';
      if (method === 'alarms.getAll') return [...alarms.values()];
      if (method === 'alarms.get') return alarms.get(name);
      if (method === 'alarms.clear' || method === 'alarms.clearAll') {
        for (const key of method === 'alarms.clearAll' ? [...alarms.keys()] : [name]) {
          clearTimeout(alarmTimers.get(key));
          alarmTimers.delete(key);
          alarms.delete(key);
        }
        return true;
      }
      if (method === 'alarms.create') {
        const details = (typeof first === 'string' ? second : first) as {
          when?: number;
          delayInMinutes?: number;
          periodInMinutes?: number;
        };
        const scheduledTime =
          details.when ??
          Date.now() + (details.delayInMinutes ?? details.periodInMinutes ?? 0) * 60_000;
        const alarm = { name, scheduledTime, ...details };
        alarms.set(name, alarm);
        clearTimeout(alarmTimers.get(name));
        const schedule = () => {
          alarmTimers.set(
            name,
            setTimeout(
              () => {
                if (closing || alarms.get(name) !== alarm) return;
                if (details.periodInMinutes) {
                  const fired = { ...alarm };
                  alarm.scheduledTime = Date.now() + details.periodInMinutes * 60_000;
                  schedule();
                  void emit('alarms.onAlarm', [fired]).catch((error) => {
                    if (!closing) console.error('Preview alarm dispatch failed', error);
                  });
                } else {
                  alarms.delete(name);
                  alarmTimers.delete(name);
                  void emit('alarms.onAlarm', [alarm]).catch((error) => {
                    if (!closing) console.error('Preview alarm dispatch failed', error);
                  });
                }
              },
              Math.max(0, alarm.scheduledTime - Date.now())
            )
          );
        };
        schedule();
        return undefined;
      }
    }
    if (method === 'notifications.getPermissionLevel') return 'granted';
    if (method === 'notifications.create') {
      const id = typeof first === 'string' ? first : `notification-${surfaceRecords.size}`;
      surfaceRecords.set(`notification.${id}`, second ?? first);
      return id;
    }
    if (method === 'notifications.getAll')
      return Object.fromEntries(
        [...surfaceRecords].filter(([key]) => key.startsWith('notification.'))
      );
    if (method === 'notifications.clear') return surfaceRecords.delete(`notification.${first}`);
    if (method === 'commands.getAll')
      return Object.entries(
        (manifest.commands ?? {}) as Record<
          string,
          { description?: string; suggested_key?: { default?: string } }
        >
      ).map(([name, item]) => ({
        name,
        description: item.description,
        shortcut: item.suggested_key?.default ?? '',
      }));
    if (method === 'windows.getCurrent') return { id: 1, type: 'normal' };
    if (method === 'windows.getAll') return [{ id: 1, type: 'normal' }];
    if (method === 'cookies.getAll') return [];
    if (method === 'cookies.get') return null;
    if (method === 'offscreen.hasDocument') return !!offscreen && !offscreen.isClosed();
    if (method === 'offscreen.createDocument') {
      offscreen = await context.newPage();
      await offscreen.goto(`${baseUrl}/${(first as { url: string }).url}`);
      return undefined;
    }
    if (method === 'offscreen.closeDocument') {
      await offscreen?.close();
      offscreen = undefined;
      return undefined;
    }
    if (method === 'declarativeNetRequest.getSessionRules')
      return surfaceRecords.get('sessionRules') ?? [];
    if (method === 'declarativeNetRequest.updateSessionRules') {
      surfaceRecords.set('sessionRules', first);
      return undefined;
    }
    if (method === 'sidebarAction.isOpen') return false;
    if (method === 'action.setBadgeText' || method === 'action.getBadgeText') {
      const details = (first ?? {}) as { tabId?: number; text?: string };
      const key = `action.badgeText.${details.tabId ?? 'global'}`;
      if (method === 'action.setBadgeText') {
        surfaceRecords.set(key, details.text ?? '');
        return undefined;
      }
      return surfaceRecords.get(key) ?? surfaceRecords.get('action.badgeText.global') ?? '';
    }
    if (/^(action\.|contextMenus\.|omnibox\.|sidePanel\.|sidebarAction\.)/.test(method)) {
      surfaceRecords.set(method, args);
      return undefined;
    }
    throw new Error(`Unsupported preview API: ${method}`);
  });
  context.on('close', () => {
    closing = true;
    for (const timer of alarmTimers.values()) clearTimeout(timer);
    alarmTimers.clear();
    alarms.clear();
    surfaceRecords.clear();
    tabIds.clear();
    activePage = undefined;
    context.off('page', trackActivation);
    clipboard = '';
  });
  background = await context.newPage();
  await background.goto(`${baseUrl}/background.html`);
  await background.waitForFunction(
    () => (globalThis as unknown as PreviewWindow).__previewMessageListeners() > 0
  );
  return baseUrl;
}
