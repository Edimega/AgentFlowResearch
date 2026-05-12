export class AgentFlowError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly details?: unknown;

  public constructor(message: string, options: { code: string; retryable?: boolean; details?: unknown }) {
    super(message);
    this.name = "AgentFlowError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export class ValidationError extends AgentFlowError {
  public constructor(message: string, details?: unknown) {
    super(message, { code: "VALIDATION_ERROR", retryable: false, details });
    this.name = "ValidationError";
  }
}

export class ToolNotAllowedError extends AgentFlowError {
  public constructor(toolName: string, agentRole: string) {
    super(`Tool "${toolName}" is not allowed for agent "${agentRole}".`, {
      code: "TOOL_NOT_ALLOWED",
      retryable: false,
      details: { toolName, agentRole },
    });
    this.name = "ToolNotAllowedError";
  }
}

export class ToolExecutionError extends AgentFlowError {
  public constructor(message: string, options?: { retryable?: boolean; details?: unknown }) {
    super(message, {
      code: "TOOL_EXECUTION_ERROR",
      retryable: options?.retryable ?? true,
      details: options?.details,
    });
    this.name = "ToolExecutionError";
  }
}

export class WorkflowStateError extends AgentFlowError {
  public constructor(message: string, details?: unknown) {
    super(message, { code: "WORKFLOW_STATE_ERROR", retryable: false, details });
    this.name = "WorkflowStateError";
  }
}
