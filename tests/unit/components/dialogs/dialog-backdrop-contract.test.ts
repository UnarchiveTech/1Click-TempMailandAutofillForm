/**
 * One backdrop shape for every dismiss surface.
 *
 * The backdrop used to be `role="button" tabindex="-1" aria-label="Close"` with an
 * `onkeydown` - a full-screen element that advertised a focusable Close button no
 * keyboard user could ever reach (`tabindex="-1"` is programmatic-focus-only, and
 * the focus trap attaches to the dialog, not the backdrop), so its `onkeydown`
 * never fired while its name polluted the accessible tree. `ModalDialog` had
 * already settled on the honest shape: an `aria-hidden` click-only div, with
 * Escape owned by the dialog's own key handler.
 *
 * This suite pins that shape from both ends. The DESCRIBE BELOW THE FIRST mounts
 * the real components and clicks the real backdrop, because "the backdrop
 * dismisses" and "Escape still dismisses" are behaviours, not class strings. The
 * last describes scan every `.svelte` file in `src/`, because the failure mode is
 * a NEW overlay being written in the old shape - the one thing a per-component
 * test cannot see.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { get } from 'svelte/store';
import { collectSourceFiles, REPO_ROOT } from '../../../../scripts/source-files';
import { stripComments } from '../../../../scripts/source-lexer';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});

const storage: Record<string, unknown> = {};

const fakeBrowser = {
  runtime: { id: 'test-ext', sendMessage: async () => ({ success: false }) },
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...storage };
        const arr = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of arr) if (k in storage) out[k] = storage[k];
        return out;
      },
      set: async (items: Record<string, unknown>) => Object.assign(storage, items),
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete storage[k];
      },
    },
    onChanged: { addListener: () => {}, removeListener: () => {} },
  },
};
mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
mock.module('@/utils/ui/reduced-motion.svelte.js', () => ({
  useReducedMotion: () => ({ enabled: false }),
}));

// Initialize svelte-i18n exactly like the app does (register 'en' + init) so $t()
// resolves real strings instead of raw keys.
await import('@/utils/i18n/i18n.js');
const { t, waitLocale } = await import('svelte-i18n');
await waitLocale();

const { cleanupDom, renderComponent, unmountComponent } = await import(
  '../../helpers/svelte-harness.js'
);

interface DialogCase {
  name: string;
  /** Path relative to the project root, as the harness mounts components. */
  path: string;
  props: (onClose: () => void) => Record<string, unknown>;
  /**
   * Where Escape is delivered. Four of these dialogs listen on `window`; the
   * command palette listens on its own panel, which is what holds focus - and
   * the point of the assertion is only that Escape still dismisses the surface
   * the backdrop can no longer name.
   */
  escapeVia: 'window' | 'panel';
  /** Translation key naming the reachable dismiss button. */
  dismissKey: string;
}

const DIALOGS: DialogCase[] = [
  {
    name: 'ModalDialog (the contract of record)',
    path: 'src/ui/components/composites/ModalDialog.svelte',
    props: (onClose) => ({ open: true, title: 'Confirm', showCloseButton: true, onClose }),
    escapeVia: 'window',
    dismissKey: 'common.close',
  },
  {
    name: 'BottomSheet',
    path: 'src/ui/components/composites/BottomSheet.svelte',
    props: (onClose) => ({ open: true, title: 'Sheet', onClose }),
    escapeVia: 'window',
    dismissKey: 'common.close',
  },
  {
    name: 'ExportBackupDialog',
    path: 'src/ui/blocks/dialogs/ExportBackupDialog.svelte',
    props: (onClose) => ({ open: true, onClose }),
    escapeVia: 'window',
    dismissKey: 'common.close',
  },
  {
    name: 'MasterPasswordModal',
    path: 'src/ui/blocks/dialogs/MasterPasswordModal.svelte',
    props: (onClose) => ({ isOpen: true, onClose }),
    escapeVia: 'window',
    dismissKey: 'common.close',
  },
  {
    name: 'KeyboardShortcutsCheatSheet',
    path: 'src/ui/blocks/overlays/KeyboardShortcutsCheatSheet.svelte',
    props: (onClose) => ({ open: true, onClose, onOpenSettings: () => {} }),
    escapeVia: 'window',
    dismissKey: 'keyboardShortcuts.closeSheetAria',
  },
  {
    name: 'CommandPalette',
    path: 'src/ui/blocks/overlays/CommandPalette.svelte',
    props: (onClose) => ({ open: true, commands: [], onClose }),
    escapeVia: 'panel',
    dismissKey: 'common.close',
  },
];

