/**
 * AttentionEngine (layer 1, deterministic).
 *
 * Turns a ReviewSnapshot (derived gaze + interaction measurements for one
 * approval) into an explainable attention-evidence score. It answers:
 * "Is there evidence that the decision-critical information was visually
 * inspected before approval?" It does not, and cannot, measure whether the
 * reviewer understood it.
 */
import type { RiskLevel } from "@/types/approval";
import { RISK_ORDER } from "@/types/approval";
import type {
  AttentionAssessment,
  Baseline,
  ComponentKey,
  Reason,
  ReviewSnapshot,
  ScoreComponent,
} from "@/types/attention";
import { clamp01, smoothstep } from "@/lib/utils";
import { ATTENTION_CONFIG } from "./config";
import { expectedLatencyMs } from "./baseline";
import { assessPattern, type PatternPoint } from "./pattern";
import { evidenceStrength, severityWeight } from "./regions";
import { assessGazeTrust, gazeUsable } from "./trust";

export interface AssessmentContext {
  risk: RiskLevel;
  baseline: Baseline;
  /** Earlier decisions in this session, oldest first. */
  history: readonly PatternPoint[];
  /** Decision-relevant words: title + summary + targets. */
  expectedWords: number;
}

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  coverage: "Critical-region gaze coverage",
  reading: "Reading evidence on critical text",
  latency: "Review time vs. baseline",
  visibility: "Critical content on screen",
  presence: "Face present, oriented to screen",
  pattern: "Recent approval pattern",
  interaction: "Interaction with critical content",
};

export interface SignalQuality {
  reliable: boolean;
  simulated: boolean;
  faceRatio: number;
  multiRatio: number;
  facingRatio: number;
  gazeRatio: number;
  notes: Reason[];
}

export function assessSignal(snapshot: ReviewSnapshot): SignalQuality {
  const cfg = ATTENTION_CONFIG.signal;
  const f = snapshot.frames;
  const faceRatio = f.total ? f.face / f.total : 0;
  const multiRatio = f.total ? f.multiFace / f.total : 0;
  const facingRatio = f.face ? f.facing / f.face : 0;
  const gazeRatio = f.total ? f.gaze / f.total : 0;
  const simulated = snapshot.gazeSource === "simulated";
  const notes: Reason[] = [];

  if (snapshot.gazeSource === "none") {
    notes.push({
      code: "camera-off",
      text: "Camera attention signals unavailable; using interaction timing only.",
      tone: "info",
    });
    return { reliable: false, simulated, faceRatio, multiRatio, facingRatio, gazeRatio, notes };
  }
  if (!snapshot.calibrated) {
    notes.push({
      code: "not-calibrated",
      text: "Gaze is not calibrated; using interaction timing only.",
      tone: "info",
    });
    return { reliable: false, simulated, faceRatio, multiRatio, facingRatio, gazeRatio, notes };
  }
  if (f.total < cfg.minFrames) {
    notes.push({
      code: "few-frames",
      text: "Too few camera frames during this review; gaze evidence not used.",
      tone: "info",
    });
    return { reliable: false, simulated, faceRatio, multiRatio, facingRatio, gazeRatio, notes };
  }
  if (multiRatio > cfg.maxMultiFaceRatio) {
    notes.push({
      code: "multi-face",
      text: "Multiple faces detected; gaze evidence marked unreliable.",
      tone: "warning",
    });
    return { reliable: false, simulated, faceRatio, multiRatio, facingRatio, gazeRatio, notes };
  }
  if (faceRatio < cfg.minFaceRatio) {
    notes.push({
      code: "face-lost",
      text: `Face not detected for ${Math.round((1 - faceRatio) * 100)}% of the review; gaze evidence not used.`,
      tone: "info",
    });
    return { reliable: false, simulated, faceRatio, multiRatio, facingRatio, gazeRatio, notes };
  }
  if (gazeRatio < cfg.minGazeRatio) {
    notes.push({
      code: "gaze-sparse",
      text: "Gaze estimate unavailable for most of the review; gaze evidence not used.",
      tone: "info",
    });
    return { reliable: false, simulated, faceRatio, multiRatio, facingRatio, gazeRatio, notes };
  }
  if (simulated) {
    notes.push({
      code: "simulated",
      text: "Simulated gaze (pointer position) in use; not camera evidence.",
      tone: "warning",
    });
  }
  return { reliable: true, simulated, faceRatio, multiRatio, facingRatio, gazeRatio, notes };
}

interface Part {
  key: ComponentKey;
  value: number;
  available: boolean;
}

function combine(parts: Part[], weights: Partial<Record<ComponentKey, number>>) {
  const total = parts.reduce((acc, p) => acc + (p.available ? (weights[p.key] ?? 0) : 0), 0) || 1;
  const components: ScoreComponent[] = parts.map((p) => ({
    key: p.key,
    label: COMPONENT_LABELS[p.key],
    value: clamp01(p.value),
    weight: p.available ? (weights[p.key] ?? 0) / total : 0,
    available: p.available,
  }));
  const score = components.reduce((acc, c) => acc + c.weight * c.value, 0);
  return { score: clamp01(score), components };
}

