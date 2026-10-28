/**
 * Filler: writes an approved plan into the page, in order, honouring
 * dependencies (a child waits until its parent's handlers have revealed or
 * populated it). Never submits, never touches files, captcha or declarations.
 */
import type { FieldOption, FillReport, FillReportItem, FillStatus, PlanItem, Settings } from '@/shared/types';
import {
  dispatch,
  type FormControl,
  inputType,
  isDisabled,
  isFormControl,
  isInput,
  isSelect,
  isVisible,
  isWriteProtected,
  queryFid,
  setNativeValue,
} from './dom';
import { compactKey } from './text';
import { matchOption, realOptions } from './values';

export interface FillOptions {
  /** Document used to re-locate elements by data-ff-id. Defaults to the elements' document. */
  root?: Document;
  pollIntervalMs?: number;
}

type Outcome = { status: FillStatus; reason?: string };

const DEFAULT_TIMEOUT_MS = 3000;

export async function fillPlan(
  items: PlanItem[],
  elements: Map<string, Element>,
  settings: Pick<Settings, 'dependentFieldTimeoutMs'>,
  options: FillOptions = {},
): Promise<FillReport> {
  const doc = options.root ?? firstDocument(elements) ?? globalThis.document;
  const timeout = settings.dependentFieldTimeoutMs > 0 ? settings.dependentFieldTimeoutMs : DEFAULT_TIMEOUT_MS;
  const poll = options.pollIntervalMs ?? 100;
  const locate = (fid: string): FormControl[] => locateControls(fid, elements, doc);

  const statuses = new Map<string, FillStatus>();
  const report: FillReportItem[] = [];
  const record = (item: PlanItem, o: Outcome): void => {
    statuses.set(item.fid, o.status);
    report.push({ fid: item.fid, key: item.key, status: o.status, ...(o.reason ? { reason: o.reason } : {}) });
  };

  const ordered = items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.order - b.item.order || a.i - b.i)
    .map((x) => x.item);

  for (const item of ordered) {
    if (!item.enabled) {
      record(item, { status: 'skipped', reason: 'unticked in preview' });
      continue;
    }
    try {
      if (item.dependsOn) {
        const parent = statuses.get(item.dependsOn);
        if (parent === 'failed' || parent === 'skipped') {
          record(item, { status: 'skipped', reason: 'the field it depends on was not filled' });
          continue;
        }
        await waitFor(() => isReady(item, locate(item.fid)), timeout, doc, poll);
      }
      record(item, applyItem(item, locate(item.fid), !!item.dependsOn));
    } catch (e) {
      record(item, { status: 'failed', reason: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    items: report,
    filled: report.filter((r) => r.status === 'filled').length,
    failed: report.filter((r) => r.status === 'failed').length,
  };
}

function firstDocument(elements: Map<string, Element>): Document | undefined {
  for (const el of elements.values()) if (el.isConnected) return el.ownerDocument;
  return undefined;
}

/** Re-find controls by data-ff-id every time: pages may replace DOM nodes. */
function locateControls(fid: string, elements: Map<string, Element>, doc: Document): FormControl[] {
  const cached = elements.get(fid);
  let found: Element[] = [];
  if (cached?.isConnected) {
    found = queryFid(cached.getRootNode() as Document | ShadowRoot, fid);
    if (!found.length) found = [cached];
  } else {
    found = queryFid(doc, fid);
  }
  return found.filter(isFormControl);
}

function isReady(item: PlanItem, controls: FormControl[]): boolean {
  const el = controls[0];
  if (!el || !el.isConnected || isDisabled(el)) return false;
  const kind = inputType(el);
  if (kind !== 'checkbox' && kind !== 'radio' && !isVisible(el)) return false;
  if (isSelect(el)) return pickOption(el, item) !== null;
  return true;
}

/** Wait until `predicate` holds, watching DOM mutations with a polling fallback (shadow DOM, CSS changes). */
export function waitFor(predicate: () => boolean, timeoutMs: number, doc: Document, pollMs = 100): Promise<boolean> {
  const safe = (): boolean => {
    try {
      return predicate();
    } catch {
      return false;
    }
  };
  if (safe()) return Promise.resolve(true);
  const win = doc.defaultView ?? (globalThis as unknown as Window & typeof globalThis);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      observer?.disconnect();
      win.clearInterval(interval);
      win.clearTimeout(timer);
      resolve(ok);
    };
    const check = (): void => {
      if (safe()) finish(true);
    };
    const observer = typeof win.MutationObserver === 'function' ? new win.MutationObserver(check) : null;
    observer?.observe(doc.documentElement ?? doc, { subtree: true, childList: true, attributes: true });
    const interval = win.setInterval(check, pollMs);
    const timer = win.setTimeout(() => finish(safe()), timeoutMs);
  });
}

