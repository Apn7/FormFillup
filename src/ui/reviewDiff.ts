import type { Profile } from '@/shared/types';
import { profileKeyCatalog } from '@/shared/profile';
import { setPath } from './paths';

export interface ReviewRow {
  path: string;
  label: string;
  current: string;
  extracted: string;
  /** Default tick: only when the current value is empty. */
  checked: boolean;
  /** Raw extracted value to apply (string or boolean). */
  value: string | boolean;
}

function flatten(v: unknown, prefix: string, out: [string, string | boolean][]): void {
  if (v == null) return;
  if (typeof v === 'string' || typeof v === 'boolean') out.push([prefix, v]);
  else if (typeof v === 'number') out.push([prefix, String(v)]);
  else if (Array.isArray(v)) v.forEach((x, i) => flatten(x, `${prefix}.${i}`, out));
  else if (typeof v === 'object')
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
}

function read(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const p of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

const show = (v: unknown): string => (v === undefined || v === null ? '' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));

let labels: Map<string, string> | null = null;
export function labelFor(path: string): string {
  labels ??= new Map(profileKeyCatalog(10).map((k) => [k.key, k.label]));
  const known = labels.get(path);
  if (known) return known;
  if (path.startsWith('extra.')) return `Extra: ${path.slice(6)}`;
  return path;
}

/** Compare an extracted partial profile against the current one. Empty extracted values and unchanged values are dropped. */
export function buildReviewRows(current: Profile, extracted: Partial<Profile>): ReviewRow[] {
  const flat: [string, string | boolean][] = [];
  flatten(extracted, '', flat);
  const rows: ReviewRow[] = [];
  for (const [path, value] of flat) {
    if (path === 'schemaVersion') continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    const cur = read(current, path);
    const curStr = show(cur);
    const exStr = show(value);
    if (curStr === exStr) continue;
    rows.push({ path, label: labelFor(path), current: curStr, extracted: exStr, checked: curStr === '' || cur === false, value });
  }
  return rows;
}

/** Apply the selected rows onto a copy of the current profile. */
export function applyReview(current: Profile, rows: ReviewRow[], selected: ReadonlySet<string>): Profile {
  const next = structuredClone(current);
  for (const r of rows) if (selected.has(r.path)) setPath(next, r.path, r.value);
  return next;
}
