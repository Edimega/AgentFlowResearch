"use client";

import { FormEvent, useEffect, useRef, useState, type ReactNode } from "react";
import { emptyWorkflow } from "../lib/empty-workflow";
import type { ResearchPlan } from "@agentflow/core";
import type {
  AgentRun,
  AgentRole,
  StepStatus,
  ToolStatus,
  VersionComparison,
  WorkflowMetric,
  WorkflowStep,
  Workflow,
} from "../lib/types";
import type { WorkflowResponse } from "../lib/workflow-view";

interface PreviewPlanResponse {
  readonly plan?: ResearchPlan;
  readonly error?: string;
}

const statusLabels: Record<StepStatus, string> = {
  pending: "Pending",
  planned: "Planned",
  running: "Running",
  waiting_for_tool: "Waiting for tool",
  completed: "Completed",
  failed: "Failed",
  needs_review: "Needs review",
  skipped: "Skipped",
  cancelled: "Cancelled",
};

const toolStatusLabels: Record<ToolStatus, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  timed_out: "Timed out",
};

const impactLabels: Record<VersionComparison["impact"], string> = {
  improved: "Improved",
  changed: "Changed",
  regressed: "Regressed",
};

const agentLabels: Record<AgentRole, string> = {
  planner: "Planner Agent",
  research: "Research Agent",
  analyst: "Analyst Agent",
  writer: "Writer Agent",
  critic: "Critic Agent",
};

const progressStages = [
  "Generating short title",
  "Planning agent handoffs",
  "Searching real web sources",
  "Reading source pages",
  "Building the evidence matrix",
  "Drafting the Markdown report",
  "Running critic review",
  "Saving audit trail",
];

function StatusPill({
  status,
  type = "step",
}: {
  status: StepStatus | ToolStatus | VersionComparison["impact"];
  type?: "step" | "tool" | "impact";
}) {
  const label =
    type === "tool"
      ? toolStatusLabels[status as ToolStatus]
      : type === "impact"
        ? impactLabels[status as VersionComparison["impact"]]
        : statusLabels[status as StepStatus];

  return <span className={`pill pill-${status}`}>{label}</span>;
}

function MetricCard({ metric }: { metric: WorkflowMetric }) {
  return (
    <article className={`metric-card metric-${metric.tone}`}>
      <span>{metric.label}</span>
      <strong>{metric.value}</strong>
      <small>{metric.trend}</small>
    </article>
  );
}

