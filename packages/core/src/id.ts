import type {
  AgentRunId,
  EvaluationResultId,
  ReportId,
  SourceId,
  ToolCallId,
  UserId,
  WorkflowId,
  WorkflowStepId,
  WorkspaceId,
} from "./types";

const counters = new Map<string, number>();

export function createDeterministicId(prefix: "usr", seed: string): UserId;
export function createDeterministicId(prefix: "wsp", seed: string): WorkspaceId;
export function createDeterministicId(prefix: "wfl", seed: string): WorkflowId;
export function createDeterministicId(prefix: "stp", seed: string): WorkflowStepId;
export function createDeterministicId(prefix: "run", seed: string): AgentRunId;
export function createDeterministicId(prefix: "tool", seed: string): ToolCallId;
export function createDeterministicId(prefix: "src", seed: string): SourceId;
export function createDeterministicId(prefix: "rpt", seed: string): ReportId;
export function createDeterministicId(prefix: "eval", seed: string): EvaluationResultId;
export function createDeterministicId(prefix: string, seed: string): string {
  let hash = 2166136261;
  for (const char of `${prefix}:${seed}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(36)}`;
}

export function createSequenceId(prefix: string): string {
  const next = (counters.get(prefix) ?? 0) + 1;
  counters.set(prefix, next);
  return `${prefix}_${String(next).padStart(6, "0")}`;
}
