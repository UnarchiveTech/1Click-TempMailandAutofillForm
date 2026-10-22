#!/usr/bin/env bun
/**
 * Validate src/config/providers.jsonc against structural rules in provider-validation.ts.
 * CI gate - exits 0 when all providers pass, 1 on any error.
 *
 * Usage: bun run check-providers
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as jsonc from 'jsonc-parser';
import { validateAllProviderConfigs } from '../src/utils/provider/provider-validation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const providersPath = join(__dirname, '../src/config/providers.jsonc');

try {
  const raw = readFileSync(providersPath, 'utf8');
  const configs = jsonc.parse(raw) as unknown[];
  validateAllProviderConfigs(configs);
  const count = Array.isArray(configs) ? configs.length : 0;
  console.log(`✓ providers.jsonc OK (${count} provider(s))`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`✗ providers.jsonc validation failed: ${message}`);
  process.exit(1);
}
