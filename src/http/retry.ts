/** Reactive backoff for 429/503. No proactive token bucket. */

export const MAX_HTTP_RETRIES = 2;
export const BASE_BACKOFF_MS = 400;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function retryAfterMs(res: Response, attempt: number): number {
  const raw = res.headers.get("retry-after");
  if (raw) {
    const sec = Number(raw);
    if (Number.isFinite(sec) && sec >= 0) return Math.min(sec * 1000, 10_000);
  }
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, 5_000);
}

export function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status === 503;
}

export async function requestWithRetry(opts: {
  fetchImpl: typeof fetch;
  url: string;
  init: RequestInit;
  onAttempt?: () => void;
  maxRetries?: number;
}): Promise<{ res: Response; text: string; parsed: unknown }> {
  const max = opts.maxRetries ?? MAX_HTTP_RETRIES;
  let lastRes: Response | undefined;
  let lastText = "";
  let lastParsed: unknown;
  for (let attempt = 0; attempt <= max; attempt++) {
    opts.onAttempt?.();
    const res = await opts.fetchImpl(opts.url, opts.init);
    lastRes = res;
    lastText = await res.text();
    lastParsed = undefined;
    if (lastText) {
      try {
        lastParsed = JSON.parse(lastText);
      } catch {
        lastParsed = { raw: lastText };
      }
    }
    if (res.ok) return { res, text: lastText, parsed: lastParsed };
    if (isRetryableHttpStatus(res.status) && attempt < max) {
      await sleep(retryAfterMs(res, attempt));
      continue;
    }
    return { res, text: lastText, parsed: lastParsed };
  }
  return { res: lastRes!, text: lastText, parsed: lastParsed };
}
