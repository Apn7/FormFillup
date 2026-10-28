/**
 * Generic field matcher for sites without an adapter: HTML autocomplete
 * tokens first, then a synonym dictionary (English + Bangla) over label, name,
 * id and placeholder, scoped by section (education level, present/permanent
 * address, father/mother/spouse, job index).
 *
 * The dictionary is the RULES table below: ordered most specific first; a rule
 * is a regex over normalized text plus a key (or a key template that needs a
 * scope such as the education level).
 */
import type { EducationLevel, FieldDescriptor, FieldKind, FieldMapping, ProfileKey } from '@/shared/types';
import { areAliases } from './aliases';
import { hasBangla, humanizeIdentifier, normalizeForMatch } from './text';
import { realOptions } from './values';

// ---------------------------------------------------------------------------
// Field context (scopes)
// ---------------------------------------------------------------------------

type AddressScope = 'presentAddress' | 'permanentAddress';
type Person = 'applicant' | 'father' | 'mother' | 'spouse';

export interface FieldContext {
  label: string;
  ident: string; // name + id, humanized
  placeholder: string;
  section: string;
  /** Education level and how sure we are (1 from the field itself, lower from the section). */
  level?: { value: EducationLevel; certainty: number };
  address?: { value: AddressScope; certainty: number };
  person: { value: Person; certainty: number };
  job?: { index: number; certainty: number };
  bangla: boolean;
}

// Order matters: masters before graduation (স্নাতকোত্তর contains স্নাতক), hsc before ssc (উচ্চ মাধ্যমিক).
const LEVEL_PATTERNS: [EducationLevel, RegExp][] = [
  ['masters', /\b(masters?|mas|post ?graduat\w*|postgraduate|msc|mba|mss|mcom|kamil)\b|স্নাতকোত্তর/],
  ['graduation', /\b(graduation|gra|grad|bachelors?|honou?rs|hons|bsc|bba|bss|undergraduate|fazil)\b|স্নাতক/],
  ['hsc', /\b(hsc|higher secondary|alim|a level|intermediate|diploma)\b|এইচএসসি|উচ্চ মাধ্যমিক/],
  ['ssc', /\b(ssc|secondary school|dakhil|o level|matric\w*)\b|এসএসসি|মাধ্যমিক/],
];

const ADDRESS_PATTERNS: [AddressScope, RegExp][] = [
  ['permanentAddress', /\b(permanent|home town|native)\b|স্থায়ী/],
  ['presentAddress', /\b(present|current|mailing|communication|correspondence)\b|বর্তমান/],
];

const PERSON_PATTERNS: [Person, RegExp][] = [
  ['father', /\bfathers?\b|পিতা|বাবা/],
  ['mother', /\bmothers?\b|মাতা|মায়ের/],
  ['spouse', /\b(spouses?|husbands?|wifes?|wives)\b|স্বামী|স্ত্রী/],
];

const EXPERIENCE_SECTION = /\b(experience|employment|job|work history)\b|অভিজ্ঞতা|চাকরি/;

function detect<T>(patterns: [T, RegExp][], primary: string, secondary: string): { value: T; certainty: number } | undefined {
  for (const [value, re] of patterns) if (re.test(primary)) return { value, certainty: 1 };
  for (const [value, re] of patterns) if (re.test(secondary)) return { value, certainty: 0.95 };
  return undefined;
}

