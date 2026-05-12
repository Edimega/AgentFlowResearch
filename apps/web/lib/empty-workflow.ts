import type { Workflow } from "./types";

export const emptyWorkflow: Workflow = {
  id: "empty-workflow",
  name: "No workflow has run yet",
  owner: "Strategy workspace",
  status: "draft",
  createdAt: new Date(0).toISOString(),
  objective: "Create a research workflow to see agent steps, tool calls, sources, metrics, and the final report.",
  completion: 0,
  metrics: [
    { label: "Workflow state", value: "Idle", trend: "waiting for Start run", tone: "neutral" },
    { label: "Agent steps", value: "0", trend: "no execution yet", tone: "neutral" },
    { label: "Tool calls", value: "0", trend: "no tools called", tone: "neutral" },
    { label: "Report", value: "None", trend: "no output generated", tone: "neutral" },
  ],
  steps: [],
  agentRuns: [],
  toolCalls: [],
  timeline: [],
  reportMarkdown: "",
  versions: [],
};
