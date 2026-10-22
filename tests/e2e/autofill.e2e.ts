/**
 * e2e/autofill.e2e.ts
 *
 * End-to-end tests for the extension's MAIN feature: content-script autofill.
 * These tests drive a real web page (the local demo signup form, auto-started
 * by playwright.config.ts's webServer) while the built extension is loaded,
 * with zero human interaction - the browser opens, runs the script, asserts,
 * and closes.
 *
 * Why CDP? The injected autofill controls live inside a CLOSED shadow root
 * (src/entrypoints/content/dom/shadow-dom.ts) and their click handlers reject
 * synthetic events (event.isTrusted guard in autofill-buttons.ts). Playwright
 * locators cannot pierce closed shadow roots, so these tests:
 *   1. enumerate injected <button>s via the CDP DOM domain (pierce: true)
 *   2. resolve each node and read text/title/visibility via Runtime
 *   3. click at the button's real viewport coordinates with page.mouse,
 *      which dispatches TRUSTED input that passes the isTrusted guard
 *
 * Run: bun run test:e2e -- autofill
 */

import type { Page } from '@playwright/test';
import type { CDPSession } from 'playwright-core';
import type { ProbeWindow } from './closed-shadow-probe';
import { expect, test } from './fixtures';

// ── CDP helpers for the closed shadow DOM ──────────────────────────────────

interface CdpNode {
  nodeId: number;
  nodeName: string;
  nodeValue?: string;
  attributes?: string[];
  children?: CdpNode[];
  shadowRoots?: CdpNode[];
  contentDocument?: CdpNode | null;
  templateContent?: CdpNode | null;
  pseudoElements?: CdpNode[];
  distributedNodes?: CdpNode[];
}

interface ButtonInfo {
  nodeId: number;
  text: string;
  title: string;
  cls: string;
  display: string;
  visible: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

function collectCdpNodes(node: CdpNode | null | undefined, out: CdpNode[]): CdpNode[] {
  if (!node) return out;
  out.push(node);
  for (const child of node.children ?? []) collectCdpNodes(child, out);
  for (const root of node.shadowRoots ?? []) collectCdpNodes(root, out);
  if (node.contentDocument) collectCdpNodes(node.contentDocument, out);
  if (node.templateContent) collectCdpNodes(node.templateContent, out);
  for (const pseudo of node.pseudoElements ?? []) collectCdpNodes(pseudo, out);
  for (const distributed of node.distributedNodes ?? []) collectCdpNodes(distributed, out);
  return out;
}

/** Enumerate every <button> in the page, including those inside the closed shadow root. */
async function listInjectedButtons(cdp: CDPSession | Page): Promise<ButtonInfo[]> {
  if (!('send' in cdp))
    return cdp.evaluate(() => (globalThis as unknown as ProbeWindow).__e2eClosedShadow.buttons());
  await cdp.send('DOM.enable');
  const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as {
    root: CdpNode;
  };
  const buttonNodes = collectCdpNodes(root, []).filter((n) => n.nodeName === 'BUTTON');
  const buttons: ButtonInfo[] = [];
  for (const node of buttonNodes) {
    try {
      const { object } = (await cdp.send('DOM.resolveNode', { nodeId: node.nodeId })) as {
        object: { objectId: string };
      };
      const { result } = (await cdp.send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: `function () {
          const el = this;
          const rect = el.getBoundingClientRect();
          return {
            text: (el.textContent || '').trim(),
            title: el.getAttribute('title') || '',
            cls: typeof el.className === 'string' ? el.className : '',
            display: getComputedStyle(el).display,
            visible: rect.width > 0 && rect.height > 0,
            x: rect.x,
            y: rect.y,
            w: rect.width,
            h: rect.height,
          };
        }`,
        returnByValue: true,
      })) as { result: { value: Omit<ButtonInfo, 'nodeId'> } };
      buttons.push({ nodeId: node.nodeId, ...result.value });
    } catch {
      // node detached between document snapshot and resolution - skip
    }
  }
  return buttons;
}

function findButton(
  buttons: ButtonInfo[],
  pred: (b: ButtonInfo) => boolean,
  label: string
): ButtonInfo {
  const found = buttons.find(pred);
  if (!found) throw new Error(`Injected button not found: ${label}`);
  return found;
}

/** Wait until a matching injected button exists, then return its info. */
async function waitForButton(
  cdp: CDPSession | Page,
  pred: (b: ButtonInfo) => boolean,
  label: string
): Promise<ButtonInfo> {
  let latest: ButtonInfo[] = [];
  await expect
    .poll(async () => {
      latest = await listInjectedButtons(cdp);
      return latest.some(pred);
    })
    .toBe(true);
  return findButton(latest, pred, label);
}

