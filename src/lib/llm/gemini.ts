import { fetchJsonWithRetry } from './http';
import { parseAndValidate } from './json';
import { LlmError, type ClientOptions, type GenerateJsonRequest, type JsonSchema, type LlmClient } from './types';

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/** Gemini's responseSchema uses the OpenAPI Type enum (upper case). */
export function toGeminiSchema(s: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: s.type.toUpperCase() };
  if (s.description) out.description = s.description;
  if (s.nullable) out.nullable = true;
  if (s.enum) out.enum = s.enum;
  if (s.required?.length) out.required = s.required;
  if (s.items) out.items = toGeminiSchema(s.items);
  if (s.properties) {
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
  }
  return out;
}

interface GeminiResponse {
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  promptFeedback?: { blockReason?: string };
}

export function geminiText(data: unknown): string {
  const r = data as GeminiResponse;
  if (r.promptFeedback?.blockReason) throw new LlmError('The AI provider blocked this request (safety filter).');
  const cand = r.candidates?.[0];
  const text = (cand?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('');
  if (!text) throw new LlmError('The AI returned an empty answer. Try again or use another model.');
  if (cand?.finishReason === 'MAX_TOKENS') throw new LlmError('The AI answer was cut off. Try fewer documents.');
  return text;
}

export function buildGeminiBody(req: GenerateJsonRequest): Record<string, unknown> {
  const parts: unknown[] = (req.files ?? []).map((f) => ({ inline_data: { mime_type: f.mimeType, data: f.base64 } }));
  parts.push({ text: req.user });
  return {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(req.schema),
      maxOutputTokens: 16384,
    },
  };
}

/**
 * Tried in order when the configured model is overloaded (503), retired (404), out of free quota (429)
 * or timed out. Free-tier quotas are per model, so another model often still answers. Verified live
 * Oct 2026: Flash-Lite answers in ~2 s while the larger Flash models were returning 503 / hanging.
 */
export const GEMINI_FALLBACK_MODELS = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];

const FALLBACK_STATUSES = new Set([404, 408, 429, 500, 503]);

export function modelChain(model: string): string[] {
  const primary = model.trim().replace(/^models\//, '');
  return [primary, ...GEMINI_FALLBACK_MODELS.filter((m) => m !== primary)];
}

export function createGeminiClient(apiKey: string, model: string, opts: ClientOptions): LlmClient {
  return {
    async generateJson<T>(req: GenerateJsonRequest): Promise<T> {
      const body = JSON.stringify(buildGeminiBody(req));
      let firstError: unknown;
      for (const candidate of modelChain(model)) {
        try {
          const data = await fetchJsonWithRetry(
            `${GEMINI_BASE_URL}/models/${encodeURIComponent(candidate)}:generateContent`,
            { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body },
            // The chain itself is the retry strategy; keep per-model retries short.
            { ...opts, maxRetries: Math.min(opts.maxRetries ?? 1, 1) },
          );
          return parseAndValidate<T>(geminiText(data), req.schema);
        } catch (e) {
          firstError ??= e;
          if (!(e instanceof LlmError && e.status !== undefined && FALLBACK_STATUSES.has(e.status))) throw e;
        }
      }
      throw firstError;
    },
  };
}
