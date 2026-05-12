import { describe, expect, it } from "vitest";
import { contractPaths, loadContractModule } from "../support/contract";

interface PermissionDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

interface PermissionsModule {
  authorizeToolCall(input: {
    actor: "planner" | "worker" | "reporter";
    tool: string;
    sourceTrust?: "trusted" | "untrusted" | "malicious";
    requestedScopes?: readonly string[];
  }): PermissionDecision;
}

async function loadPermissions(): Promise<PermissionsModule> {
  return loadContractModule<PermissionsModule>({
    name: "permissions",
    candidates: contractPaths.permissions,
  });
}

describe("permission contract", () => {
  it("allows planner read-only research tools", async () => {
    const permissions = await loadPermissions();
    const decision = permissions.authorizeToolCall({
      actor: "planner",
      tool: "searchSources",
      requestedScopes: ["network:read"],
    });

    expect(decision.allowed).toBe(true);
  });

  it("denies privileged operations requested from source content", async () => {
    const permissions = await loadPermissions();
    const decision = permissions.authorizeToolCall({
      actor: "worker",
      tool: "external_transfer",
      sourceTrust: "malicious",
      requestedScopes: ["network:write", "secrets:read"],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/scope|permission|denied|not allowed/i);
  });

  it("prevents report generation from reading secrets or mutating state", async () => {
    const permissions = await loadPermissions();
    const decision = permissions.authorizeToolCall({
      actor: "reporter",
      tool: "generateReport",
      requestedScopes: ["secrets:read", "database:write"],
    });

    expect(decision.allowed).toBe(false);
  });
});
