import { describe, expect, it } from 'vitest';
import { friendlyError, groupBySection, hostnameOf, initialSelection, isRestrictedUrl } from './scan';
import type { PlanItem } from '@/shared/types';

const item = (fid: string, confidence: number, section = '', enabled = true): PlanItem => ({
  fid, key: 'x', label: fid, section, value: '', displayValue: '', source: 'rule', confidence, order: 0, enabled,
});

describe('popup helpers', () => {
  it('detects restricted pages', () => {
    expect(isRestrictedUrl('chrome://extensions')).toBe(true);
    expect(isRestrictedUrl('https://chromewebstore.google.com/detail/x')).toBe(true);
    expect(isRestrictedUrl('about:blank')).toBe(true);
    expect(isRestrictedUrl(undefined)).toBe(true);
    expect(isRestrictedUrl('http://bcic.teletalk.com.bd/application.php')).toBe(false);
  });
  it('extracts hostnames', () => {
    expect(hostnameOf('https://a.teletalk.com.bd/x?y')).toBe('a.teletalk.com.bd');
    expect(hostnameOf('nonsense')).toBe('');
  });
  it('unticks low-confidence items', () => {
    expect(initialSelection([item('a', 1), item('b', 0.59), item('c', 0.9, '', false)])).toEqual({ a: true, b: false, c: false });
  });
  it('groups by section with fallback', () => {
    expect(groupBySection([item('a', 1, 'S'), item('b', 1), item('c', 1, 'S')]).map(([k, v]) => [k, v.length])).toEqual([['S', 2], ['Other', 1]]);
  });
  it('maps restricted-page errors', () => {
    expect(friendlyError(new Error('Cannot access a chrome:// URL'))).toMatch(/can't be filled/);
  });
});
