export type Brand<T, B extends string> = T & { readonly __brand: B };

export type UserId = Brand<string, "UserId">;
export type WorkspaceId = Brand<string, "WorkspaceId">;
export type WorkflowId = Brand<string, "WorkflowId">;
export type WorkflowStepId = Brand<string, "WorkflowStepId">;
export type AgentRunId = Brand<string, "AgentRunId">;
export type ToolCallId = Brand<string, "ToolCallId">;
export type SourceId = Brand<string, "SourceId">;
export type ReportId = Brand<string, "ReportId">;
export type EvaluationResultId = Brand<string, "EvaluationResultId">;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const WORKFLOW_STATUSES = [
  "draft",
  "planned",
  "running",
  "waiting_for_tool",
  "step_failed",
  "needs_review",
  "completed",
  "cancelled",
] as const;

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const WORKFLOW_STEP_STATUSES = [
  "pending",
  "planned",
  "running",
  "waiting_for_tool",
  "completed",
  "failed",
  "needs_review",
  "skipped",
  "cancelled",
] as const;

export type WorkflowStepStatus = (typeof WORKFLOW_STEP_STATUSES)[number];

export const AGENT_ROLES = ["planner", "research", "analyst", "writer", "critic"] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

export const TOOL_NAMES = [
  "web_search",
  "url_reader",
  "file_reader",
  "table_generator",
  "report_export",
  "knowledge_base_query",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export const TOOL_CALL_STATUSES = ["queued", "running", "succeeded", "failed", "timed_out"] as const;

export type ToolCallStatus = (typeof TOOL_CALL_STATUSES)[number];

export const SOURCE_RELIABILITY = ["high", "medium", "low", "rejected"] as const;

export type SourceReliability = (typeof SOURCE_RELIABILITY)[number];

export interface AuditMetadata {
  readonly traceId?: string | undefined;
  readonly spanId?: string | undefined;
  readonly requestedBy: UserId | "system";
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface Source {
  readonly id: SourceId;
  readonly workflowId: WorkflowId;
  readonly stepId?: WorkflowStepId | undefined;
  readonly title: string;
  readonly url?: string | undefined;
  readonly reference?: string | undefined;
  readonly excerpt: string;
  readonly reliability: SourceReliability;
  readonly retrievedAt: Date;
}

export interface Workflow {
  readonly id: WorkflowId;
  readonly workspaceId: WorkspaceId;
  readonly userId: UserId;
  readonly title: string;
  readonly goal: string;
  readonly status: WorkflowStatus;
  readonly metrics: WorkflowMetrics;
  readonly audit: AuditMetadata;
}

export interface WorkflowMetrics {
  readonly totalCostUsd: number;
  readonly totalLatencyMs: number;
  readonly retryCount: number;
  readonly toolCallCount: number;
  readonly qualityScore?: number | undefined;
}

export interface WorkflowStep {
  readonly id: WorkflowStepId;
  readonly workflowId: WorkflowId;
  readonly sequence: number;
  readonly agentRole: AgentRole;
  readonly status: WorkflowStepStatus;
  readonly input: JsonObject;
  readonly output?: JsonObject | undefined;
  readonly sources: readonly Source[];
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly attempt: number;
  readonly error?: string | undefined;
  readonly startedAt?: Date | undefined;
  readonly completedAt?: Date | undefined;
}

export interface AgentRun {
  readonly id: AgentRunId;
  readonly workflowId: WorkflowId;
  readonly stepId: WorkflowStepId;
  readonly agentRole: AgentRole;
  readonly status: WorkflowStepStatus;
  readonly input: JsonObject;
  readonly output?: JsonObject | undefined;
  readonly error?: string | undefined;
  readonly startedAt: Date;
  readonly completedAt?: Date | undefined;
  readonly latencyMs?: number | undefined;
}

export interface ToolCallAudit {
  readonly id: ToolCallId;
  readonly workflowId: WorkflowId;
  readonly stepId: WorkflowStepId;
  readonly agentRole: AgentRole;
  readonly toolName: ToolName;
  readonly status: ToolCallStatus;
  readonly input: JsonObject;
  readonly output?: JsonObject | undefined;
  readonly error?: string | undefined;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly latencyMs: number;
  readonly startedAt: Date;
  readonly completedAt?: Date | undefined;
}

export interface Report {
  readonly id: ReportId;
  readonly workflowId: WorkflowId;
  readonly title: string;
  readonly markdown: string;
  readonly sourceIds: readonly SourceId[];
  readonly version: number;
  readonly createdAt: Date;
}

export interface EvaluationResult {
  readonly id: EvaluationResultId;
  readonly workflowId: WorkflowId;
  readonly objectiveScore: number;
  readonly sourceQualityScore: number;
  readonly unsupportedClaimRate: number;
  readonly contradictionDetected: boolean;
  readonly toolUseScore: number;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly createdAt: Date;
}

export interface WorkflowEvent {
  readonly workflowId: WorkflowId;
  readonly stepId?: WorkflowStepId | undefined;
  readonly type:
    | "workflow.created"
    | "workflow.planned"
    | "workflow.running"
    | "workflow.waiting_for_tool"
    | "workflow.step_completed"
    | "workflow.step_failed"
    | "workflow.needs_review"
    | "workflow.completed"
    | "workflow.cancelled";
  readonly payload: JsonObject;
  readonly occurredAt: Date;
}
