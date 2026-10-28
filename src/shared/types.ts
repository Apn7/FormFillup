/**
 * Shared contracts. Every module codes against these types; change them only
 * with care, since the engine, the UI and the LLM layer all depend on them.
 */

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/** Free-text values are stored as a human would type/read them ("Dhaka", "Islam").
 *  The filler matches them against select option *text*, never against site-specific codes. */
export interface Address {
  careOf: string;
  village: string; // Village / Road / House / Flat
  district: string;
  upazila: string; // Upazila / Police Station
  postOffice: string;
  postCode: string;
}

export type ResultScale = '4' | '5';

export interface EducationRecord {
  exam: string; // "S.S.C", "Dakhil", "H.S.C", "Honors", "B.Sc Engineering", "M.Sc" ...
  board: string; // SSC/HSC: "Dhaka", "Madrasah" ... (empty for university levels)
  institute: string; // university / institute name (graduation and above)
  roll: string;
  registration: string;
  group: string; // SSC/HSC group: "Science", "Humanities", "Business Studies"
  subject: string; // graduation and above: "Computer Science & Engineering"
  resultScale: ResultScale | ''; // GPA/CGPA out of 4 or 5
  result: string; // "5.00", "3.75"
  passingYear: string; // "2018"
  durationYears: string; // "4"
}

export interface JobRecord {
  employmentType: string; // "Private Organization", "Regular Basis Under Revenue Budget" ...
  designation: string;
  organization: string;
  officeAddress: string;
  startDate: string; // ISO yyyy-mm-dd
  endDate: string; // ISO yyyy-mm-dd, empty when currentlyWorking
  currentlyWorking: boolean;
  description: string;
}

export type EducationLevel = 'ssc' | 'hsc' | 'graduation' | 'masters';

export interface Profile {
  schemaVersion: 1;
  personal: {
    nameEn: string;
    nameBn: string;
    fatherEn: string;
    fatherBn: string;
    motherEn: string;
    motherBn: string;
    dob: string; // ISO yyyy-mm-dd, always. Filler converts to the site's format.
    gender: string; // "Male" | "Female" | "Third Gender"
    religion: string;
    nationality: string;
    maritalStatus: string; // "Single" | "Married" | "Other"
    spouseName: string;
    bloodGroup: string;
  };
  ids: {
    nid: string;
    birthReg: string;
    passport: string;
  };
  contact: {
    mobile: string; // 11-digit local format, e.g. 017XXXXXXXX
    email: string;
  };
  quota: string; // "Not Applicable", "Child of Freedom Fighter" ...
  quotaDetails: string;
  departmentalStatus: string; // "Not Applicable", "Govt. Employee" ...
  presentAddress: Address;
  permanentAddress: Address;
  permanentSameAsPresent: boolean;
  education: Partial<Record<EducationLevel, EducationRecord>>;
  experience: JobRecord[];
  /** User-defined extra key/value pairs, addressable as `extra.<key>`. */
  extra: Record<string, string>;
}

/**
 * Dotted path into Profile, e.g. "personal.nameEn", "education.ssc.board",
 * "experience.0.designation", "extra.skype". Also the derived keys listed in
 * DERIVED_KEYS (computed by the engine, not stored).
 */
export type ProfileKey = string;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type LlmProvider = 'gemini' | 'openai-compatible' | 'none';

export interface Settings {
  llm: {
    provider: LlmProvider;
    apiKey: string;
    model: string; // e.g. "gemini-flash-latest"; free-tier model names change, so it is user-editable
    baseUrl: string; // only for openai-compatible (Groq, OpenRouter, local Ollama ...)
  };
  /** Ask the LLM to map fields the rules could not. Only field metadata is sent, never profile values. */
  useLlmForMapping: boolean;
  /** Ms to wait for dependent dropdowns (district -> upazila) to populate. */
  dependentFieldTimeoutMs: number;
}

// ---------------------------------------------------------------------------
// Page scanning / matching / filling
// ---------------------------------------------------------------------------

export interface FieldOption {
  value: string;
  text: string;
}

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'email'
  | 'tel'
  | 'date'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'file'
  | 'other';

/** Everything the scanner learned about one form control. Serializable. */
export interface FieldDescriptor {
  /** Stable id within one scan: "ff-<n>". Also written to the element as data-ff-id. */
  fid: string;
  kind: FieldKind;
  name: string;
  id: string;
  label: string; // best label text found (label[for], wrapping label, aria, nearby text)
  placeholder: string;
  section: string; // nearest fieldset legend / heading text
  autocomplete: string;
  options?: FieldOption[]; // select options, or radio group choices
  maxLength?: number;
  min?: string;
  max?: string;
  required: boolean;
  visible: boolean;
  currentValue: string;
}

export type MatchSource = 'site' | 'cache' | 'rule' | 'llm' | 'user';

export interface FieldMapping {
  fid: string;
  key: ProfileKey | null;
  source: MatchSource;
  confidence: number; // 0..1
}

/** One proposed fill, shown in the preview before anything is written to the page. */
export interface PlanItem {
  fid: string;
  key: ProfileKey;
  label: string; // field label for display
  section: string;
  value: string; // resolved, site-ready value (option value for selects, "true"/"false" for checkboxes)
  displayValue: string; // what the user sees (option text etc.)
  source: MatchSource;
  confidence: number;
  /** Fill ordering: parents (district, exam, "has NID") first. Lower runs first. */
  order: number;
  /** Item is filled only after this fid has been filled and its dependents have loaded. */
  dependsOn?: string;
  enabled: boolean; // user can untick in the preview
}

export interface PreviewResult {
  url: string;
  fields: FieldDescriptor[];
  plan: PlanItem[];
  /** Fields with no mapping or no profile value, for the "missing info" list. */
  unmatched: { fid: string; label: string; section: string; reason: string }[];
  llmUsed: boolean;
  warnings: string[];
}

export type FillStatus = 'filled' | 'unchanged' | 'skipped' | 'failed';

export interface FillReportItem {
  fid: string;
  key: ProfileKey;
  status: FillStatus;
  reason?: string;
}

export interface FillReport {
  items: FillReportItem[];
  filled: number;
  failed: number;
}

/** Per-site learned mappings, keyed by origin + field signature, so repeat visits skip the LLM. */
export interface SiteMappingCache {
  [origin: string]: { [fieldSignature: string]: { key: ProfileKey; source: MatchSource; updatedAt: number } };
}
