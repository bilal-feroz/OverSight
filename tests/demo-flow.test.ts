/**
 * End-to-end check of the judging demo logic (no browser): four routine
 * approvals with declining attention, then the database trap approved
 * without looking at the warning, then a successful re-review.
 */
import { describe, expect, it } from "vitest";
import { getScenario } from "@/data/scenarios";
import { analyzeWithRules } from "@/lib/semantic/rules";
import { evaluateApproval } from "@/lib/attention/evaluate";
import { computeBaseline } from "@/lib/attention/baseline";
import { createReReview, stepReReview } from "@/lib/attention/rereview";
import { wordCount } from "@/lib/utils";
import type { ApprovalRecord } from "@/types/attention";
import { snapshot, target } from "./helpers";

function expectedWords(id: string) {
  const s = getScenario(id)!;
  const analysis = analyzeWithRules(s);
  const targets = analysis.criticalRegions.map((r) => s.blocks.find((b) => b.id === r.fieldId)!.text);
  return {
    analysis,
    words: wordCount(s.title) + wordCount(s.summary) + targets.reduce((a, t) => a + wordCount(t), 0),
    targetWords: wordCount(targets[0]),
  };
}

describe("judging demo flow", () => {
  it("routine approvals pass, the trap pauses, re-review re-enables approval", () => {
    const history: ApprovalRecord[] = [];
    // [latency ms, dwell ms on the key detail]: reading well, then rushing.
    const routine: Array<[string, number, number]> = [
      ["weekly-report", 7200, 2200],
      ["dependency-patch", 6100, 1800],
      ["tls-renewal", 2600, 500],
      ["preview-scale-down", 1400, 60],
    ];
    for (const [id, latency, dwell] of routine) {
      const { analysis, words, targetWords } = expectedWords(id);
      const baseline = computeBaseline(history);
      const { assessment, decision } = evaluateApproval({
        snapshot: snapshot({
          elapsedMs: latency,
          targets: [
            target({
              id: analysis.criticalRegions[0].fieldId,
              severity: "LOW",
              words: targetWords,
              requiredDwellMs: targetWords * 90,
              dwellMs: dwell,
              visibleMs: latency,
              fixations: dwell > 1000 ? 3 : 0,
              sweep: dwell > 1000 ? 0.8 : 0,
            }),
          ],
        }),
        risk: analysis.overallRisk,
        baseline,
        history,
        expectedWords: words,
      });
      // Routine approvals are never blocked.
      expect(["NORMAL", "NUDGE"]).toContain(decision.level);
      history.push({
        id,
        requestId: id,
        title: id,
        risk: analysis.overallRisk,
        decidedAt: 0,
        latencyMs: latency,
        expectedLatencyMs: assessment.expectedLatencyMs,
        latencyRatio: assessment.latencyRatio,
        attentionScore: assessment.attentionScore,
        criticalCoverage: assessment.criticalCoverage,
        mode: assessment.mode,
        intervention: decision.level,
        sensitivity: decision.sensitivity,
        outcome: "approved",
        dwellPerWordMs: dwell / targetWords,
        expectedWords: words,
        reasons: decision.reasons,
        features: [],
      });
    }

    const scores = history.map((r) => r.attentionScore);
    expect(scores[0]).toBeGreaterThan(0.85);
    expect(scores[3]).toBeLessThan(scores[0] - 0.3);

    // The trap: title glanced at, approve clicked after 1.3 s, warning never looked at.
    const trap = expectedWords("db-config");
    expect(trap.analysis.overallRisk).toBe("CRITICAL");
    const baseline = computeBaseline(history);
    expect(baseline.source).toBe("personal");
    const { assessment, decision, patternAfter } = evaluateApproval({
      snapshot: snapshot({
        elapsedMs: 1300,
        targets: [target({ id: "impact-2", dwellMs: 50, visibleMs: 1300 })],
      }),
      risk: "CRITICAL",
      baseline,
      history,
      expectedWords: trap.words,
    });
    expect(decision.level).toBe("PAUSE");
    expect(assessment.criticalCoverage).toBeLessThan(0.1);
    expect(patternAfter.detected).toBe(true);
    const texts = decision.reasons.map((r) => r.text).join("\n");
    expect(texts).toMatch(/received almost no visual attention/);
    expect(texts).toMatch(/below your baseline/);
    // Counted from the highest-scoring approval in the run (#1 or #2 depending on scores).
    expect(texts).toMatch(/declined across [45] consecutive approvals/);

    // Deliberate re-review of the isolated consequence re-enables approval.
    let review = createReReview("impact-2", 1350, decision.verification === "gaze" ? "gaze" : "manual");
    for (let i = 0; i < 45 && !review.satisfied; i++) {
      review = stepReReview(review, { dtMs: 33, targetVisible: true, gazeOnTarget: true, faceOk: true });
    }
    expect(review.satisfied).toBe(true);
  });
});
