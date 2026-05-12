import { asc, desc, eq } from "drizzle-orm";
import {
  type AgentRun,
  type EvaluationResult,
  type JsonObject,
  type Report,
  type Source,
  type ToolCallAudit,
  type Workflow,
  type WorkflowEvent,
  type WorkflowId,
  type WorkflowStep,
} from "@agentflow/core";
import type { AgentFlowDatabase } from "./client";
import {
  agentRuns,
  evaluationResults,
  reports,
  sources,
  toolCalls,
  users,
  workflowEvents,
  workflows,
  workflowSteps,
  workspaces,
} from "./schema";

export interface WorkflowExecutionResult {
  readonly workflow: Workflow;
  readonly steps: readonly WorkflowStep[];
  readonly agentRuns: readonly AgentRun[];
  readonly toolCalls: readonly ToolCallAudit[];
  readonly sources: readonly Source[];
  readonly report?: Report | undefined;
  readonly evaluation?: EvaluationResult | undefined;
  readonly events: readonly WorkflowEvent[];
}

export interface TenantSeed {
  readonly userId: string;
  readonly workspaceId: string;
  readonly userEmail: string;
  readonly userName: string;
  readonly workspaceName: string;
}

function decimal(value: number): string {
  return value.toFixed(6);
}

function score(value: number | undefined): string | null {
  return typeof value === "number" ? value.toFixed(4) : null;
}

function asJsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function eventId(event: WorkflowEvent, index: number): string {
  return `${event.workflowId}:${event.type}:${event.stepId ?? "workflow"}:${event.occurredAt.toISOString()}:${index}`;
}

export async function ensureTenant(db: AgentFlowDatabase, seed: TenantSeed): Promise<void> {
  await db.insert(users).values({
    id: seed.userId,
    email: seed.userEmail,
    name: seed.userName,
  }).onConflictDoNothing();

  await db.insert(workspaces).values({
    id: seed.workspaceId,
    ownerUserId: seed.userId,
    name: seed.workspaceName,
  }).onConflictDoNothing();
}

export async function saveWorkflowExecutionResult(db: AgentFlowDatabase, result: WorkflowExecutionResult): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(workflows).where(eq(workflows.id, result.workflow.id));

    await tx.insert(workflows).values({
      id: result.workflow.id,
      workspaceId: result.workflow.workspaceId,
      userId: result.workflow.userId,
      title: result.workflow.title,
      goal: result.workflow.goal,
      status: result.workflow.status,
      totalCostUsd: decimal(result.workflow.metrics.totalCostUsd),
      totalLatencyMs: result.workflow.metrics.totalLatencyMs,
      retryCount: result.workflow.metrics.retryCount,
      toolCallCount: result.workflow.metrics.toolCallCount,
      qualityScore: score(result.workflow.metrics.qualityScore),
      traceId: result.workflow.audit.traceId,
      createdAt: result.workflow.audit.createdAt,
      updatedAt: result.workflow.audit.updatedAt,
    });

    if (result.steps.length > 0) {
      await tx.insert(workflowSteps).values(result.steps.map((step) => ({
        id: step.id,
        workflowId: step.workflowId,
        sequence: step.sequence,
        agentRole: step.agentRole,
        status: step.status,
        input: step.input,
        output: step.output,
        costUsd: decimal(step.costUsd),
        latencyMs: step.latencyMs,
        attempt: step.attempt,
        error: step.error,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
        createdAt: result.workflow.audit.createdAt,
        updatedAt: result.workflow.audit.updatedAt,
      })));
    }

    if (result.agentRuns.length > 0) {
      await tx.insert(agentRuns).values(result.agentRuns.map((run) => ({
        id: run.id,
        workflowId: run.workflowId,
        stepId: run.stepId,
        agentRole: run.agentRole,
        status: run.status,
        input: run.input,
        output: run.output,
        error: run.error,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        latencyMs: run.latencyMs,
      })));
    }

    if (result.toolCalls.length > 0) {
      await tx.insert(toolCalls).values(result.toolCalls.map((call) => ({
        id: call.id,
        workflowId: call.workflowId,
        stepId: call.stepId,
        agentRole: call.agentRole,
        toolName: call.toolName,
        status: call.status,
        input: call.input,
        output: call.output,
        error: call.error,
        attempt: call.attempt,
        maxAttempts: call.maxAttempts,
        latencyMs: call.latencyMs,
        startedAt: call.startedAt,
        completedAt: call.completedAt,
      })));
    }

    if (result.sources.length > 0) {
      await tx.insert(sources).values(result.sources.map((source) => ({
        id: source.id,
        workflowId: source.workflowId,
        stepId: source.stepId,
        title: source.title,
        url: source.url,
        reference: source.reference,
        excerpt: source.excerpt,
        reliability: source.reliability,
        retrievedAt: source.retrievedAt,
      }))).onConflictDoNothing();
    }

    if (result.report) {
      await tx.insert(reports).values({
        id: result.report.id,
        workflowId: result.report.workflowId,
        title: result.report.title,
        markdown: result.report.markdown,
        sourceIds: [...result.report.sourceIds],
        version: result.report.version,
        createdAt: result.report.createdAt,
      });
    }

    if (result.events.length > 0) {
      await tx.insert(workflowEvents).values(result.events.map((event, index) => ({
        id: eventId(event, index),
        workflowId: event.workflowId,
        stepId: event.stepId,
        type: event.type,
        payload: event.payload,
        occurredAt: event.occurredAt,
      })));
    }

    if (result.evaluation) {
      await tx.insert(evaluationResults).values({
        id: result.evaluation.id,
        workflowId: result.evaluation.workflowId,
        objectiveScore: score(result.evaluation.objectiveScore) ?? "0",
        sourceQualityScore: score(result.evaluation.sourceQualityScore) ?? "0",
        unsupportedClaimRate: score(result.evaluation.unsupportedClaimRate) ?? "0",
        contradictionDetected: result.evaluation.contradictionDetected,
        toolUseScore: score(result.evaluation.toolUseScore) ?? "0",
        costUsd: decimal(result.evaluation.costUsd),
        latencyMs: result.evaluation.latencyMs,
        createdAt: result.evaluation.createdAt,
      });
    }
  });
}

