import { LlmError, type JsonSchema } from './types';

/** Parse model output as JSON, tolerating code fences and surrounding prose. */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidates = [trimmed];
  if (fenced?.[1]) candidates.push(fenced[1]);
  const start = trimmed.search(/[[{]/);
  const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* try next candidate */
    }
  }
  throw new LlmError('The AI returned an answer that could not be read as JSON. Try again.');
}

function typeOk(schema: JsonSchema, v: unknown): boolean {
  switch (schema.type) {
    case 'object':
      return typeof v === 'object' && v !== null && !Array.isArray(v);
    case 'array':
      return Array.isArray(v);
    case 'string':
      return typeof v === 'string';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'integer':
      return Number.isInteger(v);
    case 'boolean':
      return typeof v === 'boolean';
  }
}

/** Returns a list of problems (empty when valid). Hand-written validator for the JsonSchema subset. */
export function validateJson(schema: JsonSchema, value: unknown, path = '$'): string[] {
  if (value === null || value === undefined) return schema.nullable ? [] : [`${path}: missing`];
  if (!typeOk(schema, value)) return [`${path}: expected ${schema.type}`];
  if (schema.enum && !schema.enum.includes(value as string)) return [`${path}: not an allowed value`];
  const problems: string[] = [];
  if (schema.type === 'object') {
    const obj = value as Record<string, unknown>;
    for (const k of schema.required ?? []) {
      if (obj[k] === undefined) problems.push(`${path}.${k}: required`);
    }
    for (const [k, sub] of Object.entries(schema.properties ?? {})) {
      if (obj[k] !== undefined) problems.push(...validateJson(sub, obj[k], `${path}.${k}`));
    }
  } else if (schema.type === 'array' && schema.items) {
    (value as unknown[]).forEach((item, i) => problems.push(...validateJson(schema.items!, item, `${path}[${i}]`)));
  }
  return problems;
}

/** Parse text and validate against the schema; throws a user-safe LlmError. */
export function parseAndValidate<T>(text: string, schema: JsonSchema): T {
  const value = parseJsonLoose(text);
  const problems = validateJson(schema, value);
  if (problems.length) {
    throw new LlmError(`The AI answer did not match the expected format (${problems[0]}). Try again.`);
  }
  return value as T;
}
