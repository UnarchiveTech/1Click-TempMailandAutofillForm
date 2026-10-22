/** Package the CURRENT extension bundles as a static, isolated web demo. */
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const output = resolve(root, '.output/web-demo');
if (dirname(output) !== resolve(root, '.output'))
  throw new Error('Unexpected web demo output directory');
const source = join(root, '.output/web-demo-extension/chrome-mv3');
const build = Bun.spawn([process.execPath, 'run', 'build:chrome'], {
  cwd: root,
  env: { ...process.env, WEB_DEMO_BUILD: '1' },
  stdout: 'inherit',
  stderr: 'inherit',
});
if (await build.exited) throw new Error('The extension web target did not build');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version: string };
const revision =
  process.env.GITHUB_SHA ||
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
await rm(output, { recursive: true, force: true });
const site = join(output, '1click');
await mkdir(site, { recursive: true });
await cp(source, join(site, 'extension'), { recursive: true });
const bundle = async (entry: string, filename: string, format: 'esm' | 'iife') => {
  const result = await Bun.build({
    entrypoints: [join(root, 'src/web-demo', entry)],
    target: 'browser',
    format,
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  if (!result.success)
    throw new Error(`Could not bundle ${entry}: ${result.logs.map(String).join('\n')}`);
  await writeFile(join(site, filename), await result.outputs[0].text());
};
await bundle('bootstrap.ts', 'bootstrap.js', 'iife');
await bundle('shell.ts', 'shell.js', 'esm');
await bundle('sample.ts', 'sample.js', 'esm');
const bootstrap = '<script src="../bootstrap.js"></script>';
for (const name of ['popup', 'app', 'sidepanel']) {
  const file = join(site, 'extension', `${name}.html`);
  const html = await readFile(file, 'utf8');
  await writeFile(
    file,
    html.replace(
      '<body>',
      `<body>${bootstrap}<style>[data-web-demo] [data-demo-exit]{display:none}</style>`
    )
  );
}
await writeFile(
  join(site, 'extension/background.html'),
  `<!doctype html><html><head><meta charset="utf-8"></head><body>${bootstrap}<script src="background.js"></script></body></html>`
);
const copyKeys = {
  title: 'webDemo.title',
  notice: 'webDemo.notice',
  instructions: 'webDemo.instructions',
  fill: 'webDemo.fill',
  fillOtp: 'webDemo.fillOtp',
  signup: 'webDemo.signup',
  verify: 'webDemo.verify',
  verified: 'webDemo.verified',
  pending: 'webDemo.pending',
  failed: 'webDemo.failed',
  install: 'webDemo.install',
  sample: 'webDemo.sample',
  reset: 'common.reset',
  firstName: 'identities.firstNames',
  lastName: 'identities.lastNames',
  username: 'identities.username',
  email: 'savedLoginInfo.email',
  password: 'savedLoginInfo.password',
  otp: 'savedLoginInfo.otp',
};
const dictionaries: Record<string, Record<string, string>> = {};
for (const language of ['en', 'ar', 'de', 'es', 'fr', 'ja', 'th', 'zh']) {
  const dictionary = JSON.parse(await readFile(join(root, `src/locales/${language}.json`), 'utf8'));
  dictionaries[language] = Object.fromEntries(
    Object.entries(copyKeys).map(([name, key]) => {
      const value = key.split('.').reduce((node, part) => node?.[part], dictionary);
      if (typeof value !== 'string') throw new Error(`Missing ${language}:${key}`);
      return [name, value];
    })
  );
}
await writeFile(join(site, 'copy.json'), JSON.stringify(dictionaries));
await writeFile(join(site, 'version.json'), JSON.stringify({ version: pkg.version, revision }));
const head =
  '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="./extension/icons/icon32.png"><link rel="stylesheet" href="./demo.css">';
const escapeAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
await writeFile(
  join(site, 'index.html'),
  `<!doctype html><html lang="en"><head>${head}<title>1Click</title></head><body><header><h1 data-copy="title"></h1><span id="version"></span><a href="https://unarchive.tech" data-copy="install"></a></header><p data-copy="notice"></p><div id="actions" class="actions" data-action-tier="S"><button id="fill" disabled><span data-copy="fill"></span></button><button id="fillOtp"><span data-copy="fillOtp"></span></button><button id="reset"><span data-copy="reset"></span></button></div><p id="status" role="status" data-failure="${escapeAttribute(dictionaries.en.failed)}" data-copy="instructions"></p><div class="views"><button data-view="sample" aria-pressed="true" data-copy="sample"></button><button data-view="extension" aria-pressed="false">1Click</button></div><main id="workspace" data-pane="sample"><iframe id="sample" title="1Click"></iframe><div id="extensionViewport"><iframe id="extension" title="1Click"></iframe></div></main><iframe id="background" title="" hidden></iframe><script type="module" src="./shell.js"></script></body></html>`
);
const input = (name: string, type: string, autocomplete: string) =>
  `<label><span data-copy="${name}"></span><input name="${name}" id="${name}" type="${type}" autocomplete="${autocomplete}" required></label>`;
await writeFile(
  join(site, 'sample.html'),
  `<!doctype html><html lang="en"><head>${head}<title>Demo Shop</title></head><body class="sample"><h1>Demo Shop</h1><h2 data-copy="signup"></h2><form id="signup">${input('firstName', 'text', 'given-name')}${input('lastName', 'text', 'family-name')}${input('username', 'text', 'username')}${input('email', 'email', 'email')}${input('password', 'password', 'new-password')}<button type="submit" data-copy="signup"></button></form><form id="verification" hidden><label><span data-copy="otp"></span><input name="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><button type="submit" data-copy="verify"></button></form><p id="result" role="status"></p><script src="./bootstrap.js"></script><script type="module" src="./sample.js"></script><script src="./extension/content-runtime.js" defer></script></body></html>`
);
await cp(join(root, 'src/web-demo/demo.css'), join(site, 'demo.css'));
await writeFile(
  join(output, 'index.html'),
  '<!doctype html><html><head><meta http-equiv="refresh" content="0;url=./1click/"><title>1Click</title></head><body><a href="./1click/">1Click</a></body></html>'
);
await writeFile(
  join(output, '_headers'),
  `/*\n  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n/1click/*\n  Cache-Control: no-cache\n`
);
console.log(`Built web demo from ${revision.slice(0, 7)} in ${output}`);
