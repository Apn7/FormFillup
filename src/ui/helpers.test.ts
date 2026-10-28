import { describe, expect, it } from 'vitest';
import { emptyProfile } from '@/shared/profile';
import { checkFiles, fileToBase64, formatSize, MAX_TOTAL_BYTES, scaledSize } from './files';
import { applyReview, buildReviewRows } from './reviewDiff';
import { normalizeProfile, parseProfileJson } from './profileJson';
import { validateDateRange, validateEmail, validateMobile, validateResult, validateYear } from './validators';

describe('validators', () => {
  it('email', () => {
    expect(validateEmail('')).toBe('');
    expect(validateEmail('a@b.co')).toBe('');
    expect(validateEmail('a@b')).not.toBe('');
  });
  it('mobile', () => {
    expect(validateMobile('01712345678')).toBe('');
    expect(validateMobile('1712345678')).not.toBe('');
    expect(validateMobile('0171234567')).not.toBe('');
  });
  it('result by scale', () => {
    expect(validateResult('4.50', '4')).not.toBe('');
    expect(validateResult('4.50', '5')).toBe('');
    expect(validateResult('abc', '5')).not.toBe('');
    expect(validateResult('0.5', '5')).not.toBe('');
  });
  it('year and dates', () => {
    expect(validateYear('2018', 2026)).toBe('');
    expect(validateYear('1899', 2026)).not.toBe('');
    expect(validateYear('20', 2026)).not.toBe('');
    expect(validateDateRange('2020-01-01', '2019-01-01')).not.toBe('');
    expect(validateDateRange('2020-01-01', '')).toBe('');
  });
});

describe('files', () => {
  const f = (name: string, size: number, type = 'application/pdf') => ({ name, size, type });
  it('rejects bad type, duplicates and over-limit totals', () => {
    const r = checkFiles([f('a.pdf', MAX_TOTAL_BYTES - 10)], [f('b.txt', 5, 'text/plain'), f('a.pdf', MAX_TOTAL_BYTES - 10), f('c.png', 20, 'image/png'), f('d.png', 5, 'image/png')]);
    expect(r.accepted.map((x) => x.name)).toEqual(['d.png']);
    expect(r.errors).toHaveLength(3);
  });
  it('formats sizes', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });
  it('encodes base64 without the data prefix', async () => {
    expect(await fileToBase64(new Blob(['hello']))).toBe('aGVsbG8=');
  });
});

describe('review diff', () => {
  it('ticks only empty current values and skips unchanged/empty', () => {
    const cur = emptyProfile();
    cur.personal.nameEn = 'OLD';
    cur.personal.fatherEn = 'SAME';
    const rows = buildReviewRows(cur, {
      personal: { nameEn: 'NEW', nameBn: 'নাম', fatherEn: 'SAME', motherEn: '' } as never,
      education: { ssc: { result: '5.00' } } as never,
    });
    const by = Object.fromEntries(rows.map((r) => [r.path, r]));
    expect(by['personal.nameEn']!.checked).toBe(false);
    expect(by['personal.nameBn']!.checked).toBe(true);
    expect(by['personal.fatherEn']).toBeUndefined();
    expect(by['personal.motherEn']).toBeUndefined();
    expect(by['education.ssc.result']!.label).toMatch(/Result/);
  });
  it('applies selected rows, creating records', () => {
    const cur = emptyProfile();
    const rows = buildReviewRows(cur, {
      education: { ssc: { result: '5.00' } } as never,
      experience: [{ designation: 'Dev' }] as never,
      extra: { skype: 'x' },
    });
    const next = applyReview(cur, rows, new Set(rows.map((r) => r.path)));
    expect(next.education.ssc?.result).toBe('5.00');
    expect(next.education.ssc?.board).toBe('');
    expect(next.experience[0]?.designation).toBe('Dev');
    expect(next.experience[0]?.currentlyWorking).toBe(false);
    expect(next.extra.skype).toBe('x');
    expect(cur.extra.skype).toBeUndefined();
  });
});

describe('profile json', () => {
  it('rejects junk and accepts a profile', () => {
    expect(() => parseProfileJson('nope')).toThrow(/valid JSON/);
    expect(() => parseProfileJson('[]')).toThrow();
    expect(() => parseProfileJson('{"foo":1}')).toThrow(/FormFillup/);
    expect(() => parseProfileJson('{"personal":{"nameEn":5}}')).toThrow(/text/);
    expect(parseProfileJson(JSON.stringify(emptyProfile())).schemaVersion).toBe(1);
  });
  it('normalizes partial records', () => {
    const p = normalizeProfile({ ...emptyProfile(), education: { ssc: { roll: '1' } as never }, experience: [{ designation: 'x' } as never] });
    expect(p.education.ssc?.board).toBe('');
    expect(p.experience[0]?.endDate).toBe('');
  });
});

describe('scaledSize', () => {
  it('caps the longest edge and keeps aspect ratio', () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(scaledSize(3000, 4000)).toEqual({ width: 1500, height: 2000 });
  });
  it('never upscales small images', () => {
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});
