/**
 * SVG markup for icons - single source for Icon.svelte and content scripts.
 * Content scripts cannot mount Svelte; they import string builders from here.
 */

export type IconSvgName =
  | 'logoMark'
  | 'plus'
  | 'user'
  | 'lock'
  | 'phone'
  | 'globe'
  | 'edit'
  | 'mail'
  | 'mailSolid'
  | 'autofillForm'
  | 'chevronDown'
  | 'x'
  | 'check';

/** Extension logo mark (simplified envelope) for in-page Autofill chips */
function logoMarkSvg(size = 14, color = 'currentColor'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="${color}" style="pointer-events:none" aria-hidden="true"><path d="M12.01 21.49L2.39 9.75C2.14 9.45 2 9.07 2 8.67V3.5c0-.83.67-1.5 1.5-1.5h17c.83 0 1.5.67 1.5 1.5v5.17c0 .4-.14.78-.39 1.08l-9.6 11.74zm-8.01-18v5.06l8 9.77 8-9.77V3.49H4zm8 11.06l-4.89-5.97h9.78L12 14.55z"/></svg>`;
}

export function getIconSvg(name: IconSvgName, opts?: { size?: number; color?: string }): string {
  const size = opts?.size ?? 16;
  const color = opts?.color ?? 'currentColor';
  const common = `xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="${color}" style="pointer-events:none" aria-hidden="true"`;
  switch (name) {
    case 'logoMark':
      return logoMarkSvg(size, color);
    case 'plus':
      return `<svg ${common} fill="none" stroke="${color}" stroke-width="2"><path stroke-linecap="round" d="M12 4v16m8-8H4"/></svg>`;
    case 'user':
      return `<svg ${common} fill="none" stroke="${color}" stroke-width="2"><path stroke-linecap="round" d="M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM12 14a7 7 0 0 0-7 7h14a7 7 0 0 0-7-7z"/></svg>`;
    case 'lock':
      return `<svg ${common} fill="none" stroke="${color}" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
    case 'phone':
      return `<svg ${common}><path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/></svg>`;
    case 'globe':
      return `<svg ${common} fill="none" stroke="${color}" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
    case 'edit':
      return `<svg ${common} fill="none" stroke="${color}" stroke-width="2"><path stroke-linecap="round" d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5m-1.414-9.414a2 2 0 1 1 2.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>`;
    case 'mail':
      return `<svg ${common} fill="none" stroke="${color}" stroke-width="2"><path stroke-linecap="round" d="M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z"/></svg>`;
    case 'mailSolid':
      return `<svg ${common}><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>`;
    case 'autofillForm':
      return `<svg ${common}><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 8h-3v3c0 .55-.45 1-1 1s-1-.45-1-1v-3H9c-.55 0-1-.45-1-1s.45-1 1-1h3V7c0-.55.45-1 1-1s1 .45 1 1v3h3c.55 0 1 .45 1 1s-.45 1-1 1z"/></svg>`;
    case 'chevronDown':
      return `<svg ${common} fill="none" stroke="${color}" stroke-width="2"><path stroke-linecap="round" d="M19 9l-7 7-7-7"/></svg>`;
    case 'x':
      return `<svg ${common} fill="none" stroke="${color}" stroke-width="2.5"><path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/></svg>`;
    case 'check':
      return `<svg ${common} fill="none" stroke="${color}" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`;
    default:
      return logoMarkSvg(size, color);
  }
}
