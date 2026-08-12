/**
 * 타입 스텁 — 제품의 워크플로 엔진에서 화면 표시에 필요한 타입만 옮겨 왔습니다.
 * 실제 실행 로직·이벤트 소싱 엔진은 이 저장소에 포함되지 않습니다.
 */
export const WORKFLOW_STATUSES = [
  "idle",
  "running",
  "awaiting_approval",
  "completed",
  "failed",
] as const;

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];
