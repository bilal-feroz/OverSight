import { describe, expect, it } from "vitest";
import { FEATURE_NAMES } from "@/lib/ml/features";
import {
  auc,
  isClassifierUsable,
  predictProbability,
  topCoefficients,
  trainClassifier,
  type LabeledExample,
} from "@/lib/ml/logistic";

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/**
 * Synthetic fixture for exercising the training code only. It is not a
 * model of real users and is never shipped.
 */
function fixture(n: number, seed = 1): LabeledExample[] {
  const rand = rng(seed);
  const out: LabeledExample[] = [];
  for (let i = 0; i < n; i++) {
    const low = i % 2 === 0;
    const features = FEATURE_NAMES.map(() => rand() * 0.2);
    features[0] = low ? 0.05 + rand() * 0.2 : 0.7 + rand() * 0.3; // criticalCoverage
    features[3] = low ? -1.4 + rand() * 0.5 : -0.1 + rand() * 0.5; // logLatencyRatio
    out.push({ features, label: low ? "LOW_ATTENTION" : "ATTENTIVE" });
  }
  return out;
}

describe("behavioral classifier (logistic regression)", () => {
  it("trains, cross-validates and separates the classes", () => {
    const model = trainClassifier(fixture(60), FEATURE_NAMES, 1);
    expect(model.samples).toEqual({ total: 60, attentive: 30, lowAttention: 30 });
    expect(model.metrics).not.toBeNull();
    expect(model.metrics!.auc).toBeGreaterThan(0.95);
    expect(model.metrics!.accuracy).toBeGreaterThan(0.9);
    const lowExample = fixture(2, 42)[0];
    const goodExample = fixture(2, 42)[1];
    expect(predictProbability(model, lowExample.features)).toBeGreaterThan(0.8);
    expect(predictProbability(model, goodExample.features)).toBeLessThan(0.2);
    expect(isClassifierUsable(model)).toBe(true);
    const top = topCoefficients(model, 2).map((c) => c.name);
    expect(top).toContain("criticalCoverage");
  });

  it("stays unusable with too little data", () => {
    const model = trainClassifier(fixture(10), FEATURE_NAMES, 1);
    expect(isClassifierUsable(model)).toBe(false);
  });

  it("requires both labels", () => {
    const onlyAttentive = fixture(20).filter((e) => e.label === "ATTENTIVE");
    expect(() => trainClassifier(onlyAttentive, FEATURE_NAMES)).toThrow(/both/);
  });

  it("computes AUC", () => {
    expect(auc([0.9, 0.8, 0.2, 0.1], [1, 1, 0, 0])).toBe(1);
    expect(auc([0.1, 0.2, 0.8, 0.9], [1, 1, 0, 0])).toBe(0);
    expect(auc([0.5, 0.5], [1, 0])).toBe(0.5);
  });
});
