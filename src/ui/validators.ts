/** Pure validators. Each returns an error message, or '' when the value is acceptable (empty is always acceptable). */

export function validateEmail(v: string): string {
  const s = v.trim();
  if (!s) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? '' : 'Enter a valid email address.';
}

export function validateMobile(v: string): string {
  const s = v.trim();
  if (!s) return '';
  return /^01\d{9}$/.test(s) ? '' : 'Mobile must be 11 digits and start with 01 (e.g. 01712345678).';
}

export function validateYear(v: string, now = new Date().getFullYear()): string {
  const s = v.trim();
  if (!s) return '';
  if (!/^\d{4}$/.test(s)) return 'Enter a 4-digit year.';
  const n = Number(s);
  return n >= 1950 && n <= now + 1 ? '' : `Year must be between 1950 and ${now + 1}.`;
}

export function validateResult(v: string, scale: '4' | '5' | ''): string {
  const s = v.trim();
  if (!s) return '';
  if (!/^\d(\.\d{1,2})?$/.test(s)) return 'Enter a number like 3.75.';
  const n = Number(s);
  const max = scale === '4' ? 4 : 5;
  if (n < 1 || n > max) return `Result must be between 1.00 and ${max.toFixed(2)}${scale ? '' : ' (pick a scale for a precise check)'}.`;
  return '';
}

export function validateNid(v: string): string {
  const s = v.trim();
  if (!s) return '';
  return /^(\d{10}|\d{13}|\d{17})$/.test(s) ? '' : 'NID is normally 10, 13 or 17 digits.';
}

export function validatePostCode(v: string): string {
  const s = v.trim();
  if (!s) return '';
  return /^\d{4}$/.test(s) ? '' : 'Post code is 4 digits.';
}

export function validateDuration(v: string): string {
  const s = v.trim();
  if (!s) return '';
  return /^\d(\.\d)?$/.test(s) ? '' : 'Use years, e.g. 4 or 1.5.';
}

export function validateDateRange(start: string, end: string): string {
  if (start && end && end < start) return 'End date is before the start date.';
  return '';
}
