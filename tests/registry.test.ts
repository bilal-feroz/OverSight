import { describe, expect, it } from "vitest";
import { regionRegistry } from "@/lib/attention/registry";

const fakeEl = () => ({}) as HTMLElement;

describe("region registry scoping", () => {
  it("keeps identically named regions of two requests apart", () => {
    const a = fakeEl();
    const b = fakeEl();
    const offA = regionRegistry.register({ id: "impact-2", role: "target", label: "x", words: 3, scope: "req-a" }, a);
    const offB = regionRegistry.register({ id: "impact-2", role: "content", label: "y", words: 3, scope: "req-b" }, b);
    expect(regionRegistry.get("impact-2", "req-a")?.el).toBe(a);
    expect(regionRegistry.get("impact-2", "req-b")?.el).toBe(b);
    expect(regionRegistry.list("req-b").map((r) => r.el)).toEqual([b]);
    offA();
    expect(regionRegistry.get("impact-2", "req-a")).toBeUndefined();
    expect(regionRegistry.get("impact-2", "req-b")?.el).toBe(b);
    offB();
    expect(regionRegistry.list("req-b")).toHaveLength(0);
  });

  it("an unmounting element never removes a newer registration under the same key", () => {
    const first = fakeEl();
    const second = fakeEl();
    const offFirst = regionRegistry.register({ id: "title", role: "context", label: "t", words: 1, scope: "r" }, first);
    const offSecond = regionRegistry.register({ id: "title", role: "context", label: "t", words: 1, scope: "r" }, second);
    offFirst();
    expect(regionRegistry.get("title", "r")?.el).toBe(second);
    offSecond();
  });
});
