/**
 * Text normalisation shared by the scanner, the rule matcher and option matching.
 * Pure functions, no DOM.
 */

/** Collapse whitespace and trim. */
export function squish(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Clean a label as shown to the user: collapse whitespace, drop required
 * markers ("*"), surrounding brackets ("[National ID Number]") and trailing colons.
 */
export function cleanLabel(s: string): string {
  let out = squish(s).replace(/\s*\*+\s*/g, ' ');
  out = squish(out).replace(/[:：]+$/, '').trim();
  const bracketed = /^\[(.*)\]$/.exec(out);
  if (bracketed?.[1]) out = bracketed[1].trim();
  return out;
}

/** "present_district" / "presentDistrict" / "job[0][job_start_date]" -> "present district", "job 0 job start date". */
export function humanizeIdentifier(s: string): string {
  return squish(
    s
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_\-[\].]+/g, ' ')
      .toLowerCase(),
  );
}

/**
 * Lower-cased text for synonym matching. Keeps word boundaries (spaces), folds
 * dotted abbreviations ("S.S.C" -> "ssc"), drops apostrophes ("father's" -> "fathers"),
 * turns other punctuation into spaces. Bangla letters are kept.
 */
export function normalizeForMatch(s: string): string {
  return squish(
    s
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .replace(/(\p{L})\.(?=\p{L})/gu, '$1')
      .replace(/['’`]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' '),
  );
}

/**
 * Compact key for equality comparisons: case, whitespace and punctuation
 * insensitive. "S.S.C" == "SSC", "GPA(out of 5)" -> "gpaoutof5", "&" == "and".
 */
export function compactKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '');
}

/** Word tokens of normalizeForMatch(). */
export function tokens(s: string): string[] {
  const n = normalizeForMatch(s);
  return n ? n.split(' ') : [];
}

/** Classic Levenshtein distance, O(n*m) time, O(m) memory. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[b.length] ?? Math.max(a.length, b.length);
}

/** 1 for identical strings, 0 for nothing in common. */
export function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

/** Jaccard overlap of two token sets. */
export function tokenOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** True when the string contains Bangla script. */
export function hasBangla(s: string): boolean {
  return /[ঀ-৿]/.test(s);
}
