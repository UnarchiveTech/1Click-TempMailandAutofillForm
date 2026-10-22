import type { SignupPageEvidence } from './signup-state.js';

const CREATED =
  /\b(?:your account (?:has been|was|is) (?:successfully )?created|account (?:was |has been )?created|registration (?:is |was |has been )?(?:complete|successful)|you (?:have successfully|successfully) (?:registered|signed up))\b|compte.{0,25}(?:créé|créée)|konto.{0,25}erstellt|cuenta.{0,25}creada|アカウント.{0,12}作成されました|(?:账户|帐号).{0,12}(?:已创建|创建成功)|تم إنشاء حساب|สร้างบัญชี.{0,12}สำเร็จ/i;
const CONFIRMED =
  /\b(?:your )?email(?: address)? (?:has been|was|is|is now|has now been) (?:successfully )?(?:confirmed|verified|authenticated)\b|\bemail(?: address)? confirmation (?:successful|complete)\b|adresse.{0,20}(?:confirmée|vérifiée)|e-mail.{0,25}bestätigt|correo.{0,25}confirmado|メールアドレス.{0,15}(?:確認されました|確認済み)|(?:邮箱|邮件地址).{0,12}(?:已确认|已验证)|تم تأكيد.{0,20}(?:البريد|الإيميل)|ยืนยัน.{0,15}อีเมล.{0,15}สำเร็จ/i;
const PENDING =
  /\b(?:check your (?:email|inbox)|(?:verify|confirm) your email(?: address)?|(?:verification|confirmation|activation) (?:email|link) (?:has been |was )?sent|click (?:the )?(?:verification|confirmation|activation) link|verification code|one-time password|enter (?:the )?code|confirmation code|passcode|security code|auth code|code sent|two-factor|2fa|mfa)\b|رمز التحقق|كود التأكيد|código de verificación|code de vérification|bestätigungscode|認証コード|验证码|vérifi(?:ez|er).{0,20}(?:mail|courriel)|bestätigen.{0,25}e-mail|verifica.{0,20}correo|メール.{0,12}確認してください|(?:请|請).{0,12}(?:验证|驗證|确认|確認).{0,12}(?:邮箱|郵箱|邮件)|(?:تحقق|تأكيد).{0,20}البريد|ตรวจสอบ.{0,15}อีเมล/i;
const FAILED =
  /\b(?:registration (?:failed|unsuccessful)|sign.?up failed|account creation failed|could not create (?:your )?account|unable to create (?:your )?account|email verification failed|confirmation (?:failed|expired)|invalid (?:verification|confirmation) (?:link|code)|email addresses.{0,100}not supported)\b/i;
const NEGATIVE = /\b(?:not|never|unsuccessful|failed|cannot|can't|could not|unable)\b/i;

export function isRenderedSignupElement(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true')
      return false;
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (
      style &&
      (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
    )
      return false;
    current = current.parentElement;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** Only visible page evidence counts. URLs, query strings and welcome titles do not. */
export function detectSignupPage(root: ParentNode = document): SignupPageEvidence {
  const evidence: SignupPageEvidence = {
    accountCreated: false,
    emailVerification: 'unknown',
    failed: false,
  };
  const candidates = root.querySelectorAll(
    'h1,h2,h3,h4,h5,h6,p,label,[role="heading"],[role="dialog"],[role="status"],[role="alert"],[aria-live],.success,.error,.toast,.snackbar,.mw-message-box,[class*="success" i],[class*="error" i]'
  );
  let pending = false;
  for (const element of Array.from(candidates).slice(0, 160)) {
    if (!isRenderedSignupElement(element)) continue;
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 600) continue;
    if (FAILED.test(text)) evidence.failed = true;
    if (NEGATIVE.test(text)) continue;
    if (CREATED.test(text)) evidence.accountCreated = true;
    if (CONFIRMED.test(text)) evidence.emailVerification = 'confirmed';
    if (PENDING.test(text)) pending = true;
  }
  const otpInputs = root.querySelectorAll<HTMLInputElement>(
    'input[autocomplete="one-time-code"],input[name*="otp" i],input[id*="otp" i],input[name*="verification" i],input[id*="verification" i]'
  );
  const hasCode = Array.from(otpInputs).some(
    (input) =>
      input.type !== 'hidden' &&
      !input.disabled &&
      !input.readOnly &&
      isRenderedSignupElement(input)
  );
  const hasSignupFields = Array.from(
    root.querySelectorAll<HTMLInputElement>(
      'input[type="email"],input[autocomplete="email"],input[autocomplete="username"],input[type="password"]'
    )
  ).some((input) => !input.disabled && !input.readOnly && isRenderedSignupElement(input));
  if (hasCode || (pending && (!hasSignupFields || evidence.accountCreated)))
    evidence.emailVerification = 'pending';
  return evidence;
}

export function detectSignupWizardStep(): 'form' | 'otp' | 'profile' | 'done' {
  const evidence = detectSignupPage();
  if (evidence.emailVerification === 'pending') return 'otp';
  if (!evidence.failed && (evidence.accountCreated || evidence.emailVerification === 'confirmed'))
    return 'done';
  if (
    /(?:^|\/)(?:profile|details|about-you|personal|complete-profile)(?:\/|$)/i.test(
      location.pathname
    )
  )
    return 'profile';
  return 'form';
}
