import type {
  AgentRole as CoreAgentRole,
  SourceReliability,
  ToolCallStatus as CoreToolCallStatus,
  ToolName as CoreToolName,
  WorkflowStatus,
  WorkflowStepStatus,
} from "@agentflow/core";

export type { WorkflowStatus } from "@agentflow/core";

export type AgentRole = CoreAgentRole;
export type StepStatus = WorkflowStepStatus;
export type ToolStatus = CoreToolCallStatus;
export type ToolName = CoreToolName;

export interface Source {
  id: string;
  title: string;
  url?: string;
  reference?: string;
  reliability: Exclude<SourceReliability, "rejected">;
}

export interface WorkflowStep {
  id: string;
  title: string;
  agent: AgentRole;
  status: StepStatus;
  input: string;
  output: string;
  costUsd: number;
  latencyMs: number;
  errors: string[];
  sources: Source[];
}

export interface AgentRun {
  id: string;
  agent: AgentRole;
  objective: string;
  status: StepStatus;
  qualityScore: number;
  tokens: number;
  handoff: string;
}

export interface ToolCall {
  id: string;
  time: string;
  agent: AgentRole;
  tool: ToolName;
  status: ToolStatus;
  latencyMs: number;
  retries: number;
  inputSchema: string;
}

export interface VersionComparison {
  field: string;
  current: string;
  previous: string;
  impact: "improved" | "changed" | "regressed";
}

export interface WorkflowMetric {
  label: string;
  value: string;
  trend: string;
  tone: "good" | "warn" | "bad" | "neutral";
}

export interface TimelineEvent {
  id: string;
  time: string;
  title: string;
  detail: string;
  status: StepStatus;
}

export interface Workflow {
  id: string;
  name: string;
  owner: string;
  status: WorkflowStatus;
  createdAt: string;
  objective: string;
  completion: number;
  metrics: WorkflowMetric[];
  steps: WorkflowStep[];
  agentRuns: AgentRun[];
  toolCalls: ToolCall[];
  timeline: TimelineEvent[];
  reportMarkdown: string;
  versions: VersionComparison[];
}
