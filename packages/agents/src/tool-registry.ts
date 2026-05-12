import { z } from "zod";
import {
  AgentFlowError,
  ToolExecutionError,
  ToolInputSchemas,
  ToolNotAllowedError,
  ValidationError,
  createDeterministicId,
  createSequenceId,
  type AgentRole,
  type JsonObject,
  type Source,
  type ToolCallAudit,
  type ToolName,
  type WorkflowId,
  type WorkflowStepId,
} from "@agentflow/core";

export interface ToolContext {
  readonly workflowId: WorkflowId;
  readonly stepId: WorkflowStepId;
  readonly agentRole: AgentRole;
  readonly workspaceId: string;
  readonly now: () => Date;
}

export interface ToolDefinition<TInput extends JsonObject, TOutput extends JsonObject> {
  readonly name: ToolName;
  readonly description: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly allowedAgentRoles: readonly AgentRole[];
  readonly defaultTimeoutMs: number;
  readonly maxRetries: number;
  readonly execute: (input: TInput, context: ToolContext) => Promise<TOutput>;
}

export interface ToolRunResult<TOutput extends JsonObject = JsonObject> {
  readonly output: TOutput;
  readonly audits: readonly ToolCallAudit[];
}

export type ToolRegistry = ReadonlyMap<ToolName, ToolDefinition<JsonObject, JsonObject>>;

export interface ExecuteToolOptions {
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly simulateTransientFailureAttempts?: number;
}

interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly reliability: "high" | "medium" | "low";
  readonly rank: number;
}

function webFetchTimeoutMs(): number {
  const configured = Number(process.env["WEB_FETCH_TIMEOUT_MS"] ?? 12_000);
  return Number.isFinite(configured) && configured > 0 ? configured : 12_000;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)));
}

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchUrl(rawHref: string): string | undefined {
  const href = decodeHtml(rawHref.trim());
  const absolute = href.startsWith("//") ? `https:${href}` : href;

  try {
    const parsed = new URL(absolute, "https://duckduckgo.com");
    const redirected = parsed.searchParams.get("uddg");
    const candidate = redirected ? new URL(redirected) : parsed;
    if (!/^https?:$/.test(candidate.protocol)) return undefined;
    if (/duckduckgo\.com$/i.test(candidate.hostname)) return undefined;
    return candidate.toString();
  } catch {
    return undefined;
  }
}

function reliabilityForUrl(url: string): "high" | "medium" | "low" {
  const hostname = new URL(url).hostname.toLowerCase();
  if (/\.(gov|edu)$/i.test(hostname) || /(who\.int|worldbank\.org|oecd\.org|europa\.eu)$/i.test(hostname)) return "high";
  if (/\.(org)$/i.test(hostname) || /(reuters\.com|apnews\.com|bbc\.com|forbes\.com|gartner\.com|mckinsey\.com)$/i.test(hostname)) return "medium";
  return "medium";
}

function parseSearchResults(html: string, limit: number): SearchResult[] {
  const anchors = [...html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const snippets = [...html.matchAll(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<td[^>]+class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/gi)]
    .map((match) => stripHtml(match[1] ?? match[2] ?? ""));
  const seen = new Set<string>();
  const results: SearchResult[] = [];

  for (const [index, anchor] of anchors.entries()) {
    const url = normalizeSearchUrl(anchor[1] ?? "");
    const title = stripHtml(anchor[2] ?? "");
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    results.push({
      title,
      url,
      snippet: snippets[index] || title,
      reliability: reliabilityForUrl(url),
      rank: results.length + 1,
    });
    if (results.length >= limit) break;
  }

  return results;
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new ToolExecutionError(`Request timed out after ${timeoutMs}ms.`, { retryable: true }));
    }, timeoutMs);
  });
  const request = (async () => {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        "User-Agent": "AgentFlowResearch/1.0 (+https://localhost)",
      },
    });
    if (!response.ok) {
      throw new ToolExecutionError(`Request failed with status ${response.status}.`, { retryable: response.status >= 500 || response.status === 429 });
    }
    return response.text();
  })();

  try {
    return await Promise.race([request, timeoutPromise]);
  } catch (error) {
    if (error instanceof ToolExecutionError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ToolExecutionError(`Request timed out after ${timeoutMs}ms.`, { retryable: true });
    }
    throw new ToolExecutionError(error instanceof Error ? error.message : "Network request failed.", { retryable: true });
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function searchWeb(query: string, limit: number): Promise<SearchResult[]> {
  const endpoint = new URL(process.env["WEB_SEARCH_ENDPOINT"] ?? "https://duckduckgo.com/html/");
  endpoint.searchParams.set("q", query);
  const html = await fetchText(endpoint.toString(), webFetchTimeoutMs());
  const results = parseSearchResults(html, limit);
  if (results.length === 0) {
    throw new ToolExecutionError("No real web search results were returned.", { retryable: true });
  }
  return results;
}

function extractPageText(html: string, maxChars: number): { readonly title: string; readonly content: string } {
  const title = stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "Untitled source");
  const description = stripHtml(html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? "");
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ");
  const content = [description, stripHtml(body)].filter(Boolean).join("\n\n").slice(0, maxChars);
  return { title, content };
}