/**
 * The backdrop, found the way the contract defines it: the overlay's own
 * `aria-hidden` cover. Every one of these portals to `document.body`
 * (PORTAL_Z.dialog), so the query has to start there.
 */
function backdrop(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"] > div[aria-hidden="true"]');
}

/** The dialog's own panel - the element its focus trap moves into. */
function panel(): HTMLElement | null {
  const overlay = document.body.querySelector<HTMLElement>('[role="dialog"]');
  if (!overlay) return null;
  for (const child of overlay.children) {
    if (child instanceof HTMLElement && child.getAttribute('aria-hidden') !== 'true') return child;
  }
  return null;
}

function pressEscape(via: 'window' | 'panel'): void {
  const target = via === 'panel' ? (panel() ?? document.body) : window;
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  );
}

afterEach(() => {
  cleanupDom();
});

describe('every dialog backdrop is the same, non-focusable, click-only cover', () => {
  for (const dialog of DIALOGS) {
    test(`${dialog.name}: aria-hidden, unnamed, out of the tab order`, async () => {
      const { instance } = await renderComponent(
        dialog.path,
        dialog.props(() => {})
      );
      const cover = backdrop();
      expect(cover).not.toBeNull();
      // Removed from the accessible tree rather than announced as a control …
      expect(cover?.getAttribute('aria-hidden')).toBe('true');
      expect(cover?.getAttribute('role')).toBeNull();
      expect(cover?.getAttribute('aria-label')).toBeNull();
      // … and unreachable by keyboard, so an `onkeydown` on it could never fire.
      expect(cover?.hasAttribute('tabindex')).toBe(false);
      expect(cover?.tabIndex).toBe(-1);
      // Still a full cover: it is what catches a click outside the panel.
      expect(cover?.className).toContain('inset-0');
      await unmountComponent(instance);
    });

    test(`${dialog.name}: clicking the backdrop dismisses`, async () => {
      let closes = 0;
      const { instance } = await renderComponent(
        dialog.path,
        dialog.props(() => {
          closes += 1;
        })
      );
      backdrop()?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(closes).toBe(1);
      await unmountComponent(instance);
    });

    test(`${dialog.name}: Escape still dismisses without the backdrop's handler`, async () => {
      let closes = 0;
      const { instance } = await renderComponent(
        dialog.path,
        dialog.props(() => {
          closes += 1;
        })
      );
      pressEscape(dialog.escapeVia);
      expect(closes).toBe(1);
      await unmountComponent(instance);
    });

    test(`${dialog.name}: the dismissal a keyboard user can reach is what the design says`, async () => {
      let closes = 0;
      const { instance } = await renderComponent(
        dialog.path,
        dialog.props(() => {
          closes += 1;
        })
      );
      // Query the actual dismiss control by its localized accessible name.
      // Other labelled buttons (such as settings) must not satisfy this check.
      const dismissName = get(t)(dialog.dismissKey);
      const dismissButtons = [
        ...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button[aria-label]'),
      ].filter((button) => button.getAttribute('aria-label') === dismissName);
      expect(dismissButtons).toHaveLength(1);
      dismissButtons[0].click();
      expect(closes).toBe(1);
      await unmountComponent(instance);
    });
  }
});

// ── The shape, over every file - a new overlay cannot opt out ────────────────

interface Tag {
  line: number;
  name: string;
  attrs: string;
}

/**
 * Every opening tag in a component, comments blanked but strings intact, so a
 * commented-out overlay or a sentence in a tooltip is not mistaken for markup.
 * `stripComments` (not `codeOnly`) is the right lexer call here: this scan reads
 * ATTRIBUTE VALUES, which `codeOnly` blanks.
 */
