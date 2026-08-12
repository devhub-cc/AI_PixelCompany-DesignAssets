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
   * Presentation events for visual staging. The office floor consumes only
   * events that move people (`say`, `arrive`, and `depart`).
   */
  officeEvents?: readonly OfficeEvent[];
  /**
   * Indicates that the event provider changed. A new value brings everyone back into the office.
   * Without this signal, switching the provider back would leave the office empty.
   */
  officeSession?: number;
  /** Keeps playback speed and actual walking on the same time axis. Defaults to 1. */
  motionTimeScale?: number;
  /** Signals whether everyone who received an arrival event has walked to their actual seat. */
  onArrivalSettledChange?: (settled: boolean) => void;
  /**
   * The screen, not the disk, owns the headcount (the slider changes the floor before saving).
   * The event provider must see the same count, so report every change.
   */
  onHeadcountChange?: (headcount: number) => void;
};

type WorldStyle = CSSProperties & Record<`--${string}`, string | number>;
type Direction = "left" | "right" | "up" | "down";
type AgentMotion = {
  /** The tile currently being approached. The reference point for arrival checks and path progress. */
  point: OfficePoint;
  /** The interpolation start tile. progress fills the gap between it and point. */
  from: OfficePoint;
  /** 0 → 1. At 1, snap to point and select the next tile. */
  progress: number;
  path: OfficePoint[];
  goal: string;
  layoutKey: string;
  direction: Direction;
  moving: boolean;
  /** A subtle tile-unit offset that keeps employees on the same tile from overlapping exactly. */
  jitter: number;
  /** Arrival staging — absent from the screen until this performance.now timestamp. */
  arriveAt: number;
  /** Reconsideration time that prevents a stationary employee from finding a path every frame. */
  decideAt: number;
  /** Departing — heads for a door instead of a seat and leaves the screen upon reaching it. */
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
/** Subtle hue variations make the six sprites look like different people. Larger shifts distort skin tones. */
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
  // Amenity rooms have different seat counts, so assignments rotate among them. agentIndex alone cannot identify the room,
  // so trace it from the actual seat to keep the last few employees from sitting in the wrong direction.
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

/** DOM helper called inside rAF — leave unchanged values alone to avoid style recalculation. */
function attr(el: HTMLElement, name: string, value: string) {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/**
 * Interpolate walking every frame instead of breaking it into tile-sized steps. Previously, employees
 * teleported one tile every 200–300ms while CSS `transition: left/top` caught up, but the 0.3s transition
 * exceeded the step interval, so every transition was cut short and looked like rubber-band dragging.
 */
const WALK_TILES_PER_SEC = 3.6;
// The farthest stroll point in the default layout is 73 tiles from its seat, about 20 seconds at normal speed.
// Double only the return speed after a task starts to tighten the scene without teleporting.
const RETURN_TILES_PER_SEC = WALK_TILES_PER_SEC * 2;
/** Maximum time advanced at once, preventing simulation teleports after a long frame. */
const MAX_FRAME_SECONDS = 0.05;
/** Offset that aligns the feet of a 48×96 sprite frame with the tile center. */
const SPRITE_W = 48;
const SPRITE_H = 96;
/** Feet land at different heights when standing and sitting. These preserve the old CSS values of -80% / -67%. */
const FOOT_ANCHOR = 0.8;
const SEATED_FOOT_ANCHOR = 0.67;
/**
 * Arrival staging — interval between people emerging from a door.
 * Walking to a seat takes about six seconds, so a tighter interval causes a crowd at the door.
 */
const ARRIVAL_STAGGER_MS = 420;
/** The camera eases toward its target. Larger values catch up faster. */
const CAMERA_EASE = 0.11;
/**
 * Sprites are fixed at 48×96, while tiles can shrink to about 15px with the stage.
 * Unscaled, one person occupies 3×7 tiles and exceeds the furniture, so lock height to a tile count.
 */
const AGENT_TILES_TALL = 2.6;
const MIN_AGENT_SCALE = 0.3;
/** If a nameplate cannot grow even this large, it is unreadable — collapse it to clear the view. */
const LABEL_LEGIBLE_SCALE = 0.58;
/**
 * Nameplates for people seated through this row in the upper band overflow above the stage, so push them down
 * (`.world-agent[data-edge-seat]`). This covers every upper-band seat with row <= 5.
 * The lower band's top row is 20 with a corridor above it, so nothing can overflow there and this does not apply.
 */
const TOP_BAND_SEAT_ROW = 5;

const clamp = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value));

/**
 * A uid persists in saved data, so it must not collide across sessions. Time alone can produce two values in the
 * same millisecond, so append randomness. This lives outside the component because calling it during render is impure.
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

/** Fixed offset determined only by agentIndex — changing it every frame would be distracting. */
function jitterFor(agentIndex: number) {
  return (((agentIndex * 37) % 11) - 5) * 0.03;
}

