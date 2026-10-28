import type { Profile } from '@/shared/types';
import { EDUCATION_LEVELS, emptyEducation, emptyJob } from '@/shared/profile';

const SECTIONS = ['personal', 'ids', 'contact', 'presentAddress', 'permanentAddress', 'education', 'extra'] as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parse and shape-check an exported profile. Throws a readable Error; returns a Partial safe to merge. */
export function parseProfileJson(text: string): Partial<Profile> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!isObj(raw)) throw new Error('Expected a JSON object with profile data.');
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) throw new Error(`Unsupported schemaVersion ${String(raw.schemaVersion)}.`);
  if (!SECTIONS.some((s) => s in raw) && !('experience' in raw)) throw new Error('This does not look like a FormFillup profile.');
  for (const s of SECTIONS) if (s in raw && !isObj(raw[s])) throw new Error(`"${s}" must be an object.`);
  if ('experience' in raw && !Array.isArray(raw.experience)) throw new Error('"experience" must be a list.');
  for (const s of ['personal', 'ids', 'contact', 'presentAddress', 'permanentAddress', 'extra'] as const) {
    const o = raw[s];
    if (isObj(o)) for (const [k, v] of Object.entries(o)) if (typeof v !== 'string' && typeof v !== 'boolean')
      throw new Error(`"${s}.${k}" must be text.`);
  }
  return raw as Partial<Profile>;
}

/** Fill missing fields of education/job records so the editor never sees undefined. */
export function normalizeProfile(p: Profile): Profile {
  const education: Profile['education'] = {};
  for (const lvl of EDUCATION_LEVELS) {
    const r = p.education?.[lvl];
    if (r && isObj(r)) education[lvl] = { ...emptyEducation(), ...r };
  }
  return {
    ...p,
    education,
    experience: Array.isArray(p.experience) ? p.experience.map((j) => ({ ...emptyJob(), ...j })) : [],
    extra: isObj(p.extra) ? p.extra : {},
  };
}
