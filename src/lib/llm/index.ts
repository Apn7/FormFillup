import type { FieldDescriptor, FieldMapping, Profile, ProfileKey, Settings } from '../../shared/types';
import { extractProfile, prepareInput } from './extract';
import { createGeminiClient } from './gemini';
import { mapFields } from './mapping';
import { createOpenAiCompatibleClient } from './openai-compatible';
import { LlmError, type LlmClient } from './types';

export const MAPPING_TIMEOUT_MS = 20_000;
export const EXTRACTION_TIMEOUT_MS = 60_000;

export function createClient(settings: Settings, timeoutMs: number): LlmClient {
  const { provider, apiKey, model, baseUrl } = settings.llm;
  if (provider === 'none') throw new LlmError('No AI provider is configured. Choose one in Settings.');
  if (provider === 'openai-compatible') {
    if (!baseUrl.trim()) throw new LlmError('Enter the base URL of your OpenAI-compatible provider in Settings.');
    if (!model.trim()) throw new LlmError('Enter a model name in Settings.');
    return createOpenAiCompatibleClient(apiKey.trim(), model.trim(), baseUrl, { timeoutMs });
  }
  if (!apiKey.trim()) throw new LlmError('Add your Gemini API key in Settings first.');
  if (!model.trim()) throw new LlmError('Enter a model name in Settings.');
  return createGeminiClient(apiKey.trim(), model.trim(), { timeoutMs });
}

/** Sends field metadata and the allowed key list only; never profile values. */
export async function mapFieldsWithLlm(
  settings: Settings,
  fields: FieldDescriptor[],
  keys: { key: ProfileKey; label: string }[],
): Promise<FieldMapping[]> {
  if (!fields.length) return [];
  return mapFields(createClient(settings, MAPPING_TIMEOUT_MS), fields, keys);
}

export async function extractProfileFromDocuments(
  settings: Settings,
  files: { name: string; mimeType: string; base64: string }[],
): Promise<{ profile: Partial<Profile>; notes: string[] }> {
  const client = createClient(settings, EXTRACTION_TIMEOUT_MS);
  const provider = settings.llm.provider === 'gemini' ? 'gemini' : 'openai-compatible';
  const input = prepareInput(files, provider);
  return extractProfile(
    client,
    input,
    files.map((f) => f.name),
  );
}

export async function testLlm(settings: Settings): Promise<{ ok: boolean; detail: string }> {
  try {
    const client = createClient(settings, MAPPING_TIMEOUT_MS);
    await client.generateJson<{ ok: boolean }>({
      system: 'You are a connectivity check. Reply with JSON only.',
      user: 'Return {"ok": true}.',
      schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
    });
    return { ok: true, detail: `Connected to ${settings.llm.model.trim()}.` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : 'Unknown error.' };
  }
}
