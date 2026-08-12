/**
 * 타입 스텁 — 사무실 화면이 읽는 표현 이벤트의 형태만 정의합니다.
 * 이벤트를 실제로 만들어 내는 워크플로 연동은 이 저장소에 포함되지 않습니다.
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
