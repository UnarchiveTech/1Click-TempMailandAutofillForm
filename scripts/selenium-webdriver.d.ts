/**
 * Ambient type shims for the selenium-webdriver imports used by
 * scripts/e2e-firefox.ts.
 *
 * selenium-webdriver (4.x) ships no bundled type declarations and has no
 * @types package pinned in this repo, so the bare modules resolve to implicit
 * `any` and fail the strict typecheck. The e2e runner only touches a small
 * surface - Builder (with optional pinned browser version) + Key, a minimal
 * WebDriver (navigation / scripts / pointer and keyboard input / screenshots),
 * shadow-root lookup, and Firefox installation/UI context - typed explicitly.
 * If the runner grows new Selenium API usage, extend the shim (or switch to a
 * maintained @types package) rather than casting through `any`.
 */

declare module 'selenium-webdriver' {
  export const Key: {
    readonly ALT: string;
    readonly SHIFT: string;
  };

  export interface Actions {
    move(options: { x: number; y: number; origin: 'viewport' }): this;
    click(): this;
    keyDown(key: string): this;
    keyUp(key: string): this;
    sendKeys(key: string): this;
    perform(): Promise<void>;
  }

  export interface ShadowRoot {
    findElement(locator: { css: string }): Promise<WebElement>;
  }

  export interface WebElement {
    getShadowRoot(): Promise<ShadowRoot>;
    getRect(): Promise<{ x: number; y: number; width: number; height: number }>;
    click(): Promise<void>;
  }

  /** Minimal WebDriver surface actually used by the Firefox e2e runner. */
  export interface WebDriver {
    getCapabilities(): Promise<{ get(name: string): unknown }>;
    get(url: string): Promise<void>;
    executeScript(script: string): Promise<unknown>;
    wait(condition: unknown, timeout: number): Promise<unknown>;
    actions(): Actions;
    takeScreenshot(): Promise<string>;
    quit(): Promise<void>;
  }

  export class Builder {
    forBrowser(name: string, version?: string): this;
    setFirefoxOptions(options: import('selenium-webdriver/firefox.js').Options): this;
    setFirefoxService(service: import('selenium-webdriver/firefox.js').ServiceBuilder): this;
    build(): Promise<WebDriver>;
  }
}

declare module 'selenium-webdriver/firefox.js' {
  /** Firefox-specific options (used by scripts/check-responsive-button-layout-firefox.ts). */
  export class Options {
    setBinary(path: string): this;
    addArguments(...args: string[]): this;
  }
  export class ServiceBuilder {
    constructor(executable?: string);
    addArguments(...args: string[]): this;
  }
}

declare module 'selenium-webdriver/firefox.js' {
  import type { WebDriver } from 'selenium-webdriver';

  export interface Driver extends WebDriver {
    /** Install a temporary add-on (XPI) into the running Firefox session. */
    installAddon(path: string, temporary: boolean): Promise<void>;
    setContext(context: 'chrome' | 'content'): Promise<void>;
  }
}
