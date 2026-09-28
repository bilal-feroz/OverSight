# Tuning gaze sensitivity

Commodity webcams, lighting and seating vary a lot between rooms. These are the knobs, where they live, and how to tell which one to turn. Change one thing at a time, press **R** in the console, and rehearse the demo again.

## Use diagnostics first

Press **D** in the console. The panel shows, live:

- camera status, delegate (GPU/CPU), fps and inference time
- iris ratios, eyelid aperture, head yaw/pitch/roll
- smoothed and raw gaze (normalized and in px), calibration error, **hit margin**, **drift correction**
- the critical region's bounds, which region the gaze currently intersects, and dwell vs. required dwell
- **If approved now**: the decision the engine would take at this instant, with every score component

Look at the title: "gaze on (max weight)" should read `title`. Look at the critical sentence: it should read its id (for example `impact-2`) and its dwell should climb. The "Uncertainty" group shows the current sigma, confidence and posture distance; each target row shows its soft weight `w`, evidence strength and separation `s` (in sigma units) from the title, summary and buttons. If not, tune in this order: calibration and setup, then uncertainty, then dwell, then thresholds.

## 1. Calibration and setup (`lib/cv/config.ts`)

| Symptom | Fix |
|---|---|
| "Recalibration recommended" | Front lighting, no backlight, camera at eye level, head still during the 9 dots, real head movement during the sweep |
| Gaze consistently offset in one direction | Recalibrate; drift correction (clicking Approve/Reject) slowly compensates small offsets |
| Vertical gaze poor (common for webcams) | Keep the window tall so title and consequences are far apart; recalibrate sitting the way you will present |
| Points extended / calibration fails | Face must stay visible with exactly one face in view; `calibration.minFramesPerPoint`, `maxExtensionMs` |
| Jittery estimate | Lower `gaze.minCutoff` (for example 0.6); raise it if the estimate lags |
| Laggy estimate when moving the eyes | Raise `gaze.beta` |

Calibration runs in phases (`calibration.*`), about 35 s in total:

- **A. Grid**: `points` (9), `settleMs` (650), `sampleMs` (1050), extended by up to `maxExtensionMs` (2500) while a point has fewer than `minFramesPerPoint` (8) usable frames.
- **A2. Head sweep** (`headSweep`): the eyes stay on each of `points` (3) while the head turns and nods, `settleMs` (400) + `sampleMs` (2100) per dot. It aims for `minYawRangeDeg` (6) and `minPitchRangeDeg` (4) per dot and grants up to `maxExtensionMs` (2000) in total with a gentle prompt, then continues and records the range achieved. Without this phase head pose is collinear with the target and cannot be compensated (see tests/calibration-v2.test.ts).
- **B. Validation** (`validation`): 5 held-out `points`, same timing as the grid, never passed to the fit. At least `minSamplesPerPoint` (3) samples on at least `minPoints` (3) points are needed, otherwise no accuracy is claimed and quality is *Recalibration recommended*.
- **C. Adaptive round** (`adaptive`, at most once, skippable with S): when the worst check point's error exceeds max(`worstToMedianRatio` (2) x the median point error, `worstMinFractionOfWidth` (0.18) x viewport width), 2 training points are added `offset` (0.08) from it toward the centre and 3 new check points (one between that area and the centre, plus `revalidationPoints`) re-measure the error. The triggering point is then left out of the reported accuracy.

Fitting: each axis tries its base inputs (`features.x` / `features.y`), base + `faceScale`, and base + `faceScale` + iris x faceScale interactions, and each ridge penalty in `lambdas`; the combination with the lowest grouped leave-one-point-out error wins (every dot, sweep target and adaptive point is one group). `stdFloor` sets a minimum scale per input: in raw units it adds `lambda x floor^2` to that input's ridge penalty, so an input that barely varied during calibration (yaw with the head still) cannot move the prediction far later. The floors do not make head pose identifiable; the head sweep does.

Quality thresholds: `calibration.quality.good / fair` on the **held-out** per-axis RMSE as a fraction of viewport width / height (good: 0.10 / 0.13, fair: 0.17 / 0.22). These are OverSight's operating thresholds for how much to rely on gaze, not accuracy claims. Legacy (v1) calibrations restored from an older session keep their leave-one-point-out rating (`legacyQuality`) and are capped at medium trust.

