"use client";

import type { CSSProperties, DragEvent, KeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { STATUS_LABELS, WORKSPACES } from "./company.config";
import { localized, t, type Locale, type MessageKey } from "./i18n";
import {
  AMENITY_ZONES,
  DEFAULT_OFFICE_LAYOUT,
  FURNITURE_CATALOG,
  OFFICE_COLS,
  OFFICE_HEADCOUNT_MAX,
  OFFICE_HEADCOUNT_MIN,
  OFFICE_ROWS,
  OFFICE_THEMES,
  WORKSPACE_SEATS,
  WORKSPACE_ZONES,
  assignedAmenitySeat,
  canPlaceFurniture,
  checkedOfficeHeadcount,
  checkedOfficeLayout,
  ELEVATOR_SHAFT,
  findOfficePath,
  firstAvailableFurnitureCenter,
  furnitureFootprint,
  isOfficeWalkable,
  mayStartStroll,
  settledStrollGoal,
  spawnPointFor,
  strollPointForAgent,
  strollTargetForHeadcount,
  type FurnitureRotation,
  type OfficeFurniture,
  type OfficeFurnitureType,
  type OfficeLayout,
  type OfficePoint,
  type OfficeTheme,
} from "./game/office-world";
import type { OfficeEvent } from "./game/office-events";
import type { WorkflowStatus } from "./game/workflow";

export type OfficeWorldProps = {
  workspaceStatuses: Readonly<Record<string, WorkflowStatus>>;
  activeWorkspaceId: string | null;
  workflowStatus: WorkflowStatus;
  ready: boolean;
  locale: Locale;
  clock: { label: string; time: string };
  /**
   * 화면 연출용 표현 이벤트. 사무실 바닥은 이 중에서
   * 사람이 움직이는 것(`say`·`arrive`·`depart`)만 본다.
   */
  officeEvents?: readonly OfficeEvent[];
  /**
   * 이벤트를 공급하는 쪽이 바뀌었다는 표시. 값이 달라지면 전원을 다시 출근시킨다.
   * 이 신호가 없으면 공급자를 되돌려도 빈 사무실이 그대로 남는다.
   */
  officeSession?: number;
  /** 재생 배속과 사람의 실제 걸음을 같은 시간축에 둔다. 기본값 1. */
  motionTimeScale?: number;
  /** 출근 이벤트를 받은 전원이 실제 자리까지 걸어왔는지 알리는 신호. */
  onArrivalSettledChange?: (settled: boolean) => void;
  /**
   * 정원은 디스크가 아니라 이 화면이 들고 있다(슬라이더는 저장 전에도 바닥을 바꾼다).
   * 이벤트 공급자가 같은 수를 봐야 하므로 바뀔 때마다 올려 준다.
   */
  onHeadcountChange?: (headcount: number) => void;
};

type WorldStyle = CSSProperties & Record<`--${string}`, string | number>;
type Direction = "left" | "right" | "up" | "down";
type AgentMotion = {
  /** 지금 향하고 있는 타일. 도착 판정과 경로 진행의 기준점. */
  point: OfficePoint;
  /** 보간 출발 타일. point 와 사이를 progress 로 메운다. */
  from: OfficePoint;
  /** 0 → 1. 1 에 닿으면 point 로 스냅하고 다음 타일을 집는다. */
  progress: number;
  path: OfficePoint[];
  goal: string;
  layoutKey: string;
  direction: Direction;
  moving: boolean;
  /** 같은 칸에 선 직원끼리 완전히 겹치지 않도록 주는 타일 단위 미세 오프셋. */
  jitter: number;
  /** 출근 연출 — 이 시각(performance.now 기준) 전에는 화면에 없다. */
  arriveAt: number;
  /** 제자리에 선 직원이 매 프레임 경로를 다시 찾지 않도록 두는 재검토 시각. */
  decideAt: number;
  /** 퇴근 중 — 자리가 아니라 문으로 향하고, 문에 닿으면 화면에서 빠진다. */
  leaving: boolean;
  speech: string;
  speechTone: "talk" | "think";
  speechUntil: number;
};
type CameraView = "full" | "close";
type LayoutHistory = { past: OfficeLayout[]; present: OfficeLayout; future: OfficeLayout[] };

const AGENTS = [
  ...WORKSPACES.map((workspace, workspaceIndex) => ({
    ...workspace.worker,
    workspaceId: workspace.id,
    workspaceIndex,
    teamIndex: 0,
    primary: true as const,
  })),
  ...WORKSPACES[0].staff.flatMap((_, staffIndex) => WORKSPACES.map((workspace, workspaceIndex) => ({
    ...workspace.staff[staffIndex],
    workspaceId: workspace.id,
    workspaceIndex,
    teamIndex: staffIndex + 1,
    primary: false as const,
  }))),
].map((agent, agentIndex) => ({ ...agent, agentIndex }));
const DISPLAY_ZONES = [
  ...WORKSPACE_ZONES.map((zone) => ({ ...zone, kind: "work" as const })),
  ...AMENITY_ZONES.map((zone) => ({ ...zone, kind: "amenity" as const })),
];
const HUES = [
  { value: 0, label: "hue.original" },
  { value: 42, label: "hue.gold" },
  { value: 120, label: "hue.mint" },
  { value: 210, label: "hue.blue" },
  { value: 300, label: "hue.pink" },
] as const satisfies readonly { value: number; label: MessageKey }[];
const WORKSPACE_DIRECTIONS = [
  { primary: "right", support: "left" },
  { primary: "up", support: "up" },
  { primary: "right", support: "left" },
  { primary: "left", support: "right" },
  { primary: "up", support: "left" },
] as const satisfies readonly { primary: Direction; support: Direction }[];
const AMENITY_DIRECTIONS = ["up", "left", "right", "up"] as const satisfies readonly Direction[];
/** 스프라이트 6종을 서로 다른 사람처럼 보이게 하는 미세 색상 편차. 크게 틀면 살색이 무너진다. */
const AGENT_HUES = [0, -34, 18, -16, 34, -50] as const;

function homePoint(agent: (typeof AGENTS)[number]): OfficePoint {
  if (agent.primary) return WORKSPACE_SEATS[agent.workspaceId][1];
  if (agent.teamIndex === 1) return WORKSPACE_SEATS[agent.workspaceId][2];
  return assignedAmenitySeat(agent.agentIndex);
}

function homeGoal(agent: (typeof AGENTS)[number]) {
  return agent.primary || agent.teamIndex === 1
    ? `wait:${agent.workspaceId}:${agent.id}`
    : `rest:${agent.agentIndex}`;
}

function homeDirection(agent: (typeof AGENTS)[number]): Direction {
  if (agent.primary) return WORKSPACE_DIRECTIONS[agent.workspaceIndex].primary;
  if (agent.teamIndex === 1) return WORKSPACE_DIRECTIONS[agent.workspaceIndex].support;
  // 편의 공간 좌석은 방마다 개수가 달라 회전 배정된다. agentIndex 로는 어느 방에 앉는지 알 수 없으니
  // 실제 자리에서 방을 되짚어야 마지막 몇 명이 엉뚱한 쪽을 보고 앉지 않는다.
  const seat = assignedAmenitySeat(agent.agentIndex);
  const zoneIndex = AMENITY_ZONES.findIndex((zone) =>
    seat.col >= zone.col
    && seat.col < zone.col + zone.cols
    && seat.row >= zone.row
    && seat.row < zone.row + zone.rows);
  return AMENITY_DIRECTIONS[(zoneIndex < 0 ? agent.agentIndex : zoneIndex) % AMENITY_DIRECTIONS.length];
}

function seatAsset(direction: Direction) {
  const view = direction === "up" ? "BACK" : direction === "down" ? "FRONT" : "SIDE";
  return `/office-assets/furniture/CUSHIONED_CHAIR/CUSHIONED_CHAIR_${view}.png`;
}

/** rAF 안에서 부르는 DOM 헬퍼 — 값이 그대로면 건드리지 않아야 스타일 재계산이 안 생긴다. */
function attr(el: HTMLElement, name: string, value: string) {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/**
 * 걸음은 타일 단위로 끊지 않고 매 프레임 보간한다. 예전에는 200~300ms 마다 한 칸씩
 * 순간이동시키고 CSS `transition: left/top` 이 따라잡게 했는데, 트랜지션 길이(0.3s)가
 * 걸음 주기보다 길어 매번 중간에 잘리면서 고무줄처럼 끌려 보였다.
 */
const WALK_TILES_PER_SEC = 3.6;
// 기본 배치의 가장 먼 산책 지점은 자리까지 73칸(보통 걸음 약 20초)이다.
// 과업 시작 뒤의 복귀에만 두 배를 써서 장면을 당기되 순간이동은 하지 않는다.
const RETURN_TILES_PER_SEC = WALK_TILES_PER_SEC * 2;
/** 프레임이 길게 튀어도 시뮬레이션이 순간이동하지 않도록 한 번에 진행할 최대 시간. */
const MAX_FRAME_SECONDS = 0.05;
/** 스프라이트 한 칸(48×96)의 발밑을 타일 중심에 맞추기 위한 오프셋. */
const SPRITE_W = 48;
const SPRITE_H = 96;
/** 서 있을 때와 앉아 있을 때 발이 닿는 높이가 다르다. 예전 CSS 의 -80% / -67% 를 그대로 옮긴 값. */
const FOOT_ANCHOR = 0.8;
const SEATED_FOOT_ANCHOR = 0.67;
/**
 * 출근 연출 — 문에서 한 명씩 터져 나오는 간격.
 * 자리까지 걸어가는 데 6초쯤 걸리므로, 이보다 촘촘하면 문 앞에 사람이 쌓인다.
 */
const ARRIVAL_STAGGER_MS = 420;
/** 카메라는 목표로 감쇠 이동한다. 값이 클수록 빠르게 따라붙는다. */
const CAMERA_EASE = 0.11;
/**
 * 스프라이트는 48×96 고정인데 타일은 무대 크기에 따라 15px 안팎까지 작아진다.
 * 그대로 두면 한 사람이 3×7 타일을 차지해 가구보다 커지므로, 키를 타일 수로 못박는다.
 */
const AGENT_TILES_TALL = 2.6;
const MIN_AGENT_SCALE = 0.3;
/** 이름표가 이 정도로도 안 커지면 읽을 수 없다 — 접어서 시야를 비워 준다. */
const LABEL_LEGIBLE_SCALE = 0.58;
/**
 * 위쪽 밴드에서 이 행까지 앉은 사람은 이름표가 무대 위로 넘어가므로 아래로 밀어 준다
 * (`.world-agent[data-edge-seat]`). 행 5 이하의 위쪽 밴드 좌석이 전부 해당된다.
 * 아래쪽 밴드 최상단은 행 20 이고 그 위가 복도라 넘칠 곳이 없다 — 이 값에 걸리지 않는다.
 */
const TOP_BAND_SEAT_ROW = 5;

const clamp = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value));

