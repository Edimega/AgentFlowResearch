import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

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

async function migrate(): Promise<void> {
  loadDotEnv();
  const databaseUrl = process.env["DATABASE_URL"] ?? "postgresql://agentflow:agentflow_dev_password@localhost:5432/agentflow";
  const migrationPath = join(dirname(fileURLToPath(import.meta.url)), "migrations", "0001_init.sql");
  const sql = readFileSync(migrationPath, "utf8");
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query(sql);
    console.warn("Database schema ready.");
  } finally {
    await pool.end();
  }
}

migrate().catch((error: unknown) => {
  console.error("Database migration failed.", error);
  process.exitCode = 1;
});
