/**
 * Value resolution: profile key + field descriptor -> site-ready value.
 *
 * Profile values are stored the way a person writes them ("Chittagong",
 * "1998-04-21", "5"); this module turns them into what a specific control
 * accepts (option value "60" for "Chattogram", "21/04/1998", "GPA(out of 5)").
 */
import type { FieldDescriptor, FieldOption, Profile, ProfileKey } from '@/shared/types';
import { getByPath } from '@/shared/profile';
import { areAliases } from './aliases';
import { compactKey, levenshtein, normalizeForMatch, similarity, tokenOverlap } from './text';

/** Keys the engine computes beyond DERIVED_KEYS (used by autocomplete rules). */
export const ENGINE_EXTRA_KEYS = {
  'personal.givenName': 'Given name (from full English name)',
  'personal.familyName': 'Family name (from full English name)',
} as const;

export type ValueTransform = 'uppercase' | ((value: string) => string);

export interface ResolveContext {
  /** Applied to free-text values (e.g. Teletalk wants English names uppercase). */
  transform?: ValueTransform;
  /**
   * The field is a dependent dropdown whose options load after its parent is
   * filled: when no option matches yet, keep the profile text and let the
   * filler match it against the populated options.
   */
  allowDeferredOption?: boolean;
}

export type Resolution =
  | {
      ok: true;
      value: string;
      displayValue: string;
      /** How sure the value is right for this control (1 exact, lower for fuzzy option matches). */
      confidence: number;
      warnings: string[];
      /** Option matching postponed until the dependent dropdown is populated. */
      deferred?: boolean;
    }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Reading the profile
// ---------------------------------------------------------------------------

function nonEmpty(s: string | undefined): boolean {
  return !!s && s.trim() !== '';
}

function hasEducation(profile: Profile, level: 'masters' | 'graduation' | 'hsc' | 'ssc'): boolean {
  const r = profile.education[level];
  return !!r && (nonEmpty(r.exam) || nonEmpty(r.institute) || nonEmpty(r.result));
}

function splitName(full: string): { given: string; family: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { given: parts[0] ?? '', family: '' };
  return { given: parts.slice(0, -1).join(' '), family: parts[parts.length - 1] ?? '' };
}

const DERIVED: Record<string, (p: Profile) => string | boolean> = {
  'ids.hasNid': (p) => nonEmpty(p.ids.nid),
  'ids.hasBirthReg': (p) => nonEmpty(p.ids.birthReg),
  'ids.hasPassport': (p) => nonEmpty(p.ids.passport),
  'contact.mobileConfirm': (p) => p.contact.mobile,
  'education.masters.applicable': (p) => hasEducation(p, 'masters'),
  'experience.applicable': (p) =>
    p.experience.some((j) => nonEmpty(j.designation) || nonEmpty(j.organization)),
  'personal.givenName': (p) => splitName(p.personal.nameEn).given,
  'personal.familyName': (p) => splitName(p.personal.nameEn).family,
};

/** Raw profile value as a string ("true"/"false" for booleans), or undefined when empty/missing. */
export function readProfileValue(profile: Profile, key: ProfileKey): string | undefined {
  const derive = DERIVED[key];
  let raw = derive ? derive(profile) : getByPath(profile, key);
  // "Permanent same as present": sites without that checkbox get the present address.
  if ((raw === undefined || raw === '') && profile.permanentSameAsPresent && key.startsWith('permanentAddress.')) {
    raw = getByPath(profile, key.replace(/^permanentAddress\./, 'presentAddress.'));
  }
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (typeof raw === 'string') return raw.trim() === '' ? undefined : raw.trim();
  return undefined;
}

