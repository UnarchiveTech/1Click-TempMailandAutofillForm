/**
 * Local-only profile heuristics (no network).
 * Used for default identity country / sample city / ZIP / adult DOB.
 */

import { randomItem } from '@/utils/secure-random.js';

/** Common IANA timezone → ISO country code (local, offline). */
const TZ_TO_COUNTRY: Record<string, string> = {
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Los_Angeles': 'US',
  'America/Phoenix': 'US',
  'America/Anchorage': 'US',
  'America/Toronto': 'CA',
  'America/Vancouver': 'CA',
  'America/Mexico_City': 'MX',
  'America/Sao_Paulo': 'BR',
  'America/Argentina/Buenos_Aires': 'AR',
  'Europe/London': 'GB',
  'Europe/Dublin': 'IE',
  'Europe/Berlin': 'DE',
  'Europe/Paris': 'FR',
  'Europe/Madrid': 'ES',
  'Europe/Rome': 'IT',
  'Europe/Amsterdam': 'NL',
  'Europe/Brussels': 'BE',
  'Europe/Vienna': 'AT',
  'Europe/Zurich': 'CH',
  'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO',
  'Europe/Copenhagen': 'DK',
  'Europe/Helsinki': 'FI',
  'Europe/Warsaw': 'PL',
  'Europe/Prague': 'CZ',
  'Europe/Lisbon': 'PT',
  'Europe/Athens': 'GR',
  'Europe/Moscow': 'RU',
  'Europe/Istanbul': 'TR',
  'Asia/Tokyo': 'JP',
  'Asia/Seoul': 'KR',
  'Asia/Shanghai': 'CN',
  'Asia/Hong_Kong': 'HK',
  'Asia/Singapore': 'SG',
  'Asia/Kolkata': 'IN',
  'Asia/Dubai': 'AE',
  'Asia/Bangkok': 'TH',
  'Asia/Jakarta': 'ID',
  'Australia/Sydney': 'AU',
  'Australia/Melbourne': 'AU',
  'Pacific/Auckland': 'NZ',
  'Africa/Cairo': 'EG',
  'Africa/Johannesburg': 'ZA',
};

const LANG_TO_COUNTRY: Record<string, string> = {
  en: 'US',
  de: 'DE',
  fr: 'FR',
  es: 'ES',
  ar: 'AE',
  ja: 'JP',
  zh: 'CN',
  pt: 'BR',
  it: 'IT',
  nl: 'NL',
  pl: 'PL',
  ru: 'RU',
  ko: 'KR',
  hi: 'IN',
  tr: 'TR',
  sv: 'SE',
};

const CITIES: Record<string, string[]> = {
  US: ['Springfield', 'Madison', 'Georgetown', 'Franklin', 'Clinton', 'Fairview'],
  GB: ['Bristol', 'Leeds', 'Manchester', 'Reading', 'Oxford', 'Cambridge'],
  DE: ['Berlin', 'Munich', 'Hamburg', 'Cologne', 'Frankfurt', 'Stuttgart'],
  FR: ['Lyon', 'Marseille', 'Toulouse', 'Nantes', 'Lille', 'Bordeaux'],
  ES: ['Madrid', 'Barcelona', 'Valencia', 'Seville', 'Bilbao', 'Malaga'],
  IT: ['Rome', 'Milan', 'Naples', 'Turin', 'Florence', 'Bologna'],
  CA: ['Toronto', 'Vancouver', 'Montreal', 'Ottawa', 'Calgary', 'Halifax'],
  AU: ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra'],
  JP: ['Tokyo', 'Osaka', 'Yokohama', 'Nagoya', 'Sapporo', 'Fukuoka'],
  CN: ['Shanghai', 'Beijing', 'Guangzhou', 'Shenzhen', 'Chengdu', 'Hangzhou'],
  IN: ['Mumbai', 'Delhi', 'Bangalore', 'Chennai', 'Hyderabad', 'Pune'],
  AE: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman'],
  BR: ['São Paulo', 'Rio de Janeiro', 'Brasília', 'Salvador', 'Curitiba'],
  NL: ['Amsterdam', 'Rotterdam', 'Utrecht', 'The Hague', 'Eindhoven'],
};

