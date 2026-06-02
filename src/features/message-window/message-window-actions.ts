import { initSanitize, sanitizeHtml } from '@/utils/sanitize-html.js';
import type { Email } from '@/utils/types.js';

export async function openMessageWindow(message: Email) {
  const width = 800,
    height = 600;
  const left = (screen.width - width) / 2;
  const top = (screen.height - height) / 2;
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
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${subject}</title>
    <style>body{font-family:system-ui;padding:24px;line-height:1.6}h1{font-size:18px}img{max-width:100%;height:auto}</style></head>
    <body><h1>${subject}</h1><p><b>From:</b> ${from}</p><hr>${body}</body></html>`);
  win.document.close();
  return true;
}
