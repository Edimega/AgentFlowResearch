import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { generateWorkflowTitle, runDeterministicWorkflow } from "@agentflow/agents";
import {
  CreateWorkflowInputSchema,
  createDeterministicId,
  createResearchPlan,
  type CreateWorkflowInput,
  type ResearchPlan,
  type WorkflowEvent,
} from "@agentflow/core";
import {
  createDatabaseClient,
  ensureTenant,
  getWorkflowExecutionResult,
  listWorkflowExecutionResults,
  saveWorkflowExecutionResult,
  type DatabaseClient,
  type WorkflowExecutionResult as PersistedWorkflowExecutionResult,
} from "@agentflow/db";
import { createWorkflowQueue } from "@agentflow/worker";
import { emptyWorkflow } from "../empty-workflow";
import { workflowResultToView, type StoredWorkflow } from "../workflow-view";
import type { Workflow } from "../types";

const workspaceId = "wsp_local_research";
const userId = "usr_local_reviewer";
const tenantSeed = {
  userId,
  workspaceId,
  userEmail: "local-reviewer@agentflow.local",
  userName: "Local Reviewer",
  workspaceName: "Research workspace",
} as const;

let databaseClient: DatabaseClient | undefined;

function repoRoot(): string {
  return process.cwd().endsWith(join("apps", "web")) ? join(process.cwd(), "..", "..") : process.cwd();
}

function storePath(): string {
  return join(repoRoot(), ".agentflow", "workflows.json");
}

async function readStore(): Promise<StoredWorkflow[]> {
  try {
    const raw = await readFile(storePath(), "utf8");
    return JSON.parse(raw) as StoredWorkflow[];
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeStore(workflows: readonly StoredWorkflow[]): Promise<void> {
  const path = storePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(workflows, null, 2), "utf8");
}

function database(): DatabaseClient | undefined {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) return undefined;
  databaseClient ??= createDatabaseClient(databaseUrl);
  return databaseClient;
}

async function ensureDatabaseTenant(client: DatabaseClient): Promise<void> {
  await ensureTenant(client.db, tenantSeed);
}

function shouldUseQueue(): boolean {
  return process.env["AGENTFLOW_EXECUTION_MODE"] === "queue" && Boolean(process.env["REDIS_URL"]);
}

function createQueuedResult(input: CreateWorkflowInput): PersistedWorkflowExecutionResult {
  const createdAt = new Date();
  const workflowId = createDeterministicId("wfl", `${input.workspaceId}:${input.userId}:${input.goal}`);
  const events: WorkflowEvent[] = [
    {
      workflowId: workflowId as WorkflowEvent["workflowId"],
      type: "workflow.created",
      payload: { title: input.title },
      occurredAt: createdAt,
    },
    {
      workflowId: workflowId as WorkflowEvent["workflowId"],
      type: "workflow.running",
      payload: { mode: "queue", redis: "enabled" },
      occurredAt: createdAt,
    },
  ];

  return {
    workflow: {
      id: workflowId as PersistedWorkflowExecutionResult["workflow"]["id"],
      workspaceId: input.workspaceId as PersistedWorkflowExecutionResult["workflow"]["workspaceId"],
      userId: input.userId as PersistedWorkflowExecutionResult["workflow"]["userId"],
      title: input.title,
      goal: input.goal,
      status: "running",
      metrics: {
        totalCostUsd: 0,
        totalLatencyMs: 0,
        retryCount: 0,
        toolCallCount: 0,
      },
      audit: {
        requestedBy: input.userId as PersistedWorkflowExecutionResult["workflow"]["userId"],
        createdAt,
        updatedAt: createdAt,
      },
    },
    steps: [],
    agentRuns: [],
    toolCalls: [],
    sources: [],
    events,
  };
}

function workflowInputFromView(workflow: Workflow): CreateWorkflowInput {
  return CreateWorkflowInputSchema.parse({
    workspaceId,
    userId,
    title: workflow.name,
    goal: workflow.objective,
    format: "executive_report",
  });
}

async function saveLocalWorkflow(input: CreateWorkflowInput, workflow: Workflow): Promise<void> {
  const now = new Date().toISOString();
  const stored = await readStore();
  const next = [
    {
      input,
      workflow,
      createdAt: now,
      updatedAt: now,
    },
    ...stored.filter((item) => item.workflow.id !== workflow.id),
  ].slice(0, 20);
  await writeStore(next);
}

