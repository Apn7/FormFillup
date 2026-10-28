import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProfile } from '../shared/profile';
import {
  DEFAULT_SETTINGS, getProfile, getSettings, getSiteMappings, saveProfile, saveSettings, saveSiteMappings, watchProfile,
} from './storage';

beforeEach(() => fakeBrowser.reset());

describe('storage', () => {
  it('returns defaults when empty', async () => {
    expect(await getProfile()).toEqual(emptyProfile());
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(await getSiteMappings('https://a.b')).toEqual({});
  });

  it('round-trips profile and settings', async () => {
    const p = emptyProfile();
    p.personal.nameEn = 'RAHIM';
    p.education.ssc = { exam: 'S.S.C', board: 'Dhaka', institute: '', roll: '1', registration: '', group: 'Science', subject: '', resultScale: '5', result: '5.00', passingYear: '2015', durationYears: '' };
    await saveProfile(p);
    expect(await getProfile()).toEqual(p);
    const s = { ...DEFAULT_SETTINGS, llm: { ...DEFAULT_SETTINGS.llm, apiKey: 'k' } };
    await saveSettings(s);
    expect((await getSettings()).llm.apiKey).toBe('k');
  });

  it('migrates partial/malformed stored data', async () => {
    await fakeBrowser.storage.local.set({
      'ff:profile': { personal: { nameEn: 'X', dob: 'bad', gender: 5 }, experience: 'oops', education: { hsc: { board: 'Dhaka' } } },
      'ff:settings': { llm: { provider: 'weird', apiKey: 'abc' }, dependentFieldTimeoutMs: 999999 },
    });
    const p = await getProfile();
    expect(p.personal.nameEn).toBe('X');
    expect(p.personal.dob).toBe('');
    expect(p.personal.nationality).toBe('Bangladeshi');
    expect(p.experience).toEqual([]);
    expect(p.education.hsc?.board).toBe('Dhaka');
    expect(p.education.hsc?.roll).toBe('');
    const s = await getSettings();
    expect(s.llm.provider).toBe('gemini');
    expect(s.llm.apiKey).toBe('abc');
    expect(s.llm.model).toBe(DEFAULT_SETTINGS.llm.model);
    expect(s.dependentFieldTimeoutMs).toBe(30000);
  });

  it('stores site mappings per origin', async () => {
    const e = { sig: { key: 'personal.nameEn', source: 'user' as const, updatedAt: 1 } };
    await saveSiteMappings('https://a.b', e);
    await saveSiteMappings('https://c.d', {});
    expect(await getSiteMappings('https://a.b')).toEqual(e);
  });

  it('watchProfile notifies and unsubscribes', async () => {
    const cb = vi.fn();
    const off = watchProfile(cb);
    const p = emptyProfile();
    p.contact.email = 'a@b.c';
    await saveProfile(p);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]?.[0].contact.email).toBe('a@b.c');
    off();
    await saveProfile(emptyProfile());
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
