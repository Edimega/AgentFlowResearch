import { describe, expect, it } from "vitest";
import { runDeterministicWorkflow } from "../../packages/agents/src";

describe("agent workflow output", () => {
  it("exports real HTTP sources without fixture corpus references", async () => {
    const previousProvider = process.env["LLM_PROVIDER"];
    const originalFetch = globalThis.fetch;
    process.env["LLM_PROVIDER"] = "deterministic";
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("duckduckgo.com")) {
        return new Response([
          '<a class="result__a" href="/l/?uddg=https%3A%2F%2Fwww.oecd.org%2Flegal-ai">OECD legal AI automation report</a>',
          '<a class="result__snippet">Legal teams are adopting AI automation for intake and contract review.</a>',
          '<a class="result__a" href="/l/?uddg=https%3A%2F%2Fwww.reuters.com%2Flegal%2Fai-adoption">Reuters legal AI adoption analysis</a>',
          '<a class="result__snippet">Law departments evaluate AI platforms for auditability and data controls.</a>',
        ].join("\n"), { status: 200, headers: { "Content-Type": "text/html" } });
      }
      if (url.includes("oecd.org")) {
        return new Response("<html><title>OECD legal AI automation report</title><body>Legal teams are adopting AI automation for intake, contract review, routing, and compliance monitoring.</body></html>", { status: 200 });
      }
      if (url.includes("reuters.com")) {
        return new Response("<html><title>Reuters legal AI adoption analysis</title><body>Law departments evaluate AI platforms for auditability, data controls, time to value, and integration depth.</body></html>", { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    };

    try {
      const result = await runDeterministicWorkflow({
        workspaceId: "wsp_test",
        userId: "usr_test",
        title: "Legal AI automation trends",
        goal: "Investiga tendencias actuales en plataformas de automatizacion con IA para equipos legales y resume riesgos, oportunidades y senales de adopcion.",
        format: "executive_report",
      });

      expect(result.report?.markdown).toBeTruthy();
      expect(result.report?.markdown).not.toMatch(/https:\/\/example\.com/i);
      expect(result.report?.markdown).not.toMatch(/fixture corpus:/i);
      expect(result.sources.every((source) => /^https?:\/\//i.test(source.url ?? ""))).toBe(true);
      expect(new Set(result.sources.map((source) => source.id)).size).toBe(result.sources.length);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousProvider === undefined) {
        delete process.env["LLM_PROVIDER"];
      } else {
        process.env["LLM_PROVIDER"] = previousProvider;
      }
    }
  });

  it("completes with source warnings when one real source cannot be read", async () => {
    const previousProvider = process.env["LLM_PROVIDER"];
    const originalFetch = globalThis.fetch;
    process.env["LLM_PROVIDER"] = "deterministic";
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("duckduckgo.com")) {
        return new Response([
          '<a class="result__a" href="/l/?uddg=https%3A%2F%2Fwww.oecd.org%2Flegal-ai">OECD legal AI automation report</a>',
          '<a class="result__snippet">Legal teams are adopting AI automation for intake and contract review.</a>',
          '<a class="result__a" href="/l/?uddg=https%3A%2F%2Fwww.reuters.com%2Fblocked-legal-ai-source">Blocked legal AI source</a>',
          '<a class="result__snippet">A blocked source still exposes search metadata from a public result.</a>',
        ].join("\n"), { status: 200, headers: { "Content-Type": "text/html" } });
      }
      if (url.includes("oecd.org")) {
        return new Response("<html><title>OECD legal AI automation report</title><body>Legal teams are adopting AI automation for intake, contract review, routing, and compliance monitoring.</body></html>", { status: 200 });
      }
      if (url.includes("reuters.com/blocked-legal-ai-source")) {
        return new Response("Unavailable", { status: 503 });
      }
      return new Response("Not found", { status: 404 });
    };

    try {
      const result = await runDeterministicWorkflow({
        workspaceId: "wsp_test",
        userId: "usr_test",
        title: "Legal AI automation trends",
        goal: "Investiga tendencias actuales en plataformas de automatizacion con IA para equipos legales y resume riesgos, oportunidades y senales de adopcion.",
        format: "executive_report",
      });

      expect(result.workflow.status).toBe("completed");
      expect(result.report?.markdown).toBeTruthy();
      expect(result.sources.some((source) => source.url?.includes("reuters.com/blocked-legal-ai-source"))).toBe(true);
      expect(result.toolCalls.some((call) => call.status === "failed")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousProvider === undefined) {
        delete process.env["LLM_PROVIDER"];
      } else {
        process.env["LLM_PROVIDER"] = previousProvider;
      }
    }
  });
});
