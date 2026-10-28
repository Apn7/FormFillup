/**
 * Injection helper for the UI (popup / side panel). The content script is
 * registered with `registration: 'runtime'`, so it only runs in tabs the user
 * acts on (activeTab + scripting).
 */
import { CONTENT_SCRIPT_FILE, PING_TYPE, type PingReply } from './protocol';

const PING_TIMEOUT_MS = 500;

async function ping(tabId: number): Promise<boolean> {
  try {
    const reply = (await Promise.race([
      browser.tabs.sendMessage(tabId, { type: PING_TYPE }, { frameId: 0 }),
      new Promise((resolve) => setTimeout(() => resolve(undefined), PING_TIMEOUT_MS)),
    ])) as PingReply | undefined;
    return reply?.ok === true;
  } catch {
    // "Receiving end does not exist": nothing injected yet.
    return false;
  }
}

/** Idempotent: pings first and injects only when no live content script answers. */
export async function ensureContentScript(tabId: number): Promise<void> {
  if (await ping(tabId)) return;
  if (browser.scripting?.executeScript) {
    await browser.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: [CONTENT_SCRIPT_FILE] });
  } else {
    // Firefox MV2 builds (WXT's default for `-b firefox`) without the scripting API.
    const tabs = browser.tabs as unknown as {
      executeScript(tabId: number, details: { file: string; frameId: number }): Promise<unknown>;
    };
    await tabs.executeScript(tabId, { file: CONTENT_SCRIPT_FILE, frameId: 0 });
  }
  if (!(await ping(tabId))) {
    throw new Error('FormFillup could not start on this page (browser pages and the web store cannot be scripted).');
  }
}
