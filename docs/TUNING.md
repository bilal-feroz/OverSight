# Tuning gaze sensitivity

Commodity webcams, lighting and seating vary a lot between rooms. These are the knobs, where they live, and how to tell which one to turn. Change one thing at a time, press **R** in the console, and rehearse the demo again.

## Use diagnostics first

Press **D** in the console. The panel shows, live:

- camera status, delegate (GPU/CPU), fps and inference time
- iris ratios, eyelid aperture, head yaw/pitch/roll
- smoothed and raw gaze (normalized and in px), calibration error, **hit margin**, **drift correction**
- the critical region's bounds, which region the gaze currently intersects, and dwell vs. required dwell
- **If approved now**: the decision the engine would take at this instant, with every score component

Look at the title: "gaze intersects" should read `title`. Look at the critical sentence: it should read its id (for example `impact-2`) and its dwell should climb. If not, tune in this order: calibration and setup, then margins, then dwell, then thresholds.

## 1. Calibration and setup (`lib/cv/config.ts`)

| Symptom | Fix |
|---|---|
| "Recalibration recommended" | Front lighting, no backlight, camera at eye level, head still during the dots |
| Gaze consistently offset in one direction | Recalibrate; drift correction (clicking Approve/Reject) slowly compensates small offsets |
| Vertical gaze poor (common for webcams) | Keep the window tall so title and consequences are far apart; recalibrate sitting the way you will present |
| Points extended / calibration fails | Face must stay visible with exactly one face in view; `calibration.minFramesPerPoint`, `maxExtensionMs` |
| Jittery estimate | Lower `gaze.minCutoff` (for example 0.6); raise it if the estimate lags |
| Laggy estimate when moving the eyes | Raise `gaze.beta` |

Quality thresholds: `calibration.quality.good / fair` (leave-one-point-out mean error as a fraction of viewport width/height). Loosen them only if your setup is consistently accurate in the gaze check but still rated *Fair*.

Drift correction: `drift.learningRate`, `drift.maxDistancePx` (clicks further than this from the estimate are ignored), `drift.maxX/maxY` caps. Set `learningRate: 0` to disable.

## 2. Region hit margins (`lib/attention/config.ts` -> `targets`)

The margin around each region is `clamp(calibration error x marginSigmaFactor, marginMinPx, marginMaxPx)`.

- Attentive reading does not register -> raise `marginSigmaFactor` (0.6 -> 0.8) or `marginMaxPx` (72 -> 90).
- Looking at the title registers on the warning -> lower `marginMaxPx`, or keep the window taller.
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

## 5. Intervention thresholds (`lib/risk/intervention.ts`)

`THRESHOLDS.gaze.<RISK>` and `THRESHOLDS.behavioral.<RISK>`, all at sensitivity 1.0. For the demo trap (CRITICAL), `pauseCoverage: 0.25` is the key number: the trap pauses when the critical sentence received less than 25% of its required dwell.

Sensitivity growth: `ATTENTION_CONFIG.sensitivity` (`fatigueGain`, `streakGain`, `mlGain`, `max`).

## 6. Session pattern (`lib/attention/config.ts` -> `pattern`)

- `minApprovals` (5): the pattern can only be declared from the fifth approval on (the demo trap is fifth).
- `declineRunForDetection`, `dropForDetection`, `rapidStreakForDetection`, `fatigueScoreForDetection`: detection criteria.
- `recoveryScore`: two approvals at or above this clear the pattern.

## Verify after tuning

```bash
npm run test
```

The suite pins the intended behavior (for example "high risk + low attention -> pause", "low risk never blocks", the full demo flow). If a threshold change breaks a test, decide whether the behavior or the test should change.
