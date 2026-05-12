import { evaluateResearchDataset } from "./deterministic-evaluator";
import { researchEvaluationDataset } from "./research-dataset";
import type { ResearchEvaluationCase, ResearchRunOutput, ResearchSourceFixture } from "./types";

function selectTrustedSourceIds(testCase: ResearchEvaluationCase): string[] {
  const trusted = new Set(["primary", "secondary"]);
  return testCase.sources
    .filter((source: ResearchSourceFixture) => trusted.has(source.credibility))
    .map((source) => source.id)
    .slice(0, Math.max(testCase.expected.minTrustedSources, testCase.expected.mustUseSourceIds.length));
}

function createBaselineOutput(testCase: ResearchEvaluationCase): ResearchRunOutput {
  const requiredSources = testCase.expected.mustUseSourceIds.length > 0
    ? [...testCase.expected.mustUseSourceIds]
    : selectTrustedSourceIds(testCase);
  const reportTerms = testCase.expected.mustMention.join(", ");
  const contradictionText = testCase.expected.contradictionSourceIds.length > 0
    ? ` Conflicting evidence is flagged for ${testCase.expected.contradictionSourceIds.join(", ")}.`
    : "";

  return {
    caseId: testCase.id,
    status: testCase.expected.outcome === "needs_more_sources" ? "needs_more_sources" : "answered",
    report:
      testCase.expected.outcome === "needs_more_sources"
        ? `More sources are required before a defensible answer can be produced. Current evidence mentions ${reportTerms}.`
        : `The answer addresses the objective with evidence covering ${reportTerms}.${contradictionText}`,
    usedSourceIds: requiredSources,
    rejectedSourceIds: [...testCase.expected.mustRejectSourceIds],
    detectedContradictions: [...testCase.expected.contradictionSourceIds],
    citations: requiredSources,
  };
}

const baselineOutputs = researchEvaluationDataset.map(createBaselineOutput);
const results = evaluateResearchDataset(baselineOutputs);
const passedCount = results.filter((result) => result.passed).length;

process.stdout.write(
  JSON.stringify(
    {
      cases: researchEvaluationDataset.length,
      passed: passedCount,
      failed: results.length - passedCount,
      categories: results.reduce<Record<string, number>>((accumulator, result) => {
        accumulator[result.category] = (accumulator[result.category] ?? 0) + 1;
        return accumulator;
      }, {}),
    },
    null,
    2,
  ) + "\n",
);
