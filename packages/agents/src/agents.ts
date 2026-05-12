import {
  PlanOutputSchema,
  QualityReviewSchema,
  ToolExecutionError,
  createDeterministicId,
  type AgentRole,
  type JsonObject,
  type PlanOutput,
  type QualityReview,
  type Report,
  type Source,
  type ToolCallAudit,
  type ToolName,
  type WorkflowId,
  type WorkflowStepId,
} from "@agentflow/core";
import { executeTool, sourceFromToolResult, type ExecuteToolOptions, type ToolRegistry } from "./tool-registry";
import { createOpenRouterChatCompletion, isOpenRouterConfigured, parseJsonFromModel } from "./openrouter";

export interface AgentExecutionContext {
  readonly workflowId: WorkflowId;
  readonly workspaceId: string;
  readonly stepId: WorkflowStepId;
  readonly goal: string;
  readonly plan?: PlanOutput | undefined;
  readonly previousOutputs: readonly JsonObject[];
  readonly registry: ToolRegistry;
  readonly now: () => Date;
  readonly simulateToolFailureAttempts?: number | undefined;
}

export interface AgentExecutionResult {
  readonly output: JsonObject;
  readonly sources: readonly Source[];
  readonly toolCalls: readonly ToolCallAudit[];
  readonly costUsd: number;
  readonly report?: Report | undefined;
}

export type AgentHandler = (context: AgentExecutionContext) => Promise<AgentExecutionResult>;

function classifyGoal(goal: string): "competitor" | "market" | "document" | "general" {
  const normalized = goal.toLowerCase();
  if (normalized.includes("competidor") || normalized.includes("competitor") || normalized.includes("compara")) {
    return "competitor";
  }
  if (normalized.includes("mercado") || normalized.includes("market") || normalized.includes("tendencia")) {
    return "market";
  }
  if (normalized.includes("document") || normalized.includes("riesgo")) {
    return "document";
  }
  return "general";
}

function buildPlan(goal: string): PlanOutput {
  const category = classifyGoal(goal);
  const keyQuestionByCategory = {
    competitor: [
      "What alternatives are most relevant to the target buyer?",
      "Where do competitors show clear strengths and weaknesses?",
      "Which differentiation opportunities are evidence-backed?",
    ],
    market: [
      "Which adoption patterns are visible?",
      "Which buyer segments have urgent pain?",
      "Which risks could slow adoption?",
    ],
    document: [
      "Which risks are supported by supplied evidence?",
      "Which actions reduce the highest-impact issues?",
      "Which claims need stronger evidence?",
    ],
    general: [
      "What facts are most relevant to the objective?",
      "Which sources are reliable enough to cite?",
      "What conclusions follow from the evidence?",
    ],
  } as const;

  return PlanOutputSchema.parse({
    finalObjective: goal,
    keyQuestions: keyQuestionByCategory[category],
    assumptions: ["The research run uses public web sources available at execution time.", "External pages can be slow, blocked, incomplete, or change after retrieval."],
    risks: ["Sources may be insufficient for current market claims.", "Contradictions require explicit review before delivery."],
    steps: [
      {
        sequence: 1,
        agentRole: "research",
        title: "Collect and filter evidence",
        objective: "Gather reliable sources and separate evidence from inference.",
        requiredTools: ["web_search", "url_reader", "knowledge_base_query"],
        completionCriteria: ["At least two sources are reviewed.", "Weak sources are marked or excluded."],
      },
      {
        sequence: 2,
        agentRole: "analyst",
        title: "Structure findings",
        objective: "Compare evidence, identify patterns, risks, and opportunities.",
        requiredTools: ["table_generator"],
        completionCriteria: ["Findings are traceable to sources.", "Risks and opportunities are separated."],
      },
      {
        sequence: 3,
        agentRole: "writer",
        title: "Draft report",
        objective: "Create a professional Markdown report with cited sources.",
        requiredTools: ["table_generator", "report_export"],
        completionCriteria: ["Report answers the original objective.", "Important claims include sources."],
      },
      {
        sequence: 4,
        agentRole: "critic",
        title: "Quality review",
        objective: "Validate evidence coverage, contradictions, and readiness.",
        requiredTools: [],
        completionCriteria: ["Unsupported claims are flagged.", "A quality score is produced."],
      },
    ],
  });
}