`posture.keys` (yaw, pitch, faceX, faceY, faceScale): the calibrated posture is stored as their median and 1.4826 x MAD (floored by `stdFloor`) over the training samples, sweep included.

Drift correction: `drift.learningRate`, `drift.maxDistancePx` (clicks further than this from the estimate are ignored), `drift.maxX/maxY` caps. Set `learningRate: 0` to disable.

## 2. Gaze uncertainty and region evidence

Every gaze estimate carries a per-axis sigma (`lib/cv/uncertainty.ts`, `lib/cv/config.ts` -> `uncertainty`): the calibration's held-out RMSE, multiplied by `1 + postureAlpha x max(0, postureZ - postureZ0)` (0.5, 1.5) when the head leaves the calibrated posture (postureZ = RMS of robust z-scores of yaw, pitch, face x/y and face scale), by `heldInflation` (1.3) while an estimate is held through a blink, and by the drift inflation when drift is suspected. Confidence = calibration sigma / current sigma, and 0 unless exactly one face is in view. Simulated pointer gaze uses `simulatedSigmaPx` (20).

Regions (`lib/attention/config.ts` -> `targets`):

- Soft hit: each visible region gets weight `exp(-d^2 / 2)` for the elliptical distance d (sigma units) from the estimate to the region, and dwell adds `dt x weight`. There is no fixed pixel margin in the dwell path; `marginSigmaFactor`, `marginMinPx`, `marginMaxPx` now only size UI outlines.
- `transitSpeedPxPerS` (1500): estimates whose EMA-smoothed speed (`transitSpeedSmoothing` 0.5) exceeds this are in transit and add no dwell. `transitSpeedCapPxPerS` (6000) caps one frame's speed and `transitMinGapMs` (1) ignores near-duplicate timestamps, so a timing glitch cannot hold the filter in transit. Raise the threshold if slow, careful reading loses dwell; lower it if sweeping past the warning counts.
- Separability: a target whose gap to the title, summary or decision buttons is below `trust.minSeparationSigma` (2.0) sigma is *inconclusive*: gaze neither credits nor blames it, and if every visible target is inconclusive, trust drops to low and interaction timing decides.
- Fixations: I-DT dispersion = clamp(`fixationPrecisionFactor` (2.5) x measured precision, `fixationDispersionMinPx` (40), `fixationDispersionMaxPx` (160)); legacy calibrations keep max(`fixationMinDispersionPx`, sigma x `fixationSigmaFactor`). A fixation counts for a target when its weight at the fixation centre is at least `fixationMinWeight` (0.6).
- Reading sweep: only evidence when sigma x <= region width / `sweepMaxSigmaFraction` (4); otherwise the reading component is unavailable and its weight is redistributed.
- Evidence strength per target: *strong* (conclusive, coverage >= `strongCoverage` 0.6 and at least one fixation), *partial* (coverage >= `partialCoverage` 0.25), *not observed* (below that), *inconclusive* (not separable), *not visible*. The "received almost no visual attention" wording is only used for conclusive evidence.
- `currentRegionMinWeight` (0.1): below this no region is shown as "gaze on" in the UI.
- `trust.maxPostureOutRatio` (0.3): more than this share of gaze frames outside the calibrated posture caps trust at medium.
- `visibleFraction` (0.6): how much of a region must be on screen to count as visible.
- `minVisibleForGazeMs` (150): a target must be visible this long before gaze on it is expected.
- `orientationMs` (500): dwell starts counting this long after a request appears, so where the eyes happened to rest when the card changed does not count as inspection.

## 3. Required dwell (`lib/attention/config.ts` -> `dwell`)

`required = words x msPerWord` clamped to `[minRequiredMs, maxRequiredMs]`. Default `msPerWord` is 90 ms; with a personal baseline it becomes `baselineFraction` (60%) of the reviewer's own attentive dwell.

- Pauses on genuinely attentive reviews -> lower `defaultMsPerWord` (90 -> 70) or `baselineFraction` (0.6 -> 0.5).
- Glances count as reading -> raise them.

