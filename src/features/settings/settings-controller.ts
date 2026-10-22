import type { browser } from 'wxt/browser';
import type { AutoRenewScope } from '@/utils/types.js';
import type { SettingsSetters, SettingsState } from './settings-actions.js';
import {
  addCustomInstance,
  changeProvider,
  handleColorChange,
  handleProviderChange,
  hardReset,
  loadProviderInstances,
  loadSettings,
  saveAutoCopy,
  saveAutoRenew,
  saveAutoRenewScope,
  saveAutoRenewWindowMinutes,
  saveSettings,
  setProviderInstance,
  toggleDeveloperSettings,
  toggleEnableLogging,
} from './settings-actions.js';

export type { SettingsSetters, SettingsState } from './settings-actions.js';

export function createSettingsController(ext: typeof browser, setters: SettingsSetters) {
  return {
    load: (state: SettingsState) => loadSettings(ext, state, setters),
    save: (state: SettingsState) => saveSettings(ext, state, setters),
    toggleDeveloperSettings: (state: SettingsState) => toggleDeveloperSettings(ext, state, setters),
    toggleEnableLogging: (state: SettingsState) => toggleEnableLogging(ext, state, setters),
    handleProviderChange: (provider: string) => handleProviderChange(ext, provider, setters),
    saveAutoCopy: (value: boolean) => saveAutoCopy(ext, value),
    saveAutoRenew: (value: boolean) => saveAutoRenew(ext, value),
    saveAutoRenewScope: (value: AutoRenewScope) => saveAutoRenewScope(ext, value),
    saveAutoRenewWindowMinutes: (value: number) => saveAutoRenewWindowMinutes(ext, value),
    handleColorChange: (color: string) => handleColorChange(ext, color),
    changeProvider: (provider: string) => changeProvider(ext, provider, setters),
    loadProviderInstances: () => loadProviderInstances(ext, setters),
    setProviderInstance: (instanceId: string) => setProviderInstance(instanceId, ext, setters),
    addCustomInstance: (name: string, url: string) => addCustomInstance(ext, name, url, setters),
    hardReset: () => hardReset(ext, setters),
  };
}
