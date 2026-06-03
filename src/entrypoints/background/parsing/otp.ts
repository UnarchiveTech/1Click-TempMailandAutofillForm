/**
 * OTP extraction utilities
 *
 * Multi-language keyword support: matches "code", "Code", "验证码", "コード",
 * "код", "Bestätigungscode", "mot de passe", etc. The keyword alternation is
 * built once at module load and shared across all patterns.
 *
 * HTML entities in subjects (e.g. `&#39;`, `&amp;`, `&#x27;`) are decoded
 * before pattern matching so they don't break token detection.
 */

const OTP_KEYWORDS_BY_LANG: Record<string, readonly string[]> = {
  en: [
    'code',
    'codes',
    'otp',
    'pin',
    'password',
    'passcode',
    'pass',
    'verification',
    'verify',
    'confirm',
    'confirmation',
    'authenticate',
    'authentication',
    'security',
    'secure',
    'login',
    'signin',
    'sign-in',
    'one time password',
    'one-time password',
    'security code',
    'confirm code',
  ],
  de: [
    'code',
    'passwort',
    'pin',
    'kennwort',
    'zugang',
    'sicherheit',
    'verifizierung',
    'bestätigung',
    'bestatigung',
    'authentifizierung',
    'sicherheitscode',
    'bestätigungscode',
    'bestatigungscode',
    'verifizierungscode',
    'zugangscode',
    'einmalkennwort',
    'einmalpasswort',
    'anmeldecode',
  ],
  fr: [
    'code',
    'mot de passe',
    'mot passe',
    'pin',
    'passe',
    'vérification',
    'verification',
    'confirmation',
    'authentification',
    'code de vérification',
    'code de verification',
    'code confidentiel',
    'code secret',
  ],
  es: [
    'código',
    'codigo',
    'contraseña',
    'contrasena',
    'clave',
    'pin',
    'verificación',
    'verificacion',
    'confirmación',
    'confirmacion',
    'autenticación',
    'autenticacion',
    'código de verificación',
    'codigo de verificacion',
    'código de confirmación',
    'codigo de confirmacion',
    'código de seguridad',
    'codigo de seguridad',
  ],
  it: [
    'codice',
    'password',
    'pin',
    'pass',
    'passcode',
    'verifica',
    'conferma',
    'autenticazione',
    'codice di verifica',
    'codice di conferma',
    'codice di sicurezza',
  ],
  pt: [
    'código',
    'codigo',
    'senha',
    'pin',
    'passe',
    'palavra-passe',
    'verificação',
    'verificacao',
    'confirmação',
    'confirmacao',
    'autenticação',
    'autenticacao',
    'código de verificação',
    'codigo de verificacao',
    'código de confirmação',
    'codigo de confirmacao',
    'código de segurança',
    'codigo de seguranca',
  ],
  nl: [
    'code',
    'pin',
    'wachtwoord',
    'toegangscode',
    'inlogcode',
    'verificatie',
    'bevestiging',
    'authenticatie',
    'beveiliging',
    'verificatiecode',
    'beveiligingscode',
    'bevestigingscode',
  ],
  ru: [
    'код',
    'пароль',
    'пин',
    'подтверждение',
    'проверка',
    'верификация',
    'аутентификация',
    'код подтверждения',
    'код проверки',
  ],
  ja: [
    'コード',
    '認証',
    '確認',
    'パスワード',
    'セキュリティ',
    '暗証番号',
    'パスコード',
    '認証コード',
    '確認コード',
    'セキュリティコード',
    'ワンタイムパスワード',
    'パスコード',
  ],
  'zh-CN': [
    '验证码',
    '校验码',
    '密码',
    '确认码',
    '动态密码',
    '安全码',
    '一次性密码',
    '验证',
    '校验',
    '确认',
    '认证',
    '授权',
    '身份验证',
    '动态码',
  ],
  'zh-TW': [
    '確認碼',
    '驗證碼',
    '密碼',
    '確認',
    '驗證',
    '認證',
    '動態密碼',
    '一次性密碼',
    '安全碼',
    '授權',
    '身份驗證',
    '動態碼',
  ],
  ko: [
    '인증번호',
    '인증코드',
    '인증',
    '비밀번호',
    '비번',
    '패스워드',
    '확인',
    '확인코드',
    '보안',
    '보안코드',
    '일회용 비밀번호',
    '일회용 암호',
  ],
  ar: [
    'رمز التحقق',
    'رمز التأكيد',
    'كلمة المرور',
    'كود التحقق',
    'كود التأكيد',
    'كود',
    'رمز',
    'تأكيد',
    'تحقق',
    'مصادقة',
  ],
  hi: [
    'सत्यापन कोड',
    'सुरक्षा कोड',
    'पुष्टि कोड',
    'ओटीपी',
    'पासवर्ड',
    'पिन',
    'कोड',
    'सत्यापन',
    'पुष्टि',
    'सुरक्षा',
    'प्रमाणीकरण',
  ],
  tr: [
    'doğrulama kodu',
    'dogrulama kodu',
    'güvenlik kodu',
    'guvenlik kodu',
    'onay kodu',
    'doğrulama',
    'dogrulama',
    'güvenlik',
    'guvenlik',
    'onay',
    'kod',
    'şifre',
    'sifre',
    'pin',
    'parola',
  ],
};

