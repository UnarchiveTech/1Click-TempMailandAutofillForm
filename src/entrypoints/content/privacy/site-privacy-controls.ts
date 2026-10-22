import {
  isDomainBlocked,
  notifyAutofillBlocklistChanged,
  toggleAutofillBlocklist,
} from '@/utils/content/autofill-blocklist.js';
import {
  getSitePrivacySettingsViaBg,
  setSitePrivacySettingViaBg,
} from '@/utils/content/content-bg-bridge.js';
import {
  cacheSitePrivacySettings,
  type SitePrivacySettings,
} from '@/utils/content/site-privacy-settings.js';
import { t } from '@/utils/i18n/content-i18n.js';
import { logError } from '@/utils/logger.js';
import { CONTENT_Z } from '@/utils/ui/portal-layers.js';
import { getOrCreateShadowRoot } from '../dom/shadow-dom.js';

const HOST_ATTRIBUTE = 'data-site-privacy-controls';

export function sitePrivacyControlsMounted(): boolean {
  return Boolean(getOrCreateShadowRoot()?.querySelector(`[${HOST_ATTRIBUTE}]`));
}

/** Mounts a small persistent page toolbar, separate from disposable autofill controls. */
export function mountSitePrivacyControls(): () => void {
  const root = getOrCreateShadowRoot();
  if (!root || root.querySelector(`[${HOST_ATTRIBUTE}]`)) return () => {};

  const wrapper = document.createElement('div');
  wrapper.setAttribute(HOST_ATTRIBUTE, '');
  wrapper.style.cssText = `position:fixed;right:12px;bottom:16px;pointer-events:auto;z-index:${CONTENT_Z.popup};font-family:system-ui,sans-serif;color:var(--md-on-surface,#202124);`;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.textContent = '⛨';
  trigger.style.cssText =
    'width:38px;height:38px;border:1px solid var(--md-outline-variant,#dadce0);border-radius:50%;background:var(--md-surface-container,#fff);color:inherit;box-shadow:0 2px 8px #0003;cursor:pointer;font-size:18px;';
  trigger.setAttribute('aria-expanded', 'false');
  const controlsTitle = t('privacy.siteControlsTitle');
  void controlsTitle.then((label) => {
    trigger.setAttribute('aria-label', label);
    trigger.title = label;
  });

  const panel = document.createElement('section');
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-labelledby', 'site-privacy-title');
  panel.hidden = true;
  panel.style.cssText =
    'position:absolute;right:0;bottom:46px;width:min(290px,calc(100vw - 32px));padding:14px;border:1px solid var(--md-outline-variant,#dadce0);border-radius:14px;background:var(--md-surface-container,#fff);box-shadow:0 8px 28px #0003;';
  const heading = document.createElement('h2');
  heading.id = 'site-privacy-title';
  heading.style.cssText =
    'font-size:var(--md-type-title-medium-size,16px);line-height:var(--md-type-title-medium-line,24px);margin:0 0 8px;font-weight:500;';
  const hostLabel = document.createElement('div');
  hostLabel.textContent = location.hostname;
  hostLabel.style.cssText =
    'font-size:var(--md-type-body-small-size,12px);line-height:var(--md-type-body-small-line,16px);color:var(--md-on-surface-variant);margin-bottom:10px;overflow-wrap:anywhere;';
  panel.append(heading, hostLabel);

  const controls: HTMLInputElement[] = [];
  let disposed = false;
  let busy = false;
  let settings: SitePrivacySettings = { otpDetection: true, formScanning: true };

  const refresh = async () => {
    const loaded = await getSitePrivacySettingsViaBg();
    if (loaded && !disposed) {
      settings = loaded;
      cacheSitePrivacySettings(loaded);
      let autofillEnabled = true;
      try {
        autofillEnabled = !(await isDomainBlocked(location.hostname));
      } catch (error: unknown) {
        logError('Could not read site autofill preference', error);
      }
      if (!disposed) {
        controls[0].checked = autofillEnabled;
        controls[1].checked = settings.otpDetection;
        controls[2].checked = settings.formScanning;
      }
    }
  };

  const rows = [
    { label: t('privacy.siteAutofill'), feature: 'autofill' as const },
    { label: t('privacy.siteOtpDetection'), feature: 'otpDetection' as const },
    { label: t('privacy.siteFormScanning'), feature: 'formScanning' as const },
  ];
  for (const row of rows) {
    const label = document.createElement('label');
    label.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;font-size:var(--md-type-label-large-size,14px);line-height:var(--md-type-label-large-line,20px);cursor:pointer;';
    const text = document.createElement('span');
    void row.label.then((translated) => {
      if (!disposed) text.textContent = translated;
    });
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.style.cssText =
      'width:16px;height:16px;accent-color:var(--md-primary,#6750a4);cursor:pointer;flex:none;';
    checkbox.addEventListener('change', async () => {
      if (busy) {
        await refresh();
        return;
      }
      busy = true;
      controls.forEach((control) => {
        control.disabled = true;
      });
      try {
        if (row.feature === 'autofill') {
          const currentlyBlocked = await isDomainBlocked(location.hostname);
          if (checkbox.checked === currentlyBlocked) {
            await toggleAutofillBlocklist(location.hostname);
            await notifyAutofillBlocklistChanged();
          }
        } else {
          const saved = await setSitePrivacySettingViaBg(row.feature, checkbox.checked);
          if (!saved) logError('Could not save site privacy preference');
        }
        await refresh();
      } catch (error: unknown) {
        logError('Could not update site privacy preference', error);
        await refresh();
      } finally {
        busy = false;
        controls.forEach((control) => {
          control.disabled = false;
        });
      }
    });
    label.append(text, checkbox);
    panel.append(label);
    controls.push(checkbox);
  }

  trigger.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open) void refresh();
  });
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !panel.hidden) {
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      trigger.focus();
    }
  };
  window.addEventListener('keydown', closeOnEscape);
  const refreshOnExternalChange = () => void refresh();
  window.addEventListener('site-privacy-settings-changed', refreshOnExternalChange);
  window.addEventListener('autofill-blocklist-changed', refreshOnExternalChange);
  wrapper.append(panel, trigger);
  root.append(wrapper);
  void controlsTitle.then((label) => {
    if (!disposed) heading.textContent = label;
  });
  void refresh();

  return () => {
    disposed = true;
    window.removeEventListener('keydown', closeOnEscape);
    window.removeEventListener('site-privacy-settings-changed', refreshOnExternalChange);
    window.removeEventListener('autofill-blocklist-changed', refreshOnExternalChange);
    wrapper.remove();
  };
}
