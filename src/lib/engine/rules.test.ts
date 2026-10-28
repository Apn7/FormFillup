import { describe, expect, it } from 'vitest';
import { mountGeneric } from '../../../tests/fixtures/load';
import type { FieldDescriptor } from '@/shared/types';
import { fieldContext, matchRule } from './rules';
import { scanDocument } from './scanner';

const field = (over: Partial<FieldDescriptor>): FieldDescriptor => ({
  fid: 'ff-x',
  kind: 'text',
  name: '',
  id: '',
  label: '',
  placeholder: '',
  section: '',
  autocomplete: '',
  required: false,
  visible: true,
  currentValue: '',
  ...over,
});

describe('rules on a generic form', () => {
  const EXPECTED: Record<string, string | null> = {
    fullName: 'personal.nameEn',
    contact_email: 'contact.email',
    f_name: 'personal.fatherEn',
    m_name: 'personal.motherEn',
    fbn: 'personal.fatherBn',
    birth: 'personal.dob',
    field_17: 'contact.mobile',
    cm: 'contact.mobileConfirm',
    gender: 'personal.gender',
    rel: 'personal.religion',
    ms: 'personal.maritalStatus',
    nid: 'ids.nid',
    pd: 'presentAddress.district',
    pz: 'presentAddress.upazila',
    ppc: 'presentAddress.postCode',
    perd: 'permanentAddress.district',
    perv: 'permanentAddress.village',
    edu1_board: 'education.ssc.board',
    edu1_roll: 'education.ssc.roll',
    edu1_gpa: 'education.ssc.result',
    edu1_year: 'education.ssc.passingYear',
    edu2_roll: 'education.hsc.roll',
    edu2_gpa: 'education.hsc.result',
    photo: null,
    terms: null,
  };

  it('maps every common field to the right profile key', () => {
    const { fields } = scanDocument(mountGeneric());
    const got = Object.fromEntries(
      Object.keys(EXPECTED).map((name) => {
        const f = fields.find((x) => x.name === name);
        return [name, f ? (matchRule(f)?.key ?? null) : 'NOT SCANNED'];
      }),
    );
    expect(got).toEqual(EXPECTED);
  });

  it('gives autocomplete the highest rule confidence and label matches more than name-only matches', () => {
    expect(matchRule(field({ name: 'x1', autocomplete: 'email' }))).toEqual({ key: 'contact.email', confidence: 0.95 });
    const byLabel = matchRule(field({ label: 'Email' }))!;
    const byName = matchRule(field({ name: 'email' }))!;
    expect(byLabel.confidence).toBeGreaterThan(byName.confidence);
    expect(byLabel.confidence).toBeGreaterThanOrEqual(0.85);
  });
});

describe('rule scoping', () => {
  it('scopes education fields by section and by name', () => {
    expect(matchRule(field({ label: 'Roll', section: 'HSC/Equivalent Level' }))?.key).toBe('education.hsc.roll');
    expect(matchRule(field({ label: 'Roll No', name: 'ssc_roll' }))?.key).toBe('education.ssc.roll');
    expect(matchRule(field({ label: 'Institute', section: 'Graduation' }))?.key).toBe('education.graduation.institute');
    expect(matchRule(field({ label: 'Subject', section: 'Masters / Equivalent' }))?.key).toBe('education.masters.subject');
    expect(matchRule(field({ label: 'Board' }))).toBeNull(); // no level: do not guess
  });

  it('detects result-scale selects separately from result inputs', () => {
    const scale = field({
      kind: 'select',
      label: 'Result',
      section: 'SSC',
      options: [
        { value: '', text: 'Select' },
        { value: '4', text: 'GPA(out of 4)' },
        { value: '5', text: 'GPA(out of 5)' },
      ],
    });
    expect(matchRule(scale)?.key).toBe('education.ssc.resultScale');
    expect(matchRule(field({ kind: 'number', label: 'Result', section: 'SSC' }))?.key).toBe('education.ssc.result');
  });

  it('scopes addresses and defaults unscoped ones to present with low confidence', () => {
    expect(matchRule(field({ label: 'Post Office', section: 'Permanent Address' }))?.key).toBe('permanentAddress.postOffice');
    const unscoped = matchRule(field({ label: 'District' }))!;
    expect(unscoped.key).toBe('presentAddress.district');
    expect(unscoped.confidence).toBeLessThan(0.85);
    expect(matchRule(field({ label: 'Upazila' }))?.key).toBe('presentAddress.upazila');
  });

  it('separates applicant, father, mother and spouse names, English and Bangla', () => {
    expect(matchRule(field({ label: "Applicant's Name" }))?.key).toBe('personal.nameEn');
    expect(matchRule(field({ label: 'আবেদনকারীর নাম (বাংলায়)' }))?.key).toBe('personal.nameBn');
    expect(matchRule(field({ label: 'Name', section: "Mother's Information" }))?.key).toBe('personal.motherEn');
    expect(matchRule(field({ label: 'মাতার নাম' }))?.key).toBe('personal.motherBn');
    expect(matchRule(field({ label: "Spouse's Name" }))?.key).toBe('personal.spouseName');
    expect(matchRule(field({ label: 'Name of Institute', section: 'SSC' }))?.key).toBe('education.ssc.institute');
    expect(matchRule(field({ label: 'Name', section: 'Nominee' }))).toBeNull();
  });

  it('handles Bangla labels', () => {
    expect(matchRule(field({ label: 'জন্ম তারিখ' }))?.key).toBe('personal.dob');
    expect(matchRule(field({ label: 'মোবাইল নম্বর' }))?.key).toBe('contact.mobile');
    expect(matchRule(field({ label: 'উপজেলা/থানা', section: 'স্থায়ী ঠিকানা' }))?.key).toBe('permanentAddress.upazila');
    expect(matchRule(field({ label: 'জেলা', section: 'বর্তমান ঠিকানা' }))?.key).toBe('presentAddress.district');
  });

  it('maps Yes/No identity selects to derived keys and checkboxes only to checkbox rules', () => {
    const yesNo = [
      { value: '', text: 'Select' },
      { value: '1', text: 'Yes' },
      { value: '0', text: 'No' },
    ];
    expect(matchRule(field({ kind: 'select', label: 'National ID', options: yesNo }))?.key).toBe('ids.hasNid');
    expect(matchRule(field({ kind: 'checkbox', label: 'Same as Present Address' }))?.key).toBe('permanentSameAsPresent');
    expect(matchRule(field({ kind: 'checkbox', label: 'Email me updates' }))).toBeNull();
  });

  it('indexes experience fields by job row', () => {
    expect(matchRule(field({ name: 'job[1][designation]', label: 'Designation/Post' }))?.key).toBe('experience.1.designation');
    expect(fieldContext(field({ label: 'Organization', section: 'Job Experiences' })).job?.index).toBe(0);
  });
});