const EXPIRY_LANGUAGE_BY_LANG: Record<string, readonly string[]> = {
  en: ['valid for', 'expires in', 'expire', 'expires', 'expiry'],
  de: ['gültig für', 'gultig fur', 'läuft ab', 'lauft ab', 'verfällt', 'verfallt', 'gültig bis'],
  fr: ['valable pour', 'valide pour', 'expire dans', 'valable jusqu', 'expire le'],
  es: ['válido por', 'valido por', 'válido hasta', 'valido hasta', 'expira en', 'caduca en'],
  it: ['valido per', 'scade in', 'valido fino a', 'scade il'],
  pt: ['válido por', 'valido por', 'válido até', 'valido ate', 'expira em'],
  nl: ['geldig voor', 'geldig tot', 'verloopt over', 'verloopt in'],
  ru: ['действителен', 'истекает', 'истечёт', 'истечет', 'до конца'],
  ja: ['有効期限', 'まで有効', 'の間有効', '失効'],
  'zh-CN': ['有效期限', '过期', '失效', '有效时间'],
  'zh-TW': ['有效期限', '過期', '失效', '有效時間'],
  ko: ['유효 기간', '만료', '유효시간'],
  ar: ['صالح حتى', 'ينتهي', 'صالحة لمدة'],
  hi: ['के लिए मान्य', 'समाप्त', 'मान्य तक'],
  tr: ['kadar geçerli', 'sona erer', 'geçerlilik', 'süresi'],
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildKeywordAlternation(byLang: Record<string, readonly string[]>): string {
  const all = new Set<string>();
  for (const keywords of Object.values(byLang)) {
    for (const kw of keywords) all.add(kw);
  }
  return Array.from(all)
    .sort((a, b) => b.length - a.length)
    .map((kw) => escapeRegex(kw).replace(/[\s\u3000]+/g, '[\\s\\u3000]+'))
    .join('|');
}

const KEYWORD_GROUP = buildKeywordAlternation(OTP_KEYWORDS_BY_LANG);
const EXPIRY_GROUP = buildKeywordAlternation(EXPIRY_LANGUAGE_BY_LANG);

const YOUR_POSSESSIVES =
  '(?:your|this|the|votre|tu|dein|deine|ihr|euer|sein|ihre|ihr|tu|su|su|sus|uw|jouw|je|mon|ma|mes|son|sa|tuo|tua|il|la|lo|i|gli|le)';

const PATTERNS: readonly RegExp[] = [
  // 1. Standalone 4-8 char token on its own line
  /^\s*(?![a-zA-Z]{4,8}$)([a-zA-Z0-9]{4,8})\s*$/m,
  // 2. Keyword : code
  new RegExp(
    `(?:${KEYWORD_GROUP})[\\s\\S]{0,75}[:：]\\s*\\b(?![a-zA-Z]{3,8}\\b)([a-zA-Z0-9]{3,8})\\b`,
    'iu'
  ),
  // 3. (possessive) + keyword + (is|below) + code
  new RegExp(
    `(?:${YOUR_POSSESSIVES}\\s+)?(?:${KEYWORD_GROUP})\\s*(?:is|below|=|:|：)?\\s*\\b(?![a-zA-Z]{3,8}\\b)([a-zA-Z0-9]{3,8})\\b`,
    'iu'
  ),
  // 4. Keyword ... 3-8 digit code (proximity)
  new RegExp(`(?:${KEYWORD_GROUP})[\\s\\S]{0,50}\\b(\\d{3,8})\\b`, 'iu'),
];

// Subject-only: first 3-8 char alphanumeric token (last-resort permissive)
const SUBJECT_FALLBACK = /\b(?![a-zA-Z]{3,8}\b)([a-zA-Z0-9]{3,8})\b/;

// Expiration-language fallback
const EXPIRY_FALLBACK_PATTERN = new RegExp(
  `\\b(?![a-zA-Z]{3,8}\\b)([a-zA-Z0-9]{3,8})\\b[\\s\\S]{0,100}(?:${EXPIRY_GROUP})`,
  'iu'
);
const EXPIRY_TEST_PATTERN = new RegExp(`(?:${EXPIRY_GROUP})`, 'iu');

// Block-level HTML detection. Runs BEFORE text normalization so we keep the
// structural signal that a `<div>` / `<p>` / `<td>` / `<h1-6>` gives us. Many
// transactional emails render the OTP as the sole content of one of these
// block-level elements (e.g. `<div class="otp">123456</div>`). This is a
// high-confidence signal that we should prefer over plain-text patterns.
const BLOCK_TAG_NAMES = 'div|p|td|th|h[1-6]|strong|b|li|article|section|main|header|footer';
const BLOCK_PAIR_PATTERN = new RegExp(
  `<\\s*(${BLOCK_TAG_NAMES})\\b[^>]*>([\\s\\S]*?)<\\/\\s*\\1\\s*>`,
  'gi'
);

function extractFromBlockTags(html: string): string | null {
  const noComments = html.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const match of noComments.matchAll(BLOCK_PAIR_PATTERN)) {
    const inner = match[2]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&#?\w+;?/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Must be 3-8 chars, code-shaped (alphanumeric with optional inner dashes/spaces),
    // and contain at least one digit. The digit requirement rejects words like
    // "Hello" or "Customer" that happen to land in a block element.
    if (/^[a-zA-Z0-9][- a-zA-Z0-9]{1,6}[a-zA-Z0-9]$/.test(inner) && /\d/.test(inner)) {
      const normalized = normalizeOtp(inner);
      if (normalized) return normalized;
    }
  }
  return null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    });
}

