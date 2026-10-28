/** Option lists taken from docs/teletalk-reference.md. The profile stores option *text*. */
export const GENDERS = ['Male', 'Female', 'Third Gender'] as const;
export const RELIGIONS = ['Islam', 'Hinduism', 'Buddhism', 'Christianity', 'Other'] as const;
export const MARITAL = ['Single', 'Married', 'Other'] as const;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export const QUOTAS = [
  'Child of Freedom Fighter',
  'Grand Child of Freedom Fighter',
  'Women',
  'Tribal / Ethnic Minority',
  'Physically Handicapped',
  'Ansar / VDP',
  'Orphan',
  'Not Applicable',
] as const;
export const DEPARTMENTAL = ['Govt. Employee', 'Semi-Govt. Employee', 'Autonomous Body Employee', 'Other', 'Not Applicable'] as const;

export const BOARDS = ['Barishal', 'Chattogram', 'Cumilla', 'Dhaka', 'Dinajpur', 'Jashore', 'Madrasah', 'Mymensingh', 'Rajshahi', 'Sylhet', 'Technical', 'Open University', 'Other'] as const;
export const GROUPS = ['Science', 'Humanities', 'Business Studies', 'General', 'Other'] as const;
export const EXAMS = {
  ssc: ['S.S.C', 'Dakhil', 'S.S.C Vocational', 'O Level/Cambridge', 'S.S.C Equivalent', 'Dakhil Vocational'],
  hsc: ['H.S.C', 'Alim', 'Business Management', 'Diploma-in-Engineering', 'A Level', 'H.S.C Vocational', 'H.S.C Equivalent'],
  graduation: ['B.Sc Engineering', 'Honors', 'Graduation Equivalent'],
  masters: ['M.Sc', 'Masters', 'Masters Equivalent'],
} as const;
export const EMPLOYMENT_TYPES = ['Private Organization', 'Regular Basis Under Revenue Budget', 'Government', 'Semi-Government', 'Autonomous', 'NGO', 'Self-employed', 'Other'] as const;
export const DURATIONS = ['1', '1.5', '2', '3', '4', '5'] as const;
export const SCALES = [
  { value: '4', label: 'Out of 4' },
  { value: '5', label: 'Out of 5' },
] as const;

export const DOCS_PRIVACY =
  'Files you add here are sent to your configured AI provider (Gemini or an OpenAI-compatible service) using your own API key, only when you press "Extract". They are not stored by FormFillup.';
