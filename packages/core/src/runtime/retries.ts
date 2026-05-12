export interface RetryOptions {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly shouldRetry?: (error: unknown) => boolean;
  readonly sleep?: (delayMs: number) => Promise<void>;
}

function defaultShouldRetry(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "retryable" in error && error.retryable === true);
}

export async function runWithRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  let attempt = 0;

  while (attempt < options.maxAttempts) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      if (attempt >= options.maxAttempts || !shouldRetry(error)) {
        throw error;
      }

      const delay = Math.min(options.baseDelayMs * 2 ** (attempt - 1), options.maxDelayMs);
      await sleep(delay);
    }
  }

  throw new Error("Retry execution reached an invalid terminal state.");
}
