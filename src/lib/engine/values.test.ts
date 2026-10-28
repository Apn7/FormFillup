import { describe, expect, it } from 'vitest';
import type { FieldDescriptor, FieldOption, Profile } from '@/shared/types';
import { emptyProfile } from '@/shared/profile';
import { formatDate, inferDateFormat, matchOption, normalizePhone, readProfileValue, resolveValue } from './values';

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

const opts = (...texts: string[]): FieldOption[] => texts.map((text, i) => ({ value: String(i + 1), text }));

const profile = (edit: (p: Profile) => void): Profile => {
  const p = emptyProfile();
  edit(p);
  return p;
};

const resolved = (r: ReturnType<typeof resolveValue>) => {
  if (!r.ok) throw new Error(r.reason);
  return r;
};

describe('dates', () => {
  const p = profile((x) => (x.personal.dob = '1998-04-07'));

  it('passes ISO through for type=date and warns outside min/max', () => {
    expect(resolved(resolveValue(p, 'personal.dob', field({ kind: 'date' }))).value).toBe('1998-04-07');
    const r = resolved(resolveValue(p, 'personal.dob', field({ kind: 'date', min: '1999-01-01', max: '2008-01-01' })));
    expect(r.warnings[0]).toMatch(/before the earliest allowed date/);
  });

  it('formats text dates from placeholder / label hints', () => {
    expect(resolved(resolveValue(p, 'personal.dob', field({ placeholder: 'DD/MM/YYYY' }))).value).toBe('07/04/1998');
    expect(resolved(resolveValue(p, 'personal.dob', field({ placeholder: 'mm/dd/yyyy' }))).value).toBe('04/07/1998');
    expect(resolved(resolveValue(p, 'personal.dob', field({ label: 'Birth date (dd-mmm-yyyy)' }))).value).toBe('07-Apr-1998');
    expect(resolved(resolveValue(p, 'personal.dob', field({ placeholder: 'yyyy.mm.dd' }))).value).toBe('1998.04.07');
  });

  it('defaults to DD/MM/YYYY with a warning when the page gives no hint', () => {
    const r = resolved(resolveValue(p, 'personal.dob', field({ label: 'Date of birth' })));
    expect(r.value).toBe('07/04/1998');
    expect(r.warnings).toHaveLength(1);
  });

  it('exposes the helpers', () => {
    expect(inferDateFormat({ placeholder: 'e.g. DD-MM-YYYY', label: '' })).toBe('DD-MM-YYYY');
    expect(formatDate('2001-12-31', 'D/M/YY')).toBe('31/12/01');
  });
});

describe('option matching', () => {
  it('is case, whitespace and punctuation insensitive', () => {
    expect(matchOption(opts('S.S.C', 'Dakhil'), 'SSC')?.option.text).toBe('S.S.C');
    expect(matchOption(opts('H.S.C', 'Alim'), 'h s c')?.option.text).toBe('H.S.C');
    expect(matchOption(opts('Bangladesh University of Engineering & Technology'), 'bangladesh university of engineering and technology')?.how).toBe('exact');
  });

  it('matches result scales and durations by their single number', () => {
    const scale = [
      { value: '', text: 'Select' },
      { value: 'a', text: 'GPA(out of 4)' },
      { value: 'b', text: 'GPA(out of 5)' },
    ];
    expect(matchOption(scale, '5')?.option.text).toBe('GPA(out of 5)');
    expect(matchOption(opts('03 Years', '04 Years', '05 Years'), '4')?.option.text).toBe('04 Years');
    expect(matchOption(opts('3+ Years', '03 Years'), '3')?.option.text).toBe('03 Years');
    expect(matchOption(opts('1.5 Years', '2.5 Years'), '1.5')?.option.text).toBe('1.5 Years');
  });

  it('uses the Bangladeshi alias table', () => {
    const districts = opts('Barishal', 'Bogura', 'Chapai Nawabganj', 'Chattogram', 'Cumilla', 'Jashore');
    expect(matchOption(districts, 'Chittagong')?.option.text).toBe('Chattogram');
    expect(matchOption(districts, 'Comilla')?.option.text).toBe('Cumilla');
    expect(matchOption(districts, 'Barisal')?.option.text).toBe('Barishal');
    expect(matchOption(districts, 'Jessore')?.option.text).toBe('Jashore');
    expect(matchOption(districts, 'Bogra')?.option.text).toBe('Bogura');
    expect(matchOption(districts, 'Chapainawabganj')?.option.text).toBe('Chapai Nawabganj');
    expect(matchOption(opts('Islam', 'Hinduism', 'Buddhism'), 'Hindu')?.option.text).toBe('Hinduism');
    expect(matchOption(opts('Islam', 'Hinduism'), 'Muslim')?.option.text).toBe('Islam');
    expect(matchOption(opts('Single', 'Married', 'Other'), 'Unmarried')).toMatchObject({ how: 'alias', option: { text: 'Single' } });
  });

  it('falls back to containment and fuzzy matching with lower confidence', () => {
    const contains = matchOption(opts('Mirpur Model', 'Savar', 'Dhanmondi'), 'Mirpur');
    expect(contains).toMatchObject({ how: 'contains', option: { text: 'Mirpur Model' } });
    expect(contains!.confidence).toBeLessThan(0.85);
    const fuzzy = matchOption(opts('Kishoreganj', 'Kurigram', 'Kushtia'), 'Kishorgonj');
    expect(fuzzy?.option.text).toBe('Kishoreganj');
    expect(fuzzy!.confidence).toBeLessThanOrEqual(0.75);
    expect(matchOption(opts('Dhaka', 'Sylhet'), 'Rangpur')).toBeNull();
  });

  it('never picks the placeholder option and reports missing options', () => {
    const f = field({ kind: 'select', options: [{ value: '', text: 'Select' }, ...opts('Dhaka')] });
    const r = resolveValue(profile((x) => (x.presentAddress.district = 'Select')), 'presentAddress.district', f);
    expect(r).toEqual({ ok: false, reason: 'option not found: Select' });
  });

  it('defers dependent dropdowns whose options are not loaded yet', () => {
    const f = field({ kind: 'select', options: [{ value: '', text: 'Select' }] });
    const p = profile((x) => (x.presentAddress.upazila = 'Savar'));
    expect(resolveValue(p, 'presentAddress.upazila', f).ok).toBe(false);
    expect(resolveValue(p, 'presentAddress.upazila', f, { allowDeferredOption: true })).toMatchObject({
      ok: true,
      value: 'Savar',
      deferred: true,
    });
  });
});

