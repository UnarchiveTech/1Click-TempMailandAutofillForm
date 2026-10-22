/**
 * Multilingual conflict-detection regexes.
 * Isolated to allow background-only loading (keeps ~64K of regex patterns
 * out of the content-script bundle).
 */

export const CONFLICT_RE =
  /already\s+(been\s+)?(taken|used|registered|exists)|email\s+(is\s+)?(taken|in\s+use|already)|account\s+already|user\s+already|not\s+accepted|disposable|temporary\s+email|blocked\s+domain|invalid\s+email|cannot\s+use|not\s+allowed/i;

export const USERNAME_CONFLICT_RE =
  /username\s+(is\s+)?(taken|unavailable|already|not\s+available|not\s+allowed|invalid|in\s+use)|user\s*name\s+(already|taken|exists|unavailable|not\s+allowed|invalid)|(?:already\s+(?:been\s+)?(?:taken|used|registered)|is\s+taken|not\s+available|not\s+allowed|is\s+invalid|not\s+permitted).{0,60}user\s*name|(?:user\s*name).{0,40}(?:already|taken|exists|unavailable|not\s+allowed|invalid)|login\s+(is\s+)?taken|handle\s+(is\s+)?(taken|unavailable)|that\s+username|this\s+username|choose\s+another\s+username|try\s+another\s+username|pick\s+a\s+different\s+username|username\s+must|invalid\s+username|username\s+contains|username\s+too|please\s+enter\s+a\s+(different|new)\s+username|name\s+is\s+not\s+available|not\s+an\s+allowed\s+username|username\s+not\s+allowed|display\s*name\s+(taken|unavailable)|nom\s+d['']utilisateur.*(?:pris|existe|invalide)|usuario\s+(?:ya\s+)?(?:existe|tomado|no\s+disponible)|benutzername.*(?:vergeben|ungültig|nicht)|ユーザー名.*(使用|無効|利用|既に)|用户名.*(已|无效|不可|占用)|ชื่อผู้ใช้.*(มี|ใช้|ไม่)|اسم\s*المستخدم.*(مستخدم|غير|موجود)/i;

export const OTP_FAIL_RE =
  /invalid\s+(code|otp|verification)|incorrect\s+(code|otp)|code\s+(is\s+)?(wrong|invalid|expired)|otp\s+(failed|invalid|expired)|verification\s+(failed|expired)|try\s+again|didn['']t\s+match|does\s+not\s+match|code\s+expired|wrong\s+code/i;

/** Specific field failures must precede the generic "already taken" fallback. */
export function classifyConflictText(text: string): 'email' | 'username' | 'otp' | null {
  if (USERNAME_CONFLICT_RE.test(text)) return 'username';
  if (OTP_FAIL_RE.test(text)) return 'otp';
  return CONFLICT_RE.test(text) ? 'email' : null;
}
