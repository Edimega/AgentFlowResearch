import { describe, expect, it } from "vitest";
import { contractPaths, expectStableSerializable, loadContractModule } from "../support/contract";
import { contradictionCase, injectionCase, insufficientCase, normalCase } from "../support/fixtures";

interface PlannerModule {
  createResearchPlan(input: {
    query: string;
    sources?: unknown[];
    locale?: string;
    now?: string;
  }): Promise<ResearchPlan> | ResearchPlan;
}

interface ResearchPlan {
  readonly id: string;
  readonly steps: readonly ResearchPlanStep[];
  readonly requiredSourceCount: number;
}

interface ResearchPlanStep {
  readonly id: string;
  readonly kind: string;
  readonly tool?: string;
  readonly dependsOn?: readonly string[];
}

async function loadPlanner(): Promise<PlannerModule> {
  return loadContractModule<PlannerModule>({ name: "planner", candidates: contractPaths.planner });
}

describe("planner contract", () => {
  it("creates a deterministic plan with gather, evaluate, synthesize, and report phases", async () => {
    const planner = await loadPlanner();
    const first = await planner.createResearchPlan({
      query: normalCase.query,
      sources: normalCase.sources,
      locale: normalCase.locale,
      now: normalCase.createdAt,
    });
    const second = await planner.createResearchPlan({
      query: normalCase.query,
      sources: normalCase.sources,
      locale: normalCase.locale,
      now: normalCase.createdAt,
    });

    expectStableSerializable(first);
    expect(first).toEqual(second);
    expect(first.requiredSourceCount).toBeGreaterThanOrEqual(2);
    expect(first.steps.map((step) => step.kind)).toEqual(
      expect.arrayContaining(["gather_sources", "evaluate_sources", "synthesize_findings", "generate_report"]),
    );
  });

  it("requires a source quality gate before report generation for insufficient evidence", async () => {
    const planner = await loadPlanner();
    const plan = await planner.createResearchPlan({
      query: insufficientCase.query,
      sources: insufficientCase.sources,
      locale: insufficientCase.locale,
      now: insufficientCase.createdAt,
    });

    const qualityGateIndex = plan.steps.findIndex((step) => step.kind === "source_quality_gate");
    const reportIndex = plan.steps.findIndex((step) => step.kind === "generate_report");

    expect(qualityGateIndex).toBeGreaterThanOrEqual(0);
    expect(reportIndex).toBeGreaterThan(qualityGateIndex);
  });

  it("plans source sanitization before synthesis when prompt injection text is present", async () => {
    const planner = await loadPlanner();
    const plan = await planner.createResearchPlan({
      query: injectionCase.query,
      sources: injectionCase.sources,
      locale: injectionCase.locale,
      now: injectionCase.createdAt,
    });

    const sanitizeIndex = plan.steps.findIndex((step) => step.kind === "sanitize_source_content");
    const synthesisIndex = plan.steps.findIndex((step) => step.kind === "synthesize_findings");

    expect(sanitizeIndex).toBeGreaterThanOrEqual(0);
    expect(synthesisIndex).toBeGreaterThan(sanitizeIndex);
  });

  it("plans contradiction resolution when trusted sources disagree", async () => {
    const planner = await loadPlanner();
    const plan = await planner.createResearchPlan({
      query: contradictionCase.query,
      sources: contradictionCase.sources,
      locale: contradictionCase.locale,
      now: contradictionCase.createdAt,
    });

    expect(plan.steps.map((step) => step.kind)).toContain("resolve_contradictions");
  });
});
