import type {
  AgentRun as CoreAgentRun,
  CreateWorkflowInput,
  Source as CoreSource,
  ToolCallAudit,
  WorkflowEvent,
  WorkflowStep as CoreWorkflowStep,
} from "@agentflow/core";
import type { WorkflowExecutionResult } from "@agentflow/agents";
import type {
  AgentRun,
  Source,
  TimelineEvent,
  ToolCall,
  VersionComparison,
  Workflow,
  WorkflowMetric,
  WorkflowStep,
} from "./types";

export type { Workflow } from "./types";

const toolSchemaLabels: Record<string, string> = {
  web_search: "{ query: string, limit?: number }",
  url_reader: "{ url: string, maxChars?: number }",
  file_reader: "{ objectKey: string, maxChars?: number }",
  table_generator: "{ title: string, columns: string[], rows: string[][] }",
  report_export: "{ workflowId: string, title: string, markdown: string }",
  knowledge_base_query: "{ workspaceId: string, query: string, limit?: number }",
};

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

function titleForStep(step: CoreWorkflowStep): string {
  if (typeof step.input["title"] === "string") return step.input["title"];
  if (step.agentRole === "planner") return "Scope research plan";
  return `${step.agentRole.charAt(0).toUpperCase()}${step.agentRole.slice(1)} step`;
}

function objectiveForStep(step: CoreWorkflowStep): string {
  return typeof step.input["objective"] === "string" ? step.input["objective"] : asText(step.input);
}

function sourceToView(source: CoreSource): Source {
  return {
    id: source.id,
    title: source.title,
    reliability: source.reliability === "rejected" ? "low" : source.reliability,
    ...(source.url ? { url: source.url } : {}),
    ...(source.reference ? { reference: source.reference } : {}),
  };
}

function stepToView(step: CoreWorkflowStep): WorkflowStep {
  return {
    id: step.id,
    title: titleForStep(step),
    agent: step.agentRole,
    status: step.status,
    input: objectiveForStep(step),
    output: step.error ?? asText(step.output ?? "Waiting for execution."),
    costUsd: step.costUsd,
    latencyMs: step.latencyMs,
    errors: step.error ? [step.error] : [],
    sources: step.sources.map(sourceToView),
  };
}

function runToView(run: CoreAgentRun): AgentRun {
  const score = typeof run.output?.["score"] === "number" ? Math.round(run.output["score"] * 100) : run.status === "completed" ? 88 : 0;
  return {
    id: run.id,
    agent: run.agentRole,
    objective: asText(run.input["objective"] ?? run.input),
    status: run.status,
    qualityScore: score,
    tokens: Math.max(0, Math.round((run.latencyMs ?? 0) / 10) + JSON.stringify(run.input).length),
    handoff: run.error ?? (run.status === "completed" ? "Step completed with auditable output." : "Step is waiting for execution."),
  };
}

function toolToView(toolCall: ToolCallAudit): ToolCall {
  return {
    id: toolCall.id,
    time: toolCall.startedAt.toISOString().slice(11, 16),
    agent: toolCall.agentRole,
    tool: toolCall.toolName,
    status: toolCall.status,
    latencyMs: toolCall.latencyMs,
    retries: Math.max(0, toolCall.attempt - 1),
    inputSchema: toolSchemaLabels[toolCall.toolName] ?? "{ input: object }",
  };
}

function eventToTimeline(event: WorkflowEvent): TimelineEvent {
  const status = event.type.includes("failed")
    ? "failed"
    : event.type.includes("needs_review")
      ? "needs_review"
      : event.type.includes("running")
        ? "running"
        : "completed";
  return {
    id: `${event.type}-${event.occurredAt.toISOString()}`,
    time: event.occurredAt.toISOString().slice(11, 16),
    title: event.type.replace("workflow.", "").replaceAll("_", " "),
    detail: asText(event.payload),
    status,
  };
}

function metricsFor(result: WorkflowExecutionResult): WorkflowMetric[] {
  const completedSteps = result.steps.filter((step) => step.status === "completed").length;
  const successRate = result.steps.length > 0 ? Math.round((completedSteps / result.steps.length) * 100) : 0;
  return [
    { label: "Success rate", value: `${successRate}%`, trend: `${completedSteps}/${result.steps.length} steps complete`, tone: successRate >= 80 ? "good" : "warn" },
    { label: "Latency", value: `${Math.round(result.workflow.metrics.totalLatencyMs / 1000)}s`, trend: "deterministic local run", tone: "neutral" },
    { label: "Run cost", value: `$${result.workflow.metrics.totalCostUsd.toFixed(4)}`, trend: `${result.workflow.metrics.toolCallCount} tool calls`, tone: "good" },
    { label: "Quality score", value: `${Math.round((result.workflow.metrics.qualityScore ?? 0) * 100)}/100`, trend: result.workflow.status, tone: result.workflow.status === "completed" ? "good" : "warn" },
  ];
}

function versionsFor(result: WorkflowExecutionResult): VersionComparison[] {
  const uniqueSourceCount = new Set(result.sources.map((source) => source.id)).size;
  return [
    {
      field: "Plan",
      previous: "Manual research request without explicit steps.",
      current: `${result.steps.length} auditable steps with assigned agents.`,
      impact: "improved",
    },
    {
      field: "Evidence",
      previous: "Untracked source usage.",
      current: `${uniqueSourceCount} sources captured with reliability labels.`,
      impact: "improved",
    },
    {
      field: "Quality gate",
      previous: "No critic review.",
      current: result.evaluation ? `Score ${Math.round(result.evaluation.objectiveScore * 100)}/100 with contradiction tracking.` : "Critic review recorded in workflow state.",
      impact: "changed",
    },
  ];
}

export function workflowResultToView(result: WorkflowExecutionResult, input: CreateWorkflowInput): Workflow {
  const completion = result.steps.length > 0
    ? Math.round((result.steps.filter((step) => step.status === "completed").length / result.steps.length) * 100)
    : 0;

  return {
    id: result.workflow.id,
    name: result.workflow.title,
    owner: input.workspaceId,
    status: result.workflow.status,
    createdAt: result.workflow.audit.createdAt.toISOString(),
    objective: result.workflow.goal,
    completion,
    metrics: metricsFor(result),
    steps: result.steps.map(stepToView),
    agentRuns: result.agentRuns.map(runToView),
    toolCalls: result.toolCalls.map(toolToView),
    timeline: result.events.map(eventToTimeline),
    reportMarkdown: result.report?.markdown ?? "# Report\n\nNo report was generated.",
    versions: versionsFor(result),
  };
}

export interface StoredWorkflow {
  readonly input: CreateWorkflowInput;
  readonly workflow: Workflow;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkflowListResponse {
  readonly workflows: readonly Workflow[];
}

export interface WorkflowResponse {
  readonly workflow: Workflow;
}

export interface CreateWorkflowRequest {
  readonly title?: string;
  readonly goal: string;
  readonly format?: CreateWorkflowInput["format"];
}
