/**
 * Live checks against the real Gemini API. Skipped unless a key is supplied, so CI and `npm test`
 * never hit the network. Run with:
 *   cmd.exe /c "set FF_LIVE_GEMINI_KEY=<key>&& npx vitest run tests/live.gemini.test.ts"
 * Optional: FF_LIVE_GEMINI_MODEL (defaults to the extension's default model).
 */
import { describe, expect, it } from 'vitest';
import type { Settings } from '@/shared/types';
import { DEFAULT_SETTINGS } from '@/lib/storage';
import { extractProfileFromDocuments, mapFieldsWithLlm, testLlm } from '@/lib/llm';
import { allowedKeys } from '@/lib/engine/planner';
import { scanDocument } from '@/lib/engine/scanner';
import { TELETALK_FIELDS } from '@/lib/engine/adapters/teletalk';
import { mountTeletalk } from './fixtures/load';

// Vitest runs in Node; the extension tsconfig has no Node types, so declare just what this file reads.
declare const process: { env: Record<string, string | undefined> };

const KEY = process.env.FF_LIVE_GEMINI_KEY ?? '';
const settings: Settings = {
  ...DEFAULT_SETTINGS,
  llm: { ...DEFAULT_SETTINGS.llm, apiKey: KEY, model: process.env.FF_LIVE_GEMINI_MODEL || DEFAULT_SETTINGS.llm.model },
};

describe.skipIf(!KEY)('live Gemini', () => {
  it('answers the connection test', async () => {
    const r = await testLlm(settings);
    expect(r, r.detail).toMatchObject({ ok: true });
  }, 120_000);

  it('maps the Teletalk form without the site adapter (as if it were an unknown site)', async () => {
    const { fields } = scanDocument(mountTeletalk());
    const visible = fields.filter((f) => f.visible && TELETALK_FIELDS[f.name]);
    const mappings = await mapFieldsWithLlm(settings, visible, allowedKeys());

    const byFid = new Map(mappings.map((m) => [m.fid, m.key]));
    const misses: string[] = [];
    let correct = 0;
    for (const f of visible) {
      const expected = TELETALK_FIELDS[f.name]?.key;
      const got = byFid.get(f.fid) ?? null;
      if (got === expected) correct++;
      else misses.push(`${f.name}: expected ${expected}, got ${got}`);
    }
    const accuracy = correct / visible.length;
    console.info(`[live] LLM mapping accuracy ${correct}/${visible.length} (${(accuracy * 100).toFixed(0)}%)`);
    if (misses.length) console.info(`[live] misses:\n  ${misses.join('\n  ')}`);
    // The adapter stays the source of truth on Teletalk; this measures the fallback for unknown sites.
    expect(accuracy).toBeGreaterThanOrEqual(0.8);
  }, 180_000);

  it('extracts a profile from a plain-text CV', async () => {
    const cv = [
      'CURRICULUM VITAE',
      'Name: Md. Rakibul Hasan',
      "Father's Name: Abdul Karim",
      "Mother's Name: Rokeya Begum",
      'Date of Birth: 14 March 1999',
      'Mobile: 01712345678   Email: rakib.hasan@example.com',
      'Present Address: House 12, Road 5, Mirpur, Dhaka-1216',
      'SSC (Science), Dhaka Board, 2015, GPA 5.00 out of 5, Roll 123456',
      'HSC (Science), Dhaka Board, 2017, GPA 4.83 out of 5',
      'B.Sc in Computer Science & Engineering, University of Dhaka, 2022, CGPA 3.62 out of 4',
    ].join('\n');
    const base64 = btoa(unescape(encodeURIComponent(cv)));
    const { profile, notes } = await extractProfileFromDocuments(settings, [
      { name: 'cv.txt', mimeType: 'text/plain', base64 },
    ]);
    console.info('[live] extraction notes:', notes);
    expect(profile.personal?.nameEn).toMatch(/Rakibul Hasan/i);
    expect(profile.personal?.fatherEn).toMatch(/Abdul Karim/i);
    expect(profile.personal?.dob).toBe('1999-03-14');
    expect(profile.contact?.mobile).toBe('01712345678');
    expect(profile.education?.ssc?.result).toMatch(/^5(\.00?)?$/);
    expect(profile.education?.ssc?.board).toMatch(/Dhaka/i);
    expect(profile.education?.graduation?.resultScale).toBe('4');
  }, 180_000);
});