function normalizePlan(plan: PlanOutput): PlanOutput {
  const researchStep =
    plan.steps.find((step) => step.agentRole === "research") ??
    ({
      sequence: 0,
      agentRole: "research",
      title: "Collect and filter evidence",
      objective: "Gather reliable public web sources and separate evidence from inference.",
      requiredTools: ["web_search", "url_reader", "knowledge_base_query"],
      completionCriteria: ["At least two sources are reviewed.", "Weak sources are marked or excluded."],
    } as const);
  const analystStep =
    plan.steps.find((step) => step.agentRole === "analyst") ??
    ({
      sequence: 0,
      agentRole: "analyst",
      title: "Structure findings",
      objective: "Compare evidence, identify patterns, risks, and opportunities.",
      requiredTools: ["table_generator"],
      completionCriteria: ["Findings are traceable to sources.", "Risks and opportunities are separated."],
    } as const);
  const writerStep =
    plan.steps.find((step) => step.agentRole === "writer") ??
    ({
      sequence: 0,
      agentRole: "writer",
      title: "Draft report",
      objective: "Create a professional Markdown report with cited sources.",
      requiredTools: ["table_generator", "report_export"],
      completionCriteria: ["Report answers the original objective.", "Important claims include sources."],
    } as const);
  const criticStep =
    plan.steps.find((step) => step.agentRole === "critic") ??
    ({
      sequence: 0,
      agentRole: "critic",
      title: "Quality review",
      objective: "Validate evidence coverage, contradictions, and readiness.",
      requiredTools: [],
      completionCriteria: ["Unsupported claims are flagged.", "A quality score is produced."],
    } as const);
  const steps = [researchStep, analystStep, writerStep, criticStep].map((step, index) => ({
    ...step,
    sequence: index + 1,
  }));

  return PlanOutputSchema.parse({ ...plan, steps });
}

function textFromPreviousOutputs(outputs: readonly JsonObject[]): string {
  return outputs.map((output) => JSON.stringify(output)).join("\n");
}

function extractSources(outputs: readonly JsonObject[]): Source[] {
  const rawSources = outputs.flatMap((output) => {
    const sources = (output as Record<string, unknown>)["sources"];
    return Array.isArray(sources) ? sources : [];
  });
  const validSources = rawSources.filter((source): source is Source => Boolean(source && typeof source === "object" && "id" in source));
  return [...new Map(validSources.map((source) => [source.id, source])).values()];
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isToolCallAudit(value: unknown): value is ToolCallAudit {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      "toolName" in value &&
      "status" in value &&
      "attempt" in value &&
      "maxAttempts" in value,
  );
}

function toolAuditsFromError(error: unknown): readonly ToolCallAudit[] {
  if (!(error instanceof ToolExecutionError) || !error.details || typeof error.details !== "object" || Array.isArray(error.details)) {
    return [];
  }
  const audits = (error.details as { readonly audits?: unknown })["audits"];
  return Array.isArray(audits) ? audits.filter(isToolCallAudit) : [];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown tool failure.";
}

async function executeResearchTool(
  context: AgentExecutionContext,
  request: { readonly toolName: ToolName; readonly input: JsonObject },
  options?: ExecuteToolOptions,
): Promise<{ readonly output?: JsonObject; readonly audits: readonly ToolCallAudit[]; readonly error?: unknown }> {
  try {
    const result = await executeTool(
      context.registry,
      request,
      {
        workflowId: context.workflowId,
        stepId: context.stepId,
        agentRole: "research",
        workspaceId: context.workspaceId,
        now: context.now,
      },
      options,
    );
    return { output: result.output, audits: result.audits };
  } catch (error) {
    return { audits: toolAuditsFromError(error), error };
  }
}

