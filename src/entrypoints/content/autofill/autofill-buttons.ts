/**
 * Autofill button injection and removal.
 */

import { browser } from 'wxt/browser';
import { BUTTON_OPACITY_DEFAULT, BUTTON_OPACITY_HOVER, BUTTON_SIZE_PX } from '@/utils/constants.js';
import { NoActiveInboxError } from '@/utils/errors.js';
import { positionButtonAtEndOfField } from '../dom/positioning.js';
import { showTooltip } from '../dom/tooltip.js';
import {
  fillSelectElement,
  fillSignupForm,
  getNamesToFill,
  getPasswordToFill,
} from './form-filler.js';
import { generatePhoneNumber, generateUsername, generateWebsiteUrl } from './generators.js';

// Default colors matching the extension's theme (#4c662b is the default --md-primary seed color)
const DEFAULT_PRIMARY_COLOR = '#4c662b';
const DEFAULT_PRIMARY_HOVER = '#3a4e20';

// Cached colors to avoid repeated storage reads
let cachedPrimaryColor: string | null = null;

async function getPrimaryColor(): Promise<string> {
  if (cachedPrimaryColor) return cachedPrimaryColor;

  try {
    const result = (await browser.storage.local.get('customColor')) as { customColor?: string };
    cachedPrimaryColor = result.customColor || DEFAULT_PRIMARY_COLOR;
    return cachedPrimaryColor;
  } catch {
    return DEFAULT_PRIMARY_COLOR;
  }
}

function getPrimaryHoverColor(primaryColor: string): string {
  // Darken the primary color for hover state
  if (primaryColor.startsWith('#')) {
    const hex = primaryColor.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `#${Math.max(0, r - 20)
      .toString(16)
      .padStart(2, '0')}${Math.max(0, g - 20)
      .toString(16)
      .padStart(2, '0')}${Math.max(0, b - 20)
      .toString(16)
      .padStart(2, '0')}`;
  }
  return DEFAULT_PRIMARY_HOVER;
}

