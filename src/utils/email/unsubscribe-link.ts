import { decodeHtmlEntities } from './decode-html-entities.js';
import { parseAnchors } from './html-scan.js';

const unsubscribeWords =
  /\b(?:unsubscribe|opt[-_ ]?out|cancel subscription|abmelden|abbestellen|d[ée]sabonner|d[ée]sabonnement|darse de baja|cancelar suscripci[oó]n)\b|إلغاء الاشتراك|配信停止|登録解除|退订|退訂|取消订阅|取消訂閱|ยกเลิกการสมัคร|ยกเลิกรับ/iu;

function safeDestination(raw: string): string | undefined {
  try {
    const url = new URL(decodeHtmlEntities(raw).trim());
    if (url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:')
      return url.href;
  } catch {
    /* Relative and malformed sender destinations are not actionable. */
  }
  return undefined;
}

/** Only sender-supplied actions: never invent an endpoint or submit a form. */
export function findUnsubscribeLink(message: {
  body_html?: string;
  body?: string;
  raw_source?: string;
}): string | undefined {
  const headers = (message.raw_source || '').split(/\r?\n\r?\n/, 1)[0].replace(/\r?\n[ \t]+/g, ' ');
  const listHeader = /^List-Unsubscribe:[ \t]*([^\r\n]*)/im.exec(headers)?.[1];
  if (listHeader) {
    const destinations = [...listHeader.matchAll(/<([^<>]+)>/g)]
      .map((match) => safeDestination(match[1]))
      .filter((value): value is string => !!value);
    const preferred =
      destinations.find((value) => value.startsWith('https:')) ||
      destinations.find((value) => value.startsWith('http:')) ||
      destinations[0];
    if (preferred) return preferred;
  }
  for (const anchor of parseAnchors(message.body_html || message.body || '')) {
    const url = safeDestination(anchor.href);
    if (!url) continue;
    const label = decodeHtmlEntities(anchor.innerHtml.replace(/<[^>]+>/g, ' '));
    const parsed = new URL(url);
    if (
      unsubscribeWords.test(label) ||
      unsubscribeWords.test(decodeURIComponentSafe(parsed.pathname + parsed.search))
    )
      return url;
  }
  return undefined;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
