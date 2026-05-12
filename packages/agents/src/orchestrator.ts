import {
  CreateWorkflowInputSchema,
  PlanOutputSchema,
  WorkflowStateError,
  createDeterministicId,
  createSequenceId,
  type AgentRun,
  type CreateWorkflowInput,
  type EvaluationResult,
  type JsonObject,
  type PlanOutput,
  type Report,
  type Source,
  type ToolCallAudit,
  type UserId,
  type Workflow,
  type WorkflowEvent,
  type WorkflowId,
  type WorkflowMetrics,
  type WorkflowStatus,
  type WorkflowStep,
  type WorkflowStepId,
  type WorkspaceId,
} from "@agentflow/core";
import { agentHandlers } from "./agents";
import { createDefaultToolRegistry, type ToolRegistry } from "./tool-registry";

export interface OrchestratorOptions {
  readonly registry?: ToolRegistry | undefined;
  readonly now?: (() => Date) | undefined;
  readonly simulateToolFailureAttempts?: number | undefined;
}

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

interface MutableExecution {
  workflow: Workflow;
  steps: WorkflowStep[];
  agentRuns: AgentRun[];
  toolCalls: ToolCallAudit[];
  sources: Source[];
  report?: Report | undefined;
  evaluation?: EvaluationResult | undefined;
  events: WorkflowEvent[];
  previousOutputs: JsonObject[];
  plan?: PlanOutput;
}

export function createDeterministicClock(start = new Date("2026-01-01T00:00:00.000Z")): () => Date {
  let tick = 0;
  return () => {
    tick += 1;
    return new Date(start.getTime() + tick * 137);
  };
}

