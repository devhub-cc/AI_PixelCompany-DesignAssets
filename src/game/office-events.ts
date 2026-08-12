/**
 * Type stub — defines only the shape of presentation events consumed by the office screen.
 * The workflow integration that actually produces these events is not included in this repository.
 */
import type { LocalizedText } from "../i18n.ts";
import type { WorkflowStatus } from "./workflow.ts";

export type FeedTone = "info" | "success" | "warn" | "error";

export type OfficeEvent =
  | { kind: "clock"; minutes: number }
  | { kind: "arrive"; agentId: string; delayMs: number }
  | { kind: "depart"; agentId: string }
  | { kind: "activity"; agentId: string; activity: "work" | "meet" | "rest" | "report" | "idle" }
  | { kind: "say"; agentId: string; text: LocalizedText; tone: "talk" | "think"; ms: number }
  | { kind: "feed"; id: string; at: string; icon: string; tone: FeedTone; text: LocalizedText; workspaceId?: string }
  | { kind: "approval"; id: string; workspaceId: string; title: LocalizedText; summary: LocalizedText; open: boolean }
  | { kind: "workspace"; workspaceId: string; status: WorkflowStatus; progress: number };
