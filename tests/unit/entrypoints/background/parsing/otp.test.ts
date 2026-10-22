import { describe, expect, it } from 'bun:test';
import { extractOTP, findOtpInText } from '@/entrypoints/background/parsing/otp.js';

describe('extractOTP', () => {
  it('does not turn newsletter words, promotion codes, IPs, or postal addresses into OTPs', () => {
    expect(
      extractOTP('Code: 739201', '<div class="shipping" style="padding:12px">12543</div>')
    ).toBe('739201');
    expect(extractOTP('PM2.5 pollution report', "Today's reading is PM2.5")).toBeNull();
    expect(extractOTP('Demand up 11%', 'Shopping offers for 2026')).toBeNull();
    expect(extractOTP('60% OFF', '<p>Use code SALE60 for a discount</p>')).toBeNull();
    expect(
      extractOTP('A new device logged into your account', 'Login IP: 119.125.43.167')
    ).toBeNull();
    expect(
      extractOTP('Your order', '<pre>Content-Type: text/plain\n0 pts\nView rewards</pre>')
    ).toBeNull();
    expect(
      extractOTP('Your order', '<pre>2280 Avenue West\nMountlake Terrace, WA=\n98043\nUS</pre>')
    ).toBeNull();
    expect(extractOTP('Research report', '<div>2 min</div><div>Daily habit</div>')).toBeNull();
    expect(
      extractOTP(
        'Your temporary login code',
        '<div>Login to Example</div><pre>AB12CD</pre><p>Never share this code</p>'
      )
    ).toBe('AB12CD');
    expect(extractOTP('', '<div>AB12CD</div>')).toBe('AB12CD');
  });
  it('handles whitespace-heavy newsletters without cross-line backtracking', () => {
    const newsletter = `<div>Read the recovery interview</div>${'<div>&nbsp;</div>'.repeat(500)}`;
    const started = performance.now();
    expect(extractOTP('The recovery question nobody likes to answer', newsletter)).toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
    expect(extractOTP('', '\n\n  482901  \n\n')).toBe('482901');
    expect(findOtpInText('Order\n   482901\n', false)).toBeNull();
  });
  describe('English subjects', () => {
    it('extracts code from "Your code is 392811"', () => {
      expect(extractOTP('Your code is 392811', '')).toBe('392811');
    });

    it('extracts code from "Code: 123456"', () => {
      expect(extractOTP('', 'Your verification code: 123456')).toBe('123456');
    });

    it('extracts code from "OTP: 5678"', () => {
      expect(extractOTP('', 'Your OTP: 5678')).toBe('5678');
    });

    it('extracts code from "PIN below"', () => {
      expect(extractOTP('', 'Your PIN: 4321')).toBe('4321');
    });
  });

  describe('Subject-first preference', () => {
    it('returns subject code when body has different code', () => {
      expect(extractOTP('Code: 111111', 'Some other code: 222222')).toBe('111111');
    });
  });

  describe('HTML block fallback priority', () => {
    it('does not let an unlabelled footer year override a subject OTP', () => {
      expect(
        extractOTP('Your verification code is 739201', '<table><tr><td>2026</td></tr></table>')
      ).toBe('739201');
    });

    it('keeps an unlabelled code-only block as a last-resort fallback', () => {
      expect(extractOTP('', '<table><tr><td>482901</td></tr></table>')).toBe('482901');
    });

    it('does not treat an unlabelled footer year as an OTP', () => {
      expect(extractOTP('', '<table><tr><td>2026</td></tr></table>')).toBeNull();
    });
  });

  describe('date filtering', () => {
    it('does not treat localized month-name dates or CJK calendar dates as OTPs', () => {
      expect(extractOTP('', 'Your OTP expires on October 17, 2026')).toBeNull();
      expect(extractOTP('', 'Ihr Termin ist am 17. Oktober 2026')).toBeNull();
      expect(extractOTP('', 'Votre rendez-vous est le 17 octobre 2026')).toBeNull();
      expect(extractOTP('', 'Your account date is 2026年10月17日')).toBeNull();
      expect(extractOTP('', '계정 날짜는 2026년 10월 17일입니다')).toBeNull();
    });

    it('recognizes valid compact YYYYMMDD dates without suppressing explicitly labeled codes', () => {
      expect(extractOTP('', 'Your appointment is 20261017')).toBeNull();
      expect(extractOTP('', '<table><tr><td>20261017</td></tr></table>')).toBeNull();
      expect(extractOTP('', 'Your verification code: 20261017')).toBe('20261017');
      expect(extractOTP('Your verification code is 739201', 'Expires October 17, 2026')).toBe(
        '739201'
      );
    });
  });

  describe('HTML entity decoding', () => {
    it('decodes &amp; in subject', () => {
      expect(extractOTP('Code: 123456 &amp; expires soon', '')).toBe('123456');
    });

    it('decodes &#39; in subject', () => {
      expect(extractOTP('Code: 123456 &#x27;use it now', '')).toBe('123456');
    });

    it('decodes numeric entities in body', () => {
      expect(extractOTP('', 'Code: 123456 &#38; done')).toBe('123456');
    });

    it('decodes &nbsp; in body', () => {
      expect(extractOTP('', 'Code:&nbsp;123456')).toBe('123456');
    });
  });

  describe('HTML body normalization', () => {
    it('strips <style> and <script> blocks', () => {
      expect(
        extractOTP('', '<style>body{color:red}</style><script>alert(1)</script>Code: 999999')
      ).toBe('999999');
    });

    it('converts <br> to newlines (pattern #1 standalone)', () => {
      expect(extractOTP('', 'Header<br>123456<br>Footer')).toBe('123456');
    });

    it('decodes &nbsp; in body', () => {
      expect(extractOTP('', '<p>Code:&nbsp;123456</p>')).toBe('123456');
    });
  });

  describe('Internationalization (i18n)', () => {
    it('extracts from German "Dein Code"', () => {
      expect(extractOTP('', 'Dein Bestätigungscode: 987654')).toBe('987654');
    });

    it('extracts from French "Votre code"', () => {
      expect(extractOTP('', 'Votre code de vérification: 456123')).toBe('456123');
    });

    it('extracts from Spanish "Tu código"', () => {
      expect(extractOTP('', 'Tu código: 789012')).toBe('789012');
    });

    it('extracts from Italian "Il tuo codice"', () => {
      expect(extractOTP('', 'Il tuo codice è 345678')).toBe('345678');
    });

    it('extracts from Portuguese "Seu código"', () => {
      expect(extractOTP('', 'Seu código de verificação: 234567')).toBe('234567');
    });

    it('extracts from Dutch "Uw code"', () => {
      expect(extractOTP('', 'Uw verificatiecode: 678901')).toBe('678901');
    });

    it('extracts from Russian "Ваш код"', () => {
      expect(extractOTP('', 'Ваш код подтверждения: 567890')).toBe('567890');
    });

    it('extracts from Japanese "認証コード"', () => {
      expect(extractOTP('', 'あなたの認証コード: 890123')).toBe('890123');
    });

    it('extracts from Chinese Simplified "验证码"', () => {
      expect(extractOTP('', '您的验证码: 135790')).toBe('135790');
    });

    it('extracts from Chinese Traditional "驗證碼"', () => {
      expect(extractOTP('', '您的驗證碼: 246802')).toBe('246802');
    });

    it('extracts from Korean "인증번호"', () => {
      expect(extractOTP('', '인증번호: 112233')).toBe('112233');
    });

    it('extracts from Arabic "رمز التحقق"', () => {
      expect(extractOTP('', 'رمز التحقق: 445566')).toBe('445566');
    });

    it('extracts from Hindi "ओटीपी"', () => {
      expect(extractOTP('', 'आपका ओटीपी: 778899')).toBe('778899');
    });

    it('extracts from Turkish "Doğrulama kodu"', () => {
      expect(extractOTP('', 'Doğrulama kodunuz: 998877')).toBe('998877');
    });
  });

  describe('Length boundaries', () => {
    it('rejects 2-char code', () => {
      expect(extractOTP('', 'Code: 12')).toBeNull();
    });

    it('accepts 3-char code', () => {
      expect(extractOTP('', 'Code: 123')).toBe('123');
    });

    it('accepts 8-char code', () => {
      expect(extractOTP('', 'Code: 12345678')).toBe('12345678');
    });

    it('rejects 9-char code', () => {
      expect(extractOTP('', 'Code: 123456789')).toBeNull();
    });
  });

  describe('Dash and space stripping', () => {
    it('strips dashes from "123-456"', () => {
      expect(extractOTP('', 'Code: 123-456')).toBe('123456');
    });

    it('strips spaces from "123 456"', () => {
      expect(extractOTP('', 'Code: 123 456')).toBe('123456');
    });
  });

  describe('Negative alpha guard', () => {
    it('rejects pure-alpha word "SECRET"', () => {
      expect(extractOTP('', 'Code: SECRET')).toBeNull();
    });

    it('rejects pure-alpha word in subject', () => {
      expect(extractOTP('VERIFY', '')).toBeNull();
    });
  });

  describe('Subject-only fallback', () => {
    it('accepts 3-8 char alphanumeric subject', () => {
      expect(extractOTP('392811', '')).toBe('392811');
    });

    it('accepts alphanumeric subject "A1B2C3"', () => {
      expect(extractOTP('A1B2C3', '')).toBe('A1B2C3');
    });

    it('accepts prefixed subject "Re: 392811"', () => {
      expect(extractOTP('Re: 392811', '')).toBe('392811');
    });
  });

  describe('Expiration-language fallback', () => {
    it('extracts from "Code: 123456, valid for 10 minutes"', () => {
      expect(extractOTP('', 'Code: 123456, valid for 10 minutes')).toBe('123456');
    });

    it('extracts from German "läuft in 10 Minuten ab"', () => {
      expect(extractOTP('', 'Ihr Code: 987654, läuft in 10 Minuten ab')).toBe('987654');
    });

    it('extracts from French "expire dans"', () => {
      expect(extractOTP('', 'Code: 555444, expire dans 5 minutes')).toBe('555444');
    });

    it('extracts from Japanese "有効期限"', () => {
      expect(extractOTP('', '認証コード: 111222, 有効期限は10分です')).toBe('111222');
    });
  });

  describe('URL proximity (pattern #4)', () => {
    it('extracts code from URL after keyword', () => {
      expect(extractOTP('', 'Verify at https://example.com/123456')).toBe('123456');
    });

    it('extracts code from URL path', () => {
      expect(extractOTP('', 'Code: https://example.com/verify/789012')).toBe('789012');
    });
  });

  describe('Edge cases', () => {
    it('returns null for empty inputs', () => {
      expect(extractOTP('', '')).toBeNull();
      expect(extractOTP(undefined, undefined)).toBeNull();
    });

    it('returns null when no pattern matches', () => {
      expect(extractOTP('Hello world', 'Just a regular email, no code here.')).toBeNull();
    });

    it('returns null for phone-number-length token (10 digits)', () => {
      expect(extractOTP('', 'Code: 1234567890')).toBeNull();
    });
  });

  describe('Block-level HTML detection', () => {
    it('extracts from <div>123456</div>', () => {
      expect(extractOTP('', '<div>123456</div>')).toBe('123456');
    });

    it('extracts from <p>123456</p>', () => {
      expect(extractOTP('', '<p>123456</p>')).toBe('123456');
    });

    it('extracts from <td>123456</td>', () => {
      expect(extractOTP('', '<td>123456</td>')).toBe('123456');
    });

    it('extracts from <h1>123456</h1>', () => {
      expect(extractOTP('', '<h1>123456</h1>')).toBe('123456');
    });

    it('extracts from <strong>123456</strong>', () => {
      expect(extractOTP('', '<strong>123456</strong>')).toBe('123456');
    });

    it('extracts from <b>123456</b>', () => {
      expect(extractOTP('', '<b>123456</b>')).toBe('123456');
    });

    it('extracts from <li>123456</li>', () => {
      expect(extractOTP('', '<ul><li>123456</li></ul>')).toBe('123456');
    });

    it('handles nested inner tags', () => {
      expect(extractOTP('', '<div><span>123456</span></div>')).toBe('123456');
    });

    it('handles attributes on the block tag', () => {
      expect(extractOTP('', '<div class="otp-code" id="main">123456</div>')).toBe('123456');
    });

    it('handles whitespace inside the block tag', () => {
      expect(extractOTP('', '<div>\n  123456\n</div>')).toBe('123456');
    });

    it('strips dashes inside block content', () => {
      expect(extractOTP('', '<div>123-456</div>')).toBe('123456');
    });

    it('strips spaces inside block content', () => {
      expect(extractOTP('', '<div>123 456</div>')).toBe('123456');
    });

    it('prefers block-level over inline', () => {
      // The <div> catches the first code; the <span> later is ignored
      // because the function returns on first match.
      expect(extractOTP('', '<div>111111</div><span>222222</span>')).toBe('111111');
    });

    it('ignores inline <span> wrapper', () => {
      // <span> is not a block tag, so the block-level detector skips it
      // and falls through to the keyword/standalone patterns. "123456" is
      // also caught by pattern #1 (standalone line) after normalization.
      expect(extractOTP('', '<span>123456</span>')).toBe('123456');
    });

    it('ignores block tag whose content has no digit', () => {
      expect(extractOTP('', '<div>Hello</div>')).toBeNull();
    });

    it('ignores block tag whose content is too long', () => {
      // "Your code is 123456" is 20 chars - block-level detector skips;
      // falls through to keyword pattern which still extracts the code.
      expect(extractOTP('', '<div>Your code is 123456</div>')).toBe('123456');
    });

    it('ignores content inside HTML comments', () => {
      expect(extractOTP('', '<div><!-- 123456 --></div>')).toBeNull();
    });

    it('extracts from a real-world OTP email template', () => {
      const html = `
        <html>
          <body>
            <p>Hello,</p>
            <p>Your verification code is below.</p>
            <div class="otp-box" style="font-size: 24px;">
              <strong>847291</strong>
            </div>
            <p>This code expires in 10 minutes.</p>
          </body>
        </html>
      `;
      expect(extractOTP('', html)).toBe('847291');
    });

    it('falls through to keyword when block-level has no code', () => {
      // Block-level detector finds nothing; keyword pattern in body wins.
      const html = '<div>Hello there</div><p>Code: 999888</p>';
      expect(extractOTP('', html)).toBe('999888');
    });
  });

  describe('Order/invoice/tracking guard', () => {
    it('rejects common non-OTP number labels in other supported languages', () => {
      expect(extractOTP('Bestellnummer: 123456', '')).toBeNull();
      expect(extractOTP('Número de pedido: 123456', '')).toBeNull();
      expect(extractOTP('注文番号123456', '')).toBeNull();
    });

    it('does not let an unanchored HTML number block override a nearby localized label', () => {
      expect(extractOTP('', '<p>Bestellnummer</p><td>123456</td>')).toBeNull();
      expect(extractOTP('', '<p>Número de pedido:</p><td>123456</td>')).toBeNull();
      expect(extractOTP('', '<p>注文番号</p><td>123456</td>')).toBeNull();
    });

    it('rejects order numbers in subjects', () => {
      expect(extractOTP('Order 12345 confirmed', '')).toBeNull();
      expect(extractOTP('Order: 123456', '')).toBeNull();
      expect(extractOTP('Order #12345678', '')).toBeNull();
    });

    it('rejects invoice numbers in subjects', () => {
      expect(extractOTP('Invoice 567890', '')).toBeNull();
      expect(extractOTP('Invoice no. 567890', '')).toBeNull();
      expect(extractOTP('Invoice #567890', '')).toBeNull();
    });

    it('rejects tracking / ticket / reference numbers', () => {
      expect(extractOTP('Your tracking number is 123456', '')).toBeNull();
      expect(extractOTP('Ticket #123456', '')).toBeNull();
      expect(extractOTP('Reference: 123456', '')).toBeNull();
    });

    it('rejects the "number"/"no." forms that defeated the old guard', () => {
      expect(extractOTP('', 'Confirmation code: your order number 123456')).toBeNull();
      expect(extractOTP('', 'Your tracking number is 123456')).toBeNull();
      expect(extractOTP('', 'Invoice no. 567890')).toBeNull();
      expect(extractOTP('', 'Order is 123456')).toBeNull();
      expect(extractOTP('', 'Your account balance is 1234')).toBeNull();
    });

    it('rejects order numbers in body text too', () => {
      expect(extractOTP('', 'Order 12345 confirmed')).toBeNull();
      expect(extractOTP('', 'Your order has shipped: 123456')).toBeNull();
    });
  });

  describe('Alphanumeric codes with separators', () => {
    it('keeps letter prefixes intact (XY-4829)', () => {
      expect(extractOTP('', 'Code: XY-4829')).toBe('XY4829');
    });

    it('keeps letter prefixes intact (AB-12-34)', () => {
      expect(extractOTP('', 'Code: AB-12-34')).toBe('AB1234');
    });

    it('keeps letter prefixes in possessive form', () => {
      expect(extractOTP('', 'Your code is XY-4829')).toBe('XY4829');
    });

    it('does not merge prose words into a capture', () => {
      // "at https" must not collapse into a fake code.
      expect(extractOTP('', 'Verify at https://example.com/123456')).toBe('123456');
    });
  });

  describe('Keyword-anchored block preference', () => {
    it('prefers a keyword-adjacent block over an earlier footer number', () => {
      expect(extractOTP('', '<td>2026</td><p>Your code is</p><strong>482901</strong>')).toBe(
        '482901'
      );
    });

    it('keeps bare code blocks when no keyword exists', () => {
      expect(extractOTP('', '<div>123456</div>')).toBe('123456');
    });
  });

  describe('Standalone line ordering', () => {
    it('keyword-anchored code beats an earlier standalone numeric line', () => {
      expect(extractOTP('', 'Thank you for shopping\n2026\nYour code is 482901')).toBe('482901');
    });
  });

  describe('Proximity reference guard', () => {
    it('does not capture reference numbers in the proximity window', () => {
      expect(extractOTP('', 'Your security code is below:\nReference: 123456')).toBeNull();
    });

    it('still finds a real code after a guarded reference number', () => {
      expect(
        extractOTP('', 'Your security code is below:\nReference: 123456\nYour code: 482901')
      ).toBe('482901');
    });
  });
});

describe('findOtpInText', () => {
  it('returns null for empty text', () => {
    expect(findOtpInText('', true)).toBeNull();
    expect(findOtpInText('', false)).toBeNull();
  });

  it('subject mode picks up the bare-token fallback', () => {
    // "Re: 392811" - only subject mode has the permissive standalone
    // alphanumeric fallback. In body mode the same string is still matched
    // by pattern #1 (standalone line) since "Re: 392811" is the whole text.
    expect(findOtpInText('Re: 392811', true)).toBe('392811');
  });

  it('body mode matches keyword-anchored code', () => {
    expect(findOtpInText('Code: 123456', false)).toBe('123456');
  });

  it('body mode standalone token is caught by pattern #1', () => {
    // Pattern #1 (standalone line) is shared between subject and body.
    expect(findOtpInText('392811', false)).toBe('392811');
  });
});
