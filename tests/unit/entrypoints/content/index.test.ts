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
      expect(isTabRelatedToOtp('github.com', 'noreply@github.com')).toBe(true);
      expect(isTabRelatedToOtp('sub.github.com', 'noreply@github.com')).toBe(true);
      expect(isTabRelatedToOtp('github.co.uk', 'noreply@github.com')).toBe(false);
    });

    test('ignores sender-controlled names and subjects for site matching', () => {
      expect(isTabRelatedToOtp('malicious.com', 'noreply@bank.com')).toBe(false);
      expect(isTabRelatedToOtp('attacker.com', 'noreply@github.com')).toBe(false);
      expect(isTabRelatedToOtp('amazon.com', 'noreply@delivery.com')).toBe(false);
      // R1: Substring matches should not result in false-positives
      expect(isTabRelatedToOtp('mail.com', 'noreply@gmail.com')).toBe(false);
      expect(isTabRelatedToOtp('it.com', 'noreply@digital.com')).toBe(false);
      expect(isTabRelatedToOtp('it.com', 'noreply@it-corp.com')).toBe(false);
    });

    test('keeps private-suffix tenants and IP addresses distinct', () => {
      expect(isTabRelatedToOtp('foo.github.io', 'noreply@bar.github.io')).toBe(false);
      expect(isTabRelatedToOtp('192.168.1.2', 'noreply@10.9.1.2')).toBe(false);
    });

    test('matches multi-level country-code domains exactly', () => {
      expect(isTabRelatedToOtp('shop.com.cn', 'noreply@shop.com.cn')).toBe(true);
      expect(isTabRelatedToOtp('shop.com.cn', 'noreply@evil.com')).toBe(false);
    });

    test('accepts punctuation and Markdown mailto formatting around sender addresses', () => {
      expect(isTabRelatedToOtp('example.com', 'user@example.com,')).toBe(true);
      expect(isTabRelatedToOtp('example.com', '[user@example.com](mailto:user@example.com),')).toBe(
        true
      );
    });
  });
});
