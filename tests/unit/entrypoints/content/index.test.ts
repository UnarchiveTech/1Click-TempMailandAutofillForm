import { describe, expect, test } from 'bun:test';
import { getDomainName, isTabRelatedToOtp } from '@/entrypoints/content/index';

describe('content script domain helpers', () => {
  describe('getDomainName', () => {
    test('extracts domain name from simple hostnames', () => {
      expect(getDomainName('github.com')).toBe('github');
      expect(getDomainName('example.org')).toBe('example');
      expect(getDomainName('localhost')).toBe('localhost');
    });

    test('extracts domain name from subdomains', () => {
      expect(getDomainName('sub.example.com')).toBe('example');
      expect(getDomainName('deep.sub.domain.github.com')).toBe('github');
    });

    test('extracts domain name from multi-level TLDs', () => {
      expect(getDomainName('example.co.uk')).toBe('example');
      expect(getDomainName('sub.domain.example.co.jp')).toBe('example');
    });
  });

  describe('isTabRelatedToOtp', () => {
    test('returns true when current domain matches sender email domain', () => {
      expect(isTabRelatedToOtp('github.com', 'noreply@github.com', '', '')).toBe(true);
      expect(isTabRelatedToOtp('sub.github.com', 'noreply@github.com', '', '')).toBe(true);
      expect(isTabRelatedToOtp('github.co.uk', 'noreply@github.com', '', '')).toBe(true);
    });

    test('returns true when current domain name matches sender name', () => {
      expect(isTabRelatedToOtp('netflix.com', 'noreply@secure.com', 'Netflix Team', '')).toBe(true);
      expect(isTabRelatedToOtp('sub.netflix.com', 'info@service.com', 'Netflix Support', '')).toBe(
        true
      );
    });

    test('returns true when current domain name is in subject', () => {
      expect(
        isTabRelatedToOtp('amazon.com', 'noreply@delivery.com', 'Store', 'Your Amazon OTP')
      ).toBe(true);
    });

    test('returns false when current domain is completely unrelated', () => {
      expect(
        isTabRelatedToOtp('malicious.com', 'noreply@bank.com', 'Bank Security', 'Your OTP')
      ).toBe(false);
      expect(isTabRelatedToOtp('attacker.com', 'noreply@github.com', 'GitHub', 'Your code')).toBe(
        false
      );
      // R1: Substring matches should not result in false-positives
      expect(isTabRelatedToOtp('mail.com', 'noreply@gmail.com', '', '')).toBe(false);
      expect(isTabRelatedToOtp('it.com', 'noreply@digital.com', 'Digital Corp', 'Welcome')).toBe(
        false
      );
      expect(isTabRelatedToOtp('it.com', 'noreply@it-corp.com', 'IT Corp', 'Your code')).toBe(true);
    });
  });
});
