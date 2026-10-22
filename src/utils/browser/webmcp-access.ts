import { browser } from 'wxt/browser';
import { withLock } from '@/utils/mutex.js';
import { parseStringList } from '@/utils/storage/rmw.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { hostMatchesDomainScope } from '@/utils/validation.js';

export type WebmcpAccessChoice = 'always' | 'once' | 'never';
const onceKey = (tabId: number) => `webmcpOnce_${tabId}`;

function webHost(url: string): string {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('invalid-site');
  return parsed.hostname.toLowerCase();
}

/** Exact-host decisions override inherited legacy domain grants. */
export function persistentWebmcpAccess(host: string, grants: unknown, decisions: unknown): boolean {
  const decision =
    decisions && typeof decisions === 'object'
      ? (decisions as Record<string, unknown>)[host]
      : undefined;
  if (decision === 'never' || decision === 'once') return false;
  if (decision === 'always') return true;
  return parseStringList(grants).some((grant) => hostMatchesDomainScope(host, grant));
}

export async function getWebmcpAccessChoice(
  tabId: number,
  url: string
): Promise<WebmcpAccessChoice | null> {
  const host = webHost(url);
  const stored = await browser.storage.local.get(['webmcpAccessList', 'webmcpSiteDecisions']);
  if (persistentWebmcpAccess(host, stored.webmcpAccessList, stored.webmcpSiteDecisions))
    return 'always';
  const decision =
    stored.webmcpSiteDecisions && typeof stored.webmcpSiteDecisions === 'object'
      ? (stored.webmcpSiteDecisions as Record<string, unknown>)[host]
      : undefined;
  if (decision === 'never') return 'never';
  if (decision !== 'once') return null;
  const key = onceKey(tabId);
  const session = await browser.storage.session.get(key);
  return session[key] === url ? 'once' : null;
}

export async function clearWebmcpOnce(tabId: number): Promise<void> {
  await browser.storage.session.remove(onceKey(tabId));
}

export async function setWebmcpAccessChoice(
  tabId: number,
  url: string,
  choice: WebmcpAccessChoice
): Promise<void> {
  const host = webHost(url);
  const tab = await browser.tabs.get(tabId);
  if (tab.url !== url || tab.status === 'loading') throw new Error('site-changed');
  await withLock('webmcp_access_lock', async () => {
    // Revoke a previous tab grant before changing the persistent decision.
    await clearWebmcpOnce(tabId);
    const stored = await browser.storage.local.get('webmcpSiteDecisions');
    const raw = stored.webmcpSiteDecisions;
    const decisions = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    await writeWithRetry({ webmcpSiteDecisions: { ...decisions, [host]: choice } });
    if (choice === 'once') {
      await writeWithRetry({ [onceKey(tabId)]: url }, { area: browser.storage.session });
      const liveTab = await browser.tabs.get(tabId);
      if (liveTab.url !== url || liveTab.status === 'loading') {
        await clearWebmcpOnce(tabId);
        throw new Error('site-changed');
      }
    }
  });
}

/** Called only with browser-supplied sender context, never page arguments. */
export async function isWebmcpAccessAllowed(
  tabId: number | undefined,
  url: string
): Promise<boolean> {
  if (typeof tabId !== 'number') return false;
  try {
    webHost(url);
  } catch {
    return false;
  }
  const choice = await getWebmcpAccessChoice(tabId, url);
  if (choice === 'always') return true;
  if (choice !== 'once') return false;
  const tab = await browser.tabs.get(tabId);
  return tab.url === url && tab.status !== 'loading';
}
