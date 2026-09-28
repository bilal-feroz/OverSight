import { describe, expect, it } from "vitest";
import { assessPattern } from "@/lib/attention/pattern";

const series = (scores: number[], latencyRatio = 1) =>
  scores.map((thoroughness) => ({ thoroughness, latencyRatio }));

describe("session approval pattern (behavioral 'approval fatigue')", () => {
  it("detects declining review attention across consecutive approvals", () => {
    const p = assessPattern(series([0.91, 0.87, 0.75, 0.58, 0.37, 0.19]));
    expect(p.detected).toBe(true);
    expect(p.status).toBe("degradation");
    expect(p.declineRun).toBe(5);
    expect(p.message).toBe("Review attention has declined across 6 consecutive approvals.");
    // Copy describes the interaction, never the person.
    expect(p.message).not.toMatch(/tired|fatigue|exhaust/i);
  });

  it("tolerates a plateau inside a decline", () => {
    const p = assessPattern(series([0.95, 0.9, 0.57, 0.3, 0.29], 0.3));
    expect(p.detected).toBe(true);
    expect(p.declineRun).toBe(4);
  });

  it("does not flag consistently attentive sessions", () => {
    const p = assessPattern(series([0.92, 0.9, 0.94, 0.89, 0.91, 0.93]));
    expect(p.detected).toBe(false);
    expect(p.status).toBe("stable");
  });

  it("does not flag a gentle decline among attentive reviews", () => {
    const p = assessPattern(series([0.97, 0.93, 0.89, 0.85, 0.8]));
    expect(p.detected).toBe(false);
  });

  it("requires enough approvals before detecting a pattern", () => {
    const p = assessPattern(series([0.95, 0.6, 0.3, 0.1]));
    expect(p.detected).toBe(false);
    expect(p.status).toBe("declining");
  });

  it("detects a rapid-approval streak", () => {
    const p = assessPattern([
      { thoroughness: 0.9, latencyRatio: 1.1 },
      { thoroughness: 0.62, latencyRatio: 0.3 },
      { thoroughness: 0.58, latencyRatio: 0.25 },
      { thoroughness: 0.55, latencyRatio: 0.2 },
      { thoroughness: 0.5, latencyRatio: 0.2 },
    ]);
    expect(p.rapidStreak).toBe(4);
    expect(p.detected).toBe(true);
    expect(p.latencyTrend).toBeLessThan(0);
  });

  it("clears after two attentive approvals", () => {
    const p = assessPattern(series([0.91, 0.8, 0.6, 0.4, 0.2, 0.85, 0.9]));
    expect(p.detected).toBe(false);
  });

  it("reports insufficient data early", () => {
    expect(assessPattern([]).status).toBe("insufficient");
    expect(assessPattern(series([0.9, 0.2])).status).toBe("insufficient");
  });
});
