import { afterEach, describe, expect, test } from 'bun:test';
import { cleanupDom, renderComponent, unmountComponent } from '../../helpers/svelte-harness.js';

let mounted: unknown;
afterEach(async () => {
  if (mounted) await unmountComponent(mounted);
  mounted = undefined;
  cleanupDom();
});

async function render(props: Record<string, unknown>) {
  const result = await renderComponent('src/ui/components/primitives/Btn.svelte', props);
  mounted = result.instance;
  return result.target;
}

describe('Btn shared action contract', () => {
  test('label and decorative icon render with a safe native button default', async () => {
    const target = await render({ label: 'Copy', icon: 'contentCopy' });
    const button = target.querySelector('button');
    expect(button?.type).toBe('button');
    expect(button?.querySelector('.btn-label')?.textContent).toBe('Copy');
    expect(button?.querySelector('.btn-glyph')?.getAttribute('aria-hidden')).toBe('true');
    expect(button?.querySelector('svg')).not.toBeNull();
  });

  test('drop target activates with Enter and Space and forwards drag events', async () => {
    let clicks = 0;
    let drops = 0;
    const target = await render({
      as: 'div',
      variant: 'surface',
      label: 'Archive',
      onclick: () => clicks++,
      ondrop: () => drops++,
      dropActive: true,
      dropTone: 'warning',
    });
    const control = target.querySelector<HTMLElement>('[role="button"]');
    expect(control?.tabIndex).toBe(0);
    expect(control?.classList.contains('ring-inset')).toBe(true);
    expect(control?.classList.contains('ring-md-warning')).toBe(true);
    for (const key of ['Enter', ' ']) {
      control?.dispatchEvent(
        new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      );
    }
    control?.dispatchEvent(new window.Event('drop', { bubbles: true }));
    expect(clicks).toBe(2);
    expect(drops).toBe(1);
  });

  test('filled destructive drop target has a contrasting inset indicator', async () => {
    const target = await render({
      as: 'div',
      variant: 'danger',
      label: 'Delete',
      dropActive: true,
      dropTone: 'danger',
    });
    const control = target.querySelector('[role="button"]');
    expect(control?.classList.contains('ring-inset')).toBe(true);
    expect(control?.classList.contains('ring-md-on-error')).toBe(true);
    expect(control?.classList.contains('ring-md-error')).toBe(false);
  });

  test.each(['disabled', 'busy', 'loading'])(
    '%s prevents native and drop-target activation',
    async (flag) => {
      let clicks = 0;
      let target = await render({ label: 'Save', [flag]: true, onclick: () => clicks++ });
      expect(target.querySelector('button')?.disabled).toBe(true);
      target.querySelector('button')?.click();
      await unmountComponent(mounted);
      mounted = undefined;
      target = await render({ as: 'div', label: 'Save', [flag]: true, onclick: () => clicks++ });
      const control = target.querySelector<HTMLElement>('[role="button"]');
      expect(control?.tabIndex).toBe(-1);
      expect(control?.getAttribute('aria-disabled')).toBe('true');
      control?.click();
      control?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(clicks).toBe(0);
    }
  );
});