const AGENT_BY_ID: ReadonlyMap<string, (typeof AGENTS)[number]> = new Map(
  AGENTS.map((agent) => [agent.id as string, agent]),
);

/**
 * Filter for events that move people and apply them to motion.
 * This lives outside the component because it must mutate the same data as the rAF loop.
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

/** Arrival — stage employees by a door or elevator and admit them to the world at the scheduled time. */
function sendToDoor(agent: (typeof AGENTS)[number], motion: AgentMotion, arriveAt: number) {
  const spawn = spawnPointFor(agent.agentIndex);
  motion.point = { ...spawn.point };
  motion.from = { ...spawn.point };
  motion.progress = 1;
  motion.path = [];
  motion.layoutKey = "";
  motion.goal = homeGoal(agent);
  // The main entrance is on the bottom wall, so employees enter facing up; the elevator is at the east end, so they face west toward the corridor.
  motion.direction = spawn.via === "elevator" ? "left" : "up";
  motion.moving = false;
  motion.leaving = false;
  motion.arriveAt = arriveAt;
  motion.decideAt = arriveAt;
}

/**
 * When headcount changes, return support staff to their seats. However, **do not touch anyone away from their seat** —
 * whether they are entering from a door, strolling, or returning from a stroll.
 * Reseating them at every slider step looks like a 20–50-tile teleport in one frame.
 *
 * `balanceStroll`, not this function, rebalances the strolling population. It sends people walking or back to their
 * seats based on the target, so it adapts to headcount changes without reseating them here.
 * Reset departed employees (`arriveAt` at infinity) — the arrival effect sends them back to a door.
 * Even when resetting, change **only position**. The rest of their state must be preserved for the reason below.
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
     * The only job here is to **return employees to their seats**, so overwrite position and leave everything else intact.
     * Replacing all of `homeMotion` and then restoring protected fields fails silently if even one field is missed.
     * With the current approach of choosing fields to overwrite, an omission visibly leaves an employee away from their seat.
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
  // Employee motion lives in a ref, not state. Calling setState every frame would rerender the entire editor too.
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
  // Whether the camera follows progress. Turn it off to keep one room in view.
  const [follow, setFollow] = useState(true);
  const [cameraPan, setCameraPan] = useState<{ x: number; y: number; workspaceId: string | null }>({
    x: 0,
    y: 0,
    workspaceId: null,
  });
  const [reducedMotion, setReducedMotion] = useState(false);
  // A document shown only when one space finishes and the next opens. It removes itself after the animation.
  const [handoff, setHandoff] = useState<{ from: OfficePoint; to: OfficePoint; id: number } | null>(null);
  const handoffId = useRef(0);
  const lastActiveWorkspaceId = useRef<string | null>(null);
  // Store the key, not the copy, so the latest notice changes with the language.
  const [saveState, setSaveState] = useState<MessageKey>("layout.editable");
  const [saving, setSaving] = useState(false);
  const editRevision = useRef(0);
  // The last session that brought everyone in. Distinguishes a headcount change from a new day.
  const arrivedSession = useRef<number | null>(null);
  const arrivedHeadcount = useRef(0);
  const roamTarget = useRef(strollTargetForHeadcount(DEFAULT_OFFICE_LAYOUT.headcount));
  const roamChangeAt = useRef(0);
  const walkCursor = useRef(0);
  // Camera motion is read every frame, so the state must also be kept in a ref.
  const panOffset = useRef({ x: 0, y: 0 });
  // The event batch already applied. Ignore the same array if it arrives again.
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
      // Scheduled arrivals must also recalculate their remaining intervals at the new speed so the button takes effect immediately.
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
  // This single value owns the actual work semantics. While awaiting approval, visuals, motion, and accessibility all indicate not working.
  const workingWorkspaceId = workflowStatus === "running" ? activeWorkspaceId : null;
  const taskFocus = workingWorkspaceId !== null;
  const activeZone = WORKSPACE_ZONES.find(({ id }) => id === activeWorkspaceId);
  const cameraClose = cameraView === "close" && !editorOpen;
  const cameraScale = cameraClose ? 1.65 : 1;
  /*
   * Drag room comes from scale, not view mode. At 1×, the entire floor already fits in the frame,
   * leaving nowhere to drag. If zoom increases later, this condition alone enables dragging with it.
   */
  const canPan = cameraScale > 1;
  const cameraFocus = activeZone
    ? { col: activeZone.col + activeZone.cols / 2, row: activeZone.row + activeZone.rows / 2 }
    : { col: OFFICE_COLS / 2, row: OFFICE_ROWS / 2 };
  const visibleCameraPan = cameraPan.workspaceId === activeWorkspaceId ? cameraPan : { x: 0, y: 0 };
  const visibleSelectedAgentId = visibleAgents.some(({ id }) => id === selectedAgentId) ? selectedAgentId : null;

  // The camera eases toward its target in rAF, not via a CSS transition. Update only the target here.
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
    // While tracking is off, keep the current view even when progress moves elsewhere.
    if (!follow) return;
    camTarget.current.x = cameraFocus.col / OFFICE_COLS;
    camTarget.current.y = cameraFocus.row / OFFICE_ROWS;
  }, [follow, cameraClose, cameraFocus.col, cameraFocus.row, cameraScale, visibleCameraPan.x, visibleCameraPan.y]);

  // Pixel coordinates require the stage size. Measure it again only on resize.
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

  // Arrival staging — when headcount changes or the world opens, employees emerge one by one from the door and elevator.
  useEffect(() => {
    if (!ready || reducedMotion) return;
    const start = performance.now();
    const motions = motionsRef.current;
    // A session change starts a new day, so everyone arrives again.
    const newDay = arrivedSession.current !== officeSession;
    arrivedSession.current = officeSession;
    // The headcount previously on screen. Employees added by an increase come after this count.
    const known = arrivedHeadcount.current;
    arrivedHeadcount.current = layout.headcount;
    let order = 0;
    for (const agent of AGENTS.slice(0, layout.headcount)) {
      const motion = motions[agent.id];
      /*
       * When only headcount increases, do not recall people already inside — otherwise everyone reentered at each slider step.
       * New employees, however, have arriveAt set to 0 because the path that resets off-screen employees to homeMotion
       * runs every frame. Without the headcount check, they pop into their seats without passing through a door.
       */
      if (!newDay && agent.agentIndex < known && motion.arriveAt <= start) continue;
      sendToDoor(agent, motion, start + (order * ARRIVAL_STAGGER_MS) / motionTimeScaleRef.current);
      order += 1;
    }
    // Run arrivals again when headcount or the event provider changes. Layout editing does not trigger this.
  }, [layout.headcount, officeSession, ready, reducedMotion]);

  // The slider changes the floor without saving. Notify immediately so the event provider sees the same count.
  useEffect(() => {
    onHeadcountChange?.(layout.headcount);
  }, [layout.headcount, onHeadcountChange]);

  // Consume only presentation events that move people here. The panel reads the rest.
  useEffect(() => {
    /*
     * Do not consume the same batch twice. The array remains unchanged on ticks without events, so if the effect reruns
     * merely because the language changed or motion was reenabled, the entire last batch replays — everyone seated
     * teleports to the entrance and arrives again.
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
    // The rAF loop compares against performance.now(), so use the same time axis.
    roamChangeAt.current = performance.now() + 20_000 + Math.random() * 20_000;
  }, [layout.headcount]);

  useEffect(() => {
    const previousId = lastActiveWorkspaceId.current;
    // After one space finishes, the active space is briefly empty before the next opens; overwriting with empty loses the pair.
    if (activeWorkspaceId) lastActiveWorkspaceId.current = activeWorkspaceId;
    if (reducedMotion || !previousId || !activeWorkspaceId || previousId === activeWorkspaceId) return;
    // Hand off only when the previous space actually completed. An interruption or failure leaves nothing to hand off.
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

    /** Adjust the strolling population to its target, sending employees out or back. */
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
     * When an oncoming person blocks the path, step back one tile into an empty adjacent tile, usually the previous one.
     * Each employee has a different reconsideration interval—220ms plus an agent-index-based offset—so two do not target the same tile simultaneously.
     */
    const stepAside = (from: OfficePoint, occupied: Set<string>): OfficePoint | null => {
      for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const next = { col: from.col + dc, row: from.row + dr };
        if (occupied.has(`${next.col},${next.row}`) || !isOfficeWalkable(next, layout)) continue;
        return next;
      }
      return null;
    };

    /** An employee who finishes one tile chooses the next. If no path exists, they stay there. */
    const decide = (agent: (typeof AGENTS)[number], motion: AgentMotion, now: number, occupied: Set<string>) => {
      occupied.delete(`${motion.point.col},${motion.point.row}`);
      const working = agent.primary && workingWorkspaceId === agent.workspaceId;
      // While departing, ignore seats and strolls and head only for a door.
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

      /** Stand still and wait until the next reconsideration — otherwise pathfinding runs every frame. */
      const settle = () => {
        motion.path = [];
        motion.layoutKey = pathLayoutKey;
        motion.moving = false;
        motion.decideAt = now + 220 + ((agent.agentIndex * 53) % 160);
        occupied.add(`${motion.point.col},${motion.point.row}`);
      };

      if (samePoint(motion.point, target)) {
        if (motion.leaving) {
          // Reached the door — done for today. The next arrival event brings them back.
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
      // With an empty path, `path[0]` is undefined and `stepAside` returns null. Both mean "no next tile",
      // so the type must be nullable to match what the `if (!point)` below actually does.
      let point: OfficePoint | null = path[0] ?? null;
      if (point && occupied.has(`${point.col},${point.row}`)) {
        path = findOfficePath(motion.point, target, layout, occupied);
        point = path[0] ?? null;
      }
      if (!point && findOfficePath(motion.point, target, layout).length) {
        // A path exists, but people block it. If nobody steps back, a one-tile corridor deadlocks permanently.
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
         * People outside a door do not occupy the floor.
         * A departed employee's point remains on the door tile after leaving the screen. Counting them as occupying it
         * blocks that tile forever, so everyone following cannot find a path and gets trapped at the entrance.
         * With only two door tiles, exactly two employees depart at any headcount while the rest block the sole route.
         */
        if (now < motion.arriveAt) continue;
        occupied.add(`${motion.point.col},${motion.point.row}`);
      }

      for (const agent of visible) {
        const motion = motions[agent.id];
        // Before entering through a door, treat the employee as outside the world.
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
      // Keep reporting physical arrival completion even if another tab hides the stage at 0×0 on a small screen.
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
      // For users who prefer reduced motion, snap into place without easing.
      const ease = reducedMotion ? 1 : CAMERA_EASE;
      view.x += (target.x - view.x) * ease;
      view.y += (target.y - view.y) * ease;
      view.scale += (target.scale - view.scale) * ease;
      // Fit employee height to the tiles. It must shrink with a narrower stage to preserve proportions with furniture.
      const agentScale = Math.min(1, Math.max(MIN_AGENT_SCALE, (tileH * AGENT_TILES_TALL) / SPRITE_H));
      const camNode = cameraEl.current;
      if (camNode) {
        // Pan only by the zoomed amount. Going farther moves the floor outside the frame and exposes an empty stage.
        const limitX = Math.max(0, ((view.scale - 1) / 2) * width);
        const limitY = Math.max(0, ((view.scale - 1) / 2) * height);
        const offsetX = clamp((0.5 - view.x) * view.scale * width + panOffset.current.x, limitX);
        const offsetY = clamp((0.5 - view.y) * view.scale * height + panOffset.current.y, limitY);
        camNode.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${view.scale})`;
        // Nameplates and speech bubbles become unreadable if they shrink with people. Counteract the shrinkage.
        camNode.style.setProperty("--label-counter", (1 / agentScale).toFixed(3));
        // This must be a data attribute, not a class — React overwrites the entire className when rerendering.
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
         * With transform-origin at center bottom, scaling does not change the foot coordinates.
         * Therefore subtract the box dimensions (SPRITE_W/H) at their original size and scale only the extra space
         * that positions the sprite below the tile. This space corresponds to the old CSS values of -80% / -67%.
         */
        const overhang = (1 - (seated ? SEATED_FOOT_ANCHOR : FOOT_ANCHOR)) * SPRITE_H * scale;
        const transform =
          `translate3d(${col * tileW - SPRITE_W / 2}px, ${row * tileH - SPRITE_H + overhang}px, 0) scale(${scale})`;
        // Rewriting the same value makes the browser recalculate styles. Most employees are stationary.
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

    // With reduced motion enabled, do not walk — render employees seated in place.
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
     * If furniture, theme, and name are unchanged, only headcount needs rechecking. Full validation performs an O(n²)
     * furniture-overlap check and BFS across 45 seats, freezing the screen for 40–50ms at every step when dragging the slider from 5→35.
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
   * Tiles currently occupied by employees. While walking, they are between the tile they left and the tile they enter, so count both.
   * Employees keep walking while the editor is open; ignoring this would allow furniture to be placed on people.
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
    // Accumulating values that never reach the screen creates a dead segment when direction reverses.
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
    // The demo has no host storage, so it always remains in web-preview state.
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
              // rAF writes moment-to-moment walking to data-activity. Accessible copy must describe the assigned work
              // so screen readers do not announce every step again.
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
                    // Sitting direction is fixed per seat, so it need not be recalculated every frame.
                    "--seat-asset": `url("${seatAsset(homeDirection(agent))}")`,
                    // With only six sprites, the same face appears six times at a headcount of 35.
                    // Shift hues only enough to preserve skin tones, producing 6 types × 6 levels.
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
            * Full-screen staging removes the surrounding UI. Camera controls must overlay the stage to remain available in that mode.
            * Hide them only while the editor is open — otherwise they conflict with furniture-placement clicks.
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
            // The same guidance is already in the stage's aria-label (office.stageClose), so it is redundant for assistive technology.
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
                * Unless active furniture placement is also disabled, the stage keeps announcing "Select a location for the furniture."
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
