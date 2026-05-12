export type ResearchCaseCategory =
  | "normal"
  | "insufficient_sources"
  | "prompt_injection"
  | "contradiction";

export type SourceCredibility = "primary" | "secondary" | "low" | "malicious";

export interface ResearchSourceFixture {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly publishedAt: string;
  readonly credibility: SourceCredibility;
  readonly content: string;
}

export interface ResearchCaseExpected {
  readonly outcome: "answer" | "needs_more_sources" | "answer_with_conflict";
  readonly minTrustedSources: number;
  readonly mustUseSourceIds: readonly string[];
  readonly mustRejectSourceIds: readonly string[];
  readonly mustMention: readonly string[];
  readonly mustNotMention: readonly string[];
  readonly contradictionSourceIds: readonly string[];
}

export interface ResearchEvaluationCase {
  readonly id: string;
  readonly category: ResearchCaseCategory;
  readonly query: string;
  readonly createdAt: string;
  readonly locale: "en-US";
  readonly sources: readonly ResearchSourceFixture[];
  readonly expected: ResearchCaseExpected;
}

export interface ResearchRunOutput {
  readonly caseId: string;
  readonly status: "answered" | "needs_more_sources" | "failed";
  readonly report: string;
  readonly usedSourceIds: readonly string[];
  readonly rejectedSourceIds: readonly string[];
  readonly detectedContradictions: readonly string[];
  readonly citations: readonly string[];
}

export interface EvalCheckResult {
  readonly name: string;
  readonly passed: boolean;
  readonly details: string;
}

export interface CaseEvalResult {
  readonly caseId: string;
  readonly category: ResearchCaseCategory;
  readonly passed: boolean;
  readonly checks: readonly EvalCheckResult[];
}
