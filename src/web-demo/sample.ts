import type { createDemoHost } from './broker.js';

const workspace = parent as unknown as {
  demoHost: ReturnType<typeof createDemoHost>;
  demoCopy: Record<string, string>;
  showDemoPane: (name: 'sample' | 'extension') => void;
};
const copy = workspace.demoCopy;
document.documentElement.lang = parent.document.documentElement.lang;
document.documentElement.dir = parent.document.documentElement.dir;
for (const node of document.querySelectorAll<HTMLElement>('[data-copy]'))
  node.textContent = copy[node.dataset.copy ?? ''] ?? '';
function required<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing sample element: ${selector}`);
  return node;
}
const form = required<HTMLFormElement>('#signup');
const verification = required<HTMLFormElement>('#verification');
const title = required<HTMLElement>('h2[data-copy="signup"]');
const result = required<HTMLElement>('#result');
let expectedCode = '';
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  void workspace.demoHost
    .deliver()
    .then((code) => {
      expectedCode = code;
      // Match a completed signup flow: remove the old form so the real content
      // script can tear down its now-unneeded autofill controls.
      form.remove();
      verification.hidden = false;
      result.textContent = copy.pending;
      verification.querySelector('input')?.focus();
      workspace.showDemoPane('extension');
    })
    .catch((error) => {
      console.error('Demo delivery failed', error);
      result.textContent = copy.failed;
    });
});
verification.addEventListener('submit', (event) => {
  event.preventDefault();
  const code = required<HTMLInputElement>('#verification input');
  if (expectedCode && code.value === expectedCode) {
    result.textContent = copy.verified;
    verification.remove();
    title.remove();
  } else {
    code.setCustomValidity(copy.failed);
    code.reportValidity();
  }
});
verification
  .querySelector('input')
  ?.addEventListener('input', (event) => (event.target as HTMLInputElement).setCustomValidity(''));
