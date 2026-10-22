/** Pure label matching owned by the worker; never calls the content bridge. */
import type { FormFieldKind } from '@/features/intelligence/types.js';

const FIELD_PATTERNS: ReadonlyArray<{
  kind: FormFieldKind;
  confidence: number;
  pattern: RegExp;
}> = [
  {
    kind: 'email',
    confidence: 0.95,
    pattern: /\be[ -]?mail\b|\bmail\s*address\b|correo|courriel|メール|邮箱|電子郵件|อีเมล|بريد/iu,
  },
  {
    kind: 'password',
    confidence: 0.95,
    pattern:
      /\b(?:password|passwd|pwd|passcode)\b|contraseña|mot\s+de\s+passe|passwort|パスワード|密码|密碼|รหัสผ่าน|كلمة\s*المرور/iu,
  },
  {
    kind: 'username',
    confidence: 0.9,
    pattern:
      /\b(?:user\s*name|user\s*id|handle|nickname|login\s*name|account\s*name)\b|nombre\s+de\s+usuario|nom\s+d.utilisateur|benutzername|ユーザー名|用户名|用戶名|ชื่อผู้ใช้|اسم\s*المستخدم/iu,
  },
  {
    kind: 'phone',
    confidence: 0.9,
    pattern:
      /\b(?:phone|mobile|cell|tel|telephone|téléphone|telefon|teléfono)\b|電話|手机|手機|โทรศัพท์|هاتف/iu,
  },
  {
    kind: 'firstName',
    confidence: 0.9,
    pattern: /\b(?:first\s*name|given\s*name|fname|prénom|vorname)\b|ชื่อจริง|الاسم\s*الأول/iu,
  },
  {
    kind: 'lastName',
    confidence: 0.9,
    pattern:
      /\b(?:last\s*name|family\s*name|lname|surname|apellido|nachname)\b|nom\s+de\s+famille|นามสกุล|اسم\s*العائلة/iu,
  },
  {
    kind: 'fullName',
    confidence: 0.8,
    pattern: /^(?:full\s*name|name|nombre|nom|名前|姓名|ชื่อ|الاسم)$/iu,
  },
  { kind: 'website', confidence: 0.85, pattern: /\b(?:website|url|homepage|site\s+web)\b/iu },
  {
    kind: 'dob',
    confidence: 0.85,
    pattern: /\b(?:birth|birthday|dob|geburtsdatum)\b|生年月日|出生日期|วันเกิด|تاريخ\s*الميلاد/iu,
  },
  {
    kind: 'gender',
    confidence: 0.85,
    pattern: /\b(?:gender|sex|género|geschlecht)\b|性別|性别|เพศ|الجنس/iu,
  },
  {
    kind: 'country',
    confidence: 0.85,
    pattern: /\b(?:country|nation|país|pays|land)\b|国|国家|ประเทศ|البلد/iu,
  },
  {
    kind: 'city',
    confidence: 0.85,
    pattern: /\b(?:city|town|ciudad|ville|stadt)\b|市区町村|城市|เมือง|المدينة/iu,
  },
  {
    kind: 'state',
    confidence: 0.8,
    pattern: /\b(?:state|province|region|région|bundesland)\b|都道府県|จังหวัด|الولاية/iu,
  },
  {
    kind: 'pin',
    confidence: 0.9,
    pattern:
      /\b(?:zip|postal|post\s*code|pin\s*code)\b|郵便番号|邮政编码|รหัสไปรษณีย์|الرمز\s*البريدي/iu,
  },
  {
    kind: 'address',
    confidence: 0.8,
    pattern: /\b(?:address|street|adresse|dirección|strasse|straße)\b|住所|地址|ที่อยู่|العنوان/iu,
  },
  {
    kind: 'profilePicture',
    confidence: 0.8,
    pattern: /\b(?:avatar|profile\s*(?:picture|photo)|upload\s*(?:picture|photo))\b/iu,
  },
  {
    kind: 'terms',
    confidence: 0.85,
    pattern: /\b(?:terms|conditions|agree|consent)\b|利用規約|条款|เงื่อนไข|الشروط/iu,
  },
];

export function matchKindFromText(
  text: string
): { kind: FormFieldKind; confidence: number } | null {
  const normalized = text
    .normalize('NFKC')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!normalized) return null;
  for (const { kind, confidence, pattern } of FIELD_PATTERNS) {
    if (pattern.test(normalized)) return { kind, confidence };
  }
  return null;
}