function resultsFromToolOutput(output: JsonObject | undefined): JsonObject[] {
  const results = output?.["results"];
  return Array.isArray(results) ? results.filter(isJsonObject) : [];
}

function sourceMarker(index: number): string {
  return `[S${index + 1}]`;
}

function sourceReference(source: Source): string {
  return source.url ?? source.reference ?? "internal reference";
}

function tableCell(value: string, maxLength = 480): string {
  const normalized = value.replace(/\s+/g, " ").replace(/\|/g, "/").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function shouldUseOpenRouterForAgent(agent: "planner" | "writer" | "critic"): boolean {
  if (!isOpenRouterConfigured()) return false;
  const enabledAgents = process.env["OPENROUTER_AGENTS"];
  if (!enabledAgents) return agent === "writer";
  return enabledAgents
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .includes(agent);
}

function deterministicTitleFromGoal(goal: string): string {
  const cleaned = goal
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const stopWords = new Set(["investiga", "resume", "analiza", "actuales", "para", "con", "sobre", "riesgos", "oportunidades", "senales", "señales"]);
  const words = cleaned
    .split(" ")
    .filter((word) => word.length > 2 && !stopWords.has(word.toLowerCase()))
    .slice(0, 5);
  const title = words.join(" ").trim();
  return title.length >= 3 ? title.slice(0, 80) : "Research run";
}

export async function generateWorkflowTitle(goal: string): Promise<string> {
  if (isOpenRouterConfigured()) {
    try {
      const completion = await createOpenRouterChatCompletion({
        maxTokens: 24,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: [
              "<personalidad>",
              "Eres un editor de producto. Generas titulos cortos, claros y profesionales para workflows de investigacion.",
              "</personalidad>",
              "",
              "<ejecucion>",
              "Lee el objetivo.",
              "Resume el tema principal en pocas palabras.",
              "Devuelve solo el titulo, sin comillas, sin punto final y sin Markdown.",
              "</ejecucion>",
              "",
              "<restricciones>",
              "Maximo 6 palabras.",
              "Maximo 80 caracteres.",
              "No incluyas URLs ni prefijos como 'Titulo:'.",
              "</restricciones>",
            ].join("\n"),
          },
          {
            role: "user",
            content: goal,
          },
        ],
      });
      const title = completion.content.replace(/^["']|["']$/g, "").replace(/\s+/g, " ").trim();
      if (title.length >= 3) return title.slice(0, 80);
    } catch {
      console.warn("OpenRouter title generation was unavailable. Using deterministic title.");
    }
  }
  return deterministicTitleFromGoal(goal);
}

function plannerSystemPrompt(): string {
  return [
    "<personalidad>",
    "Eres el agente planner de AgentFlow Research. Tu trabajo es convertir un objetivo de investigacion en un plan auditable, seguro y ejecutable por agentes especializados.",
    "</personalidad>",
    "",
    "<ejecucion>",
    "Analiza el objetivo de investigacion.",
    "Define preguntas clave, supuestos y riesgos.",
    "Divide el trabajo en exactamente cuatro pasos, en este orden: research, analyst, writer y critic.",
    "Usa solo herramientas permitidas para cada paso.",
    "No agregues pasos que no puedan ser ejecutados por el sistema.",
    "</ejecucion>",
    "",
    "<formato>",
    "Devuelve exclusivamente JSON valido.",
    "La estructura exacta es: { finalObjective: string, keyQuestions: string[], assumptions: string[], risks: string[], steps: Step[] }.",
    "Cada Step debe tener: { sequence: number, agentRole: 'research'|'analyst'|'writer'|'critic', title: string, objective: string, requiredTools: ToolName[], completionCriteria: string[] }.",
    "ToolName solo puede ser: web_search, url_reader, file_reader, table_generator, report_export, knowledge_base_query.",
    "</formato>",
    "",
    "<ejemplo>",
    "{\"finalObjective\":\"Investigar adopcion de IA legal\",\"keyQuestions\":[\"Que senales de adopcion existen?\"],\"assumptions\":[\"Las fuentes disponibles pueden ser limitadas\"],\"risks\":[\"No citar fuentes no verificadas\"],\"steps\":[{\"sequence\":1,\"agentRole\":\"research\",\"title\":\"Collect evidence\",\"objective\":\"Gather reliable evidence\",\"requiredTools\":[\"web_search\",\"url_reader\"],\"completionCriteria\":[\"Sources are captured\"]}]}",
    "</ejemplo>",
    "",
    "<restricciones>",
    "No incluyas Markdown.",
    "No inventes URLs ni fuentes.",
    "No incluyas texto fuera del JSON.",
    "</restricciones>",
  ].join("\n");
}

function writerSystemPrompt(): string {
  return [
    "<personalidad>",
    "Eres el agente writer de AgentFlow Research. Redactas reportes profesionales, sobrios y verificables para equipos de producto, estrategia y operaciones.",
    "</personalidad>",
    "",
    "<ejecucion>",
    "Usa solamente la evidencia entregada en el mensaje del usuario.",
    "Separa hechos, inferencias, oportunidades y riesgos.",
    "Cita cada afirmacion relevante con su marcador [S#].",
    "Si una fuente no trae URL publica HTTP(S), nombrala como referencia interna y no la conviertas en enlace externo.",
    "Si el objetivo pide informacion actual y las fuentes no son actuales, dilo explicitamente como limitacion.",
    "</ejecucion>",
    "",
    "<formato>",
    "Devuelve Markdown.",
    "Usa estas secciones exactas: # Research Report, ## Objective, ## Executive Summary, ## Evidence And Analysis, ## Opportunities, ## Risks, ## Sources.",
    "En Sources usa bullets con este formato: - [S#] Titulo - Referencia - reliability.",
    "</formato>",
    "",
    "<ejemplo>",
    "- [S1] Legal automation operations survey - <URL publica o referencia interna recibida> - high reliability",
    "</ejemplo>",
    "",
    "<restricciones>",
    "No inventes competidores, fechas, estadisticas ni URLs.",
    "No uses dominios de ejemplo.",
    "No agregues enlaces si la fuente no trae una URL publica HTTP(S).",
    "</restricciones>",
  ].join("\n");
}

function criticSystemPrompt(): string {
  return [
    "<personalidad>",
    "Eres el agente critic de AgentFlow Research. Evalua si el reporte cumple el objetivo, usa evidencia suficiente y evita afirmaciones no sustentadas.",
    "</personalidad>",
    "",
    "<ejecucion>",
    "Compara el objetivo original contra el reporte.",
    "Marca afirmaciones sin soporte.",
    "Detecta contradicciones, fuentes duplicadas y enlaces inventados.",
    "Exige correcciones cuando el reporte promete comparar entidades que no aparecen en la evidencia.",
    "</ejecucion>",
    "",
    "<formato>",
    "Devuelve exclusivamente JSON valido con esta estructura: { passed: boolean, score: number, unsupportedClaims: string[], contradictions: string[], requiredCorrections: string[] }.",
    "score debe estar entre 0 y 1.",
    "</formato>",
    "",
    "<restricciones>",
    "No incluyas Markdown.",
    "No incluyas texto fuera del JSON.",
    "No apruebes reportes con URLs inventadas, fuentes inaccesibles o referencias tratadas como enlaces reales.",
    "</restricciones>",
  ].join("\n");
}

export async function runPlannerAgent(context: AgentExecutionContext): Promise<AgentExecutionResult> {
  if (shouldUseOpenRouterForAgent("planner")) {
    try {
      const completion = await createOpenRouterChatCompletion({
        responseFormat: "json_object",
        maxTokens: 1_500,
        messages: [
          {
            role: "system",
            content: plannerSystemPrompt(),
          },
          {
            role: "user",
            content: `Research goal: ${context.goal}`,
          },
        ],
      });
      const plan = normalizePlan(PlanOutputSchema.parse(parseJsonFromModel(completion.content, PlanOutputSchema)));
      return {
        output: plan as unknown as JsonObject,
        sources: [],
        toolCalls: [],
        costUsd: Math.max(0.001, completion.totalTokens * 0.000001),
      };
    } catch {
      console.warn("OpenRouter planner output was invalid. Using deterministic planner.");
    }
  }

  const plan = normalizePlan(buildPlan(context.goal));
  return {
    output: plan as unknown as JsonObject,
    sources: [],
    toolCalls: [],
    costUsd: 0.001,
  };
}

export async function runResearchAgent(context: AgentExecutionContext): Promise<AgentExecutionResult> {
  const toolCalls: ToolCallAudit[] = [];
  const sources: Source[] = extractSources(context.previousOutputs);
  const sourceWarnings: string[] = [];
  const query = `${context.goal} ${context.plan?.keyQuestions.join(" ") ?? ""}`.slice(0, 400);

  const searchOptions =
    typeof context.simulateToolFailureAttempts === "number"
      ? { simulateTransientFailureAttempts: context.simulateToolFailureAttempts }
      : undefined;
  const webSearchOptions = { timeoutMs: 10_000, maxRetries: 1, ...(searchOptions ?? {}) };
  const pageReadOptions = { timeoutMs: 8_000, maxRetries: 0 };

  const search = await executeResearchTool(
    context,
    { toolName: "web_search", input: { query, limit: 3 } },
    webSearchOptions,
  );
  toolCalls.push(...search.audits);
  if (search.error) {
    sourceWarnings.push(`Primary web search failed: ${errorMessage(search.error)}`);
  }

  const primaryResults = resultsFromToolOutput(search.output);
  let secondaryResults: JsonObject[] = [];
  if (primaryResults.length < 3) {
    const kb = await executeResearchTool(
      context,
      { toolName: "knowledge_base_query", input: { workspaceId: context.workspaceId, query, limit: 3 - primaryResults.length } },
      { timeoutMs: 10_000, maxRetries: 0 },
    );
    toolCalls.push(...kb.audits);
    secondaryResults = resultsFromToolOutput(kb.output);
    if (kb.error) {
      sourceWarnings.push(`Secondary web discovery failed: ${errorMessage(kb.error)}`);
    }
  }

  const results = [...primaryResults, ...secondaryResults].slice(0, 3);

  for (const result of results) {
    if (typeof result["url"] === "string") {
      const read = await executeResearchTool(
        context,
        { toolName: "url_reader", input: { url: result["url"], maxChars: 2_000 } },
        pageReadOptions,
      );
      toolCalls.push(...read.audits);
      if (read.output) {
        sources.push(sourceFromToolResult({ workflowId: context.workflowId, stepId: context.stepId, result: read.output, now: context.now() }));
      } else {
        sourceWarnings.push(`Source read failed for ${result["url"]}: ${errorMessage(read.error)}`);
        sources.push(sourceFromToolResult({ workflowId: context.workflowId, stepId: context.stepId, result, now: context.now() }));
      }
    } else {
      sources.push(sourceFromToolResult({ workflowId: context.workflowId, stepId: context.stepId, result, now: context.now() }));
    }
  }
  const uniqueSources = [...new Map(sources.map((source) => [source.id, source])).values()];
  if (uniqueSources.length === 0) {
    throw new ToolExecutionError("No real web sources were collected.", {
      retryable: true,
      details: { audits: toolCalls, sourceWarnings },
    });
  }

  return {
    output: {
      findings: uniqueSources.map((source, index) => ({
        marker: sourceMarker(index),
        sourceId: source.id,
        claim: source.excerpt,
        reliability: source.reliability,
      })),
      rejectedSources: uniqueSources.filter((source) => source.reliability === "rejected").map((source) => source.id),
      sourceWarnings,
      sources: uniqueSources,
    } as unknown as JsonObject,
    sources: uniqueSources,
    toolCalls,
    costUsd: 0.002 + toolCalls.length * 0.0005,
  };
}

export async function runAnalystAgent(context: AgentExecutionContext): Promise<AgentExecutionResult> {
  const inheritedSources = extractSources(context.previousOutputs);
  const rows = inheritedSources.slice(0, 5).map((source, index) => [
    sourceMarker(index),
    tableCell(source.title, 160),
    tableCell(source.excerpt),
    source.reliability,
  ]);

  const table = await executeTool(context.registry, {
    toolName: "table_generator",
    input: {
      title: "Evidence matrix",
      columns: ["Source", "Title", "Evidence", "Reliability"],
      rows: rows.length > 0 ? rows : [["S1", "No source", "No evidence gathered", "low"]],
    },
  }, {
    workflowId: context.workflowId,
    stepId: context.stepId,
    agentRole: "analyst",
    workspaceId: context.workspaceId,
    now: context.now,
  });

  const evidenceText = inheritedSources.map((source) => source.excerpt).join(" ");
  const mentionsAuditability = /audit|trace|evidence|control|compliance/i.test(evidenceText);

  return {
    output: {
      evidenceTable: table.output["markdown"],
      findings: [
        "Buyers prioritize clear workflow outcomes over generic chat behavior.",
        mentionsAuditability
          ? "Auditability and controlled tool use are recurring decision factors."
          : "Evidence is not strong enough to claim auditability as a primary driver.",
      ],
      opportunities: ["Differentiate with traceable agent steps, source quality labels, and retry controls."],
      risks: ["Live claims require current sources before production use.", "Weak sources should block final approval."],
      sourceIds: inheritedSources.map((source) => source.id),
    } as JsonObject,
    sources: inheritedSources,
    toolCalls: table.audits,
    costUsd: 0.0015,
  };
}

export async function runWriterAgent(context: AgentExecutionContext): Promise<AgentExecutionResult> {
  const inheritedSources = extractSources(context.previousOutputs);
  const previousText = textFromPreviousOutputs(context.previousOutputs);
  const sourceLines = inheritedSources.map((source, index) => `${sourceMarker(index)} ${source.title} - ${sourceReference(source)} - ${source.reliability} reliability`);
  const deterministicMarkdown = [
    `# Research Report`,
    "",
    `## Objective`,
    context.goal,
    "",
    "## Executive Summary",
    "The workflow collected live web evidence and produced an auditable report. Conclusions should be treated as source-backed findings from the retrieved pages, with limitations called out where sources are incomplete.",
    "",
    "## Evidence And Analysis",
    previousText.includes("evidenceTable")
      ? String(context.previousOutputs.find((output) => typeof output["evidenceTable"] === "string")?.["evidenceTable"])
      : "No evidence table was generated.",
    "",
    "## Opportunities",
    "- Build around traceable agent execution, explicit source quality, and controlled retries.",
    "- Use source freshness, citation quality, and repeatable review gates to improve trust.",
    "",
    "## Risks",
    "- Public web sources can be incomplete, blocked, outdated, or biased.",
    "- Unsupported claims must remain blocked by critic review.",
    "",
    "## Sources",
    ...sourceLines,
  ].join("\n");
  let markdown = deterministicMarkdown;
  if (shouldUseOpenRouterForAgent("writer")) {
    try {
      markdown = (await createOpenRouterChatCompletion({
        maxTokens: 2_400,
        temperature: 0.25,
        messages: [
          {
            role: "system",
            content: writerSystemPrompt(),
          },
          {
            role: "user",
            content: [
              `Objective: ${context.goal}`,
              "",
              "Intermediate outputs:",
              previousText,
              "",
              "Available sources:",
              ...sourceLines,
            ].join("\n"),
          },
        ],
      })).content;
    } catch {
      console.warn("OpenRouter writer output was unavailable. Using deterministic writer.");
    }
  }

  const exported = await executeTool(context.registry, {
    toolName: "report_export",
    input: {
      workflowId: context.workflowId,
      title: "Research Report",
      markdown,
      sourceIds: inheritedSources.map((source) => source.id),
    },
  }, {
    workflowId: context.workflowId,
    stepId: context.stepId,
    agentRole: "writer",
    workspaceId: context.workspaceId,
    now: context.now,
  });

  const report: Report = {
    id: createDeterministicId("rpt", `${context.workflowId}:${markdown}`),
    workflowId: context.workflowId,
    title: "Research Report",
    markdown,
    sourceIds: inheritedSources.map((source) => source.id),
    version: 1,
    createdAt: context.now(),
  };

  return {
    output: {
      reportId: report.id,
      markdown,
      objectKey: exported.output["objectKey"],
      sourceIds: [...report.sourceIds],
    } as unknown as JsonObject,
    sources: inheritedSources,
    toolCalls: exported.audits,
    costUsd: 0.002,
    report,
  };
}

export async function runCriticAgent(context: AgentExecutionContext): Promise<AgentExecutionResult> {
  const inheritedSources = extractSources(context.previousOutputs);
  const reportOutput = context.previousOutputs.find((output) => typeof output["markdown"] === "string");
  const markdown = String(reportOutput?.["markdown"] ?? "");
  const hasSourcesSection = markdown.includes("## Sources") && inheritedSources.length > 0;
  const mentionsUncertainty = markdown.toLowerCase().includes("production") || markdown.toLowerCase().includes("limited");
  const unsupportedClaims = hasSourcesSection ? [] : ["Report has no cited sources."];
  const contradictions = markdown.includes("No evidence") && inheritedSources.length > 0 ? ["Report says no evidence despite collected sources."] : [];
  const score = Math.max(0, Math.min(1, 0.55 + (hasSourcesSection ? 0.25 : 0) + (mentionsUncertainty ? 0.15 : 0) - contradictions.length * 0.25));

  const deterministicReview = QualityReviewSchema.parse({
    passed: score >= 0.75 && unsupportedClaims.length === 0 && contradictions.length === 0,
    score,
    unsupportedClaims,
    contradictions,
    requiredCorrections: score >= 0.75 ? [] : ["Add stronger citations or revise unsupported claims before completion."],
  });
  let review: QualityReview = deterministicReview;
  if (shouldUseOpenRouterForAgent("critic")) {
    try {
      review = QualityReviewSchema.parse(parseJsonFromModel((await createOpenRouterChatCompletion({
        responseFormat: "json_object",
        maxTokens: 1_000,
        temperature: 0,
        messages: [
        {
          role: "system",
          content: criticSystemPrompt(),
        },
          {
            role: "user",
            content: [
              `Objective: ${context.goal}`,
              "",
              "Report:",
              markdown,
              "",
              "Sources:",
              ...inheritedSources.map((source, index) => `${sourceMarker(index)} ${source.title}: ${source.excerpt}`),
            ].join("\n"),
          },
        ],
      })).content, QualityReviewSchema));
    } catch {
      console.warn("OpenRouter critic output was invalid. Using deterministic critic.");
    }
  }

  return {
    output: review as unknown as JsonObject,
    sources: inheritedSources,
    toolCalls: [],
    costUsd: 0.001,
  };
}

export const agentHandlers: Record<AgentRole, AgentHandler> = {
  planner: runPlannerAgent,
  research: runResearchAgent,
  analyst: runAnalystAgent,
  writer: runWriterAgent,
  critic: runCriticAgent,
};
