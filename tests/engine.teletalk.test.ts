import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewResult, Settings } from '@/shared/types';
import { fillPlan } from '@/lib/engine/filler';
import { buildPreview } from '@/lib/engine/planner';
import { scanDocument, type ScanResult } from '@/lib/engine/scanner';
import { TELETALK_URL, mountTeletalk, sampleProfile } from './fixtures/load';

const SETTINGS: Settings = {
  llm: { provider: 'none', apiKey: '', model: '', baseUrl: '' },
  useLlmForMapping: false,
  dependentFieldTimeoutMs: 1500,
};

/** name -> expected profile key for everything the sample profile should fill. */
const EXPECTED_PLAN: Record<string, string> = {
  name: 'personal.nameEn',
  name_bn: 'personal.nameBn',
  father: 'personal.fatherEn',
  father_bn: 'personal.fatherBn',
  mother: 'personal.motherEn',
  mother_bn: 'personal.motherBn',
  dob: 'personal.dob',
  nationality: 'personal.nationality',
  religion: 'personal.religion',
  gender: 'personal.gender',
  nid: 'ids.hasNid',
  nid_no: 'ids.nid',
  breg: 'ids.hasBirthReg',
  passport: 'ids.hasPassport',
  marital_status: 'personal.maritalStatus',
  mobile: 'contact.mobile',
  confirm_mobile: 'contact.mobileConfirm',
  email: 'contact.email',
  quota: 'quota',
  dep_status: 'departmentalStatus',
  present_careof: 'presentAddress.careOf',
  present_village: 'presentAddress.village',
  present_district: 'presentAddress.district',
  present_upazila: 'presentAddress.upazila',
  present_post: 'presentAddress.postOffice',
  present_postcode: 'presentAddress.postCode',
  same_as_present: 'permanentSameAsPresent',
  ssc_exam: 'education.ssc.exam',
  ssc_board: 'education.ssc.board',
  ssc_roll: 'education.ssc.roll',
  ssc_result_type: 'education.ssc.resultScale',
  ssc_result: 'education.ssc.result',
  ssc_year: 'education.ssc.passingYear',
  ssc_group: 'education.ssc.group',
  hsc_exam: 'education.hsc.exam',
  hsc_board: 'education.hsc.board',
  hsc_roll: 'education.hsc.roll',
  hsc_result_type: 'education.hsc.resultScale',
  hsc_result: 'education.hsc.result',
  hsc_year: 'education.hsc.passingYear',
  hsc_group: 'education.hsc.group',
  gra_exam: 'education.graduation.exam',
  gra_institute: 'education.graduation.institute',
  gra_result_type: 'education.graduation.resultScale',
  gra_result: 'education.graduation.result',
  gra_year: 'education.graduation.passingYear',
  gra_duration: 'education.graduation.durationYears',
  gra_subject: 'education.graduation.subject',
  if_applicable_mas: 'education.masters.applicable',
  if_applicable_exp: 'experience.applicable',
  'job[0][employment_type]': 'experience.0.employmentType',
  'job[0][designation]': 'experience.0.designation',
  'job[0][organization]': 'experience.0.organization',
  'job[0][office_address]': 'experience.0.officeAddress',
  'job[0][job_start_date]': 'experience.0.startDate',
  'job[0][currently_working]': 'experience.0.currentlyWorking',
  'job[0][job_description]': 'experience.0.description',
};

const val = (name: string): string =>
  (document.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement).value;
const el = (name: string): HTMLInputElement => document.querySelector(`[name="${name}"]`) as HTMLInputElement;
const selectedText = (name: string): string => {
  const s = document.querySelector(`[name="${name}"]`) as HTMLSelectElement;
  return s.options[s.selectedIndex]?.text ?? '';
};