function toJsonObject(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return { value: String(value) };
}

function normalizeError(error: unknown): AgentFlowError {
  if (error instanceof AgentFlowError) {
    return error;
  }
  if (error instanceof Error) {
    return new ToolExecutionError(error.message, { retryable: true });
  }
  return new ToolExecutionError("Unknown tool execution error.", { retryable: true, details: error });
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, toolName: ToolName): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new ToolExecutionError(`Tool "${toolName}" timed out after ${timeoutMs}ms.`, { retryable: true }));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function executeTool(
  registry: ToolRegistry,
  request: { readonly toolName: ToolName; readonly input: JsonObject },
  context: ToolContext,
  options: ExecuteToolOptions = {},
): Promise<ToolRunResult> {
  const definition = registry.get(request.toolName);
  if (!definition) {
    throw new ToolNotAllowedError(request.toolName, context.agentRole);
  }

  if (!definition.allowedAgentRoles.includes(context.agentRole)) {
    throw new ToolNotAllowedError(request.toolName, context.agentRole);
  }

  const parsedInput = definition.inputSchema.safeParse(request.input);
  if (!parsedInput.success) {
    throw new ValidationError(`Invalid input for tool "${request.toolName}".`, parsedInput.error.flatten());
  }

  const timeoutMs = options.timeoutMs ?? definition.defaultTimeoutMs;
  const maxRetries = options.maxRetries ?? definition.maxRetries;
  const maxAttempts = maxRetries + 1;
  const audits: ToolCallAudit[] = [];
  let lastError: AgentFlowError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = context.now();
    const auditBase = {
      id: createDeterministicId("tool", `${context.workflowId}:${createSequenceId("tool")}`),
      workflowId: context.workflowId,
      stepId: context.stepId,
      agentRole: context.agentRole,
      toolName: request.toolName,
      input: parsedInput.data,
      attempt,
      maxAttempts,
      startedAt,
    };

    try {
      if (attempt <= (options.simulateTransientFailureAttempts ?? 0)) {
        throw new ToolExecutionError("Simulated transient tool failure.", { retryable: true });
      }

      const output = await withTimeout(definition.execute(parsedInput.data, context), timeoutMs, request.toolName);
      const completedAt = context.now();
      audits.push({
        ...auditBase,
        status: "succeeded",
        output,
        latencyMs: completedAt.getTime() - startedAt.getTime(),
        completedAt,
      });
      return { output, audits };
    } catch (error) {
      const normalized = normalizeError(error);
      lastError = normalized;
      const completedAt = context.now();
      audits.push({
        ...auditBase,
        status: normalized.message.includes("timed out") ? "timed_out" : "failed",
        error: normalized.message,
        latencyMs: completedAt.getTime() - startedAt.getTime(),
        completedAt,
      });

      if (!normalized.retryable || attempt === maxAttempts) {
        const failure = new ToolExecutionError(normalized.message, {
          retryable: false,
          details: { audits, originalCode: normalized.code },
        });
        throw failure;
      }
    }
  }

  throw new ToolExecutionError(lastError?.message ?? "Tool execution failed.", {
    retryable: false,
    details: { audits },
  });
}

