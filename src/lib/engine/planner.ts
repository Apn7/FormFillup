/**
 * Planner: scan -> match (site adapter -> site cache -> rules -> optional LLM)
 * -> resolve values -> dependencies and order -> PreviewResult.
 *
 * Writes nothing to the page. One bad field never aborts the preview: problems
 * become `unmatched` entries or `warnings`.
 */
import type {
  FieldDescriptor,
  FieldMapping,
  MatchSource,
  PlanItem,
  PreviewResult,
  Profile,
  ProfileKey,
  Settings,
  SiteMappingCache,
} from '@/shared/types';
import { profileKeyCatalog } from '@/shared/profile';
import { isIgnore, pickAdapter, type ParentValue } from './adapters';
import { DECLARATION_RE } from './dom';
import { matchRule } from './rules';
import { scanDocument, type ScanResult } from './scanner';
import { normalizeForMatch } from './text';
import { ENGINE_EXTRA_KEYS, resolveValue, type Resolution, type ValueTransform } from './values';

export type SiteCacheEntries = SiteMappingCache[string];

/** Injected by the content script; forwards to the background via `ff:llm-map`. */
export type LlmMapFn = (
  fields: FieldDescriptor[],
  keys: { key: ProfileKey; label: string }[],
) => Promise<FieldMapping[]>;

export interface BuildOptions {
  /** Page URL used for adapter selection; defaults to doc.URL. */
  url?: string;
  /** Reuse an existing scan (the content script keeps its elements for the fill step). */
  scan?: ScanResult;
}

const CACHE_CONFIDENCE = 0.9;
const LLM_MAX_CONFIDENCE = 0.8;
const MAX_JOBS = 10;

/** Stable identity of a field across visits, for the per-origin mapping cache. */
export function fieldSignature(f: Pick<FieldDescriptor, 'name' | 'id' | 'label' | 'section'>): string {
  return [f.name, f.id, f.label, f.section].map(normalizeForMatch).join('|');
}

/** All keys the engine can fill: the shared catalog, engine-computed extras and the user's `extra.*` keys. */
export function allowedKeys(profile?: Profile): { key: ProfileKey; label: string }[] {
  return [
    ...profileKeyCatalog(MAX_JOBS),
    ...Object.entries(ENGINE_EXTRA_KEYS).map(([key, label]) => ({ key, label })),
    ...Object.keys(profile?.extra ?? {}).map((k) => ({ key: `extra.${k}`, label: `Custom field: ${k}` })),
  ];
}

export function llmEnabled(settings: Settings): boolean {
  return settings.useLlmForMapping && settings.llm.provider !== 'none' && settings.llm.apiKey.trim() !== '';
}

// ---------------------------------------------------------------------------
// Generic dependencies between profile keys (used when no adapter says otherwise)
// ---------------------------------------------------------------------------

const isYes = (p: ParentValue): boolean => p.value === 'true' || /^(yes|y|1|হ্যাঁ)$/i.test(p.displayValue.trim());
const isChecked = (p: ParentValue): boolean => p.value === 'true';
const isUnchecked = (p: ParentValue): boolean => p.value !== 'true';

interface KeyDependency {
  child: RegExp;
  parent: (childKey: ProfileKey) => ProfileKey;
  activeWhen?: (p: ParentValue) => boolean;
}

