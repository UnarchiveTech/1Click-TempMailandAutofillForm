/**
 * Firefox 158 on Windows delivered Alt+Shift+F key events without dispatching
 * its extension command. Alt+Shift+Z dispatched through the same native test.
 * Keep the other targets' established shortcut; these are fresh-install
 * defaults, not overrides of shortcuts a user has customized in their browser.
 */
export function defaultAutofillShortcut(browser: string): 'Alt+Shift+F' | 'Alt+Shift+Z' {
  return browser === 'firefox' ? 'Alt+Shift+Z' : 'Alt+Shift+F';
}
