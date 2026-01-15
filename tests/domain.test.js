import { describe, it, expect } from 'vitest';
import { isIPAddress, getDomain, getShortName, TWO_PART_TLDS } from '../lib/domain.js';

describe('isIPAddress', () => {
  it('returns true for IPv4 addresses', () => {
    expect(isIPAddress('192.168.1.1')).toBe(true);
    expect(isIPAddress('10.0.0.1')).toBe(true);
    expect(isIPAddress('255.255.255.255')).toBe(true);
    expect(isIPAddress('127.0.0.1')).toBe(true);
  });

  it('returns true for IPv6 addresses', () => {
    expect(isIPAddress('::1')).toBe(true);
    expect(isIPAddress('2001:db8::1')).toBe(true);
    expect(isIPAddress('fe80::1')).toBe(true);
  });

  it('returns false for hostnames', () => {
    expect(isIPAddress('google.com')).toBe(false);
    expect(isIPAddress('localhost')).toBe(false);
    expect(isIPAddress('mail.google.com')).toBe(false);
  });
});

describe('getDomain', () => {
  it('extracts domain from simple URLs', () => {
    expect(getDomain('https://google.com/search')).toBe('google.com');
    expect(getDomain('https://example.org')).toBe('example.org');
    expect(getDomain('http://github.io')).toBe('github.io');
  });

  it('strips subdomains', () => {
    expect(getDomain('https://mail.google.com')).toBe('google.com');
    expect(getDomain('https://docs.google.com')).toBe('google.com');
    expect(getDomain('https://sub.sub.example.com')).toBe('example.com');
    expect(getDomain('https://www.github.com')).toBe('github.com');
  });

  it('handles two-part TLDs correctly', () => {
    expect(getDomain('https://bbc.co.uk')).toBe('bbc.co.uk');
    expect(getDomain('https://www.bbc.co.uk')).toBe('bbc.co.uk');
    expect(getDomain('https://news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(getDomain('https://example.com.au')).toBe('example.com.au');
    expect(getDomain('https://sub.example.co.jp')).toBe('example.co.jp');
  });

  it('preserves IP addresses', () => {
    expect(getDomain('http://192.168.1.1:8080/path')).toBe('192.168.1.1');
    expect(getDomain('http://10.0.0.1')).toBe('10.0.0.1');
    expect(getDomain('http://127.0.0.1/test')).toBe('127.0.0.1');
  });

  it('returns null for invalid URLs', () => {
    expect(getDomain('not-a-url')).toBe(null);
    expect(getDomain('')).toBe(null);
    expect(getDomain('ftp://incomplete')).toBe('incomplete');
  });

  it('handles edge cases', () => {
    expect(getDomain('https://localhost')).toBe('localhost');
    expect(getDomain('https://co.uk')).toBe('co.uk');
  });

  it('converts hostname to lowercase', () => {
    expect(getDomain('https://GOOGLE.COM')).toBe('google.com');
    expect(getDomain('https://Mail.Google.Com')).toBe('google.com');
  });
});

describe('getShortName', () => {
  it('strips common TLDs', () => {
    expect(getShortName('google.com')).toBe('google');
    expect(getShortName('github.io')).toBe('github');
    expect(getShortName('example.org')).toBe('example');
  });

  it('handles two-part TLDs', () => {
    expect(getShortName('bbc.co.uk')).toBe('bbc');
    expect(getShortName('example.com.au')).toBe('example');
    expect(getShortName('test.co.jp')).toBe('test');
  });

  it('preserves IP addresses', () => {
    expect(getShortName('192.168.1.1')).toBe('192.168.1.1');
    expect(getShortName('10.0.0.1')).toBe('10.0.0.1');
  });

  it('handles multi-level domains', () => {
    expect(getShortName('sub.example.com')).toBe('sub.example');
    expect(getShortName('deep.sub.example.com')).toBe('deep.sub.example');
  });

  it('handles single-part domains', () => {
    expect(getShortName('localhost')).toBe('localhost');
  });
});

describe('TWO_PART_TLDS', () => {
  it('contains expected TLDs', () => {
    expect(TWO_PART_TLDS).toContain('co.uk');
    expect(TWO_PART_TLDS).toContain('com.au');
    expect(TWO_PART_TLDS).toContain('co.jp');
  });
});
