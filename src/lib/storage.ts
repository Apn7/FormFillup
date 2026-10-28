/**
 * Persistent state in `browser.storage.local`.
 *
 * Privacy note: the LLM API key is stored in `storage.local` together with the
 * settings. That area is private to this extension (web pages and other
 * extensions cannot read it) but it is NOT encrypted at rest, so anyone with
 * access to the browser profile on disk can read it. It is never synced
 * (`storage.sync` is not used) and never sent anywhere except the provider.
 */
import { emptyProfile, mergeProfile } from '../shared/profile';
import type { LlmProvider, Profile, Settings, SiteMappingCache } from '../shared/types';
import { sanitizeProfile } from './llm/sanitize';

const PROFILE_KEY = 'ff:profile';
const SETTINGS_KEY = 'ff:settings';
const MAPPINGS_KEY = 'ff:siteMappings';

export const DEFAULT_SETTINGS: Settings = {
  llm: {
    provider: 'gemini',
    apiKey: '',
    // Alias tracking the newest Flash-Lite (free tier). Verified live Oct 2026: answers structured JSON
    // in ~2 s, while the larger Flash models were overloaded (503) on the free tier. See gemini.ts fallbacks.
    model: 'gemini-flash-lite-latest',
    baseUrl: '',
  },
  useLlmForMapping: true,
  dependentFieldTimeoutMs: 3000,
};

const PROVIDERS: LlmProvider[] = ['gemini', 'openai-compatible', 'none'];

async function readKey(key: string): Promise<unknown> {
  const got = await browser.storage.local.get(key);
  return got[key];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Fill gaps and drop wrong-typed values so UI code never sees a malformed profile. */
export function normalizeProfile(raw: unknown): Profile {
  return { ...mergeProfile(emptyProfile(), sanitizeProfile(raw)), schemaVersion: 1 };
}

export function normalizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const r = isObj(raw) ? raw : {};
  const llm = isObj(r.llm) ? r.llm : {};
  const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
  const timeout = r.dependentFieldTimeoutMs;
  return {
    llm: {
      provider: PROVIDERS.includes(llm.provider as LlmProvider) ? (llm.provider as LlmProvider) : d.llm.provider,
      apiKey: str(llm.apiKey, d.llm.apiKey),
      model: str(llm.model, d.llm.model) || d.llm.model,
      baseUrl: str(llm.baseUrl, d.llm.baseUrl),
    },
    useLlmForMapping: typeof r.useLlmForMapping === 'boolean' ? r.useLlmForMapping : d.useLlmForMapping,
    dependentFieldTimeoutMs:
      typeof timeout === 'number' && Number.isFinite(timeout)
        ? Math.min(30_000, Math.max(0, Math.round(timeout)))
        : d.dependentFieldTimeoutMs,
  };
}

export async function getProfile(): Promise<Profile> {
  return normalizeProfile(await readKey(PROFILE_KEY));
}

export async function saveProfile(p: Profile): Promise<void> {
  await browser.storage.local.set({ [PROFILE_KEY]: normalizeProfile(p) });
}

export async function getSettings(): Promise<Settings> {
  return normalizeSettings(await readKey(SETTINGS_KEY));
}

export async function saveSettings(s: Settings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: normalizeSettings(s) });
}

async function getAllMappings(): Promise<SiteMappingCache> {
  const raw = await readKey(MAPPINGS_KEY);
  return isObj(raw) ? (raw as SiteMappingCache) : {};
}

export async function getSiteMappings(origin: string): Promise<SiteMappingCache[string]> {
  const entries = (await getAllMappings())[origin];
  return isObj(entries) ? entries : {};
}

export async function saveSiteMappings(origin: string, entries: SiteMappingCache[string]): Promise<void> {
  const all = await getAllMappings();
  all[origin] = entries;
  await browser.storage.local.set({ [MAPPINGS_KEY]: all });
}

/** Forget every learned per-site mapping. Profile and settings are untouched. */
export async function clearSiteMappings(): Promise<void> {
  await browser.storage.local.remove(MAPPINGS_KEY);
}

export function watchProfile(cb: (p: Profile) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && PROFILE_KEY in changes) cb(normalizeProfile(changes[PROFILE_KEY]?.newValue));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