function WorkflowCanvas({ completion, steps }: { completion: number; steps: WorkflowStep[] }) {
  if (steps.length === 0) {
    return (
      <section className="panel empty-panel" aria-labelledby="workflow-map-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Workflow map</p>
            <h2 id="workflow-map-title">Agent handoffs</h2>
          </div>
          <span className="panel-action">0% complete</span>
        </div>
        <p>No agent handoffs have run. Use Preview plan to inspect the intended steps, then Start run to execute them.</p>
      </section>
    );
  }

  return (
    <section className="panel workflow-panel" aria-labelledby="workflow-map-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Workflow map</p>
          <h2 id="workflow-map-title">Agent handoffs</h2>
        </div>
        <span className="panel-action">{completion}% complete</span>
      </div>

      <div className="flow-canvas" role="list" aria-label="Workflow steps">
        {steps.map((step, index) => (
          <div className="flow-item" role="listitem" key={step.id}>
            <article className={`flow-node node-${step.status}`}>
              <div>
                <span className="node-index">{String(index + 1).padStart(2, "0")}</span>
                <h3>{step.title}</h3>
              </div>
              <p>{agentLabels[step.agent]}</p>
              <StatusPill status={step.status} />
            </article>
            {index < steps.length - 1 ? <span className="flow-edge" aria-hidden="true" /> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

async function parseWorkflowResponse(response: Response): Promise<Workflow> {
  const text = await response.text();
  let payload: Partial<WorkflowResponse> & { error?: string } = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Partial<WorkflowResponse> & { error?: string };
    } catch {
      throw new Error(`Workflow request returned an unreadable response with status ${response.status}.`);
    }
  }
  if (!response.ok || !payload.workflow) {
    throw new Error(payload.error ?? `Workflow request failed with status ${response.status}.`);
  }
  return payload.workflow;
}

function CreateWorkflowPanel({
  isRunning,
  onRunStarted,
  onRunSettled,
  onWorkflowCreated,
  onPlanPreviewed,
  onDraftSaved,
}: {
  isRunning: boolean;
  onRunStarted: () => void;
  onRunSettled: () => void;
  onWorkflowCreated: (workflow: Workflow) => void;
  onPlanPreviewed: (plan: ResearchPlan) => void;
  onDraftSaved: (goal: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const form = new FormData(event.currentTarget);
    const goal = String(form.get("goal") ?? "").trim();
    const format = String(form.get("format") ?? "executive_report");
    if (!goal) {
      setError("Enter a research objective before starting a run.");
      setIsSubmitting(false);
      return;
    }

    onRunStarted();
    try {
      const response = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal,
          format,
        }),
      });
      onWorkflowCreated(await parseWorkflowResponse(response));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to create workflow.");
    } finally {
      setIsSubmitting(false);
      onRunSettled();
    }
  }

  async function handlePreviewPlan() {
    if (!formRef.current) return;
    setError(null);
    setIsPreviewing(true);
    const form = new FormData(formRef.current);
    const goal = String(form.get("goal") ?? "").trim();
    if (!goal) {
      setError("Enter a research objective before previewing a plan.");
      setIsPreviewing(false);
      return;
    }

    try {
      const response = await fetch("/api/workflows/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal }),
      });
      const payload = (await response.json()) as PreviewPlanResponse;
      if (!response.ok || !payload.plan) {
        throw new Error(payload.error ?? "Unable to preview plan.");
      }
      onPlanPreviewed(payload.plan);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to preview plan.");
    } finally {
      setIsPreviewing(false);
    }
  }

  function handleSaveDraft() {
    if (!formRef.current) return;
    const form = new FormData(formRef.current);
    const goal = String(form.get("goal") ?? "").trim();
    if (!goal) {
      setError("Enter a research objective before saving a draft.");
      return;
    }
    localStorage.setItem("agentflow.researchDraft", JSON.stringify({ goal }));
    onDraftSaved(goal);
  }

  return (
    <section className="panel create-panel" aria-labelledby="create-workflow-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Create workflow</p>
          <h2 id="create-workflow-title">New research run</h2>
        </div>
        <button className="icon-button" type="button" aria-label="Save draft" onClick={handleSaveDraft}>
          <span aria-hidden="true">S</span>
        </button>
      </div>

      <form className="workflow-form" onSubmit={handleSubmit} ref={formRef}>
        <label>
          Research objective
          <textarea
            name="goal"
            placeholder="Example: Compare three AI support software competitors for SMBs and identify differentiation opportunities."
            required
            rows={5}
          />
        </label>

        <div className="form-grid">
          <label>
            Output format
            <select name="format" defaultValue="comparison">
              <option value="executive_report">Executive report</option>
              <option value="risk_report">Risk report</option>
              <option value="comparison">Comparison table</option>
            </select>
          </label>

          <label>
            Quality gate
            <select defaultValue="strict">
              <option value="strict">Strict evidence</option>
              <option value="balanced">Balanced</option>
              <option value="fast">Fast draft</option>
            </select>
          </label>
        </div>

        <fieldset>
          <legend>Authorized tools</legend>
          <label className="check-row">
            <input type="checkbox" defaultChecked />
            Web search
          </label>
          <label className="check-row">
            <input type="checkbox" defaultChecked />
            URL reader
          </label>
          <label className="check-row">
            <input type="checkbox" />
            Knowledge base
          </label>
        </fieldset>

        <div className="form-actions">
          <button className="secondary-button" type="button" onClick={handlePreviewPlan} disabled={isRunning || isPreviewing}>
            {isPreviewing ? "Previewing" : "Preview plan"}
          </button>
          <button className="primary-button" type="submit" disabled={isRunning || isSubmitting}>
            {isRunning || isSubmitting ? "Running" : "Start run"}
          </button>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
    </section>
  );
}

