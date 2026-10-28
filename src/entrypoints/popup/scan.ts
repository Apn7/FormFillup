/** Pure helpers for the popup. */
import type { PlanItem } from '@/shared/types';

const RESTRICTED_PREFIXES = [
  'chrome://', 'chrome-extension://', 'chrome-search://', 'edge://', 'brave://', 'opera://', 'vivaldi://',
  'about:', 'moz-extension://', 'view-source:', 'devtools://', 'file:///', 'data:', 'blob:',
];
const RESTRICTED_HOSTS = ['chromewebstore.google.com', 'addons.mozilla.org', 'microsoftedge.microsoft.com'];

export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  const u = url.toLowerCase();
  if (u.startsWith('file:///')) return false; // may work if the user enabled file access; the engine will report otherwise
  if (RESTRICTED_PREFIXES.some((p) => u.startsWith(p))) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
    if (RESTRICTED_HOSTS.includes(parsed.hostname)) return true;
    if (parsed.hostname === 'chrome.google.com' && parsed.pathname.startsWith('/webstore')) return true;
  } catch {
    return true;
  }
  return false;
}

export function hostnameOf(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname || url : '';
  } catch {
    return '';
  }
}

export const LOW_CONFIDENCE = 0.6;

export function confidenceTone(c: number): 'good' | 'warn' | 'bad' {
  return c >= 0.85 ? 'good' : c >= LOW_CONFIDENCE ? 'warn' : 'bad';
}

export const SOURCE_LABEL: Record<string, string> = { site: 'Site', cache: 'Cache', rule: 'Rule', llm: 'AI', user: 'You' };

/** Initial ticks: respect the engine's `enabled`, but untick low-confidence matches. */
export function initialSelection(plan: PlanItem[]): Record<string, boolean> {
  return Object.fromEntries(plan.map((p) => [p.fid, p.enabled && p.confidence >= LOW_CONFIDENCE]));
}

export function groupBySection<T extends { section: string }>(items: T[]): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = it.section.trim() || 'Other';
    const list = map.get(k);
    if (list) list.push(it);
    else map.set(k, [it]);
  }
  return [...map.entries()];
}

export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/Cannot access|cannot be scripted|extensions gallery|chrome:\/\/|Missing host permission|activeTab/i.test(msg))
    return "This page can't be filled. Browser pages and extension stores are off limits; open the job application form and try again.";
  if (/Receiving end does not exist|Could not establish connection|No response/i.test(msg))
    return 'Could not reach the page. Reload the tab and try again. If the form was opened by a POST (Teletalk), walk through the pages again first.';
  return msg;
}