export async function injectAutoFillButtons(
  form: HTMLFormElement,
  injectedButtons: HTMLElement[],
  updatePositionListeners: Array<() => void>,
  autoFillButtonsInjected: { value: boolean },
  updateAndCopyCredentials: (creds: Record<string, string>) => Promise<void>
): Promise<void> {
  if (autoFillButtonsInjected.value) return;
  removeInjectedButtons(injectedButtons, updatePositionListeners);

  const inputFields = form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    'input[type="text"], input[type="email"], input[type="password"], input[type="tel"], input[type="checkbox"], select, ' +
      '[name*="email"], [id*="email"], [name*="username"], [id*="username"], ' +
      '[name*="name"]:not([name*="username"]), [id*="name"]:not([id*="username"]), ' +
      '[name*="phone"], [id*="phone"], [name*="mobile"], [id*="mobile"]'
  );

  const svgStyle = 'style="pointer-events: none;"';
  const primaryColor = await getPrimaryColor();
  const primaryHoverColor = getPrimaryHoverColor(primaryColor);

  inputFields.forEach((inputField: HTMLInputElement | HTMLSelectElement) => {
    const isSelect = inputField.tagName.toLowerCase() === 'select';
    const isCheckbox = !isSelect && (inputField as HTMLInputElement).type === 'checkbox';
    const isInput = !isSelect;

    const isEmail =
      isInput &&
      ((inputField as HTMLInputElement).type === 'email' ||
        inputField.name.toLowerCase().includes('email') ||
        inputField.id.toLowerCase().includes('email') ||
        (inputField as HTMLInputElement).placeholder?.toLowerCase().includes('email'));

    const isPassword =
      isInput &&
      ((inputField as HTMLInputElement).type === 'password' ||
        inputField.name.toLowerCase().includes('password') ||
        inputField.id.toLowerCase().includes('password') ||
        (inputField as HTMLInputElement).placeholder?.toLowerCase().includes('password'));

    const isPhone =
      isInput &&
      ((inputField as HTMLInputElement).type === 'tel' ||
        inputField.name.toLowerCase().includes('phone') ||
        inputField.id.toLowerCase().includes('phone') ||
        inputField.name.toLowerCase().includes('mobile') ||
        inputField.id.toLowerCase().includes('mobile') ||
        (inputField as HTMLInputElement).placeholder?.toLowerCase().includes('phone') ||
        (inputField as HTMLInputElement).placeholder?.toLowerCase().includes('mobile'));

    const isUsername =
      isInput &&
      (inputField.name.toLowerCase().includes('username') ||
        inputField.id.toLowerCase().includes('username') ||
        inputField.name.toLowerCase().includes('userid') ||
        inputField.id.toLowerCase().includes('userid') ||
        inputField.name.toLowerCase().includes('login') ||
        inputField.id.toLowerCase().includes('login') ||
        (inputField as HTMLInputElement).placeholder?.toLowerCase().includes('username') ||
        (inputField as HTMLInputElement).placeholder?.toLowerCase().includes('user id') ||
        (inputField as HTMLInputElement).placeholder?.toLowerCase().includes('login'));

    const isFirstName =
      isInput &&
      (inputField.name.toLowerCase().includes('firstname') ||
        inputField.id.toLowerCase().includes('firstname') ||
        inputField.name.toLowerCase().includes('fname') ||
        inputField.id.toLowerCase().includes('fname') ||
        (inputField as HTMLInputElement).placeholder?.toLowerCase().includes('first name'));

    const isLastName =
      isInput &&
      (inputField.name.toLowerCase().includes('lastname') ||
        inputField.id.toLowerCase().includes('lastname') ||
        inputField.name.toLowerCase().includes('lname') ||
        inputField.id.toLowerCase().includes('lname') ||
        (inputField as HTMLInputElement).placeholder?.toLowerCase().includes('last name'));

    const isFullName =
      isInput &&
      (inputField.name.toLowerCase().includes('fullname') ||
        inputField.id.toLowerCase().includes('fullname') ||
        (inputField as HTMLInputElement).placeholder?.toLowerCase().includes('full name') ||
        ((inputField.name.toLowerCase().includes('name') ||
          inputField.id.toLowerCase().includes('name') ||
          (inputField as HTMLInputElement).placeholder?.toLowerCase().includes('name')) &&
          !inputField.name.toLowerCase().includes('username') &&
          !inputField.id.toLowerCase().includes('username') &&
          !(inputField as HTMLInputElement).placeholder?.toLowerCase().includes('username') &&
          !isFirstName &&
          !isLastName));

    const isWebsite =
      isInput &&
      ((inputField as HTMLInputElement).type === 'url' ||
        inputField.name.toLowerCase().includes('website') ||
        inputField.id.toLowerCase().includes('website') ||
        (inputField as HTMLInputElement).placeholder?.toLowerCase().includes('website') ||
        inputField.name.toLowerCase().includes('url') ||
        inputField.id.toLowerCase().includes('url') ||
        (inputField as HTMLInputElement).placeholder?.toLowerCase().includes('url'));

    let iconSvg: string;
    if (isEmail) {
      iconSvg = `<svg ${svgStyle} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>`;
    } else if (isPassword) {
      iconSvg = `<svg ${svgStyle} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>`;
    } else if (isPhone) {
      iconSvg = `<svg ${svgStyle} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/></svg>`;
    } else if (isFirstName || isLastName || isFullName || isUsername) {
      iconSvg = `<svg ${svgStyle} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`;
    } else if (isSelect) {
      iconSvg = `<svg ${svgStyle} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12.5,2.17L11.83,2.83L13.67,4.67L12,5.5L9.5,4L10.25,7H5.5L4,9.5L7,10.25L4,13.25L5.5,14H8.5L9,17L12,14.5L15,17L15.5,14H18.5L20,13.25L17,10.25L20,9.5L18.5,7H13.75L14.5,4L13,2.5L12.5,2.17M12,7.29L11,10L12,12.71L13,10L12,7.29Z" /></svg>`;
    } else if (isWebsite) {
      iconSvg = `<svg ${svgStyle} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`;
    } else if (isCheckbox) {
      iconSvg = `<svg ${svgStyle} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
    } else {
      iconSvg = `<svg ${svgStyle} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2.5l-2.8 5.7-6.2.9 4.5 4.4-1.1 6.2L12 16.5l5.1 3.2-1.1-6.2 4.5-4.4-6.2-.9z"/></svg>`;
    }

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'autofill-button-container';
    buttonContainer.style.cssText = `
      position: absolute;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: ${BUTTON_OPACITY_DEFAULT};
      transition: opacity 0.2s;
    `;
    buttonContainer.onmouseover = () => {
      buttonContainer.style.opacity = String(BUTTON_OPACITY_HOVER);
    };
    buttonContainer.onmouseout = () => {
      buttonContainer.style.opacity = String(BUTTON_OPACITY_DEFAULT);
    };

    const autoFillButton = document.createElement('button');
    autoFillButton.className = 'autofill-button';
    autoFillButton.title = 'Auto-fill this field';
    autoFillButton.style.cssText = `
      background-color: ${primaryColor};
      color: white;
      border: none;
      border-radius: 50%;
      width: ${BUTTON_SIZE_PX}px;
      height: ${BUTTON_SIZE_PX}px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      padding: 0;
    `;
    autoFillButton.onmouseover = () => {
      autoFillButton.style.backgroundColor = primaryHoverColor;
    };
    autoFillButton.onmouseout = () => {
      autoFillButton.style.backgroundColor = primaryColor;
    };
    autoFillButton.onmousedown = () => {
      autoFillButton.style.transform = 'scale(0.98)';
    };
    autoFillButton.onmouseup = () => {
      autoFillButton.style.transform = 'scale(1)';
    };
    autoFillButton.innerHTML = iconSvg;

    autoFillButton.addEventListener('click', async (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      try {
        let credentialsToUpdate: Record<string, string> = {};

        if (isEmail) {
          const { activeInboxId, inboxes = [] } = (await browser.storage.local.get([
            'activeInboxId',
            'inboxes',
          ])) as { activeInboxId?: string; inboxes?: Array<{ id: string; address: string }> };
          const inbox = inboxes.find(
            (i: { id: string; address: string }) => i.id === activeInboxId
          );
          if (!inbox) throw new NoActiveInboxError({ activeInboxId });
          (inputField as HTMLInputElement).value = inbox.address;
          credentialsToUpdate = { email: inbox.address };
          await showTooltip(autoFillButton, 'Email filled', false);
        } else if (isPassword) {
          const password = await getPasswordToFill();
          (inputField as HTMLInputElement).value = password;
          credentialsToUpdate = { password };
          await showTooltip(autoFillButton, 'Password generated', false);
        } else if (isPhone) {
          const phone = generatePhoneNumber();
          (inputField as HTMLInputElement).value = phone;
          credentialsToUpdate = { phone };
          await showTooltip(autoFillButton, 'Phone number generated', false);
        } else if (isUsername) {
          const username = generateUsername();
          (inputField as HTMLInputElement).value = username;
          credentialsToUpdate = { username };
          await showTooltip(autoFillButton, 'Username generated', false);
        } else if (isFirstName || isLastName || isFullName) {
          const names = await getNamesToFill();
          let nameToFill: string;
          let fieldType: string;
          if (isFirstName) {
            nameToFill = names.firstName;
            fieldType = 'First Name';
          } else if (isLastName) {
            nameToFill = names.lastName;
            fieldType = 'Last Name';
          } else {
            nameToFill = names.fullName;
            fieldType = 'Full Name';
          }
          (inputField as HTMLInputElement).value = nameToFill;
          credentialsToUpdate = { name: names.fullName };
          await showTooltip(autoFillButton, `${fieldType} filled`, false);
        } else if (isSelect) {
          fillSelectElement(inputField as HTMLSelectElement);
          await showTooltip(autoFillButton, 'Option selected', false);
        } else if (isWebsite) {
          const placeholder = (inputField as HTMLInputElement).placeholder;
          const website =
            placeholder && (placeholder.startsWith('http') || placeholder.startsWith('www'))
              ? placeholder
              : generateWebsiteUrl();
          (inputField as HTMLInputElement).value = website;
          credentialsToUpdate = { website };
          await showTooltip(autoFillButton, 'Website filled', false);
        } else if (isCheckbox) {
          (inputField as HTMLInputElement).checked = !(inputField as HTMLInputElement).checked;
          await showTooltip(autoFillButton, 'Checkbox toggled', false);
        } else {
          const username = generateUsername();
          (inputField as HTMLInputElement).value = username;
          credentialsToUpdate = { username };
          await showTooltip(autoFillButton, 'Field filled', false);
        }

        inputField.dispatchEvent(new Event('input', { bubbles: true }));
        inputField.dispatchEvent(new Event('change', { bubbles: true }));

        if (Object.keys(credentialsToUpdate).length > 0) {
          await updateAndCopyCredentials(credentialsToUpdate);
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        await showTooltip(autoFillButton, `Error: ${errorMessage}`, true);
      }
    });

    buttonContainer.appendChild(autoFillButton);
    positionButtonAtEndOfField(buttonContainer, inputField as HTMLElement, updatePositionListeners);
    document.body.appendChild(buttonContainer);
    injectedButtons.push(buttonContainer);
  });

  await addFillAllButton(form, injectedButtons, updateAndCopyCredentials);
  autoFillButtonsInjected.value = true;
}

