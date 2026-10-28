import type { Address, EducationLevel, EducationRecord, JobRecord, Profile, ProfileKey } from './types';

export const EDUCATION_LEVELS: EducationLevel[] = ['ssc', 'hsc', 'graduation', 'masters'];

export const EDUCATION_LEVEL_LABELS: Record<EducationLevel, string> = {
  ssc: 'SSC / Equivalent',
  hsc: 'HSC / Equivalent',
  graduation: 'Graduation / Equivalent',
  masters: 'Masters / Equivalent',
};

export function emptyAddress(): Address {
  return { careOf: '', village: '', district: '', upazila: '', postOffice: '', postCode: '' };
}

export function emptyEducation(): EducationRecord {
  return {
    exam: '',
    board: '',
    institute: '',
    roll: '',
    registration: '',
    group: '',
    subject: '',
    resultScale: '',
    result: '',
    passingYear: '',
    durationYears: '',
  };
}

export function emptyJob(): JobRecord {
  return {
    employmentType: '',
    designation: '',
    organization: '',
    officeAddress: '',
    startDate: '',
    endDate: '',
    currentlyWorking: false,
    description: '',
  };
}

export function emptyProfile(): Profile {
  return {
    schemaVersion: 1,
    personal: {
      nameEn: '',
      nameBn: '',
      fatherEn: '',
      fatherBn: '',
      motherEn: '',
      motherBn: '',
      dob: '',
      gender: '',
      religion: '',
      nationality: 'Bangladeshi',
      maritalStatus: '',
      spouseName: '',
      bloodGroup: '',
    },
    ids: { nid: '', birthReg: '', passport: '' },
    contact: { mobile: '', email: '' },
    quota: '',
    quotaDetails: '',
    departmentalStatus: '',
    presentAddress: emptyAddress(),
    permanentAddress: emptyAddress(),
    permanentSameAsPresent: false,
    education: {},
    experience: [],
    extra: {},
  };
}

/**
 * Keys computed by the engine from stored data rather than stored directly.
 * They drive "Yes/No" selects that reveal a dependent input (e.g. Teletalk's
 * `nid` select reveals `nid_no`).
 */
export const DERIVED_KEYS = {
  'ids.hasNid': 'Has National ID (Yes/No)',
  'ids.hasBirthReg': 'Has Birth Registration (Yes/No)',
  'ids.hasPassport': 'Has Passport (Yes/No)',
  'contact.mobileConfirm': 'Mobile number (confirmation field)',
  'education.masters.applicable': 'Has Masters (checkbox)',
  'experience.applicable': 'Has job experience (checkbox)',
} as const satisfies Record<string, string>;

const ADDRESS_LABELS: Record<keyof Address, string> = {
  careOf: 'Care of',
  village: 'Village / Road / House / Flat',
  district: 'District',
  upazila: 'Upazila / Police Station',
  postOffice: 'Post office',
  postCode: 'Post code',
};

const EDUCATION_LABELS: Record<keyof EducationRecord, string> = {
  exam: 'Examination / Degree',
  board: 'Board',
  institute: 'University / Institute',
  roll: 'Roll no',
  registration: 'Registration no',
  group: 'Group',
  subject: 'Subject',
  resultScale: 'Result scale (GPA/CGPA out of 4 or 5)',
  result: 'Result (GPA/CGPA)',
  passingYear: 'Passing year',
  durationYears: 'Course duration (years)',
};

const JOB_LABELS: Record<keyof JobRecord, string> = {
  employmentType: 'Employment type',
  designation: 'Designation / Post',
  organization: 'Organization',
  officeAddress: 'Office address',
  startDate: 'Start date',
  endDate: 'End date',
  currentlyWorking: 'Currently working',
  description: 'Job description',
};

/**
 * Every addressable profile key with a human label. The UI renders from it,
 * the LLM mapper sends it as the list of allowed targets, and the engine
 * validates keys against it. Experience keys are generated for the first
 * `maxJobs` entries.
 */
export function profileKeyCatalog(maxJobs = 3): { key: ProfileKey; label: string }[] {
  const out: { key: ProfileKey; label: string }[] = [
    { key: 'personal.nameEn', label: "Applicant's full name (English)" },
    { key: 'personal.nameBn', label: "Applicant's full name (Bangla)" },
    { key: 'personal.fatherEn', label: "Father's name (English)" },
    { key: 'personal.fatherBn', label: "Father's name (Bangla)" },
    { key: 'personal.motherEn', label: "Mother's name (English)" },
    { key: 'personal.motherBn', label: "Mother's name (Bangla)" },
    { key: 'personal.dob', label: 'Date of birth' },
    { key: 'personal.gender', label: 'Gender' },
    { key: 'personal.religion', label: 'Religion' },
    { key: 'personal.nationality', label: 'Nationality' },
    { key: 'personal.maritalStatus', label: 'Marital status' },
    { key: 'personal.spouseName', label: 'Spouse name' },
    { key: 'personal.bloodGroup', label: 'Blood group' },
    { key: 'ids.nid', label: 'National ID number' },
    { key: 'ids.birthReg', label: 'Birth registration number' },
    { key: 'ids.passport', label: 'Passport number' },
    { key: 'contact.mobile', label: 'Mobile number' },
    { key: 'contact.email', label: 'Email' },
    { key: 'quota', label: 'Quota' },
    { key: 'quotaDetails', label: 'Quota details' },
    { key: 'departmentalStatus', label: 'Departmental status' },
    { key: 'permanentSameAsPresent', label: 'Permanent address same as present (checkbox)' },
  ];
  for (const [prefix, title] of [
    ['presentAddress', 'Present address'],
    ['permanentAddress', 'Permanent address'],
  ] as const) {
    for (const [k, label] of Object.entries(ADDRESS_LABELS)) {
      out.push({ key: `${prefix}.${k}`, label: `${title}: ${label}` });
    }
  }
  for (const level of EDUCATION_LEVELS) {
    for (const [k, label] of Object.entries(EDUCATION_LABELS)) {
      out.push({ key: `education.${level}.${k}`, label: `${EDUCATION_LEVEL_LABELS[level]}: ${label}` });
    }
  }
  for (let i = 0; i < maxJobs; i++) {
    for (const [k, label] of Object.entries(JOB_LABELS)) {
      out.push({ key: `experience.${i}.${k}`, label: `Job ${i + 1}: ${label}` });
    }
  }
  for (const [key, label] of Object.entries(DERIVED_KEYS)) out.push({ key, label });
  return out;
}

/** Read a dotted key from a profile. Returns undefined for missing paths. Does not compute derived keys. */
export function getByPath(profile: Profile, key: ProfileKey): unknown {
  let cur: unknown = profile;
  for (const part of key.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Deep-merge `patch` into `base` without overwriting non-empty base values with empty ones. */
export function mergeProfile(base: Profile, patch: Partial<Profile>): Profile {
  const merge = (a: unknown, b: unknown): unknown => {
    if (b === undefined || b === null || b === '') return a;
    if (Array.isArray(b)) return b.length ? b : a;
    if (typeof b === 'object' && typeof a === 'object' && a && !Array.isArray(a)) {
      const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
      for (const [k, v] of Object.entries(b as Record<string, unknown>)) out[k] = merge(out[k], v);
      return out;
    }
    return b;
  };
  return merge(base, patch) as Profile;
}
