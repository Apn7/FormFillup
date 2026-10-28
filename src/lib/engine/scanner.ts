/**
 * Scanner: walks a document (open shadow roots included) and describes every
 * fillable control as a serializable FieldDescriptor.
 *
 * Performance: the scan runs in three phases (collect, read, write) so that
 * tagging elements with data-ff-id never interleaves with style/layout reads.
 */
import type { FieldDescriptor, FieldKind, FieldOption } from '@/shared/types';
import {
  CAPTCHA_RE,
  FID_ATTR,
  type FormControl,
  inputType,
  isFormControl,
  isIgnoredControl,
  isInput,
  isSelect,
  isVisible,
  tagOf,
  textOf,
} from './dom';
import { cleanLabel, humanizeIdentifier, squish } from './text';

export interface ScanResult {
  fields: FieldDescriptor[];
  /** fid -> element. For radio groups, the first radio of the group. */
  elements: Map<string, Element>;
}

/** Monotonic across scans so a re-scan never reuses a fid for a different element. */
let fidCounter = 0;

const MAX_LABEL_LENGTH = 150;
const NEARBY_MAX_DEPTH = 5;
const CONTAINER_SELECTOR = '.form-group, .form-row, .form-field, .field, tr, li';
const BOUNDARY_TAGS = new Set(['form', 'fieldset', 'body', 'html', 'table']);

interface Collected {
  el: FormControl;
  heading: string;
}

interface RootIndex {
  labelFor: Map<string, HTMLLabelElement[]>;
}

export function scanDocument(root: Document | ShadowRoot = document): ScanResult {
  const collected: Collected[] = [];
  collect(root, { heading: '' }, collected);

  // Phase 2: reads only.
  const visibilityCache = new Map<Element, boolean>();
  const legendCache = new Map<Element, string>();
  const indexes = new Map<Node, RootIndex>();
  const radioGroups = new Map<string, { desc: FieldDescriptor; radios: HTMLInputElement[] }>();
  const pending: { desc: FieldDescriptor; els: Element[] }[] = [];

  for (const { el, heading } of collected) {
    const index = rootIndex(el, indexes);
    const type = inputType(el);
    if (type === 'radio' && isInput(el)) {
      const groupKey = radioGroupKey(el);
      const existing = radioGroups.get(groupKey);
      const option = { value: el.value, text: radioOptionText(el, index) };
      if (existing) {
        existing.desc.options?.push(option);
        existing.radios.push(el);
        if (el.checked) existing.desc.currentValue = el.value;
        if (el.required) existing.desc.required = true;
        if (!existing.desc.visible && isVisible(el, visibilityCache)) existing.desc.visible = true;
        continue;
      }
      const desc = describe(el, heading, index, visibilityCache, legendCache);
      desc.options = [option];
      desc.currentValue = el.checked ? el.value : '';
      const entry = { desc, radios: [el] };
      radioGroups.set(groupKey, entry);
      pending.push({ desc, els: entry.radios });
      continue;
    }
    const desc = describe(el, heading, index, visibilityCache, legendCache);
    if (CAPTCHA_RE.test(desc.label)) continue;
    pending.push({ desc, els: [el] });
  }

  // Phase 3: writes. Reuse an element's existing fid when it is unique, so a
  // re-scan keeps preview fids valid; otherwise allocate a fresh one.
  const used = new Set<string>();
  const fields: FieldDescriptor[] = [];
  const elements = new Map<string, Element>();
  for (const { desc, els } of pending) {
    const first = els[0];
    if (!first) continue;
    const prior = first.getAttribute(FID_ATTR);
    const fid = prior && !used.has(prior) && /^ff-\d+$/.test(prior) ? prior : `ff-${++fidCounter}`;
    used.add(fid);
    for (const e of els) e.setAttribute(FID_ATTR, fid);
    desc.fid = fid;
    fields.push(desc);
    elements.set(fid, first);
  }
  return { fields, elements };
}

// ---------------------------------------------------------------------------
// Phase 1: collection in document order, descending into open shadow roots.
// ---------------------------------------------------------------------------

