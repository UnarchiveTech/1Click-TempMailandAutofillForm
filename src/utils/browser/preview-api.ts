/** Browser API surface shared by web demos and cross-engine extension previews. */
export interface PreviewEnvironment {
  baseUrl: string;
  target: 'chrome' | 'firefox' | 'safari';
  manifest: Record<string, unknown>;
  messages: Record<string, { message: string }>;
}

export interface PreviewRequest {
  method: string;
  args: unknown[];
}

export interface PreviewWindow {
  __previewHost: (request: PreviewRequest) => Promise<unknown>;
  __previewDispatch: (event: string, args: unknown[]) => Promise<unknown>;
  __previewMessageListeners: () => number;
}

/** Serialized by Playwright; keep everything this function needs inside it. */
export function installPreviewApi(environment: PreviewEnvironment): void {
  type Listener = (...args: unknown[]) => unknown;
  type Callback = (result?: unknown) => void;
  const scope = globalThis as unknown as PreviewWindow & {
    chrome: unknown;
    browser: unknown;
  };
  const events = new Map<string, Set<Listener>>();
  const runtime = { lastError: undefined as { message: string } | undefined };
  const event = (name: string) => {
    const listeners = new Set<Listener>();
    events.set(name, listeners);
    return {
      addListener: (listener: Listener) => listeners.add(listener),
      removeListener: (listener: Listener) => listeners.delete(listener),
      hasListener: (listener: Listener) => listeners.has(listener),
      hasListeners: () => listeners.size > 0,
    };
  };
  const call = (method: string, ...args: unknown[]) => {
    const callback =
      typeof args[args.length - 1] === 'function' ? (args.pop() as Callback) : undefined;
    const result = scope.__previewHost({ method, args });
    if (!callback) return result;
    return result.then(
      (value) => {
        callback(value);
        return value;
      },
      (error: unknown) => {
        runtime.lastError = { message: error instanceof Error ? error.message : String(error) };
        try {
          callback();
        } finally {
          runtime.lastError = undefined;
        }
      }
    );
  };
  const namespace = (name: string, methods: string[], eventNames: string[] = []) =>
    Object.fromEntries([
      ...methods.map((method) => [
        method,
        (...args: unknown[]) => call(`${name}.${method}`, ...args),
      ]),
      ...eventNames.map((method) => [method, event(`${name}.${method}`)]),
    ]);
  scope.__previewMessageListeners = () => events.get('runtime.onMessage')?.size ?? 0;
  scope.__previewDispatch = async (name, args) => {
    const listeners = [...(events.get(name) ?? [])];
    if (name !== 'runtime.onMessage') {
      for (const listener of listeners) listener(...args);
      return undefined;
    }
    return new Promise((resolve, reject) => {
      let waiting = false;
      let answered = false;
      const deadline = setTimeout(
        () => reject(new Error('Preview runtime message timed out')),
        10_000
      );
      const respond = (response: unknown) => {
        if (answered) return;
        answered = true;
        clearTimeout(deadline);
        resolve(response);
      };
      for (const listener of listeners) {
        try {
          const result = listener(...args, respond);
          if (result === true) waiting = true;
          else if (result instanceof Promise) {
            waiting = true;
            result.then(respond, (error) => {
              clearTimeout(deadline);
              reject(error);
            });
          }
        } catch (error) {
          clearTimeout(deadline);
          reject(error);
          return;
        }
      }
      if (!waiting && !answered) respond(undefined);
    });
  };
  const api: Record<string, unknown> = {
    runtime: Object.assign(
      runtime,
      namespace(
        'runtime',
        ['sendMessage', 'getPlatformInfo', 'getContexts'],
        ['onMessage', 'onInstalled', 'onStartup', 'onConnect']
      ),
      {
        id: 'e2e-preview-extension',
        getManifest: () => structuredClone(environment.manifest),
        getURL: (file: string) => new URL(file.replace(/^\//, ''), `${environment.baseUrl}/`).href,
        ...(environment.target === 'firefox'
          ? { getBrowserInfo: (...args: unknown[]) => call('runtime.getBrowserInfo', ...args) }
          : {}),
      }
    ),
    storage: {
      ...Object.fromEntries(
        ['local', 'session', 'sync'].map((area) => [
          area,
          {
            ...namespace(`storage.${area}`, [
              'get',
              'set',
              'remove',
              'clear',
              'getBytesInUse',
              'setAccessLevel',
            ]),
            QUOTA_BYTES: 10_485_760,
          },
        ])
      ),
      onChanged: event('storage.onChanged'),
    },
    tabs: namespace(
      'tabs',
      ['query', 'get', 'create', 'update', 'remove', 'sendMessage'],
      ['onActivated', 'onUpdated', 'onRemoved']
    ),
    windows: namespace('windows', ['getCurrent', 'getAll', 'create', 'update']),
    permissions: namespace(
      'permissions',
      ['contains', 'getAll', 'request', 'remove'],
      ['onAdded', 'onRemoved']
    ),
    alarms: namespace('alarms', ['create', 'get', 'getAll', 'clear', 'clearAll'], ['onAlarm']),
    action: namespace('action', [
      'setBadgeText',
      'getBadgeText',
      'setBadgeBackgroundColor',
      'setTitle',
      'setIcon',
      'setPopup',
      'openPopup',
    ]),
    notifications: namespace(
      'notifications',
      ['create', 'clear', 'getAll', 'getPermissionLevel'],
      ['onClicked', 'onButtonClicked', 'onClosed']
    ),
    contextMenus: namespace(
      'contextMenus',
      ['create', 'update', 'remove', 'removeAll'],
      ['onClicked']
    ),
    commands: namespace('commands', ['getAll'], ['onCommand']),
    cookies: namespace('cookies', ['get', 'getAll', 'set', 'remove']),
    declarativeNetRequest: namespace('declarativeNetRequest', [
      'getSessionRules',
      'updateSessionRules',
    ]),
    omnibox: namespace('omnibox', ['setDefaultSuggestion'], ['onInputChanged', 'onInputEntered']),
    webNavigation: namespace('webNavigation', [], ['onCommitted', 'onCompleted']),
    i18n: {
      getUILanguage: () => 'en',
      getAcceptLanguages: () => Promise.resolve(['en']),
      getMessage: (key: string) => environment.messages[key]?.message ?? '',
    },
    extension: {
      inIncognitoContext: false,
      isAllowedIncognitoAccess: () => Promise.resolve(false),
    },
    scripting: {
      executeScript: (details: Record<string, unknown>) =>
        call('scripting.executeScript', {
          ...details,
          func: typeof details.func === 'function' ? details.func.toString() : undefined,
        }),
    },
  };
  if (environment.target === 'chrome') {
    api.sidePanel = namespace('sidePanel', ['setPanelBehavior', 'setOptions', 'open']);
    api.offscreen = namespace('offscreen', ['hasDocument', 'createDocument', 'closeDocument']);
  } else if (environment.target === 'firefox') {
    api.sidebarAction = namespace('sidebarAction', ['setPanel', 'open', 'close', 'isOpen']);
  }
  scope.chrome = api;
  scope.browser = api;
  // Native lanes verify OS clipboard permission. Previews verify copy/purge calls
  // through a context-scoped clipboard boundary, like their storage transport.
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (value: string) => call('clipboard.writeText', value),
      readText: () => call('clipboard.readText'),
    },
  });
}
