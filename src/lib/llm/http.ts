import { LlmError } from './types';

export interface RetryOptions {
  timeoutMs: number;
  maxRetries?: number;
  baseDelayMs?: number;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_DELAY_MS = 20_000;

/** Map an HTTP failure to a message that is safe to show to the user. */
export function httpErrorMessage(status: number, providerMessage = ''): string {
  const hint = providerMessage.replace(/\s+/g, ' ').trim().slice(0, 160);
  switch (status) {
    case 400:
      if (/api key|api_key/i.test(hint)) return 'Invalid API key. Check it in Settings.';
      return `The AI provider rejected the request (400)${hint ? `: ${hint}` : ''}`;
    case 401:
      return 'Invalid API key. Check it in Settings.';
    case 403:
      return 'The API key is not allowed to use this model or API (403). Check the key and model name in Settings.';
    case 404:
      return 'Model or endpoint not found (404). Check the model name and base URL in Settings.';
    case 413:
      return 'The documents are too large for this provider. Upload fewer or smaller files.';
    case 429:
      return 'Free-tier quota exceeded or rate limited. Wait a minute and try again.';
    default:
      if (status >= 500) return `The AI provider is having problems (${status}). Try again later.`;
      return `Unexpected response from the AI provider (${status}).`;
  }
}

/** Seconds or HTTP-date to milliseconds; undefined when absent or unparsable. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(value);
  return Number.isNaN(when) ? undefined : Math.max(0, when - now);
}

export function backoffDelay(attempt: number, baseDelayMs: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, MAX_DELAY_MS);
  const exp = baseDelayMs * 2 ** attempt;
  return Math.min(exp / 2 + Math.random() * (exp / 2), MAX_DELAY_MS);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function readProviderMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown } | string };
    const err = body.error;
    if (typeof err === 'string') return err;
    return typeof err?.message === 'string' ? err.message : '';
  } catch {
    return '';
  }
}

const TIMEOUT_STATUS = 408;

async function attemptOnce(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch {
    if (ctrl.signal.aborted) {
      throw new LlmError(`The AI provider did not answer within ${Math.round(timeoutMs / 1000)}s.`, TIMEOUT_STATUS);
    }
    throw new LlmError('Network error while contacting the AI provider. Check your connection.');
  } finally {
    clearTimeout(timer);
  }
}

/** fetch with timeout, retry (429/5xx, exponential backoff + jitter, Retry-After) and friendly errors. */
export async function fetchJsonWithRetry(url: string, init: RequestInit, opts: RetryOptions): Promise<unknown> {
  const maxRetries = opts.maxRetries ?? 3;
  const base = opts.baseDelayMs ?? 1000;
  for (let attempt = 0; ; attempt++) {
    let res: Response | undefined;
    try {
      res = await attemptOnce(url, init, opts.timeoutMs);
    } catch (e) {
      // A timed-out request is not retried: repeating a slow extraction could outlive the service worker.
      if (attempt >= maxRetries || (e instanceof LlmError && e.status === TIMEOUT_STATUS)) throw e;
      await sleep(backoffDelay(attempt, base));
      continue;
    }
    if (res.ok) {
      try {
        return await res.json();
      } catch {
        throw new LlmError('The AI provider returned a response that is not valid JSON.');
      }
    }
    const message = await readProviderMessage(res);
    if (RETRYABLE.has(res.status) && attempt < maxRetries) {
      await sleep(backoffDelay(attempt, base, parseRetryAfter(res.headers.get('retry-after'))));
      continue;
    }
    throw new LlmError(httpErrorMessage(res.status, message), res.status);
  }
}