async function addFillAllButton(
  form: HTMLFormElement,
  injectedButtons: HTMLElement[],
  updateAndCopyCredentials: (creds: Record<string, string>) => Promise<void>
): Promise<void> {
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'autofill-button-container fill-all-container';
  buttonContainer.style.cssText = `
    position: absolute;
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.85;
    transition: opacity 0.2s;
  `;
  buttonContainer.onmouseover = () => {
    buttonContainer.style.opacity = '1';
  };
  buttonContainer.onmouseout = () => {
    buttonContainer.style.opacity = '0.85';
  };

  const primaryColor = await getPrimaryColor();
  const primaryHoverColor = getPrimaryHoverColor(primaryColor);

  const fillAllButton = document.createElement('button');
  fillAllButton.className = 'autofill-button fill-all-button';
  fillAllButton.title = 'Auto-fill all fields';
  fillAllButton.style.cssText = `
    background-color: ${primaryColor};
    color: white;
    border: none;
    border-radius: 20px;
    padding: 6px 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 500;
    transition: background-color 0.2s, transform 0.1s;
    box-shadow: 0 1px 3px rgba(60, 64, 67, 0.3);
  `;
  fillAllButton.onmouseover = () => {
    fillAllButton.style.backgroundColor = primaryHoverColor;
  };
  fillAllButton.onmouseout = () => {
    fillAllButton.style.backgroundColor = primaryColor;
  };
  fillAllButton.onmousedown = () => {
    fillAllButton.style.transform = 'scale(0.98)';
  };
  fillAllButton.onmouseup = () => {
    fillAllButton.style.transform = 'scale(1)';
  };
  fillAllButton.innerHTML = `
    <svg style="pointer-events: none; margin-right: 4px;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 8h-3v3c0 .55-.45 1-1 1s-1-.45-1-1v-3H9c-.55 0-1-.45-1-1s.45-1 1-1h3V7c0-.55.45-1 1-1s1 .45 1 1v3h3c.55 0 1 .45 1 1s-.45 1-1 1z"/>
    </svg>
    Fill All
  `;

  fillAllButton.addEventListener('click', async () => {
    try {
      const success = await fillSignupForm(form, updateAndCopyCredentials);
      if (success) {
        const hasPasswordField = form.querySelector(
          'input[type="password"], input[name*="password"], input[id*="password"]'
        );
        const msg = hasPasswordField
          ? 'Form filled successfully. Please review and submit.'
          : 'Email-only form filled successfully. Please review and submit.';
        await showTooltip(fillAllButton, msg, false);
      } else {
        await showTooltip(fillAllButton, 'Failed to fill form', true);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await showTooltip(fillAllButton, `Error: ${errorMessage}`, true);
    }
  });

  buttonContainer.appendChild(fillAllButton);

  const formRect = form.getBoundingClientRect();
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

  buttonContainer.style.position = 'absolute';
  buttonContainer.style.top = `${formRect.top + scrollTop - 40}px`;
  buttonContainer.style.left = `${formRect.left + scrollLeft + 10}px`;

  document.body.appendChild(buttonContainer);
  injectedButtons.push(buttonContainer);
}

export function removeInjectedButtons(
  injectedButtons: HTMLElement[],
  updatePositionListeners: Array<() => void>
): void {
  updatePositionListeners.forEach((cleanup) => {
    void cleanup();
  });
  updatePositionListeners.length = 0;

  injectedButtons.forEach((button: HTMLElement) => {
    if (button.parentNode) button.parentNode.removeChild(button);
  });
  injectedButtons.length = 0;
}
