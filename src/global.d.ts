// WXT provides browser and chrome globals with proper types.
type Browser = import('wxt/browser').Browser;

declare const browser: Browser;
declare const chrome: Browser;

// CSS imports
declare module '*.css';

// JSON with comments (providers.jsonc, providers.schema.jsonc)
// Vite's wxt.config.ts transform plugin strips // and /* */ comments and
// trailing commas before JSON.parse, so the imported value is plain JSON.
declare module '*.jsonc' {
  const value: unknown;
  export default value;
}