export async function listWorkflowViews(): Promise<Workflow[]> {
  const client = database();
  if (client) {
    await ensureDatabaseTenant(client);
    const results = await listWorkflowExecutionResults(client.db, workspaceId);
    if (results.length > 0) {
      return results.map((result) => workflowResultToView(result, workflowInputFromView({
        id: result.workflow.id,
        name: result.workflow.title,
        owner: result.workflow.workspaceId,
        status: result.workflow.status,
        createdAt: result.workflow.audit.createdAt.toISOString(),
        objective: result.workflow.goal,
        completion: 0,
        metrics: [],
        steps: [],
        agentRuns: [],
        toolCalls: [],
        timeline: [],
        reportMarkdown: "",
        versions: [],
      })));
    }
  }

  const stored = await readStore();
  return stored.length > 0 ? stored.map((item) => item.workflow) : [];
}

export async function getWorkflowView(workflowId: string): Promise<Workflow | undefined> {
  if (workflowId === emptyWorkflow.id) return emptyWorkflow;
  const client = database();
  if (client) {
    await ensureDatabaseTenant(client);
    const result = await getWorkflowExecutionResult(client.db, workflowId as PersistedWorkflowExecutionResult["workflow"]["id"]);
    if (result && result.workflow.workspaceId === workspaceId) {
      return workflowResultToView(result, CreateWorkflowInputSchema.parse({
        workspaceId: result.workflow.workspaceId,
        userId: result.workflow.userId,
        title: result.workflow.title,
        goal: result.workflow.goal,
        format: "executive_report",
      }));
    }
  }

  const stored = await readStore();
  return stored.find((item) => item.workflow.id === workflowId)?.workflow;
}

export async function createWorkflowRun(request: {
  readonly title?: string;
  readonly goal: string;
  readonly format?: CreateWorkflowInput["format"];
}): Promise<Workflow> {
  const title = request.title?.trim() || (await generateWorkflowTitle(request.goal));
  const input = CreateWorkflowInputSchema.parse({
    workspaceId,
    userId,
    title,
    goal: request.goal,
    format: request.format ?? "executive_report",
  });

  const client = database();
  if (client) {
    await ensureDatabaseTenant(client);
    if (shouldUseQueue()) {
      const queued = createQueuedResult(input);
      await saveWorkflowExecutionResult(client.db, queued);
      const queue = createWorkflowQueue({ redisUrl: process.env["REDIS_URL"] ?? "" });
      try {
        await queue.add("workflow", input, { jobId: queued.workflow.id });
      } finally {
        await queue.close();
      }
      return workflowResultToView(queued, input);
    }

    const result = await runDeterministicWorkflow(input);
    await saveWorkflowExecutionResult(client.db, result);
    return workflowResultToView(result, input);
  }

  const result = await runDeterministicWorkflow(input);
  const workflow = workflowResultToView(result, input);
  await saveLocalWorkflow(input, workflow);
  return workflow;
}

export async function retryWorkflowRun(workflowId: string): Promise<Workflow | undefined> {
  const client = database();
  if (client) {
    await ensureDatabaseTenant(client);
    const existing = await getWorkflowExecutionResult(client.db, workflowId as PersistedWorkflowExecutionResult["workflow"]["id"]);
    if (!existing || existing.workflow.workspaceId !== workspaceId) return undefined;
    const input = CreateWorkflowInputSchema.parse({
      workspaceId: existing.workflow.workspaceId,
      userId: existing.workflow.userId,
      title: existing.workflow.title,
      goal: existing.workflow.goal,
      format: "executive_report",
    });
    const result = await runDeterministicWorkflow(input, { simulateToolFailureAttempts: 1 });
    await saveWorkflowExecutionResult(client.db, result);
    return workflowResultToView(result, input);
  }

  const stored = await readStore();
  const existing = stored.find((item) => item.workflow.id === workflowId);
  if (!existing) return undefined;

  const result = await runDeterministicWorkflow(existing.input, { simulateToolFailureAttempts: 1 });
  const workflow = workflowResultToView(result, existing.input);
  const updated: StoredWorkflow = {
    ...existing,
    workflow,
    updatedAt: new Date().toISOString(),
  };
  await writeStore([updated, ...stored.filter((item) => item.workflow.id !== workflowId)]);
  return workflow;
}

export function previewWorkflowPlan(goal: string): ResearchPlan {
  return createResearchPlan({
    query: goal,
    locale: "en-US",
    now: new Date().toISOString(),
  });
}
