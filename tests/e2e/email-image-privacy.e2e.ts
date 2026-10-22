import { initSanitize, sanitizeHtml } from '../../src/utils/email/sanitize-html';
import { expect, test } from './fixtures';

const EVIL_ORIGIN = 'https://evil.example';
const CAPTURE_ORIGIN = 'https://mail-capture.test';

test('sanitized email markup causes no remote image requests in the browser engine', async ({
  context,
}) => {
  // Includes native browser startup plus Node-side JSDOM/CSS parser loading.
  test.setTimeout(60_000);
  await context.route(`${CAPTURE_ORIGIN}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body><div id="mail"></div></body></html>',
    })
  );

  const capturedRequests: string[] = [];
  await context.route(`${EVIL_ORIGIN}/**`, async (route) => {
    capturedRequests.push(route.request().url());
    await route.abort('blockedbyclient');
  });

  const page = await context.newPage();
  await page.goto(`${CAPTURE_ORIGIN}/message`);

  // Prove that this capture sees actual browser resource loads before testing
  // the sanitizer. The route aborts the request before it reaches the network.
  const controlUrl = `${EVIL_ORIGIN}/capture-control.png`;
  const controlRequest = page.waitForRequest(controlUrl);
  await page.evaluate((url) => {
    const image = document.createElement('img');
    image.src = url;
    document.querySelector('#mail')?.append(image);
  }, controlUrl);
  await controlRequest;
  await expect.poll(() => capturedRequests).toContain(controlUrl);

  capturedRequests.length = 0;
  await initSanitize();

  const attackMarkup = [
    '<p style="background-image:url(https://evil.example/inline-url.png)">inline url</p>',
    '<p style="background-image:image-set(\'https://evil.example/inline-image-set.png\' 1x)">inline image-set</p>',
    '<style>.block-url { background-image: url(https://evil.example/block-url.png) }</style>',
    "<style>.block-image-set { background-image: -webkit-image-set('https://evil.example/block-image-set.png' 1x) }</style>",
    '<table background="https://evil.example/background-attribute.png"><tr><td>legacy background</td></tr></table>',
  ].join('');
  const sanitizedMarkup = sanitizeHtml(attackMarkup, { allowStyleBlocks: true });

  expect(sanitizedMarkup).not.toContain('evil.example');
  await page.evaluate((html) => {
    const mail = document.querySelector('#mail');
    if (!mail) throw new Error('mail capture mount is missing');
    const shadow = mail.attachShadow({ mode: 'open' });
    shadow.innerHTML = html;
  }, sanitizedMarkup);

  // Let CSS style resolution and subresource scheduling complete. The unsafe
  // control above proves the route is active, while these sanitized payloads
  // must schedule no request at all.
  await page.waitForTimeout(750);
  expect(capturedRequests).toEqual([]);

  await page.close();
});
