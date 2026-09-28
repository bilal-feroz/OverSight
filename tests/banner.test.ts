/**
 * Signal banner precedence (lib/attention/banner.ts): the most actionable
 * problem is shown, and gaze trust only speaks once the signal itself is sound.
 * Live trust (lib/attention/live-trust.ts) runs on simulated reviews.
 */
import { describe, expect, it } from "vitest";
import { bannerKind, type BannerInput } from "@/lib/attention/banner";
import { ATTENTION_CONFIG } from "@/lib/attention/config";
import { liveTrust } from "@/lib/attention/live-trust";
import { CAMERA_OFF, center, openReview, play, trajectory } from "./sim/gaze-sim";

const SOUND: BannerInput = {
  simulated: false,
  cameraStatus: "active",
  calibrated: true,
  calibrationQuality: "good",
  calibrationStale: false,
  driftSuspected: false,
  liveTrust: "high",
};

describe("signal banner", () => {
  it("shows nothing for a sound, trusted signal", () => {
    expect(bannerKind(SOUND)).toBeNull();
    expect(bannerKind({ ...SOUND, liveTrust: "medium" })).toBeNull();
    expect(bannerKind({ ...SOUND, liveTrust: null })).toBeNull();
  });

  it("says gaze is uncertain when trust in the review so far is low or none", () => {
    expect(bannerKind({ ...SOUND, liveTrust: "low" })).toBe("uncertain");
    expect(bannerKind({ ...SOUND, liveTrust: "none" })).toBe("uncertain");
  });

  it("puts the fix first: stale, then poor calibration, then drift", () => {
    const all = { ...SOUND, calibrationStale: true, calibrationQuality: "poor" as const, driftSuspected: true, liveTrust: "none" as const };
    expect(bannerKind(all)).toBe("stale");
    expect(bannerKind({ ...all, calibrationStale: false })).toBe("poor");
    expect(bannerKind({ ...all, calibrationStale: false, calibrationQuality: "fair" })).toBe("drift");
  });

  it("labels simulated gaze above everything, and explains a missing camera", () => {
    expect(bannerKind({ ...SOUND, simulated: true, calibrationStale: true })).toBe("simulated");
    expect(bannerKind({ ...SOUND, calibrated: false })).toBe("uncalibrated");
    expect(bannerKind({ ...SOUND, cameraStatus: "denied" })).toBe("camera-off");
    expect(bannerKind({ ...SOUND, cameraStatus: "idle", calibrated: false })).toBe("camera-off");
    expect(bannerKind({ ...SOUND, cameraStatus: "loading-model" })).toBeNull();
  });
});

describe("live trust for the banner", () => {
  const dwell = (r: ReturnType<typeof openReview>, ms: number) =>
    play(r.session, r.geo, trajectory([{ kind: "dwell", at: center(r.rect("title")), ms }], { viewport: r.layout.viewport, seed: 3 }));

  it("stays silent until the review has run long enough to judge", () => {
    const r = openReview("db-config");
    dwell(r, ATTENTION_CONFIG.trust.liveSettleMs - 200);
    expect(liveTrust(r.session)).toBeNull();
  });

  it("is high for a sound signal and low for a poor calibration, with the reason", () => {
    const good = openReview("db-config");
    dwell(good, 3000);
    expect(liveTrust(good.session)?.level).toBe("high");

    const poor = openReview("db-config", { signal: { calibrationQuality: "poor" } });
    dwell(poor, 3000);
    const trust = liveTrust(poor.session)!;
    expect(trust.level).toBe("low");
    expect(trust.code).toBe("trust-poor");
    expect(bannerKind({ ...SOUND, calibrationQuality: "fair", liveTrust: trust.level })).toBe("uncertain");
  });

  it("explains a review without gaze from the signal notes", () => {
    const r = openReview("db-config", { signal: CAMERA_OFF });
    play(r.session, r.geo, [], 3000);
    expect(liveTrust(r.session)).toMatchObject({ level: "none", code: "camera-off" });
  });
});
