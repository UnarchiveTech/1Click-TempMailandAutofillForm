import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, type Page, test } from '@playwright/test';
import { requireRunSignupAuthorization } from './authorization';
import { type ContentControl, clickContentControl, contentControls } from './content-controls';

interface Inbox {
  id: string;
  address: string;
  provider: string;
}

interface MailSummary {
  from: string;
  subject: string;
  hasOtp: boolean;
  hasMagicLink: boolean;
}

test('real RunSignup signup with real Guerrilla Mail and post-signup control cleanup', async ({
  browserName,
}, info) => {
  expect(browserName).toBe('chromium');
  requireRunSignupAuthorization(process.env.RUNSIGNUP_LIVE);
  const scratch = await mkdtemp(join(tmpdir(), '1click-runsignup-'));
  const build = join(scratch, 'extension');
  let submitted = false;
  let signupPosts = 0;
  let accountCreated = false;
  try {
    console.log('RunSignup live: preparing isolated extension copy');
    // A test-only copy provisions site access in the fresh profile. Production
    // manifest and the user's installed extension/site grants are untouched.
    await cp(resolve('.output/chrome-mv3'), build, { recursive: true });
    const manifestPath = join(build, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.host_permissions = [
      ...new Set([...(manifest.host_permissions || []), 'https://runsignup.com/*']),
    ];
    await writeFile(manifestPath, JSON.stringify(manifest));

    console.log('RunSignup live: launching native browser');
    const context = await chromium.launchPersistentContext(join(scratch, 'profile'), {
      headless: false,
      viewport: { width: 1280, height: 950 },
      args: [`--disable-extensions-except=${build}`, `--load-extension=${build}`],
    });
    try {
      context.setDefaultTimeout(30_000);
      console.log('RunSignup live: waiting for extension worker');
      const worker =
        context.serviceWorkers()[0] ||
        (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
      const base = worker.url().split('/').slice(0, 3).join('/');
      const ui = await context.newPage();
      await ui.goto(`${base}/app.html`);
      console.log('RunSignup live: configuring isolated profile');
      await ui.evaluate(async () => {
        await chrome.storage.local.set({
          onboardingComplete: true,
          demoMode: false,
          productTourCompleted: true,
          smartAutofillSettings: { dryRunPreview: true, autoClickSubmitButtons: false },
        });
      });
      // Invoke production provider handlers from a trusted extension page; the
      // response is real provider data, never a fake address or canned success.
      console.log('RunSignup live: creating real Guerrilla Mail inbox');
      const created = (await ui.evaluate(async () => {
        const reply = await chrome.runtime.sendMessage({
          type: 'createAddress',
          provider: 'guerrilla',
          skipHealthPick: true,
        });
        return {
          success: reply?.success,
          inbox: reply?.inbox && {
            id: reply.inbox.id,
            address: reply.inbox.address,
            provider: reply.inbox.provider,
          },
          error: reply?.error,
        };
      })) as { success: boolean; inbox?: Inbox; error?: unknown };
      expect(created.success, 'Real Guerrilla Mail creation must succeed').toBe(true);
      if (!created.inbox) throw new Error('Provider did not return a real inbox.');
      const inbox = created.inbox;
      expect(inbox.provider).toBe('guerrilla');
      console.log('RunSignup live: configuring approved fictional identity');
      await ui.evaluate(async (record) => {
        const now = Date.now();
        const identity = {
          id: 'runsignup-maintainer-test',
          name: 'RunSignup permitted test',
          firstNames: 'Extension',
          lastNames: 'TestAccount',
          useRandomPassword: true,
          phone: '2025550146',
          pin: '20001',
          country: 'US',
          state: 'DC',
          city: 'Washington',
          address: '123 Test Lane',
          dateOfBirth: '1990-01-01',
          gender: 'prefer_not',
          preferredEmail: record.address,
          isDefault: true,
          createdAt: now,
          updatedAt: now,
        };
        await chrome.storage.local.set({
          identities: [identity],
          selectedIdentityId: identity.id,
          activeAddressId: record.id,
          selectedEmail: record.address,
        });
      }, inbox);

      const site = await context.newPage();
      const cdp = await context.newCDPSession(site);
      await cdp.send('DOM.enable');
      site.on('request', (request) => {
        const url = new URL(request.url());
        if (
          url.hostname === 'runsignup.com' &&
          url.pathname === '/CreateAccount' &&
          request.method() === 'POST'
        )
          signupPosts++;
      });
      await site.goto('https://runsignup.com/CreateAccount?redirect=%2F', {
        waitUntil: 'domcontentloaded',
      });
      console.log('RunSignup live: checking real autofill controls');

      async function clickControl(matches: (control: ContentControl) => boolean): Promise<void> {
        let found: ContentControl | undefined;
        await expect
          .poll(async () => {
            found = (await contentControls(cdp)).find(
              (control) => control.visible && matches(control)
            );
            return !!found;
          })
          .toBe(true);
        if (!found) throw new Error('Required extension control is unavailable.');
        await clickContentControl(site, cdp, found);
      }
      await clickControl((control) => control.title === 'Autofill all fields');
      await clickControl((control) => control.text === 'Cancel');
      await expect(site.locator('#email')).toHaveValue('');
      await clickControl((control) => control.title === 'Autofill all fields');
      await clickControl((control) => control.text === 'Fill form');
      await expect(site.locator('#email')).toHaveValue(inbox.address);
      await expect(site.locator('#confirmEmail')).toHaveValue(inbox.address);
      await expect(site.locator('#firstName')).toHaveValue('Extension');
      await expect(site.locator('#lastName')).toHaveValue('TestAccount');
      // Boolean checks keep generated passwords out of assertion messages/reports.
      await expect
        .poll(() =>
          site.evaluate(() => {
            const password = document.querySelector<HTMLInputElement>('#password');
            const confirm = document.querySelector<HTMLInputElement>('#confirmPassword');
            return (
              !!password?.value && password.value === confirm?.value && password.checkValidity()
            );
          })
        )
        .toBe(true);
      await expect
        .poll(() =>
          site.evaluate(() => {
            const form = document.querySelector<HTMLInputElement>('#email')?.form;
            return !!form && form.checkValidity();
          })
        )
        .toBe(true);
      await site.locator('#isAnonymous').check();
      await expect(site.locator('#ageConfirmation')).toBeChecked();

      // Recheck immediately before the irreversible POST. No retry or CAPTCHA
      // bypass: one normal Create Account click, even if the test later fails.
      requireRunSignupAuthorization(process.env.RUNSIGNUP_LIVE);
      await stopForChallenge(site);
      // The site may show its drawer asynchronously, after form filling.
      const cookieDrawer = site.locator('#cookiePolicyPopup');
      if (await cookieDrawer.isVisible()) {
        await cookieDrawer.getByRole('button', { name: /accept/i }).click();
        await expect(cookieDrawer).not.toBeVisible();
      }
      requireRunSignupAuthorization(process.env.RUNSIGNUP_LIVE);
      if (submitted) throw new Error('This run has already attempted a signup.');
      submitted = true;
      console.log('RunSignup live: submitting one approved signup');
      await site.getByRole('button', { name: 'Create Account', exact: true }).click();
      await expect(site.getByText('Account successfully created.', { exact: true })).toBeVisible();
      accountCreated = true;
      expect(signupPosts).toBe(1);
      console.log('RunSignup live: signup confirmed; checking stale controls');

      await expect
        .poll(
          async () =>
            (await contentControls(cdp)).filter(
              (control) =>
                control.visible &&
                (control.cls.split(/\s+/).includes('fill-all-button') ||
                  control.title === 'This site' ||
                  control.title === 'Choose identity')
            ).length
        )
        .toBe(0);
      const screenshot = info.outputPath('account-created.png');
      await site.screenshot({ path: screenshot });
      await info.attach('Real signup success and cleared autofill controls', {
        path: screenshot,
        contentType: 'image/png',
      });

      // Poll real inbox through the production fetch/storage path. Capture only
      // sender/subject/classification, never body, tokens, passwords or IPs.
      let messages: MailSummary[] = [];
      await expect
        .poll(
          async () => {
            messages = await ui.evaluate(async (addressId) => {
              const reply = await chrome.runtime.sendMessage({ type: 'checkEmails', addressId });
              if (!reply?.success) throw new Error('Real provider mail refresh failed.');
              return (reply.messages || []).map(
                (mail: {
                  from: string;
                  subject: string;
                  otp?: string;
                  hasMagicLink?: boolean;
                }) => ({
                  from: mail.from,
                  subject: mail.subject,
                  hasOtp: !!mail.otp,
                  hasMagicLink: !!mail.hasMagicLink,
                })
              );
            }, inbox.id);
            return messages.some((mail) => /@runsignup\.com\b/i.test(mail.from));
          },
          { timeout: 90_000, intervals: [3000, 5000, 10_000] }
        )
        .toBe(true);
      await writeFile(
        info.outputPath('evidence.json'),
        JSON.stringify(
          {
            accountCreated: true,
            signupPosts,
            address: inbox.address,
            checkedAt: new Date().toISOString(),
            messages,
            siteAccessProvisionedInTestCopy: true,
          },
          null,
          2
        )
      );
    } finally {
      await context.close();
    }
  } finally {
    await writeFile(
      info.outputPath('submission-outcome.json'),
      JSON.stringify({ submitted, signupPosts, accountCreated })
    );
    // Both paths were created by mkdtemp for this test, outside all user profiles.
    await rm(scratch, { recursive: true, force: true });
  }
});

async function stopForChallenge(page: Page): Promise<void> {
  const challenge = page.locator(
    'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare"]'
  );
  for (const frame of await challenge.all()) {
    if (await frame.isVisible())
      throw new Error('Site challenge requires a human; no automated signup was submitted.');
  }
}
