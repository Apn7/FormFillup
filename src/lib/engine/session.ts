/**
 * Content-script session: owns the last scan (so the fill step can find the
 * previewed elements) and turns protocol messages into engine calls.
 * Storage and messaging are injected, which keeps this module testable.
 */
import type { MessageMap, MessageType, Reply } from '@/shared/messages';
import { toReply } from '@/shared/messages';
import type { FieldDescriptor, FillReport, PreviewResult, Profile, Settings } from '@/shared/types';
import { fillPlan } from './filler';
import { clearHighlights, highlightPreview } from './highlight';
import { buildPreview, fieldSignature, type LlmMapFn, type SiteCacheEntries } from './planner';
import { PING_TYPE, type PingReply } from './protocol';
import { scanDocument } from './scanner';

export interface SessionDeps {
  doc: Document;
  getProfile(): Promise<Profile>;
  getSettings(): Promise<Settings>;
  getSiteMappings(origin: string): Promise<SiteCacheEntries>;
  saveSiteMappings(origin: string, entries: SiteCacheEntries): Promise<void>;
  llmMap: LlmMapFn;
}

/** Mapping sources worth remembering for the next visit (site and cache ones are already known). */
const LEARNABLE_SOURCES = new Set(['rule', 'llm', 'user']);

export interface Session {
  preview(req: MessageMap['ff:preview']['req']): Promise<PreviewResult>;
  fill(req: MessageMap['ff:fill']['req']): Promise<FillReport>;
  clear(): void;
  /** Reply for a recognised message, or undefined when the message is not for us. */
  handle(message: unknown): Promise<Reply<MessageType> | PingReply> | undefined;
}

export function createSession(deps: SessionDeps): Session {
  let lastElements = new Map<string, Element>();
  let lastFields: FieldDescriptor[] = [];
  const origin = (): string => deps.doc.location?.origin ?? new URL(deps.doc.URL).origin;

  async function preview(req: MessageMap['ff:preview']['req']): Promise<PreviewResult> {
    const [profile, settings, cache] = await Promise.all([
      deps.getProfile(),
      deps.getSettings(),
      deps.getSiteMappings(origin()).catch(() => ({}) as SiteCacheEntries),
    ]);
    const scan = scanDocument(deps.doc);
    const result = await buildPreview(deps.doc, profile, settings, cache, req.useLlm ? deps.llmMap : undefined, {
      scan,
    });
    lastElements = scan.elements;
    lastFields = scan.fields;
    highlightPreview(result, scan.elements, deps.doc);
    return result;
  }

  async function fill(req: MessageMap['ff:fill']['req']): Promise<FillReport> {
    const settings = await deps.getSettings();
    const report = await fillPlan(req.items, lastElements, settings, { root: deps.doc });
    await learn(req, report).catch(() => undefined); // learning is best effort
    return report;
  }

  async function learn(req: MessageMap['ff:fill']['req'], report: FillReport): Promise<void> {
    const ok = new Set(report.items.filter((r) => r.status === 'filled' || r.status === 'unchanged').map((r) => r.fid));
    const byFid = new Map(lastFields.map((f) => [f.fid, f]));
    const now = Date.now();
    const learned: SiteCacheEntries = {};
    for (const item of req.items) {
      const field = byFid.get(item.fid);
      if (!field || !ok.has(item.fid) || !LEARNABLE_SOURCES.has(item.source)) continue;
      learned[fieldSignature(field)] = { key: item.key, source: item.source, updatedAt: now };
    }
    if (!Object.keys(learned).length) return;
    const existing = await deps.getSiteMappings(origin()).catch(() => ({}) as SiteCacheEntries);
    await deps.saveSiteMappings(origin(), { ...existing, ...learned });
  }

  function clear(): void {
    clearHighlights(deps.doc);
  }

  function handle(message: unknown): Promise<Reply<MessageType> | PingReply> | undefined {
    if (!message || typeof message !== 'object') return undefined;
    const { type, payload } = message as { type?: unknown; payload?: unknown };
    switch (type) {
      case PING_TYPE:
        return Promise.resolve({ ok: true, data: { alive: true } });
      case 'ff:preview':
        return toReply<'ff:preview'>(() => preview((payload ?? { useLlm: false }) as MessageMap['ff:preview']['req']));
      case 'ff:fill':
        return toReply<'ff:fill'>(() => fill((payload ?? { items: [] }) as MessageMap['ff:fill']['req']));
      case 'ff:clear-highlights':
        return toReply<'ff:clear-highlights'>(async () => {
          clear();
          return { ok: true };
        });
      default:
        return undefined;
    }
  }

  return { preview, fill, clear, handle };
}