/**
 * uid 는 저장본에 남으므로 세션이 달라도 겹치면 안 된다. 시각만으로는 같은 밀리초에 두 개가 나올 수 있어
 * 난수를 덧댄다. 컴포넌트 밖에 두는 이유는 렌더 함수 안에서 부르면 순수하지 않기 때문이다.
 */
function newFurnitureUid() {
  return globalThis.crypto?.randomUUID?.()
    ?? `office-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`;
}

function homeMotion(agent: (typeof AGENTS)[number]): AgentMotion {
  const point = { ...homePoint(agent) };
  return {
    point,
    from: { ...point },
    progress: 1,
    path: [],
    goal: homeGoal(agent),
    layoutKey: "",
    direction: homeDirection(agent),
    moving: false,
    jitter: jitterFor(agent.agentIndex),
    arriveAt: 0,
    decideAt: 0,
    leaving: false,
    speech: "",
    speechTone: "talk",
    speechUntil: 0,
  };
}

/** agentIndex 만으로 정해지는 고정 오프셋 — 매 프레임 흔들리면 오히려 산만하다. */
function jitterFor(agentIndex: number) {
  return (((agentIndex * 37) % 11) - 5) * 0.03;
}

const AGENT_BY_ID: ReadonlyMap<string, (typeof AGENTS)[number]> = new Map(
  AGENTS.map((agent) => [agent.id as string, agent]),
);

/**
 * 사람이 움직이는 이벤트만 걸러 움직임에 반영한다.
 * 컴포넌트 밖에 두는 이유는 rAF 루프와 같은 자료를 고쳐야 하기 때문이다.
 */
function applyOfficeEvents(
  events: readonly OfficeEvent[],
  motions: Record<string, AgentMotion>,
  locale: Locale,
  now: number,
  timeScale: number,
) {
  for (const event of events) {
    if (event.kind !== "say" && event.kind !== "arrive" && event.kind !== "depart") continue;
    const agent = AGENT_BY_ID.get(event.agentId);
    const motion = agent ? motions[agent.id] : undefined;
    if (!agent || !motion) continue;
    if (event.kind === "say") {
      motion.speech = localized(event.text, locale);
      motion.speechTone = event.tone;
      motion.speechUntil = now + event.ms;
    } else if (event.kind === "arrive") {
      sendToDoor(agent, motion, now + event.delayMs / timeScale);
    } else {
      motion.leaving = true;
      motion.decideAt = 0;
    }
  }
}

/** 출근 — 문이나 엘리베이터 앞에 세워 두고 정해진 시각에 세계로 들여보낸다. */
function sendToDoor(agent: (typeof AGENTS)[number], motion: AgentMotion, arriveAt: number) {
  const spawn = spawnPointFor(agent.agentIndex);
  motion.point = { ...spawn.point };
  motion.from = { ...spawn.point };
  motion.progress = 1;
  motion.path = [];
  motion.layoutKey = "";
  motion.goal = homeGoal(agent);
  // 정문은 아래쪽 벽이라 올려다보며 들어오고, 엘리베이터는 동쪽 끝이라 복도 쪽인 서쪽을 본다.
  motion.direction = spawn.via === "elevator" ? "left" : "up";
  motion.moving = false;
  motion.leaving = false;
  motion.arriveAt = arriveAt;
  motion.decideAt = arriveAt;
}

/**
 * 정원이 바뀌면 지원 인력을 자리로 되돌린다. 단, **자리를 떠나 있는 사람은 건드리지 않는다** —
 * 문에서 걸어 들어오는 중이든, 산책 중이든, 산책을 마치고 돌아오는 중이든 마찬가지다.
 * 슬라이더 한 칸마다 그들을 좌석으로 갈아 끼우면 한 프레임에 20~50타일을 뛰는 순간이동으로 보인다.
 *
 * 산책 인원 재조정은 이 함수가 아니라 `balanceStroll` 이 맡는다. 그쪽은 목표 인원을 보고
 * 걷게 하거나 자리로 돌려보내므로, 여기서 좌석으로 되돌리지 않아도 정원 변화에 맞춰 다시 맞는다.
 * 퇴근한 사람(`arriveAt` 무한대)은 되돌린다 — 출근 effect 가 다시 문으로 부른다.
 * 되돌릴 때도 **위치만** 바꾼다. 그 사람이 들고 있던 나머지 상태는 아래 주석의 이유로 지키지 않으면 안 된다.
 */
function resetSupportMotions(current: Record<string, AgentMotion>): Record<string, AgentMotion> {
  return Object.fromEntries(AGENTS.map((agent) => {
    const motion = current[agent.id];
    if (agent.primary) return [agent.id, motion];
    const home = homePoint(agent);
    const awayFromSeat = motion
      && Number.isFinite(motion.arriveAt)
      && (motion.point.col !== home.col || motion.point.row !== home.row);
    if (awayFromSeat) return [agent.id, motion];
    /*
     * 여기서 해야 하는 일은 **자리로 되돌리는 것 하나뿐**이므로 위치만 덮고 나머지는 그대로 둔다.
     * `homeMotion` 을 통째로 덮고 지켜야 할 필드를 되살리는 방식은 하나만 빠뜨려도 조용히 틀린다.
     * 덮을 것을 고르는 지금 방식은 빠뜨리면 사람이 자리로 안 돌아가는, 눈에 보이는 증상이 된다.
     */
    const seatedAgain = homeMotion(agent);
    if (!motion) return [agent.id, seatedAgain];
    return [agent.id, {
      ...motion,
      point: seatedAgain.point,
      from: seatedAgain.from,
      progress: 1,
      path: [],
      goal: seatedAgain.goal,
      layoutKey: "",
      direction: seatedAgain.direction,
      moving: false,
    }];
  }));
}

function navigationKey(layout: OfficeLayout) {
  return layout.furniture
    .map(({ uid, type, col, row, rotation }) => `${uid}:${type}:${col}:${row}:${rotation}`)
    .join("|");
}

function samePoint(a: OfficePoint, b: OfficePoint) {
  return a.col === b.col && a.row === b.row;
}

function directionBetween(from: OfficePoint, to: OfficePoint): Direction {
  if (to.col !== from.col) return to.col > from.col ? "right" : "left";
  return to.row > from.row ? "down" : "up";
}

function doorDirection(zone: { col: number; row: number; cols: number; rows: number; door: OfficePoint }) {
  if (zone.door.col < zone.col) return "left";
  if (zone.door.col >= zone.col + zone.cols) return "right";
  if (zone.door.row < zone.row) return "top";
  return "bottom";
}

