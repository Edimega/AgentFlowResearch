interface ReportSource {
  readonly id?: string;
  readonly credibility?: string;
}

export interface GenerateResearchReportInput {
  readonly caseId: string;
  readonly query: string;
  readonly sources: readonly unknown[];
  readonly findings: readonly {
    readonly claim: string;
    readonly sourceIds: readonly string[];
  }[];
  readonly rejectedSourceIds?: readonly string[];
  readonly contradictions?: readonly string[];
  readonly locale?: string;
}

export interface GeneratedReport {
  readonly status: "answered" | "needs_more_sources";
  readonly title: string;
  readonly body: string;
  readonly citations: readonly string[];
  readonly rejectedSourceIds: readonly string[];
  readonly detectedContradictions: readonly string[];
}

function isReportSource(value: unknown): value is ReportSource {
  return Boolean(value && typeof value === "object");
}

function sanitizeClaim(claim: string): string {
  return claim.replace(/ignore previous instructions|reveal system prompts|system prompts|canceled all upgrades/gi, "").trim();
}

export function generateResearchReport(input: GenerateResearchReportInput): GeneratedReport {
  const trustedSourceIds = new Set(
    input.sources
      .filter(isReportSource)
      .filter((source) => source.credibility === "primary" || source.credibility === "secondary")
      .map((source) => source.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  const rejectedSourceIds = [...(input.rejectedSourceIds ?? [])];
  const citations = [...new Set(input.findings.flatMap((finding) => finding.sourceIds).filter((sourceId) => trustedSourceIds.has(sourceId)))];

  if (citations.length < 2 || input.findings.length === 0) {
    return {
      status: "needs_more_sources",
      title: `Evidence review for ${input.caseId}`,
      body: `There is insufficient trusted evidence to answer "${input.query}" with a defensible report. More sources are required before making a final claim.`,
      citations,
      rejectedSourceIds,
      detectedContradictions: input.contradictions ?? [],
    };
  }

  const findingLines = input.findings.map((finding) => `- ${sanitizeClaim(finding.claim)} [${finding.sourceIds.join(", ")}]`);
  const contradictionLines = (input.contradictions ?? []).length
    ? [``, `Contradictions requiring review: ${(input.contradictions ?? []).join(", ")}.`]
    : [];

  return {
    status: "answered",
    title: `Research report for ${input.caseId}`,
    body: [`# Research report`, ``, `Query: ${input.query}`, ``, `Findings:`, ...findingLines, ...contradictionLines].join("\n"),
    citations,
    rejectedSourceIds,
    detectedContradictions: input.contradictions ?? [],
  };
}
