/**
 * DOM helpers for the engine. Everything here is realm-agnostic: constructors
 * and globals are taken from the element's own window, so the code works in
 * content-script isolated worlds and against separate jsdom windows in tests.
 */
import { squish } from './text';

export const FID_ATTR = 'data-ff-id';

export type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const DEBUG_FLAG = '__FORMFILLUP_DEBUG__';

/** Debug logger, silent unless `globalThis.__FORMFILLUP_DEBUG__ = true`. */
export function debug(...args: unknown[]): void {
  if ((globalThis as Record<string, unknown>)[DEBUG_FLAG] === true) {
    console.debug('[FormFillup]', ...args);
  }
}

export function winOf(node: Node): Window & typeof globalThis {
  const win = (node.ownerDocument ?? (node as Document)).defaultView;
  return (win ?? globalThis) as Window & typeof globalThis;
}

export function tagOf(el: Element): string {
  return el.tagName.toLowerCase();
}

export function isFormControl(el: Element): el is FormControl {
  const t = tagOf(el);
  return t === 'input' || t === 'select' || t === 'textarea';
}

export function isSelect(el: Element): el is HTMLSelectElement {
  return tagOf(el) === 'select';
}

export function isInput(el: Element): el is HTMLInputElement {
  return tagOf(el) === 'input';
}

export function inputType(el: Element): string {
  return isInput(el) ? (el.getAttribute('type') ?? 'text').toLowerCase() : tagOf(el);
}

/** Input types the engine never reads or writes. */
const IGNORED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset', 'password']);

export const CAPTCHA_RE = /captcha|verification\s*code|security\s*code|\botp\b|one[-\s]?time\s*pass/i;
export const DECLARATION_RE = /\bagree|declar|consent|terms|i\s+certify|i\s+confirm|accept/i;

/** Text of every <label> associated with a control (label[for] and wrapping label). */
export function labelsText(el: FormControl): string {
  const labels = el.labels ? Array.from(el.labels) : [];
  return squish(labels.map((l) => l.textContent ?? '').join(' '));
}

/**
 * Hard safety guard, used by both scanner and filler: controls the engine must
 * never touch (hidden system inputs, buttons, passwords, captcha/OTP).
 * File inputs are scanned (to report "attach manually") but never written.
 */
export function isIgnoredControl(el: FormControl): boolean {
  if (isInput(el) && IGNORED_INPUT_TYPES.has(inputType(el))) return true;
  const ident = `${el.getAttribute('name') ?? ''} ${el.id} ${el.getAttribute('placeholder') ?? ''}`;
  return CAPTCHA_RE.test(ident) || CAPTCHA_RE.test(labelsText(el));
}

/** Declaration / terms checkboxes: the user ticks those, never the extension. */
export function isDeclarationCheckbox(el: FormControl): boolean {
  if (inputType(el) !== 'checkbox') return false;
  return DECLARATION_RE.test(`${el.getAttribute('name') ?? ''} ${el.id}`) || DECLARATION_RE.test(labelsText(el));
}

/** Controls the filler must refuse to write regardless of what the plan says. */
export function isWriteProtected(el: FormControl): boolean {
  return isIgnoredControl(el) || inputType(el) === 'file' || isDeclarationCheckbox(el);
}

/**
 * Visibility test. Uses Element.checkVisibility() where available (Chrome 105+,
 * Firefox 106+): it reads layout once and does not force per-call reflow when
 * no writes are interleaved. Falls back to a computed-style ancestor walk,
 * memoised through `cache` so a scan of N fields stays O(N * depth).
 */
export function isVisible(el: Element, cache?: Map<Element, boolean>): boolean {
  if ((el as HTMLElement).hidden) return false;
  const cv = (el as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  if (typeof cv === 'function') {
    return cv.call(el, { checkOpacity: false, checkVisibilityCSS: true });
  }
  const win = winOf(el);
  const visibility = win.getComputedStyle(el).visibility;
  if (visibility === 'hidden' || visibility === 'collapse') return false;
  return !hiddenByAncestor(el, win, cache ?? new Map());
}

function hiddenByAncestor(el: Element, win: Window, cache: Map<Element, boolean>): boolean {
  const chain: Element[] = [];
  let cur: Element | null = el;
  let hidden = false;
  while (cur) {
    const known = cache.get(cur);
    if (known !== undefined) {
      hidden = known;
      break;
    }
    chain.push(cur);
    if ((cur as HTMLElement).hidden || win.getComputedStyle(cur).display === 'none') {
      hidden = true;
      break;
    }
    cur = cur.parentElement ?? ((cur.getRootNode() as ShadowRoot).host || null);
  }
  for (const c of chain) cache.set(c, hidden);
  return hidden;
}

/** Disabled directly or through a disabled <fieldset>. */
export function isDisabled(el: FormControl): boolean {
  return el.disabled || el.matches(':disabled');
}

const TEXT_SKIP_TAGS = new Set(['script', 'style', 'noscript', 'select', 'option', 'textarea', 'button', 'template']);

/**
 * Visible-ish text content of a node, skipping control internals (option text
 * of a select inside a label must not leak into the label) and hidden inline
 * elements such as validation messages.
 */
export function textOf(node: Node): string {
  const parts: string[] = [];
  const walk = (n: Node): void => {
    if (n.nodeType === 3) {
      parts.push(n.nodeValue ?? '');
      return;
    }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    const tag = tagOf(el);
    if (TEXT_SKIP_TAGS.has(tag)) return;
    if (el.classList.contains('invalid-feedback') || el.classList.contains('valid-feedback')) return;
    if ((el as HTMLElement).hidden || el.getAttribute('aria-hidden') === 'true') return;
    for (const c of Array.from(el.childNodes)) walk(c);
  };
  walk(node);
  return squish(parts.join(' '));
}

/** Escape a value for use inside a double-quoted attribute selector. */
export function attrValue(v: string): string {
  return v.replace(/["\\]/g, '\\$&');
}

/**
 * Set a control's value through the prototype setter so frameworks that shadow
 * the instance `value` property (React, Vue) observe the change.
 */
export function setNativeValue(el: FormControl, value: string): void {
  let proto: object | null = Object.getPrototypeOf(el);
  while (proto) {
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc?.set) {
      desc.set.call(el, value);
      return;
    }
    proto = Object.getPrototypeOf(proto);
  }
  el.value = value;
}

export function dispatch(el: Element, type: string): void {
  const win = winOf(el);
  el.dispatchEvent(new win.Event(type, { bubbles: true, cancelable: type !== 'blur' }));
}

/** All elements (radio groups carry the same id on every radio) tagged with `fid`. */
export function queryFid(root: Document | ShadowRoot, fid: string): Element[] {
  return Array.from(root.querySelectorAll(`[${FID_ATTR}="${attrValue(fid)}"]`));
}
