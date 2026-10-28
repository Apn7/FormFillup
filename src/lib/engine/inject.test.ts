import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ensureContentScript } from './inject';
import { CONTENT_SCRIPT_FILE, PING_TYPE } from './protocol';

// The spied APIs have callback overloads typed `void`; the promise forms are what the code uses.
const ALIVE = { ok: true, data: { alive: true } } as never;
const NO_RESULTS = [] as never;

describe('ensureContentScript', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.restoreAllMocks();
  });

  it('does not inject when the content script already answers the ping', async () => {
    const send = vi.spyOn(browser.tabs, 'sendMessage').mockResolvedValue(ALIVE);
    const exec = vi.spyOn(browser.scripting, 'executeScript').mockResolvedValue(NO_RESULTS);
    await ensureContentScript(7);
    expect(send).toHaveBeenCalledWith(7, { type: PING_TYPE }, { frameId: 0 });
    expect(exec).not.toHaveBeenCalled();
  });

  it('injects the built content script once, then verifies it answers', async () => {
    const send = vi
      .spyOn(browser.tabs, 'sendMessage')
      .mockRejectedValueOnce(new Error('Receiving end does not exist'))
      .mockResolvedValueOnce(ALIVE);
    const exec = vi.spyOn(browser.scripting, 'executeScript').mockResolvedValue(NO_RESULTS);
    await ensureContentScript(7);
    expect(exec).toHaveBeenCalledWith({ target: { tabId: 7, frameIds: [0] }, files: [CONTENT_SCRIPT_FILE] });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('reports pages that cannot be scripted', async () => {
    vi.spyOn(browser.tabs, 'sendMessage').mockRejectedValue(new Error('no receiver'));
    vi.spyOn(browser.scripting, 'executeScript').mockResolvedValue(NO_RESULTS);
    await expect(ensureContentScript(7)).rejects.toThrow(/could not start/);
  });
});
