import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type AgentFlowDatabase = NodePgDatabase<typeof schema>;

export interface DatabaseClient {
  readonly db: AgentFlowDatabase;
  readonly pool: pg.Pool;
}

export function createDatabaseClient(connectionString: string): DatabaseClient {
  const pool = new pg.Pool({ connectionString });
  return {
    db: drizzle(pool, { schema }),
    pool,
  };
}