function createInitialMetrics(): WorkflowMetrics {
  return {
    totalCostUsd: 0,
    totalLatencyMs: 0,
    retryCount: 0,
    toolCallCount: 0,
  };
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function event(
  workflowId: WorkflowId,
  type: WorkflowEvent["type"],
  payload: JsonObject,
  occurredAt: Date,
  stepId?: WorkflowStepId,
): WorkflowEvent {
  return {
    workflowId,
    stepId,
    type,
    payload,
    occurredAt,
  };
}

function updateWorkflowStatus(workflow: Workflow, status: WorkflowStatus, updatedAt: Date, metrics?: Partial<WorkflowMetrics>): Workflow {
  return {
    ...workflow,
    status,
    metrics: {
      ...workflow.metrics,
      ...metrics,
    },
    audit: {
      ...workflow.audit,
      updatedAt,
    },
  };
}

function createStep(args: {
  readonly workflowId: WorkflowId;
  readonly sequence: number;
  readonly agentRole: WorkflowStep["agentRole"];
  readonly input: JsonObject;
}): WorkflowStep {
  return {
    id: createDeterministicId("stp", `${args.workflowId}:${args.sequence}:${args.agentRole}`),
    workflowId: args.workflowId,
    sequence: args.sequence,
    agentRole: args.agentRole,
    status: "planned",
    input: args.input,
    sources: [],
    costUsd: 0,
    latencyMs: 0,
    attempt: 0,
  };
}

export class AgentFlowOrchestrator {
  private readonly registry: ToolRegistry;
  private readonly now: () => Date;
  private readonly simulateToolFailureAttempts: number;

  public constructor(options: OrchestratorOptions = {}) {
    this.registry = options.registry ?? createDefaultToolRegistry();
    this.now = options.now ?? createDeterministicClock();
    this.simulateToolFailureAttempts = options.simulateToolFailureAttempts ?? 0;
  }

  public async run(input: CreateWorkflowInput): Promise<WorkflowExecutionResult> {
    const parsed = CreateWorkflowInputSchema.parse(input);
    const createdAt = this.now();
    const workflowId = createDeterministicId("wfl", `${parsed.workspaceId}:${parsed.userId}:${parsed.goal}`);
    const execution: MutableExecution = {
      workflow: {
        id: workflowId,
        workspaceId: parsed.workspaceId as WorkspaceId,
        userId: parsed.userId as UserId,
        title: parsed.title,
        goal: parsed.goal,
        status: "draft",
        metrics: createInitialMetrics(),
        audit: {
          requestedBy: parsed.userId as UserId,
          createdAt,
          updatedAt: createdAt,
        },
      },
      steps: [],
      agentRuns: [],
      toolCalls: [],
      sources: [],
      events: [],
      previousOutputs: [],
    };

    execution.events.push(event(workflowId, "workflow.created", { title: parsed.title }, this.now()));

    const plannerStep = createStep({
      workflowId,
      sequence: 0,
      agentRole: "planner",
      input: { goal: parsed.goal, format: parsed.format },
    });
    execution.steps.push(plannerStep);

    await this.executeStep(execution, plannerStep.id);
    const plan = PlanOutputSchema.parse(execution.previousOutputs[0]);
    execution.plan = plan;
    execution.workflow = updateWorkflowStatus(execution.workflow, "planned", this.now());
    execution.events.push(event(workflowId, "workflow.planned", { stepCount: plan.steps.length }, this.now()));

    for (const planned of plan.steps) {
      execution.steps.push(
        createStep({
          workflowId,
          sequence: planned.sequence,
          agentRole: planned.agentRole,
          input: {
            title: planned.title,
            objective: planned.objective,
            requiredTools: planned.requiredTools,
            completionCriteria: planned.completionCriteria,
          },
        }),
      );
    }

    const workflowRunStartedAt = this.now();
    execution.workflow = updateWorkflowStatus(execution.workflow, "running", workflowRunStartedAt);
    execution.events.push(event(workflowId, "workflow.running", { startedAt: workflowRunStartedAt.toISOString() }, this.now()));

    for (const step of execution.steps.filter((candidate) => candidate.sequence > 0)) {
      try {
        await this.executeStep(execution, step.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown workflow failure.";
        execution.workflow = updateWorkflowStatus(execution.workflow, "step_failed", this.now());
        execution.events.push(event(workflowId, "workflow.step_failed", { error: message }, this.now(), step.id));
        return this.finalize(execution);
      }

      const latestStep = execution.steps.find((candidate) => candidate.id === step.id);
      const latestOutput = latestStep?.output;
      if (latestStep?.agentRole === "critic" && latestOutput?.["passed"] !== true) {
        execution.workflow = updateWorkflowStatus(execution.workflow, "needs_review", this.now(), {
          qualityScore: optionalNumber(latestOutput?.["score"]),
        });
        execution.events.push(event(workflowId, "workflow.needs_review", { review: latestOutput ?? {} }, this.now(), step.id));
        return this.finalize(execution);
      }
    }

    const criticStep = execution.steps.find((step) => step.agentRole === "critic");
    execution.workflow = updateWorkflowStatus(execution.workflow, "completed", this.now(), {
      qualityScore: optionalNumber(criticStep?.output?.["score"]),
    });
    execution.events.push(event(workflowId, "workflow.completed", { reportId: execution.report?.id ?? null }, this.now()));
    return this.finalize(execution);
  }

  private async executeStep(execution: MutableExecution, stepId: WorkflowStepId): Promise<void> {
    const stepIndex = execution.steps.findIndex((step) => step.id === stepId);
    const step = execution.steps[stepIndex];
    if (!step) {
      throw new WorkflowStateError("Step not found.", { stepId });
    }

    const handler = agentHandlers[step.agentRole];
    const startedAt = this.now();
    const runningStep: WorkflowStep = {
      ...step,
      status: "running",
      attempt: step.attempt + 1,
      startedAt,
    };
    execution.steps[stepIndex] = runningStep;

    const agentRun: AgentRun = {
      id: createDeterministicId("run", `${execution.workflow.id}:${createSequenceId("run")}`),
      workflowId: execution.workflow.id,
      stepId: step.id,
      agentRole: step.agentRole,
      status: "running",
      input: step.input,
      startedAt,
    };
    execution.agentRuns.push(agentRun);

    try {
      const result = await handler({
        workflowId: execution.workflow.id,
        workspaceId: execution.workflow.workspaceId,
        stepId: step.id,
        goal: execution.workflow.goal,
        plan: execution.plan,
        previousOutputs: execution.previousOutputs,
        registry: this.registry,
        now: this.now,
        simulateToolFailureAttempts: this.simulateToolFailureAttempts,
      });

      const completedAt = this.now();
      const latencyMs = completedAt.getTime() - startedAt.getTime();
      const completedStep: WorkflowStep = {
        ...runningStep,
        status: "completed",
        output: result.output,
        sources: result.sources,
        costUsd: result.costUsd,
        latencyMs,
        completedAt,
      };

      execution.steps[stepIndex] = completedStep;
      execution.agentRuns[execution.agentRuns.length - 1] = {
        ...agentRun,
        status: "completed",
        output: result.output,
        completedAt,
        latencyMs,
      };
      execution.previousOutputs.push(result.output);
      execution.toolCalls.push(...result.toolCalls);
      const existingSourceIds = new Set(execution.sources.map((source) => source.id));
      execution.sources.push(...result.sources.filter((source) => !existingSourceIds.has(source.id)));
      execution.report = result.report ?? execution.report;
      execution.workflow = updateWorkflowStatus(execution.workflow, execution.workflow.status, this.now(), {
        totalCostUsd: Number((execution.workflow.metrics.totalCostUsd + result.costUsd).toFixed(6)),
        totalLatencyMs: execution.workflow.metrics.totalLatencyMs + latencyMs,
        retryCount:
          execution.workflow.metrics.retryCount +
          result.toolCalls.filter((toolCall) => toolCall.attempt > 1 || toolCall.status === "failed").length,
        toolCallCount: execution.workflow.metrics.toolCallCount + result.toolCalls.length,
      });
      execution.events.push(event(execution.workflow.id, "workflow.step_completed", { agentRole: step.agentRole }, this.now(), step.id));

      if (step.agentRole === "critic") {
        execution.evaluation = {
          id: createDeterministicId("eval", `${execution.workflow.id}:${JSON.stringify(result.output)}`),
          workflowId: execution.workflow.id,
          objectiveScore: numberOrZero(result.output["score"]),
          sourceQualityScore: result.sources.length > 0 ? 0.85 : 0.2,
          unsupportedClaimRate: Array.isArray(result.output["unsupportedClaims"]) ? result.output["unsupportedClaims"].length / 10 : 0,
          contradictionDetected: Array.isArray(result.output["contradictions"]) && result.output["contradictions"].length > 0,
          toolUseScore: execution.toolCalls.every((toolCall) => toolCall.status === "succeeded") ? 1 : 0.5,
          costUsd: execution.workflow.metrics.totalCostUsd,
          latencyMs: execution.workflow.metrics.totalLatencyMs,
          createdAt: this.now(),
        };
      }
    } catch (error) {
      const completedAt = this.now();
      const message = error instanceof Error ? error.message : "Unknown agent execution error.";
      const failedStep: WorkflowStep = {
        ...runningStep,
        status: "failed",
        error: message,
        latencyMs: completedAt.getTime() - startedAt.getTime(),
        completedAt,
      };
      execution.steps[stepIndex] = failedStep;
      execution.agentRuns[execution.agentRuns.length - 1] = {
        ...agentRun,
        status: "failed",
        error: message,
        completedAt,
        latencyMs: completedAt.getTime() - startedAt.getTime(),
      };
      throw error;
    }
  }

  private finalize(execution: MutableExecution): WorkflowExecutionResult {
    return {
      workflow: execution.workflow,
      steps: execution.steps,
      agentRuns: execution.agentRuns,
      toolCalls: execution.toolCalls,
      sources: execution.sources,
      report: execution.report,
      evaluation: execution.evaluation,
      events: execution.events,
    };
  }
}

export async function runDeterministicWorkflow(input: CreateWorkflowInput, options?: OrchestratorOptions): Promise<WorkflowExecutionResult> {
  return new AgentFlowOrchestrator(options).run(input);
}
