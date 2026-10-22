/** Test-only instrumentation retains CLOSED roots without changing their mode. */
export interface InjectedButton {
  nodeId: number;
  text: string;
  title: string;
  cls: string;
  display: string;
  visible: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ClosedShadowProbe {
  buttons(): InjectedButton[];
  scrollButton(nodeId: number): { x: number; y: number; w: number; h: number };
}

export interface ProbeWindow {
  __e2eClosedShadow: ClosedShadowProbe;
}

export function retainClosedRoots(): void {
  const roots = new Set<ShadowRoot>();
  const ids = new WeakMap<HTMLButtonElement, number>();
  let nextId = 1;
  const original = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (options: ShadowRootInit): ShadowRoot {
    const root = original.call(this, options);
    roots.add(root);
    return root;
  };
  const buttons = () => {
    for (const root of roots) if (!root.host.isConnected) roots.delete(root);
    return [
      ...document.querySelectorAll('button'),
      ...[...roots].flatMap((root) => [...root.querySelectorAll('button')]),
    ];
  };
  (globalThis as unknown as ProbeWindow).__e2eClosedShadow = {
    buttons: () =>
      buttons().map((element) => {
        let nodeId = ids.get(element);
        if (nodeId === undefined) {
          nodeId = nextId++;
          ids.set(element, nodeId);
        }
        const rect = element.getBoundingClientRect();
        return {
          nodeId,
          text: (element.textContent ?? '').trim(),
          title: element.title,
          cls: element.className,
          display: getComputedStyle(element).display,
          visible: rect.width > 0 && rect.height > 0,
          x: rect.x,
          y: rect.y,
          w: rect.width,
          h: rect.height,
        };
      }),
    scrollButton: (nodeId) => {
      const element = buttons().find((button) => ids.get(button) === nodeId);
      if (!element) throw new Error(`Injected button ${nodeId} detached`);
      element.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    },
  };
}
