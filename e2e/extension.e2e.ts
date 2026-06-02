import { expect, test } from '@playwright/test';

// ── Page Structure Tests ────────────────────────────────────────────────────

test.describe('Extension Popup Page', () => {
  test('popup loads with correct HTML structure', async ({ page }) => {
    await page.goto('http://localhost:3000/popup.html');
    const appDiv = page.locator('#app');
    await expect(appDiv).toBeAttached();
    await expect(page).toHaveTitle('1Click: Temp Mail & Autofill Form');
  });

  test('popup has charset and viewport meta tags', async ({ page }) => {
    await page.goto('http://localhost:3000/popup.html');
    await expect(page.locator('meta[charset="UTF-8"]')).toBeAttached();
    await expect(page.locator('meta[name="viewport"]')).toBeAttached();
  });

  test('popup loads module script for Svelte', async ({ page }) => {
    await page.goto('http://localhost:3000/popup.html');
    const script = page.locator('script[type="module"]');
    await expect(script).toBeAttached();
  });
});

test.describe('Extension Sidepanel Page', () => {
  test('sidepanel loads with correct structure', async ({ page }) => {
    await page.goto('http://localhost:3000/sidepanel.html');
    await expect(page.locator('#app')).toBeAttached();
    await expect(page).toHaveTitle('1Click: Temp Mail & Autofill Form');
  });
});

test.describe('Extension App Page', () => {
  test('app loads with correct structure', async ({ page }) => {
    await page.goto('http://localhost:3000/app.html');
    await expect(page.locator('#app')).toBeAttached();
    await expect(page).toHaveTitle('1Click: Temp Mail & Autofill Form');
  });
});

// ── Svelte Mount Tests ──────────────────────────────────────────────────────

test.describe('Svelte Application Mount', () => {
  test('popup renders Svelte content inside #app', async ({ page }) => {
    await page.goto('http://localhost:3000/popup.html');
    await page.waitForTimeout(3000);
    const appContent = page.locator('#app');
    const innerHTML = await appContent.innerHTML();
    expect(innerHTML.length).toBeGreaterThan(0);
  });

  test('app renders Svelte content inside #app', async ({ page }) => {
    await page.goto('http://localhost:3000/app.html');
    await page.waitForTimeout(3000);
    const appContent = page.locator('#app');
    const innerHTML = await appContent.innerHTML();
    expect(innerHTML.length).toBeGreaterThan(0);
  });

  test('no JavaScript errors on page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('http://localhost:3000/popup.html');
    await page.waitForTimeout(3000);
    // Filter out expected extension API errors (chrome.storage, etc.)
    const criticalErrors = errors.filter(
      (e) => !e.includes('chrome') && !e.includes('browser') && !e.includes('storage')
    );
    expect(criticalErrors).toEqual([]);
  });
});

// ── CSS and Styling Tests ───────────────────────────────────────────────────

test.describe('CSS and Styling', () => {
  test('page has no horizontal overflow at popup width', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 600 });
    await page.goto('http://localhost:3000/popup.html');
    await page.waitForTimeout(2000);
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasOverflow).toBe(false);
  });

  test('body has minimum width at popup size', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 600 });
    await page.goto('http://localhost:3000/popup.html');
    await page.waitForTimeout(1000);
    const body = page.locator('body');
    const box = await body.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(400);
    expect(box!.width).toBeGreaterThan(0);
  });
});

// ── Responsive Design Tests ─────────────────────────────────────────────────

test.describe('Responsive Design', () => {
  test('renders at popup width (400px)', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 600 });
    await page.goto('http://localhost:3000/popup.html');
    await page.waitForTimeout(1000);
    const body = page.locator('body');
    const box = await body.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(400);
  });

  test('renders at sidepanel width (400px)', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    await page.goto('http://localhost:3000/sidepanel.html');
    await page.waitForTimeout(1000);
    const body = page.locator('body');
    const box = await body.boundingBox();
    expect(box).not.toBeNull();
  });

  test('renders at full width (1200px)', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('http://localhost:3000/app.html');
    await page.waitForTimeout(1000);
    const body = page.locator('body');
    const box = await body.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBe(1200);
  });

  test('renders at mobile width (320px)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('http://localhost:3000/popup.html');
    await page.waitForTimeout(1000);
    const body = page.locator('body');
    const box = await body.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(320);
  });
});

// ── Accessibility Tests ─────────────────────────────────────────────────────

test.describe('Accessibility', () => {
  test('html has lang="en" attribute', async ({ page }) => {
    await page.goto('http://localhost:3000/popup.html');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'en');
  });

  test('viewport meta tag is present', async ({ page }) => {
    await page.goto('http://localhost:3000/popup.html');
    const viewport = page.locator('meta[name="viewport"]');
    await expect(viewport).toBeAttached();
  });

  test('viewport meta contains width=device-width', async ({ page }) => {
    await page.goto('http://localhost:3000/popup.html');
    const viewport = page.locator('meta[name="viewport"]');
    const content = await viewport.getAttribute('content');
    expect(content).toContain('width=device-width');
  });
});

// ── Navigation Between Entry Points ─────────────────────────────────────────

test.describe('Entry Points Consistency', () => {
  test('all entry points share the same title', async ({ page }) => {
    const pages = ['popup.html', 'sidepanel.html', 'app.html'];
    for (const pagePath of pages) {
      await page.goto(`http://localhost:3000/${pagePath}`);
      await expect(page).toHaveTitle('1Click: Temp Mail & Autofill Form');
    }
  });

  test('all entry points have #app container', async ({ page }) => {
    const pages = ['popup.html', 'sidepanel.html', 'app.html'];
    for (const pagePath of pages) {
      await page.goto(`http://localhost:3000/${pagePath}`);
      await expect(page.locator('#app')).toBeAttached();
    }
  });

  test('all entry points load module scripts', async ({ page }) => {
    const pages = ['popup.html', 'sidepanel.html', 'app.html'];
    for (const pagePath of pages) {
      await page.goto(`http://localhost:3000/${pagePath}`);
      await expect(page.locator('script[type="module"]')).toBeAttached();
    }
  });
});

// ── Content Security Tests ──────────────────────────────────────────────────

test.describe('Content Security', () => {
  test('no inline scripts in HTML', async ({ page }) => {
    await page.goto('http://localhost:3000/popup.html');
    const inlineScripts = await page.locator('script:not([src])').count();
    // Should have no inline scripts (only module scripts with src)
    expect(inlineScripts).toBe(0);
  });

  test('no external domain requests in HTML', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (req) => requests.push(req.url()));
    await page.goto('http://localhost:3000/popup.html');
    await page.waitForTimeout(3000);
    // All requests should be to localhost
    const externalRequests = requests.filter((r) => !r.startsWith('http://localhost'));
    expect(externalRequests).toEqual([]);
  });
});