function tagsOf(source: string): Tag[] {
  const text = stripComments(source);
  const tags: Tag[] = [];
  for (const match of text.match(/<[a-z][a-z0-9-]*\b[^>]*>/gs) ?? []) {
    tags.push({
      line: text.slice(0, text.indexOf(match)).split('\n').length,
      name: /^<([a-z0-9-]+)/.exec(match)?.[1] ?? '',
      attrs: match.replace(/\s+/g, ' '),
    });
  }
  return tags;
}

const svelteFiles = collectSourceFiles({ dirs: ['src'], extensions: ['.svelte'] });

describe('the legacy backdrop shape is gone from src/, and cannot come back', () => {
  test('no element is a role="button" with tabindex="-1"', () => {
    // That pair IS the retired backdrop signature: it announces a button to
    // assistive tech while being programmatically-focusable-only. Menus have
    // `role="menuitem"`, real controls have `tabindex="0"`, and a dismiss cover
    // is aria-hidden - so nothing legitimate needs the combination.
    const offenders: string[] = [];
    for (const file of svelteFiles) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8');
      for (const tag of tagsOf(source)) {
        if (/role="button"/.test(tag.attrs) && /tabindex="-1"/.test(tag.attrs)) {
          offenders.push(`${file}:${tag.line} <${tag.name}>`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('an aria-hidden element carries no keyboard affordance or name', () => {
    // The other half of the same idea, stated generally: a node removed from the
    // accessible tree must not advertise a role, a name, a tab stop or a key
    // handler - each of those is a promise to a user who cannot perceive it.
    const offenders: string[] = [];
    for (const file of svelteFiles) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8');
      for (const tag of tagsOf(source)) {
        if (!/aria-hidden="true"/.test(tag.attrs)) continue;
        const forbidden = ['role=', 'tabindex=', 'aria-label=', 'onkeydown='].filter((attr) =>
          tag.attrs.includes(attr)
        );
        if (tag.name === 'button') forbidden.push('<button>');
        if (forbidden.length > 0) {
          offenders.push(`${file}:${tag.line} <${tag.name}> ${forbidden.join(',')}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('every dialog shell and click-away still HAS an aria-hidden cover', () => {
    // The scan above would also pass if someone deleted the backdrop outright,
    // so each surface that must be dismissible is named and checked for one.
    const surfaces = [
      ...DIALOGS.map((dialog) => dialog.path),
      'src/ui/views/mailbox/MailboxView.svelte',
    ];
    for (const path of surfaces) {
      const source = readFileSync(join(REPO_ROOT, path), 'utf8');
      const covers = tagsOf(source).filter(
        (tag) => /aria-hidden="true"/.test(tag.attrs) && /inset-0/.test(tag.attrs)
      );
      expect([path, covers.length > 0]).toEqual([path, true]);
    }
  });

  test('the mailbox click-away keeps Escape reachable through the tier stack', () => {
    // Mounting MailboxView is not this suite's job, and its ESCAPE wiring is the
    // part a future edit of that backdrop would quietly drop: the element can no
    // longer carry a key handler (it is aria-hidden and never focusable), so the
    // view registers the context menu as an Escape tier keyed on its own open
    // flag - the same shape as the selection tier beside it. Pinned by structure,
    // as the mailbox selection tests pin theirs.
    const source = readFileSync(join(REPO_ROOT, 'src/ui/views/mailbox/MailboxView.svelte'), 'utf8');
    expect(source).toContain("registerEscapeTier('mailbox.contextMenu', closeContextMenu)");
    expect(source).toContain('if (!contextMenuOpen) return;');
  });

  test('the scan is reading the tree it claims to (not vacuously green)', () => {
    expect(svelteFiles.length).toBeGreaterThan(50);
    expect(svelteFiles.every((file) => file.startsWith('src/') && file.endsWith('.svelte'))).toBe(
      true
    );
    // And the invariants are not trivially satisfiable: the shapes they forbid
    // do appear in fixtures passed through the same reader.
    const fixture = '<div role="button" tabindex="-1" aria-label="Close"></div>';
    const tag = tagsOf(fixture)[0];
    expect(tag).toBeDefined();
    expect(/role="button"/.test(tag?.attrs ?? '') && /tabindex="-1"/.test(tag?.attrs ?? '')).toBe(
      true
    );
  });
});
