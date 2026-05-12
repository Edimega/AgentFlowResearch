import { z } from "zod";
import { ToolExecutionError } from "@agentflow/core";

const OpenRouterMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

const OpenRouterResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.string().nullable(),
    }),
  })).min(1),
  usage: z.object({
    total_tokens: z.number().optional(),
  }).optional(),
});

export interface OpenRouterMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface OpenRouterCompletion {
  readonly content: string;
  readonly totalTokens: number;
}

export function isOpenRouterConfigured(): boolean {
  const apiKey = process.env["OPENROUTER_API_KEY"];
  return process.env["LLM_PROVIDER"] === "openrouter" && Boolean(apiKey) && apiKey !== "REEMPLAZA_CON_TU_API_KEY_DE_OPENROUTER";
}

function openRouterModel(): string {
  return process.env["OPENROUTER_MODEL"] || "openrouter/free";
}

function openRouterTimeoutMs(): number {
  const configured = Number(process.env["OPENROUTER_TIMEOUT_MS"] ?? process.env["LLM_REQUEST_TIMEOUT_MS"] ?? 15_000);
  return Number.isFinite(configured) && configured > 0 ? configured : 15_000;
}

export async function createOpenRouterChatCompletion(args: {
  readonly messages: readonly OpenRouterMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly responseFormat?: "json_object";
}): Promise<OpenRouterCompletion> {
  const apiKey = process.env["OPENROUTER_API_KEY"];
  if (!apiKey) {
    throw new ToolExecutionError("OPENROUTER_API_KEY is required when LLM_PROVIDER=openrouter.", { retryable: false });
  }

  const messages = z.array(OpenRouterMessageSchema).parse(args.messages);
  const controller = new AbortController();
  const timeoutMs = openRouterTimeoutMs();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new ToolExecutionError("OpenRouter request timed out.", { retryable: true }));
    }, timeoutMs);
  });
  let response: Response;
  try {
    response = await Promise.race([
      fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env["OPENROUTER_SITE_URL"] || process.env["APP_URL"] || "http://localhost:3000",
          "X-Title": process.env["OPENROUTER_APP_NAME"] || process.env["APP_NAME"] || "AgentFlow Research",
        },
        body: JSON.stringify({
          model: openRouterModel(),
          messages,
          temperature: args.temperature ?? 0.2,
          max_tokens: args.maxTokens ?? 1_200,
        }),
      }),
      timeoutPromise,
    ]);
  } catch (error) {
    if (error instanceof ToolExecutionError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ToolExecutionError("OpenRouter request timed out.", { retryable: true });
    }
    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }

  if (!response.ok) {
    const text = await response.text();
    throw new ToolExecutionError(`OpenRouter request failed with ${response.status}.`, {
      retryable: response.status >= 500 || response.status === 429,
      details: { body: text.slice(0, 1_000) },
    });
  }

  const payload = OpenRouterResponseSchema.parse(await response.json());
  const content = payload.choices[0]?.message.content?.trim();
  if (!content) {
    throw new ToolExecutionError("OpenRouter returned an empty message.", { retryable: true });
  }

  return {
    content,
    totalTokens: payload.usage?.total_tokens ?? 0,
  };
}

export function parseJsonFromModel<T>(content: string, schema: z.ZodType<T>): T {
  const direct = tryParseJson(content);
  if (direct.success) {
    return schema.parse(direct.value);
  }

  const match = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (match?.[1]) {
    const fenced = tryParseJson(match[1]);
    if (fenced.success) {
      return schema.parse(fenced.value);
    }
  }

  throw new ToolExecutionError("Model response did not contain valid JSON.", {
    retryable: false,
    details: { content: content.slice(0, 1_000) },
  });
}

function tryParseJson(content: string): { readonly success: true; readonly value: unknown } | { readonly success: false } {
  try {
    return { success: true, value: JSON.parse(content) };
  } catch {
    return { success: false };
  }
}
