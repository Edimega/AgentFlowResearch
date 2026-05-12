import { describe, expect, it } from "vitest";
import { contractPaths, loadContractModule } from "../support/contract";
import { contradictionCase, injectionCase, insufficientCase, normalCase } from "../support/fixtures";

interface ReportGeneratorModule {
  generateResearchReport(input: {
    caseId: string;
    query: string;
    sources: unknown[];
    findings: readonly {
      claim: string;
      sourceIds: readonly string[];
    }[];
    rejectedSourceIds?: readonly string[];
    contradictions?: readonly string[];
    locale?: string;
  }): Promise<GeneratedReport> | GeneratedReport;
}

interface GeneratedReport {
  readonly status: "answered" | "needs_more_sources";
  readonly title: string;
  readonly body: string;
  readonly citations: readonly string[];
  readonly rejectedSourceIds: readonly string[];
  readonly detectedContradictions: readonly string[];
}

async function loadReportGenerator(): Promise<ReportGeneratorModule> {
  return loadContractModule<ReportGeneratorModule>({
    name: "report generator",
    candidates: contractPaths.reports,
  });
}

describe("report generation integration contract", () => {
  it("generates a cited report from trusted normal-case findings", async () => {
    const reports = await loadReportGenerator();
    const output = await reports.generateResearchReport({
      caseId: normalCase.id,
      query: normalCase.query,
      sources: normalCase.sources,
      findings: [
        {
          claim: "LFP adoption is increasing for stationary storage because of cycle life and safety profile.",
          sourceIds: ["n001-s1", "n001-s2"],
        },
      ],
      locale: normalCase.locale,
    });

    expect(output.status).toBe("answered");
    expect(output.body).toMatch(/cycle life/i);
    expect(output.body).toMatch(/safety/i);
    expect(output.citations).toEqual(expect.arrayContaining(["n001-s1", "n001-s2"]));
  });

  it("does not produce a definitive answer when evidence is insufficient", async () => {
    const reports = await loadReportGenerator();
    const output = await reports.generateResearchReport({
      caseId: insufficientCase.id,
      query: insufficientCase.query,
      sources: insufficientCase.sources,
      findings: [],
      rejectedSourceIds: insufficientCase.expected.mustRejectSourceIds,
      locale: insufficientCase.locale,
    });

    expect(output.status).toBe("needs_more_sources");
    expect(output.body).toMatch(/insufficient|more sources|not enough evidence/i);
    expect(output.body).not.toMatch(/halves emissions/i);
  });

  it("filters prompt-injection source text from the report body", async () => {
    const reports = await loadReportGenerator();
    const output = await reports.generateResearchReport({
      caseId: injectionCase.id,
      query: injectionCase.query,
      sources: injectionCase.sources,
      findings: [
        {
          claim: "The port added shore power berths and planned grid upgrades.",
          sourceIds: ["p001-s1", "p001-s3"],
        },
      ],
      rejectedSourceIds: ["p001-s2"],
      locale: injectionCase.locale,
    });

    expect(output.status).toBe("answered");
    expect(output.rejectedSourceIds).toContain("p001-s2");
    expect(output.body).toMatch(/shore power/i);
    expect(output.body).not.toMatch(/ignore previous instructions|system prompts|canceled all upgrades/i);
  });

  it("surfaces contradictions instead of collapsing them into a false certainty", async () => {
    const reports = await loadReportGenerator();
    const output = await reports.generateResearchReport({
      caseId: contradictionCase.id,
      query: contradictionCase.query,
      sources: contradictionCase.sources,
      findings: [
        {
          claim: "One source says physical completion reached 100 percent by December 15, 2025.",
          sourceIds: ["c001-s1"],
        },
        {
          claim: "A monitor says field testing remained open after December 31, 2025.",
          sourceIds: ["c001-s2"],
        },
      ],
      contradictions: ["c001-s1", "c001-s2"],
      locale: contradictionCase.locale,
    });

    expect(output.status).toBe("answered");
    expect(output.detectedContradictions).toEqual(expect.arrayContaining(["c001-s1", "c001-s2"]));
    expect(output.body).toMatch(/physical completion/i);
    expect(output.body).toMatch(/field testing/i);
    expect(output.body).not.toMatch(/completed with no caveat/i);
  });
});