function weightedMean<T>(items: T[], weight: (t: T) => number, value: (t: T) => number): number {
  let wSum = 0;
  let vSum = 0;
  for (const item of items) {
    const w = weight(item);
    wSum += w;
    vSum += w * value(item);
  }
  return wSum > 0 ? vSum / wSum : 0;
}

const pct = (v: number) => `${Math.round(clamp01(v) * 100)}%`;

export function assessAttention(snapshot: ReviewSnapshot, ctx: AssessmentContext): AttentionAssessment {
  const cfg = ATTENTION_CONFIG;
  const signal = assessSignal(snapshot);
  // Gaze is used only as far as it can be trusted for this review (lib/attention/trust.ts).
  const trust = assessGazeTrust(snapshot, signal);
  const useGaze = gazeUsable(trust);
  const critical = RISK_ORDER[ctx.risk] >= RISK_ORDER.HIGH;
  const noun = critical ? "Critical consequence" : "Key detail";

  // --- Latency against the personal (or default) baseline -----------------
  const latencyMs = snapshot.elapsedMs;
  const expectedMs = expectedLatencyMs(ctx.expectedWords, ctx.baseline);
  const latencyRatio = latencyMs / expectedMs;
  const latencyScore = smoothstep(cfg.latency.scoreLow, cfg.latency.scoreHigh, latencyRatio);

  // --- Targets ----------------------------------------------------------------
  const targets = snapshot.targets.map((t) => {
    const visible = t.visibleMs >= cfg.targets.minVisibleForGazeMs;
    const conclusive = t.conclusive !== false;
    const coverage = clamp01(t.dwellMs / Math.max(1, t.requiredDwellMs));
    return {
      stats: t,
      weight: severityWeight(t.severity),
      visible,
      conclusive,
      coverage,
      strength: evidenceStrength({ visible, conclusive, coverage, fixations: t.fixations }),
    };
  });
  const visibleTargets = targets.filter((t) => t.visible);
  const targetsNeverVisible = targets.length - visibleTargets.length;
  // Gaze is only judged on targets that were on screen and that gaze can tell
  // apart from the title, summary and buttons at the measured error. Time off
  // screen is never counted against the user, and neither is ambiguity.
  const judged = visibleTargets.filter((t) => t.conclusive);
  const inconclusive = visibleTargets.filter((t) => !t.conclusive);

  const gazeApplicable = useGaze && judged.length > 0;
  const criticalCoverage = gazeApplicable ? weightedMean(judged, (t) => t.weight, (t) => t.coverage) : null;
  // A left-to-right sweep is only evidence when horizontal error is small against the line.
  const readable = judged.filter((t) => t.stats.sweepAvailable !== false);
  const readingAvailable = gazeApplicable && readable.length > 0;
  const reading = readingAvailable
    ? weightedMean(
        readable,
        (t) => t.weight,
        (t) =>
          0.5 * t.stats.sweep +
          0.5 * Math.min(1, t.stats.fixations / Math.max(1, Math.ceil(t.stats.words / 8))),
      )
    : 0;
  const visibility = targets.length
    ? weightedMean(
        targets,
        (t) => t.weight,
        (t) => Math.min(1, t.stats.visibleMs / Math.max(800, t.stats.requiredDwellMs * 1.5)),
      )
    : 1;
  const presence = useGaze ? signal.faceRatio * signal.facingRatio : 0;
  const hovered = snapshot.targets.some((t) => t.hoverMs >= 300);

  const patternBefore = assessPattern(ctx.history);
  const patternScore = 1 - patternBefore.fatigueScore;

  const behavioralParts: Part[] = [
    { key: "latency", value: latencyScore, available: true },
    { key: "visibility", value: visibility, available: targets.length > 0 },
    { key: "interaction", value: hovered ? 1 : 0.5, available: targets.length > 0 },
    { key: "pattern", value: patternScore, available: true },
  ];
  const gazeParts: Part[] = [
    { key: "coverage", value: criticalCoverage ?? 0, available: criticalCoverage !== null },
    { key: "reading", value: reading, available: readingAvailable },
    { key: "latency", value: latencyScore, available: true },
    { key: "visibility", value: visibility, available: targets.length > 0 },
    { key: "presence", value: presence, available: true },
    { key: "pattern", value: patternScore, available: true },
  ];
  // Interaction evidence only. It is the decision's floor whenever gaze trust is below high.
  const behavioral = combine(behavioralParts, cfg.weights.behavioral);
  const { score, components } = useGaze ? combine(gazeParts, cfg.weights.gaze) : behavioral;
  // The same evidence without the pattern component: what the pattern, baseline and ML consume.
  const withoutPattern = (parts: Part[]) => parts.filter((p) => p.key !== "pattern");
  const thoroughness = useGaze
    ? combine(withoutPattern(gazeParts), cfg.weights.gaze).score
    : combine(withoutPattern(behavioralParts), cfg.weights.behavioral).score;

  // --- Behavioral anomaly ---------------------------------------------------
  const currentRapid = latencyRatio < cfg.latency.rapidRatio;
  const streak = currentRapid ? patternBefore.rapidStreak + 1 : 0;
  const anomaly = clamp01(
    0.55 * clamp01((0.6 - latencyRatio) / 0.5) +
      0.3 * Math.min(1, streak / 3) +
      0.15 * clamp01(-patternBefore.latencyTrend / 0.25),
  );

  // --- Evidence reliability -------------------------------------------------
  const confidenceValue = useGaze ? trust.confidence : cfg.signal.behavioralConfidence;
  const confidence = !useGaze ? "low" : trust.level === "high" ? "high" : "medium";

  // --- Reasons ----------------------------------------------------------------
  const reasons: Reason[] = [];
  const targetsMissed = gazeApplicable ? judged.filter((t) => t.coverage < cfg.targets.missedCoverage).length : 0;

  if (targets.length > 0 && targetsNeverVisible === targets.length) {
    reasons.push({
      code: "never-visible",
      text: `${noun} was never on screen during this review.`,
      tone: critical ? "critical" : "warning",
    });
  } else if (targetsNeverVisible > 0) {
    reasons.push({
      code: "partly-visible",
      text: `${targetsNeverVisible} decision-critical region${targetsNeverVisible > 1 ? "s were" : " was"} never on screen.`,
      tone: "warning",
    });
  }

  if (criticalCoverage !== null) {
    if (criticalCoverage < 0.15) {
      reasons.push({
        code: "coverage-none",
        text: `${noun} received almost no visual attention (${pct(criticalCoverage)} of expected review).`,
        tone: critical ? "critical" : "warning",
      });
    } else if (criticalCoverage < 0.6) {
      reasons.push({
        code: "coverage-low",
        text: `${noun} received limited visual attention (${pct(criticalCoverage)} of expected review).`,
        tone: "warning",
      });
    } else {
      reasons.push({
        code: "coverage-ok",
        text: `${noun} was visually inspected (${pct(criticalCoverage)} of expected review).`,
        tone: "positive",
      });
    }
    if (judged.length > 1 && targetsMissed > 0) {
      reasons.push({
        code: "targets-missed",
        text: `${targetsMissed} of ${judged.length} decision-critical regions were not observed.`,
        tone: "warning",
      });
    }
    const anyFixation = judged.some((t) => t.stats.fixations > 0);
    if (!anyFixation && criticalCoverage < 0.5) {
      reasons.push({
        code: "no-fixation",
        text: `No gaze fixation landed on the ${noun.toLowerCase()}.`,
        tone: "warning",
      });
    }
  }

  if (useGaze && inconclusive.length > 0 && judged.length > 0) {
    reasons.push({
      code: "inconclusive",
      text: `${inconclusive.length} decision-critical region${inconclusive.length > 1 ? "s sit" : " sits"} too close to the title or buttons for gaze to tell apart at the measured accuracy, so gaze did not judge ${inconclusive.length > 1 ? "them" : "it"}.`,
      tone: "info",
    });
  }

  reasons.push({
    code: "latency",
    text: `Approval attempted ${(latencyMs / 1000).toFixed(1)} s after the request opened.`,
    tone: currentRapid ? "warning" : "info",
  });
  if (latencyRatio < 0.6) {
    const below = pct(1 - latencyRatio);
    reasons.push({
      code: "latency-baseline",
      text:
        ctx.baseline.source === "personal"
          ? `Approval latency is ${below} below your baseline for a request of this length.`
          : `Approval latency is ${below} below the expected review time for a request of this length.`,
      tone: "warning",
    });
  } else if (latencyRatio >= 0.8) {
    reasons.push({
      code: "latency-ok",
      text:
        ctx.baseline.source === "personal"
          ? "Review time is consistent with your baseline."
          : "Review time is consistent with the expected review time.",
      tone: "positive",
    });
  }

  reasons.push(...signal.notes, ...trust.reasons);

  return {
    mode: useGaze ? "gaze" : "behavioral",
    attentionScore: score,
    thoroughness,
    behavioralScore: behavioral.score,
    trust,
    confidence,
    confidenceValue,
    criticalCoverage,
    targetCoverage: targets.map((t) => ({
      id: t.stats.id,
      coverage: t.coverage,
      visible: t.visible,
      conclusive: t.conclusive,
      strength: t.strength,
      separation: t.stats.separation ?? null,
    })),
    targetsMissed,
    targetsNeverVisible,
    latencyMs,
    expectedLatencyMs: expectedMs,
    latencyRatio,
    anomaly,
    components,
    reasons,
  };
}
