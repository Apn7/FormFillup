import type { FieldDescriptor, ProfileKey } from '@/shared/types';
import type { ValueTransform } from '../values';

/** The parent's resolved plan value, passed to `activeWhen`. */
export interface ParentValue {
  value: string;
  displayValue: string;
}

export interface AdapterMapping {
  key: ProfileKey;
  /** Fill order; lower runs first. Unset: document order after all ordered fields. */
  order?: number;
  /** `name` attribute of the field that must be filled first (it reveals or populates this one). */
  dependsOn?: string;
  /** Fill only when the parent's planned value satisfies this (default: always). */
  activeWhen?: (parent: ParentValue) => boolean;
  transform?: ValueTransform;
}

/** The adapter recognises the field and deliberately leaves it alone. */
export interface AdapterIgnore {
  ignore: string;
}

export type AdapterResult = AdapterMapping | AdapterIgnore | null;

export interface SiteAdapter {
  id: string;
  matches(url: URL, doc: Document): boolean;
  /** Exact mapping for a field, an explicit ignore, or null to fall through to cache/rules. */
  map(field: FieldDescriptor): AdapterResult;
}

export function isIgnore(r: AdapterResult): r is AdapterIgnore {
  return !!r && 'ignore' in r;
}