function collect(root: Document | ShadowRoot, state: { heading: string }, out: Collected[]): void {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const tag = tagOf(el);
    if (/^h[1-6]$/.test(tag) || el.getAttribute('role') === 'heading') {
      const t = cleanLabel(textOf(el));
      if (t) state.heading = t;
    } else if (isFormControl(el) && !isIgnoredControl(el)) {
      out.push({ el, heading: state.heading });
    }
    if (el.shadowRoot) collect(el.shadowRoot, state, out);
  }
}

// ---------------------------------------------------------------------------
// Phase 2 helpers
// ---------------------------------------------------------------------------

function rootIndex(el: Element, cache: Map<Node, RootIndex>): RootIndex {
  const root = el.getRootNode() as Document | ShadowRoot;
  let idx = cache.get(root);
  if (!idx) {
    const labelFor = new Map<string, HTMLLabelElement[]>();
    for (const l of Array.from(root.querySelectorAll<HTMLLabelElement>('label[for]'))) {
      const key = l.htmlFor;
      const list = labelFor.get(key);
      if (list) list.push(l);
      else labelFor.set(key, [l]);
    }
    idx = { labelFor };
    cache.set(root, idx);
  }
  return idx;
}

function describe(
  el: FormControl,
  heading: string,
  index: RootIndex,
  visibilityCache: Map<Element, boolean>,
  legendCache: Map<Element, string>,
): FieldDescriptor {
  const desc: FieldDescriptor = {
    fid: '',
    kind: kindOf(el),
    name: el.getAttribute('name') ?? '',
    id: el.id,
    label: resolveLabel(el, index),
    placeholder: squish(el.getAttribute('placeholder') ?? ''),
    section: sectionOf(el, legendCache) || heading,
    autocomplete: (el.getAttribute('autocomplete') ?? '').trim().toLowerCase(),
    required: el.required || el.getAttribute('aria-required') === 'true',
    visible: isVisible(el, visibilityCache) || styledChoiceVisible(el, visibilityCache),
    currentValue: currentValueOf(el),
  };
  const maxLength = Number.parseInt(el.getAttribute('maxlength') ?? '', 10);
  if (maxLength > 0) desc.maxLength = maxLength;
  const min = el.getAttribute('min');
  const max = el.getAttribute('max');
  if (min) desc.min = min;
  if (max) desc.max = max;
  if (isSelect(el)) desc.options = selectOptions(el);
  return desc;
}

/** Custom-styled checkboxes/radios hide the input itself and show its label instead. */
function styledChoiceVisible(el: FormControl, cache: Map<Element, boolean>): boolean {
  const t = inputType(el);
  if (t !== 'checkbox' && t !== 'radio') return false;
  return Array.from(el.labels ?? []).some((l) => isVisible(l, cache));
}

function kindOf(el: FormControl): FieldKind {
  const tag = tagOf(el);
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textarea';
  switch (inputType(el)) {
    case 'text':
    case 'search':
    case 'url':
      return 'text';
    case 'number':
      return 'number';
    case 'email':
      return 'email';
    case 'tel':
      return 'tel';
    case 'date':
      return 'date';
    case 'checkbox':
      return 'checkbox';
    case 'radio':
      return 'radio';
    case 'file':
      return 'file';
    default:
      return isInput(el) && !el.getAttribute('type') ? 'text' : 'other';
  }
}

function currentValueOf(el: FormControl): string {
  if (isInput(el) && inputType(el) === 'checkbox') return el.checked ? 'true' : 'false';
  if (isInput(el) && inputType(el) === 'file') return '';
  return el.value;
}

function selectOptions(el: HTMLSelectElement): FieldOption[] {
  return Array.from(el.options).map((o) => ({ value: o.value, text: squish(o.text) }));
}

/**
 * Label resolution order: label[for] -> wrapping <label> -> aria-labelledby ->
 * aria-label -> nearby text (same row / form-group / table cell) -> placeholder -> name.
 */