describe('Teletalk application form, end to end', () => {
  let scan: ScanResult;
  let preview: PreviewResult;
  let alertSpy: ReturnType<typeof vi.fn<(message?: unknown) => void>>;

  beforeEach(async () => {
    mountTeletalk();
    alertSpy = vi.fn<(message?: unknown) => void>();
    window.alert = alertSpy;
    scan = scanDocument(document);
    preview = await buildPreview(document, sampleProfile(), SETTINGS, {}, undefined, { url: TELETALK_URL, scan });
  });

  const nameOf = (fid: string): string => preview.fields.find((f) => f.fid === fid)!.name;

  it('maps every expected field to the right key through the site adapter', () => {
    const planned = Object.fromEntries(preview.plan.map((i) => [nameOf(i.fid), i.key]));
    expect(planned).toEqual(EXPECTED_PLAN);
    expect(preview.plan.every((i) => i.source === 'site' && i.enabled)).toBe(true);
  });

  it('drops what does not apply and lists only the declaration as unmatched', () => {
    const names = preview.plan.map((i) => nameOf(i.fid));
    // Same-as-present: no permanent_* fields. Unmarried: no spouse. Quota N/A: no details. No masters.
    expect(names.filter((n) => /^permanent_|^spouse_name$|^quota_details$|^mas_|^breg_no$|job_end_date/.test(n))).toEqual([]);
    expect(preview.unmatched.map((u) => nameOf(u.fid))).toEqual(['agree']);
    expect(preview.warnings).toEqual([]);
  });

  it('orders parents before their dependents', () => {
    const order = new Map(preview.plan.map((i) => [i.fid, i.order]));
    for (const item of preview.plan.filter((i) => i.dependsOn)) {
      expect(order.get(item.dependsOn!)).toBeLessThan(item.order);
    }
    const pos = (n: string): number => preview.plan.findIndex((i) => nameOf(i.fid) === n);
    expect(pos('present_postcode')).toBeLessThan(pos('same_as_present'));
    expect(pos('job[0][currently_working]')).toBeGreaterThan(pos('if_applicable_exp'));
  });

  it('resolves site values: uppercase names, option values, normalized numbers', () => {
    const item = (n: string) => preview.plan.find((i) => nameOf(i.fid) === n)!;
    expect(item('name').value).toBe('RAHIM UDDIN');
    expect(item('name_bn').value).toBe('রহিম উদ্দিন');
    expect(item('religion')).toMatchObject({ value: '1', displayValue: 'Islam' });
    expect(item('marital_status')).toMatchObject({ value: 'Single' });
    expect(item('nid')).toMatchObject({ value: '1', displayValue: 'Yes' });
    expect(item('mobile').value).toBe('01712345678');
    expect(item('gra_duration')).toMatchObject({ value: '04', displayValue: '04 Years' });
    expect(item('gra_institute').displayValue).toBe('Bangladesh University of Engineering & Technology');
    expect(item('present_upazila')).toMatchObject({ value: 'Savar', displayValue: 'Savar' }); // deferred
  });

  it('fills the form in dependency order and the page reacts like the live one', async () => {
    const report = await fillPlan(preview.plan, scan.elements, SETTINGS, { root: document });
    const problems = report.items.filter((r) => r.status === 'failed' || r.status === 'skipped');
    expect(problems).toEqual([]);
    expect(report.failed).toBe(0);
    expect(alertSpy).not.toHaveBeenCalled();

    // Names uppercased, Bangla untouched.
    expect(val('name')).toBe('RAHIM UDDIN');
    expect(val('father')).toBe('KARIM UDDIN');
    expect(val('mother')).toBe('AYESHA BEGUM');
    expect(val('father_bn')).toBe('করিম উদ্দিন');
    expect(val('dob')).toBe('1998-04-21');
    expect(selectedText('religion')).toBe('Islam');
    expect(val('gender')).toBe('Male');

    // nid reveals nid_no.
    expect(val('nid')).toBe('1');
    expect(document.getElementById('nationalIdElm')!.classList.contains('hide')).toBe(false);
    expect(val('nid_no')).toBe('1234567890');
    expect(val('breg')).toBe('0');
    expect(val('marital_status')).toBe('Single');
    expect(val('mobile')).toBe('01712345678');
    expect(val('confirm_mobile')).toBe('01712345678');
    expect(selectedText('quota')).toBe('Not Applicable');

    // District populates upazila, then upazila is chosen from the new options.
    expect(selectedText('present_district')).toBe('Dhaka');
    expect(selectedText('present_upazila')).toBe('Savar');
    expect(val('present_postcode')).toBe('1340');

    // Same as present: the page copies and locks the permanent address.
    expect(el('same_as_present').checked).toBe(true);
    expect(val('permanent_district')).toBe('40');
    expect(selectedText('permanent_upazila')).toBe('Savar');
    expect(val('permanent_village')).toBe('House 12, Road 5, Bank Colony');
    expect(el('permanent_careof').disabled).toBe(true);

    // Exam populates group; result type reveals the result input.
    expect(selectedText('ssc_exam')).toBe('S.S.C');
    expect(selectedText('ssc_group')).toBe('Science');
    expect(el('ssc_result').style.display).not.toBe('none');
    expect(val('ssc_result')).toBe('5.00');
    expect(val('ssc_year')).toBe('2014');
    expect(selectedText('hsc_group')).toBe('Science');
    expect(val('hsc_result')).toBe('4.83');

    // Graduation: aliases and the exam-dependent subject list.
    expect(selectedText('gra_exam')).toBe('B.Sc Engineering');
    expect(selectedText('gra_institute')).toBe('Bangladesh University of Engineering & Technology');
    expect(selectedText('gra_subject')).toBe('Computer Science & Engineering');
    expect(selectedText('gra_result_type')).toBe('CGPA(out of 4)');
    expect(val('gra_result')).toBe('3.75');
    expect(selectedText('gra_duration')).toBe('04 Years');

    // Masters not applicable: stays unticked and disabled.
    expect(el('if_applicable_mas').checked).toBe(false);
    expect(el('mas_exam').disabled).toBe(true);

    // Experience: gate opened, currently working sets the end date to "today".
    expect(el('if_applicable_exp').checked).toBe(true);
    expect(selectedText('job[0][employment_type]')).toBe('Private Organization');
    expect(val('job[0][designation]')).toBe('Software Engineer');
    expect(val('job[0][job_start_date]')).toBe('2021-06-01');
    expect(el('job[0][currently_working]').checked).toBe(true);
    expect(val('job[0][job_end_date]')).toBe('2026-10-28');
    expect(document.querySelector('.charLength')!.textContent).toBe(String(300 - 'Built and maintained web applications.'.length));

    // Never touched.
    expect(val('captcha')).toBe('');
    expect(el('agree').checked).toBe(false);
  });

  it('is idempotent: a second fill changes nothing', async () => {
    await fillPlan(preview.plan, scan.elements, SETTINGS, { root: document });
    const again = await fillPlan(preview.plan, scan.elements, SETTINGS, { root: document });
    expect(again.filled).toBe(0);
    expect(again.failed).toBe(0);
  });

  it('fills the permanent address separately when it differs from present', async () => {
    const p = sampleProfile();
    p.permanentSameAsPresent = false;
    p.permanentAddress = {
      careOf: 'Abdul Karim', village: 'Kazir Dewri', district: 'Chittagong', upazila: 'Kotwali', postOffice: 'GPO', postCode: '4000',
    };
    mountTeletalk();
    const s = scanDocument(document);
    const pv = await buildPreview(document, p, SETTINGS, {}, undefined, { url: TELETALK_URL, scan: s });
    const report = await fillPlan(pv.plan, s.elements, SETTINGS, { root: document });
    expect(report.failed).toBe(0);
    expect(el('same_as_present').checked).toBe(false);
    expect(selectedText('permanent_district')).toBe('Chattogram');
    expect(selectedText('permanent_upazila')).toBe('Kotwali');
    expect(val('permanent_upazila')).toBe('510');
    expect(val('permanent_postcode')).toBe('4000');
    expect(selectedText('present_upazila')).toBe('Savar');
  });

  it('leaves "same as present" unticked (no alert) when the present address is incomplete', async () => {
    const p = sampleProfile();
    p.presentAddress.postOffice = '';
    mountTeletalk();
    const s = scanDocument(document);
    const pv = await buildPreview(document, p, SETTINGS, {}, undefined, { url: TELETALK_URL, scan: s });
    expect(pv.warnings.join(' ')).toMatch(/left unticked/);
    expect(pv.unmatched.map((u) => u.label)).toContain('Post Office');
    await fillPlan(pv.plan, s.elements, SETTINGS, { root: document });
    expect(alertSpy).not.toHaveBeenCalled();
    expect(el('same_as_present').checked).toBe(false);
    expect(selectedText('permanent_district')).toBe('Dhaka');
  });

  it('skips unticked items and children of a failed parent', async () => {
    const plan = preview.plan.map((i) => (nameOf(i.fid) === 'present_district' ? { ...i, enabled: false } : i));
    const report = await fillPlan(plan, scan.elements, { dependentFieldTimeoutMs: 200 }, { root: document });
    const status = (n: string) => report.items.find((r) => nameOf(r.fid) === n);
    expect(status('present_district')).toMatchObject({ status: 'skipped' });
    expect(status('present_upazila')).toMatchObject({ status: 'skipped' });
  });

  it('re-locates elements by data-ff-id when the cached element was replaced', async () => {
    const nameItem = preview.plan.find((i) => nameOf(i.fid) === 'name')!;
    const old = el('name');
    const replacement = old.cloneNode(true) as HTMLInputElement;
    old.replaceWith(replacement);
    const report = await fillPlan([nameItem], scan.elements, SETTINGS, { root: document });
    expect(report.filled).toBe(1);
    expect(replacement.value).toBe('RAHIM UDDIN');
  });
});

