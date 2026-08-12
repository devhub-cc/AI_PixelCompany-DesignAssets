/**
 * Type stub — only the types needed for display were copied from the product workflow engine.
 * The actual execution logic and event-sourcing engine are not included in this repository.
 */
export const WORKFLOW_STATUSES = [
  "idle",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
] as const;

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];
