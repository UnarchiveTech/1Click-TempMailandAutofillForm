import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const procEnv = { ...process.env, DOCS_BASE_PATH: '/' };

// Build with local base path so /styles.css + /screenshots/* resolve at http://localhost:3000/
// No `shell: true` - that breaks on Windows/Bun (tries to spawn cmd.exe via uv_spawn).
const build = spawn('bun', ['scripts/docs-build.ts'], {
  stdio: 'inherit',
  env: procEnv,
});

build.on('close', (code) => {
  if (code !== 0) process.exit(code ?? 1);

  const dist = resolve(import.meta.dir, '../docs-site/dist');
  if (!existsSync(dist)) {
    console.error('docs-site/dist not found after build');
    process.exit(1);
  }

  console.log('\n✔ Docs built for local preview (DOCS_BASE_PATH=/)');
  console.log('  Serving docs-site/dist at http://localhost:3000/');
  console.log('  (production base is /1click/ - run `bun run docs:build` to restore)\n');

  const serve = spawn('bunx', ['serve', 'docs-site/dist', '-l', '3000'], {
    stdio: 'inherit',
  });

  const fallback = () => {
    console.log('\n`serve` not available, trying python http.server…');
    spawn('python', ['-m', 'http.server', '3000', '--directory', 'docs-site/dist'], {
      stdio: 'inherit',
    });
  };

  serve.on('error', fallback);
  serve.on('close', (serveCode) => {
    if (serveCode !== 0 && serveCode !== null) fallback();
  });
});
