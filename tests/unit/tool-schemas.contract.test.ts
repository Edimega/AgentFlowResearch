import { describe, expect, it } from "vitest";
import { contractPaths, loadContractModule, validateWithSchema } from "../support/contract";

interface ToolSchemaModule {
  toolSchemas: {
    searchSources: unknown;
    fetchSource: unknown;
    evaluateSource: unknown;
    generateReport: unknown;
  };
}

async function loadToolSchemas(): Promise<ToolSchemaModule> {
  return loadContractModule<ToolSchemaModule>({
    name: "tool schemas",
    candidates: contractPaths.toolSchemas,
  });
}

describe("tool schema contract", () => {
  it("accepts a bounded source search request", async () => {
    const { toolSchemas } = await loadToolSchemas();
    const result = validateWithSchema(toolSchemas.searchSources, {
      query: "battery storage adoption",
      maxResults: 8,
      locale: "en-US",
      allowedDomains: ["example.org"],
    });

    expect(result.success).toBe(true);
  });

  it("rejects broad or unsafe source search requests", async () => {
    const { toolSchemas } = await loadToolSchemas();
    const result = validateWithSchema(toolSchemas.searchSources, {
      query: "",
      maxResults: 200,
      includePrivateIndexes: true,
    });

    expect(result.success).toBe(false);
  });

  it("requires fetch requests to use HTTP(S) URLs and explicit source ids", async () => {
    const { toolSchemas } = await loadToolSchemas();

    expect(
      validateWithSchema(toolSchemas.fetchSource, {
        sourceId: "source-001",
        url: "https://example.org/report",
      }).success,
    ).toBe(true);

    expect(
      validateWithSchema(toolSchemas.fetchSource, {
        sourceId: "",
        url: "file:///etc/passwd",
      }).success,
    ).toBe(false);
  });

  it("requires report generation inputs to carry cited findings and a deterministic case id", async () => {
    const { toolSchemas } = await loadToolSchemas();
    const result = validateWithSchema(toolSchemas.generateReport, {
      caseId: "normal-001",
      findings: [
        {
          claim: "LFP adoption is increasing for stationary storage.",
          sourceIds: ["n001-s1", "n001-s2"],
        },
      ],
      locale: "en-US",
    });

    expect(result.success).toBe(true);
  });
});
