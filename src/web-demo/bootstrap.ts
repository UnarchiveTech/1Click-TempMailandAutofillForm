import {
  installPreviewApi,
  type PreviewEnvironment,
  type PreviewRequest,
  type PreviewWindow,
} from '@/utils/browser/preview-api.js';

export interface DemoHost {
  environment: PreviewEnvironment;
  request: (caller: Window, request: PreviewRequest) => Promise<unknown>;
}

const scope = window as unknown as PreviewWindow;
const host = (parent as unknown as { demoHost?: DemoHost }).demoHost;
if (!host || parent === window || location.origin !== parent.location.origin) {
  throw new Error('The web demo must be opened inside its own demo workspace');
}
scope.__previewHost = (request) => host.request(window, request);
installPreviewApi(host.environment);
// Block remote requests before invoking fetch. CSP also covers browser-driven
// loads such as images and scripts; redirects cannot escape this boundary.
const localFetch = window.fetch.bind(window);
Object.defineProperty(window, 'fetch', {
  configurable: true,
  value: async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin !== location.origin)
      throw new Error('Remote services are unavailable in the website demo');
    return localFetch(input, { ...options, redirect: 'error' });
  },
});
document.body.dataset.webDemo = 'true';