async function hydrateWorkflowResult(db: AgentFlowDatabase, workflow: typeof workflows.$inferSelect): Promise<WorkflowExecutionResult> {
  const [stepRows, runRows, toolRows, sourceRows, reportRows, eventRows, evaluationRows] = await Promise.all([
    db.select().from(workflowSteps).where(eq(workflowSteps.workflowId, workflow.id)).orderBy(asc(workflowSteps.sequence)),
    db.select().from(agentRuns).where(eq(agentRuns.workflowId, workflow.id)).orderBy(asc(agentRuns.startedAt)),
    db.select().from(toolCalls).where(eq(toolCalls.workflowId, workflow.id)).orderBy(asc(toolCalls.startedAt)),
    db.select().from(sources).where(eq(sources.workflowId, workflow.id)).orderBy(asc(sources.retrievedAt)),
    db.select().from(reports).where(eq(reports.workflowId, workflow.id)).orderBy(desc(reports.version)),
    db.select().from(workflowEvents).where(eq(workflowEvents.workflowId, workflow.id)).orderBy(asc(workflowEvents.occurredAt)),
    db.select().from(evaluationResults).where(eq(evaluationResults.workflowId, workflow.id)).orderBy(desc(evaluationResults.createdAt)),
  ]);

  const sourceEntities = sourceRows.map((source): Source => ({
    id: source.id as Source["id"],
    workflowId: source.workflowId as Source["workflowId"],
    stepId: source.stepId ? source.stepId as Source["stepId"] : undefined,
    title: source.title,
    url: source.url ?? undefined,
    reference: source.reference ?? undefined,
    excerpt: source.excerpt,
    reliability: source.reliability,
    retrievedAt: source.retrievedAt,
  }));

  const steps = stepRows.map((step): WorkflowStep => ({
    id: step.id as WorkflowStep["id"],
    workflowId: step.workflowId as WorkflowStep["workflowId"],
    sequence: step.sequence,
    agentRole: step.agentRole,
    status: step.status,
    input: asJsonObject(step.input),
    output: step.output ? asJsonObject(step.output) : undefined,
    sources: sourceEntities.filter((source) => source.stepId === step.id),
    costUsd: Number(step.costUsd),
    latencyMs: step.latencyMs,
    attempt: step.attempt,
    error: step.error ?? undefined,
    startedAt: step.startedAt ?? undefined,
    completedAt: step.completedAt ?? undefined,
  }));

  const workflowEntity: Workflow = {
    id: workflow.id as Workflow["id"],
    workspaceId: workflow.workspaceId as Workflow["workspaceId"],
    userId: workflow.userId as Workflow["userId"],
    title: workflow.title,
    goal: workflow.goal,
    status: workflow.status,
    metrics: {
      totalCostUsd: Number(workflow.totalCostUsd),
      totalLatencyMs: workflow.totalLatencyMs,
      retryCount: workflow.retryCount,
      toolCallCount: workflow.toolCallCount,
      qualityScore: workflow.qualityScore === null ? undefined : Number(workflow.qualityScore),
    },
    audit: {
      traceId: workflow.traceId ?? undefined,
      requestedBy: workflow.userId as Workflow["userId"],
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
    },
  };

  const report = reportRows[0]
    ? {
      id: reportRows[0].id as Report["id"],
      workflowId: reportRows[0].workflowId as Report["workflowId"],
      title: reportRows[0].title,
      markdown: reportRows[0].markdown,
      sourceIds: Array.isArray(reportRows[0].sourceIds) ? reportRows[0].sourceIds as Report["sourceIds"] : [],
      version: reportRows[0].version,
      createdAt: reportRows[0].createdAt,
    } satisfies Report
    : undefined;

  const evaluation = evaluationRows[0]
    ? {
      id: evaluationRows[0].id as EvaluationResult["id"],
      workflowId: evaluationRows[0].workflowId as EvaluationResult["workflowId"],
      objectiveScore: Number(evaluationRows[0].objectiveScore),
      sourceQualityScore: Number(evaluationRows[0].sourceQualityScore),
      unsupportedClaimRate: Number(evaluationRows[0].unsupportedClaimRate),
      contradictionDetected: evaluationRows[0].contradictionDetected,
      toolUseScore: Number(evaluationRows[0].toolUseScore),
      costUsd: Number(evaluationRows[0].costUsd),
      latencyMs: evaluationRows[0].latencyMs,
      createdAt: evaluationRows[0].createdAt,
    } satisfies EvaluationResult
    : undefined;

  return {
    workflow: workflowEntity,
    steps,
    agentRuns: runRows.map((run): AgentRun => ({
      id: run.id as AgentRun["id"],
      workflowId: run.workflowId as AgentRun["workflowId"],
      stepId: run.stepId as AgentRun["stepId"],
      agentRole: run.agentRole,
      status: run.status,
      input: asJsonObject(run.input),
      output: run.output ? asJsonObject(run.output) : undefined,
      error: run.error ?? undefined,
      startedAt: run.startedAt,
      completedAt: run.completedAt ?? undefined,
      latencyMs: run.latencyMs ?? undefined,
    })),
    toolCalls: toolRows.map((call): ToolCallAudit => ({
      id: call.id as ToolCallAudit["id"],
      workflowId: call.workflowId as ToolCallAudit["workflowId"],
      stepId: call.stepId as ToolCallAudit["stepId"],
      agentRole: call.agentRole,
      toolName: call.toolName,
      status: call.status,
      input: asJsonObject(call.input),
      output: call.output ? asJsonObject(call.output) : undefined,
      error: call.error ?? undefined,
      attempt: call.attempt,
      maxAttempts: call.maxAttempts,
      latencyMs: call.latencyMs,
      startedAt: call.startedAt,
      completedAt: call.completedAt ?? undefined,
    })),
    sources: sourceEntities,
    report,
    evaluation,
    events: eventRows.map((item): WorkflowEvent => ({
      workflowId: item.workflowId as WorkflowEvent["workflowId"],
      stepId: item.stepId ? item.stepId as WorkflowEvent["stepId"] : undefined,
      type: item.type as WorkflowEvent["type"],
      payload: asJsonObject(item.payload),
      occurredAt: item.occurredAt,
    })),
  };
}

export async function getWorkflowExecutionResult(db: AgentFlowDatabase, workflowId: WorkflowId): Promise<WorkflowExecutionResult | undefined> {
  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, workflowId)).limit(1);
  return workflow ? hydrateWorkflowResult(db, workflow) : undefined;
}

export async function listWorkflowExecutionResults(
  db: AgentFlowDatabase,
  workspaceId: string,
  limit = 20,
): Promise<WorkflowExecutionResult[]> {
  const rows = await db
    .select()
    .from(workflows)
    .where(eq(workflows.workspaceId, workspaceId))
    .orderBy(desc(workflows.updatedAt))
    .limit(limit);
  return Promise.all(rows.map((workflow) => hydrateWorkflowResult(db, workflow)));
}
