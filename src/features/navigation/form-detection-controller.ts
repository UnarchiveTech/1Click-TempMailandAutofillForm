interface FormDetectionResponse {
  formDetected?: boolean;
  verificationRequired?: boolean;
}

export interface FormDetectionControllerDeps {
  ext: Browser;
  setDetected: (detected: boolean) => void;
  setVerificationRequired?: (required: boolean) => void;
  onFormPresence?: (message: { formDetected?: boolean }) => void;
}

export interface FormDetectionController {
  start: () => Promise<void>;
  stop: () => void;
}

/**
 * Keeps the toolbar form-presence badge synchronized with the active tab.
 * Poll results are generation-checked so a late response from a previous tab
 * cannot repaint the badge after navigation or teardown.
 */
export function createFormDetectionController(
  deps: FormDetectionControllerDeps
): FormDetectionController {
  let generation = 0;
  let activeTabId: number | undefined;
  let presenceRevision = 0;
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  const poll = async (tabId?: number) => {
    const requestGeneration = ++generation;
    const requestPresenceRevision = presenceRevision;
    try {
      let id = tabId;
      if (id == null) {
        const [tab] = await deps.ext.tabs.query({ active: true, currentWindow: true });
        id = tab?.id;
      }
      if (requestGeneration !== generation) return;
      activeTabId = id;
      if (id == null) {
        deps.setDetected(false);
        deps.setVerificationRequired?.(false);
        return;
      }
      const response = (await deps.ext.tabs.sendMessage(id, {
        type: 'checkFormDetected',
      })) as FormDetectionResponse | null;
      if (requestGeneration === generation) {
        if (requestPresenceRevision === presenceRevision)
          deps.setDetected(!!response?.formDetected);
        deps.setVerificationRequired?.(response?.verificationRequired === true);
      }
    } catch {
      if (requestGeneration === generation) {
        deps.setDetected(false);
        deps.setVerificationRequired?.(false);
      }
    }
  };

  const handleTabActivated = (activeInfo: { tabId: number }) => {
    activeTabId = activeInfo.tabId;
    deps.setDetected(false);
    deps.setVerificationRequired?.(false);
    void poll(activeInfo.tabId);
  };

  const handleTabUpdated = (
    tabId: number,
    changeInfo: { url?: string; status?: string },
    tab: { active?: boolean }
  ) => {
    if (!tab.active || (!changeInfo.url && changeInfo.status !== 'complete')) return;
    activeTabId = tabId;
    if (changeInfo.url) {
      deps.setDetected(false);
      deps.setVerificationRequired?.(false);
    }
    void poll(tabId);
  };

  const handleRuntimeMessage = (message: unknown, sender: { tab?: { id?: number } }) => {
    if (
      message &&
      typeof message === 'object' &&
      (message as { type?: string }).type === 'formPresence'
    ) {
      // Content scripts push readiness as soon as fields appear. Other tabs
      // must not repaint the active page's controls. A newer presence event
      // wins over a poll's form flag without dropping its CAPTCHA status.
      if (sender.tab?.id == null || sender.tab.id !== activeTabId) return;
      presenceRevision += 1;
      const formPresence = message as { formDetected?: boolean };
      deps.setDetected(!!formPresence.formDetected);
      deps.onFormPresence?.(formPresence);
    }
  };

  return {
    start: async () => {
      await poll();
      pollInterval = setInterval(() => {
        void poll();
      }, 12000);
      try {
        deps.ext.runtime.onMessage.addListener(handleRuntimeMessage);
      } catch {
        /* ignore unavailable runtime listeners */
      }
      deps.ext.tabs.onActivated.addListener(handleTabActivated);
      deps.ext.tabs.onUpdated.addListener(handleTabUpdated);
    },
    stop: () => {
      generation += 1;
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      deps.ext.tabs.onActivated.removeListener(handleTabActivated);
      deps.ext.tabs.onUpdated.removeListener(handleTabUpdated);
      try {
        deps.ext.runtime.onMessage.removeListener(handleRuntimeMessage);
      } catch {
        /* ignore unavailable runtime listeners */
      }
    },
  };
}