/** First matching entry wins. */
const KEY_DEPENDENCIES: readonly KeyDependency[] = [
  { child: /^(present|permanent)Address\.upazila$/, parent: (k) => k.replace(/upazila$/, 'district') },
  { child: /^permanentAddress\./, parent: () => 'permanentSameAsPresent', activeWhen: isUnchecked },
  { child: /^education\.\w+\.(group|subject)$/, parent: (k) => k.replace(/\.\w+$/, '.exam') },
  { child: /^education\.\w+\.result$/, parent: (k) => k.replace(/result$/, 'resultScale') },
  { child: /^education\.masters\.(?!applicable$)/, parent: () => 'education.masters.applicable', activeWhen: isChecked },
  { child: /^ids\.nid$/, parent: () => 'ids.hasNid', activeWhen: isYes },
  { child: /^ids\.birthReg$/, parent: () => 'ids.hasBirthReg', activeWhen: isYes },
  { child: /^ids\.passport$/, parent: () => 'ids.hasPassport', activeWhen: isYes },
  { child: /^personal\.spouseName$/, parent: () => 'personal.maritalStatus', activeWhen: (p) => /married/i.test(p.displayValue) && !/un/i.test(p.displayValue) },
  { child: /^quotaDetails$/, parent: () => 'quota', activeWhen: (p) => !/not applicable|^none$|^no$/i.test(p.displayValue) },
  { child: /^experience\.\d+\.endDate$/, parent: (k) => k.replace(/endDate$/, 'currentlyWorking'), activeWhen: isUnchecked },
  { child: /^experience\.\d+\./, parent: () => 'experience.applicable', activeWhen: isChecked },
];

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

type DraftState = 'unmapped' | 'planned' | 'unmatched' | 'inactive' | 'skipped';

interface Draft {
  index: number;
  field: FieldDescriptor;
  key?: ProfileKey;
  source?: MatchSource;
  confidence: number;
  order?: number;
  parentName?: string;
  parentFid?: string;
  activeWhen?: (p: ParentValue) => boolean;
  transform?: ValueTransform;
  resolution?: Resolution;
  state: DraftState;
  reason?: string;
}

function labelOf(f: FieldDescriptor): string {
  return f.label || f.name || f.id || f.fid;
}

