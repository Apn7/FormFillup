import { beforeEach, describe, expect, it } from 'vitest';
import { mountGeneric, mountHtml, mountTeletalk } from '../../../tests/fixtures/load';
import { FID_ATTR } from './dom';
import { scanDocument } from './scanner';
import type { FieldDescriptor } from '@/shared/types';

const byName = (fields: FieldDescriptor[], name: string): FieldDescriptor => {
  const f = fields.find((x) => x.name === name);
  if (!f) throw new Error(`no field named ${name}`);
  return f;
};

describe('scanner on a generic form', () => {
  let fields: FieldDescriptor[];
  let elements: Map<string, Element>;

  beforeEach(() => {
    ({ fields, elements } = scanDocument(mountGeneric()));
  });

  it('resolves labels in the documented order', () => {
    expect(byName(fields, 'fullName').label).toBe('Full Name'); // label[for], "*" stripped
    expect(byName(fields, 'contact_email').label).toBe('Email Address'); // wrapping label
    expect(byName(fields, 'f_name').label).toBe("Father's Name"); // table cell
    expect(byName(fields, 'm_name').label).toBe("Mother's Name"); // th, colon stripped
    expect(byName(fields, 'birth').label).toBe('Date of Birth'); // aria-labelledby
    expect(byName(fields, 'field_17').label).toBe('Contact'); // nearby text
    expect(byName(fields, 'fbn').label).toBe('পিতার নাম (বাংলায়)');
  });

  it('assigns fieldset legends as sections and falls back to the preceding heading', () => {
    expect(byName(fields, 'pd').section).toBe('Present Address');
    expect(byName(fields, 'perd').section).toBe('Permanent Address');
    expect(byName(fields, 'edu1_roll').section).toBe('SSC / Equivalent');
    expect(byName(fields, 'fullName').section).toBe('Online Application');
  });

  it('skips hidden-type inputs, buttons, passwords and captcha, but keeps files', () => {
    const names = fields.map((f) => f.name);
    expect(names).not.toContain('csrf');
    expect(names).not.toContain('pw');
    expect(names).not.toContain('captcha_code');
    expect(names).toContain('photo');
    expect(byName(fields, 'photo').kind).toBe('file');
  });

  it('collects options, merges radio groups and marks visibility', () => {
    expect(byName(fields, 'gender').options).toEqual([
      { value: '', text: '-- choose --' },
      { value: 'M', text: 'Male' },
      { value: 'F', text: 'Female' },
    ]);
    const radios = fields.filter((f) => f.name === 'ms');
    expect(radios).toHaveLength(1);
    expect(radios[0]!.kind).toBe('radio');
    expect(radios[0]!.label).toBe('Marital Status');
    expect(radios[0]!.options).toEqual([
      { value: 'unmarried', text: 'Unmarried' },
      { value: 'married', text: 'Married' },
    ]);
    expect(byName(fields, 'hid').visible).toBe(false);
    expect(byName(fields, 'fullName').visible).toBe(true);
    expect(byName(fields, 'fullName').required).toBe(true);
    expect(byName(fields, 'ppc').maxLength).toBe(4);
  });

  it('tags every element (all radios of a group) with its fid', () => {
    for (const f of fields) {
      expect(elements.get(f.fid)?.getAttribute(FID_ATTR)).toBe(f.fid);
    }
    const ms = byName(fields, 'ms');
    expect(document.querySelectorAll(`[${FID_ATTR}="${ms.fid}"]`)).toHaveLength(2);
  });

  it('keeps fids stable across re-scans', () => {
    const again = scanDocument(document);
    expect(again.fields.map((f) => f.fid)).toEqual(fields.map((f) => f.fid));
  });
});

describe('scanner edge cases', () => {
  it('descends into open shadow roots', () => {
    const doc = mountHtml('<html><body><div id="host"></div></body></html>');
    const root = doc.getElementById('host')!.attachShadow({ mode: 'open' });
    root.innerHTML = '<label for="x">Shadow Email</label><input id="x" type="email" name="x">';
    const { fields } = scanDocument(doc);
    expect(fields.map((f) => f.label)).toEqual(['Shadow Email']);
  });

  it('scans a 300-field form without quadratic blow-up', () => {
    const rows = Array.from(
      { length: 300 },
      (_, i) => `<div class="form-group"><label for="f${i}">Field ${i}</label><input id="f${i}" name="f${i}"></div>`,
    ).join('');
    const doc = mountHtml(`<html><body><form>${rows}</form></body></html>`);
    const t0 = performance.now();
    const { fields } = scanDocument(doc);
    expect(fields).toHaveLength(300);
    // jsdom's getComputedStyle is far slower than a browser; this only guards against O(n^2) regressions.
    expect(performance.now() - t0).toBeLessThan(5000);
  });

  it('does not leak select option text into a wrapping label', () => {
    const doc = mountHtml('<html><body><label>Blood group <select name="b"><option>A+</option><option>B+</option></select></label></body></html>');
    expect(scanDocument(doc).fields[0]!.label).toBe('Blood group');
  });
});

describe('scanner on the Teletalk fixture', () => {
  it('finds the form fields with Teletalk labels and sections', () => {
    const { fields } = scanDocument(mountTeletalk());
    const names = fields.map((f) => f.name);
    expect(names).not.toContain('captcha');
    expect(names).not.toContain('unique_id');
    expect(names).toContain('agree');
    expect(byName(fields, 'nid_no').label).toBe('National ID Number');
    expect(byName(fields, 'nid_no').visible).toBe(false);
    expect(byName(fields, 'ssc_result').label).toBe('Result');
    expect(byName(fields, 'ssc_result').section).toBe('SSC/Equivalent Level');
    expect(byName(fields, 'present_district').section).toBe('Present Address (বর্তমান ঠিকানা)');
    expect(byName(fields, 'dob')).toMatchObject({ kind: 'date', min: '1994-10-15', max: '2008-10-15' });
  });
});
