import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { normalizePath, type Plugin } from 'vite';

const PACKED_PREFIX = '\0packed-locale:';
const PACKED_LOCALE_PATH = /^(?:background\/)?(?:ar|de|es|fr|ja|th|zh)\.json$/;

/** Stable, lossless build representation; source JSON and translation gates stay unchanged. */
export function packLocale(source: string): string {
  const json = JSON.stringify(JSON.parse(source));
  return deflateSync(Buffer.from(json, 'utf8'), { level: 9 }).toString('base64');
}

/** English remains an ordinary JSON module for the synchronous startup fallback. */
export function isPackedLocalePath(id: string, root: string): boolean {
  const prefix = `${normalizePath(join(root, 'src/locales'))}/`;
  const path = normalizePath(id);
  return path.startsWith(prefix) && PACKED_LOCALE_PATH.test(path.slice(prefix.length));
}

export function packedLocalesPlugin(root: string): Plugin {
  const decoder = normalizePath(join(root, 'src/utils/i18n/packed-locale.ts'));
  return {
    name: 'packed-locales',
    apply: 'build',
    enforce: 'pre',
    async resolveId(source, importer) {
      // Asset queries (?url, ?raw) and JSON outside the project's dictionaries
      // keep Vite's normal loader. Resolve real paths before applying the rule.
      if (!source.endsWith('.json')) return null;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      if (!resolved || !isPackedLocalePath(resolved.id, root)) return null;
      // A JS virtual id prevents Vite's JSON plugin from parsing the generated JS.
      return `${PACKED_PREFIX}${normalizePath(resolved.id)}.js`;
    },
    async load(id) {
      if (!id.startsWith(PACKED_PREFIX)) return null;
      const sourcePath = id.slice(PACKED_PREFIX.length, -3);
      this.addWatchFile(sourcePath);
      const packed = packLocale(await readFile(sourcePath, 'utf8'));
      return `import { decodePackedLocale } from ${JSON.stringify(decoder)};\nexport default decodePackedLocale(${JSON.stringify(packed)});`;
    },
  };
}

/**
 * Shared utilities import the minimal background engine because they also run
 * in the worker. In HTML builds the full UI engine is already present and is a
 * superset with the same API, dictionaries and locale-change behavior. Reusing
 * it avoids shipping a second dictionary set and warming two engines in the UI.
 * This plugin must only be installed for HTML entrypoint groups.
 */
export function sharedUiI18nPlugin(root: string): Plugin {
  const background = normalizePath(join(root, 'src/utils/i18n/i18n-background.ts'));
  const ui = normalizePath(join(root, 'src/utils/i18n/i18n-utils.ts'));
  return {
    name: 'shared-ui-i18n',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.endsWith('/i18n-background.js')) return null;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      return resolved && normalizePath(resolved.id) === background ? ui : null;
    },
  };
}
