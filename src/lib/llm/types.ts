/** Subset of JSON Schema that both Gemini (responseSchema) and our validator understand. */
export interface JsonSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  nullable?: boolean;
}

export interface LlmFile {
  mimeType: string;
  base64: string;
}

export interface GenerateJsonRequest {
  system: string;
  user: string;
  files?: LlmFile[];
  schema: JsonSchema;
}

export interface LlmClient {
  generateJson<T>(req: GenerateJsonRequest): Promise<T>;
}

/** Error whose message is safe and meant to be shown to the user. Never contains keys or document content. */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface ClientOptions {
  timeoutMs: number;
  maxRetries?: number;
  baseDelayMs?: number;
}