function resolveLabel(el: FormControl, index: RootIndex): string {
  const isRadio = inputType(el) === 'radio';
  const candidates: (() => string)[] = [
    () => ariaLabelledBy(el),
    () => el.getAttribute('aria-label') ?? '',
  ];
  if (!isRadio) {
    // For radios, label[for]/wrapping label name the *option*, not the question.
    candidates.unshift(
      () => (el.id ? (index.labelFor.get(el.id) ?? []).map(textOf).join(' ') : ''),
      () => {
        const wrap = el.closest('label');
        return wrap ? textOf(wrap) : '';
      },
    );
  } else {
    candidates.push(() => radioGroupLabel(el));
  }
  candidates.push(
    () => nearbyText(el.closest('label') ?? el),
    () => containerLabel(el),
    () => el.getAttribute('placeholder') ?? '',
    () => humanizeIdentifier(el.getAttribute('name') ?? el.id),
  );
  for (const get of candidates) {
    const text = cleanLabel(get());
    if (text && text.length <= MAX_LABEL_LENGTH) return text;
  }
  return '';
}

function ariaLabelledBy(el: Element): string {
  const ids = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  if (!ids.length) return '';
  const root = el.getRootNode() as Document | ShadowRoot;
  return ids
    .map((id) => root.getElementById(id))
    .filter((n): n is HTMLElement => !!n)
    .map(textOf)
    .join(' ');
}

function radioGroupLabel(el: Element): string {
  const group = el.closest('[role="radiogroup"]');
  if (group) return ariaLabelledBy(group) || group.getAttribute('aria-label') || '';
  const fs = el.closest('fieldset');
  const legend = fs?.querySelector(':scope > legend');
  // Only a fieldset dedicated to this one radio group names the group.
  if (fs && legend && fs.querySelectorAll('input:not([type="radio"]), select, textarea').length === 0) {
    return textOf(legend);
  }
  return '';
}

/**
 * Nearest preceding text: walk previous siblings, then climb, stopping at form
 * boundaries or when a preceding sibling holds another control (whose label
 * that text would be).
 */
function nearbyText(start: Element): string {
  let node: Element | null = start;
  for (let depth = 0; node && depth < NEARBY_MAX_DEPTH; depth++) {
    for (let sib = node.previousSibling; sib; sib = sib.previousSibling) {
      if (sib.nodeType === 1) {
        const sibEl = sib as Element;
        const tag = tagOf(sibEl);
        if (tag === 'legend' || tag === 'script' || tag === 'style') continue;
        if (isFormControl(sibEl) || sibEl.querySelector('input:not([type="hidden"]), select, textarea')) return '';
      } else if (sib.nodeType !== 3) {
        continue;
      }
      const text = textOf(sib);
      if (text && text.length <= MAX_LABEL_LENGTH) return text;
    }
    node = node.parentElement;
    if (!node || BOUNDARY_TAGS.has(tagOf(node))) return '';
  }
  return '';
}

/** Fallback: the first label of the enclosing form-group / row / list item. */
function containerLabel(el: Element): string {
  const container = el.closest(CONTAINER_SELECTOR);
  const label = container?.querySelector('label');
  return label ? textOf(label) : '';
}

function sectionOf(el: Element, cache: Map<Element, string>): string {
  const fs = el.closest('fieldset');
  if (!fs) return '';
  const cached = cache.get(fs);
  if (cached !== undefined) return cached;
  const legend = fs.querySelector(':scope > legend');
  const text = legend ? cleanLabel(textOf(legend)) : '';
  cache.set(fs, text);
  return text;
}

function radioGroupKey(el: HTMLInputElement): string {
  if (!el.name) return `#${formKey(el)}`;
  const owner = el.form ?? (el.getRootNode() as Node);
  return `${formKey(owner)}|${el.name}`;
}

const ownerKeys = new WeakMap<object, string>();
let ownerCounter = 0;
function formKey(owner: object): string {
  let k = ownerKeys.get(owner);
  if (!k) {
    k = `o${++ownerCounter}`;
    ownerKeys.set(owner, k);
  }
  return k;
}

function radioOptionText(el: HTMLInputElement, index: RootIndex): string {
  const byFor = el.id ? (index.labelFor.get(el.id) ?? []).map(textOf).join(' ') : '';
  const wrap = el.closest('label');
  let text = byFor || (wrap ? textOf(wrap) : '');
  if (!text) {
    const next = el.nextSibling;
    text = next && next.nodeType === 3 ? (next.nodeValue ?? '') : '';
  }
  return cleanLabel(text) || el.value;
}
