import { relations, sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import {
  AGENT_ROLES,
  SOURCE_RELIABILITY,
  TOOL_CALL_STATUSES,
  TOOL_NAMES,
  WORKFLOW_STATUSES,
  WORKFLOW_STEP_STATUSES,
} from "@agentflow/core";

export const workflowStatusEnum = pgEnum("workflow_status", WORKFLOW_STATUSES);
export const workflowStepStatusEnum = pgEnum("workflow_step_status", WORKFLOW_STEP_STATUSES);
export const agentRoleEnum = pgEnum("agent_role", AGENT_ROLES);
export const toolNameEnum = pgEnum("tool_name", TOOL_NAMES);
export const toolCallStatusEnum = pgEnum("tool_call_status", TOOL_CALL_STATUSES);
export const sourceReliabilityEnum = pgEnum("source_reliability", SOURCE_RELIABILITY);

export const users = pgTable("users", {
  id: varchar("id", { length: 64 }).primaryKey().default(sql`gen_random_uuid()::text`),
  email: varchar("email", { length: 320 }).notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  emailIdx: uniqueIndex("users_email_idx").on(table.email),
}));

export const workspaces = pgTable("workspaces", {
  id: varchar("id", { length: 64 }).primaryKey().default(sql`gen_random_uuid()::text`),
  ownerUserId: varchar("owner_user_id", { length: 64 }).notNull().references(() => users.id, { onDelete: "restrict" }),
  name: varchar("name", { length: 160 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workflows = pgTable("workflows", {
  id: varchar("id", { length: 64 }).primaryKey().default(sql`gen_random_uuid()::text`),
  workspaceId: varchar("workspace_id", { length: 64 }).notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 64 }).notNull().references(() => users.id, { onDelete: "restrict" }),
  title: varchar("title", { length: 140 }).notNull(),
  goal: text("goal").notNull(),
  status: workflowStatusEnum("status").notNull().default("draft"),
  totalCostUsd: numeric("total_cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  totalLatencyMs: integer("total_latency_ms").notNull().default(0),
  retryCount: integer("retry_count").notNull().default(0),
  toolCallCount: integer("tool_call_count").notNull().default(0),
  qualityScore: numeric("quality_score", { precision: 5, scale: 4 }),
  traceId: varchar("trace_id", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workflowSteps = pgTable("workflow_steps", {
  id: varchar("id", { length: 64 }).primaryKey().default(sql`gen_random_uuid()::text`),
  workflowId: varchar("workflow_id", { length: 64 }).notNull().references(() => workflows.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  agentRole: agentRoleEnum("agent_role").notNull(),
  status: workflowStepStatusEnum("status").notNull().default("pending"),
  input: jsonb("input").notNull().default(sql`'{}'::jsonb`),
  output: jsonb("output"),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  latencyMs: integer("latency_ms").notNull().default(0),
  attempt: integer("attempt").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  workflowSequenceIdx: uniqueIndex("workflow_steps_workflow_sequence_idx").on(table.workflowId, table.sequence),
}));

export const agentRuns = pgTable("agent_runs", {
  id: varchar("id", { length: 64 }).primaryKey().default(sql`gen_random_uuid()::text`),
  workflowId: varchar("workflow_id", { length: 64 }).notNull().references(() => workflows.id, { onDelete: "cascade" }),
  stepId: varchar("step_id", { length: 64 }).notNull().references(() => workflowSteps.id, { onDelete: "cascade" }),
  agentRole: agentRoleEnum("agent_role").notNull(),
  status: workflowStepStatusEnum("status").notNull(),
  input: jsonb("input").notNull().default(sql`'{}'::jsonb`),
  output: jsonb("output"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  latencyMs: integer("latency_ms"),
});

export const toolCalls = pgTable("tool_calls", {
  id: varchar("id", { length: 64 }).primaryKey().default(sql`gen_random_uuid()::text`),
  workflowId: varchar("workflow_id", { length: 64 }).notNull().references(() => workflows.id, { onDelete: "cascade" }),
  stepId: varchar("step_id", { length: 64 }).notNull().references(() => workflowSteps.id, { onDelete: "cascade" }),
  agentRole: agentRoleEnum("agent_role").notNull(),
  toolName: toolNameEnum("tool_name").notNull(),
  status: toolCallStatusEnum("status").notNull(),
  input: jsonb("input").notNull().default(sql`'{}'::jsonb`),
  output: jsonb("output"),
  error: text("error"),
  attempt: integer("attempt").notNull(),
  maxAttempts: integer("max_attempts").notNull(),
  latencyMs: integer("latency_ms").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const sources = pgTable("sources", {
  id: varchar("id", { length: 64 }).primaryKey().default(sql`gen_random_uuid()::text`),
  workflowId: varchar("workflow_id", { length: 64 }).notNull().references(() => workflows.id, { onDelete: "cascade" }),
  stepId: varchar("step_id", { length: 64 }).references(() => workflowSteps.id, { onDelete: "set null" }),
  title: varchar("title", { length: 300 }).notNull(),
  url: text("url"),
  reference: text("reference"),
  excerpt: text("excerpt").notNull(),
  reliability: sourceReliabilityEnum("reliability").notNull(),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reports = pgTable("reports", {
  id: varchar("id", { length: 64 }).primaryKey().default(sql`gen_random_uuid()::text`),
  workflowId: varchar("workflow_id", { length: 64 }).notNull().references(() => workflows.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 160 }).notNull(),
  markdown: text("markdown").notNull(),
  sourceIds: jsonb("source_ids").notNull().default(sql`'[]'::jsonb`),
  objectKey: text("object_key"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  workflowVersionIdx: uniqueIndex("reports_workflow_version_idx").on(table.workflowId, table.version),
}));

export const workflowEvents = pgTable("workflow_events", {
  id: varchar("id", { length: 96 }).primaryKey(),
  workflowId: varchar("workflow_id", { length: 64 }).notNull().references(() => workflows.id, { onDelete: "cascade" }),
  stepId: varchar("step_id", { length: 64 }).references(() => workflowSteps.id, { onDelete: "set null" }),
  type: varchar("type", { length: 80 }).notNull(),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
});

export const evaluationResults = pgTable("evaluation_results", {
  id: varchar("id", { length: 64 }).primaryKey().default(sql`gen_random_uuid()::text`),
  workflowId: varchar("workflow_id", { length: 64 }).notNull().references(() => workflows.id, { onDelete: "cascade" }),
  objectiveScore: numeric("objective_score", { precision: 5, scale: 4 }).notNull(),
  sourceQualityScore: numeric("source_quality_score", { precision: 5, scale: 4 }).notNull(),
  unsupportedClaimRate: numeric("unsupported_claim_rate", { precision: 5, scale: 4 }).notNull(),
  contradictionDetected: boolean("contradiction_detected").notNull().default(false),
  toolUseScore: numeric("tool_use_score", { precision: 5, scale: 4 }).notNull(),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull(),
  latencyMs: integer("latency_ms").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workflowRelations = relations(workflows, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [workflows.workspaceId], references: [workspaces.id] }),
  user: one(users, { fields: [workflows.userId], references: [users.id] }),
  steps: many(workflowSteps),
  toolCalls: many(toolCalls),
  sources: many(sources),
  reports: many(reports),
  events: many(workflowEvents),
  evaluationResults: many(evaluationResults),
}));

export const workflowStepRelations = relations(workflowSteps, ({ one, many }) => ({
  workflow: one(workflows, { fields: [workflowSteps.workflowId], references: [workflows.id] }),
  agentRuns: many(agentRuns),
  toolCalls: many(toolCalls),
  sources: many(sources),
}));

export type UserRow = typeof users.$inferSelect;
export type WorkspaceRow = typeof workspaces.$inferSelect;
export type WorkflowRow = typeof workflows.$inferSelect;
export type WorkflowStepRow = typeof workflowSteps.$inferSelect;
export type AgentRunRow = typeof agentRuns.$inferSelect;
export type ToolCallRow = typeof toolCalls.$inferSelect;
export type SourceRow = typeof sources.$inferSelect;
export type ReportRow = typeof reports.$inferSelect;
export type WorkflowEventRow = typeof workflowEvents.$inferSelect;
export type EvaluationResultRow = typeof evaluationResults.$inferSelect;
