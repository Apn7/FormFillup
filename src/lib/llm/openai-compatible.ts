import { fetchJsonWithRetry } from './http';
import { parseAndValidate } from './json';
import { LlmError, type ClientOptions, type GenerateJsonRequest, type LlmClient } from './types';

interface ChatResponse {
  choices?: { finish_reason?: string; message?: { content?: string | null } }[];
}

export function chatText(data: unknown): string {
  const choice = (data as ChatResponse).choices?.[0];
  const text = choice?.message?.content;
  if (!text) throw new LlmError('The AI returned an empty answer. Try again or use another model.');
  if (choice?.finish_reason === 'length') throw new LlmError('The AI answer was cut off. Try fewer documents.');
  return text;
}

export function buildChatBody(model: string, req: GenerateJsonRequest, jsonMode: boolean): Record<string, unknown> {
  for (const f of req.files ?? []) {
    if (!f.mimeType.startsWith('image/')) {
      throw new LlmError('This provider cannot read PDFs. Use Gemini for PDF documents, or upload images instead.');
    }
  }
  const schemaText = `Reply with a single JSON object matching this JSON schema, and nothing else:\n${JSON.stringify(req.schema)}`;
  const content: unknown = req.files?.length
    ? [
        { type: 'text', text: req.user },
        ...req.files.map((f) => ({ type: 'image_url', image_url: { url: `data:${f.mimeType};base64,${f.base64}` } })),
      ]
    : req.user;
  const body: Record<string, unknown> = {
    model,
    temperature: 0,
    messages: [
      { role: 'system', content: `${req.system}\n\n${schemaText}` },
      { role: 'user', content },
    ],
  };
  if (jsonMode) body.response_format = { type: 'json_object' };
  return body;
}

export function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/chat/completions`;
}

export function createOpenAiCompatibleClient(
  apiKey: string,
  model: string,
  baseUrl: string,
  opts: ClientOptions,
): LlmClient {
  const post = (body: Record<string, unknown>) =>
    fetchJsonWithRetry(
      chatCompletionsUrl(baseUrl),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify(body),
      },
      opts,
    );
  return {
    async generateJson<T>(req: GenerateJsonRequest): Promise<T> {
      let data: unknown;
      try {
        data = await post(buildChatBody(model, req, true));
      } catch (e) {
        // Some models/endpoints reject response_format; the schema is also in the prompt, so retry without it.
        if (!(e instanceof LlmError) || e.status !== 400) throw e;
        data = await post(buildChatBody(model, req, false));
      }
      return parseAndValidate<T>(chatText(data), req.schema);
    },
  };
}