export function isDateKey(key: ProfileKey): boolean {
  return key === 'personal.dob' || /^experience\.\d+\.(startDate|endDate)$/.test(key);
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export function resolveValue(
  profile: Profile,
  key: ProfileKey,
  field: FieldDescriptor,
  ctx: ResolveContext = {},
): Resolution {
  const raw = readProfileValue(profile, key);
  if (raw === undefined) return { ok: false, reason: 'no profile value' };

  switch (field.kind) {
    case 'checkbox': {
      const on = toBool(raw);
      return ok(on ? 'true' : 'false', on ? 'Checked' : 'Unchecked');
    }
    case 'select':
    case 'radio':
      return resolveChoice(raw, field, ctx);
    case 'file':
      return { ok: false, reason: 'file upload: attach manually' };
    case 'date':
      return resolveDateInput(raw, field);
    case 'number':
      return resolveNumber(raw, key, field);
    case 'tel':
      return resolveText(normalizePhone(raw, field.maxLength), field, ctx);
    default:
      if (isDateKey(key)) return resolveDateText(raw, field);
      return resolveText(raw, field, ctx);
  }
}

function ok(value: string, displayValue = value, confidence = 1, warnings: string[] = []): Resolution {
  return { ok: true, value, displayValue, confidence, warnings };
}

export function toBool(raw: string): boolean {
  return /^(true|yes|y|1|on|checked|হ্যাঁ)$/i.test(raw.trim());
}

function applyTransform(v: string, t: ValueTransform | undefined): string {
  if (!t) return v;
  return t === 'uppercase' ? v.toUpperCase() : t(v);
}

function resolveText(raw: string, field: FieldDescriptor, ctx: ResolveContext): Resolution {
  let value = applyTransform(raw, ctx.transform);
  const warnings: string[] = [];
  if (field.maxLength && value.length > field.maxLength) {
    warnings.push(`value truncated to ${field.maxLength} characters (was ${value.length})`);
    value = value.slice(0, field.maxLength);
  }
  return ok(value, value, 1, warnings);
}

function resolveNumber(raw: string, key: ProfileKey, field: FieldDescriptor): Resolution {
  // ID numbers are often written grouped ("1234 567 890", "1234-567-890").
  const cleaned = raw.replace(key.startsWith('ids.') ? /[\s,-]/g : /[\s,]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return { ok: false, reason: `not a number: ${raw}` };
  const warnings: string[] = [];
  const n = Number(cleaned);
  if (field.min !== undefined && field.min !== '' && n < Number(field.min)) warnings.push(`${cleaned} is below the field minimum ${field.min}`);
  if (field.max !== undefined && field.max !== '' && n > Number(field.max)) warnings.push(`${cleaned} is above the field maximum ${field.max}`);
  if (field.maxLength && cleaned.length > field.maxLength) {
    warnings.push(`${cleaned.length} digits but the field allows ${field.maxLength}`);
  }
  return ok(cleaned, cleaned, 1, warnings);
}

/** Bangladeshi mobile numbers: "+880 1712-345678" -> "01712345678" when the field only fits the local form. */
export function normalizePhone(raw: string, maxLength?: number): string {
  const compact = raw.replace(/[\s\-().]/g, '');
  const intl = /^(?:\+|00)?880(1\d{9})$/.exec(compact);
  if (intl?.[1] && maxLength !== undefined && maxLength < compact.length) return `0${intl[1]}`;
  return compact;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Accepts ISO yyyy-mm-dd (canonical) and, leniently, dd/mm/yyyy or dd-mm-yyyy. */
export function parseLooseDate(raw: string): { y: number; m: number; d: number } | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  const parts = m
    ? { y: +m[1]!, m: +m[2]!, d: +m[3]! }
    : (m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(s))
      ? { y: +m[3]!, m: +m[2]!, d: +m[1]! }
      : null;
  if (!parts || parts.m < 1 || parts.m > 12 || parts.d < 1 || parts.d > 31) return null;
  return parts;
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

function toIso(p: { y: number; m: number; d: number }): string {
  return `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}`;
}

/** Date format named in a placeholder or label, e.g. "DD/MM/YYYY" or "yyyy-mm-dd". */
export function inferDateFormat(field: Pick<FieldDescriptor, 'placeholder' | 'label'>): string | null {
  const re = /\b(dd?|mm?m?|yyyy|yy)([/\-. ])(dd?|mm?m?|yyyy|yy)\2(dd?|mm?m?|yyyy|yy)\b/i;
  for (const src of [field.placeholder, field.label]) {
    const m = re.exec(src);
    if (m) return m[0];
  }
  return null;
}

export function formatDate(iso: string, format: string): string {
  const p = parseLooseDate(iso);
  if (!p) return iso;
  return format.replace(/yyyy|yy|mmm|mm|m|dd|d/gi, (tok) => {
    switch (tok.toLowerCase()) {
      case 'yyyy':
        return pad(p.y, 4);
      case 'yy':
        return pad(p.y % 100);
      case 'mmm':
        return MONTHS[p.m - 1] ?? '';
      case 'mm':
        return pad(p.m);
      case 'm':
        return String(p.m);
      case 'dd':
        return pad(p.d);
      default:
        return String(p.d);
    }
  });
}

function resolveDateInput(raw: string, field: FieldDescriptor): Resolution {
  const p = parseLooseDate(raw);
  if (!p) return { ok: false, reason: `not a date: ${raw}` };
  const iso = toIso(p);
  const warnings: string[] = [];
  if (field.min && iso < field.min) warnings.push(`${iso} is before the earliest allowed date ${field.min}`);
  if (field.max && iso > field.max) warnings.push(`${iso} is after the latest allowed date ${field.max}`);
  return ok(iso, iso, 1, warnings);
}

function resolveDateText(raw: string, field: FieldDescriptor): Resolution {
  const p = parseLooseDate(raw);
  if (!p) return { ok: false, reason: `not a date: ${raw}` };
  const fmt = inferDateFormat(field);
  const value = formatDate(toIso(p), fmt ?? 'DD/MM/YYYY');
  return ok(value, value, fmt ? 1 : 0.8, fmt ? [] : ['date format not stated by the page; used DD/MM/YYYY']);
}

// ---------------------------------------------------------------------------
// Selects and radio groups
// ---------------------------------------------------------------------------

/** Options with an empty value are "Select…" placeholders, never a real answer. */
export function realOptions(options: FieldOption[] | undefined): FieldOption[] {
  return (options ?? []).filter((o) => o.value !== '');
}

function resolveChoice(raw: string, field: FieldDescriptor, ctx: ResolveContext): Resolution {
  const wanted = raw === 'true' ? 'Yes' : raw === 'false' ? 'No' : raw;
  const match = matchOption(realOptions(field.options), wanted);
  if (match) {
    const warnings = match.confidence < 0.85 ? [`"${raw}" matched approximately to "${match.option.text}"`] : [];
    return ok(match.option.value, match.option.text, match.confidence, warnings);
  }
  if (ctx.allowDeferredOption) {
    return { ok: true, value: wanted, displayValue: wanted, confidence: 0.85, warnings: [], deferred: true };
  }
  return { ok: false, reason: `option not found: ${raw}` };
}

export interface OptionMatch {
  option: FieldOption;
  confidence: number;
  how: 'exact' | 'value' | 'alias' | 'number' | 'contains' | 'fuzzy';
}

const OPTION_STOPWORDS = new Set(['upazila', 'thana', 'district', 'zila', 'zilla', 'board', 'ps', 'the', 'of', 'and']);

function contentTokens(s: string): string[] {
  return normalizeForMatch(s)
    .split(' ')
    .filter((t) => t && !OPTION_STOPWORDS.has(t));
}

function numbersIn(s: string): number[] {
  return (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

/**
 * Find the option that means `wanted`. Strategies in decreasing confidence:
 * exact normalized text, equal option value, alias table, single equal number
 * ("04 Years" for "4", "GPA(out of 5)" for "5"), token containment, fuzzy.
 */
export function matchOption(options: FieldOption[], wanted: string): OptionMatch | null {
  const w = wanted.trim();
  if (!w || !options.length) return null;
  const wKey = compactKey(w);

  const exact = options.find((o) => compactKey(o.text) === wKey);
  if (exact) return { option: exact, confidence: 1, how: 'exact' };

  const byValue = options.find((o) => o.value.trim() === w);
  if (byValue) return { option: byValue, confidence: 0.95, how: 'value' };

  const alias = options.find((o) => areAliases(o.text, w));
  if (alias) return { option: alias, confidence: 0.95, how: 'alias' };

  if (/^\d+(\.\d+)?$/.test(w)) {
    const n = Number(w);
    const hits = options.filter((o) => {
      const nums = numbersIn(o.text);
      return nums.length === 1 && nums[0] === n;
    });
    // Prefer the plain form: "03 Years" over "3+ Years".
    hits.sort((a, b) => Number(/\+/.test(a.text)) - Number(/\+/.test(b.text)) || a.text.length - b.text.length);
    if (hits[0]) return { option: hits[0], confidence: 0.9, how: 'number' };
  }

  const wTokens = contentTokens(w);
  if (wTokens.length) {
    const contains = options.filter((o) => {
      const oTokens = contentTokens(o.text);
      if (!oTokens.length) return false;
      const oSet = new Set(oTokens);
      const wSet = new Set(wTokens);
      return wTokens.every((t) => oSet.has(t)) || oTokens.every((t) => wSet.has(t));
    });
    if (contains.length) {
      contains.sort((a, b) => similarity(compactKey(b.text), wKey) - similarity(compactKey(a.text), wKey));
      return { option: contains[0]!, confidence: contains.length === 1 ? 0.8 : 0.65, how: 'contains' };
    }
  }

  return fuzzyOption(options, w);
}

const FUZZY_THRESHOLD = 0.8;

function fuzzyOption(options: FieldOption[], wanted: string): OptionMatch | null {
  const wKey = compactKey(wanted);
  const wTokens = contentTokens(wanted);
  const scored = options
    .map((o) => {
      const oKey = compactKey(o.text);
      const editScore = wKey.length >= 4 ? similarity(oKey, wKey) : levenshtein(oKey, wKey) === 0 ? 1 : 0;
      return { o, score: Math.max(editScore, tokenOverlap(contentTokens(o.text), wTokens)) };
    })
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (!best || best.score < FUZZY_THRESHOLD) return null;
  if (second && best.score - second.score < 0.05) return null; // ambiguous
  return { option: best.o, confidence: Math.min(0.75, 0.5 + (best.score - FUZZY_THRESHOLD) * 1.25), how: 'fuzzy' };
}
