import { teletalkAdapter } from './teletalk';
import type { SiteAdapter } from './types';

export type { AdapterIgnore, AdapterMapping, AdapterResult, ParentValue, SiteAdapter } from './types';
export { isIgnore } from './types';
export { teletalkAdapter } from './teletalk';

/** Registered site adapters, most specific first. */
export const ADAPTERS: readonly SiteAdapter[] = [teletalkAdapter];

export function pickAdapter(url: string, doc: Document): SiteAdapter | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return ADAPTERS.find((a) => a.matches(parsed, doc)) ?? null;
}
