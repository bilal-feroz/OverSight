/**
 * Evaluation pipeline on SYNTHETIC fixtures (tests/sim/dataset-sim.ts).
 * Nothing here is a result.
 */
import { describe, expect, it } from "vitest";
import type { InterventionLevel } from "@/types/attention";
import {
  bootstrapGroups,
  brierScore,
  evaluateDataset,
  falseInterventionRate,
  missedDangerousRate,
  percentileInterval,
  prAuc,
  reliability,
  reportMarkdown,
  rocAuc,
} from "@/lib/ml/evaluate";
import { groupKFold, leaveOneGroupOut } from "@/lib/ml/logistic";
import { replayDecision } from "@/lib/ml/replay";
import { orderOnlyDataset, signalDataset, syntheticEntry } from "./sim/dataset-sim";

describe("grouped splits", () => {
  const groups = ["P01", "P01", "P02", "P03", "P02", "P03", "P01", "P04"];

  it("never puts the same participant in training and test", () => {
    const folds = leaveOneGroupOut(groups);
    expect(folds).toHaveLength(4);
    for (const f of folds) {
      const train = new Set(f.train.map((i) => groups[i]));
      const test = new Set(f.test.map((i) => groups[i]));
      expect([...test]).toEqual([f.group]);
      expect(train.has(f.group)).toBe(false);
      expect(f.train.length + f.test.length).toBe(groups.length);
    }
  });

  it("inner folds keep whole groups together too", () => {
    for (const f of groupKFold(groups, 3)) {
      const train = new Set(f.train.map((i) => groups[i]));
      for (const i of f.test) expect(train.has(groups[i])).toBe(false);
    }
  });
});

describe("leakage guard", () => {
  it("labels that depend only on counterbalanced order give a grouped AUC near 0.5", () => {
    const report = evaluateDataset(orderOnlyDataset(10), { synthetic: true, bootstrap: 50 });
    expect(report.grouping).toBe("participant");
    for (const m of report.models) {
      expect(m.discrimination).not.toBeNull();
      expect(Math.abs(m.discrimination!.rocAuc - 0.5)).toBeLessThanOrEqual(0.1);
    }
    expect(report.decision.adopt).toBe(false);
  });
});

describe("metrics match hand-computed examples", () => {
  it("PR-AUC (average precision), ROC-AUC and Brier", () => {
    expect(prAuc([0.9, 0.8, 0.7, 0.6], [1, 0, 1, 0])).toBeCloseTo(5 / 6, 10);
    expect(prAuc([0.9, 0.8, 0.7, 0.6], [1, 1, 0, 0])).toBe(1);
    expect(prAuc([0.5, 0.5], [1, 0])).toBeCloseTo(0.5, 10);
    expect(rocAuc([0.9, 0.8, 0.7, 0.6], [1, 0, 1, 0])).toBeCloseTo(0.75, 10);
    expect(brierScore([0.9, 0.2], [1, 0])).toBeCloseTo(0.025, 12);
  });

  it("false-intervention and missed-dangerous-approval rates", () => {
    const levels: InterventionLevel[] = ["NORMAL", "REFOCUS", "PAUSE", "NUDGE", "NORMAL", "REFOCUS"];
    const labels = [0, 0, 1, 1, 1, 0];
    const risks = ["LOW", "HIGH", "CRITICAL", "HIGH", "LOW", "MEDIUM"];
    // Attentive: rows 0, 1, 5 -> redirected or paused: 1 and 5.
    expect(falseInterventionRate(levels, labels)).toEqual({ rate: 2 / 3, n: 3 });
    // Low attention on HIGH/CRITICAL: rows 2 (paused) and 3 (only nudged: let through).
    expect(missedDangerousRate(levels, labels, risks)).toEqual({ rate: 1 / 2, n: 2 });
    expect(missedDangerousRate(levels, labels, risks, [0, 1])).toEqual({ rate: null, n: 0 });
  });

  it("reliability bins, intervals and group bootstrap", () => {
    const bins = reliability([0.05, 0.15, 0.12, 0.95], [0, 1, 0, 1], 10);
    expect(bins[0]).toMatchObject({ count: 1, observed: 0 });
    expect(bins[1]).toMatchObject({ count: 2, observed: 0.5 });
    expect(bins[1].meanPredicted).toBeCloseTo(0.135, 12);
    expect(bins[9]).toMatchObject({ count: 1, observed: 1 });
    // 2.5% and 97.5% quantiles of 1..10: positions 0.225 and 8.775 between order statistics.
    const [lo, hi] = percentileInterval([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])!;
    expect(lo).toBeCloseTo(1.225, 12);
    expect(hi).toBeCloseTo(9.775, 12);
    const groups = ["a", "a", "b", "c"];
    const a = bootstrapGroups(groups, (rows) => rows.length, 20, 7);
    expect(a).toEqual(bootstrapGroups(groups, (rows) => rows.length, 20, 7));
    expect(a.every((n) => n >= 3 && n <= 6)).toBe(true);
  });
});

describe("policy replay and reports", () => {
  it("replays the stored policy inputs", () => {
    const e = syntheticEntry({
      participant: "P01",
      sessionId: "session-P01-0001",
      order: 4,
      condition: "RAPID_APPROVAL",
      risk: "CRITICAL",
      values: {},
      assessment: { criticalCoverage: 0.05, attentionScore: 0.3, targetCoverage: [{ id: "t", coverage: 0.05, visible: true }] },
    });
    expect(replayDecision(e).level).toBe("PAUSE");
    // Medium trust: gaze alone may only refocus; the advisory model never lowers it.
    const medium = { ...e, policyInput: { ...e.policyInput, assessment: { ...e.policyInput.assessment, trustLevel: "medium" as const, latencyRatio: 1.2 } } };
    expect(replayDecision(medium).level).toBe("REFOCUS");
    expect(replayDecision(medium, { probability: 0.99, tauSens: 0.75, tauVerify: 0.8 }).level).toBe("REFOCUS");
  });

  it("writes a labeled report with sample sizes and a decision", () => {
    const report = evaluateDataset(signalDataset(6), { label: "signal fixture", synthetic: true, bootstrap: 100 });
    const md = reportMarkdown(report);
    expect(md).toMatch(/SYNTHETIC FIXTURE/);
    expect(md).toMatch(/108 approvals · 6 participants/);
    expect(md).toMatch(/Pre-registered decision rule/);
    expect(md).toMatch(/Gradient-boosted trees: not run/);
    expect(report.models.map((m) => m.id)).toEqual(["lr-current", "lr-temporal"]);
    for (const m of report.models) expect(m.operatingPoints).toHaveLength(6);
  });

  it("says 'insufficient data' instead of printing metrics for fewer than 3 groups", () => {
    const report = evaluateDataset(signalDataset(2), { synthetic: true, bootstrap: 20 });
    expect(report.grouping).toBe("session");
    expect(report.warnings.join("\n")).toMatch(/WARNING: only 2 participants/);
    const md = reportMarkdown(report);
    expect(md).toMatch(/insufficient data/);
    expect(md).not.toMatch(/\| 0\.\d{3} \|/);
    expect(report.decision.adopt).toBe(false);
  });
});
