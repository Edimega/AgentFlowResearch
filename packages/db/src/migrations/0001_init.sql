CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE workflow_status AS ENUM (
    'draft',
    'planned',
    'running',
    'waiting_for_tool',
    'step_failed',
    'needs_review',
    'completed',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE workflow_step_status AS ENUM (
    'pending',
    'planned',
    'running',
    'waiting_for_tool',
    'completed',
    'failed',
    'needs_review',
    'skipped',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE agent_role AS ENUM ('planner', 'research', 'analyst', 'writer', 'critic');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE tool_name AS ENUM ('web_search', 'url_reader', 'file_reader', 'table_generator', 'report_export', 'knowledge_base_query');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE tool_call_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'timed_out');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE source_reliability AS ENUM ('high', 'medium', 'low', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id varchar(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email varchar(320) NOT NULL,
  name varchar(160) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email);

CREATE TABLE IF NOT EXISTS workspaces (
  id varchar(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_user_id varchar(64) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name varchar(160) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflows (
  id varchar(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id varchar(64) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id varchar(64) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title varchar(140) NOT NULL,
  goal text NOT NULL,
  status workflow_status NOT NULL DEFAULT 'draft',
  total_cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  total_latency_ms integer NOT NULL DEFAULT 0,
  retry_count integer NOT NULL DEFAULT 0,
  tool_call_count integer NOT NULL DEFAULT 0,
  quality_score numeric(5, 4),
  trace_id varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_steps (
  id varchar(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workflow_id varchar(64) NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  agent_role agent_role NOT NULL,
  status workflow_step_status NOT NULL DEFAULT 'pending',
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  attempt integer NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS workflow_steps_workflow_sequence_idx ON workflow_steps (workflow_id, sequence);

CREATE TABLE IF NOT EXISTS agent_runs (
  id varchar(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workflow_id varchar(64) NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  step_id varchar(64) NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
  agent_role agent_role NOT NULL,
  status workflow_step_status NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  error text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  latency_ms integer
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id varchar(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workflow_id varchar(64) NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  step_id varchar(64) NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
  agent_role agent_role NOT NULL,
  tool_name tool_name NOT NULL,
  status tool_call_status NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  error text,
  attempt integer NOT NULL,
  max_attempts integer NOT NULL,
  latency_ms integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL,
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS sources (
  id varchar(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workflow_id varchar(64) NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  step_id varchar(64) REFERENCES workflow_steps(id) ON DELETE SET NULL,
  title varchar(300) NOT NULL,
  url text,
  reference text,
  excerpt text NOT NULL,
  reliability source_reliability NOT NULL,
  retrieved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
  id varchar(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workflow_id varchar(64) NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  title varchar(160) NOT NULL,
  markdown text NOT NULL,
  source_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  object_key text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS reports_workflow_version_idx ON reports (workflow_id, version);

CREATE TABLE IF NOT EXISTS workflow_events (
  id varchar(96) PRIMARY KEY,
  workflow_id varchar(64) NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  step_id varchar(64) REFERENCES workflow_steps(id) ON DELETE SET NULL,
  type varchar(80) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluation_results (
  id varchar(64) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workflow_id varchar(64) NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  objective_score numeric(5, 4) NOT NULL,
  source_quality_score numeric(5, 4) NOT NULL,
  unsupported_claim_rate numeric(5, 4) NOT NULL,
  contradiction_detected boolean NOT NULL DEFAULT false,
  tool_use_score numeric(5, 4) NOT NULL,
  cost_usd numeric(12, 6) NOT NULL,
  latency_ms integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
