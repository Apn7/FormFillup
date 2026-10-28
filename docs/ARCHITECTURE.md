# FormFillup architecture

Chromium-first (Chrome, Edge, Brave, Opera) MV3 browser extension, also buildable for Firefox, that fills job application forms from a profile stored locally in the browser. Teletalk government job portals (`*.teletalk.com.bd`) are the first-class target; any other site works through generic heuristics plus an optional LLM fallback.

## Stack

- **WXT** (Vite-based, MV3, cross-browser builds): `npm run dev`, `npm run build`, `npm run build:firefox`.
- TypeScript (strict), React 19 for extension pages, plain DOM for anything injected into pages.
- Vitest + jsdom for unit tests (`npm test`).
- No backend. LLM calls go directly from the background service worker to the provider, using the user's own API key.

### Toolchain note (this machine)

There is no Linux Node in WSL. Run Node tooling through Windows: `cmd.exe /c "npm run build"`, `cmd.exe /c "npx vitest run"`, `cmd.exe /c "npx tsc --noEmit"` from `/mnt/d/codes/FormFillup`. Do not `npm install` new dependencies without a real need; when you must, use `cmd.exe /c "npm i <pkg>"`.

## Data flow

```
 Options page ──(upload docs)──► background ──► LLM (extract profile JSON) ──► options page review ──► storage.local
 Popup / side panel ──"Preview"──► content script: scan → match (site adapter → cache → rules → LLM via background) → plan
                    ◄── PreviewResult (shown to user, items can be unticked)
                    ──"Fill"──► content script: fill plan in dependency order → FillReport
```

The content script is **not** declared for all URLs. It is registered with `registration: 'runtime'` and injected into the active tab on user action through `activeTab` + `scripting.executeScript`. This keeps permissions minimal and means the extension never reads pages the user did not ask it to.

Privacy rules (hard requirements):
1. Profile data never leaves the browser except during explicit document extraction, which the user starts.
2. The LLM field-mapping step sends **field metadata only** (labels, names, option texts), never profile values.
3. Nothing auto-submits. Captcha, OTP and final submission are always manual.

## Shared contracts (owned by the lead; change only by agreement)

- `src/shared/types.ts`: Profile, Settings, FieldDescriptor, FieldMapping, PlanItem, PreviewResult, FillReport, SiteMappingCache.
- `src/shared/messages.ts`: message protocol (`ff:preview`, `ff:fill`, `ff:clear-highlights`, `ff:llm-map`, `ff:extract-profile`, `ff:llm-test`), `sendToBackground`, `sendToTab`, `toReply`.
- `src/shared/profile.ts`: `emptyProfile()`, `profileKeyCatalog()`, `DERIVED_KEYS`, `getByPath()`, `mergeProfile()`.

## Module ownership

| Area | Owner | Paths |
|---|---|---|
| Page engine: scanner, matcher, site adapters, value resolution, filler, content script, injection helper | Senior engineer | `src/lib/engine/**`, `src/entrypoints/content.ts`, `tests/fixtures/**`, `src/lib/engine/**/*.test.ts` |
| Storage, LLM providers, field-mapping prompt, document extraction, background service worker | Junior engineer A | `src/lib/storage.ts`, `src/lib/llm/**`, `src/entrypoints/background.ts` |
| Extension UI: popup, side panel, options page (profile editor, settings, document import) | Junior engineer B | `src/entrypoints/popup/**`, `src/entrypoints/sidepanel/**`, `src/entrypoints/options/**`, `src/ui/**`, `public/icon/**` |

Cross-module APIs (implement exactly these exports so others can code against them before you are done):

```ts
// src/lib/storage.ts  (Junior A)
export async function getProfile(): Promise<Profile>;                 // returns emptyProfile() when none saved
export async function saveProfile(p: Profile): Promise<void>;
export async function getSettings(): Promise<Settings>;               // returns defaults when none saved
export async function saveSettings(s: Settings): Promise<void>;
export async function getSiteMappings(origin: string): Promise<SiteMappingCache[string]>;
export async function saveSiteMappings(origin: string, entries: SiteMappingCache[string]): Promise<void>;
export function watchProfile(cb: (p: Profile) => void): () => void;   // unsubscribe fn
export const DEFAULT_SETTINGS: Settings;

// src/lib/llm/index.ts  (Junior A, used by background only)
export async function mapFieldsWithLlm(settings: Settings, fields: FieldDescriptor[], keys: {key: ProfileKey; label: string}[]): Promise<FieldMapping[]>;
export async function extractProfileFromDocuments(settings: Settings, files: {name: string; mimeType: string; base64: string}[]): Promise<{profile: Partial<Profile>; notes: string[]}>;
export async function testLlm(settings: Settings): Promise<{ok: boolean; detail: string}>;

// src/lib/engine/inject.ts  (Senior, used by the UI)
export async function ensureContentScript(tabId: number): Promise<void>;  // idempotent; injects if not present
```

## Engine design (senior)

1. **Scanner** walks the document (open shadow roots included) for `input`, `select`, `textarea` and builds `FieldDescriptor`s. Label resolution order: `label[for]` → wrapping `<label>` → `aria-labelledby` / `aria-label` → nearest preceding label/text in the same `.form-group` / row / table cell → placeholder → `name`. Section = nearest `fieldset > legend` or preceding heading. Each element gets `data-ff-id`.
2. **Matcher**, in priority order:
   1. *Site adapter* (exact, confidence 1.0): Teletalk adapter maps by `name` attribute (see `docs/teletalk-reference.md`).
   2. *Site cache*: previously confirmed mappings for this origin.
   3. *Rules*: `autocomplete` tokens, then a synonym dictionary over label + name + id + placeholder, scoped by section (SSC vs HSC vs graduation; present vs permanent address). English and Bangla synonyms.
   4. *LLM fallback* (only if enabled and a key is set): unmatched descriptors go to the background via `ff:llm-map`.
3. **Value resolution** turns a profile key + a field into a site-ready value: dates converted to the input's format (`type=date` → `yyyy-mm-dd`; text with `dd/mm/yyyy`-style hints → that format), select values chosen by normalized option-text matching (case/punctuation-insensitive, alias table such as Chittagong↔Chattogram, Comilla↔Cumilla, Barisal↔Barishal, Jessore↔Jashore, Bogra↔Bogura), GPA scale → option ("GPA(out of 5)"), derived keys (`ids.hasNid` → "Yes"/"No"), uppercase where the site requires it.
4. **Filler** runs plan items in `order`, honouring `dependsOn`: set parent, dispatch events, then wait (MutationObserver on the child's options / visibility, bounded by `settings.dependentFieldTimeoutMs`) before filling children. Setting values uses the native prototype setter (`HTMLInputElement.prototype.value` descriptor) so React/Vue-controlled inputs register, then dispatches `input` + `change` (+ `blur`) with `bubbles: true`. Checkboxes and radios are toggled with `.click()` so inline `onclick` handlers run. Never touches hidden system inputs, `type=file`, captcha, or submit buttons.
5. **Highlighting**: preview outlines matched fields (green = high confidence, amber = low/LLM, red = required but unmatched). Removed on `ff:clear-highlights`.
