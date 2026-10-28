/**
 * Preview outlines. Uses `outline` (not border) so nothing shifts; the
 * previous inline outline is saved and restored on clear.
 */
import type { PreviewResult } from '@/shared/types';
import { queryFid } from './dom';

const HL_ATTR = 'data-ff-hl';
const PREV_ATTR = 'data-ff-prev-outline';

export const HIGHLIGHT_COLORS = {
  high: '#16a34a', // green: confident
  low: '#d97706', // amber: low confidence / LLM
  missing: '#dc2626', // red: required but unmatched
} as const;

export const HIGH_CONFIDENCE = 0.85;

type Level = keyof typeof HIGHLIGHT_COLORS;

/** Elements outlined so far, including ones inside shadow roots that document queries cannot reach. */
const outlined = new Set<HTMLElement>();

export function highlightPreview(
  preview: Pick<PreviewResult, 'plan' | 'unmatched' | 'fields'>,
  elements: Map<string, Element>,
  doc: Document = document,
): void {
  clearHighlights(doc);
  for (const item of preview.plan) {
    outline(item.fid, item.confidence >= HIGH_CONFIDENCE ? 'high' : 'low', elements, doc);
  }
  const required = new Set(preview.fields.filter((f) => f.required).map((f) => f.fid));
  for (const u of preview.unmatched) {
    if (required.has(u.fid)) outline(u.fid, 'missing', elements, doc);
  }
}

function outline(fid: string, level: Level, elements: Map<string, Element>, doc: Document): void {
  const anchor = elements.get(fid);
  const root = anchor?.isConnected ? (anchor.getRootNode() as Document | ShadowRoot) : doc;
  for (const el of queryFid(root, fid)) {
    const h = el as HTMLElement;
    if (!h.style) continue;
    if (!h.hasAttribute(HL_ATTR)) h.setAttribute(PREV_ATTR, h.style.outline + '|' + h.style.outlineOffset);
    h.setAttribute(HL_ATTR, level);
    h.style.outline = `2px solid ${HIGHLIGHT_COLORS[level]}`;
    h.style.outlineOffset = '1px';
    outlined.add(h);
  }
}

export function clearHighlights(doc: Document = document): void {
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>(`[${HL_ATTR}]`))) outlined.add(el);
  for (const el of outlined) {
    const [prevOutline = '', prevOffset = ''] = (el.getAttribute(PREV_ATTR) ?? '|').split('|');
    el.style.outline = prevOutline;
    el.style.outlineOffset = prevOffset;
    el.removeAttribute(HL_ATTR);
    el.removeAttribute(PREV_ATTR);
  }
  outlined.clear();
}
