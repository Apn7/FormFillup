import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FieldDescriptor } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../storage';
import { prepareInput } from './extract';
import { createGeminiClient, GEMINI_FALLBACK_MODELS, modelChain } from './gemini';
import { backoffDelay, httpErrorMessage, parseRetryAfter } from './http';
import { extractProfileFromDocuments, mapFieldsWithLlm, testLlm } from './index';
import { parseAndValidate, parseJsonLoose, validateJson } from './json';
import { describeField, validateMappings } from './mapping';
import { createOpenAiCompatibleClient } from './openai-compatible';
import { sanitizeProfile } from './sanitize';
import { LlmError, type JsonSchema } from './types';

const jsonRes = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const geminiOk = (text: string) => jsonRes({ candidates: [{ content: { parts: [{ text }] } }] });
const settings = (over = {}) => ({ ...DEFAULT_SETTINGS, llm: { ...DEFAULT_SETTINGS.llm, apiKey: 'SECRET', ...over } });

afterEach(() => vi.unstubAllGlobals());

describe('json parsing and validation', () => {
  it('strips code fences and prose', () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('Here you go: {"a":[1]} thanks')).toEqual({ a: [1] });
    expect(() => parseJsonLoose('nope')).toThrow(LlmError);
  });
  it('validates against schema', () => {
    const s: JsonSchema = { type: 'object', required: ['x'], properties: { x: { type: 'string' }, y: { type: 'number', nullable: true } } };
    expect(validateJson(s, { x: 'a', y: null })).toEqual([]);
    expect(validateJson(s, {})).not.toEqual([]);
    expect(validateJson(s, { x: 1 })).not.toEqual([]);
    expect(() => parseAndValidate('{"y":1}', s)).toThrow(/expected format/);
  });
});

