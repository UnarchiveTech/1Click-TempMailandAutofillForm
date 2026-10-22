import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { startContentRuntime } from './content/content-runtime.js';

/** Heavy content runtime, injected by the background only into eligible frames. */
export default defineUnlistedScript(() => {
  startContentRuntime();
});
