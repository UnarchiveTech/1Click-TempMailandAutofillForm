import { afterAll, expect, mock, test } from 'bun:test';
import type { AppStateRestoreDeps } from '@/features/navigation/app-state-restore.js';
import type { AutofillTab, View } from '@/features/types/view-types.js';

afterAll(() => mock.restore());
mock.module('@/utils/storage/vault-lock.js', () => ({ isVaultLocked: async () => false }));
const { createAppStateRestoreController } = await import(
  '@/features/navigation/app-state-restore.js'
);

function harness(state: Record<string, unknown>) {
  const local: Record<string, unknown> = { expandedAppState: state };
  let view: View = 'mailbox';
  let tab: AutofillTab = 'profiles';
  let organize = 'tags';
  const noop = () => {};
  const deps: AppStateRestoreDeps = {
    ext: {
      storage: {
        local: {
          get: async () => ({ ...local }),
          remove: async (keys: string[]) => {
            for (const key of keys) delete local[key];
          },
        },
      },
    } as unknown as Browser,
    context: 'app',
    getLayoutSplit: () => true,
    getLayoutVerticalSplit: () => false,
    getAllAddresses: () => [],
    getEmails: () => [],
    getCurrentView: () => view,
    setCurrentView: (value) => {
      view = value;
    },
    setAutofillTab: (value) => {
      tab = value;
    },
    setOrganizeTab: (value) => {
      organize = value;
    },
    setSettingsSubpage: noop,
    setPreviousViewBeforeSubpage: noop,
    setMgmtTab: noop,
    setMgmtSearch: noop,
    setArchivedSearch: noop,
    setSelectedThread: noop,
    setCurrentEmailDetail: noop,
    setSplitSecondaryView: noop,
    setMailProviderSplitOpen: noop,
    setSplitPaneCollapsed: noop,
    setLoading: noop,
    selectAddress: async () => {},
    checkMessages: async () => {},
    openMessageDetail: noop,
    evaluateProviderFailoverAfterRefresh: async () => {},
    tick: async () => {},
  };
  return {
    controller: createAppStateRestoreController(deps),
    current: () => ({ view, tab, organize }),
    local,
  };
}

test('expanded app restores each valid Autofill tab and consumes the handoff once', async () => {
  for (const tab of ['profiles', 'credentials', 'sites'] as const) {
    const { controller, current, local } = harness({
      currentView: 'autofill',
      autofillTab: tab,
      organizeTab: 'filters',
    });
    await controller.restore(Promise.resolve());
    expect(current()).toEqual({ view: 'autofill', tab, organize: 'filters' });
    expect(local.expandedAppState).toBeUndefined();
    controller.stop();
  }
});
test('unrecognized stored subtabs do not become navigation state', async () => {
  const { controller, current } = harness({
    currentView: 'autofill',
    autofillTab: 'broken',
    organizeTab: 'broken',
  });
  await controller.restore(Promise.resolve());
  expect(current()).toEqual({ view: 'autofill', tab: 'profiles', organize: 'tags' });
  controller.stop();
});
