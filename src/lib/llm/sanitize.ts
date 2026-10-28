import { emptyAddress, emptyEducation, emptyJob, EDUCATION_LEVELS } from '../../shared/profile';
import type { Address, EducationLevel, EducationRecord, JobRecord, Profile } from '../../shared/types';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_KEYS = new Set(['dob', 'startDate', 'endDate']);

/** Copy the string/boolean fields named by `template` from `src`, trimming and skipping empties. */
function pick<T extends object>(src: unknown, template: T, notes?: string[]): Partial<T> {
  const out: Obj = {};
  if (!isObj(src)) return out as Partial<T>;
  for (const [k, def] of Object.entries(template)) {
    const v = src[k];
    if (typeof def === 'boolean') {
      if (typeof v === 'boolean') out[k] = v;
      continue;
    }
    const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
    if (!s) continue;
    if (DATE_KEYS.has(k) && !ISO_DATE.test(s)) {
      notes?.push(`Ignored "${k}" because "${s}" is not an ISO date (yyyy-mm-dd).`);
      continue;
    }
    if (k === 'resultScale' && s !== '4' && s !== '5') continue;
    out[k] = s;
  }
  return out as Partial<T>;
}

function sanitizeEducation(src: unknown, notes?: string[]): Profile['education'] {
  const out: Partial<Record<EducationLevel, EducationRecord>> = {};
  if (!isObj(src)) return out;
  for (const level of EDUCATION_LEVELS) {
    const rec = pick(src[level], emptyEducation(), notes);
    if (Object.keys(rec).length) out[level] = { ...emptyEducation(), ...rec };
  }
  return out;
}

function sanitizeExtra(src: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(src)) return out;
  for (const [k, v] of Object.entries(src)) if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  return out;
}

/**
 * Coerce untrusted data (LLM output or old stored data) to a Partial<Profile> containing only known fields
 * of the right type. Empty values are omitted so mergeProfile never overwrites real data with blanks.
 */
export function sanitizeProfile(raw: unknown, notes?: string[]): Partial<Profile> {
  if (!isObj(raw)) return {};
  const e = emptyProfileShape();
  const out: Partial<Profile> = {};
  const personal = pick(raw.personal, e.personal, notes);
  if (Object.keys(personal).length) out.personal = { ...e.personal, ...personal };
  const ids = pick(raw.ids, e.ids, notes);
  if (Object.keys(ids).length) out.ids = { ...e.ids, ...ids };
  const contact = pick(raw.contact, e.contact, notes);
  if (Object.keys(contact).length) out.contact = { ...e.contact, ...contact };
  Object.assign(out, pick(raw, { quota: '', quotaDetails: '', departmentalStatus: '', permanentSameAsPresent: false }));
  for (const k of ['presentAddress', 'permanentAddress'] as const) {
    const a = pick<Address>(raw[k], emptyAddress());
    if (Object.keys(a).length) out[k] = { ...emptyAddress(), ...a };
  }
  const education = sanitizeEducation(raw.education, notes);
  if (Object.keys(education).length) out.education = education;
  if (Array.isArray(raw.experience)) {
    const jobs = raw.experience
      .map((j) => pick<JobRecord>(j, emptyJob(), notes))
      .filter((j) => Object.keys(j).length)
      .map((j) => ({ ...emptyJob(), ...j }));
    if (jobs.length) out.experience = jobs;
  }
  const extra = sanitizeExtra(raw.extra);
  if (Object.keys(extra).length) out.extra = extra;
  return out;
}

function emptyProfileShape() {
  return {
    personal: {
      nameEn: '', nameBn: '', fatherEn: '', fatherBn: '', motherEn: '', motherBn: '', dob: '', gender: '',
      religion: '', nationality: '', maritalStatus: '', spouseName: '', bloodGroup: '',
    },
    ids: { nid: '', birthReg: '', passport: '' },
    contact: { mobile: '', email: '' },
  };
}