function rectStyle(col: number, row: number, cols = 1, rows = 1): WorldStyle {
  return {
    "--world-x": `${(col / OFFICE_COLS) * 100}%`,
    "--world-y": `${(row / OFFICE_ROWS) * 100}%`,
    "--world-w": `${(cols / OFFICE_COLS) * 100}%`,
    "--world-h": `${(rows / OFFICE_ROWS) * 100}%`,
  };
}

function pointStyle({ col, row }: OfficePoint): WorldStyle {
  return {
    "--world-x": `${((col + 0.5) / OFFICE_COLS) * 100}%`,
    "--world-y": `${((row + 0.5) / OFFICE_ROWS) * 100}%`,
  };
}

function initialMotions(): Record<string, AgentMotion> {
  return Object.fromEntries(
    AGENTS.map((agent) => [agent.id, homeMotion(agent)]),
  );
}

function stationaryMotions(activeWorkspaceId: string | null): Record<string, AgentMotion> {
  return Object.fromEntries(
    AGENTS.map((agent) => {
      const working = agent.primary && activeWorkspaceId === agent.workspaceId;
      const point = { ...(working ? WORKSPACE_SEATS[agent.workspaceId][0] : homePoint(agent)) };
      return [
        agent.id,
        {
          ...homeMotion(agent),
          point,
          from: { ...point },
          goal: working ? `work:${agent.workspaceId}` : homeGoal(agent),
          direction: working ? ("up" as const) : homeDirection(agent),
        },
      ];
    }),
  );
}

function eventPoint(
  element: HTMLElement,
  clientX: number,
  clientY: number,
): OfficePoint {
  const rect = element.getBoundingClientRect();
  return {
    col: Math.max(0, Math.min(OFFICE_COLS - 1, Math.floor(((clientX - rect.left) / rect.width) * OFFICE_COLS))),
    row: Math.max(0, Math.min(OFFICE_ROWS - 1, Math.floor(((clientY - rect.top) / rect.height) * OFFICE_ROWS))),
  };
}