function normalizeOtp(candidate: string): string | null {
  const cleaned = candidate.replace(/[- ]/g, '');
  if (cleaned.length < 3 || cleaned.length > 8) return null;
  return cleaned;
}

function normalizeSubject(subject: string | undefined): string {
  if (!subject) return '';
  return decodeHtmlEntities(subject)
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\s\u3000]+/g, ' ')
    .trim();
}

function normalizeBody(body: string | undefined): string {
  if (!body) return '';
  let normalized = body;
  normalized = normalized.replace(/<(style|script)[\s\S]*?>[\s\S]*?<\/(style|script)>/gi, '');
  normalized = normalized.replace(/<br\s*\/?>/gi, '\n');
  normalized = normalized.replace(/<p.*?>/gi, '\n');
  normalized = normalized.replace(/<div.*?>/gi, '\n');
  normalized = normalized.replace(/<h[1-6].*?>/gi, '\n');
  normalized = normalized.replace(/<[^>]+>/g, ' ');
  normalized = decodeHtmlEntities(normalized);
  normalized = normalized.replace(/[ \t]+/g, ' ').trim();
  normalized = normalized.replace(/(\r\n|\r|\n){2,}/g, '\n');
  return normalized;
}

// Collapse dashes/spaces between digits so that "Code: 123-456" matches as
// "Code: 123456". This only affects digit-boundary punctuation, leaving
// "Item 12-34" alone (the dash there is between letters).
function collapseDigitSeparators(text: string): string {
  return text.replace(/(\d)[- ]+(?=\d)/g, '$1');
}

export function extractOTP(subject: string | undefined, body: string | undefined): string | null {
  // 1. Block-level HTML detection. Runs on raw body before any normalization
  //    so the structural signal is preserved. High-confidence shortcut.
  if (body) {
    const blockOtp = extractFromBlockTags(body);
    if (blockOtp) return blockOtp;
  }

  // 2. Subject-first keyword patterns on normalized subject.
  const normalizedSubject = collapseDigitSeparators(normalizeSubject(subject));
  let otp = findOtpInText(normalizedSubject, true);
  if (otp) return otp;

  // 3. Body keyword patterns on normalized body.
  if (body) {
    const normalizedBody = collapseDigitSeparators(normalizeBody(body));
    otp = findOtpInText(normalizedBody, false);
    if (otp) return otp;
  }

  return null;
}

export function findOtpInText(text: string, isSubject: boolean): string | null {
  if (!text) return null;

  const patterns = [...PATTERNS];
  if (isSubject) patterns.push(SUBJECT_FALLBACK);

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const captured = match?.[1];
    if (!captured) continue;
    const normalized = normalizeOtp(captured);
    if (normalized) return normalized;
  }

  if (EXPIRY_TEST_PATTERN.test(text)) {
    const match = text.match(EXPIRY_FALLBACK_PATTERN);
    const candidate = match?.[1];
    if (candidate) {
      const normalized = normalizeOtp(candidate);
      if (normalized) return normalized;
    }
  }

  return null;
}
