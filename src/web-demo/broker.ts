import { extractOTP } from '@/entrypoints/background/parsing/otp.js';
import type {
  PreviewEnvironment,
  PreviewRequest,
  PreviewWindow,
} from '@/utils/browser/preview-api.js';
import type { Email } from '@/utils/types.js';
import { createWebDemoSeed } from './seed.js';

type DemoFrame = Window & PreviewWindow;
type Data = Record<string, unknown>;

/** One broker per workspace. Frames share only ephemeral demo state. */
export function createDemoHost(
  environment: PreviewEnvironment,
  frames: Record<'background' | 'extension' | 'sample', HTMLIFrameElement>
) {
  const data: Record<string, Data> = {
    local: createWebDemoSeed(location.hostname, document.documentElement.lang),
    session: {},
    sync: {},
  };
  const alarms = new Map<string, Data>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let clipboard = '';
  let ready = false;
  const frame = (name: keyof typeof frames) => frames[name].contentWindow as DemoFrame;
  const role = (caller: Window) =>
    (Object.keys(frames) as Array<keyof typeof frames>).find((name) => frame(name) === caller);
  const sender = (caller: Window) => ({
    id: 'e2e-preview-extension',
    url:
      role(caller) === 'sample'
        ? frame('sample').location.href
        : 'chrome-extension://e2e-preview-extension/popup.html',
    tab: { id: 1, url: frame('sample').location.href, active: true, windowId: 1 },
    frameId: 0,
  });
  const emit = async (event: string, args: unknown[]) => {
    await Promise.all(
      Object.keys(frames).map(async (name) => {
        const target = frame(name as keyof typeof frames);
        if (typeof target.__previewDispatch === 'function')
          await target.__previewDispatch(event, args);
      })
    );
  };
  async function set(area: string, values: Data) {
    const changes: Data = {};
    for (const [key, value] of Object.entries(values)) {
      if (JSON.stringify(data[area][key]) === JSON.stringify(value)) continue;
      changes[key] = { oldValue: data[area][key], newValue: structuredClone(value) };
      data[area][key] = structuredClone(value);
    }
    if (Object.keys(changes).length) await emit('storage.onChanged', [changes, area]);
  }
  const host = {
    environment,
    get ready() {
      return ready;
    },
    async request(caller: Window, { method, args }: PreviewRequest): Promise<unknown> {
      const callerRole = role(caller);
      if (!callerRole || caller.location.origin !== location.origin)
        throw new Error('Unknown demo frame');
      const [first, second] = args;
      if (method.startsWith('storage.')) {
        const [, area, operation] = method.split('.');
        if (!data[area]) throw new Error('Unknown storage area');
        if (operation === 'set') return set(area, first as Data);
        if (operation === 'setAccessLevel') return;
        const keys =
          first == null
            ? Object.keys(data[area])
            : typeof first === 'string'
              ? [first]
              : Array.isArray(first)
                ? (first as string[])
                : Object.keys(first as object);
        if (operation === 'get')
          return Object.fromEntries(
            keys
              .filter(
                (key) =>
                  key in data[area] || (first && !Array.isArray(first) && typeof first === 'object')
              )
              .map((key) => [
                key,
                key in data[area] ? structuredClone(data[area][key]) : (first as Data)[key],
              ])
          );
        if (operation === 'getBytesInUse')
          return new TextEncoder().encode(JSON.stringify(data[area])).length;
        if (operation === 'remove' || operation === 'clear') {
          const changes: Data = {};
          for (const key of keys) {
            changes[key] = { oldValue: data[area][key] };
            delete data[area][key];
          }
          await emit('storage.onChanged', [changes, area]);
          return;
        }
      }
      if (method === 'runtime.sendMessage') {
        if (callerRole === 'background') {
          const replies = await Promise.all(
            ['extension', 'sample'].map((name) =>
              frame(name as 'extension' | 'sample').__previewDispatch?.('runtime.onMessage', [
                first,
                sender(caller),
              ])
            )
          );
          return replies.find((reply) => reply !== undefined);
        }
        if (!ready) throw new Error('Demo background is not ready');
        return frame('background').__previewDispatch('runtime.onMessage', [first, sender(caller)]);
      }
      if (method === 'runtime.getPlatformInfo') return { os: 'linux', arch: 'x86-64' };
      if (method === 'runtime.getContexts') return [];
      if (method === 'tabs.query' || method === 'tabs.get') {
        const tab = { id: 1, url: frame('sample').location.href, active: true, windowId: 1 };
        return method === 'tabs.query' ? [tab] : tab;
      }
      if (method === 'tabs.sendMessage')
        return frame('sample').__previewDispatch('runtime.onMessage', [second, sender(caller)]);
      if (method === 'tabs.create') {
        const url = new URL((first as { url: string }).url, environment.baseUrl);
        if (
          url.origin !== location.origin ||
          !url.pathname.startsWith(new URL(environment.baseUrl).pathname)
        )
          throw new Error('External tabs require the installed extension');
        return { id: 1, url: frame('sample').location.href };
      }
      if (method === 'tabs.update') return { id: 1, url: frame('sample').location.href };
      if (method === 'scripting.executeScript') {
        const details = first as { files?: string[]; func?: string };
        if (details.func) throw new Error('Function injection is unavailable in the website demo');
        for (const name of details.files ?? []) {
          if (name !== 'content-runtime.js') throw new Error('Unknown demo script');
          // The sample loads the current built runtime exactly once itself.
        }
        return [{ frameId: 0 }];
      }
      if (method === 'clipboard.writeText') {
        clipboard = String(first);
        return;
      }
      if (method === 'clipboard.readText') return clipboard;
      if (method === 'permissions.getAll')
        return { permissions: ['storage'], origins: [location.origin] };
      if (method === 'permissions.contains') return true;
      if (method === 'permissions.request' || method === 'permissions.remove') return false;
      if (method === 'alarms.getAll') return [...alarms.values()];
      if (method === 'alarms.get') return alarms.get(String(first));
      if (method === 'alarms.clear' || method === 'alarms.clearAll') {
        for (const name of method === 'alarms.clearAll' ? [...alarms.keys()] : [String(first)]) {
          clearTimeout(timers.get(name));
          timers.delete(name);
          alarms.delete(name);
        }
        return true;
      }
      if (method === 'alarms.create') {
        const name = typeof first === 'string' ? first : '';
        const details = (typeof first === 'string' ? second : first) as {
          when?: number;
          delayInMinutes?: number;
          periodInMinutes?: number;
        };
        clearTimeout(timers.get(name));
        const scheduledTime =
          details.when ??
          Date.now() + (details.delayInMinutes ?? details.periodInMinutes ?? 0) * 60_000;
        alarms.set(name, { name, ...details, scheduledTime });
        const delay = Math.max(1000, Math.min(2_147_483_647, scheduledTime - Date.now()));
        timers.set(
          name,
          setTimeout(() => {
            alarms.delete(name);
            timers.delete(name);
            void emit('alarms.onAlarm', [{ name, ...details, scheduledTime }]).catch(console.error);
          }, delay)
        );
        return;
      }
      if (method === 'notifications.getPermissionLevel') return 'denied';
      if (method === 'notifications.getAll') return {};
      if (method === 'notifications.clear') return false;
      if (method === 'notifications.create') return 'demo-notification';
      if (
        method === 'cookies.getAll' ||
        method === 'commands.getAll' ||
        method === 'declarativeNetRequest.getSessionRules'
      )
        return [];
      if (method === 'cookies.get') return null;
      if (method === 'windows.getCurrent') return { id: 1, type: 'normal' };
      if (method === 'windows.getAll') return [{ id: 1, type: 'normal' }];
      if (method === 'offscreen.hasDocument') return false;
      if (
        /^(action\.|contextMenus\.|omnibox\.|sidePanel\.|declarativeNetRequest\.update)/.test(
          method
        )
      )
        return;
      throw new Error(`Unavailable website demo API: ${method}`);
    },
    async start() {
      const started = Date.now();
      while (
        frame('background').__previewMessageListeners?.() < 1 ||
        !frame('background').__previewMessageListeners
      ) {
        if (Date.now() - started > 15_000) throw new Error('Demo background startup timed out');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      ready = true;
    },
    async deliver() {
      const received = Date.now();
      const code = String(100_000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900_000));
      const subject = 'Your demo verification code';
      const body = `<h2>Confirm your email</h2><p>Your verification code is <strong>${code}</strong>.</p><p>This sample code expires in 10 minutes.</p>`;
      const otp = extractOTP(subject, body);
      if (!otp) throw new Error('The shared OTP detector did not recognize the sample');
      const address = (data.local.addresses as Array<{ address: string }>)[0].address;
      const mail: Email = {
        id: `demo-verification-${received}`,
        from: `security@${location.hostname}`,
        from_name: 'Demo Shop',
        subject,
        body_plain: `Your verification code is ${code}. It expires in 10 minutes.`,
        body_html: body,
        received_at: received,
        unread: true,
        original_inbox: address,
        otp,
        isOtp: true,
      };
      const bag = [
        mail,
        ...((data.local['storedEmailsByAddress_demo-inbox-1'] as Email[]) ?? []),
      ].slice(0, 40);
      await set('local', {
        'storedEmailsByAddress_demo-inbox-1': bag,
        emailStorageMetadata: {
          'demo-inbox-1': {
            messageCount: bag.length,
            unreadCount: bag.filter((item) => item.unread).length,
            latestReceivedAt: received,
            latestOtpAt: received,
            hasMagicLink: false,
            revision: received,
          },
        },
        latestOtp: {
          otp,
          sender: mail.from,
          senderName: mail.from_name,
          context: subject,
          recipient: address,
          received_at: received,
        },
      });
      return code;
    },
    destroy() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      alarms.clear();
      clipboard = '';
      ready = false;
    },
  };
  return host;
}
