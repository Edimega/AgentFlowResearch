export interface LoadContractOptions {
  readonly name: string;
  readonly candidates: readonly string[];
}

export async function loadContractModule<T>(options: LoadContractOptions): Promise<T> {
  const failures: string[] = [];

  for (const candidate of options.candidates) {
    try {
      return (await import(candidate)) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${candidate}: ${message}`);
    }
  }

  throw new Error(
    [
      `Unable to load ${options.name} contract module.`,
      "Add one of the expected implementation modules or update the test candidate list intentionally.",
      ...failures,
    ].join("\n"),
  );
}

export function validateWithSchema(schema: unknown, value: unknown): { success: boolean; error?: unknown } {
  if (schema && typeof schema === "object" && "safeParse" in schema && typeof schema.safeParse === "function") {
    return schema.safeParse(value) as { success: boolean; error?: unknown };
  }

  if (schema && typeof schema === "object" && "parse" in schema && typeof schema.parse === "function") {
    try {
      schema.parse(value);
      return { success: true };
    } catch (error) {
      return { success: false, error };
    }
  }

  if (schema && typeof schema === "object" && "validate" in schema && typeof schema.validate === "function") {
    const result = schema.validate(value) as { error?: unknown };
    return { success: !result.error, error: result.error };
  }

  throw new Error("Schema contract must expose safeParse, parse, or validate.");
}

export function expectStableSerializable(value: unknown): void {
  JSON.stringify(value);
}

export const contractPaths = {
  planner: [
    "../../packages/core/src/planner",
    "../../packages/core/src/research/planner",
    "../../src/server/planner",
    "../../src/lib/planner",
    "../../lib/planner",
  ],
  toolSchemas: [
    "../../packages/core/src/tools/schemas",
    "../../packages/core/src/research/tool-schemas",
    "../../src/server/tools/schemas",
    "../../src/lib/tools/schemas",
    "../../lib/tools/schemas",
  ],
  permissions: [
    "../../packages/core/src/security/permissions",
    "../../packages/core/src/tools/permissions",
    "../../src/server/security/permissions",
    "../../src/lib/security/permissions",
    "../../lib/security/permissions",
  ],
  retries: [
    "../../packages/core/src/runtime/retries",
    "../../packages/core/src/research/retries",
    "../../src/server/runtime/retries",
    "../../src/lib/retries",
    "../../lib/retries",
  ],
  reports: [
    "../../packages/core/src/reports/generate-report",
    "../../packages/core/src/research/report-generator",
    "../../src/server/reports/generate-report",
    "../../src/lib/reports/generate-report",
    "../../lib/reports/generate-report",
  ],
} as const;
