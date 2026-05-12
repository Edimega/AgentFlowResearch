import { z } from "zod";
import {
  AGENT_ROLES,
  SOURCE_RELIABILITY,
  TOOL_CALL_STATUSES,
  TOOL_NAMES,
  WORKFLOW_STATUSES,
  WORKFLOW_STEP_STATUSES,
} from "./types";

export const NonEmptyStringSchema = z.string().trim().min(1);
export const IsoDateStringSchema = z.string().datetime();

export const WorkflowStatusSchema = z.enum(WORKFLOW_STATUSES);
export const WorkflowStepStatusSchema = z.enum(WORKFLOW_STEP_STATUSES);
export const AgentRoleSchema = z.enum(AGENT_ROLES);
export const ToolNameSchema = z.enum(TOOL_NAMES);
export const ToolCallStatusSchema = z.enum(TOOL_CALL_STATUSES);
export const SourceReliabilitySchema = z.enum(SOURCE_RELIABILITY);

export const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

export const CreateWorkflowInputSchema = z.object({
  workspaceId: NonEmptyStringSchema,
  userId: NonEmptyStringSchema,
  title: NonEmptyStringSchema.max(140),
  goal: NonEmptyStringSchema.min(12).max(4_000),
  format: z.enum(["executive_report", "comparison", "risk_report"]).default("executive_report"),
});

export const SourceSchema = z.object({
  id: NonEmptyStringSchema,
  workflowId: NonEmptyStringSchema,
  stepId: NonEmptyStringSchema.optional(),
  title: NonEmptyStringSchema,
  url: z.string().url().optional(),
  reference: NonEmptyStringSchema.optional(),
  excerpt: NonEmptyStringSchema.max(2_000),
  reliability: SourceReliabilitySchema,
  retrievedAt: z.date(),
});

export const PlanStepSchema = z.object({
  sequence: z.number().int().min(1),
  agentRole: AgentRoleSchema.exclude(["planner"]),
  title: NonEmptyStringSchema.max(120),
  objective: NonEmptyStringSchema.max(1_000),
  requiredTools: z.array(ToolNameSchema).max(4),
  completionCriteria: z.array(NonEmptyStringSchema).min(1).max(6),
});

export const PlanOutputSchema = z.object({
  finalObjective: NonEmptyStringSchema,
  keyQuestions: z.array(NonEmptyStringSchema).min(1).max(8),
  assumptions: z.array(NonEmptyStringSchema).max(8),
  risks: z.array(NonEmptyStringSchema).max(8),
  steps: z.array(PlanStepSchema).min(4).max(8),
});

export const AgentRunInputSchema = z.object({
  workflowId: NonEmptyStringSchema,
  stepId: NonEmptyStringSchema,
  agentRole: AgentRoleSchema,
  input: JsonObjectSchema,
});

export const WebSearchInputSchema = z.object({
  query: NonEmptyStringSchema.max(400),
  limit: z.number().int().min(1).max(8).default(5),
});

export const UrlReaderInputSchema = z.object({
  url: z.string().url().refine((url) => /^https?:\/\//i.test(url), {
    message: "Only HTTP(S) URLs are allowed.",
  }),
  maxChars: z.number().int().min(500).max(12_000).default(4_000),
});

export const FileReaderInputSchema = z.object({
  objectKey: NonEmptyStringSchema.max(500),
  maxChars: z.number().int().min(500).max(20_000).default(8_000),
});

export const TableGeneratorInputSchema = z.object({
  title: NonEmptyStringSchema.max(140),
  columns: z.array(NonEmptyStringSchema.max(80)).min(2).max(8),
  rows: z.array(z.array(z.string().max(500)).min(2).max(8)).min(1).max(30),
});

export const ReportExportInputSchema = z.object({
  workflowId: NonEmptyStringSchema,
  title: NonEmptyStringSchema.max(160),
  markdown: NonEmptyStringSchema.max(80_000),
  sourceIds: z.array(NonEmptyStringSchema).default([]),
});

export const KnowledgeBaseQueryInputSchema = z.object({
  workspaceId: NonEmptyStringSchema,
  query: NonEmptyStringSchema.max(400),
  limit: z.number().int().min(1).max(8).default(5),
});

export const ToolInputSchemas = {
  web_search: WebSearchInputSchema,
  url_reader: UrlReaderInputSchema,
  file_reader: FileReaderInputSchema,
  table_generator: TableGeneratorInputSchema,
  report_export: ReportExportInputSchema,
  knowledge_base_query: KnowledgeBaseQueryInputSchema,
} as const;

export const ToolCallRequestSchema = z.discriminatedUnion("toolName", [
  z.object({ toolName: z.literal("web_search"), input: WebSearchInputSchema }),
  z.object({ toolName: z.literal("url_reader"), input: UrlReaderInputSchema }),
  z.object({ toolName: z.literal("file_reader"), input: FileReaderInputSchema }),
  z.object({ toolName: z.literal("table_generator"), input: TableGeneratorInputSchema }),
  z.object({ toolName: z.literal("report_export"), input: ReportExportInputSchema }),
  z.object({ toolName: z.literal("knowledge_base_query"), input: KnowledgeBaseQueryInputSchema }),
]);

export const WorkflowMetricsSchema = z.object({
  totalCostUsd: z.number().min(0),
  totalLatencyMs: z.number().int().min(0),
  retryCount: z.number().int().min(0),
  toolCallCount: z.number().int().min(0),
  qualityScore: z.number().min(0).max(1).optional(),
});

export const QualityReviewSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  unsupportedClaims: z.array(NonEmptyStringSchema).default([]),
  contradictions: z.array(NonEmptyStringSchema).default([]),
  requiredCorrections: z.array(NonEmptyStringSchema).default([]),
});

export type CreateWorkflowInput = z.infer<typeof CreateWorkflowInputSchema>;
export type PlanOutput = z.infer<typeof PlanOutputSchema>;
export type PlanStep = z.infer<typeof PlanStepSchema>;
export type ToolCallRequest = z.infer<typeof ToolCallRequestSchema>;
export type QualityReview = z.infer<typeof QualityReviewSchema>;
