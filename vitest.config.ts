import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts"],
    coverage: {
      reporter: ["text", "json", "html"],
      exclude: ["apps/web/.next/**", "node_modules/**"]
    }
  },
  resolve: {
    alias: {
      "@agentflow/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@agentflow/agents": new URL("./packages/agents/src/index.ts", import.meta.url).pathname,
      "@agentflow/db": new URL("./packages/db/src/index.ts", import.meta.url).pathname,
      "@agentflow/evals": new URL("./packages/evals/src/index.ts", import.meta.url).pathname
    }
  }
});