describe('LLM fallback wiring', () => {
  it('sends only unmatched field metadata and never current values', async () => {
    document.body.innerHTML = '<form><label for="q">Favourite colour</label><input id="q" name="q" value="typed by user"></form>';
    const llm = vi.fn(async (fields: { fid: string; currentValue: string }[], _keys: { key: string; label: string }[]) => {
      expect(fields.every((f) => f.currentValue === '')).toBe(true);
      return fields.map((f) => ({ fid: f.fid, key: 'extra.colour', source: 'llm' as const, confidence: 0.99 }));
    });
    const p = sampleProfile();
    p.extra = { colour: 'Blue' };
    const settings: Settings = { ...SETTINGS, useLlmForMapping: true, llm: { provider: 'gemini', apiKey: 'k', model: 'm', baseUrl: '' } };
    const pv = await buildPreview(document, p, settings, {}, llm, { url: 'https://x.example/' });
    expect(llm).toHaveBeenCalledOnce();
    expect(llm.mock.calls[0]![1]).toContainEqual({ key: 'extra.colour', label: 'Custom field: colour' });
    expect(pv.llmUsed).toBe(true);
    // LLM mappings are capped below the "high confidence" outline threshold.
    expect(pv.plan).toEqual([expect.objectContaining({ key: 'extra.colour', value: 'Blue', source: 'llm', confidence: 0.8 })]);
  });

  it('rejects keys outside the catalog and survives LLM errors', async () => {
    document.body.innerHTML = '<form><label for="q">Favourite colour</label><input id="q" name="q"></form>';
    const settings: Settings = { ...SETTINGS, useLlmForMapping: true, llm: { provider: 'gemini', apiKey: 'k', model: 'm', baseUrl: '' } };
    const bogus = vi.fn(async (fields: { fid: string }[]) =>
      fields.map((f) => ({ fid: f.fid, key: 'secrets.password', source: 'llm' as const, confidence: 1 })),
    );
    const pv = await buildPreview(document, sampleProfile(), settings, {}, bogus, { url: 'https://x.example/' });
    expect(pv.plan).toEqual([]);
    expect(pv.warnings.join(' ')).toMatch(/unknown profile key/);

    const failing = vi.fn(async () => {
      throw new Error('quota exceeded');
    });
    const pv2 = await buildPreview(document, sampleProfile(), settings, {}, failing, { url: 'https://x.example/' });
    expect(pv2.llmUsed).toBe(false);
    expect(pv2.warnings).toContain('LLM mapping failed: quota exceeded');
    expect(pv2.unmatched).toEqual([expect.objectContaining({ reason: 'no mapping' })]);
  });
});
