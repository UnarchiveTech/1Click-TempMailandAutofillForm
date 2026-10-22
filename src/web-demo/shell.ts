import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';
import { createDemoHost } from './broker.js';

const element = <T extends HTMLElement>(id: string) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing demo element: ${id}`);
  return node as T;
};
const status = element('status');

async function start() {
  const baseUrl = new URL('./extension/', location.href).href;
  const [manifest, messages, copy, version] = await Promise.all([
    fetch(`${baseUrl}manifest.json`).then((response) => response.json()),
    fetch(`${baseUrl}_locales/en/messages.json`).then((response) => response.json()),
    fetch('./copy.json').then((response) => response.json()) as Promise<
      Record<string, Record<string, string>>
    >,
    fetch('./version.json').then((response) => response.json()) as Promise<{
      version: string;
      revision: string;
    }>,
  ]);
  const language = Object.keys(copy).find((code) => navigator.language.startsWith(code)) ?? 'en';
  const strings = copy[language];
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  for (const node of document.querySelectorAll<HTMLElement>('[data-copy]'))
    node.textContent = strings[node.dataset.copy ?? ''] ?? '';
  element('version').textContent = `v${version.version} · ${version.revision.slice(0, 7)}`;
  const frames = {
    background: element<HTMLIFrameElement>('background'),
    extension: element<HTMLIFrameElement>('extension'),
    sample: element<HTMLIFrameElement>('sample'),
  };
  for (const [name, node] of Object.entries(frames))
    node.title = name === 'sample' ? strings.sample : name === 'extension' ? '1Click' : '';
  const host = createDemoHost({ baseUrl, target: 'chrome', manifest, messages }, frames);
  const workspace = element('workspace');
  const showPane = (name: 'sample' | 'extension') => {
    workspace.dataset.pane = name;
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]'))
      button.setAttribute('aria-pressed', String(button.dataset.view === name));
  };
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]'))
    button.onclick = () => showPane(button.dataset.view === 'extension' ? 'extension' : 'sample');
  Object.assign(window, { demoHost: host, demoCopy: strings, showDemoPane: showPane });
  const viewport = element('extensionViewport');
  let resizeRaf = 0;
  let lastWidth = 0;
  const resize = new ResizeObserver(([entry]) => {
    const available = entry.contentRect.width;
    if (!available || available === lastWidth) return;
    lastWidth = available;
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      const width = Math.max(362, available);
      const scale = Math.min(1, available / width);
      frames.extension.style.width = `${width}px`;
      frames.extension.style.height = '680px';
      frames.extension.style.transform = `scale(${scale})`;
      viewport.style.height = `${680 * scale}px`;
    });
  });
  resize.observe(viewport);
  const fitting = responsiveButtonLayout(element('actions'));
  frames.background.src = './extension/background.html';
  await host.start();
  frames.extension.src = './extension/popup.html';
  frames.sample.src = './sample.html';
  const extensionWindow = frames.extension.contentWindow;
  if (!extensionWindow) throw new Error('Extension preview frame is missing');
  window.addEventListener(
    'pagehide',
    () => {
      host.destroy();
      resize.disconnect();
      cancelAnimationFrame(resizeRaf);
      fitting?.destroy();
    },
    { once: true }
  );
  const fail = (error: unknown) => {
    console.error('Web demo action failed', error);
    status.textContent = strings.failed;
  };
  element('reset').onclick = () => {
    host.destroy();
    const fresh = new URL(location.href);
    fresh.searchParams.set('session', crypto.randomUUID());
    location.replace(fresh.href);
  };
  element<HTMLButtonElement>('fill').disabled = false;
  element('fill').onclick = () => {
    showPane('sample');
    void host
      .request(extensionWindow, {
        method: 'tabs.sendMessage',
        args: [1, { type: 'startSignup' }],
      })
      .then((response) => {
        if (!(response as { success?: boolean })?.success)
          throw new Error('Autofill did not complete');
        status.textContent = strings.instructions;
      })
      .catch(fail);
  };
  element('fillOtp').onclick = () => {
    showPane('sample');
    void host
      .request(extensionWindow, {
        method: 'storage.local.get',
        args: ['latestOtp'],
      })
      .then(async (stored) => {
        const cached = (
          stored as { latestOtp?: { otp: string; sender: string; recipient: string } }
        ).latestOtp;
        if (!cached) throw new Error('No current verification message');
        const reply = await host.request(extensionWindow, {
          method: 'tabs.sendMessage',
          args: [1, { type: 'fillOTP', ...cached }],
        });
        if (!(reply as { handled?: boolean })?.handled) throw new Error('OTP was not filled');
      })
      .catch(fail);
  };
  status.textContent = strings.instructions;
}

void start().catch((error) => {
  console.error('Web demo startup failed', error);
  status.textContent = status.dataset.failure ?? '1Click';
});
