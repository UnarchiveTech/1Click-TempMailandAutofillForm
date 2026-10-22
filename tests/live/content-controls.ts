import type { CDPSession, Page } from '@playwright/test';

interface NodeInfo {
  nodeId: number;
  backendNodeId: number;
  nodeName: string;
  children?: NodeInfo[];
  shadowRoots?: NodeInfo[];
}

export interface ContentControl {
  nodeId: number;
  text: string;
  title: string;
  cls: string;
  visible: boolean;
}

/** Native closed-shadow inspection; no page-world monkeypatch or synthetic click. */
export async function contentControls(cdp: CDPSession): Promise<ContentControl[]> {
  const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as {
    root: NodeInfo;
  };
  const nodes: NodeInfo[] = [];
  const seen = new Set<number>();
  function visit(node: NodeInfo): void {
    if (seen.has(node.backendNodeId)) return;
    seen.add(node.backendNodeId);
    if (node.nodeName === 'BUTTON') nodes.push(node);
    for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) visit(child);
  }
  visit(root);
  const controls: ContentControl[] = [];
  for (const node of nodes) {
    try {
      const { object } = await cdp.send('DOM.resolveNode', { nodeId: node.nodeId });
      if (!object.objectId) continue;
      const { result } = await cdp.send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: `function () {
          const r = this.getBoundingClientRect();
          const s = getComputedStyle(this);
          return { text: (this.textContent || '').trim(), title: this.title || '',
            cls: this.className || '', visible: r.width > 0 && r.height > 0 &&
              s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0' };
        }`,
        returnByValue: true,
      });
      controls.push({ nodeId: node.nodeId, ...(result.value as Omit<ContentControl, 'nodeId'>) });
      await cdp.send('Runtime.releaseObject', { objectId: object.objectId });
    } catch {
      // A site rerender can detach a node between snapshot and resolution.
    }
  }
  return controls;
}

export async function clickContentControl(
  page: Page,
  cdp: CDPSession,
  control: ContentControl
): Promise<void> {
  const { object } = await cdp.send('DOM.resolveNode', { nodeId: control.nodeId });
  if (!object.objectId) throw new Error('Autofill control detached before the trusted click.');
  const { result } = await cdp.send('Runtime.callFunctionOn', {
    objectId: object.objectId,
    functionDeclaration: `function () {
      this.scrollIntoView({ block: 'center' });
      const r = this.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }`,
    returnByValue: true,
  });
  await cdp.send('Runtime.releaseObject', { objectId: object.objectId });
  const point = result.value as { x: number; y: number };
  await page.mouse.click(point.x, point.y);
}