// ---------------------------------------------------------------------------
// Applying one item
// ---------------------------------------------------------------------------

function applyItem(item: PlanItem, controls: FormControl[], waited: boolean): Outcome {
  const el = controls[0];
  if (!el) return { status: 'failed', reason: 'field is no longer on the page' };
  if (isWriteProtected(el)) return { status: 'skipped', reason: 'protected field (file, captcha, declaration or system field)' };
  if (isDisabled(el)) {
    return { status: 'failed', reason: waited ? 'field stayed disabled' : 'field is disabled' };
  }
  const type = inputType(el);
  if (waited && type !== 'checkbox' && type !== 'radio' && !isVisible(el)) {
    return { status: 'failed', reason: 'field did not appear' };
  }
  if (type === 'checkbox' && isInput(el)) return applyCheckbox(el, item.value === 'true');
  if (type === 'radio') return applyRadio(controls, item);
  if (isSelect(el)) return applySelect(el, item);
  return applyText(el, item.value);
}

/** .click() (not .checked =) so inline onclick handlers run, and only when the state must change. */
function applyCheckbox(el: HTMLInputElement, desired: boolean): Outcome {
  if (el.checked === desired) return { status: 'unchanged' };
  el.click();
  if (el.checked !== desired) return { status: 'failed', reason: 'the page did not accept the change' };
  return { status: 'filled' };
}

function applyRadio(controls: FormControl[], item: PlanItem): Outcome {
  const radios = controls.filter(isInput);
  const target =
    radios.find((r) => r.value === item.value) ??
    radios.find((r) => compactKey(r.value) === compactKey(item.displayValue));
  if (!target) return { status: 'failed', reason: `option not found: ${item.displayValue}` };
  if (target.checked) return { status: 'unchanged' };
  if (isDisabled(target)) return { status: 'failed', reason: 'option is disabled' };
  target.click();
  return target.checked ? { status: 'filled' } : { status: 'failed', reason: 'the page did not accept the change' };
}

/**
 * Re-resolve against the options present *now*: dependent dropdowns are
 * populated after their parent changes, so the preview could only record the
 * intended text.
 */
function pickOption(el: HTMLSelectElement, item: PlanItem): HTMLOptionElement | null {
  const opts = Array.from(el.options).filter((o) => o.value !== '' && !o.disabled);
  const want = compactKey(item.displayValue);
  const byText = opts.find((o) => compactKey(o.text) === want);
  if (byText) return byText;
  const byValue = opts.find((o) => o.value === item.value);
  if (byValue) return byValue;
  const described: FieldOption[] = opts.map((o) => ({ value: o.value, text: o.text.trim() }));
  const m = matchOption(realOptions(described), item.displayValue);
  return m ? (opts.find((o) => o.value === m.option.value) ?? null) : null;
}

function applySelect(el: HTMLSelectElement, item: PlanItem): Outcome {
  const option = pickOption(el, item);
  if (!option) return { status: 'failed', reason: `option not found: ${item.displayValue}` };
  if (el.value === option.value) return { status: 'unchanged' };
  setControlValue(el, option.value);
  if (el.value !== option.value) return { status: 'failed', reason: 'the page did not accept the option' };
  return { status: 'filled' };
}

function applyText(el: FormControl, value: string): Outcome {
  if (el.value === value) return { status: 'unchanged' };
  setControlValue(el, value);
  if (el.value === '' && value !== '') return { status: 'failed', reason: 'value rejected by the field' };
  return { status: 'filled' };
}

/** Native setter, then input/change/blur so both frameworks and inline handlers see the change. */
function setControlValue(el: FormControl, value: string): void {
  setNativeValue(el, value);
  dispatch(el, 'input');
  dispatch(el, 'change');
  dispatch(el, 'blur');
}
