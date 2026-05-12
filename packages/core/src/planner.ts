import { createDeterministicId } from "./id";

interface PlannerSource {
  readonly id?: string;
  readonly content?: string;
  readonly credibility?: string;
}

export interface ResearchPlanStep {
  readonly id: string;
  readonly kind:
    | "gather_sources"
    | "sanitize_source_content"
    | "evaluate_sources"
    | "source_quality_gate"
    | "resolve_contradictions"
    | "synthesize_findings"
    | "generate_report";
  readonly tool?: string;
  readonly dependsOn?: readonly string[];
}

export interface ResearchPlan {
  readonly id: string;
  readonly steps: readonly ResearchPlanStep[];
  readonly requiredSourceCount: number;
}

export interface CreateResearchPlanInput {
  readonly query: string;
  readonly sources?: readonly unknown[];
  readonly locale?: string;
  readonly now?: string;
}

function isPlannerSource(value: unknown): value is PlannerSource {
  return Boolean(value && typeof value === "object");
}

function hasPromptInjection(sources: readonly unknown[]): boolean {
  return sources
    .filter(isPlannerSource)
    .some((source) => /ignore previous instructions|system prompt|developer message|reveal secrets/i.test(source.content ?? ""));
}

function hasInsufficientEvidence(sources: readonly unknown[]): boolean {
  const trustedCount = sources
    .filter(isPlannerSource)
    .filter((source) => source.credibility === "primary" || source.credibility === "secondary").length;
  return trustedCount < 2;
}

function hasContradictionSignal(sources: readonly unknown[]): boolean {
  const content = sources
    .filter(isPlannerSource)
    .map((source) => source.content ?? "")
    .join(" ");
  return /(contradict|disagree|remained open|reached 100 percent|not complete|no measurable)/i.test(content);
}

export function createResearchPlan(input: CreateResearchPlanInput): ResearchPlan {
  const sources = input.sources ?? [];
  const requiresSanitization = hasPromptInjection(sources);
  const requiresQualityGate = hasInsufficientEvidence(sources);
  const requiresContradictionResolution = hasContradictionSignal(sources);
  const planSeed = `${input.query}:${input.locale ?? "en-US"}:${input.now ?? ""}:${sources.length}`;
  const gatherStepId = createDeterministicId("stp", `${planSeed}:gather`);
  const steps: ResearchPlanStep[] = [
    {
      id: gatherStepId,
      kind: "gather_sources",
      tool: "searchSources",
    },
  ];
  const getLastStepId = (): string => steps[steps.length - 1]?.id ?? gatherStepId;

  if (requiresSanitization) {
    steps.push({
      id: createDeterministicId("stp", `${planSeed}:sanitize`),
      kind: "sanitize_source_content",
      tool: "evaluateSource",
      dependsOn: [gatherStepId],
    });
  }

  steps.push({
    id: createDeterministicId("stp", `${planSeed}:evaluate`),
    kind: "evaluate_sources",
    tool: "evaluateSource",
    dependsOn: [getLastStepId()],
  });

  if (requiresQualityGate) {
    steps.push({
      id: createDeterministicId("stp", `${planSeed}:quality`),
      kind: "source_quality_gate",
      dependsOn: [getLastStepId()],
    });
  }

  if (requiresContradictionResolution) {
    steps.push({
      id: createDeterministicId("stp", `${planSeed}:contradictions`),
      kind: "resolve_contradictions",
      tool: "evaluateSource",
      dependsOn: [getLastStepId()],
    });
  }

  const synthesizeStepId = createDeterministicId("stp", `${planSeed}:synthesize`);
  steps.push(
    {
      id: synthesizeStepId,
      kind: "synthesize_findings",
      dependsOn: [getLastStepId()],
    },
    {
      id: createDeterministicId("stp", `${planSeed}:report`),
      kind: "generate_report",
      tool: "generateReport",
      dependsOn: [synthesizeStepId],
    },
  );

  return {
    id: createDeterministicId("wfl", planSeed),
    steps,
    requiredSourceCount: 2,
  };
}
