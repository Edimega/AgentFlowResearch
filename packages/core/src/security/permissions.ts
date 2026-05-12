export interface PermissionInput {
  readonly actor: "planner" | "worker" | "reporter";
  readonly tool: string;
  readonly sourceTrust?: "trusted" | "untrusted" | "malicious";
  readonly requestedScopes?: readonly string[];
}

export interface PermissionDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

const actorScopes: Record<PermissionInput["actor"], readonly string[]> = {
  planner: ["network:read", "database:read"],
  worker: ["network:read", "database:read", "database:write", "storage:read", "storage:write"],
  reporter: ["database:read", "storage:write"],
};

const allowedTools: Record<PermissionInput["actor"], readonly string[]> = {
  planner: ["searchSources", "evaluateSource"],
  worker: ["searchSources", "fetchSource", "evaluateSource", "generateReport"],
  reporter: ["generateReport"],
};

export function authorizeToolCall(input: PermissionInput): PermissionDecision {
  if (input.sourceTrust === "malicious") {
    return { allowed: false, reason: "Tool call denied because the request originated from malicious source content." };
  }

  if (!allowedTools[input.actor].includes(input.tool)) {
    return { allowed: false, reason: `Tool ${input.tool} is not allowed for actor ${input.actor}.` };
  }

  const scopes = input.requestedScopes ?? [];
  const disallowedScope = scopes.find((scope) => !actorScopes[input.actor].includes(scope));
  if (disallowedScope) {
    return { allowed: false, reason: `Scope ${disallowedScope} is not allowed for actor ${input.actor}.` };
  }

  return { allowed: true, reason: "Tool call is allowed by actor role and requested scopes." };
}