function randomInt(min: number, max: number): number {
  // inclusive
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Detect ISO country code using only local browser signals
 * (language tag region + timezone). Never hits the network.
 */
export function detectCountryLocally(): string {
  try {
    const lang =
      (typeof navigator !== 'undefined' && (navigator.language || navigator.languages?.[0])) ||
      'en-US';
    const parts = String(lang).replace('_', '-').split('-');
    if (parts.length >= 2) {
      const region = parts[parts.length - 1];
      if (/^[A-Za-z]{2}$/.test(region) && region.toUpperCase() !== 'EN') {
        // en-GB → GB, zh-CN → CN; avoid bare "EN"
        return region.toUpperCase();
      }
      if (/^[A-Za-z]{2}$/.test(region)) {
        return region.toUpperCase();
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (tz && TZ_TO_COUNTRY[tz]) return TZ_TO_COUNTRY[tz];
    // Continent/City fallbacks
    if (tz.startsWith('America/')) return 'US';
    if (tz.startsWith('Europe/London')) return 'GB';
    if (tz.startsWith('Europe/')) return 'DE';
    if (tz.startsWith('Asia/Tokyo')) return 'JP';
    if (tz.startsWith('Asia/Shanghai') || tz.startsWith('Asia/Chongqing')) return 'CN';
    if (tz.startsWith('Asia/Kolkata') || tz.startsWith('Asia/Calcutta')) return 'IN';
    if (tz.startsWith('Australia/')) return 'AU';
  } catch {
    /* ignore */
  }

  try {
    const raw =
      typeof navigator !== 'undefined'
        ? navigator.language || navigator.languages?.[0] || 'en'
        : 'en';
    const lang = String(raw).split('-')[0] || 'en';
    return LANG_TO_COUNTRY[lang.toLowerCase()] || 'US';
  } catch {
    return 'US';
  }
}

/** Random DOB as YYYY-MM-DD, age between minAge and maxAge (inclusive). */
export function randomAdultDob(minAge = 18, maxAge = 65): string {
  const now = new Date();
  const maxDate = new Date(now.getFullYear() - minAge, now.getMonth(), now.getDate());
  const minDate = new Date(now.getFullYear() - maxAge, now.getMonth(), now.getDate());
  const t = randomInt(minDate.getTime(), maxDate.getTime());
  const d = new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Random DOB within inclusive year range (still clamped adult if needed). */
export function randomDobInYearRange(fromYear: number, toYear: number, minAge = 18): string {
  const now = new Date();
  const maxAdultYear = now.getFullYear() - minAge;
  let y0 = Math.min(fromYear, toYear);
  let y1 = Math.max(fromYear, toYear);
  y1 = Math.min(y1, maxAdultYear);
  if (y0 > y1) y0 = y1 - 10;
  const year = randomInt(y0, y1);
  const month = randomInt(1, 12);
  const day = randomInt(1, 28);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Max date string (YYYY-MM-DD) for someone at least `minAge` years old today. */
export function maxAdultDobDate(minAge = 18): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - minAge);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function randomCity(countryCode: string): string {
  const list = CITIES[countryCode.toUpperCase()] || CITIES.US;
  return randomItem(list) || 'Springfield';
}

/** Offline sample postal codes by country style. */
export function randomPostalCode(countryCode: string): string {
  const c = countryCode.toUpperCase();
  switch (c) {
    case 'US':
      return String(randomInt(10000, 99999));
    case 'GB': {
      const letters = 'ABCDEFGHJKLMNPRSTUWXYZ';
      const a = letters[randomInt(0, letters.length - 1)];
      const b = letters[randomInt(0, letters.length - 1)];
      return `${a}${b}${randomInt(1, 9)} ${randomInt(1, 9)}${a}${b}`;
    }
    case 'CA': {
      const L = 'ABCEGHJKLMNPRSTVXY';
      const l1 = L[randomInt(0, L.length - 1)];
      const l2 = L[randomInt(0, L.length - 1)];
      const l3 = L[randomInt(0, L.length - 1)];
      return `${l1}${randomInt(0, 9)}${l2} ${randomInt(0, 9)}${l3}${randomInt(0, 9)}`;
    }
    case 'JP':
      return `${randomInt(100, 999)}-${randomInt(1000, 9999)}`;
    case 'NL':
      return `${randomInt(1000, 9999)} AB`;
    case 'BR':
      return `${randomInt(10000, 99999)}-${randomInt(100, 999)}`;
    default:
      // DE/FR/ES/IT/… 5-digit style
      return String(randomInt(10000, 99999));
  }
}

export interface GeneratedProfileExtras {
  country: string;
  dateOfBirth: string;
  pin: string;
  city: string;
}

export function generateLocalProfileExtras(): GeneratedProfileExtras {
  const country = detectCountryLocally();
  return {
    country,
    dateOfBirth: randomAdultDob(18, 55),
    pin: randomPostalCode(country),
    city: randomCity(country),
  };
}
