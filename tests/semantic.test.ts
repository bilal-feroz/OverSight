import { describe, expect, it } from "vitest";
import { SCENARIOS, getScenario } from "@/data/scenarios";
import { analyzeWithRules, allBlocks, isNegated, parseMoney } from "@/lib/semantic/rules";
import { mergeAiAnalysis, type AiOutput } from "@/lib/semantic/analyzer";
import { CUSTOM_EXAMPLES, parseCustomRequest } from "@/lib/semantic/parser";
import { RISK_ORDER } from "@/types/approval";

describe("deterministic semantic risk engine", () => {
  for (const scenario of SCENARIOS) {
    it(`classifies "${scenario.title}" as ${scenario.expected.risk} with targets ${scenario.expected.targetIds.join(", ")}`, () => {
      const analysis = analyzeWithRules(scenario);
      expect(analysis.overallRisk).toBe(scenario.expected.risk);
      expect(analysis.criticalRegions.map((r) => r.fieldId)).toEqual(scenario.expected.targetIds);
      if (scenario.expected.statement) {
        expect(analysis.criticalRegions[0].statement).toBe(scenario.expected.statement);
      }
      // Every phrase must be an exact substring of its block, so the UI can highlight it.
      const blocks = new Map(allBlocks(scenario).map((b) => [b.id, b.text]));
      for (const region of [...analysis.criticalRegions, ...analysis.notableRegions]) {
        expect(blocks.get(region.fieldId)).toContain(region.phrase);
      }
    });
  }

  it("identifies the buried migration warning as the only decision-critical region", () => {
    const analysis = analyzeWithRules(getScenario("db-config")!);
    expect(analysis.criticalRegions).toHaveLength(1);
    const [region] = analysis.criticalRegions;
    expect(region.fieldId).toBe("impact-2");
    expect(region.severity).toBe("CRITICAL");
    expect(region.category).toBe("data_destruction");
    expect(region.phrase).toBe("permanently delete 2,431 customer records");
    expect(analysis.reversible).toBe(false);
  });

  it("never selects title or summary as attention targets", () => {
    for (const scenario of SCENARIOS) {
      const ids = analyzeWithRules(scenario).criticalRegions.map((r) => r.fieldId);
      expect(ids).not.toContain("title");
      expect(ids).not.toContain("summary");
    }
  });

  it("keeps routine requests to a single key detail", () => {
    for (const scenario of SCENARIOS.filter((s) => s.expected.risk === "LOW")) {
      expect(analyzeWithRules(scenario).criticalRegions).toHaveLength(1);
    }
  });

  it("handles negation", () => {
    const text = "No downtime expected for the status page.";
    expect(isNegated(text, text.indexOf("downtime"))).toBe(true);
    const outage =
      "payments-api does not support hot reload and will fail database connections until it is restarted.";
    expect(isNegated(outage, outage.indexOf("will fail"))).toBe(false);
  });

  it("parses money amounts", () => {
    expect(parseMoney("Transfer AED 480,000.00 today")[0]).toMatchObject({ value: 480000, display: "AED 480,000" });
    expect(parseMoney("$24 per seat")[0].value).toBe(24);
    expect(parseMoney("USD 1.5m")[0].value).toBe(1_500_000);
  });
});

describe("AI merge keeps the deterministic floor", () => {
  const trap = getScenario("db-config")!;

  it("cannot de-escalate risk or drop a critical rule target", () => {
    const ai: AiOutput = { overallRisk: "LOW", criticalRegions: [] };
    const merged = mergeAiAnalysis(trap, ai, "test-model");
    expect(merged.overallRisk).toBe("CRITICAL");
    expect(merged.criticalRegions.map((r) => r.fieldId)).toContain("impact-2");
    expect(merged.provider).toEqual({ kind: "ai", model: "test-model" });
  });

  it("ignores unknown field ids and non-substring phrases", () => {
    const ai: AiOutput = {
      overallRisk: "CRITICAL",
      criticalRegions: [
        { fieldId: "does-not-exist", severity: "CRITICAL", reason: "hallucinated" },
        {
          fieldId: "impact-2",
          severity: "CRITICAL",
          reason: "permanent deletion of customer data",
          statement: "2,431 customer records will be permanently deleted.",
          phrase: "text that is not in the block",
        },
      ],
    };
    const merged = mergeAiAnalysis(trap, ai, "test-model");
    expect(merged.criticalRegions.map((r) => r.fieldId)).toEqual(["impact-2"]);
    expect(merged.criticalRegions[0].phrase).toBe("permanently delete 2,431 customer records");
  });

  it("lets AI escalate a block the rules rated lower", () => {
    const ai: AiOutput = {
      overallRisk: "CRITICAL",
      criticalRegions: [
        {
          fieldId: "impact-3",
          severity: "CRITICAL",
          reason: "replica restarts during peak checkout",
          statement: "Read replicas restart during peak traffic.",
        },
      ],
    };
    const merged = mergeAiAnalysis(trap, ai, "test-model");
    const ids = merged.criticalRegions.map((r) => r.fieldId);
    expect(ids).toContain("impact-2");
    expect(ids).toContain("impact-3");
  });
});

