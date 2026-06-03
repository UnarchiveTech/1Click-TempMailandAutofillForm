import { browser } from 'wxt/browser';

/**
 * Form filling logic: fills signup form fields with generated / stored data
 */

import { decrypt } from '@/utils/crypto.js';
import { NoActiveInboxError } from '@/utils/errors.js';
import { logError } from '@/utils/logger.js';
import { randomItem } from '@/utils/secure-random.js';
import type { CredentialsHistoryItem } from '@/utils/types.js';
import {
  generatePassword,
  generatePhoneNumber,
  generateRandomName,
  generateUsername,
  generateWebsiteUrl,
} from './generators.js';

export interface FilledNames {
  firstName: string;
  lastName: string;
  fullName: string;
}

export async function getPasswordToFill(): Promise<string> {
  const { passwordSettings = {} } = (await browser.storage.local.get(['passwordSettings'])) as {
    passwordSettings?: { useCustom?: boolean; customPassword?: string };
  };
  if (passwordSettings.useCustom && passwordSettings.customPassword) {
    return passwordSettings.customPassword;
  }
  return generatePassword();
}

export async function getNamesToFill(): Promise<FilledNames> {
  const { nameSettings = {} } = (await browser.storage.local.get(['nameSettings'])) as {
    nameSettings?: { useCustom?: boolean; firstName?: string; lastName?: string };
  };
  if (nameSettings.useCustom && nameSettings.firstName && nameSettings.lastName) {
    return {
      firstName: nameSettings.firstName,
      lastName: nameSettings.lastName,
      fullName: `${nameSettings.firstName} ${nameSettings.lastName}`,
    };
  }
  const randomFullName = generateRandomName();
  const [randomFirstName, randomLastName] = randomFullName.split(' ');
  return { firstName: randomFirstName, lastName: randomLastName, fullName: randomFullName };
}

export function fillSelectElement(selectElement: HTMLSelectElement): void {
  const options = Array.from(selectElement.options);
  const validOptions = options.filter(
    (option: HTMLOptionElement) =>
      !option.disabled &&
      option.value &&
      option.value.trim() !== '' &&
      !/select|choose|pick/i.test(option.textContent ?? '')
  );

  if (validOptions.length > 0) {
    const randomOption = randomItem(validOptions);
    if (!randomOption) return;
    selectElement.value = randomOption.value;
  }
}