describe('mapping', () => {
  it('drops unknown keys/fids, clamps confidence', () => {
    const out = validateMappings(
      { mappings: [
        { fid: 'ff-1', key: 'personal.nameEn', confidence: 7 },
        { fid: 'ff-2', key: 'made.up', confidence: 1 },
        { fid: 'ff-9', key: 'personal.dob' },
        { fid: 'ff-3', key: null },
        { fid: 'ff-1', key: 'personal.dob' },
        { fid: 'ff-4', key: 'personal.dob', confidence: -3 },
      ] },
      new Set(['ff-1', 'ff-2', 'ff-3', 'ff-4']),
      new Set(['personal.nameEn', 'personal.dob']),
    );
    expect(out).toEqual([
      { fid: 'ff-1', key: 'personal.nameEn', source: 'llm', confidence: 1 },
      { fid: 'ff-4', key: 'personal.dob', source: 'llm', confidence: 0 },
    ]);
  });

  it('sends metadata only, truncates options, batches large forms', async () => {
    const mk = (i: number): FieldDescriptor => ({
      fid: `ff-${i}`, kind: 'select', name: 'n', id: 'i', label: 'Board', placeholder: '', section: 'SSC', autocomplete: '',
      options: Array.from({ length: 40 }, (_, j) => ({ value: `${j}`, text: `Opt${j}` })),
      required: false, visible: true, currentValue: 'PRIVATE-VALUE',
    });
    expect(Object.keys(describeField(mk(1)))).not.toContain('currentValue');
    expect((describeField(mk(1)).options as string[]).length).toBe(15);
    const fetchMock = vi.fn(async () => geminiOk('{"mappings":[{"fid":"ff-0","key":"education.ssc.board","confidence":0.9}]}'));
    vi.stubGlobal('fetch', fetchMock);
    const fields = Array.from({ length: 130 }, (_, i) => mk(i));
    const res = await mapFieldsWithLlm(settings(), fields, [{ key: 'education.ssc.board', label: 'SSC board' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res).toHaveLength(1);
    const sent = JSON.stringify(fetchMock.mock.calls[0]);
    expect(sent).not.toContain('PRIVATE-VALUE');
    expect(sent).toContain('x-goog-api-key');
  });
});

describe('retry and errors', () => {
  it('retries 429 then succeeds, honoring Retry-After', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ error: { message: 'quota' } }, 429, { 'retry-after': '0' }))
      .mockResolvedValueOnce(geminiOk('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);
    const c = createGeminiClient('k', 'gemini-flash-latest', { timeoutMs: 1000, baseDelayMs: 1 });
    const schema: JsonSchema = { type: 'object', properties: { ok: { type: 'boolean' } } };
    expect(await c.generateJson({ system: 's', user: 'u', schema })).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('walks the model fallback chain on 503, then gives up with the first error', async () => {
    const fetchMock = vi.fn(async (_url: string) => jsonRes({}, 503));
    vi.stubGlobal('fetch', fetchMock);
    const c = createGeminiClient('k', 'm', { timeoutMs: 1000, baseDelayMs: 1, maxRetries: 2 });
    await expect(c.generateJson({ system: '', user: '', schema: { type: 'object' } })).rejects.toThrow(/having problems/);
    const chain = modelChain('m');
    expect(chain).toEqual(['m', ...GEMINI_FALLBACK_MODELS]);
    // One retry per model, then the next model.
    expect(fetchMock).toHaveBeenCalledTimes(chain.length * 2);
  });

  it('falls back to the next model when the configured one is retired (404)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ error: { message: 'no longer available' } }, 404))
      .mockResolvedValueOnce(geminiOk('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);
    const c = createGeminiClient('k', 'gemini-2.5-flash', { timeoutMs: 1000, baseDelayMs: 1 });
    const schema: JsonSchema = { type: 'object', properties: { ok: { type: 'boolean' } } };
    expect(await c.generateJson({ system: 's', user: 'u', schema })).toEqual({ ok: true });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(`/models/${GEMINI_FALLBACK_MODELS[0]}:generateContent`);
  });

  it('does not retry 401 and never leaks the key', async () => {
    const fetchMock = vi.fn(async () => jsonRes({ error: { message: 'bad SECRET' } }, 401));
    vi.stubGlobal('fetch', fetchMock);
    const r = await testLlm(settings());
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/Invalid API key/);
    expect(r.detail).not.toContain('SECRET');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps status codes', () => {
    expect(httpErrorMessage(400, 'API key not valid')).toMatch(/Invalid API key/);
    expect(httpErrorMessage(403)).toMatch(/not allowed/);
    expect(httpErrorMessage(429)).toMatch(/quota/);
    expect(parseRetryAfter('2')).toBe(2000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(backoffDelay(0, 1000, 500)).toBe(500);
    expect(backoffDelay(2, 1000)).toBeGreaterThanOrEqual(2000);
  });

  it('openai-compatible falls back without response_format on 400', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes({ error: { message: 'response_format unsupported' } }, 400))
      .mockResolvedValueOnce(jsonRes({ choices: [{ message: { content: '```json\n{"ok":true}\n```' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const c = createOpenAiCompatibleClient('k', 'm', 'https://api.groq.com/openai/v1/', { timeoutMs: 1000, baseDelayMs: 1 });
    const schema: JsonSchema = { type: 'object', properties: { ok: { type: 'boolean' } } };
    expect(await c.generateJson({ system: 's', user: 'u', schema })).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.groq.com/openai/v1/chat/completions');
  });
});

describe('extraction', () => {
  it('rejects PDFs for openai-compatible and oversize payloads', () => {
    const pdf = { name: 'a.pdf', mimeType: 'application/pdf', base64: 'AAAA' };
    expect(() => prepareInput([pdf], 'openai-compatible')).toThrow(/Use Gemini for PDF/);
    const big = { name: 'b.pdf', mimeType: 'application/pdf', base64: 'A'.repeat(19 * 1024 * 1024) };
    expect(() => prepareInput([big], 'gemini')).toThrow(/limit/);
    expect(() => prepareInput([{ name: 'x.zip', mimeType: 'application/zip', base64: 'AA' }], 'gemini')).toThrow(/Unsupported/);
  });

  it('decodes text files and sanitizes the result', async () => {
    const text = btoa('Name: Rahim');
    const fetchMock = vi.fn(async () =>
      geminiOk(JSON.stringify({
        profile: {
          personal: { nameEn: ' Rahim ', dob: '12/03/1998', gender: 'Male', bogus: 'x' },
          education: { ssc: { board: 'Dhaka', resultScale: '9', result: '5.00' } },
          experience: [{ designation: 'Dev', currentlyWorking: true }, {}],
        },
        notes: ['check dob'],
      })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const r = await extractProfileFromDocuments(settings(), [{ name: 'cv.txt', mimeType: 'text/plain', base64: text }]);
    expect(JSON.stringify(fetchMock.mock.calls[0])).toContain('Name: Rahim');
    expect(r.profile.personal?.nameEn).toBe('Rahim');
    expect(r.profile.personal?.dob).toBe('');
    expect(r.profile.personal).not.toHaveProperty('bogus');
    expect(r.profile.education?.ssc?.resultScale).toBe('');
    expect(r.profile.education?.ssc?.result).toBe('5.00');
    expect(r.profile.experience).toHaveLength(1);
    expect(r.notes.some((n) => n.includes('check dob'))).toBe(true);
    expect(r.notes.some((n) => n.includes('ISO date'))).toBe(true);
  });

  it('sanitizeProfile ignores garbage', () => {
    expect(sanitizeProfile(null)).toEqual({});
    expect(sanitizeProfile({ personal: 'x', ids: [] })).toEqual({});
  });
});
