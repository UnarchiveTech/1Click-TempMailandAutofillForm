/**
 * Guard for which page fields the extension is willing to write into.
 *
 * Every autofill path must agree on this: OTP detection (`isVisibleInput`),
 * username/email detection, and the password/confirm fills all check
 * visibility + editability so a page cannot plant hidden / disabled /
 * read-only / off-screen inputs to harvest generated passwords or
 * refilled saved logins. Without it, a crafted page can point autofill at a
 * field it controls and read the value on the synthetic input events.
 */

export function isFillableField(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
): boolean {
  if (el instanceof HTMLInputElement && el.type === 'hidden') return false;
  if (el.disabled || ('readOnly' in el && el.readOnly)) return false;
  try {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
  } catch {
    // getBoundingClientRect / getComputedStyle can throw on detached nodes
    return false;
  }
  return true;
}