export async function fillSignupForm(
  form: HTMLFormElement,
  updateAndCopyCredentials: (creds: Record<string, string>) => Promise<void>,
  identity?: {
    firstNames?: string;
    lastNames?: string;
    useRandomPassword?: boolean;
    customPassword?: string;
    phone?: string;
    pin?: string;
  }
): Promise<boolean> {
  try {
    const { activeInboxId, inboxes = [] } = (await browser.storage.local.get([
      'activeInboxId',
      'inboxes',
    ])) as { activeInboxId?: string; inboxes?: Array<{ id: string; address: string }> };
    const inbox = inboxes.find((i: { id: string; address: string }) => i.id === activeInboxId);
    if (!inbox) throw new NoActiveInboxError({ activeInboxId });

    let names: FilledNames;
    if (identity?.firstNames && identity?.lastNames) {
      // Parse comma-separated names and select randomly
      const firstNameList = identity.firstNames
        .split(',')
        .map((n) => n.trim())
        .filter((n) => n);
      const lastNameList = identity.lastNames
        .split(',')
        .map((n) => n.trim())
        .filter((n) => n);

      const firstName = randomItem(firstNameList) ?? '';
      const lastName = randomItem(lastNameList) ?? '';

      names = {
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`,
      };
    } else {
      names = await getNamesToFill();
    }

    const { fullName, firstName, lastName } = names;

    const emailInput = form.querySelector<HTMLInputElement>(
      'input[type="email"], input[name*="email"], input[id*="email"]'
    );
    const usernameInput = form.querySelector<HTMLInputElement>(
      'input[name*="username"], input[id*="username"], input[name*="userid"], input[id*="userid"], ' +
        'input[name*="login"], input[id*="login"], input[placeholder*="username" i], input[placeholder*="user id" i], input[placeholder*="login" i]'
    );
    const phoneInput = form.querySelector<HTMLInputElement>(
      'input[type="tel"], input[name*="phone"], input[id*="phone"], input[name*="mobile"], input[id*="mobile"], input[placeholder*="phone"], input[placeholder*="mobile"]'
    );
    const websiteInput = form.querySelector<HTMLInputElement>(
      'input[type="url"], input[name*="website"], input[id*="website"], input[placeholder*="website"], input[name*="url"], input[id*="url"], input[placeholder*="url"]'
    );
    const firstNameInput = form.querySelector<HTMLInputElement>(
      'input[name*="firstname" i], input[id*="firstname" i], input[name*="fname" i], input[id*="fname" i], input[placeholder*="first name" i]'
    );
    const lastNameInput = form.querySelector<HTMLInputElement>(
      'input[name*="lastname" i], input[id*="lastname" i], input[name*="lname" i], input[id*="lname" i], input[placeholder*="last name" i]'
    );
    const fullNameInput = form.querySelector<HTMLInputElement>(
      'input[name*="fullname" i], input[id*="fullname" i], input[name*="name"]:not([name*="user"]):not([name*="first"]):not([name*="last"]), input[id*="name"]:not([id*="user"]):not([id*="first"]):not([name*="last"]), input[placeholder*="full name" i], input[placeholder*="name" i]:not([placeholder*="user"]):not([placeholder*="first"]):not([placeholder*="last"])'
    );

    const emailAddress = inbox.address;
    let password: string;
    if (!identity?.useRandomPassword && identity?.customPassword) {
      try {
        password = await decrypt(identity.customPassword);
      } catch {
        password = identity.customPassword;
      }
    } else {
      password = await getPasswordToFill();
    }

    const randomUsername = usernameInput ? generateUsername() : null;
    const randomPhone = identity?.phone || (phoneInput ? generatePhoneNumber() : null);

    let randomWebsite: string | null = null;
    if (websiteInput) {
      const placeholder = websiteInput.placeholder;
      randomWebsite =
        placeholder && (placeholder.startsWith('http') || placeholder.startsWith('www'))
          ? placeholder
          : generateWebsiteUrl();
    }

    function fillInput(input: HTMLInputElement | null, value: string | null): void {
      if (!input || value === null) return;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    fillInput(emailInput, emailAddress);
    fillInput(usernameInput, randomUsername);

    let nameFilled = false;
    if (firstNameInput && lastNameInput) {
      fillInput(firstNameInput, firstName);
      fillInput(lastNameInput, lastName);
      nameFilled = true;
    } else if (fullNameInput) {
      fillInput(fullNameInput, fullName);
      nameFilled = true;
    }

    form.querySelectorAll<HTMLSelectElement>('select').forEach((select: HTMLSelectElement) => {
      fillSelectElement(select);
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    fillInput(phoneInput, randomPhone);
    fillInput(websiteInput, randomWebsite);

    form
      .querySelectorAll<HTMLInputElement>(
        'input[type="password"], input[name*="password"], input[id*="password"]'
      )
      .forEach((input: HTMLInputElement) => {
        void fillInput(input, password);
      });

    const termsCheckbox = form.querySelector<HTMLInputElement>(
      'input[type="checkbox"][name*="terms"], input[type="checkbox"][id*="terms"], input[type="checkbox"][name*="agree"], input[type="checkbox"][id*="agree"]'
    );
    if (termsCheckbox && !termsCheckbox.checked) termsCheckbox.click();

    const credentials: Record<string, string> = {};
    if (randomWebsite) credentials.website = randomWebsite;
    else credentials.website = window.location.hostname;
    credentials.email = emailAddress;
    if (randomUsername) credentials.username = randomUsername;
    credentials.password = password;
    if (nameFilled) credentials.name = fullName;
    if (randomPhone) credentials.phone = randomPhone;

    await updateAndCopyCredentials(credentials);

    const { loginInfo = [], selectedIdentityId } = (await browser.storage.local.get([
      'loginInfo',
      'selectedIdentityId',
    ])) as {
      loginInfo?: CredentialsHistoryItem[];
      selectedIdentityId?: string;
    };
    const newCredential: CredentialsHistoryItem = {
      email: emailAddress,
      username: randomUsername,
      name: nameFilled ? fullName : null,
      phone: randomPhone,
      website: websiteInput ? randomWebsite : null,
      password,
      domain: window.location.hostname,
      timestamp: Date.now(),
      inboxId: activeInboxId,
      identityId: selectedIdentityId,
    };
    loginInfo.unshift(newCredential);
    if (loginInfo.length > 50) loginInfo.length = 50;
    await browser.storage.local.set({ loginInfo });

    return true;
  } catch (error: unknown) {
    logError(
      'Error filling form:',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
    return false;
  }
}