describe("custom request parsing", () => {
  it("turns free text into blocks and finds the critical sentence", () => {
    const request = parseCustomRequest(CUSTOM_EXAMPLES.find((e) => e.label === "S3 bucket policy")!.input);
    expect(request.blocks.length).toBeGreaterThan(2);
    const analysis = analyzeWithRules(request);
    expect(RISK_ORDER[analysis.overallRisk]).toBeGreaterThanOrEqual(RISK_ORDER.HIGH);
    const target = request.blocks.find((b) => b.id === analysis.criticalRegions[0].fieldId);
    expect(target?.text).toMatch(/publicly readable/);
  });

  it("detects irreversible refunds as high risk", () => {
    const request = parseCustomRequest(CUSTOM_EXAMPLES.find((e) => e.label === "Refund batch")!.input);
    const analysis = analyzeWithRules(request);
    expect(analysis.overallRisk).toBe("HIGH");
    expect(analysis.reversible).toBe(false);
  });

  it("detects a disabled security control stated only in the summary and targets it", () => {
    const request = parseCustomRequest({
      title: "Disable MFA for contractor accounts",
      environment: "production",
      body: "Temporarily disable multi-factor authentication for 12 contractor accounts to unblock SSO migration.\n- Accounts can sign in with password only until re-enabled.",
    });
    const analysis = analyzeWithRules(request);
    expect(analysis.overallRisk).toBe("HIGH");
    expect(analysis.criticalRegions[0]).toMatchObject({ fieldId: "summary", category: "security_control" });
    // "SSO migration" is not a database schema migration.
    expect([...analysis.criticalRegions, ...analysis.notableRegions].map((r) => r.category)).not.toContain("schema_change");
  });

  it("treats 'payment is final' as irreversible when the summary describes a payment", () => {
    const request = parseCustomRequest({
      title: "Wire vendor payment",
      body: "Pay USD 12,500 to Northwind Supplies for October.\n- Beneficiary details unchanged since 2023.\n- Payment is final once released.",
    });
    const analysis = analyzeWithRules(request);
    expect(analysis.overallRisk).toBe("HIGH");
    const target = request.blocks.find((b) => b.id === analysis.criticalRegions[0].fieldId);
    expect(target?.text).toMatch(/final/);
    expect(analysis.reversible).toBe(false);
  });

  it("rates recoverable deletion below destructive deletion", () => {
    const request = parseCustomRequest({
      title: "Clean up old logs",
      body: "Delete log objects older than 90 days.\n- Objects are moved to the recycle bin for 30 days.",
    });
    expect(analyzeWithRules(request).overallRisk).toBe("MEDIUM");
  });

  it("every composer example yields at least one decision-critical target", () => {
    for (const example of CUSTOM_EXAMPLES) {
      const analysis = analyzeWithRules(parseCustomRequest(example.input));
      expect(RISK_ORDER[analysis.overallRisk]).toBeGreaterThanOrEqual(RISK_ORDER.HIGH);
      expect(analysis.criticalRegions.length).toBeGreaterThan(0);
    }
  });

  it("always yields an attention target for high-risk requests, even when the risk is only in the title", () => {
    const analysis = analyzeWithRules({
      id: "t",
      source: "custom",
      agent: { name: "a", handle: "a" },
      actionType: "custom.action",
      environment: "production",
      title: "Permanently delete all customer records",
      summary: "Routine maintenance window.",
      blocks: [{ id: "detail-1", kind: "detail", text: "Runs tonight." }],
      requestedAgo: "now",
    });
    expect(analysis.overallRisk).toBe("CRITICAL");
    expect(analysis.criticalRegions.map((r) => r.fieldId)).toEqual(["title"]);
  });

  it("parses arrow lines as change rows", () => {
    const request = parseCustomRequest({ body: "Resize the cluster.\n- replicas: 3 -> 6" });
    expect(request.blocks[0]).toMatchObject({ kind: "change", label: "replicas", from: "3", to: "6" });
  });
});
