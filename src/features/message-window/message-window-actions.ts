import { initSanitize, sanitizeHtml } from '@/utils/sanitize-html.js';
import type { Email } from '@/utils/types.js';

export async function openMessageWindow(message: Email) {
  const width = 800;
  const height = 600;

  // Multi-monitor-aware centering relative to the active window coordinates
  const screenLeft = window.screenLeft ?? window.screenX ?? 0;
  const screenTop = window.screenTop ?? window.screenY ?? 0;
  const outerWidth = window.outerWidth ?? document.documentElement.clientWidth ?? 800;
  const outerHeight = window.outerHeight ?? document.documentElement.clientHeight ?? 600;

  const left = screenLeft + (outerWidth - width) / 2;
  const top = screenTop + (outerHeight - height) / 2;

  const win = window.open(
    '',
    '_blank',
    `popup=yes,width=${width},height=${height},left=${left},top=${top}`
  );
  if (!win) {
    return false;
  }

  await initSanitize();

  let bodyHtml = message.body_html || `<pre>${message.body || ''}</pre>`;
  bodyHtml = bodyHtml.replace(/<img([^>]*)>/gi, (match, attrs) => {
    if (!attrs.includes('loading=')) {
      return `<img${attrs} loading="lazy">`;
    }
    return match;
  });

  const body = sanitizeHtml(bodyHtml);
  const subject = sanitizeHtml(message.subject || 'No Subject');
  const from = sanitizeHtml(message.from || 'Unknown');

  // Build document using innerHTML and standard APIs instead of deprecated document.write()
  win.document.title = subject;

  const styleEl = win.document.createElement('style');
  styleEl.textContent =
    'body{font-family:system-ui;padding:24px;line-height:1.6}h1{font-size:18px}img{max-width:100%;height:auto}';
  win.document.head.appendChild(styleEl);

  win.document.body.innerHTML = `
    <h1>${subject}</h1>
    <p><b>From:</b> ${from}</p>
    <hr>
    <div>${body}</div>
  `;

  return true;
}
