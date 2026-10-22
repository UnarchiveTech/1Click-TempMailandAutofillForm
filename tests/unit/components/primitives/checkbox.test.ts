import { describe, expect, test } from 'bun:test';
import { cleanupDom, renderComponent, unmountComponent } from '../../helpers/svelte-harness.js';

describe('Checkbox native and visual state', () => {
  test('ordinary activation updates the native value and the visible glyph once', async () => {
    let changes = 0;
    const rendered = await renderComponent('src/ui/components/primitives/Checkbox.svelte', {
      checked: false,
      onchange: () => {
        changes++;
      },
    });
    const input = rendered.target.querySelector<HTMLInputElement>('input');
    input?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(input?.checked).toBe(true);
    expect(rendered.target.querySelector('.checkbox-box.checked')).not.toBeNull();
    expect(changes).toBe(1);
    await unmountComponent(rendered.instance);
    cleanupDom();
  });

  test('a rejected change keeps the native value and visual glyph unchecked', async () => {
    const rendered = await renderComponent('src/ui/components/primitives/Checkbox.svelte', {
      checked: false,
      onchange: (event: Event & { currentTarget: HTMLInputElement }) => {
        event.currentTarget.checked = false;
      },
    });
    const input = rendered.target.querySelector<HTMLInputElement>('input');
    input?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(input?.checked).toBe(false);
    expect(rendered.target.querySelector('.checkbox-box.checked')).toBeNull();
    await unmountComponent(rendered.instance);
    cleanupDom();
  });
});
