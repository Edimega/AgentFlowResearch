import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

function loadRootEnv(): void {
  const envPath = join(process.cwd(), "..", "..", ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = valueParts.join("=").replace(/^"|"$/g, "");
  }
}

loadRootEnv();

const nextConfig: NextConfig = {
  typedRoutes: true,
  transpilePackages: ["@agentflow/agents", "@agentflow/core", "@agentflow/db", "@agentflow/worker"],
};

export default nextConfig;
