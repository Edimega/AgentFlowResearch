import { describe, expect, it, vi } from "vitest";
import { contractPaths, loadContractModule } from "../support/contract";

class TransientError extends Error {
  readonly retryable = true;
}

class ValidationError extends Error {
  readonly retryable = false;
}

interface RetryModule {
  runWithRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T>;
}

interface RetryOptions {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly shouldRetry?: (error: unknown) => boolean;
  readonly sleep?: (delayMs: number) => Promise<void>;
}

async function loadRetries(): Promise<RetryModule> {
  return loadContractModule<RetryModule>({
    name: "retries",
    candidates: contractPaths.retries,
  });
}

describe("retry contract", () => {
  it("retries transient failures with deterministic exponential delays", async () => {
    const retries = await loadRetries();
    const sleep = vi.fn(async () => undefined);
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TransientError("temporary upstream timeout"))
      .mockRejectedValueOnce(new TransientError("temporary upstream timeout"))
      .mockResolvedValueOnce("ok");

    await expect(
      retries.runWithRetry(operation, {
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 1_000,
        shouldRetry: (error) => error instanceof TransientError,
        sleep,
      }),
    ).resolves.toBe("ok");

    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);
  });

  it("does not retry validation failures", async () => {
    const retries = await loadRetries();
    const sleep = vi.fn(async () => undefined);
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(new ValidationError("invalid input"));

    await expect(
      retries.runWithRetry(operation, {
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 1_000,
        shouldRetry: (error) => error instanceof TransientError,
        sleep,
      }),
    ).rejects.toThrow("invalid input");

    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
