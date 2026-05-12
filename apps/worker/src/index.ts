import { Queue, Worker, type Job } from "bullmq";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runDeterministicWorkflow, type WorkflowExecutionResult } from "@agentflow/agents";
import { CreateWorkflowInputSchema, type CreateWorkflowInput } from "@agentflow/core";
import { createDatabaseClient, ensureTenant, saveWorkflowExecutionResult } from "@agentflow/db";

export const WORKFLOW_QUEUE_NAME = "agentflow.workflow.run";

export interface WorkflowJobData extends CreateWorkflowInput {
  readonly simulateToolFailureAttempts?: number;
}

export interface WorkerRuntimeOptions {
  readonly redisUrl: string;
  readonly concurrency?: number;
  readonly databaseUrl?: string;
}

const localTenant = {
  userId: "usr_local_reviewer",
  workspaceId: "wsp_local_research",
  userEmail: "local-reviewer@agentflow.local",
  userName: "Local Reviewer",
  workspaceName: "Research workspace",
} as const;

function loadDotEnv(): void {
  const candidates = [join(process.cwd(), ".env"), join(process.cwd(), "..", "..", ".env")];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) return;

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = valueParts.join("=").replace(/^"|"$/g, "");
  }
}

loadDotEnv();

function createRedisConnection(redisUrl: string) {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

export async function processWorkflowJob(job: Pick<Job<WorkflowJobData>, "data" | "updateProgress">): Promise<WorkflowExecutionResult> {
  const parsed = CreateWorkflowInputSchema.parse(job.data);
  await job.updateProgress({ status: "validated", title: parsed.title });

  const result = await runDeterministicWorkflow(parsed, {
    simulateToolFailureAttempts: job.data.simulateToolFailureAttempts ?? 0,
  });

  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl) {
    const { db, pool } = createDatabaseClient(databaseUrl);
    try {
      await ensureTenant(db, localTenant);
      await saveWorkflowExecutionResult(db, result);
    } finally {
      await pool.end();
    }
  }

  await job.updateProgress({
    status: result.workflow.status,
    steps: result.steps.map((step) => ({
      id: step.id,
      agentRole: step.agentRole,
      status: step.status,
      latencyMs: step.latencyMs,
    })),
  });

  return result;
}

export function createWorkflowQueue(options: WorkerRuntimeOptions): Queue<WorkflowJobData> {
  return new Queue<WorkflowJobData>(WORKFLOW_QUEUE_NAME, {
    connection: createRedisConnection(options.redisUrl),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });
}

export function createWorkflowWorker(options: WorkerRuntimeOptions): Worker<WorkflowJobData, WorkflowExecutionResult> {
  return new Worker<WorkflowJobData, WorkflowExecutionResult>(
    WORKFLOW_QUEUE_NAME,
    async (job) => processWorkflowJob(job),
    {
      connection: createRedisConnection(options.redisUrl),
      concurrency: options.concurrency ?? 2,
      autorun: true,
    },
  );
}

export async function enqueueWorkflow(queue: Queue<WorkflowJobData>, input: CreateWorkflowInput): Promise<string> {
  const parsed = CreateWorkflowInputSchema.parse(input);
  const job = await queue.add("workflow", parsed);

  return job.id ?? "";
}

export async function enqueueSampleWorkflow(queue: Queue<WorkflowJobData>): Promise<string> {
  const job = await queue.add("sample", {
    workspaceId: localTenant.workspaceId,
    userId: localTenant.userId,
    title: "Legal AI trends",
    goal: "Investiga tendencias actuales en plataformas de automatizacion con IA para equipos legales con fuentes reales.",
    format: "executive_report",
  });

  return job.id ?? "";
}

export async function runSampleWorkflowInProcess(): Promise<WorkflowExecutionResult> {
  return runDeterministicWorkflow({
    workspaceId: localTenant.workspaceId,
    userId: localTenant.userId,
    title: "Legal AI trends",
    goal: "Investiga tendencias actuales en herramientas de automatizacion con IA para equipos legales.",
    format: "executive_report",
  });
}