Re-review after an intervention: `rereview.fractionOfTarget`, `minRequiredMs`, `maxRequiredMs`.

## 4. Latency and baseline (`lib/attention/config.ts` -> `latency`, `baseline`)

- `defaultMsPerWord` (200) sets the expected review time before a baseline exists.
- `rapidRatio` (0.45): approvals faster than this fraction of expected time count as rapid.
- `baseline.minSamples / maxSamples / attentiveScore`: which early reviews form the personal baseline.

## 5. Gaze trust (`lib/attention/config.ts` -> `trust`, `targets`)

Every approval gets a gaze trust level (see `lib/attention/trust.ts` and the diagnostics row "gaze trust"). It decides how gaze and interaction timing are fused:

| Trust | When | Decision |
|---|---|---|
| high | good calibration, one face, >= 10 gaze frames/s | gaze level (the original gaze rules) |
| medium | fair or legacy calibration, 5 to 10 frames/s, intermittent face tracking | max(min(gaze level, REFOCUS), behavioral level) |
| low | poor calibration, < 5 frames/s, critical text not separable from the title/summary | behavioral level |
| none | camera off, not calibrated, face/multi-face/sparse-gaze problems, stale calibration | behavioral level |

Verification of a re-review is by gaze at high/medium trust and manual at low/none.

- `lowFps` (5) / `mediumFps` (10): effective gaze frame rate (frames with a gaze estimate per second of review) below which trust drops to low / medium.
- `fullConfidenceFps` (15): frame rate at which the frame-rate factor of trust confidence reaches 1.
- `trackingMedium` (0.55) / `trackingLow` (0.3): face-tracking continuity (face ratio x (1 - multi-face ratio) x sqrt(facing ratio)) below which trust is capped.
- `minSeparationSigma` (2.0): a critical target must be at least this many gaze-error sigmas away from the title and summary. If every visible target is closer, gaze cannot tell them apart and trust is capped at low. If attentive reviews keep landing in behavioral mode with a "cannot be told apart" reason, recalibrate for a smaller error or make the window taller.
- `targets.maxFrameDtMs` (250): largest time step one camera frame may add to dwell. It is large enough that a slow camera is not silently under-counted (low frame rates lower trust instead). `maxTickDtMs` (100) is the same limit for animation-frame ticks (visibility, hover, focus), `tickStallMs` (200) lets camera frames tick the session when animation frames stall, and `firstFrameDtMs` (33) is the step assumed for the first frame of a run.
- `signal.simulatedWeight` (0.8) and `signal.simulatedSigmaPx` (20): how simulated pointer gaze is treated in development builds. Production builds refuse simulated gaze entirely.

Calibration staleness (`lib/cv/config.ts` -> `calibration`): `staleViewportChange` (0.06, fraction of width/height), `staleWindowMovePx` (40, moving the browser window on screen), `staleDprChange` (0.01, browser zoom or a different display), checked on resize, focus and pointerdown and polled every `staleCheckMs` (2000). A stale calibration sets trust to none until you recalibrate.

## 6. Intervention thresholds (`lib/risk/intervention.ts`)

`THRESHOLDS.gaze.<RISK>` and `THRESHOLDS.behavioral.<RISK>`, all at sensitivity 1.0. For the demo trap (CRITICAL), `pauseCoverage: 0.25` is the key number: the trap pauses when the critical sentence received less than 25% of its required dwell.

Sensitivity growth: `ATTENTION_CONFIG.sensitivity` (`fatigueGain`, `streakGain`, `mlGain`, `max`).

## 7. Session pattern (`lib/attention/config.ts` -> `pattern`)

- `minApprovals` (5): the pattern can only be declared from the fifth approval on (the demo trap is fifth).
- `declineRunForDetection`, `dropForDetection`, `rapidStreakForDetection`, `fatigueScoreForDetection`: detection criteria.
- `recoveryScore`: two approvals at or above this clear the pattern.

## Verify after tuning

```bash
npm run test
```

The suite pins the intended behavior (for example "high risk + low attention -> pause", "low risk never blocks", the full demo flow). If a threshold change breaks a test, decide whether the behavior or the test should change.
