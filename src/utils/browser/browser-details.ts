import { browser } from 'wxt/browser';

export type BrowserDetails = {
  name: string | null;
  version: string | null;
  chromiumVersion: string | null;
};

type BrowserBrandVersion = {
  brand: string;
  version: string;
};

type UserAgentDataLike = {
  brands: BrowserBrandVersion[];
  getHighEntropyValues?: (hints: string[]) => Promise<{
    fullVersionList?: BrowserBrandVersion[];
  }>;
};

type BrowserInfoRuntime = {
  getBrowserInfo?: () => Promise<{
    name?: string;
    version?: string;
  }>;
};

function isGreaseBrand(brand: string): boolean {
  const normalized = brand.toLowerCase();
  return normalized.includes('not') && normalized.includes('brand');
}

function detailsFromUserAgentData(uaData: UserAgentDataLike): BrowserDetails {
  const brands = uaData.brands.filter(({ brand }) => !isGreaseBrand(brand));
  const chromium = brands.find(({ brand }) => brand.toLowerCase() === 'chromium');
  const product = brands.find(({ brand }) => brand.toLowerCase() !== 'chromium');

  return {
    name: product?.brand ?? chromium?.brand ?? brands[0]?.brand ?? null,
    version: product?.version ?? chromium?.version ?? brands[0]?.version ?? null,
    chromiumVersion: chromium?.version ?? null,
  };
}

function detailsFromUserAgent(userAgent: string): BrowserDetails {
  const firefox = userAgent.match(/Firefox\/([\d.]+)/i);
  if (firefox) return { name: 'Firefox', version: firefox[1], chromiumVersion: null };

  const safari = userAgent.match(/Version\/([\d.]+).*Safari\//i);
  if (safari) return { name: 'Safari', version: safari[1], chromiumVersion: null };

  const chromium = userAgent.match(/(?:Chrome|Chromium)\/([\d.]+)/i);
  if (chromium) {
    return {
      name: 'Chromium-based browser',
      version: chromium[1],
      chromiumVersion: chromium[1],
    };
  }

  return { name: null, version: null, chromiumVersion: null };
}

/** Reads browser-reported identity without assuming the WXT build target. */
export async function getBrowserDetails(): Promise<BrowserDetails> {
  const runtimeWithBrowserInfo = browser.runtime as unknown as BrowserInfoRuntime;
  if (typeof runtimeWithBrowserInfo.getBrowserInfo === 'function') {
    try {
      const info = await runtimeWithBrowserInfo.getBrowserInfo();
      if (info.name || info.version) {
        return {
          name: info.name ?? null,
          version: info.version ?? null,
          chromiumVersion: null,
        };
      }
    } catch {
      // Continue to the browser's web-platform identity APIs when unavailable.
    }
  }

  if (typeof navigator !== 'undefined') {
    const uaData = (navigator as Navigator & { userAgentData?: UserAgentDataLike }).userAgentData;
    if (uaData) {
      let details = detailsFromUserAgentData(uaData);
      if (typeof uaData.getHighEntropyValues === 'function') {
        try {
          const { fullVersionList } = await uaData.getHighEntropyValues(['fullVersionList']);
          if (fullVersionList)
            details = detailsFromUserAgentData({ ...uaData, brands: fullVersionList });
        } catch {
          // Low-entropy brand versions remain useful if full versions are withheld.
        }
      }
      return details;
    }

    return detailsFromUserAgent(navigator.userAgent);
  }

  return { name: null, version: null, chromiumVersion: null };
}