export function createDefaultToolRegistry(): ToolRegistry {
  const definitions: ToolDefinition<JsonObject, JsonObject>[] = [
    {
      name: "web_search",
      description: "Searches the public web through a headless HTML search request.",
      inputSchema: ToolInputSchemas.web_search as z.ZodType<JsonObject>,
      allowedAgentRoles: ["research"],
      defaultTimeoutMs: 15_000,
      maxRetries: 2,
      async execute(input) {
        const parsed = ToolInputSchemas.web_search.parse(input);
        return { results: (await searchWeb(parsed.query, parsed.limit)).map((result) => toJsonObject(result)) };
      },
    },
    {
      name: "url_reader",
      description: "Reads and extracts text from a public HTTP(S) source.",
      inputSchema: ToolInputSchemas.url_reader as z.ZodType<JsonObject>,
      allowedAgentRoles: ["research"],
      defaultTimeoutMs: 15_000,
      maxRetries: 1,
      async execute(input) {
        const parsed = ToolInputSchemas.url_reader.parse(input);
        const html = await fetchText(parsed.url, webFetchTimeoutMs());
        const page = extractPageText(html, parsed.maxChars);
        return {
          title: page.title,
          url: parsed.url,
          content: page.content,
          reliability: reliabilityForUrl(parsed.url),
        };
      },
    },
    {
      name: "file_reader",
      description: "Reads uploaded object metadata when object storage is configured.",
      inputSchema: ToolInputSchemas.file_reader as z.ZodType<JsonObject>,
      allowedAgentRoles: ["research"],
      defaultTimeoutMs: 1_000,
      maxRetries: 1,
      async execute(input) {
        const parsed = ToolInputSchemas.file_reader.parse(input);
        throw new ToolExecutionError(`File reader is not configured for object "${parsed.objectKey}".`, { retryable: false });
      },
    },
    {
      name: "table_generator",
      description: "Formats structured rows as a Markdown table.",
      inputSchema: ToolInputSchemas.table_generator as z.ZodType<JsonObject>,
      allowedAgentRoles: ["analyst", "writer"],
      defaultTimeoutMs: 500,
      maxRetries: 0,
      async execute(input) {
        const parsed = ToolInputSchemas.table_generator.parse(input);
        const header = `| ${parsed.columns.join(" | ")} |`;
        const divider = `| ${parsed.columns.map(() => "---").join(" | ")} |`;
        const rows = parsed.rows.map((row) => `| ${row.join(" | ")} |`);
        return { title: parsed.title, markdown: [header, divider, ...rows].join("\n") };
      },
    },
    {
      name: "report_export",
      description: "Creates a deterministic S3-compatible object key for a report.",
      inputSchema: ToolInputSchemas.report_export as z.ZodType<JsonObject>,
      allowedAgentRoles: ["writer"],
      defaultTimeoutMs: 800,
      maxRetries: 1,
      async execute(input) {
        const parsed = ToolInputSchemas.report_export.parse(input);
        const objectKey = `reports/${parsed.workflowId}/${createDeterministicId("rpt", parsed.markdown)}.md`;
        return { objectKey, byteLength: parsed.markdown.length, sourceIds: parsed.sourceIds };
      },
    },
    {
      name: "knowledge_base_query",
      description: "Runs a second public web discovery pass when no private knowledge base is configured.",
      inputSchema: ToolInputSchemas.knowledge_base_query as z.ZodType<JsonObject>,
      allowedAgentRoles: ["research"],
      defaultTimeoutMs: 15_000,
      maxRetries: 1,
      async execute(input) {
        const parsed = ToolInputSchemas.knowledge_base_query.parse(input);
        return { results: (await searchWeb(parsed.query, parsed.limit)).map((result) => toJsonObject(result)) };
      },
    },
  ];

  return new Map(definitions.map((definition) => [definition.name, definition]));
}

export function sourceFromToolResult(args: {
  readonly workflowId: WorkflowId;
  readonly stepId: WorkflowStepId;
  readonly result: JsonObject;
  readonly now: Date;
}): Source {
  const url = typeof args.result["url"] === "string" && /^https?:\/\//i.test(args.result["url"]) ? args.result["url"] : undefined;
  const reference = typeof args.result["reference"] === "string" ? args.result["reference"] : undefined;
  const title = typeof args.result["title"] === "string" ? args.result["title"] : reference ?? "Untitled source";
  const excerpt = typeof args.result["content"] === "string" ? args.result["content"] : String(args.result["snippet"] ?? "");
  const reliability = args.result["reliability"] === "high" || args.result["reliability"] === "medium" ? args.result["reliability"] : "low";

  return {
    id: createDeterministicId("src", `${args.workflowId}:${args.stepId}:${title}:${excerpt}`),
    workflowId: args.workflowId,
    stepId: args.stepId,
    title,
    url,
    reference,
    excerpt,
    reliability,
    retrievedAt: args.now,
  };
}

export function normalizeToolOutput(value: unknown): JsonObject {
  return toJsonObject(value);
}
