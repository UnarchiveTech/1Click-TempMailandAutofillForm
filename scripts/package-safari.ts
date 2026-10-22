#!/usr/bin/env bun
/**
 * scripts/package-safari.ts
 *
 * Produces the store-upload-ready Safari archive from the WXT build output.
 *
 * Why this exists:
 *   Apple's Safari Web Extension Packager (App Store Connect -> Xcode Cloud
 *   tab) requires a zip of the extension CONTENTS - manifest.json at the
 *   archive root, not wrapped in a parent folder. `wxt zip -b safari` /
 *   `bun run zip:safari` make a plain WXT archive, so store uploads need a
 *   dedicated packaging step.
 *
 * Uses fflate (already a runtime dependency) so it works identically on
 * macOS/Linux/Windows - no system `zip` binary required.
 *
 * Run:  bun run package:safari   (builds first, then packages)
 *       bun scripts/package-safari.ts   (packages the existing build only)
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { zipSync } from 'fflate';

const ROOT = join(import.meta.dir, '..');
const BUILD_DIR = join(ROOT, '.output', 'safari-mv3');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
const VERSION = process.env.VERSION_OVERRIDE?.replace(/^v/, '') || pkg.version;
const OUT_ZIP = join(ROOT, `safari-extension-${VERSION}.zip`);

/** Recursively collect every file under a directory, paths relative to it. */
function collectFiles(dir: string, base: string, out: Record<string, Uint8Array>): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collectFiles(full, base, out);
    } else {
      // Forward slashes in archive paths regardless of host OS.
      out[relative(base, full).split(sep).join('/')] = readFileSync(full);
    }
  }
}

if (!existsSync(join(BUILD_DIR, 'manifest.json'))) {
  console.error(`✖ Safari build not found at ${BUILD_DIR}.`);
  console.error(
    '  Run "bun run build:safari" first, or use "bun run package:safari" which builds automatically.'
  );
  process.exit(1);
}

const files: Record<string, Uint8Array> = {};
collectFiles(BUILD_DIR, BUILD_DIR, files);

if (!('manifest.json' in files)) {
  console.error('✖ manifest.json missing from build output - aborting.');
  process.exit(1);
}

// Entries are relative to the build dir, so manifest.json lands at the
// archive root - exactly the shape Apple's packager expects.
const zipped = zipSync(files, { level: 9 });
writeFileSync(OUT_ZIP, zipped);

console.log(
  `✔ Packaged ${Object.keys(files).length} files (${(zipped.length / 1024).toFixed(0)} kB) -> ${OUT_ZIP}`
);
console.log(`✔ manifest.json is at the archive root.`);
console.log(
  '💡 Upload this zip in App Store Connect: your app -> Xcode Cloud tab -> Safari Web Extension Packager -> Upload.'
);
