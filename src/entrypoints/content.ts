/**
 * FormFillup content script. Injected on demand (registration: 'runtime') by
 * ensureContentScript(); handles ff:preview, ff:fill, ff:clear-highlights and
 * the internal ping.
 */
import { getProfile, getSettings, getSiteMappings, saveSiteMappings } from '@/lib/storage';
import { createSession } from '@/lib/engine/session';
import { sendToBackground } from '@/shared/messages';

/** Survives re-injection into the same isolated world; `alive` is false once the old context is invalidated. */
const GUARD = '__formFillupContentScript__';
type Guard = { alive: () => boolean };

export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  main(ctx) {
    const scope = globalThis as unknown as Record<string, Guard | undefined>;
    if (scope[GUARD]?.alive()) return;

    const session = createSession({
      doc: document,
      getProfile,
      getSettings,
      getSiteMappings,
      saveSiteMappings,
      llmMap: (fields, keys) => sendToBackground('ff:llm-map', { fields, keys }),
    });

    // sendResponse + `return true` works with native chrome.* and Firefox's browser.* alike.
    const listener = (message: unknown, _sender: unknown, sendResponse: (reply: unknown) => void): true | undefined => {
      const reply = session.handle(message);
      if (!reply) return undefined;
      void reply.then(sendResponse);
      return true;
    };

    browser.runtime.onMessage.addListener(listener);
    scope[GUARD] = { alive: () => !ctx.isInvalid };

    ctx.onInvalidated(() => {
      browser.runtime.onMessage.removeListener(listener);
      session.clear();
      scope[GUARD] = undefined;
    });
  },
});