function PlanPreview({ plan }: { plan: ResearchPlan | null }) {
  if (!plan) return null;

  return (
    <section className="panel" aria-labelledby="preview-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Preview</p>
          <h2 id="preview-title">Deterministic plan</h2>
        </div>
        <span className="panel-action">{plan.steps.length} steps</span>
      </div>

      <div className="step-list">
        {plan.steps.map((step, index) => (
          <article className="step-row" key={step.id}>
            <div>
              <h3>{String(index + 1).padStart(2, "0")} {step.kind.replaceAll("_", " ")}</h3>
              <p>{step.tool ? `Tool: ${step.tool}` : "No external tool required."}</p>
            </div>
            <div className="step-meta">
              <span>{step.dependsOn?.length ? `${step.dependsOn.length} dependency` : "Ready"}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function PlanView({ steps }: { steps: WorkflowStep[] }) {
  if (steps.length === 0) {
    return (
      <section className="panel empty-panel" aria-labelledby="plan-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Plan</p>
            <h2 id="plan-title">Execution steps</h2>
          </div>
        </div>
        <p>No execution plan has been run yet.</p>
      </section>
    );
  }

  return (
    <section className="panel" aria-labelledby="plan-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Plan</p>
          <h2 id="plan-title">Execution steps</h2>
        </div>
      </div>

      <div className="step-list">
        {steps.map((step) => (
          <article className="step-row" key={step.id}>
            <div>
              <h3>{step.title}</h3>
              <p>{step.input}</p>
            </div>
            <div className="step-meta">
              <span>{agentLabels[step.agent]}</span>
              <StatusPill status={step.status} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function TimelineView({ workflow }: { workflow: Workflow }) {
  if (workflow.timeline.length === 0) {
    return (
      <section className="panel empty-panel" aria-labelledby="timeline-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Timeline</p>
            <h2 id="timeline-title">Execution events</h2>
          </div>
        </div>
        <p>No workflow events recorded.</p>
      </section>
    );
  }

  return (
    <section className="panel" aria-labelledby="timeline-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Timeline</p>
          <h2 id="timeline-title">Execution events</h2>
        </div>
      </div>

      <ol className="timeline">
        {workflow.timeline.map((event) => (
          <li className={`timeline-item timeline-${event.status}`} key={event.id}>
            <time>{event.time}</time>
            <div>
              <h3>{event.title}</h3>
              <p>{event.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function AgentDetail({ agents }: { agents: AgentRun[] }) {
  if (agents.length === 0) {
    return (
      <section className="panel empty-panel" aria-labelledby="agents-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Agents</p>
            <h2 id="agents-title">Run detail</h2>
          </div>
        </div>
        <p>No agents have executed.</p>
      </section>
    );
  }

  return (
    <section className="panel" aria-labelledby="agents-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Agents</p>
          <h2 id="agents-title">Run detail</h2>
        </div>
      </div>

      <div className="agent-grid">
        {agents.map((agent) => (
          <article className="agent-card" key={agent.id}>
            <div className="agent-card-header">
              <h3>{agentLabels[agent.agent]}</h3>
              <StatusPill status={agent.status} />
            </div>
            <p>{agent.objective}</p>
            <dl>
              <div>
                <dt>Quality</dt>
                <dd>{agent.qualityScore ? `${agent.qualityScore}/100` : "Pending"}</dd>
              </div>
              <div>
                <dt>Tokens</dt>
                <dd>{agent.tokens.toLocaleString("en-US")}</dd>
              </div>
            </dl>
            <small>{agent.handoff}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function ToolLog({ workflow }: { workflow: Workflow }) {
  if (workflow.toolCalls.length === 0) {
    return (
      <section className="panel empty-panel" aria-labelledby="tool-log-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Tool log</p>
            <h2 id="tool-log-title">Authorized calls</h2>
          </div>
        </div>
        <p>No tools have been called. This table populates only after execution starts.</p>
      </section>
    );
  }

  return (
    <section className="panel table-panel" aria-labelledby="tool-log-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Tool log</p>
          <h2 id="tool-log-title">Authorized calls</h2>
        </div>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Agent</th>
              <th scope="col">Tool</th>
              <th scope="col">Schema</th>
              <th scope="col">Latency</th>
              <th scope="col">Retries</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {workflow.toolCalls.map((call) => (
              <tr key={call.id}>
                <td>{call.time}</td>
                <td>{agentLabels[call.agent]}</td>
                <td>
                  <code>{call.tool}</code>
                </td>
                <td className="schema-cell">{call.inputSchema}</td>
                <td>{call.latencyMs.toLocaleString("en-US")} ms</td>
                <td>{call.retries}</td>
                <td>
                  <StatusPill status={call.status} type="tool" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)]+)\))/g;
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(text.slice(cursor, index));
    if (match[2]) nodes.push(<strong key={`${keyPrefix}-strong-${index}`}>{match[2]}</strong>);
    if (match[3]) nodes.push(<code key={`${keyPrefix}-code-${index}`}>{match[3]}</code>);
    if (match[4] && match[5]) {
      nodes.push(<a href={match[5]} key={`${keyPrefix}-link-${index}`} target="_blank" rel="noreferrer">{match[4]}</a>);
    }
    cursor = index + match[0].length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function tableCells(line: string): string[] {
  return line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function isTableDivider(line: string): boolean {
  return tableCells(line).every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isMarkdownTable(lines: string[], index: number): boolean {
  return Boolean(lines[index]?.includes("|") && lines[index + 1]?.includes("|") && isTableDivider(lines[index + 1] ?? ""));
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  return !line.trim() || line.startsWith("#") || line.startsWith("- ") || /^\d+\.\s/.test(line) || line === "---" || isMarkdownTable(lines, index);
}

function renderMarkdownBlocks(markdown: string): ReactNode[] {
  const lines = markdown.trim().split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (isMarkdownTable(lines, index)) {
      const header = tableCells(lines[index] ?? "");
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? "").includes("|")) {
        rows.push(tableCells(lines[index] ?? ""));
        index += 1;
      }
      blocks.push(
        <div className="markdown-table-scroll" key={`table-${index}`}>
          <table className="markdown-table">
            <thead>
              <tr>{header.map((cell) => <th key={cell}>{renderInlineMarkdown(cell, `th-${cell}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`}>{renderInlineMarkdown(cell, `td-${rowIndex}-${cellIndex}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (line.startsWith("# ")) {
      blocks.push(<h1 key={`h1-${index}`}>{renderInlineMarkdown(line.replace("# ", ""), `h1-${index}`)}</h1>);
      index += 1;
      continue;
    }

    if (line.startsWith("## ")) {
      blocks.push(<h2 key={`h2-${index}`}>{renderInlineMarkdown(line.replace("## ", ""), `h2-${index}`)}</h2>);
      index += 1;
      continue;
    }

    if (line.startsWith("### ")) {
      blocks.push(<h3 key={`h3-${index}`}>{renderInlineMarkdown(line.replace("### ", ""), `h3-${index}`)}</h3>);
      index += 1;
      continue;
    }

    if (line === "---") {
      blocks.push(<hr key={`hr-${index}`} />);
      index += 1;
      continue;
    }

    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (index < lines.length && (lines[index] ?? "").startsWith("- ")) {
        items.push((lines[index] ?? "").replace("- ", ""));
        index += 1;
      }
      blocks.push(<ul key={`ul-${index}`}>{items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{renderInlineMarkdown(item, `ul-${index}-${itemIndex}`)}</li>)}</ul>);
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\d+\.\s/, ""));
        index += 1;
      }
      blocks.push(<ol key={`ol-${index}`}>{items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{renderInlineMarkdown(item, `ol-${index}-${itemIndex}`)}</li>)}</ol>);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && !isBlockStart(lines, index)) {
      paragraph.push(lines[index] ?? "");
      index += 1;
    }
    blocks.push(<p key={`p-${index}`}>{renderInlineMarkdown(paragraph.join(" "), `p-${index}`)}</p>);
  }

  return blocks;
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  document.body.append(textArea);
  textArea.select();
  document.execCommand("copy");
  textArea.remove();
}

function MarkdownReport({ markdown, onExport }: { markdown: string; onExport: () => void }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  if (!markdown.trim()) {
    return (
      <section className="panel report-panel empty-panel" aria-labelledby="report-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Markdown report</p>
            <h2 id="report-title">Current draft</h2>
          </div>
          <div className="report-actions">
            <button className="secondary-button compact-button" type="button" disabled>Copy MD</button>
            <button className="secondary-button compact-button" type="button" disabled>Download</button>
          </div>
        </div>
        <p>No report generated. Run a workflow to create the Markdown output.</p>
      </section>
    );
  }

  return (
    <section className="panel report-panel" aria-labelledby="report-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Markdown report</p>
          <h2 id="report-title">Current draft</h2>
        </div>
        <div className="report-actions">
          <button
            className="secondary-button compact-button"
            type="button"
            onClick={() => {
              void copyToClipboard(markdown).then(() => {
                setCopyStatus("copied");
                window.setTimeout(() => setCopyStatus("idle"), 1_600);
              });
            }}
          >
            {copyStatus === "copied" ? "Copied" : "Copy MD"}
          </button>
          <button className="secondary-button compact-button" type="button" onClick={onExport} disabled={!markdown.trim()}>
            Download
          </button>
        </div>
      </div>

      <article className="markdown-preview">
        {renderMarkdownBlocks(markdown)}
      </article>
    </section>
  );
}

function VersionComparisonView({ workflow }: { workflow: Workflow }) {
  if (workflow.versions.length === 0) {
    return (
      <section className="panel empty-panel" aria-labelledby="versions-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Versions</p>
            <h2 id="versions-title">Report comparison</h2>
          </div>
        </div>
        <p>No report versions to compare.</p>
      </section>
    );
  }

  return (
    <section className="panel" aria-labelledby="versions-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Versions</p>
          <h2 id="versions-title">Report comparison</h2>
        </div>
      </div>

      <div className="version-list">
        {workflow.versions.map((version) => (
          <article className="version-row" key={version.field}>
            <div className="version-field">
              <h3>{version.field}</h3>
              <StatusPill status={version.impact} type="impact" />
            </div>
            <div className="version-copy">
              <div>
                <span>Previous</span>
                <p>{version.previous}</p>
              </div>
              <div>
                <span>Current</span>
                <p>{version.current}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SourcesAndMetrics({ steps }: { steps: WorkflowStep[] }) {
  const sources = [...new Map(steps.flatMap((step) => step.sources).map((source) => [source.id, source])).values()];
  const totalCost = steps.reduce((sum, step) => sum + step.costUsd, 0);
  const totalLatency = steps.reduce((sum, step) => sum + step.latencyMs, 0);

  return (
    <section className="panel" aria-labelledby="metrics-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Metrics</p>
          <h2 id="metrics-title">Run economics</h2>
        </div>
      </div>

      <div className="mini-chart" aria-label="Cost by step">
        {steps.map((step) => (
          <div className="bar-row" key={step.id}>
            <span>{agentLabels[step.agent].replace(" Agent", "")}</span>
            <div>
              <i style={{ width: `${Math.max(step.costUsd * 12, 4)}%` }} />
            </div>
            <strong>${step.costUsd.toFixed(2)}</strong>
          </div>
        ))}
      </div>

      <dl className="summary-list">
        <div>
          <dt>Total cost</dt>
          <dd>${totalCost.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Total latency</dt>
          <dd>{Math.round(totalLatency / 1000)}s</dd>
        </div>
        <div>
          <dt>Accepted sources</dt>
          <dd>{sources.length}</dd>
        </div>
      </dl>

      <div className="source-list">
        {sources.map((source) => {
          const detail = `${source.reference ?? source.url ?? "Internal source"} - ${source.reliability} reliability`;
          return source.url ? (
            <a href={source.url} key={source.id} target="_blank" rel="noreferrer">
              <span>{source.title}</span>
              <small>{detail}</small>
            </a>
          ) : (
            <article className="source-item" key={source.id}>
              <span>{source.title}</span>
              <small>{detail}</small>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RunEvidence({ workflow }: { workflow: Workflow }) {
  const hasRun = workflow.steps.length > 0 || workflow.toolCalls.length > 0 || workflow.reportMarkdown.trim().length > 0;
  const modelMode = process.env["NEXT_PUBLIC_LLM_PROVIDER"] === "openrouter"
    ? "OpenRouter + live web tools"
    : "Live web tools";

  return (
    <section className="panel evidence-panel" aria-labelledby="evidence-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Run evidence</p>
          <h2 id="evidence-title">Execution proof</h2>
        </div>
        <span className={`panel-action ${hasRun ? "panel-action-good" : ""}`}>{hasRun ? "Generated" : "Not run"}</span>
      </div>

      <dl className="summary-list">
        <div>
          <dt>Mode</dt>
          <dd>{modelMode}</dd>
        </div>
        <div>
          <dt>Workflow ID</dt>
          <dd>{hasRun ? workflow.id : "None"}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>{workflow.toolCalls.length} tool calls</dd>
        </div>
      </dl>

      <p>
        Results are shown only after a run. Previewing a plan does not call tools and does not produce metrics, sources, or a report.
      </p>
    </section>
  );
}

function ProgressOverlay({ active }: { active: boolean }) {
  const [stageIndex, setStageIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      setStageIndex(0);
      setElapsedSeconds(0);
      return undefined;
    }

    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setElapsedSeconds(elapsed);
      setStageIndex(Math.min(progressStages.length - 1, Math.floor(elapsed / 4)));
    }, 1_000);

    return () => window.clearInterval(interval);
  }, [active]);

  if (!active) return null;

  const progress = Math.min(94, 12 + stageIndex * 11 + Math.min(18, elapsedSeconds));

  return (
    <div className="progress-overlay" role="status" aria-live="polite" aria-label="Workflow execution progress">
      <section className="progress-dialog">
        <div className="progress-orbit" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="eyebrow">Running workflow</p>
        <h2>{progressStages[stageIndex]}</h2>
        <p>Agents are planning, searching, reading sources, drafting and reviewing the report. This can take a minute when live web pages or OpenRouter are slow.</p>
        <div className="progress-track" aria-hidden="true">
          <i style={{ width: `${progress}%` }} />
        </div>
        <dl>
          <div>
            <dt>Elapsed</dt>
            <dd>{elapsedSeconds}s</dd>
          </div>
          <div>
            <dt>Stage</dt>
            <dd>{stageIndex + 1}/{progressStages.length}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

export default function Home() {
  const [workflow, setWorkflow] = useState<Workflow>(emptyWorkflow);
  const [isRunning, setIsRunning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewPlan, setPreviewPlan] = useState<ResearchPlan | null>(null);
  const hasRun = workflow.steps.length > 0 || workflow.toolCalls.length > 0 || workflow.reportMarkdown.trim().length > 0;
  const hasReport = workflow.reportMarkdown.trim().length > 0;

  async function handleWorkflowCreated(nextWorkflow: Workflow) {
    setWorkflow(nextWorkflow);
  }

  async function handleRetry() {
    if (!hasRun) {
      setActionError("Run a workflow before retrying.");
      return;
    }
    setIsRunning(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/workflows/${workflow.id}/retry`, { method: "POST" });
      setWorkflow(await parseWorkflowResponse(response));
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Unable to retry workflow.");
    } finally {
      setIsRunning(false);
    }
  }

  function handleReviewHandoff() {
    if (!hasRun) {
      setActionError("Run a workflow before reviewing handoff.");
      return;
    }
    setNotice("Handoff review opened at the current report and version comparison.");
    document.getElementById("report")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleViewResult() {
    if (!hasReport) {
      setActionError("Run a workflow before viewing the result.");
      return;
    }
    setActionError(null);
    document.getElementById("report")?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.replaceState(null, "", "#report");
  }

  function handleExportReport() {
    if (!workflow.reportMarkdown.trim()) {
      setActionError("Run a workflow before exporting a report.");
      return;
    }
    const blob = new Blob([workflow.reportMarkdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${workflow.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agentflow-report"}.md`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNotice("Markdown report exported.");
  }

  return (
    <main className="app-shell">
      <ProgressOverlay active={isRunning} />
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand-mark">
          <span aria-hidden="true">AF</span>
          <div>
            <strong>AgentFlow</strong>
            <small>Research</small>
          </div>
        </div>

        <nav>
          <a href="#dashboard" aria-current="page">Dashboard</a>
          <a href="#create">Create</a>
          <a href="#plan">Plan</a>
          <a href="#timeline">Timeline</a>
          <a href="#agents">Agents</a>
          <a href="#tools">Tools</a>
          <a href="#report">Report</a>
        </nav>
      </aside>

      <div className="workspace">
        <header className="topbar" id="dashboard">
          <div>
            <p className="eyebrow">Operational dashboard</p>
            <h1>{workflow.name}</h1>
            <p>{workflow.objective}</p>
            {notice ? <p className="form-success" role="status">{notice}</p> : null}
            {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
          </div>
          <div className="topbar-actions">
            <button className="primary-button" type="button" onClick={handleViewResult} disabled={!hasReport || isRunning}>View result</button>
            <button className="secondary-button" type="button" onClick={handleRetry} disabled={!hasRun || isRunning}>Retry run</button>
            <button className="secondary-button" type="button" onClick={handleReviewHandoff} disabled={!hasRun}>Review handoff</button>
          </div>
        </header>

        <section className="metric-grid" aria-label="Workflow metrics">
          {workflow.metrics.map((metric) => (
            <MetricCard metric={metric} key={metric.label} />
          ))}
        </section>

        <div className="content-grid">
          <div className="main-column">
            <div id="create">
              <CreateWorkflowPanel
                isRunning={isRunning}
                onRunStarted={() => {
                  setIsRunning(true);
                  setActionError(null);
                  setNotice("Workflow run started.");
                }}
                onRunSettled={() => {
                  setIsRunning(false);
                }}
                onWorkflowCreated={(nextWorkflow) => {
                  setNotice("Workflow run completed.");
                  void handleWorkflowCreated(nextWorkflow);
                }}
                onPlanPreviewed={(plan) => {
                  setPreviewPlan(plan);
                  setNotice("Plan preview generated.");
                }}
                onDraftSaved={() => {
                  setNotice("Draft saved locally.");
                }}
              />
            </div>
            <PlanPreview plan={previewPlan} />
            <RunEvidence workflow={workflow} />
            <WorkflowCanvas completion={workflow.completion} steps={workflow.steps} />
            <div id="plan">
              <PlanView steps={workflow.steps} />
            </div>
            <div id="agents">
              <AgentDetail agents={workflow.agentRuns} />
            </div>
            <div id="tools">
              <ToolLog workflow={workflow} />
            </div>
            <div id="report">
              <MarkdownReport markdown={workflow.reportMarkdown} onExport={handleExportReport} />
            </div>
          </div>

          <div className="side-column">
            <div id="timeline">
              <TimelineView workflow={workflow} />
            </div>
            <SourcesAndMetrics steps={workflow.steps} />
            <VersionComparisonView workflow={workflow} />
          </div>
        </div>
      </div>
    </main>
  );
}