describe('derived keys, checkboxes, numbers and text', () => {
  const yesNo = field({ kind: 'select', options: [{ value: '', text: 'Select' }, { value: '1', text: 'Yes' }, { value: '0', text: 'No' }] });

  it('derives Yes/No selects from stored ids', () => {
    const p = profile((x) => (x.ids.nid = '123'));
    expect(resolved(resolveValue(p, 'ids.hasNid', yesNo))).toMatchObject({ value: '1', displayValue: 'Yes' });
    expect(resolved(resolveValue(p, 'ids.hasPassport', yesNo))).toMatchObject({ value: '0', displayValue: 'No' });
    expect(readProfileValue(profile((x) => (x.contact.mobile = '01711111111')), 'contact.mobileConfirm')).toBe('01711111111');
  });

  it('turns booleans into "true"/"false" for checkboxes', () => {
    const cb = field({ kind: 'checkbox' });
    expect(resolved(resolveValue(profile((x) => (x.permanentSameAsPresent = true)), 'permanentSameAsPresent', cb)).value).toBe('true');
    expect(resolved(resolveValue(emptyProfile(), 'education.masters.applicable', cb)).value).toBe('false');
  });

  it('cleans grouped numbers and phone numbers', () => {
    const p = profile((x) => (x.ids.nid = '1234 567-890'));
    expect(resolved(resolveValue(p, 'ids.nid', field({ kind: 'number' }))).value).toBe('1234567890');
    expect(resolveValue(profile((x) => (x.presentAddress.postCode = 'abc')), 'presentAddress.postCode', field({ kind: 'number' })).ok).toBe(false);
    expect(normalizePhone('+880 1712-345678', 11)).toBe('01712345678');
    expect(normalizePhone('+8801712345678')).toBe('+8801712345678');
  });

  it('truncates to maxLength with a warning instead of silently', () => {
    const p = profile((x) => (x.personal.nameEn = 'A very long name indeed'));
    const r = resolved(resolveValue(p, 'personal.nameEn', field({ maxLength: 6 }), { transform: 'uppercase' }));
    expect(r.value).toBe('A VERY');
    expect(r.warnings[0]).toMatch(/truncated to 6/);
  });

  it('reports a missing profile value', () => {
    expect(resolveValue(emptyProfile(), 'personal.nameEn', field({}))).toEqual({ ok: false, reason: 'no profile value' });
  });

  it('falls back to the present address for permanent keys when same-as-present', () => {
    const p = profile((x) => {
      x.permanentSameAsPresent = true;
      x.presentAddress.district = 'Dhaka';
    });
    expect(readProfileValue(p, 'permanentAddress.district')).toBe('Dhaka');
  });
});