export async function buildPreview(
  doc: Document,
  profile: Profile,
  settings: Settings,
  siteCache: SiteCacheEntries | undefined,
  llmMap?: LlmMapFn,
  options: BuildOptions = {},
): Promise<PreviewResult> {
  const url = options.url ?? doc.URL;
  const scan = options.scan ?? scanDocument(doc);
  const warnings: string[] = [];
  const adapter = pickAdapter(url, doc);

  const drafts: Draft[] = scan.fields.map((field, index) => ({ index, field, confidence: 0, state: 'unmapped' }));

  for (const d of drafts) {
    try {
      mapDraft(d, adapter, siteCache);
    } catch (e) {
      d.state = 'unmatched';
      d.reason = 'internal error while matching';
      warnings.push(`${labelOf(d.field)}: ${errorText(e)}`);
    }
  }

  let llmUsed = false;
  if (llmMap && llmEnabled(settings)) {
    llmUsed = await mapWithLlm(drafts, llmMap, allowedKeys(profile), warnings);
  }

  const allowed = new Set(allowedKeys(profile).map((k) => k.key));
  for (const d of drafts) {
    if (d.key && !allowed.has(d.key)) {
      warnings.push(`${labelOf(d.field)}: ignored unknown profile key "${d.key}"`);
      d.key = undefined;
      d.state = 'unmapped';
    }
  }

  linkParents(drafts);

  for (const d of drafts) {
    if (d.state !== 'unmapped') continue;
    if (!d.key) {
      d.state = 'unmatched';
      d.reason = 'no mapping';
      continue;
    }
    try {
      const res = resolveValue(profile, d.key, d.field, {
        transform: d.transform,
        allowDeferredOption: !!d.parentFid && d.field.kind === 'select',
      });
      d.resolution = res;
      if (res.ok) {
        d.state = 'planned';
        for (const w of res.warnings) warnings.push(`${labelOf(d.field)}: ${w}`);
      } else {
        d.state = 'unmatched';
        d.reason = res.reason;
      }
    } catch (e) {
      d.state = 'unmatched';
      d.reason = 'could not resolve value';
      warnings.push(`${labelOf(d.field)}: ${errorText(e)}`);
    }
  }

  // Hidden fields that nothing reveals are not part of the visible form.
  for (const d of drafts) {
    if ((d.state === 'planned' || d.state === 'unmatched') && !d.field.visible && !d.parentFid) {
      d.state = 'skipped';
      d.reason = 'hidden';
    }
  }

  guardSameAsPresent(drafts, warnings);
  applyActivation(drafts);
  const plan = buildPlan(drafts);

  const unmatched = drafts
    .filter((d) => d.state === 'unmatched')
    .map((d) => ({ fid: d.field.fid, label: labelOf(d.field), section: d.field.section, reason: d.reason ?? 'no mapping' }));

  return { url, fields: scan.fields, plan, unmatched, llmUsed, warnings };
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function mapDraft(d: Draft, adapter: ReturnType<typeof pickAdapter>, siteCache: SiteCacheEntries | undefined): void {
  const f = d.field;
  if (f.kind === 'file') {
    d.state = f.visible ? 'unmatched' : 'skipped';
    d.reason = 'file upload: attach it yourself';
    return;
  }
  if (f.kind === 'checkbox' && DECLARATION_RE.test(`${f.name} ${f.id} ${f.label}`)) {
    d.state = f.visible ? 'unmatched' : 'skipped';
    d.reason = 'declaration: tick it yourself';
    return;
  }
  const site = adapter?.map(f) ?? null;
  if (isIgnore(site)) {
    d.state = 'skipped';
    d.reason = site.ignore;
    return;
  }
  if (site) {
    Object.assign(d, {
      key: site.key,
      source: 'site',
      confidence: 1,
      order: site.order,
      parentName: site.dependsOn,
      activeWhen: site.activeWhen,
      transform: site.transform,
    } satisfies Partial<Draft>);
    return;
  }
  const cached = siteCache?.[fieldSignature(f)];
  if (cached) {
    d.key = cached.key;
    d.source = 'cache';
    d.confidence = CACHE_CONFIDENCE;
    return;
  }
  const rule = matchRule(f);
  if (rule) {
    d.key = rule.key;
    d.source = 'rule';
    d.confidence = rule.confidence;
  }
}

async function mapWithLlm(
  drafts: Draft[],
  llmMap: LlmMapFn,
  keys: { key: ProfileKey; label: string }[],
  warnings: string[],
): Promise<boolean> {
  const pending = drafts.filter((d) => d.state === 'unmapped' && !d.key && d.field.visible);
  if (!pending.length) return false;
  // Field metadata only: never send what is currently typed in the page.
  const fields = pending.map((d) => ({ ...d.field, currentValue: '' }));
  try {
    const mappings = await llmMap(fields, keys);
    const byFid = new Map(pending.map((d) => [d.field.fid, d]));
    for (const m of mappings) {
      const d = byFid.get(m.fid);
      if (!d || !m.key) continue;
      d.key = m.key;
      d.source = 'llm';
      d.confidence = Math.max(0, Math.min(LLM_MAX_CONFIDENCE, Number(m.confidence) || 0));
    }
    return true;
  } catch (e) {
    warnings.push(`LLM mapping failed: ${errorText(e)}`);
    return false;
  }
}

function linkParents(drafts: Draft[]): void {
  const byName = new Map<string, Draft>();
  const byKey = new Map<ProfileKey, Draft>();
  for (const d of drafts) {
    if (d.field.name && !byName.has(d.field.name)) byName.set(d.field.name, d);
    if (d.key && !byKey.has(d.key)) byKey.set(d.key, d);
  }
  for (const d of drafts) {
    if (!d.key) continue;
    if (d.parentName) {
      const parent = byName.get(d.parentName);
      if (parent && parent !== d) d.parentFid = parent.field.fid;
      continue;
    }
    if (d.source === 'site') continue;
    const dep = KEY_DEPENDENCIES.find((k) => k.child.test(d.key!));
    if (!dep) continue;
    const parent = byKey.get(dep.parent(d.key));
    if (parent && parent !== d) {
      d.parentFid = parent.field.fid;
      d.activeWhen = dep.activeWhen;
    }
  }
}

/**
 * Pages usually validate the present address when "same as present" is ticked
 * (Teletalk shows an alert()). With an incomplete present address, leave the
 * box unticked and fill the permanent address fields instead.
 */
function guardSameAsPresent(drafts: Draft[], warnings: string[]): void {
  const same = drafts.find((d) => d.key === 'permanentSameAsPresent' && d.state === 'planned');
  if (!same?.resolution?.ok || same.resolution.value !== 'true') return;
  const missing = drafts.filter((d) => d.key?.startsWith('presentAddress.') && d.state === 'unmatched');
  if (!missing.length) return;
  same.resolution = { ...same.resolution, value: 'false', displayValue: 'Unchecked' };
  warnings.push(
    `"${labelOf(same.field)}" left unticked because the present address is incomplete (${missing
      .map((d) => labelOf(d.field))
      .join(', ')}); the permanent address is filled separately.`,
  );
}

/**
 * Children whose parent will not be filled, or whose parent's value does not
 * reveal them ("No", "Single", unchecked), are dropped silently: they are not
 * missing information, they are not applicable.
 */
function applyActivation(drafts: Draft[]): void {
  const byFid = new Map(drafts.map((d) => [d.field.fid, d]));
  const memo = new Map<Draft, boolean>();

  const isActive = (d: Draft, depth = 0): boolean => {
    const known = memo.get(d);
    if (known !== undefined) return known;
    let active = d.state === 'planned' || d.state === 'unmatched';
    const parent = d.parentFid ? byFid.get(d.parentFid) : undefined;
    if (active && parent && depth < 20) {
      const parentFilled = parent.state === 'planned' && isActive(parent, depth + 1);
      if (!parentFilled) {
        const standalone = d.state === 'planned' && d.field.visible && d.resolution?.ok && !d.resolution.deferred;
        if (standalone) {
          d.parentFid = undefined;
        } else {
          active = false;
          d.reason = `depends on "${labelOf(parent.field)}", which will not be filled`;
        }
      } else if (d.activeWhen && parent.resolution?.ok) {
        const pv = { value: parent.resolution.value, displayValue: parent.resolution.displayValue };
        if (!d.activeWhen(pv)) {
          active = false;
          d.reason = `not applicable (${labelOf(parent.field)}: ${pv.displayValue})`;
        }
      }
    }
    if (!active && (d.state === 'planned' || d.state === 'unmatched')) d.state = 'inactive';
    memo.set(d, active);
    return active;
  };
  for (const d of drafts) isActive(d);
}

function buildPlan(drafts: Draft[]): PlanItem[] {
  const planned = drafts.filter((d) => d.state === 'planned');
  const byFid = new Map(planned.map((d) => [d.field.fid, d]));
  // Unordered fields follow the adapter's explicit order, in document order.
  const rank = new Map(planned.map((d) => [d, d.order ?? 1000 + d.index]));

  // Parents strictly before children (bounded relaxation; dependency chains are short).
  for (let pass = 0; pass < planned.length; pass++) {
    let changed = false;
    for (const d of planned) {
      const parent = d.parentFid ? byFid.get(d.parentFid) : undefined;
      if (!parent) continue;
      const pr = rank.get(parent)!;
      if (rank.get(d)! <= pr) {
        rank.set(d, pr + 0.001);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const sorted = [...planned].sort((a, b) => rank.get(a)! - rank.get(b)! || a.index - b.index);
  return sorted.map((d, i): PlanItem => {
    const res = d.resolution as Extract<Resolution, { ok: true }>;
    const item: PlanItem = {
      fid: d.field.fid,
      key: d.key!,
      label: labelOf(d.field),
      section: d.field.section,
      value: res.value,
      displayValue: res.displayValue,
      source: d.source ?? 'rule',
      confidence: Math.round(Math.min(d.confidence, res.confidence) * 100) / 100,
      order: i + 1,
      enabled: true,
    };
    if (d.parentFid && byFid.has(d.parentFid)) item.dependsOn = d.parentFid;
    return item;
  });
}
