import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { routeMessage } from './router';

beforeEach(() => fakeBrowser.reset());

describe('routeMessage', () => {
  it('ignores unknown messages', () => {
    expect(routeMessage({ type: 'ff:preview', payload: {} })).toBeUndefined();
    expect(routeMessage(null)).toBeUndefined();
    expect(routeMessage({ type: 'toString' })).toBeUndefined();
  });
  it('replies with an error as data when no key is set', async () => {
    const reply = await routeMessage({ type: 'ff:llm-test', payload: {} });
    expect(reply).toEqual({ ok: true, data: { ok: false, detail: expect.stringMatching(/API key/) } });
    const r2 = await routeMessage({ type: 'ff:extract-profile', payload: { files: [] } });
    expect(r2).toMatchObject({ ok: false });
  });
});
