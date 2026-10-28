/**
 * Teletalk government job portals (<org>.teletalk.com.bd/<org><yyyymm>/application.php).
 * Field names, order and dependencies follow docs/teletalk-reference.md and
 * Teletalk's own premium autofill script (names uppercase; parents before the
 * fields their inline onchange/onclick handlers reveal or populate).
 */
import type { AdapterMapping, AdapterResult, ParentValue, SiteAdapter } from './types';

type Entry = Omit<AdapterMapping, 'order'> & { order: number };

const yes = (p: ParentValue): boolean => p.value === '1' || /^yes$/i.test(p.displayValue);
const checked = (p: ParentValue): boolean => p.value === 'true';
const unchecked = (p: ParentValue): boolean => p.value !== 'true';
/** main.js onChangeId(): quota codes 1, 2, 3 and 6 reveal quota_details. */
const quotaNeedsDetails = (p: ParentValue): boolean => ['1', '2', '3', '6'].includes(p.value);
/** main.js onChangeResult(): GPA/CGPA out of 4 or 5 reveal the numeric result input. */
const gpaScale = (p: ParentValue): boolean => p.value === '4' || p.value === '5';
const married = (p: ParentValue): boolean => p.value === 'Married' || /married/i.test(p.displayValue);

const UPPER = { transform: 'uppercase' } as const;

function educationEntries(prefix: 'ssc' | 'hsc', level: 'ssc' | 'hsc', base: number): Record<string, Entry> {
  return {
    [`${prefix}_exam`]: { key: `education.${level}.exam`, order: base },
    [`${prefix}_board`]: { key: `education.${level}.board`, order: base + 1 },
    [`${prefix}_roll`]: { key: `education.${level}.roll`, order: base + 2 },
    [`${prefix}_result_type`]: { key: `education.${level}.resultScale`, order: base + 3 },
    [`${prefix}_result`]: {
      key: `education.${level}.result`,
      order: base + 4,
      dependsOn: `${prefix}_result_type`,
      activeWhen: gpaScale,
    },
    [`${prefix}_year`]: { key: `education.${level}.passingYear`, order: base + 5 },
    [`${prefix}_group`]: { key: `education.${level}.group`, order: base + 6, dependsOn: `${prefix}_exam` },
  };
}

function degreeEntries(
  prefix: 'gra' | 'mas',
  level: 'graduation' | 'masters',
  base: number,
  gate?: string,
): Record<string, Entry> {
  const gated = gate ? { dependsOn: gate, activeWhen: checked } : {};
  return {
    [`${prefix}_exam`]: { key: `education.${level}.exam`, order: base, ...gated },
    [`${prefix}_institute`]: { key: `education.${level}.institute`, order: base + 1, ...gated },
    [`${prefix}_result_type`]: { key: `education.${level}.resultScale`, order: base + 2, ...gated },
    [`${prefix}_result`]: {
      key: `education.${level}.result`,
      order: base + 3,
      dependsOn: `${prefix}_result_type`,
      activeWhen: gpaScale,
    },
    [`${prefix}_year`]: { key: `education.${level}.passingYear`, order: base + 4, ...gated },
    [`${prefix}_duration`]: { key: `education.${level}.durationYears`, order: base + 5, ...gated },
    // gra_subject is repopulated by onChangeExamTypeGRA; mas_subject is static (onChangeMasExam is a no-op).
    [`${prefix}_subject`]: {
      key: `education.${level}.subject`,
      order: base + 6,
      ...(prefix === 'gra' ? { dependsOn: 'gra_exam' } : gated),
    },
  };
}

function addressEntries(kind: 'present' | 'permanent', base: number): Record<string, Entry> {
  const key = kind === 'present' ? 'presentAddress' : 'permanentAddress';
  // Permanent fields are copied and disabled by onOffSameAsBtn when "same as present" is ticked.
  const gated = kind === 'permanent' ? { dependsOn: 'same_as_present', activeWhen: unchecked } : {};
  return {
    [`${kind}_careof`]: { key: `${key}.careOf`, order: base, ...gated },
    [`${kind}_village`]: { key: `${key}.village`, order: base + 1, ...gated },
    [`${kind}_district`]: { key: `${key}.district`, order: base + 2, ...gated },
    [`${kind}_upazila`]: { key: `${key}.upazila`, order: base + 3, dependsOn: `${kind}_district` },
    [`${kind}_post`]: { key: `${key}.postOffice`, order: base + 4, ...gated },
    [`${kind}_postcode`]: { key: `${key}.postCode`, order: base + 5, ...gated },
  };
}

