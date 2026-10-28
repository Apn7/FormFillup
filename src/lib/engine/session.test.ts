import { describe, expect, it, vi } from 'vitest';
import type { FillReport, PreviewResult, Settings } from '@/shared/types';
import { emptyProfile } from '@/shared/profile';
import { mountGeneric, sampleProfile } from '../../../tests/fixtures/load';
import { clearHighlights, HIGHLIGHT_COLORS } from './highlight';
import { fieldSignature, type SiteCacheEntries } from './planner';
import { PING_TYPE } from './protocol';
import { scanDocument } from './scanner';
import { createSession } from './session';

const SETTINGS: Settings = {
  llm: { provider: 'none', apiKey: '', model: '', baseUrl: '' },
  useLlmForMapping: false,
  dependentFieldTimeoutMs: 300,
};

function setup(profile = sampleProfile(), cache: SiteCacheEntries = {}) {
  const doc = mountGeneric();
  const saved: SiteCacheEntries[] = [];
  const llmMap = vi.fn(async () => []);
  const session = createSession({
    doc,
    getProfile: async () => profile,
    getSettings: async () => SETTINGS,
    getSiteMappings: async () => cache,
    saveSiteMappings: async (_origin, entries) => {
      saved.push(entries);
    },
    llmMap,
  });
  return { doc, session, saved, llmMap };
}

describe('content session', () => {
  it('answers ping and ignores foreign messages', async () => {
    const { session } = setup();
    expect(await session.handle({ type: PING_TYPE })).toEqual({ ok: true, data: { alive: true } });
    expect(session.handle({ type: 'something-else' })).toBeUndefined();
    expect(session.handle(null)).toBeUndefined();
  });

  it('previews, highlights, fills and learns rule mappings into the site cache', async () => {
    const { doc, session, saved } = setup();
    const reply = (await session.handle({ type: 'ff:preview', payload: { useLlm: false } })) as {
      ok: true;
      data: PreviewResult;
    };
    expect(reply.ok).toBe(true);
    const plan = reply.data.plan;
    expect(plan.length).toBeGreaterThan(15);

    const fullName = doc.querySelector<HTMLInputElement>('[name="fullName"]')!;
    expect(fullName.style.outline).toContain('2px solid');

    const fill = (await session.handle({ type: 'ff:fill', payload: { items: plan } })) as { ok: true; data: FillReport };
    expect(fill.data.failed).toBe(0);
    expect(fullName.value).toBe('Rahim Uddin');
    expect(doc.querySelector<HTMLSelectElement>('[name="pd"]')!.selectedOptions[0]!.text).toBe('Dhaka');
    expect(doc.querySelector<HTMLInputElement>('[name="birth"]')!.value).toBe('21/04/1998');
    expect(doc.querySelector<HTMLInputElement>('input[name="ms"][value="unmarried"]')!.checked).toBe(true);
    expect(doc.querySelector<HTMLInputElement>('[name="terms"]')!.checked).toBe(false);

    expect(saved).toHaveLength(1);
    const field = reply.data.fields.find((f) => f.name === 'fullName')!;
    expect(saved[0]![fieldSignature(field)]).toMatchObject({ key: 'personal.nameEn', source: 'rule' });

    await session.handle({ type: 'ff:clear-highlights', payload: {} });
    expect(fullName.style.outline).toBe('');
  });

  it('uses cached mappings on the next visit', async () => {
    const doc = mountGeneric();
    const field = scanDocument(doc).fields.find((f) => f.name === 'contact_email')!;
    const cache: SiteCacheEntries = { [fieldSignature(field)]: { key: 'extra.altEmail', source: 'llm', updatedAt: 1 } };
    const profile = sampleProfile();
    profile.extra = { altEmail: 'alt@example.com' };
    const { session } = setup(profile, cache);
    const reply = (await session.handle({ type: 'ff:preview', payload: { useLlm: false } })) as { ok: true; data: PreviewResult };
    const item = reply.data.plan.find((i) => i.key === 'extra.altEmail');
    expect(item).toMatchObject({ source: 'cache', value: 'alt@example.com' });
  });

  it('turns errors into replies instead of throwing', async () => {
    const doc = mountGeneric();
    const session = createSession({
      doc,
      getProfile: async () => {
        throw new Error('storage unavailable');
      },
      getSettings: async () => SETTINGS,
      getSiteMappings: async () => ({}),
      saveSiteMappings: async () => undefined,
      llmMap: async () => [],
    });
    expect(await session.handle({ type: 'ff:preview', payload: { useLlm: false } })).toEqual({
      ok: false,
      error: 'storage unavailable',
    });
  });

  it('marks required-but-unmatched fields red', async () => {
    const doc = mountGeneric();
    doc.querySelector('[name="fullName"]')!.setAttribute('name', 'q_1');
    doc.querySelector('[for="fullName"]')!.textContent = 'Favourite colour';
    const session = createSession({
      doc,
      getProfile: async () => emptyProfile(),
      getSettings: async () => SETTINGS,
      getSiteMappings: async () => ({}),
      saveSiteMappings: async () => undefined,
      llmMap: async () => [],
    });
    await session.preview({ useLlm: false });
    const input = doc.getElementById('fullName') as HTMLInputElement;
    expect(input.getAttribute('data-ff-hl')).toBe('missing');
    expect(input.style.outline).toContain('2px solid');
    expect(HIGHLIGHT_COLORS.missing).toBe('#dc2626');
    clearHighlights(doc);
    expect(input.hasAttribute('data-ff-hl')).toBe(false);
  });
});