export function fieldContext(field: FieldDescriptor): FieldContext {
  const label = normalizeForMatch(field.label);
  const ident = humanizeIdentifier(`${field.name} ${field.id}`);
  const placeholder = normalizeForMatch(field.placeholder);
  const section = normalizeForMatch(field.section);
  const own = `${label} ${ident} ${placeholder}`;

  const jobIdx = /\b(?:job|exp|experience|employment)\s?(\d+)\b/.exec(ident);
  const job = jobIdx?.[1]
    ? { index: Number(jobIdx[1]), certainty: 1 }
    : EXPERIENCE_SECTION.test(section)
      ? { index: 0, certainty: 0.9 }
      : undefined;

  const explicitEnglish = /\benglish\b|ইংরেজি/.test(own);
  const bangla =
    !explicitEnglish && (/\b(bangla|bengali|bn)\b|বাংলা/.test(own) || hasBangla(field.label) || hasBangla(field.placeholder));

  return {
    label,
    ident,
    placeholder,
    section,
    level: detect(LEVEL_PATTERNS, `${ident} ${label}`, section),
    address: detect(ADDRESS_PATTERNS, `${ident} ${label}`, section),
    person: detect(PERSON_PATTERNS, `${label} ${ident}`, section) ?? { value: 'applicant', certainty: 1 },
    job,
    bangla,
  };
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** Resolves to a key plus a scope certainty, or null when the needed scope is unknown. */
type KeyFn = (c: FieldContext) => { key: ProfileKey; certainty: number } | null;

interface Rule {
  key: ProfileKey | KeyFn;
  match: RegExp;
  exclude?: RegExp;
  /** Restrict to these kinds. Checkbox fields only ever match rules that list 'checkbox'. */
  kinds?: FieldKind[];
  when?: (f: FieldDescriptor) => boolean;
}

const edu =
  (field: string): KeyFn =>
  (c) =>
    c.level ? { key: `education.${c.level.value}.${field}`, certainty: c.level.certainty } : null;

/** Address fields default to the present address (with lower certainty) when unscoped. */
const addr =
  (field: string): KeyFn =>
  (c) =>
    c.address
      ? { key: `${c.address.value}.${field}`, certainty: c.address.certainty }
      : { key: `presentAddress.${field}`, certainty: 0.75 };

const job =
  (field: string): KeyFn =>
  (c) =>
    c.job ? { key: `experience.${c.job.index}.${field}`, certainty: c.job.certainty } : null;

const personName: KeyFn = (c) => {
  const lang = c.bangla ? 'Bn' : 'En';
  switch (c.person.value) {
    case 'father':
      return { key: `personal.father${lang}`, certainty: c.person.certainty };
    case 'mother':
      return { key: `personal.mother${lang}`, certainty: c.person.certainty };
    case 'spouse':
      return { key: 'personal.spouseName', certainty: c.person.certainty };
    default:
      // A bare "Name" inside a nominee / referee block is not the applicant.
      if (/nominee|guardian|reference|referee|emergency/.test(c.section)) return null;
      return { key: `personal.name${lang}`, certainty: 1 };
  }
};

const isYesNoSelect = (f: FieldDescriptor): boolean => {
  const opts = realOptions(f.options);
  return opts.length > 0 && opts.length <= 3 && opts.every((o) => areAliases(o.text, 'Yes') || areAliases(o.text, 'No'));
};

const isResultScaleSelect = (f: FieldDescriptor): boolean =>
  realOptions(f.options).some((o) => /out of|scale|division|class|grade point/i.test(o.text));

const CHOICE: FieldKind[] = ['select', 'radio'];
const NOT_CHOICE: FieldKind[] = ['text', 'number', 'tel', 'email', 'textarea', 'date', 'other'];
const DATE_LIKE: FieldKind[] = ['date', 'text'];

const NOT_A_PERSON =
  /organi[sz]ation|company|employer|institut|school|college|university|board|exam|post|user ?name|login|bank|district|village|nominee|reference|emergency|guardian|account|branch|course|subject|degree|file|প্রতিষ্ঠান|বিদ্যালয়|কলেজ/;

export const RULES: readonly Rule[] = [
  // --- names --------------------------------------------------------------
  { key: 'personal.givenName', match: /\b(first|given|fore) ?name\b/, kinds: NOT_CHOICE },
  { key: 'personal.familyName', match: /\b(last|family|sur) ?name\b|\bsurname\b/, kinds: NOT_CHOICE },
  { key: personName, match: /\bname\b|নাম/, exclude: NOT_A_PERSON, kinds: NOT_CHOICE },
  { key: 'personal.fatherEn', match: /^fathers?$/, kinds: NOT_CHOICE },
  { key: 'personal.motherEn', match: /^mothers?$/, kinds: NOT_CHOICE },

  // --- personal -----------------------------------------------------------
  {
    key: 'personal.dob',
    match: /date of birth|birth ?date|\bdob\b|\bbirthday\b|জন্ম ?তারিখ/,
    exclude: /place|registration|certificate|নিবন্ধন|স্থান/,
  },
  { key: 'personal.gender', match: /\b(gender|sex)\b|লিঙ্গ/ },
  { key: 'personal.religion', match: /\breligion\b|ধর্ম/ },
  { key: 'personal.nationality', match: /\b(nationality|citizenship)\b|জাতীয়তা/ },
  { key: 'personal.maritalStatus', match: /\b(marital|marriage)\b|বৈবাহিক/ },
  { key: 'personal.bloodGroup', match: /\bblood\b|রক্ত/ },

  // --- identity documents ("has X?" Yes/No selects before the number fields) --
  { key: 'ids.hasNid', match: /national id|\bnid\b|জাতীয় পরিচয়/, kinds: CHOICE, when: isYesNoSelect },
  { key: 'ids.hasBirthReg', match: /birth reg|birth certificate|\bbreg\b|জন্ম নিবন্ধন/, kinds: CHOICE, when: isYesNoSelect },
  { key: 'ids.hasPassport', match: /passport|পাসপোর্ট/, kinds: CHOICE, when: isYesNoSelect },
  { key: 'ids.birthReg', match: /birth reg\w*|birth certificate|\bbreg\b|\bbrn\b|জন্ম নিবন্ধন/, kinds: NOT_CHOICE },
  { key: 'ids.nid', match: /national id\w*|\bnid\b|smart card|জাতীয় পরিচয়/, kinds: NOT_CHOICE },
  { key: 'ids.passport', match: /passport|পাসপোর্ট/, exclude: /photo|size|issue|expir/, kinds: NOT_CHOICE },

  // --- contact ------------------------------------------------------------
  {
    key: 'contact.mobileConfirm',
    match: /\b(confirm|re ?enter|retype|repeat|verify)\w* (your )?(mobile|phone|cell|contact)|(mobile|phone)\w* (number )?(again|confirm\w*)|মোবাইল.*নিশ্চিত|নিশ্চিত.*মোবাইল/,
    kinds: NOT_CHOICE,
  },
  {
    key: 'contact.mobile',
    match: /\b(mobile|phone|cell ?phone|cell|contact (no|number)|tel|telephone)\b|মোবাইল|ফোন/,
    exclude: /office|emergency|guardian|father|mother|land ?line|reference|nominee/,
    kinds: NOT_CHOICE,
  },
  { key: 'contact.email', match: /\be ?mail\b|ইমেইল|ই মেইল/, kinds: NOT_CHOICE },

  // --- quota / status -----------------------------------------------------
  { key: 'quotaDetails', match: /quota \w* ?(details?|description|info\w*)|freedom fighter\w* details?/, kinds: NOT_CHOICE },
  { key: 'quota', match: /\bquota\b|কোটা/ },
  { key: 'departmentalStatus', match: /departmental|department(al)? status|বিভাগীয় প্রার্থী/ },

  // --- addresses ----------------------------------------------------------
  { key: 'permanentSameAsPresent', match: /same as (present|current|mailing)|বর্তমান ঠিকানা(র)? (মত|অনুরূপ)/, kinds: ['checkbox'] },
  { key: addr('postCode'), match: /\b(post ?code|postal ?code|zip( code)?|postcode)\b|পোস্ট ?কোড/ },
  { key: addr('postOffice'), match: /\b(post ?office|po)\b|ডাকঘর|পোস্ট অফিস/ },
  { key: addr('upazila'), match: /\b(upazila|upozila|upazilla|thana|police station|ps)\b|উপজেলা|থানা/ },
  { key: addr('district'), match: /\b(district|zila|zilla)\b|জেলা/, exclude: /উপজেলা/ },
  { key: addr('careOf'), match: /\b(care ?of|c ?o)\b|কেয়ার অফ|প্রযত্নে/, kinds: NOT_CHOICE },
  {
    key: addr('village'),
    match: /\b(village|road|house|flat|street|address line ?1?|address)\b|গ্রাম|বাসা|রাস্তা|মহল্লা|ঠিকানা/,
    exclude: /e ?mail|office|web|ip address|company|organi[sz]ation/,
    kinds: ['text', 'textarea'],
  },

  // --- education (needs a level scope) ------------------------------------
  { key: edu('resultScale'), match: /\b(result|gpa|cgpa|grade|grading|scale|division|class)\b|ফলাফল/, kinds: CHOICE, when: isResultScaleSelect },
  { key: edu('passingYear'), match: /\b(passing year|year of passing|pass(ing)? year|year)\b|পাসের (সন|সাল)/ },
  { key: edu('durationYears'), match: /\b(duration|course length|length of course)\b|মেয়াদ/ },
  { key: edu('board'), match: /\bboard\b|বোর্ড/ },
  { key: edu('roll'), match: /\broll\b|রোল/ },
  { key: edu('registration'), match: /\b(registration|reg)\b|রেজিস্ট্রেশন/ },
  { key: edu('group'), match: /\bgroup\b|গ্রুপ|বিভাগ/ },
  { key: edu('subject'), match: /\b(subject|major|discipline|concentration)\b|বিষয়/ },
  { key: edu('institute'), match: /\b(institute|institution|university|college|school)\b|প্রতিষ্ঠান|বিশ্ববিদ্যালয়/ },
  { key: edu('result'), match: /\b(result|gpa|cgpa|grade|marks?)\b|ফলাফল|জিপিএ/, kinds: NOT_CHOICE },
  { key: edu('exam'), match: /\b(examination|exam|degree|certificate)\b|পরীক্ষা|ডিগ্রি/, exclude: /year|roll|board|result/ },

  // --- experience (needs a job scope) -------------------------------------
  { key: job('currentlyWorking'), match: /\b(currently|presently|still) ?working\b|till now|continuing/, kinds: ['checkbox'] },
  { key: job('employmentType'), match: /employ(ment|ed) (type|on|status|basis)|job type|nature of (job|employment)/ },
  { key: job('designation'), match: /\b(designation|position|job title|post held|post)\b|পদবি/, exclude: /office|code/, kinds: NOT_CHOICE },
  { key: job('organization'), match: /\b(organi[sz]ation|company|employer|office name)\b|প্রতিষ্ঠান/, kinds: NOT_CHOICE },
  { key: job('officeAddress'), match: /\baddress\b|ঠিকানা/, kinds: NOT_CHOICE },
  { key: job('startDate'), match: /\b(start|from|joining|join)\b|শুরু/, kinds: DATE_LIKE },
  { key: job('endDate'), match: /\b(end|to|till|until|leaving)\b|শেষ/, kinds: DATE_LIKE },
  { key: job('description'), match: /\b(description|responsibilit\w*|duties)\b|বিবরণ/, kinds: ['text', 'textarea'] },
];

// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------

const AUTOCOMPLETE: Record<string, ProfileKey> = {
  name: 'personal.nameEn',
  'given-name': 'personal.givenName',
  'family-name': 'personal.familyName',
  email: 'contact.email',
  tel: 'contact.mobile',
  'tel-national': 'contact.mobile',
  bday: 'personal.dob',
  sex: 'personal.gender',
  'postal-code': 'presentAddress.postCode',
  'street-address': 'presentAddress.village',
  'address-line1': 'presentAddress.village',
  'address-level2': 'presentAddress.district',
  nationality: 'personal.nationality',
};

const AUTOCOMPLETE_ADDRESS_FIELDS = new Set(['postal-code', 'street-address', 'address-line1', 'address-level2']);

function matchAutocomplete(field: FieldDescriptor, ctx: FieldContext): { key: ProfileKey; confidence: number } | null {
  const tokens = field.autocomplete.split(/\s+/).filter(Boolean);
  const last = tokens[tokens.length - 1];
  if (!last) return null;
  let key = AUTOCOMPLETE[last];
  if (!key) return null;
  if (AUTOCOMPLETE_ADDRESS_FIELDS.has(last) && ctx.address?.value === 'permanentAddress') {
    key = key.replace(/^presentAddress/, 'permanentAddress');
  }
  return { key, confidence: 0.95 };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const SOURCE_WEIGHT = { label: 0.9, ident: 0.8, placeholder: 0.75 } as const;

export interface RuleMatch {
  key: ProfileKey;
  confidence: number;
}

/** Best rule match for one field, or null. */
export function matchRule(field: FieldDescriptor): RuleMatch | null {
  if (field.kind === 'file') return null;
  const ctx = fieldContext(field);
  const auto = matchAutocomplete(field, ctx);
  if (auto) return auto;

  const sources: [keyof typeof SOURCE_WEIGHT, string][] = [
    ['label', ctx.label],
    ['ident', ctx.ident],
    ['placeholder', ctx.placeholder],
  ];
  const all = `${ctx.label} ${ctx.ident} ${ctx.placeholder}`;
  let best: RuleMatch | null = null;

  for (const rule of RULES) {
    if (field.kind === 'checkbox' ? !rule.kinds?.includes('checkbox') : rule.kinds && !rule.kinds.includes(field.kind)) {
      continue;
    }
    if (rule.exclude?.test(all)) continue;
    if (rule.when && !rule.when(field)) continue;
    const src = sources.find(([, text]) => text && rule.match.test(text));
    if (!src) continue;
    const resolved = typeof rule.key === 'function' ? rule.key(ctx) : { key: rule.key, certainty: 1 };
    if (!resolved) continue;
    const confidence = Math.round(SOURCE_WEIGHT[src[0]] * resolved.certainty * 100) / 100;
    // Strictly greater: on ties the earlier (more specific) rule wins.
    if (!best || confidence > best.confidence) best = { key: resolved.key, confidence };
  }
  return best;
}

export function matchByRules(field: FieldDescriptor): FieldMapping | null {
  const m = matchRule(field);
  return m ? { fid: field.fid, key: m.key, source: 'rule', confidence: m.confidence } : null;
}
