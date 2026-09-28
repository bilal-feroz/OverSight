/**
 * SYNTHETIC gaze trajectories and card layouts for tests.
 *
 * Scripted stand-ins for a reviewer's eyes, used to drive the real
 * ReviewSession + AttentionEngine + InterventionEngine in Node. Everything is
 * deterministic (seeded PRNG). Nothing here is a measurement: these streams
 * exercise the pipeline and must never be presented as accuracy results.
 */
import type { ApprovalRequest, ContentBlock, RiskLevel } from "@/types/approval";
import type { ApprovalRecord, Baseline, RectLike, RegionMeta, RegionRole } from "@/types/attention";
import type { EyeFeatures, GazeFrame } from "@/types/cv";
import type { SemanticAnalysis } from "@/types/semantic";
import { getScenario } from "@/data/scenarios";
import { DEFAULT_BASELINE } from "@/lib/attention/baseline";
import { evaluateApproval, type Evaluation } from "@/lib/attention/evaluate";
import type { GeometrySource, RegionGeometry } from "@/lib/attention/geometry";
import { buildReviewTargets, expectedWordsFor } from "@/lib/attention/targets";
import { ReviewSession, type GazeSignalOptions } from "@/lib/attention/tracker";
import { CV_CONFIG } from "@/lib/cv/config";
import { OneEuroFilter2D } from "@/lib/cv/one-euro";
import { analyzeWithRules } from "@/lib/semantic/rules";
import { wordCount } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/** mulberry32: small, fast, deterministic. */
export function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rand: () => number): number {
  const u = Math.max(1e-12, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------------------
// Card layout
// ---------------------------------------------------------------------------

export interface Pt {
  x: number;
  y: number;
}

export interface SimLayout {
  viewport: { width: number; height: number };
  /** Viewport intersected with the scroll container. */
  clip: RectLike;
  /** Null while no card is mounted (the PAUSE view replaces it). */
  card: RectLike | null;
  regions: RegionGeometry[];
  /** Decision buttons (data-gaze-anchor). */
  controls: RectLike[];
}

export const center = (r: RectLike): Pt => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

export interface CardLayoutOptions {
  viewport?: { width: number; height: number };
  /** Content scrolled up by this many px (positive = scrolled down). */
  scrollY?: number;
  /** Severity per target id (defaults to the analysis severity). */
  severity?: Record<string, RiskLevel>;
}

/**
 * Lays a request out like the real approval card at a 1440 x 900 viewport
 * (queue on the left, intelligence panel on the right): decision buttons in the
 * card header top-right, title and summary near the top, then reasoning,
 * resources/changes, and the consequence list, whose first critical line sits
 * roughly 250-400 px below the title.
 */
export function cardLayout(
  request: ApprovalRequest,
  analysis: SemanticAnalysis,
  opts: CardLayoutOptions = {},
): SimLayout {
  const viewport = opts.viewport ?? { width: 1440, height: 900 };
  const dy = -(opts.scrollY ?? 0);
  const targets = new Map(analysis.criticalRegions.map((r) => [r.fieldId, r.severity]));
  const clip: RectLike = { left: 290, top: 56, width: 790, height: Math.max(0, viewport.height - 56) };
  const card: RectLike = { left: 314, top: 80 + dy, width: 742, height: 0 };
  const inner = { left: 338, width: 694 };
  const regions: RegionGeometry[] = [];
  const add = (id: string, role: RegionRole, label: string, text: string, rect: RectLike) => {
    const isTarget = targets.has(id);
    const meta: RegionMeta = {
      id,
      role: isTarget ? "target" : role,
      label,
      words: wordCount(text),
      severity: isTarget ? (opts.severity?.[id] ?? targets.get(id)) : undefined,
      scope: request.id,
    };
    regions.push({ meta, rect });
  };
  const lines = (text: string, charsPerLine: number) => Math.max(1, Math.ceil(text.length / charsPerLine));

  let y = card.top + 61 + 20 + 22 + 12; // card header, padding, badges row, title margin
  add("title", "context", "Title", request.title, { left: inner.left, top: y, width: inner.width, height: 30 });
  y += 30;
  const summaryH = 8 + 24 * lines(request.summary, 88);
  add("summary", "context", "Summary", request.summary, { left: inner.left, top: y, width: inner.width, height: summaryH });
  y += summaryH + 16;

  const blocks = (kind: ContentBlock["kind"]) => request.blocks.filter((b) => b.kind === kind);
  const reasoning = blocks("reasoning");
  if (reasoning.length) {
    y += 16 + 26; // section padding + eyebrow
    for (const b of reasoning) {
      const h = 22 * lines(b.text, 95);
      add(b.id, "content", "Agent reasoning", b.text, { left: inner.left, top: y, width: inner.width, height: h });
      y += h;
    }
    y += 16;
  }

  const resources = blocks("resource");
  const changes = blocks("change");
  if (resources.length || changes.length) {
    const top = y + 16 + 26;
    let rx = inner.left;
    let ry = top;
    for (const b of resources) {
      const w = Math.min(300, 16 + b.text.length * 7.2);
      if (rx + w > inner.left + 300) {
        rx = inner.left;
        ry += 32;
      }
      add(b.id, "content", "Affected resource", b.text, { left: rx, top: ry, width: w, height: 26 });
      rx += w + 6;
    }
    let cy = top;
    for (const b of changes) {
      add(b.id, "content", "Change", b.text, { left: inner.left + 346, top: cy, width: 348, height: 34 });
      cy += 34;
    }
    y = Math.max(ry + 26, cy) + 16;
  }

  const consequences = request.blocks.filter((b) => b.kind === "consequence" || b.kind === "detail");
  if (consequences.length) {
    y += 16 + 26;
    for (const b of consequences) {
      const h = 20 + 22 * lines(b.text, 84);
      add(b.id, "content", "Consequence", b.text, { left: inner.left, top: y, width: inner.width, height: h });
      y += h + 6;
    }
    y += 10;
  }
  for (const b of blocks("metadata")) {
    add(b.id, "content", "Metadata", b.text, { left: inner.left, top: y + 12, width: inner.width, height: 20 });
    y += 44;
  }
  card.height = y - card.top;

  const buttonTop = card.top + 12;
  const approve: RectLike = { left: card.left + card.width - 24 - 112, top: buttonTop, width: 112, height: 36 };
  const reject: RectLike = { left: approve.left - 8 - 70, top: buttonTop, width: 70, height: 36 };
  return { viewport, clip, card, regions, controls: [reject, approve] };
}

export function regionRect(layout: SimLayout, id: string): RectLike {
  const r = layout.regions.find((g) => g.meta.id === id);
  if (!r) throw new Error(`No region ${id} in layout`);
  return r.rect;
}

/** The isolated consequence of the PAUSE view (large, centred, alone on the page). */
export function pauseLayout(base: SimLayout, scope: string, targetId: string, severity: RiskLevel): SimLayout {
  const rect: RectLike = { left: 342, top: 250, width: 686, height: 150 };
  return {
    ...base,
    card: null,
    regions: [
      {
        meta: { id: `review:${targetId}`, role: "review-target", label: "Isolated consequence", words: 6, severity, scope },
        rect,
      },
    ],
    controls: [],
  };
}

// ---------------------------------------------------------------------------
// Scripted geometry
// ---------------------------------------------------------------------------

export class FakeGeometry implements GeometrySource {
  t = 0;
  focusedFlag = true;
  depth = 1;

  constructor(public layout: SimLayout) {}

  viewport() {
    return this.layout.viewport;
  }
  clipRect() {
    return this.layout.clip;
  }
  cardRect() {
    return this.layout.card;
  }
  regions(scope: string) {
    return this.layout.regions.filter((r) => r.meta.scope === scope);
  }
  controlRects() {
    return this.layout.controls;
  }
  scrollDepth() {
    return this.depth;
  }
  focused() {
    return this.focusedFlag;
  }
  now() {
    return this.t;
  }
}

// ---------------------------------------------------------------------------
// Trajectories
// ---------------------------------------------------------------------------

export type Segment =
  /** Hold the eyes on one point. */
  | { kind: "dwell"; at: Pt; ms: number }
  /** Minimum-jerk eye movement to a point (default 60 ms, a saccade). */
  | { kind: "move"; to: Pt; ms?: number }
  /** Read a line left to right: `fixations` evenly spaced fixations with quick saccades between. */
  | { kind: "read"; line: RectLike; ms: number; fixations?: number }
  /** Eyes off the screen. */
  | { kind: "offscreen"; ms: number; at?: Pt }
  /** No face in the camera. */
  | { kind: "faceLost"; ms: number }
  /** Eyes closed. */
  | { kind: "blink"; ms: number };

export interface TrajectoryOptions {
  viewport: { width: number; height: number };
  /** Camera frame rate. */
  fps?: number;
  /** Gaussian noise per axis on every estimate, CSS px (1 sigma). */
  noisePx?: number;
  /** Constant offset of the estimate, CSS px. */
  biasPx?: Pt;
  /** Run the estimate through the production One Euro filter (adds realistic lag). */
  smoothing?: boolean;
  seed?: number;
  /** Where the eyes are before the first segment. */
  start?: Pt;
  /** Timestamp of the first frame, ms. */
  startT?: number;
  /** Head pose and other feature fields over time (for trust tests). */
  pose?: (t: number) => Partial<EyeFeatures>;
  /** Faces in view while the face is present (2 = a second person). */
  faces?: number;
}

const NEUTRAL_FEATURES: EyeFeatures = {
  irisH: 0.5,
  irisV: 0,
  openness: 0.3,
  bsH: 0,
  bsV: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
  faceX: 0.5,
  faceY: 0.45,
  faceScale: 0.09,
  blink: false,
};

interface TruePoint {
  t: number;
  p: Pt | null;
  face: boolean;
  blink: boolean;
}

function minJerk(s: number) {
  return s * s * s * (10 - 15 * s + 6 * s * s);
}

/** True eye position at every frame time. */
function sampleTruth(segments: Segment[], opts: TrajectoryOptions): TruePoint[] {
  const dt = 1000 / (opts.fps ?? 30);
  let t = opts.startT ?? 0;
  let pos: Pt = opts.start ?? { x: opts.viewport.width / 2, y: opts.viewport.height / 2 };
  const out: TruePoint[] = [];
  const emitUntil = (end: number, at: (t: number) => Pt | null, face = true, blink = false) => {
    while (t < end - 1e-9) {
      out.push({ t, p: at(t), face, blink });
      t += dt;
    }
  };
  for (const seg of segments) {
    const begin = t;
    switch (seg.kind) {
      case "dwell": {
        pos = seg.at;
        const at = pos;
        emitUntil(begin + seg.ms, () => at);
        break;
      }
      case "move": {
        const ms = seg.ms ?? 60;
        const from = pos;
        const to = seg.to;
        emitUntil(begin + ms, (tt) => {
          const s = minJerk(Math.min(1, (tt - begin) / ms));
          return { x: from.x + (to.x - from.x) * s, y: from.y + (to.y - from.y) * s };
        });
        pos = to;
        break;
      }
      case "read": {
        const n = seg.fixations ?? Math.max(2, Math.round(seg.ms / 250));
        const y = seg.line.top + seg.line.height / 2;
        const xs = Array.from({ length: n }, (_, i) => seg.line.left + seg.line.width * (0.08 + (0.84 * i) / Math.max(1, n - 1)));
        const each = seg.ms / n;
        emitUntil(begin + seg.ms, (tt) => ({ x: xs[Math.min(n - 1, Math.floor((tt - begin) / each))], y }));
        pos = { x: xs[n - 1], y };
        break;
      }
      case "offscreen": {
        const at = seg.at ?? { x: opts.viewport.width / 2, y: opts.viewport.height + 400 };
        emitUntil(begin + seg.ms, () => at);
        pos = at;
        break;
      }
      case "faceLost":
        emitUntil(begin + seg.ms, () => null, false);
        break;
      case "blink": {
        const at = pos;
        emitUntil(begin + seg.ms, () => at, true, true);
        break;
      }
    }
  }
  return out;
}

/** Builds the GazeFrame stream the GazeHub would publish for a scripted trajectory. */
export function trajectory(segments: Segment[], opts: TrajectoryOptions): GazeFrame[] {
  const rand = rng(opts.seed ?? 1);
  const noise = opts.noisePx ?? 0;
  const bias = opts.biasPx ?? { x: 0, y: 0 };
  const { width: vw, height: vh } = opts.viewport;
  const filter = new OneEuroFilter2D(CV_CONFIG.gaze.minCutoff, CV_CONFIG.gaze.beta, CV_CONFIG.gaze.dCutoff);
  let lastGaze: { x: number; y: number } | null = null;
  let lastGazeAt = -Infinity;

  return sampleTruth(segments, opts).map(({ t, p, face, blink }) => {
    const features: EyeFeatures | null = face ? { ...NEUTRAL_FEATURES, ...opts.pose?.(t), blink } : null;
    const base = {
      t,
      source: "camera" as const,
      faceCount: face ? (opts.faces ?? 1) : 0,
      features,
      inferenceMs: 8,
    };
    if (!face || !p) {
      lastGaze = null;
      return { ...base, gaze: null, gazeRaw: null, held: false };
    }
    if (blink) {
      const held = lastGaze !== null && t - lastGazeAt <= CV_CONFIG.gaze.blinkHoldMs;
      return { ...base, gaze: held ? lastGaze : null, gazeRaw: null, held };
    }
    const raw = {
      x: (p.x + bias.x + gaussian(rand) * noise) / vw,
      y: (p.y + bias.y + gaussian(rand) * noise) / vh,
    };
    if (t - lastGazeAt > 500) filter.reset();
    const gaze = opts.smoothing ? filter.filter(raw.x, raw.y, t / 1000) : raw;
    lastGaze = gaze;
    lastGazeAt = t;
    return { ...base, gaze, gazeRaw: raw, held: false };
  });
}

/** Replays frames into a session with 60 Hz animation-frame ticks, like the ReviewController. */
export function play(session: ReviewSession, geo: FakeGeometry, frames: GazeFrame[], untilMs?: number, tickMs = 1000 / 60) {
  const end = untilMs ?? (frames.length ? frames[frames.length - 1].t : geo.t);
  let i = 0;
  for (let t = geo.t; t <= end + 1e-9; t += tickMs) {
    while (i < frames.length && frames[i].t <= t) {
      geo.t = frames[i].t;
      session.onFrame(frames[i]);
      i++;
    }
    geo.t = t;
    session.tick(t);
  }
  while (i < frames.length) {
    geo.t = frames[i].t;
    session.onFrame(frames[i]);
    i++;
  }
  geo.t = Math.max(geo.t, end);
}

// ---------------------------------------------------------------------------
// One review of a seeded scenario
// ---------------------------------------------------------------------------

export type GazeSignalInput = GazeSignalOptions;

export const GOOD_SIGNAL: GazeSignalInput = {
  gazeSource: "camera",
  calibrated: true,
  calibrationQuality: "good",
  calibrationStale: false,
  legacyCalibration: false,
  gazeSigmaPx: { x: 60, y: 60 },
};

export const CAMERA_OFF: GazeSignalInput = {
  gazeSource: "none",
  calibrated: false,
  calibrationQuality: null,
  calibrationStale: false,
  legacyCalibration: false,
  gazeSigmaPx: null,
};

export interface SimReview {
  request: ApprovalRequest;
  analysis: SemanticAnalysis;
  layout: SimLayout;
  geo: FakeGeometry;
  session: ReviewSession;
  expectedWords: number;
  /** Region ids selected as attention targets. */
  targetIds: string[];
  rect: (id: string) => RectLike;
}

export function openReview(
  scenarioId: string,
  opts: { signal?: Partial<GazeSignalInput>; baseline?: Baseline; layout?: CardLayoutOptions } = {},
): SimReview {
  const request = getScenario(scenarioId);
  if (!request) throw new Error(`Unknown scenario ${scenarioId}`);
  const analysis = analyzeWithRules(request);
  const layout = cardLayout(request, analysis, opts.layout);
  const geo = new FakeGeometry(layout);
  const session = new ReviewSession({
    approvalId: request.id,
    targets: buildReviewTargets(request, analysis, opts.baseline ?? DEFAULT_BASELINE),
    geometry: geo,
    ...GOOD_SIGNAL,
    ...opts.signal,
  });
  return {
    request,
    analysis,
    layout,
    geo,
    session,
    expectedWords: expectedWordsFor(request, analysis),
    targetIds: analysis.criticalRegions.map((r) => r.fieldId),
    rect: (id) => regionRect(layout, id),
  };
}

/** Clicks Approve now: snapshot + full deterministic evaluation. */
export function approve(
  review: SimReview,
  ctx: { baseline?: Baseline; history?: readonly ApprovalRecord[]; mlProbability?: number | null } = {},
): Evaluation {
  return evaluateApproval({
    snapshot: review.session.snapshot(),
    risk: review.analysis.overallRisk,
    baseline: ctx.baseline ?? DEFAULT_BASELINE,
    history: ctx.history ?? [],
    expectedWords: review.expectedWords,
    mlProbability: ctx.mlProbability,
  });
}

/** An ApprovalRecord for the session history, as session-store's finalize() writes it. */
export function recordOf(review: SimReview, evaluation: Evaluation, dwellPerWordMs: number | null): ApprovalRecord {
  const { assessment, decision } = evaluation;
  return {
    id: `rec-${review.request.id}`,
    requestId: review.request.id,
    title: review.request.title,
    risk: review.analysis.overallRisk,
    decidedAt: 0,
    latencyMs: assessment.latencyMs,
    expectedLatencyMs: assessment.expectedLatencyMs,
    latencyRatio: assessment.latencyRatio,
    attentionScore: assessment.attentionScore,
    criticalCoverage: assessment.criticalCoverage,
    mode: assessment.mode,
    intervention: decision.level,
    sensitivity: decision.sensitivity,
    outcome: "approved",
    dwellPerWordMs,
    expectedWords: review.expectedWords,
    reasons: decision.reasons,
    features: [],
  };
}
