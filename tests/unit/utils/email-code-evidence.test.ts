import { describe, expect, test } from 'bun:test';
import { extractOTP } from '@/entrypoints/background/parsing/otp.js';
import {
  assessOtpEvidence,
  classifyEmailCodes,
  extractCouponCode,
} from '@/utils/otp/email-code-evidence.js';

describe('message code evidence', () => {
  test('parenthesized local phone numbers do not become possible OTPs', () => {
    for (const body of ['Tel: (123) 4567', '(123) 4567']) {
      expect(classifyEmailCodes('Verification help', body, '1234567')).toMatchObject({
        otp: null,
        otpCandidate: null,
      });
      expect(extractOTP('Verification help', `<div>${body}</div>`)).toBeNull();
    }
    expect(extractOTP('', 'Your verification code: (482901)')).toBe('482901');
  });
  for (const duration of [
    '24 horas',
    '18 months',
    '24horas',
    '18months',
    '12 meses',
    '1234 segundos',
    '12 Stunden',
    '12 heures',
    '24小时',
    '24時間',
    '24 ชั่วโมง',
    '24 ساعة',
  ]) {
    test(`duration ${duration} is neither an OTP nor an uncertain candidate`, () => {
      const candidate = duration.replace(/\s/g, '');
      expect(extractOTP('Verification notice', `<div>${duration}</div>`)).toBeNull();
      const classification = classifyEmailCodes('Verification notice', duration, candidate);
      expect(classification.otp).toBeNull();
      expect(classification.otpCandidate).toBeNull();
    });
  }
  for (const body of [
    'Phone: 1234',
    'Phone: 123456',
    'Teléfono: 12345678',
    'Call us: +1 (202) 555-0199',
    'Phone: 020 1234 5678',
    '<a href="tel:123456"><span>123456</span></a>',
    '<a href="te&#108;&#58;123456">123456</a>',
    '<a href="TEL:+12025550199">202 555 0199</a>',
  ]) {
    test(`telephone is not verification evidence: ${body}`, () => {
      expect(extractOTP('Verification help', body)).toBeNull();
      for (const candidate of ['123456', '12345678', '5550199']) {
        if (body.includes(candidate)) {
          expect(classifyEmailCodes('Verification help', body, candidate)).toMatchObject({
            otp: null,
            otpCandidate: null,
          });
        }
      }
    });
  }
  test('a telephone or duration does not hide a later genuine code, even when digits repeat', () => {
    expect(
      extractOTP(
        'Verification',
        '<a href="tel:482901">482901</a><p>Your verification code: 482901</p>'
      )
    ).toBe('482901');
    expect(extractOTP('', 'Valid for 24 horas. Your verification code: 482901')).toBe('482901');
    expect(
      classifyEmailCodes('Verification', 'Your code: 482901. Phone: 482901', '482901').otp
    ).toBe('482901');
    expect(extractOTP('', 'Your verification code: 12345678')).toBe('12345678');
  });
  test('promotions can have a Deal badge without inventing a coupon or OTP', () => {
    expect(classifyEmailCodes('Oferta especial', 'Ahorra un 20% en tu pedido', null)).toMatchObject(
      { isDeal: true, couponCode: null, otp: null }
    );
    expect(
      classifyEmailCodes('Your verification code', 'Your code is 482901', '482901').isDeal
    ).toBe(false);
    expect(classifyEmailCodes('Coupon', 'Coupon code: SAVE20', null).isDeal).toBe(true);
  });
  for (const prose of [
    '#20 off',
    '20off',
    '20on',
    '20th November 2026',
    '20 Nov - 24 Dec 2026',
    '5 pm - 6 pm',
    '3h . Ago',
    '3h Ago',
    'group1\ngroup2\ngroup3\ngroup4',
  ]) {
    test(`does not turn ${JSON.stringify(prose)} into an OTP`, () => {
      expect(extractOTP(prose, '')).toBeNull();
      expect(extractOTP('', prose)).toBeNull();
      expect(extractOTP('', `<div>${prose}</div>`)).toBeNull();
    });
  }
  test('rejects sequential repeated prefixes even near generic code prose', () => {
    expect(
      extractOTP('', '<p>Group codes</p><div>group1</div><div>group2</div><div>group3</div>')
    ).toBeNull();
    expect(extractOTP('', 'Your verification code: group1')).toBe('group1');
  });
  test('an invalid first match cannot hide a later actual code', () => {
    expect(extractOTP('', 'Code: 20off. Your verification code: 482901')).toBe('482901');
  });
  test('keeps valid mixed codes and a year-shaped explicitly labelled code', () => {
    expect(classifyEmailCodes('Your code: 2026', '', '2026').otp).toBe('2026');
    expect(classifyEmailCodes('', '認証コード: AB12CD', 'AB12CD').otp).toBe('AB12CD');
  });
  test('cached or AI-reported years in calendar context are rejected even near OTP wording', () => {
    expect(
      classifyEmailCodes('OTP expiry', 'Expires on 20th November 2026', '2026').otp
    ).toBeNull();
    expect(
      classifyEmailCodes('OTP expiry', 'Expires on 20th November 2026', '2026').otpCandidate
    ).toBeNull();
    expect(classifyEmailCodes('Your code: 2026', 'Expires on 20th November 2026', '2026').otp).toBe(
      '2026'
    );
  });
  test('unrecognized language and unlabelled codes are manual candidates', () => {
    expect(classifyEmailCodes('', '482901', '482901')).toMatchObject({
      otp: null,
      otpCandidate: '482901',
    });
    expect(assessOtpEvidence('', 'কোড: 482901', '482901')).toBe('uncertain');
  });
  const coupons = [
    'Coupon code: SAVE20',
    'Rabattcode: SPAREN20',
    'Code promo : ETE20',
    'Código de descuento: AHORRA20',
    'رمز الخصم: SALE20',
    'クーポンコード: SALE20',
    '优惠码：SALE20',
    'รหัสส่วนลด: SALE20',
  ];
  for (const text of coupons)
    test(`separates coupon ${text}`, () => {
      const coupon = extractCouponCode('', text);
      expect(coupon).toBeTruthy();
      expect(classifyEmailCodes('', text, coupon)).toMatchObject({
        couponCode: coupon,
        otp: null,
        otpCandidate: null,
      });
      expect(extractOTP('', text)).toBeNull();
    });
  test('coupon and actual OTP may coexist in one message', () => {
    const text = 'Coupon code: SAVE20. Your verification code: 482901';
    expect(extractOTP('', text)).toBe('482901');
    expect(classifyEmailCodes('', text, '482901')).toMatchObject({
      otp: '482901',
      couponCode: 'SAVE20',
    });
  });
  test('discount amounts and coupon instructions alone do not invent coupons', () => {
    expect(extractCouponCode('20% off', 'Save today')).toBeUndefined();
    expect(extractCouponCode('', 'Your coupon code is below')).toBeUndefined();
  });
  test('recognizes use-code promotions and rejects every labelled coupon, not just the first', () => {
    expect(extractCouponCode('20% off', 'Use code SAVE20')).toBe('SAVE20');
    expect(extractOTP('', 'Coupon code: SAVE20. Voucher code: DEAL25')).toBeNull();
  });
  for (const subject of [
    'Appointment reminder',
    'Erinnerung',
    'Rappel',
    'Recordatorio',
    'تذكير',
    'リマインダー',
    '提醒',
    'แจ้งเตือน',
  ])
    test(`recognizes reminder ${subject}`, () => {
      expect(classifyEmailCodes(subject, '', null).isReminder).toBe(true);
    });
  test('does not call routine verification or marketing a reminder', () => {
    expect(
      classifyEmailCodes('Your verification code', 'Never share this code', '482901').isReminder
    ).toBe(false);
    expect(classifyEmailCodes('Sale', 'Special offers today', null).isReminder).toBe(false);
  });
});