/** Scroll the button into view and click its center with a TRUSTED mouse event. */
async function clickInjectedButton(
  page: Page,
  cdp: CDPSession | Page,
  button: ButtonInfo
): Promise<void> {
  if (!('send' in cdp)) {
    const { x, y, w, h } = await cdp.evaluate(
      (id) => (globalThis as unknown as ProbeWindow).__e2eClosedShadow.scrollButton(id),
      button.nodeId
    );
    await page.mouse.click(x + w / 2, y + h / 2);
    return;
  }
  // Resolve and measure again if a scan detached the snapshot's node. Retry
  // only before dispatching input, so a successful click is never repeated.
  let point = { x: 0, y: 0, w: 0, h: 0 };
  await expect
    .poll(async () => {
      const current = (await listInjectedButtons(cdp)).find(
        (candidate) =>
          candidate.visible && candidate.title === button.title && candidate.text === button.text
      );
      if (!current) return false;
      try {
        const { object } = (await cdp.send('DOM.resolveNode', { nodeId: current.nodeId })) as {
          object: { objectId: string };
        };
        try {
          const { result } = (await cdp.send('Runtime.callFunctionOn', {
            objectId: object.objectId,
            functionDeclaration: `function () {
              if (!this.isConnected) return null;
              this.scrollIntoView({ block: 'center', inline: 'center' });
              const r = this.getBoundingClientRect();
              return { x: r.x, y: r.y, w: r.width, h: r.height };
            }`,
            returnByValue: true,
          })) as { result: { value: typeof point | null } };
          if (!result.value || result.value.w <= 0 || result.value.h <= 0) return false;
          point = result.value;
          return true;
        } finally {
          await cdp.send('Runtime.releaseObject', { objectId: object.objectId });
        }
      } catch (error) {
        if (error instanceof Error && /No node with given id found/.test(error.message))
          return false;
        throw error;
      }
    })
    .toBe(true);
  const { x, y, w, h } = point;
  await page.mouse.click(x + w / 2, y + h / 2);
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('Content-script autofill on a real web page', () => {
  test('signup tracking scopes submission, resumes waiting pages and confirms the exact account', async ({
    demoSignupPage,
    extensionPage,
    context,
  }, testInfo) => {
    const { page, cdp } = demoSignupPage;
    const signupUrl = page.url();
    const signupDomain = new URL(signupUrl).hostname;
    const pendingUrl = new URL('/__e2e__/verify-email?next=/dashboard', signupUrl).href;
    const confirmationUrl =
      'https://confirmation.example.test/__e2e__/email-confirmed?token=offline-test';
    expect(
      await extensionPage.evaluate(() =>
        chrome.permissions.contains({ origins: ['https://confirmation.example.test/*'] })
      )
    ).toBe(false);
    await page.route(pendingUrl, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><title>Welcome</title></head><body><h1>Your account has been created.</h1><p>Check your email and click the confirmation link.</p></body></html>',
      })
    );
    await page.route(signupUrl, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body style="margin:100px;font:16px sans-serif"><h1>Create account</h1><p hidden>Registration complete</p><form id="signup"><label>Email<input id="email" type="email" required></label><label>Password<input id="pw" type="password" autocomplete="new-password" required></label><button type="submit">Create account</button></form><button id="unrelated" type="button">Continue shopping</button><script>document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();if(e.isTrusted)location.href='/__e2e__/verify-email?next=/dashboard';});</script></body></html>`,
      })
    );
    await page.reload();
    await clickInjectedButton(
      page,
      cdp,
      await waitForButton(cdp, (b) => b.title === 'Autofill all fields', 'Autofill All')
    );
    await clickInjectedButton(
      page,
      cdp,
      await waitForButton(cdp, (b) => b.text === 'Fill form' && b.visible, 'Fill form')
    );
    const account = () =>
      extensionPage.evaluate(async () => {
        const { loginInfo } = await chrome.storage.local.get('loginInfo');
        const rows = (Array.isArray(loginInfo) ? loginInfo : []) as Array<{
          id: string;
          email: string;
          signupAttemptId?: string;
          signupStatus?: string;
          emailVerificationStatus?: string;
          verificationNotifiedAt?: number;
        }>;
        const row = rows.find((r) => !!r.signupAttemptId);
        return row
          ? {
              id: row.id,
              email: row.email,
              attemptId: row.signupAttemptId,
              status: row.signupStatus,
              emailStatus: row.emailVerificationStatus,
              notifiedAt: row.verificationNotifiedAt,
            }
          : null;
      });
    await expect.poll(async () => (await account())?.attemptId).toBeTruthy();
    const original = await account();
    if (!original) throw new Error('Missing signup attempt');
    await page.getByRole('button', { name: 'Continue shopping' }).click();
    await page.evaluate(() =>
      document.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true }))
    );
    await expect.poll(async () => (await account())?.status).toBe('pending_submit');
    await page.reload();
    await expect(page.locator('#email')).toBeVisible();
    await waitForButton(
      cdp,
      (b) => b.visible && b.cls.includes('fill-all-button'),
      'resumed signup toolbar'
    );
    await page.locator('#email').fill(original.email);
    await page.locator('#pw').fill('Offline-regression-Password1!');
    await page.evaluate(() => {
      document
        .querySelector<HTMLInputElement>('#email')
        ?.setCustomValidity('invalid for this test');
    });
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    expect((await account())?.status).toBe('pending_submit');
    await page.evaluate(() => {
      document.querySelector<HTMLInputElement>('#email')?.setCustomValidity('');
    });
    await extensionPage.evaluate(async (domain) => {
      const { loginInfo } = await chrome.storage.local.get('loginInfo');
      await chrome.storage.local.set({
        loginInfo: [
          {
            id: 'other-same-site',
            domain,
            email: 'other@example.com',
            timestamp: Date.now() + 1,
            signupStatus: 'pending_submit',
            verified: false,
          },
          ...loginInfo,
        ],
      });
    }, signupDomain);
    // The trusted submit, rather than a click or a URL label, advances A.
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect.poll(async () => (await account())?.emailStatus).toBe('pending');
    await expect(page).toHaveURL(pendingUrl);
    expect((await account())?.status).toBe('verified');
    await page.route(pendingUrl, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><title>Welcome</title></head><body><p>Check your email and click the confirmation link.</p></body></html>',
      })
    );
    await page.goto(pendingUrl);
    await expect(page.getByText('Check your email and click the confirmation link.')).toBeVisible();
    expect((await account())?.emailStatus).toBe('pending');
    await context.route(confirmationUrl, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><p>Your email address has been confirmed.</p></body></html>',
      })
    );
    await extensionPage.evaluate(
      async ({ email, url, domain }) => {
        await chrome.storage.local.set({
          'storedEmailsByAddress_demo-inbox-1': [
            {
              id: 'confirmation-mail',
              from: `mail@${domain}`,
              received_at: Date.now(),
              body_plain: 'Confirm your email',
              original_inbox: email,
              magicLinks: [{ url, host: new URL(url).hostname }],
            },
          ],
        });
      },
      { email: original.email, url: confirmationUrl, domain: signupDomain }
    );
    const nextPage = context.waitForEvent('page');
    const response = await extensionPage.evaluate(
      async (url) =>
        chrome.runtime.sendMessage({
          type: 'openSignupVerificationLink',
          url,
          addressId: 'demo-inbox-1',
        }),
      confirmationUrl
    );
    expect(response.success).toBe(true);
    const confirmation = await nextPage;
    await expect(confirmation.getByText('Your email address has been confirmed.')).toBeVisible();
    await expect.poll(async () => (await account())?.emailStatus).toBe('confirmed');
    expect((await account())?.notifiedAt).toBeTruthy();
    const other = await extensionPage.evaluate(async () => {
      const { loginInfo } = await chrome.storage.local.get('loginInfo');
      const record = loginInfo.find((r: { id: string }) => r.id === 'other-same-site');
      return { verified: record.verified, status: record.signupStatus };
    });
    expect(other).toEqual({ verified: false, status: 'pending_submit' });
    const evidencePath = testInfo.outputPath('email-confirmed.png');
    await confirmation.screenshot({ path: evidencePath });
    await testInfo.attach('offline email confirmation without an extra host permission', {
      path: evidencePath,
      contentType: 'image/png',
    });
    await confirmation.close();
  });

  test('open-shadow signup fields do not wait for the idle-frame probe', async ({
    demoSignupPage,
  }, testInfo) => {
    const { page, cdp } = demoSignupPage;
    await page.route(page.url(), (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><div id="auth"></div><script>document.getElementById("auth").attachShadow({mode:"open"}).innerHTML=\'<form><h1>Create account</h1><label>Email<input type="email" autocomplete="email"></label><label>Password<input type="password" autocomplete="new-password"></label></form>\';</script></body></html>',
      })
    );
    const started = performance.now();
    await page.reload();
    await expect
      .poll(
        async () =>
          (await listInjectedButtons(cdp)).filter(
            (button) => button.visible && button.title === 'Auto-fill this field'
          ).length,
        { intervals: [25, 50, 100], timeout: 6500 }
      )
      .toBeGreaterThanOrEqual(2);
    await testInfo.attach('open shadow detection latency', {
      body: JSON.stringify({ detectionMs: Math.round(performance.now() - started) }),
      contentType: 'application/json',
    });
    expect(Math.round(performance.now() - started)).toBeLessThan(1500);
  });

  test('saved-login action fills the login fields without submitting the form', async ({
    demoSignupPage,
    extensionPage,
  }, testInfo) => {
    const { page, cdp } = demoSignupPage;
    const domain = new URL(page.url()).hostname;
    await extensionPage.evaluate(async (domain) => {
      await chrome.storage.local.set({
        loginInfo: [
          {
            domain,
            addressId: 'demo-inbox-1',
            email: 'saved.user@example.com',
            password: 'Test-only-password-37!',
            timestamp: Date.now(),
          },
        ],
        smartAutofillSettings: {
          dryRunPreview: false,
          humanLikeFilling: false,
          humanLikeTiming: false,
          autoClickSubmitButtons: false,
        },
      });
    }, domain);
    await page.route(page.url(), (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body style="margin:80px;font:16px system-ui"><h1>Sign in</h1><form><label>Email<input type="email" autocomplete="email" id="email"></label><label>Password<input type="password" autocomplete="current-password" id="password"></label><button type="submit">Sign in</button></form><script>document.querySelector("form").addEventListener("submit",e=>{e.preventDefault();document.body.dataset.submitted="yes";});</script></body></html>',
      })
    );
    await page.reload();
    const button = await waitForButton(
      cdp,
      (button) =>
        button.visible &&
        button.cls.includes('fill-all-button') &&
        button.text === 'Re-use identity',
      'saved login'
    );
    const started = performance.now();
    await clickInjectedButton(page, cdp, button);
    await expect(page.locator('#email')).toHaveValue('saved.user@example.com');
    await expect(page.locator('#password')).toHaveValue('Test-only-password-37!');
    await expect(page.locator('body')).not.toHaveAttribute('data-submitted', 'yes');
    await testInfo.attach('saved login fill latency', {
      body: JSON.stringify({ fillMs: Math.round(performance.now() - started) }),
      contentType: 'application/json',
    });
  });

  for (const transition of ['insert fields', 'reveal fields'] as const) {
    test(`login detection responds promptly when pages ${transition}`, async ({
      demoSignupPage,
      extensionPage,
    }, testInfo) => {
      const { page, cdp } = demoSignupPage;
      await page.route(page.url(), (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html><head><style>
          body{font:16px system-ui;margin:80px}input{display:block;width:260px;height:40px;margin:12px 0}
          </style></head><body><h1>Sign in</h1><form id="login"></form></body></html>`,
        })
      );
      await page.reload();
      const siteUrl = page.url();
      await expect
        .poll(() =>
          extensionPage.evaluate(async (url) => {
            const tab = (await chrome.tabs.query({})).find(
              (tab: { id?: number; url?: string }) => tab.url === url
            );
            if (tab?.id == null) return false;
            try {
              return (await chrome.tabs.sendMessage(tab.id, { type: 'ping' }))?.ok === true;
            } catch {
              return false;
            }
          }, siteUrl)
        )
        .toBe(true);
      // Deliberately arrive after the 1s startup retry and its 500ms idle
      // budget, otherwise that retry can hide a missed mutation notification.
      await expect.poll(() => page.evaluate(() => performance.now())).toBeGreaterThan(1800);
      if (transition === 'reveal fields') {
        await page.evaluate(() => {
          const form = document.querySelector('form');
          if (!form) throw new Error('Missing login fixture');
          form.hidden = true;
          form.innerHTML =
            '<input type="email" autocomplete="email"><input type="password" autocomplete="current-password">';
        });
        // Await the hidden form's scan through the production message handler.
        await extensionPage.evaluate(async (url) => {
          const tab = (await chrome.tabs.query({})).find(
            (tab: { id?: number; url?: string }) => tab.url === url
          );
          if (tab?.id != null) await chrome.tabs.sendMessage(tab.id, { type: 'checkFormDetected' });
        }, siteUrl);
        await expect.poll(() => page.evaluate(() => performance.now())).toBeGreaterThan(2200);
      }
      await page.bringToFront();
      await expect(extensionPage.locator('#button-autofill')).toHaveCount(0);
      const started = performance.now();
      await page.evaluate((transition) => {
        const form = document.querySelector('form');
        if (!form) throw new Error('Missing login fixture');
        if (transition === 'reveal fields') {
          form.hidden = false;
        } else {
          const email = document.createElement('input');
          email.type = 'email';
          email.autocomplete = 'email';
          const password = document.createElement('input');
          password.type = 'password';
          password.autocomplete = 'current-password';
          form.append(email, password);
        }
      }, transition);
      await expect
        .poll(
          async () =>
            (await listInjectedButtons(cdp)).filter(
              (button) => button.visible && button.title === 'Auto-fill this field'
            ).length,
          { intervals: [25, 50, 100], timeout: 6500 }
        )
        .toBeGreaterThanOrEqual(2);
      const detectionMs = Math.round(performance.now() - started);
      await testInfo.attach('login detection latency', {
        body: JSON.stringify({ transition, detectionMs }),
        contentType: 'application/json',
      });
      expect(detectionMs).toBeLessThan(1500);
      // The dock initially shows Verification. Autofill actions mount only
      // when its tab is chosen; detecting a form must make that tab available.
      const autofillTab = extensionPage.getByRole('tab', { name: 'Autofill', exact: true });
      await expect(autofillTab).toBeVisible({ timeout: 1500 });
      await autofillTab.click();
      await expect(extensionPage.locator('#button-autofill')).toBeVisible({ timeout: 1500 });
    });
  }

  test('progressive email review keeps Continue clickable as the form changes', async ({
    demoSignupPage,
  }, testInfo) => {
    const { page, cdp } = demoSignupPage;
    // Offline fixture for the real combined email/phone step observed on Canva.
    await page.route(page.url(), (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><style>
      body{margin:0;font:16px system-ui}main{box-sizing:border-box;width:368px;margin:194px auto;padding:32px}
      h2{margin:0 0 20px}label{display:block;margin-bottom:8px}input,button[type=submit]{box-sizing:border-box;width:304px;height:40px}
      button[type=submit]{margin-top:16px}#error{margin:8px 0}
      </style></head><body><main><h2>Continue with phone number or email</h2><form>
      <label id="entry-label" for="entry">Phone number or email</label><input id="entry" name="username" autocomplete="username webauthn" aria-labelledby="entry-label" placeholder="Phone number or email">
      <input name="fullname" type="hidden"><input name="phone" disabled hidden><input type="password" hidden>
      <button type="submit">Continue</button></form></main><script>document.querySelector('form').addEventListener('submit',event=>event.preventDefault());</script></body></html>`,
      })
    );
    await page.reload();
    const fill = await waitForButton(
      cdp,
      (button) => button.visible && button.cls.includes('fill-all-button'),
      'progressive fill'
    );
    await clickInjectedButton(page, cdp, fill);
    await waitForButton(
      cdp,
      (button) => button.visible && button.text === 'Fill form',
      'email review'
    );
    // Exactly one correctable row: the only editable field is email.
    const reviewButtons = await listInjectedButtons(cdp);
    expect(
      reviewButtons.filter((button) => button.visible && button.text === 'Correct field')
    ).toHaveLength(1);
    await clickInjectedButton(
      page,
      cdp,
      findButton(
        reviewButtons,
        (button) => button.visible && button.text === 'Fill form',
        'email review'
      )
    );
    await expect(page.locator('#entry')).toHaveValue('demo.user@example.com');
    await waitForButton(
      cdp,
      (button) => button.visible && button.text === 'Reset',
      'post-fill toolbar'
    );
    const assertNoOverlap = async () => {
      await page.getByRole('button', { name: 'Continue', exact: true }).click({ trial: true });
      const submit = await page
        .getByRole('button', { name: 'Continue', exact: true })
        .boundingBox();
      if (!submit) throw new Error('Missing fixture Continue button');
      const controls = (await listInjectedButtons(cdp)).filter(
        (button) => button.visible && button.cls.includes('fill-all-button')
      );
      expect(controls).toHaveLength(1);
      for (const control of controls)
        expect(
          control.x < submit.x + submit.width &&
            control.x + control.w > submit.x &&
            control.y < submit.y + submit.height &&
            control.y + control.h > submit.y
        ).toBe(false);
    };
    await assertNoOverlap();
    // Real validation insertions change geometry without scrolling/resizing.
    await page.evaluate(() => {
      const error = document.createElement('p');
      error.id = 'error';
      error.textContent = 'Review your email address';
      document
        .querySelector('form')
        ?.insertBefore(error, document.querySelector('button[type=submit]'));
    });
    await expect
      .poll(async () => {
        const button = await page
          .getByRole('button', { name: 'Continue', exact: true })
          .boundingBox();
        const controls = await listInjectedButtons(cdp);
        const fill = controls.find(
          (control) => control.visible && control.cls.includes('fill-all-button')
        );
        return !!button && !!fill && fill.y >= button.y + button.height;
      })
      .toBe(true);
    await assertNoOverlap();
    const screenshot = testInfo.outputPath('progressive-email-toolbar.png');
    await page.screenshot({ path: screenshot });
    await testInfo.attach('offline progressive email layout', {
      path: screenshot,
      contentType: 'image/png',
    });
  });

  test('username recovery preserves other fields and the final saved login', async ({
    demoSignupPage,
    extensionPage,
  }, testInfo) => {
    const { page, cdp } = demoSignupPage;
    await page.evaluate(() => {
      const group = document.createElement('div');
      group.innerHTML =
        '<label for="username">Username</label><input id="username" name="username" autocomplete="username" aria-describedby="username-error"><span id="username-error" role="alert"></span>';
      const form = document.querySelector('#shop');
      if (!form) throw new Error('Missing fixture form');
      form.prepend(group);
    });
    // Wait for the added username field's own control. The old toolbar can
    // still be visible while the queued form-change scan replaces it.
    await expect
      .poll(async () => {
        const field = await page.locator('#username').boundingBox();
        if (!field) return false;
        return (await listInjectedButtons(cdp)).some(
          (button) =>
            button.visible &&
            button.title === 'Auto-fill this field' &&
            button.x >= field.x &&
            button.x < field.x + field.width &&
            button.y >= field.y &&
            button.y < field.y + field.height
        );
      })
      .toBe(true);
    const all = await waitForButton(
      cdp,
      (button) => button.title === 'Autofill all fields',
      'Autofill All'
    );
    await clickInjectedButton(page, cdp, all);
    const confirm = await waitForButton(
      cdp,
      (button) => button.text === 'Fill form' && button.visible,
      'Fill form'
    );
    await clickInjectedButton(page, cdp, confirm);
    await expect(page.locator('#username')).toHaveValue(/\S/);
    await expect(page.locator('#pw')).toHaveValue(/\S/);
    const firstUsername = await page.locator('#username').inputValue();
    const signupDomain = new URL(page.url()).hostname;
    const savedLogin = () =>
      extensionPage.evaluate(async (domain) => {
        const result = await chrome.storage.local.get('loginInfo');
        const records = (Array.isArray(result.loginInfo) ? result.loginInfo : []) as Array<{
          id?: string;
          domain: string;
          username?: string;
          password?: string;
          verified?: boolean;
        }>;
        return records.find((record) => record.domain === domain);
      }, signupDomain);
    await expect.poll(async () => (await savedLogin())?.username).toBe(firstUsername);
    const initialLogin = await savedLogin();
    expect(initialLogin?.id).toBeTruthy();
    expect(initialLogin?.verified).toBe(false);
    const email = await page.locator('#email').inputValue();
    const password = await page.locator('#pw').inputValue();
    const firstName = await page.locator('#fn').inputValue();

    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('#username');
      const error = document.querySelector('#username-error');
      if (!input || !error) throw new Error('Missing username fixture');
      input.minLength = 6;
      input.maxLength = 16;
      input.pattern = '[a-z0-9]{6,16}';
      input.setAttribute('aria-invalid', 'true');
      error.textContent = 'Username already taken';
    });
    await waitForButton(
      cdp,
      (button) => button.text === 'Generate another' && button.visible,
      'Generate another'
    );
    // Simulate a server-rendered rejection: the whole document reloads with
    // the submitted fields intact. Serve it locally through the existing route.
    const rejectedPage = await page.evaluate(() => {
      const form = document.querySelector('#shop');
      if (!form) throw new Error('Missing fixture form');
      for (const input of form.querySelectorAll('input')) input.setAttribute('value', input.value);
      for (const option of form.querySelectorAll('option')) {
        option.toggleAttribute('selected', option.selected);
      }
      return `<!doctype html><html><head><meta charset="utf-8">${document.querySelector('style')?.outerHTML || ''}</head><body>${form.outerHTML}<script>document.getElementById('shop').addEventListener('submit', event => event.preventDefault());</script></body></html>`;
    });
    await page.route(page.url(), (route) =>
      route.fulfill({ contentType: 'text/html', body: rejectedPage })
    );
    await page.reload();
    const generate = await waitForButton(
      cdp,
      (button) => button.text === 'Generate another' && button.visible,
      'Generate another after reload'
    );
    // No automatic replacement: the rejected value survives until the user's click.
    await expect(page.locator('#username')).toHaveValue(firstUsername);
    const screenshot = testInfo.outputPath('username-taken.png');
    await page.screenshot({ path: screenshot });
    await testInfo.attach('username recovery prompt', {
      path: screenshot,
      contentType: 'image/png',
    });
    await clickInjectedButton(page, cdp, generate);
    await expect(page.locator('#username')).not.toHaveValue(firstUsername);
    const replacement = await page.locator('#username').inputValue();
    expect(replacement).toMatch(/^[a-z0-9]{6,16}$/);
    await expect.poll(async () => (await savedLogin())?.username).toBe(replacement);
    expect((await savedLogin())?.id).toBe(initialLogin?.id);
    expect((await savedLogin())?.password).toBe(initialLogin?.password);
    await expect(page.locator('#email')).toHaveValue(email);
    await expect(page.locator('#pw')).toHaveValue(password);
    await expect(page.locator('#pw2')).toHaveValue(password);
    await expect(page.locator('#fn')).toHaveValue(firstName);

    // A rerender replaces the input, then a format error offers only editing.
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('#username');
      const error = document.querySelector('#username-error');
      if (!input || !error) throw new Error('Missing username fixture');
      input.replaceWith(input.cloneNode(true));
      error.textContent = 'Invalid username: use lowercase letters and digits';
    });
    await waitForButton(
      cdp,
      (button) => button.text === 'Edit username' && button.visible,
      'Edit username'
    );
    const editButtons = await listInjectedButtons(cdp);
    expect(editButtons.some((button) => button.text === 'Generate another' && button.visible)).toBe(
      false
    );
    const edit = findButton(
      editButtons,
      (button) => button.text === 'Edit username' && button.visible,
      'Edit username'
    );
    await clickInjectedButton(page, cdp, edit);
    await expect(page.locator('#username')).toBeFocused();
    await page.locator('#username').fill('mynewuser123');
    await page.locator('#email').focus();
    await expect.poll(async () => (await savedLogin())?.username).toBe('mynewuser123');
    expect((await savedLogin())?.verified).toBe(false);
    await expect(page.locator('#email')).toHaveValue(email);
    await expect(page.locator('#pw')).toHaveValue(password);
    // The fixture performs no network signup. A real user click followed by
    // the site's success status exercises the existing outcome detector.
    page.once('dialog', (dialog) => {
      void dialog.dismiss();
    });
    await page.getByRole('button', { name: 'Create free account', exact: true }).click();
    await page.evaluate(() => {
      const error = document.querySelector('#username-error');
      if (!error) throw new Error('Missing fixture error');
      error.textContent = '';
      const status = document.createElement('p');
      status.setAttribute('role', 'status');
      status.textContent = 'Account created successfully';
      document.body.appendChild(status);
    });
    await expect.poll(async () => (await savedLogin())?.verified).toBe(true);
    expect((await savedLogin())?.username).toBe('mynewuser123');
    expect((await savedLogin())?.id).toBe(initialLogin?.id);
  });

  test('injects autofill controls into the signup page', async ({ demoSignupPage }) => {
    const { cdp } = demoSignupPage;

    // Host identifiers are randomized to avoid exposing an extension marker to
    // every page. Assert the user-facing control through the closed-root CDP
    // helper instead of depending on a stable host attribute.
    const fillAll = await waitForButton(
      cdp,
      (b) => b.title === 'Autofill all fields',
      'Autofill All'
    );
    expect(fillAll.text).toBe('Autofill All');
    expect(fillAll.visible).toBe(true);

    // In-field icon buttons on the form fields
    await expect
      .poll(
        async () =>
          (await listInjectedButtons(cdp)).filter((b) => b.title === 'Auto-fill this field').length
      )
      .toBeGreaterThanOrEqual(2);
  });

  test('Autofill All fills every field and reveals the Wait-for-OTP chip', async ({
    demoSignupPage,
  }) => {
    const { page, cdp } = demoSignupPage;

    const fillAll = await waitForButton(
      cdp,
      (b) => b.title === 'Autofill all fields',
      'Autofill All'
    );
    await clickInjectedButton(page, cdp, fillAll);

    // Autofill All previews detected fields before writing to the page.
    // Confirm through the injected closed shadow root with a trusted click.
    const confirmFill = await waitForButton(
      cdp,
      (button) => button.text === 'Fill form' && button.visible,
      'autofill preview confirmation'
    );
    await clickInjectedButton(page, cdp, confirmFill);

    // Email gets the seeded demo address (deterministic in demo mode)
    await expect(page.locator('#email')).toHaveValue('demo.user@example.com', {
      timeout: 15_000,
    });

    // Both password fields receive the same generated value
    const password = page.locator('#pw');
    await expect(password).toHaveValue(/\S/, { timeout: 15_000 });
    const passwordValue = await password.inputValue();
    expect(passwordValue.length).toBeGreaterThanOrEqual(8);
    await expect(page.locator('#pw2')).toHaveValue(passwordValue);

    // Names, phone and country are populated
    await expect(page.locator('#fn')).toHaveValue(/\S/);
    await expect(page.locator('#ln')).toHaveValue(/\S/);
    await expect(page.locator('#phone')).toHaveValue(/\S/);
    await expect(page.locator('#country')).not.toHaveValue('');

    // Wait-for-OTP chip is revealed once the form holds a live extension inbox
    const otpChip = await waitForButton(
      cdp,
      (b) => b.title === 'Wait for OTP' && b.display === 'flex',
      'Wait for OTP chip'
    );
    expect(otpChip.text).toBe('OTP');

    // Reset (undo) control is revealed next to it
    const reset = await waitForButton(
      cdp,
      (b) => b.text === 'Reset' && b.display === 'flex',
      'Reset button'
    );
    expect(reset.title).toBe('Undo Autofill All and restore previous form values');
  });

  test('preview Cancel closes the dialog without filling the signup form', async ({
    demoSignupPage,
  }) => {
    const { page, cdp } = demoSignupPage;
    const fillAll = await waitForButton(
      cdp,
      (button) => button.title === 'Autofill all fields',
      'Autofill All'
    );
    await clickInjectedButton(page, cdp, fillAll);
    const cancel = await waitForButton(
      cdp,
      (button) => button.text === 'Cancel' && button.visible,
      'preview Cancel'
    );
    await clickInjectedButton(page, cdp, cancel);
    await expect
      .poll(async () =>
        (await listInjectedButtons(cdp)).some((button) => button.text === 'Fill form')
      )
      .toBe(false);
    await expect(page.locator('#email')).toHaveValue('');
    await expect(page.locator('#pw')).toHaveValue('');
  });

  test('preview Cancel remains clickable during field correction', async ({ demoSignupPage }) => {
    const { page, cdp } = demoSignupPage;
    const fillAll = await waitForButton(
      cdp,
      (button) => button.title === 'Autofill all fields',
      'Autofill All'
    );
    await clickInjectedButton(page, cdp, fillAll);
    const correct = await waitForButton(
      cdp,
      (button) => button.text === 'Correct field' && button.visible,
      'preview field correction'
    );
    await clickInjectedButton(page, cdp, correct);
    await expect(page.locator('#email')).toHaveCSS('outline-width', '2px');
    const cancel = await waitForButton(
      cdp,
      (button) => button.text === 'Cancel' && button.visible,
      'preview Cancel during field correction'
    );
    await clickInjectedButton(page, cdp, cancel);
    await expect
      .poll(async () =>
        (await listInjectedButtons(cdp)).some((button) => button.text === 'Fill form')
      )
      .toBe(false);
    expect(await page.locator('#email').evaluate((element) => element.style.outline)).toBe('');
    await expect(page.locator('#email')).toHaveValue('');
    await expect(page.locator('#pw')).toHaveValue('');
  });

  test('preview Choose identity opens the picker without filling the signup form', async ({
    demoSignupPage,
  }) => {
    const { page, cdp } = demoSignupPage;
    const fillAll = await waitForButton(
      cdp,
      (button) => button.title === 'Autofill all fields',
      'Autofill All'
    );
    await clickInjectedButton(page, cdp, fillAll);
    const chooseIdentity = await waitForButton(
      cdp,
      (button) => button.text === 'Choose identity' && button.visible,
      'preview Choose identity'
    );
    await clickInjectedButton(page, cdp, chooseIdentity);
    await waitForButton(
      cdp,
      (button) => button.text === 'Create new identity' && button.visible,
      'identity picker'
    );
    expect((await listInjectedButtons(cdp)).some((button) => button.text === 'Fill form')).toBe(
      false
    );
    await expect(page.locator('#email')).toHaveValue('');
    await expect(page.locator('#pw')).toHaveValue('');
  });

  test('in-field menu lets you pick the active address and fills it', async ({
    demoSignupPage,
  }) => {
    const { page, cdp } = demoSignupPage;

    // First in-field icon in DOM order belongs to the email field
    const emailIcon = await waitForButton(
      cdp,
      (b) => b.title === 'Auto-fill this field',
      'email field icon'
    );
    await clickInjectedButton(page, cdp, emailIcon);

    // The menu opens with the active address as a clickable item
    const activeItem = await waitForButton(
      cdp,
      (b) => b.text === 'demo.user@example.com' && b.visible,
      'active address menu item'
    );
    await clickInjectedButton(page, cdp, activeItem);

    await expect(page.locator('#email')).toHaveValue('demo.user@example.com', {
      timeout: 15_000,
    });
  });

  test('Generate New Email from the menu creates and fills a fresh address', async ({
    demoSignupPage,
  }) => {
    const { page, cdp } = demoSignupPage;

    const emailIcon = await waitForButton(
      cdp,
      (b) => b.title === 'Auto-fill this field',
      'email field icon'
    );
    await clickInjectedButton(page, cdp, emailIcon);

    const generateItem = await waitForButton(
      cdp,
      (b) => b.text === 'Generate New Email' && b.visible,
      'Generate New Email menu item'
    );
    await clickInjectedButton(page, cdp, generateItem);

    // A brand-new demo address lands in the email field
    const email = page.locator('#email');
    await expect(email).toHaveValue(/@/, { timeout: 15_000 });
    const freshAddress = await email.inputValue();
    expect(freshAddress).not.toBe('demo.user@example.com');
    expect(freshAddress).toMatch(/@example\.com$/);
  });
});