export function OfficeWorld({
  workspaceStatuses,
  activeWorkspaceId,
  workflowStatus,
  ready,
  locale,
  clock,
  officeEvents,
  officeSession = 0,
  motionTimeScale = 1,
  onArrivalSettledChange,
  onHeadcountChange,
}: OfficeWorldProps) {
  const [history, setHistory] = useState<LayoutHistory>({
    past: [],
    present: DEFAULT_OFFICE_LAYOUT,
    future: [],
  });
  // 직원 움직임은 상태가 아니라 ref 다. 프레임마다 setState 하면 편집기까지 통째로 다시 그려진다.
  const motionsRef = useRef<Record<string, AgentMotion>>(initialMotions());
  const agentEls = useRef(new Map<string, HTMLLIElement>());
  const cameraEl = useRef<HTMLDivElement>(null);
  const stageEl = useRef<HTMLDivElement>(null);
  const stageSize = useRef({ width: 0, height: 0 });
  const cam = useRef({ x: 0.5, y: 0.5, scale: 1 });
  const camTarget = useRef({ x: 0.5, y: 0.5, scale: 1 });
  const [editorOpen, setEditorOpen] = useState(false);
  const [placingType, setPlacingType] = useState<OfficeFurnitureType | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [cameraView, setCameraView] = useState<CameraView>("full");
  // 카메라가 진행을 따라갈지. 끄면 한 방을 계속 비출 수 있다.
  const [follow, setFollow] = useState(true);
  const [cameraPan, setCameraPan] = useState<{ x: number; y: number; workspaceId: string | null }>({
    x: 0,
    y: 0,
    workspaceId: null,
  });
  const [reducedMotion, setReducedMotion] = useState(false);
  // 앞 공간이 끝나고 다음 공간이 열릴 때만 생기는 서류 한 장. 애니메이션이 끝나면 스스로 사라진다.
  const [handoff, setHandoff] = useState<{ from: OfficePoint; to: OfficePoint; id: number } | null>(null);
  const handoffId = useRef(0);
  const lastActiveWorkspaceId = useRef<string | null>(null);
  // 문구가 아니라 키를 담아 두어야 언어를 바꿔도 마지막 안내가 함께 바뀐다.
  const [saveState, setSaveState] = useState<MessageKey>("layout.editable");
  const [saving, setSaving] = useState(false);
  const editRevision = useRef(0);
  // 마지막으로 전원을 출근시킨 세션. 정원 변경과 새 하루를 구분한다.
  const arrivedSession = useRef<number | null>(null);
  const arrivedHeadcount = useRef(0);
  const roamTarget = useRef(strollTargetForHeadcount(DEFAULT_OFFICE_LAYOUT.headcount));
  const roamChangeAt = useRef(0);
  const walkCursor = useRef(0);
  // 카메라 이동은 매 프레임 읽으므로 상태를 ref 로도 들고 있어야 한다.
  const panOffset = useRef({ x: 0, y: 0 });
  // 이미 반영한 이벤트 배치. 같은 배열이 다시 오면 무시한다.
  const appliedEvents = useRef<readonly OfficeEvent[] | null>(null);
  const reportedArrivalsSettled = useRef<boolean | null>(null);
  const safeMotionTimeScale = Number.isFinite(motionTimeScale) && motionTimeScale > 0 ? motionTimeScale : 1;
  const motionTimeScaleRef = useRef(safeMotionTimeScale);
  const onArrivalSettledChangeRef = useRef(onArrivalSettledChange);
  const panStart = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const layout = history.present;
  const pathLayoutKey = navigationKey(layout);

  useEffect(() => {
    const previousTimeScale = motionTimeScaleRef.current;
    if (previousTimeScale !== safeMotionTimeScale) {
      const now = performance.now();
      // 이미 예약된 출근도 새 배속으로 남은 간격을 다시 계산해야 버튼의 의미가 즉시 맞는다.
      for (const motion of Object.values(motionsRef.current)) {
        if (motion.arriveAt > now) {
          motion.arriveAt = now + ((motion.arriveAt - now) * previousTimeScale) / safeMotionTimeScale;
        }
      }
    }
    motionTimeScaleRef.current = safeMotionTimeScale;
    onArrivalSettledChangeRef.current = onArrivalSettledChange;
  }, [onArrivalSettledChange, safeMotionTimeScale]);
  const selected = layout.furniture.find(({ uid }) => uid === selectedUid) ?? null;
  const theme = OFFICE_THEMES[layout.theme];
  const visibleAgents = AGENTS.slice(0, layout.headcount);
  // 실제 업무 의미는 이 한 값만 소유한다. 승인 대기에는 시각·동작·접근성 모두 업무 중이 아니다.
  const workingWorkspaceId = workflowStatus === "running" ? activeWorkspaceId : null;
  const taskFocus = workingWorkspaceId !== null;
  const activeZone = WORKSPACE_ZONES.find(({ id }) => id === activeWorkspaceId);
  const cameraClose = cameraView === "close" && !editorOpen;
  const cameraScale = cameraClose ? 1.65 : 1;
  /*
   * 끌 여유는 보기 모드가 아니라 배율에서 나온다. 1 배에서는 층 전체가 이미 프레임 안이라
   * 끌 곳이 없다. 나중에 확대가 늘면 이 조건만으로 드래그가 따라 켜진다.
   */
  const canPan = cameraScale > 1;
  const cameraFocus = activeZone
    ? { col: activeZone.col + activeZone.cols / 2, row: activeZone.row + activeZone.rows / 2 }
    : { col: OFFICE_COLS / 2, row: OFFICE_ROWS / 2 };
  const visibleCameraPan = cameraPan.workspaceId === activeWorkspaceId ? cameraPan : { x: 0, y: 0 };
  const visibleSelectedAgentId = visibleAgents.some(({ id }) => id === selectedAgentId) ? selectedAgentId : null;

  // 카메라는 CSS 트랜지션이 아니라 rAF 에서 목표로 감쇠 이동한다. 여기서는 목표만 갱신한다.
  useEffect(() => {
    camTarget.current.scale = cameraScale;
    panOffset.current = cameraClose
      ? { x: visibleCameraPan.x, y: visibleCameraPan.y }
      : { x: 0, y: 0 };
    if (!cameraClose) {
      camTarget.current.x = 0.5;
      camTarget.current.y = 0.5;
      return;
    }
    // 추적을 끈 동안에는 진행이 옮겨 가도 보던 자리를 지킨다.
    if (!follow) return;
    camTarget.current.x = cameraFocus.col / OFFICE_COLS;
    camTarget.current.y = cameraFocus.row / OFFICE_ROWS;
  }, [follow, cameraClose, cameraFocus.col, cameraFocus.row, cameraScale, visibleCameraPan.x, visibleCameraPan.y]);

  // 픽셀 좌표로 그리려면 무대 크기를 알아야 한다. 리사이즈될 때만 다시 잰다.
  useEffect(() => {
    const node = stageEl.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      stageSize.current = { width: rect.width, height: rect.height };
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // 출근 연출 — 정원이 바뀌거나 세계가 열릴 때, 문과 엘리베이터에서 한 명씩 터져 나온다.
  useEffect(() => {
    if (!ready || reducedMotion) return;
    const start = performance.now();
    const motions = motionsRef.current;
    // 세션이 바뀌면 하루가 새로 시작한 것이므로 전원이 다시 출근한다.
    const newDay = arrivedSession.current !== officeSession;
    arrivedSession.current = officeSession;
    // 직전까지 화면에 있던 정원. 정원을 늘려 새로 생긴 사람은 이 수보다 뒤에 있다.
    const known = arrivedHeadcount.current;
    arrivedHeadcount.current = layout.headcount;
    let order = 0;
    for (const agent of AGENTS.slice(0, layout.headcount)) {
      const motion = motions[agent.id];
      /*
       * 정원만 늘렸을 때는 이미 안에 있는 사람을 다시 부르지 않는다 — 슬라이더 한 칸마다 전원이 재출근했다.
       * 다만 새로 생긴 사람은 화면 밖 인원을 매 프레임 homeMotion 으로 되돌리는 경로 때문에
       * arriveAt 이 0 이라, 정원 비교를 함께 보지 않으면 문을 거치지 않고 자리에 튀어나온다.
       */
      if (!newDay && agent.agentIndex < known && motion.arriveAt <= start) continue;
      sendToDoor(agent, motion, start + (order * ARRIVAL_STAGGER_MS) / motionTimeScaleRef.current);
      order += 1;
    }
    // 정원이 바뀌거나 이벤트 공급원이 바뀔 때 다시 출근시킨다. 레이아웃 편집 중에는 걸리지 않는다.
  }, [layout.headcount, officeSession, ready, reducedMotion]);

  // 슬라이더는 저장하지 않아도 바닥을 바꾼다. 이벤트 공급자가 같은 수를 봐야 하므로 즉시 알린다.
  useEffect(() => {
    onHeadcountChange?.(layout.headcount);
  }, [layout.headcount, onHeadcountChange]);

  // 표현 이벤트 중 사람이 움직이는 것만 여기서 소비한다. 나머지는 패널이 읽는다.
  useEffect(() => {
    /*
     * 같은 배치를 두 번 먹으면 안 된다. 이벤트가 없는 틱에는 배열이 그대로 남아 있으므로,
     * 언어를 바꾸거나 움직임 설정이 돌아오는 것만으로 effect 가 다시 돌면 마지막 배치가
     * 통째로 재생된다 — 자리에 앉아 있던 전원이 현관으로 순간이동해 출근을 다시 한다.
     */
    if (!officeEvents?.length || reducedMotion || appliedEvents.current === officeEvents) return;
    appliedEvents.current = officeEvents;
    applyOfficeEvents(officeEvents, motionsRef.current, locale, performance.now(), motionTimeScaleRef.current);
  }, [locale, officeEvents, reducedMotion]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setReducedMotion(media.matches);
      if (media.matches) motionsRef.current = stationaryMotions(workingWorkspaceId);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [workingWorkspaceId]);

  useEffect(() => {
    roamTarget.current = strollTargetForHeadcount(layout.headcount);
    // rAF 루프가 performance.now() 로 비교하므로 같은 시간축을 써야 한다.
    roamChangeAt.current = performance.now() + 20_000 + Math.random() * 20_000;
  }, [layout.headcount]);

  useEffect(() => {
    const previousId = lastActiveWorkspaceId.current;
    // 한 공간이 끝나면 다음 공간이 열리기 전에 활성 공간이 잠시 비므로, 빈 값으로 덮으면 짝을 잃는다.
    if (activeWorkspaceId) lastActiveWorkspaceId.current = activeWorkspaceId;
    if (reducedMotion || !previousId || !activeWorkspaceId || previousId === activeWorkspaceId) return;
    // 앞 공간이 실제로 끝났을 때만 넘긴다. 중단이나 실패로 비워진 자리는 넘길 것이 없다.
    if (workspaceStatuses[previousId] !== "completed") return;
    const from = WORKSPACE_ZONES.find(({ id }) => id === previousId)?.door;
    const to = WORKSPACE_ZONES.find(({ id }) => id === activeWorkspaceId)?.door;
    if (!from || !to) return;
    handoffId.current += 1;
    setHandoff({ from, to, id: handoffId.current });
  }, [activeWorkspaceId, reducedMotion, workspaceStatuses]);

  useEffect(() => {
    if (!ready) return;
    const taskSession = workflowStatus === "running" || workflowStatus === "awaiting_approval";

    /** 산책 인원을 목표치에 맞춰 늘리거나 되돌린다. */
    const balanceStroll = (now: number, motions: Record<string, AgentMotion>, visible: typeof AGENTS) => {
      if (now >= roamChangeAt.current) {
        roamTarget.current = strollTargetForHeadcount(layout.headcount);
        roamChangeAt.current = now + 20_000 + Math.random() * 20_000;
      }
      const desiredRoamTarget = taskSession ? 0 : roamTarget.current;
      const support = visible.filter((agent) => !agent.primary);
      const roaming = support.filter((agent) => motions[agent.id].goal.startsWith("walk:") && !motions[agent.id].goal.endsWith(":return"));
      for (const agent of roaming.slice(desiredRoamTarget)) {
        motions[agent.id].path = [];
        motions[agent.id].goal = `walk:${agent.id}:return`;
      }
      const walking = support.filter((agent) => motions[agent.id].goal.startsWith("walk:")).length;
      if (!mayStartStroll(walking < desiredRoamTarget, taskSession)) return;
      let lastIndex = -1;
      let remaining = desiredRoamTarget - walking;
      for (let offset = 0; offset < support.length && remaining > 0; offset += 1) {
        const index = (walkCursor.current + offset) % support.length;
        const agent = support[index];
        const motion = motions[agent.id];
        if (motion.moving || motion.goal.startsWith("walk:") || !samePoint(motion.point, homePoint(agent))) continue;
        motion.path = [];
        motion.goal = `walk:${agent.id}:out`;
        motion.decideAt = 0;
        lastIndex = index;
        remaining -= 1;
      }
      if (lastIndex >= 0) walkCursor.current = (lastIndex + 1) % support.length;
    };

    /**
     * 마주 오는 사람 때문에 길이 막혔을 때 비어 있는 옆칸(대개 왔던 길)으로 한 칸 물러난다.
     * 재검토 간격이 사람마다 달라서(220 + agentIndex 기반) 둘이 동시에 같은 칸을 노리지 않는다.
     */
    const stepAside = (from: OfficePoint, occupied: Set<string>): OfficePoint | null => {
      for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const next = { col: from.col + dc, row: from.row + dr };
        if (occupied.has(`${next.col},${next.row}`) || !isOfficeWalkable(next, layout)) continue;
        return next;
      }
      return null;
    };

    /** 한 칸을 다 걸은 직원이 다음 칸을 고른다. 경로가 없으면 그 자리에 선다. */
    const decide = (agent: (typeof AGENTS)[number], motion: AgentMotion, now: number, occupied: Set<string>) => {
      occupied.delete(`${motion.point.col},${motion.point.row}`);
      const working = agent.primary && workingWorkspaceId === agent.workspaceId;
      // 퇴근 중이면 자리도 산책도 없다. 문 하나만 보고 간다.
      const normalTarget = motion.leaving
        ? spawnPointFor(agent.agentIndex).point
        : working
          ? WORKSPACE_SEATS[agent.workspaceId][0]
          : homePoint(agent);
      const normalGoal = motion.leaving ? `leave:${agent.id}` : working ? `work:${agent.workspaceId}` : homeGoal(agent);
      const layoutChanged = motion.layoutKey !== pathLayoutKey;
      let path = layoutChanged ? [] : motion.path;
      let goal = motion.goal;
      const walkingOut = !motion.leaving && goal === `walk:${agent.id}:out`;
      const walkingBack = !motion.leaving && goal === `walk:${agent.id}:back`;
      const returning = !motion.leaving && goal === `walk:${agent.id}:return`;
      const target = walkingOut
        ? strollPointForAgent(agent.agentIndex, "out")
        : walkingBack
          ? strollPointForAgent(agent.agentIndex, "back")
          : normalTarget;
      const targetGoal = walkingOut || walkingBack || returning ? goal : normalGoal;

      /** 제자리에 서고, 다음 재검토까지 텀을 둔다 — 안 그러면 매 프레임 길찾기가 돈다. */
      const settle = () => {
        motion.path = [];
        motion.layoutKey = pathLayoutKey;
        motion.moving = false;
        motion.decideAt = now + 220 + ((agent.agentIndex * 53) % 160);
        occupied.add(`${motion.point.col},${motion.point.row}`);
      };

      if (samePoint(motion.point, target)) {
        if (motion.leaving) {
          // 문에 닿았다 — 오늘은 여기까지. 다음 출근 이벤트가 다시 불러들인다.
          motion.goal = normalGoal;
          motion.moving = false;
          motion.arriveAt = Number.POSITIVE_INFINITY;
          return;
        }
        motion.goal = settledStrollGoal(goal, agent.id, normalGoal);
        motion.direction = working ? "up" : walkingOut || walkingBack ? motion.direction : homeDirection(agent);
        settle();
        return;
      }
      if (goal !== targetGoal || !path.length) {
        path = findOfficePath(motion.point, target, layout, occupied);
        goal = targetGoal;
      }
      // 경로가 비면 `path[0]` 은 undefined 고 `stepAside` 는 null 을 준다. 둘 다 "다음 칸 없음"이므로
      // 타입을 nullable 로 적어야 아래 `if (!point)` 가 실제로 하는 일과 선언이 어긋나지 않는다.
      let point: OfficePoint | null = path[0] ?? null;
      if (point && occupied.has(`${point.col},${point.row}`)) {
        path = findOfficePath(motion.point, target, layout, occupied);
        point = path[0] ?? null;
      }
      if (!point && findOfficePath(motion.point, target, layout).length) {
        // 길 자체는 있는데 사람이 막고 있다. 아무도 물러나지 않으면 1칸 통로에서 영구 교착이다.
        point = stepAside(motion.point, occupied);
      }
      if (!point) {
        motion.goal = goal;
        settle();
        return;
      }
      occupied.add(`${point.col},${point.row}`);
      motion.from = { ...motion.point };
      motion.point = point;
      motion.progress = 0;
      motion.path = path.slice(1);
      motion.goal = goal;
      motion.layoutKey = pathLayoutKey;
      motion.direction = directionBetween(motion.from, point);
      motion.moving = true;
    };

    const advance = (now: number, dt: number) => {
      const motions = motionsRef.current;
      const visible = AGENTS.slice(0, layout.headcount);
      for (const agent of AGENTS.slice(layout.headcount)) motions[agent.id] = homeMotion(agent);
      balanceStroll(now, motions, visible);

      const occupied = new Set<string>();
      for (const agent of visible) {
        const motion = motions[agent.id];
        /*
         * 문 밖에 있는 사람은 바닥을 차지하지 않는다.
         * 퇴근해 화면에서 빠진 직원의 point 는 문 타일에 그대로 남는데, 그를 점유로 세면
         * 그 칸이 영원히 막혀 뒤따라 나가려던 전원이 경로를 못 찾고 입구에 갇힌다.
         * 문은 두 칸뿐이라 정원이 몇이든 딱 두 명만 퇴근하고 나머지가 유일한 통로를 막는다.
         */
        if (now < motion.arriveAt) continue;
        occupied.add(`${motion.point.col},${motion.point.row}`);
      }

      for (const agent of visible) {
        const motion = motions[agent.id];
        // 아직 문 밖이면 세계에 없는 것으로 친다.
        if (now < motion.arriveAt) continue;
        if (motion.speechUntil && now >= motion.speechUntil) {
          motion.speech = "";
          motion.speechUntil = 0;
        }
        if (motion.progress < 1) {
          const span = Math.abs(motion.point.col - motion.from.col) + Math.abs(motion.point.row - motion.from.row) || 1;
          const speed = (motion.goal.endsWith(":return") ? RETURN_TILES_PER_SEC : WALK_TILES_PER_SEC)
            * motionTimeScaleRef.current;
          motion.progress = Math.min(1, motion.progress + (speed * dt) / span);
          if (motion.progress < 1) continue;
          motion.from = { ...motion.point };
          motion.decideAt = 0;
        }
        if (now < motion.decideAt) continue;
        decide(agent, motion, now, occupied);
      }
    };

    const paint = (now: number) => {
      const motions = motionsRef.current;
      const visible = AGENTS.slice(0, layout.headcount);
      // 작은 화면의 다른 탭에서 무대가 0×0으로 숨더라도 물리 출근 완료는 계속 보고한다.
      const arrivalsSettled = visible.every((agent) => {
        const motion = motions[agent.id];
        return now >= motion.arriveAt && !motion.moving && samePoint(motion.point, homePoint(agent));
      });
      if (reportedArrivalsSettled.current !== arrivalsSettled) {
        reportedArrivalsSettled.current = arrivalsSettled;
        onArrivalSettledChangeRef.current?.(arrivalsSettled);
      }

      const { width, height } = stageSize.current;
      if (!width || !height) return;
      const tileW = width / OFFICE_COLS;
      const tileH = height / OFFICE_ROWS;
      const crowded = layout.headcount > 16;
      const target = camTarget.current;
      const view = cam.current;
      // 움직임을 줄이기로 한 사용자에게는 감쇠 없이 바로 붙인다.
      const ease = reducedMotion ? 1 : CAMERA_EASE;
      view.x += (target.x - view.x) * ease;
      view.y += (target.y - view.y) * ease;
      view.scale += (target.scale - view.scale) * ease;
      // 사람 키를 타일에 맞춘다. 무대가 좁아지면 같이 작아져야 가구와 비율이 유지된다.
      const agentScale = Math.min(1, Math.max(MIN_AGENT_SCALE, (tileH * AGENT_TILES_TALL) / SPRITE_H));
      const camNode = cameraEl.current;
      if (camNode) {
        // 확대한 만큼만 밀 수 있다. 넘기면 바닥이 프레임 밖으로 빠져 빈 무대가 드러난다.
        const limitX = Math.max(0, ((view.scale - 1) / 2) * width);
        const limitY = Math.max(0, ((view.scale - 1) / 2) * height);
        const offsetX = clamp((0.5 - view.x) * view.scale * width + panOffset.current.x, limitX);
        const offsetY = clamp((0.5 - view.y) * view.scale * height + panOffset.current.y, limitY);
        camNode.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${view.scale})`;
        // 이름표·말풍선은 사람과 함께 줄어들면 못 읽는다. 줄어든 만큼 되돌려 준다.
        camNode.style.setProperty("--label-counter", (1 / agentScale).toFixed(3));
        // 클래스가 아니라 data 속성이어야 한다 — React 가 다시 그릴 때 className 을 통째로 덮어쓴다.
        attr(camNode, "data-compact", agentScale * view.scale < LABEL_LEGIBLE_SCALE ? "true" : "false");
      }

      for (const agent of visible) {
        const el = agentEls.current.get(agent.id);
        const motion = motions[agent.id];
        if (!el || !motion) continue;
        const offstage = now < motion.arriveAt;
        attr(el, "data-task-focus", taskFocus ? "true" : "false");
        attr(el, "data-offstage", offstage ? "true" : "false");
        if (offstage) continue;

        const col = motion.from.col + (motion.point.col - motion.from.col) * motion.progress + 0.5 + motion.jitter;
        const row = motion.from.row + (motion.point.row - motion.from.row) * motion.progress + 0.5;
        const working = agent.primary && workingWorkspaceId === agent.workspaceId;
        const atDesk = working && !motion.moving && samePoint(motion.point, WORKSPACE_SEATS[agent.workspaceId][0]);
        const seated = !motion.moving && samePoint(motion.point, homePoint(agent)) && !atDesk;
        const pose = atDesk ? 1.12 : seated ? (crowded ? 0.58 : 0.72) : 1;
        const scale = pose * agentScale;
        /*
         * transform-origin 이 center bottom 이라 배율은 발밑 좌표를 바꾸지 않는다.
         * 그래서 상자 크기(SPRITE_W/H)는 원본 그대로 빼고, 타일 아래로 내려 세우는
         * 여유분만 배율을 먹인다. 이 여유분이 예전 CSS 의 -80% / -67% 에 해당한다.
         */
        const overhang = (1 - (seated ? SEATED_FOOT_ANCHOR : FOOT_ANCHOR)) * SPRITE_H * scale;
        const transform =
          `translate3d(${col * tileW - SPRITE_W / 2}px, ${row * tileH - SPRITE_H + overhang}px, 0) scale(${scale})`;
        // 같은 값을 다시 쓰면 브라우저가 스타일을 다시 계산한다. 제자리에 선 직원이 대부분이다.
        if (el.dataset.transform !== transform) {
          el.dataset.transform = transform;
          el.style.transform = transform;
          el.style.zIndex = String(10 + Math.round(row));
        }

        const strolling = motion.goal.startsWith("walk:");
        const workplaceAgent = agent.primary || agent.teamIndex === 1;
        attr(el, "data-direction", motion.direction);
        attr(el, "data-moving", motion.moving ? "true" : "false");
        attr(el, "data-resting", seated ? "true" : "false");
        attr(el, "data-popover-side", motion.point.col > OFFICE_COLS * 0.7 ? "left" : "right");
        attr(
          el,
          "data-activity",
          strolling ? "stroll" : agent.primary && motion.moving ? "move" : atDesk ? "work" : workplaceAgent ? "wait" : "rest",
        );
        attr(el, "data-working", atDesk ? "true" : "false");

        const bubble = el.querySelector<HTMLElement>(".world-agent-bubble");
        if (bubble && bubble.dataset.text !== motion.speech) {
          bubble.dataset.text = motion.speech;
          bubble.textContent = motion.speech;
          attr(bubble, "data-on", motion.speech ? "true" : "false");
          attr(bubble, "data-tone", motion.speechTone);
        }
      }
    };

    // 움직임을 줄이기로 했으면 걷지 않는다 — 자리에 앉힌 채 그리기만 한다.
    if (reducedMotion) motionsRef.current = stationaryMotions(workingWorkspaceId);

    let raf = 0;
    let previous = performance.now();
    const frame = (now: number) => {
      if (!reducedMotion) advance(now, Math.min((now - previous) / 1000, MAX_FRAME_SECONDS));
      previous = now;
      paint(now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [layout, pathLayoutKey, ready, reducedMotion, taskFocus, workingWorkspaceId, workflowStatus]);

  function markChanged() {
    editRevision.current += 1;
    setSaveState("layout.unsaved");
  }

  function commitLayout(next: OfficeLayout) {
    if (saving) return;
    /*
     * 가구·테마·이름이 그대로면 다시 검사할 것은 정원뿐이다. 전체 검증은 가구 O(n²) 겹침 검사와
     * 좌석 45곳 BFS 라, 슬라이더를 5→35로 끌면 한 칸마다 40~50ms 씩 화면이 멈췄다.
     */
    const headcountOnly = next.furniture === layout.furniture
      && next.theme === layout.theme
      && next.officeName === layout.officeName;
    const checked = headcountOnly
      ? { ...layout, headcount: checkedOfficeHeadcount(next.headcount) }
      : checkedOfficeLayout(next);
    if (checked.headcount !== layout.headcount) motionsRef.current = resetSupportMotions(motionsRef.current);
    setHistory((current) => ({
      past: [...current.past.slice(-29), current.present],
      present: checked,
      future: [],
    }));
    markChanged();
  }

  function undo() {
    if (!history.past.length || saving) return;
    const previous = history.past.at(-1)!;
    if (previous.headcount !== history.present.headcount) motionsRef.current = resetSupportMotions(motionsRef.current);
    setHistory({
      past: history.past.slice(0, -1),
      present: previous,
      future: [history.present, ...history.future],
    });
    markChanged();
  }

  function redo() {
    if (!history.future.length || saving) return;
    const [next, ...future] = history.future;
    if (next.headcount !== history.present.headcount) motionsRef.current = resetSupportMotions(motionsRef.current);
    setHistory({ past: [...history.past, history.present], present: next, future });
    markChanged();
  }

  /**
   * 지금 직원이 밟고 있는 칸. 걷는 중에는 떠난 칸과 딛는 칸 사이에 있으므로 둘 다 센다.
   * 편집기를 열어도 직원은 계속 걷기 때문에, 이걸 안 보면 사람 위에 가구가 놓인다.
   */
  function standingTiles() {
    const keys = new Set<string>();
    for (const agent of visibleAgents) {
      const motion = motionsRef.current[agent.id];
      if (!motion) continue;
      keys.add(`${motion.point.col},${motion.point.row}`);
      keys.add(`${motion.from.col},${motion.from.row}`);
    }
    return keys;
  }

  function placeFurniture(type: OfficeFurnitureType, point: OfficePoint) {
    if (saving) return;
    const catalogItem = FURNITURE_CATALOG.find((item) => item.type === type);
    if (!catalogItem) return;
    const furnitureType = catalogItem.type;
    const size = furnitureFootprint(furnitureType, 0);
    const item: OfficeFurniture = {
      uid: newFurnitureUid(),
      type: furnitureType,
      col: point.col - Math.floor(size.cols / 2),
      row: point.row - Math.floor(size.rows / 2),
      rotation: 0,
      hue: 0,
    };
    if (!canPlaceFurniture(layout, item, undefined, standingTiles())) {
      setSaveState("layout.blockedPlacement");
      return;
    }
    commitLayout({ ...layout, furniture: [...layout.furniture, item] });
    setSelectedUid(item.uid);
    setPlacingType(null);
  }

  function updateSelected(update: Partial<OfficeFurniture>) {
    if (!selected || saving) return;
    const next = { ...selected, ...update };
    if (!canPlaceFurniture(layout, next, selected.uid, standingTiles())) {
      setSaveState("layout.blockedOverlap");
      return;
    }
    commitLayout({
      ...layout,
      furniture: layout.furniture.map((item) => item.uid === selected.uid ? next : item),
    });
  }

  function handleWorldClick(event: MouseEvent<HTMLDivElement>) {
    if (!editorOpen) {
      setSelectedAgentId(null);
      return;
    }
    if (!placingType) return;
    placeFurniture(placingType, eventPoint(event.currentTarget, event.clientX, event.clientY));
  }

  function handleCameraPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canPan || event.button !== 0 || (event.target as Element).closest("button")) return;
    panStart.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      panX: visibleCameraPan.x,
      panY: visibleCameraPan.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCameraPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = panStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    // 화면에 반영되지 않을 값까지 쌓아 두면, 방향을 되돌렸을 때 헛도는 구간이 생긴다.
    const { width, height } = stageSize.current;
    const baseX = (0.5 - camTarget.current.x) * cameraScale * width;
    const baseY = (0.5 - camTarget.current.y) * cameraScale * height;
    const limitX = Math.max(0, ((cameraScale - 1) / 2) * width);
    const limitY = Math.max(0, ((cameraScale - 1) / 2) * height);
    setCameraPan({
      x: clamp(start.panX + event.clientX - start.x + baseX, limitX) - baseX,
      y: clamp(start.panY + event.clientY - start.y + baseY, limitY) - baseY,
      workspaceId: activeWorkspaceId,
    });
  }

  function finishCameraPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (panStart.current?.pointerId !== event.pointerId) return;
    panStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleWorldKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!editorOpen || !placingType || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    const point = firstAvailableFurnitureCenter(layout, placingType, standingTiles());
    if (point) placeFurniture(placingType, point);
    else setSaveState("layout.noRoom");
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!editorOpen || saving) return;
    const uid = event.dataTransfer.getData("text/plain");
    const item = layout.furniture.find((entry) => entry.uid === uid);
    if (!item) return;
    const point = eventPoint(event.currentTarget, event.clientX, event.clientY);
    const size = furnitureFootprint(item.type, item.rotation);
    const moved = {
      ...item,
      col: point.col - Math.floor(size.cols / 2),
      row: point.row - Math.floor(size.rows / 2),
    };
    setSelectedUid(uid);
    if (!canPlaceFurniture(layout, moved, item.uid, standingTiles())) {
      setSaveState("layout.blockedOverlap");
      return;
    }
    commitLayout({
      ...layout,
      furniture: layout.furniture.map((entry) => entry.uid === uid ? moved : entry),
    });
  }

  async function saveLayout() {
    if (saving) return;
    // 데모는 호스트 저장소가 없으므로 언제나 웹 미리보기 상태로 남는다.
    setSaveState("layout.webPreview");
  }

  const rootStyle = {
    "--office-floor": theme.floor,
    "--office-wall": theme.wall,
    "--office-wall-dark": theme.wallDark,
    "--office-trim": theme.trim,
    "--office-rug": theme.rug,
    "--office-carpet": theme.carpet,
    "--office-accent": theme.accent,
    "--office-glow": theme.glow,
    "--office-surface": theme.surface,
    "--office-ink": theme.ink,
    "--office-floor-asset": `url("${theme.floorAsset}")`,
    "--office-wall-asset": `url("${theme.wallAsset}")`,
    "--office-carpet-asset": `url("${theme.carpetAsset}")`,
    "--office-grid-x": `${100 / OFFICE_COLS}%`,
    "--office-grid-y": `${100 / OFFICE_ROWS}%`,
  } as WorldStyle;

  return (
    <section
      className={`office-world theme-${layout.theme} workflow-${workflowStatus} camera-${cameraView}${ready ? " office-ready" : ""}${editorOpen ? " editor-open" : ""}${layout.headcount > 16 ? " office-crowded" : ""}`}
      style={rootStyle}
      aria-labelledby="office-world-title"
    >
      <header className="office-world-heading">
        <div>
          <p>{t(locale, "office.kicker")}</p>
          <h3 id="office-world-title">{t(locale, "office.title")}</h3>
          <span>{t(locale, "office.summary", { count: layout.headcount })}</span>
        </div>
        <div className="office-world-heading-tools">
          <div className="office-clock-card">
            <span>{clock.label}</span>
            <time dateTime={clock.time}>{clock.time}</time>
          </div>
          <div className="office-world-actions">
            <span className={`status-badge status-${workflowStatus}`} role="status">
              {localized(STATUS_LABELS[workflowStatus], locale)}
            </span>
            <button
              type="button"
              className="office-editor-toggle"
              aria-expanded={editorOpen}
              aria-controls="office-editor"
              onClick={() => {
                setEditorOpen((open) => !open);
                setPlacingType(null);
                setSelectedAgentId(null);
                setCameraView("full");
                setCameraPan({ x: 0, y: 0, workspaceId: activeWorkspaceId });
              }}
            >
              {t(locale, editorOpen ? "office.editorClose" : "office.editorOpen")}
            </button>
          </div>
        </div>
      </header>

      <div className="office-world-body">
        <div
          className={`office-world-stage${editorOpen ? " editing" : ""}${placingType ? " placing" : ""}${canPan ? " camera-pannable" : ""}`}
          data-editing={editorOpen ? "true" : "false"}
          data-camera-view={cameraClose ? "close" : "full"}
          ref={stageEl}
          style={{ aspectRatio: `${OFFICE_COLS} / ${OFFICE_ROWS}` }}
          role="group"
          aria-label={placingType
            ? t(locale, "office.placePrompt")
            : t(locale, cameraClose ? "office.stageClose" : "office.stage")}
          tabIndex={placingType ? 0 : undefined}
          onClick={handleWorldClick}
          onKeyDown={handleWorldKeyDown}
          onPointerDown={handleCameraPointerDown}
          onPointerMove={handleCameraPointerMove}
          onPointerUp={finishCameraPan}
          onPointerCancel={finishCameraPan}
          onDragOver={(event) => { if (editorOpen) event.preventDefault(); }}
          onDrop={handleDrop}
        >
          <div className="office-world-camera" ref={cameraEl} data-compact="false">
          <i
            className="office-elevator"
            aria-hidden="true"
            style={rectStyle(ELEVATOR_SHAFT.col, ELEVATOR_SHAFT.row, ELEVATOR_SHAFT.cols, ELEVATOR_SHAFT.rows)}
          />
          <div className="office-zone-layer">
            {DISPLAY_ZONES.map((zone) => {
              const active = zone.kind === "work" && activeWorkspaceId === zone.id;
              return (
                <article
                  className={`office-zone ${zone.kind === "amenity" ? "amenity-zone " : ""}zone-${zone.id}`}
                  key={zone.id}
                  style={{ ...rectStyle(zone.col, zone.row, zone.cols, zone.rows), "--zone-accent": zone.accent } as WorldStyle}
                  aria-label={`${localized(zone.name, locale)}, ${localized(zone.role, locale)}`}
                  aria-current={active ? "step" : undefined}
                  data-zone-status={zone.kind === "work" ? workspaceStatuses[zone.id] ?? "idle" : undefined}
                >
                  <div className="office-zone-heading">
                    <span>{zone.code}</span>
                    <div>
                      <strong>{localized(zone.name, locale)}</strong>
                      {zone.kind === "amenity" ? <small>{localized(zone.role, locale)}</small> : null}
                    </div>
                  </div>
                  <i
                    className={`office-zone-door door-${doorDirection(zone)}`}
                    style={{
                      "--door-x": `${Math.max(0, Math.min(100, ((zone.door.col - zone.col) / zone.cols) * 100))}%`,
                      "--door-y": `${Math.max(0, Math.min(100, ((zone.door.row - zone.row) / zone.rows) * 100))}%`,
                    } as WorldStyle}
                    aria-hidden="true"
                  />
                </article>
              );
            })}
          </div>

          <div className="office-furniture-layer" aria-label={t(locale, "office.furnitureLayer")}>
            {layout.furniture.map((item) => {
              const catalogItem = FURNITURE_CATALOG.find(({ type }) => type === item.type);
              const size = furnitureFootprint(item.type, item.rotation);
              return (
                <button
                  type="button"
                  className={`office-furniture furniture-${item.type}${selectedUid === item.uid ? " furniture-selected" : ""}`}
                  key={item.uid}
                  style={{
                    ...rectStyle(item.col, item.row, size.cols, size.rows),
                    "--furniture-asset": `url("${catalogItem?.asset ?? ""}")`,
                    "--furniture-hue": `${item.hue}deg`,
                    "--furniture-rotation": `${item.rotation}deg`,
                    "--world-row": item.row,
                  } as WorldStyle}
                  aria-label={`${catalogItem ? localized(catalogItem.label, locale) : item.type}${selectedUid === item.uid ? t(locale, "office.furnitureSelected") : ""}`}
                  aria-pressed={selectedUid === item.uid}
                  disabled={!editorOpen}
                  draggable={editorOpen && !saving}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedUid(item.uid);
                    setPlacingType(null);
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", item.uid);
                    event.dataTransfer.effectAllowed = "move";
                    setSelectedUid(item.uid);
                  }}
                >
                  <span className="office-furniture-sprite" aria-hidden="true" />
                </button>
              );
            })}
          </div>

          <ul className="office-agent-layer" aria-label={t(locale, "office.agentLayer", { count: visibleAgents.length })}>
            {visibleAgents.map((agent) => {
              const workspaceStatus = workspaceStatuses[agent.workspaceId] ?? "idle";
              const status = agent.primary ? workspaceStatus : undefined;
              const working = agent.primary && workingWorkspaceId === agent.workspaceId;
              const workplaceAgent = agent.primary || agent.teamIndex === 1;
              // 순간순간의 걸음은 rAF 가 data-activity 로 쓴다. 읽어 주는 문구는 맡은 일로 적어야
              // 스크린리더가 한 걸음마다 다시 읽지 않는다.
              const activity = t(locale, `activity.${working ? "work" : workplaceAgent ? "wait" : "rest"}`);
              const selectedAgent = visibleSelectedAgentId === agent.id;
              const popoverId = `office-agent-${agent.id}`;
              return (
                <li
                  className={`world-agent ${agent.primary ? `agent-primary status-${status}` : "agent-support"}${selectedAgent ? " agent-selected" : ""} sprite-${agent.sprite}`}
                  key={agent.id}
                  ref={(el) => {
                    if (el) agentEls.current.set(agent.id, el);
                    else agentEls.current.delete(agent.id);
                  }}
                  style={{
                    "--sprite-image": `url("/characters/char_${agent.sprite}.png")`,
                    // 앉는 방향은 자리마다 고정이라 프레임마다 다시 계산할 필요가 없다.
                    "--seat-asset": `url("${seatAsset(homeDirection(agent))}")`,
                    // 스프라이트가 6종뿐이라 35명이면 같은 얼굴이 여섯 번씩 나온다.
                    // 살색이 뭉개지지 않을 만큼만 색을 틀어 6종 × 6단계로 갈라 놓는다.
                    "--agent-hue": `${AGENT_HUES[agent.agentIndex % AGENT_HUES.length]}deg`,
                  } as WorldStyle}
                  data-edge-seat={!workplaceAgent && homePoint(agent).row <= TOP_BAND_SEAT_ROW ? "true" : undefined}
                  data-workspace-status={workspaceStatus}
                  aria-current={working ? "step" : undefined}
                >
                  <b className="world-agent-bubble" data-on="false" data-tone="talk" aria-hidden="true" />
                  <button
                    type="button"
                    className="world-agent-select"
                    aria-label={t(locale, "office.agentSummary", {
                      title: localized(agent.title, locale),
                      name: localized(agent.name, locale),
                      workspace: localized(WORKSPACES[agent.workspaceIndex].name, locale),
                      status: localized(STATUS_LABELS[workspaceStatus], locale),
                      activity,
                    })}
                    aria-expanded={selectedAgent}
                    aria-controls={selectedAgent ? popoverId : undefined}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedAgentId((current) => current === agent.id ? null : agent.id);
                    }}
                  />
                  <span className="world-agent-sprite" aria-hidden="true" />
                  <span className="world-agent-identity">
                    <small title={localized(agent.title, locale)}>
                      {localized(agent.title, locale).split(" ")[0].slice(0, 3).toUpperCase()}
                    </small>
                    <strong>{localized(agent.name, locale)}</strong>
                  </span>
                  {status && status !== "idle" ? (
                    <b className="world-agent-status">{localized(STATUS_LABELS[status], locale)}</b>
                  ) : null}
                  {selectedAgent ? (
                    <aside
                      className="world-agent-popover"
                      id={popoverId}
                      aria-label={t(locale, "office.agentInfo", { name: localized(agent.name, locale) })}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <strong>{localized(agent.name, locale)}</strong>
                      <span>{localized(agent.title, locale)}</span>
                      <dl>
                        <div>
                          <dt>{t(locale, "office.agentWorkspace")}</dt>
                          <dd>
                            {localized(WORKSPACES[agent.workspaceIndex].name, locale)}
                            {" · "}
                            {localized(STATUS_LABELS[workspaceStatus], locale)}
                          </dd>
                        </div>
                        <div>
                          <dt>{t(locale, "office.agentNow")}</dt>
                          <dd>{activity}</dd>
                        </div>
                      </dl>
                      <button type="button" onClick={() => setSelectedAgentId(null)} aria-label={t(locale, "office.agentClose")}>×</button>
                    </aside>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {/* Reduced motion strips the animation, so `animationend` never fires and the sheet would stick. */}
          {handoff && !reducedMotion ? (
            <i
              aria-hidden="true"
              className="office-handoff"
              key={handoff.id}
              onAnimationEnd={() => setHandoff((current) => current?.id === handoff.id ? null : current)}
              style={{
                ...pointStyle(handoff.from),
                "--handoff-to-x": `${((handoff.to.col + 0.5) / OFFICE_COLS) * 100}%`,
                "--handoff-to-y": `${((handoff.to.row + 0.5) / OFFICE_ROWS) * 100}%`,
              } as WorldStyle}
            />
          ) : null}
          </div>
          {/*
           * 전체 화면 연출은 바깥 UI 를 걷어 낸다. 카메라 조작은 무대 위에 얹혀 있어야 그때도 손에 남는다.
           * 편집기를 열 때만 감춘다 — 안 그러면 가구 놓는 클릭과 겹친다.
           */}
          {editorOpen ? null : (
            <div className="office-camera-controls" role="group" aria-label={t(locale, "office.cameraGroup")}>
              <button
                type="button"
                className="office-camera-toggle"
                aria-pressed={cameraView === "full"}
                onClick={() => {
                  setCameraView("full");
                  setCameraPan({ x: 0, y: 0, workspaceId: activeWorkspaceId });
                }}
              >
                {t(locale, "office.cameraFull")}
              </button>
              <button
                type="button"
                className="office-camera-toggle"
                aria-pressed={cameraView === "close"}
                onClick={() => {
                  setCameraView("close");
                  setCameraPan({ x: 0, y: 0, workspaceId: activeWorkspaceId });
                }}
              >
                {t(locale, "office.cameraClose")}
              </button>
              <button
                type="button"
                className="office-camera-toggle"
                aria-pressed={follow}
                disabled={!cameraClose}
                title={cameraClose ? undefined : t(locale, "office.cameraFollowHint")}
                onClick={() => setFollow((on) => !on)}
              >
                {t(locale, "office.cameraFollow")}
              </button>
            </div>
          )}
          {
            // 같은 안내가 무대의 aria-label(office.stageClose)에 이미 들어 있어 보조기술에는 중복이다.
            canPan ? <p className="office-drag-hint" aria-hidden="true">{t(locale, "office.dragHint")}</p> : null
          }
          {reducedMotion ? <p className="office-motion-note" role="status">{t(locale, "office.reducedMotion")}</p> : null}
        </div>

        <section className="office-lobby" aria-label={t(locale, "office.lobby")}>
          <div className="lobby-reception">
            <strong>RECEPTION</strong>
            <span>{t(locale, "office.reception")}</span>
          </div>
          <div className="lobby-entrance">
            <strong>{layout.officeName}</strong>
            <span>MAIN ENTRANCE</span>
          </div>
          <div className="lobby-elevators">
            <strong>ELEVATOR</strong>
            <i aria-hidden="true" />
            <i aria-hidden="true" />
          </div>
        </section>

        {editorOpen ? (
          <aside className="office-editor" id="office-editor" aria-labelledby="office-editor-title">
            <div className="office-editor-heading">
              <div>
                <p>{t(locale, "editor.kicker")}</p>
                <h3 id="office-editor-title">{t(locale, "editor.title")}</h3>
              </div>
              {/*
               * 놓는 중인 가구를 함께 끄지 않으면 무대가 "가구를 놓을 위치를 선택하세요"를 계속 읽어 준다.
               */}
              <button
                type="button"
                onClick={() => { setEditorOpen(false); setPlacingType(null); }}
                aria-label={t(locale, "editor.close")}
              >×</button>
            </div>

            <fieldset className="office-editor-section" disabled={saving}>
              <legend>{t(locale, "editor.themeLegend")}</legend>
              <div className="office-theme-options">
                {(Object.keys(OFFICE_THEMES) as OfficeTheme[]).map((key) => (
                  <button
                    type="button"
                    key={key}
                    className={layout.theme === key ? "selected" : ""}
                    aria-pressed={layout.theme === key}
                    style={{ "--theme-swatch": OFFICE_THEMES[key].accent } as WorldStyle}
                    onClick={() => commitLayout({ ...layout, theme: key })}
                  >
                    {localized(OFFICE_THEMES[key].label, locale)}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="office-editor-section office-headcount" disabled={saving}>
              <legend>{t(locale, "editor.headcountLegend")}</legend>
              <label htmlFor="office-headcount">
                {t(locale, "editor.headcountLabel")}
                <output htmlFor="office-headcount">{t(locale, "editor.headcountValue", { count: layout.headcount })}</output>
              </label>
              <input
                id="office-headcount"
                type="range"
                min={OFFICE_HEADCOUNT_MIN}
                max={OFFICE_HEADCOUNT_MAX}
                step={1}
                value={layout.headcount}
                aria-valuetext={t(locale, "editor.headcountValue", { count: layout.headcount })}
                onChange={(event) => commitLayout({ ...layout, headcount: Number(event.currentTarget.value) })}
              />
              <p>{t(locale, "editor.headcountNote")}</p>
            </fieldset>

            <fieldset className="office-editor-section" disabled={saving}>
              <legend>{t(locale, "editor.catalogLegend")}</legend>
              <p>{t(locale, "editor.catalogNote")}</p>
              <div className="office-furniture-catalog">
                {FURNITURE_CATALOG.map((item) => (
                  <button
                    type="button"
                    key={item.type}
                    className={placingType === item.type ? "selected" : ""}
                    aria-pressed={placingType === item.type}
                    onClick={() => {
                      setPlacingType((current) => current === item.type ? null : item.type);
                      setSelectedUid(null);
                    }}
                  >
                    <i aria-hidden="true" style={{ backgroundImage: `url("${item.asset}")` }} />
                    <span>{localized(item.label, locale)}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            {selected ? (
              <fieldset className="office-editor-section" disabled={saving}>
                <legend>{t(locale, "editor.selectedLegend")}</legend>
                <div className="office-editor-controls" aria-label={t(locale, "editor.moveGroup")}>
                  <button type="button" onClick={() => updateSelected({ row: selected.row - 1 })} aria-label={t(locale, "editor.moveUp")}>↑</button>
                  <button type="button" onClick={() => updateSelected({ col: selected.col - 1 })} aria-label={t(locale, "editor.moveLeft")}>←</button>
                  <button type="button" onClick={() => updateSelected({ row: selected.row + 1 })} aria-label={t(locale, "editor.moveDown")}>↓</button>
                  <button type="button" onClick={() => updateSelected({ col: selected.col + 1 })} aria-label={t(locale, "editor.moveRight")}>→</button>
                  {FURNITURE_CATALOG.find(({ type }) => type === selected.type)?.rotatable ? (
                    <button
                      type="button"
                      onClick={() => updateSelected({ rotation: ((selected.rotation + 90) % 360) as FurnitureRotation })}
                    >
                      {t(locale, "editor.rotate")}
                    </button>
                  ) : null}
                </div>
                <div className="office-hue-options" aria-label={t(locale, "editor.hueGroup")}>
                  {HUES.map(({ value, label }) => (
                    <button
                      type="button"
                      key={value}
                      className={selected.hue === value ? "selected" : ""}
                      aria-label={t(locale, label)}
                      aria-pressed={selected.hue === value}
                      style={{ "--furniture-hue": `${value}deg`, "--hue": `${value}deg` } as WorldStyle}
                      onClick={() => updateSelected({ hue: value })}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="office-delete-furniture"
                  onClick={() => {
                    commitLayout({ ...layout, furniture: layout.furniture.filter(({ uid }) => uid !== selected.uid) });
                    setSelectedUid(null);
                  }}
                >
                  {t(locale, "editor.delete")}
                </button>
              </fieldset>
            ) : null}

            <div className="office-editor-footer">
              <div>
                <button type="button" disabled={!history.past.length || saving} onClick={undo}>{t(locale, "editor.undo")}</button>
                <button type="button" disabled={!history.future.length || saving} onClick={redo}>{t(locale, "editor.redo")}</button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    commitLayout(DEFAULT_OFFICE_LAYOUT);
                    setSelectedUid(null);
                    setPlacingType(null);
                  }}
                >
                  {t(locale, "editor.reset")}
                </button>
              </div>
              <button type="button" className="office-save-layout" disabled={saving} onClick={() => void saveLayout()}>
                {t(locale, saving ? "editor.savingShort" : "editor.save")}
              </button>
            </div>
            <p className="office-save-status" role="status" aria-live="polite">{t(locale, saveState)}</p>
          </aside>
        ) : null}
      </div>
    </section>
  );
}

export default OfficeWorld;
