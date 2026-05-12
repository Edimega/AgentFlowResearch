import { researchEvaluationDataset } from "./research-dataset";
import type {
  CaseEvalResult,
  EvalCheckResult,
  ResearchEvaluationCase,
  ResearchRunOutput,
} from "./types";

const trustedCredibilities = new Set(["primary", "secondary"]);

export function getCaseById(caseId: string): ResearchEvaluationCase {
  const match = researchEvaluationDataset.find((item) => item.id === caseId);
  if (!match) {
    throw new Error(`Unknown evaluation case: ${caseId}`);
  }
  return match;
}

export function normalizeForEval(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computeCaseFingerprint(testCase: ResearchEvaluationCase): string {
  let hash = 2166136261;
  const payload = stableStringify(testCase);
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function evaluateResearchResult(output: ResearchRunOutput): CaseEvalResult {
  const testCase = getCaseById(output.caseId);
  const report = normalizeForEval(output.report);
  const sourceById = new Map(testCase.sources.map((source) => [source.id, source]));
  const usedTrustedSourceCount = output.usedSourceIds.filter((sourceId) => {
    const source = sourceById.get(sourceId);
    return source ? trustedCredibilities.has(source.credibility) : false;
  }).length;

  const checks: EvalCheckResult[] = [
    checkOutcome(testCase, output),
    checkRequiredSources(testCase, output),
    checkRejectedSources(testCase, output),
    {
      name: "minimum_trusted_sources",
      passed:
        testCase.expected.outcome === "needs_more_sources" ||
        usedTrustedSourceCount >= testCase.expected.minTrustedSources,
      details: `used ${usedTrustedSourceCount} trusted sources; expected at least ${testCase.expected.minTrustedSources}`,
    },
    {
      name: "required_claims_present",
      passed: testCase.expected.mustMention.every((term) => report.includes(normalizeForEval(term))),
      details: `required terms: ${testCase.expected.mustMention.join(", ")}`,
    },
    {
      name: "forbidden_claims_absent",
      passed: testCase.expected.mustNotMention.every((term) => !report.includes(normalizeForEval(term))),
      details: `forbidden terms: ${testCase.expected.mustNotMention.join(", ")}`,
    },
    checkContradictions(testCase, output),
    {
      name: "citations_present",
      passed:
        testCase.expected.outcome === "needs_more_sources" ||
        output.citations.length >= testCase.expected.minTrustedSources,
      details: `citations found: ${output.citations.length}`,
    },
  ];

  return {
    caseId: testCase.id,
    category: testCase.category,
    passed: checks.every((check) => check.passed),
    checks,
  };
}

export function evaluateResearchDataset(outputs: readonly ResearchRunOutput[]): readonly CaseEvalResult[] {
  const outputByCase = new Map(outputs.map((output) => [output.caseId, output]));
  return researchEvaluationDataset.map((testCase) => {
    const output = outputByCase.get(testCase.id);
    if (!output) {
      return {
        caseId: testCase.id,
        category: testCase.category,
        passed: false,
        checks: [
          {
            name: "output_exists",
            passed: false,
            details: "No output was provided for this evaluation case.",
          },
        ],
      };
    }
    return evaluateResearchResult(output);
  });
}

function checkOutcome(testCase: ResearchEvaluationCase, output: ResearchRunOutput): EvalCheckResult {
  const passed =
    (testCase.expected.outcome === "needs_more_sources" && output.status === "needs_more_sources") ||
    (testCase.expected.outcome !== "needs_more_sources" && output.status === "answered");
  return {
    name: "expected_outcome",
    passed,
    details: `expected ${testCase.expected.outcome}; received ${output.status}`,
  };
}

function checkRequiredSources(testCase: ResearchEvaluationCase, output: ResearchRunOutput): EvalCheckResult {
  const missing = testCase.expected.mustUseSourceIds.filter((sourceId) => !output.usedSourceIds.includes(sourceId));
  return {
    name: "required_sources_used",
    passed: missing.length === 0,
    details: missing.length === 0 ? "all required sources used" : `missing sources: ${missing.join(", ")}`,
  };
}

function checkRejectedSources(testCase: ResearchEvaluationCase, output: ResearchRunOutput): EvalCheckResult {
  const missing = testCase.expected.mustRejectSourceIds.filter((sourceId) => !output.rejectedSourceIds.includes(sourceId));
  const usedRejected = testCase.expected.mustRejectSourceIds.filter((sourceId) => output.usedSourceIds.includes(sourceId));
  return {
    name: "unsafe_or_weak_sources_rejected",
    passed: missing.length === 0 && usedRejected.length === 0,
    details:
      missing.length === 0 && usedRejected.length === 0
        ? "all unsafe or weak sources rejected"
        : `not rejected: ${missing.join(", ")}; incorrectly used: ${usedRejected.join(", ")}`,
  };
}

function checkContradictions(testCase: ResearchEvaluationCase, output: ResearchRunOutput): EvalCheckResult {
  const missing = testCase.expected.contradictionSourceIds.filter(
    (sourceId) => !output.detectedContradictions.includes(sourceId),
  );
  return {
    name: "contradictions_handled",
    passed: missing.length === 0,
    details: missing.length === 0 ? "expected contradictions handled" : `missing conflicts: ${missing.join(", ")}`,
  };
}
