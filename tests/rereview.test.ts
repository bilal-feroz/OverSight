import { describe, expect, it } from "vitest";
import { ATTENTION_CONFIG } from "@/lib/attention/config";
import {
  acknowledgeManually,
  createReReview,
  manualAckToken,
  reReviewProgress,
  stepReReview,
} from "@/lib/attention/rereview";

const frame = (overrides: Partial<Parameters<typeof stepReReview>[1]> = {}) => ({
  dtMs: 33,
  targetVisible: true,
  gazeOnTarget: true,
  faceOk: true,
  ...overrides,
});

describe("re-review validation", () => {
  it("bounds the required dwell", () => {
    expect(createReReview("t", 1350, "gaze").requiredDwellMs).toBe(1080);
    expect(createReReview("t", 300, "gaze").requiredDwellMs).toBe(1000);
    expect(createReReview("t", 9000, "gaze").requiredDwellMs).toBe(2000);
  });

  it("is not satisfied by time alone", () => {
    let s = createReReview("t", 1350, "gaze");
    for (let i = 0; i < 200; i++) s = stepReReview(s, frame({ gazeOnTarget: false }));
    expect(s.satisfied).toBe(false);
    expect(s.visibleMs).toBeGreaterThan(5000);
    expect(reReviewProgress(s)).toBe(0);
  });

  it("does not count gaze while the face is lost or the target is off screen", () => {
    let s = createReReview("t", 1350, "gaze");
    for (let i = 0; i < 100; i++) s = stepReReview(s, frame({ faceOk: false }));
    for (let i = 0; i < 100; i++) s = stepReReview(s, frame({ targetVisible: false }));
    expect(s.dwellMs).toBe(0);
  });

  it("re-review successful => approval enabled", () => {
    let s = createReReview("t", 1350, "gaze");
    let frames = 0;
    while (!s.satisfied && frames < 200) {
      s = stepReReview(s, frame());
      frames++;
    }
    expect(s.satisfied).toBe(true);
    expect(frames).toBeLessThan(40); // ~1.1 s at 30 fps
    expect(reReviewProgress(s)).toBe(1);
  });

  it("clamps large frame gaps", () => {
    const s = stepReReview(createReReview("t", 1350, "gaze"), frame({ dtMs: 5000 }));
    expect(s.dwellMs).toBe(ATTENTION_CONFIG.targets.maxFrameDtMs);
  });

  it("supports manual acknowledgement of the key quantity", () => {
    const token = manualAckToken("2,431 customer records will be permanently deleted.");
    expect(token).toBe("2,431");
    const base = createReReview("t", 1350, "manual");
    expect(acknowledgeManually(base, { typed: "2431", expectedToken: token }).satisfied).toBe(true);
    expect(acknowledgeManually(base, { typed: "2,431", expectedToken: token }).satisfied).toBe(true);
    expect(acknowledgeManually(base, { typed: "2413", expectedToken: token }).satisfied).toBe(false);
  });

  it("falls back to an explicit checkbox when the consequence has no quantity", () => {
    const base = createReReview("t", 1350, "manual");
    expect(manualAckToken("The vendor agreement has expired.")).toBeNull();
    expect(acknowledgeManually(base, { expectedToken: null, checked: false }).satisfied).toBe(false);
    expect(acknowledgeManually(base, { expectedToken: null, checked: true }).satisfied).toBe(true);
  });
});
