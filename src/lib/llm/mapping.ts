import type { FieldDescriptor, FieldMapping, ProfileKey } from '../../shared/types';
import type { JsonSchema, LlmClient } from './types';

export const MAX_FIELDS_PER_REQUEST = 120;
const MAX_OPTIONS = 15;

export const MAPPING_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['mappings'],
  properties: {
    mappings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['fid', 'key'],
        properties: {
          fid: { type: 'string' },
          key: { type: 'string', nullable: true },
          confidence: { type: 'number' },
        },
      },
    },
  },
};

export const MAPPING_SYSTEM = `You map web form fields to a fixed list of profile keys for a job application assistant.
You receive form field metadata (label, name, id, placeholder, section, kind, option texts) and the allowed keys.
For each field choose exactly one allowed key, or null if no key clearly fits. Never invent keys.
Use the section to disambiguate (e.g. SSC vs HSC vs Graduation, present vs permanent address, applicant vs father vs mother).
Labels may be English or Bangla. Select option texts hint at what the field holds (e.g. board names, districts).
Return {"mappings":[{"fid":"...","key":"..."|null,"confidence":0..1}]} with one entry per field.`;

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s;
}

/** Metadata-only view of a field. Deliberately excludes currentValue and anything profile-derived. */
export function describeField(f: FieldDescriptor): Record<string, unknown> {
  const out: Record<string, unknown> = {
    fid: f.fid,
    kind: f.kind,
    label: clip(f.label, 200),
    name: clip(f.name, 100),
    id: clip(f.id, 100),
    placeholder: clip(f.placeholder, 100),
    section: clip(f.section, 120),
  };
  if (f.options?.length) out.options = f.options.slice(0, MAX_OPTIONS).map((o) => clip(o.text, 60));
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Drop unknown fids/keys, clamp confidence, tag source 'llm'. Entries without a valid key are omitted. */
export function validateMappings(
  raw: unknown,
  fids: Set<string>,
  allowed: Set<ProfileKey>,
): FieldMapping[] {
  const list = (raw as { mappings?: unknown })?.mappings;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: FieldMapping[] = [];
  for (const item of list as Record<string, unknown>[]) {
    const fid = item?.fid;
    const key = item?.key;
    if (typeof fid !== 'string' || !fids.has(fid) || seen.has(fid)) continue;
    if (typeof key !== 'string' || !allowed.has(key)) continue;
    const c = typeof item.confidence === 'number' && Number.isFinite(item.confidence) ? item.confidence : 0.5;
    seen.add(fid);
    out.push({ fid, key, source: 'llm', confidence: Math.min(1, Math.max(0, c)) });
  }
  return out;
}

export async function mapFields(
  client: LlmClient,
  fields: FieldDescriptor[],
  keys: { key: ProfileKey; label: string }[],
): Promise<FieldMapping[]> {
  const allowed = new Set(keys.map((k) => k.key));
  const out: FieldMapping[] = [];
  for (const part of chunk(fields, MAX_FIELDS_PER_REQUEST)) {
    const user = JSON.stringify({ allowedKeys: keys, fields: part.map(describeField) });
    const raw = await client.generateJson<unknown>({ system: MAPPING_SYSTEM, user, schema: MAPPING_SCHEMA });
    out.push(...validateMappings(raw, new Set(part.map((f) => f.fid)), allowed));
  }
  return out;
}
