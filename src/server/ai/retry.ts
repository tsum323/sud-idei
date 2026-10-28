import { AIError } from "./errors";

export interface RetryOptions {
  retries: number;
  baseDelayMs?: number;
  onRetry?: (attempt: number, error: AIError) => void;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Ограниченные повторы только для временных ошибок (лимиты, сеть, тайм-аут, 5xx,
 * неверный формат ответа). Ошибки конфигурации, авторизации и отказы не повторяются.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  const base = opts.baseDelayMs ?? 1500;
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (e) {
      const err = e instanceof AIError ? e : null;
      if (!err || !err.retryable || attempt >= opts.retries) throw e;
      attempt++;
      opts.onRetry?.(attempt, err);
      await sleep(base * 2 ** (attempt - 1));
    }
  }
}
