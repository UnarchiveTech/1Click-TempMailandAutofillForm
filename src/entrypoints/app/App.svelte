<script lang="ts">
import { onMount } from 'svelte';
import { browser } from 'wxt/browser';
import AppLayout from '@/components/AppLayout.svelte';

/**
 * Full-page app view.
 * Never disable chrome.sidePanel — that permanently hid "Open Side Panel"
 * while the app tab stayed open in the background.
 * Only ensure toolbar click stays POPUP (not side panel).
 */
onMount(() => {
  void (async () => {
    try {
      const chromeApi = (
        globalThis as unknown as {
          chrome?: {
            sidePanel?: {
              setOptions?: (opts: { path?: string; enabled?: boolean }) => Promise<void>;
              setPanelBehavior?: (opts: { openPanelOnActionClick: boolean }) => Promise<void>;
            };
            action?: { setPopup?: (d: { popup: string }) => Promise<void> | void };
          };
        }
      ).chrome;
      const anyBrowser = browser as typeof browser & {
        sidePanel?: {
          setOptions?: (opts: { path?: string; enabled?: boolean }) => Promise<void>;
          setPanelBehavior?: (opts: { openPanelOnActionClick: boolean }) => Promise<void>;
        };
        action?: { setPopup?: (details: { popup: string }) => Promise<void> };
      };
      const sidePanel = chromeApi?.sidePanel ?? anyBrowser.sidePanel;
      const action = chromeApi?.action ?? anyBrowser.action;
      await sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false });
      await action?.setPopup?.({ popup: 'popup.html' });
      // Always leave side panel enabled so toolbar context menu can open it
      await sidePanel?.setOptions?.({ path: 'sidepanel.html', enabled: true });
      await sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false });
    } catch {
      /* sidePanel API unavailable */
    }
  })();
});
</script>

<AppLayout context="app" />