/** Exact mappings by `name`. Order follows Teletalk's autofill.js. */
export const TELETALK_FIELDS: Readonly<Record<string, Entry>> = {
  name: { key: 'personal.nameEn', order: 10, ...UPPER },
  name_bn: { key: 'personal.nameBn', order: 11 },
  father: { key: 'personal.fatherEn', order: 12, ...UPPER },
  father_bn: { key: 'personal.fatherBn', order: 13 },
  mother: { key: 'personal.motherEn', order: 14, ...UPPER },
  mother_bn: { key: 'personal.motherBn', order: 15 },
  dob: { key: 'personal.dob', order: 16 },
  nationality: { key: 'personal.nationality', order: 17 },
  religion: { key: 'personal.religion', order: 18 },
  gender: { key: 'personal.gender', order: 19 },
  nid: { key: 'ids.hasNid', order: 20 },
  nid_no: { key: 'ids.nid', order: 21, dependsOn: 'nid', activeWhen: yes },
  breg: { key: 'ids.hasBirthReg', order: 22 },
  breg_no: { key: 'ids.birthReg', order: 23, dependsOn: 'breg', activeWhen: yes },
  passport: { key: 'ids.hasPassport', order: 24 },
  passport_no: { key: 'ids.passport', order: 25, dependsOn: 'passport', activeWhen: yes, ...UPPER },
  marital_status: { key: 'personal.maritalStatus', order: 26 },
  spouse_name: { key: 'personal.spouseName', order: 27, dependsOn: 'marital_status', activeWhen: married, ...UPPER },
  mobile: { key: 'contact.mobile', order: 28 },
  confirm_mobile: { key: 'contact.mobileConfirm', order: 29 },
  email: { key: 'contact.email', order: 30 },
  quota: { key: 'quota', order: 31 },
  quota_details: { key: 'quotaDetails', order: 32, dependsOn: 'quota', activeWhen: quotaNeedsDetails },
  dep_status: { key: 'departmentalStatus', order: 33 },
  ...addressEntries('present', 40),
  // onOffSameAsBtn validates the present address (alert() when incomplete), so it runs after it.
  same_as_present: { key: 'permanentSameAsPresent', order: 50 },
  ...addressEntries('permanent', 51),
  ...educationEntries('ssc', 'ssc', 60),
  ...educationEntries('hsc', 'hsc', 70),
  ...degreeEntries('gra', 'graduation', 80),
  if_applicable_mas: { key: 'education.masters.applicable', order: 90 },
  ...degreeEntries('mas', 'masters', 91, 'if_applicable_mas'),
  if_applicable_exp: { key: 'experience.applicable', order: 100 },
};

/** job[n][field] -> JobRecord field. */
const JOB_FIELDS: Readonly<Record<string, { field: string; offset: number }>> = {
  employment_type: { field: 'employmentType', offset: 0 },
  designation: { field: 'designation', offset: 1 },
  organization: { field: 'organization', offset: 2 },
  office_address: { field: 'officeAddress', offset: 3 },
  job_start_date: { field: 'startDate', offset: 4 },
  // currentlyWorking() sets the end date to today and disables it, so it runs before job_end_date.
  currently_working: { field: 'currentlyWorking', offset: 5 },
  job_end_date: { field: 'endDate', offset: 6 },
  job_description: { field: 'description', offset: 7 },
};

/** Never filled: free-text "Other" companions, captcha, the declaration, Teletalk system fields. */
const IGNORED = /^(.+_other|captcha|agree|alljobs_id|unique_id|CAPTCHA_ACTUAL|post_code|post_name|ad_ref_no|age_calculated|total_job_exp.*|ssc_hsc_data_mismatch|is_allowed_result|.+_result_eq|(ssc|hsc)_(reg|verified))$/;

function mapJobField(name: string): AdapterResult {
  const m = /^job\[(\d+)\]\[(\w+)\]$/.exec(name);
  if (!m) return null;
  const index = Number(m[1]);
  const def = JOB_FIELDS[m[2] ?? ''];
  if (!def) return { ignore: 'job helper field' };
  const order = 101 + index * 10 + def.offset;
  const key = `experience.${index}.${def.field}`;
  if (def.field === 'endDate') {
    return { key, order, dependsOn: `job[${index}][currently_working]`, activeWhen: unchecked };
  }
  return { key, order, dependsOn: 'if_applicable_exp', activeWhen: checked };
}

export const teletalkAdapter: SiteAdapter = {
  id: 'teletalk',
  matches(url, doc) {
    return (
      /(^|\.)teletalk\.com\.bd$/i.test(url.hostname) &&
      !!doc.querySelector('form#applicationForm, form[action$="preview.php"]')
    );
  },
  map(field) {
    const name = field.name;
    if (!name) return null;
    if (IGNORED.test(name)) return { ignore: 'not filled automatically' };
    const entry = TELETALK_FIELDS[name];
    if (entry) return entry;
    return mapJobField(name);
  },
};
