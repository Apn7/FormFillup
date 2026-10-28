/**
 * Engine-internal message used by ensureContentScript() to detect an already
 * injected content script. Not part of MessageMap: nothing else needs it.
 */
export const PING_TYPE = 'ff:ping';

export interface PingReply {
  ok: true;
  data: { alive: true };
}

/**
 * Path of the built content script inside the extension package. WXT emits
 * `src/entrypoints/content.ts` as `content-scripts/content.js` for every
 * target (verified in .output/chrome-mv3 and .output/firefox-mv3).
 */
export const CONTENT_SCRIPT_FILE = '/content-scripts/content.js';
