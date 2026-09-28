# Judging demo (90 to 120 seconds)

The goal: within five seconds of the pause, a judge sees **APPROVAL PAUSED**, the sentence that was skipped, and the heatmap proving it was skipped.

## The day before (online)

1. `npm install`, then `npm run setup:assets -- --check`. It verifies the MediaPipe WASM runtime and the Face Landmarker model (3.8 MB) are in `public/`. If anything is missing it says so and exits with an error: run `npm run setup:assets` while online. After that the venue's network is not needed at all.
2. `npm run demo` once, to confirm the production build starts.

## Pre-flight (do this before judges arrive)

1. `npm run demo` and open `http://localhost:3000` in **Chrome** (or Edge). Close DevTools.
2. Maximize the window (or use F11 fullscreen) **before** calibrating, and keep browser zoom at 100%. Do not resize afterwards: calibration is tied to the window size and position (OverSight marks it stale if they change).
3. Light your face from the front (no bright window behind you). Webcam at the top of the screen, you at roughly arm's length (50 to 70 cm), face centered.
4. Start demo -> **Enable camera** -> checks turn green -> **Start calibration** (Space). About 35 seconds, Esc cancels at any point:
   - **9 dots:** follow the dot with your eyes, head still.
   - **Head sweep:** keep your eyes on the dot and slowly turn your head left and right, then nod. This teaches OverSight the difference between moving your eyes and moving your head.
   - **5 check dots:** look at each one. They are not used for calibration; they measure its error.
   - Sometimes **extra points** follow where one area was less accurate (S skips them).
5. The check screen shows the result measured on the check dots: *median error* and *90th percentile* in px, and a quality label. Aim for *Good*; *Fair* works but lowers gaze trust to medium. Look at each corner: the tile under your gaze should light up. If it says *Recalibration recommended*, or the wrong tiles light up, press **Recalibrate**.
6. Open the console, press **R** (reset session). Press **D** once and check that **gaze on (max weight)** follows your eyes over the card (title, reasoning, consequence), then **D** again to hide it.
7. Do one full rehearsal, then press **R** again. The status line under the header should be empty; see "When trust is medium or low" if it is not.

Controls: `N` next request, `R` reset (keeps calibration), `O` attention overlay, `D` diagnostics, `S` session analytics, `C` recalibrate. They only navigate or reset; they cannot create attention evidence.

## The script

| Time | Do | Say (short form) |
|---|---|---|
| 0:00 | Console open on request #1. | "AI agents now ask humans to approve their actions. Approval systems record one thing: the click. After the tenth request, the click is a reflex. That's approval fatigue." |
| 0:12 | Point at the right panel. Press **O** to show the attention overlay. | "OverSight reads each request, finds the consequence that actually matters, and checks whether I looked at it, using my webcam, processed on this laptop, never uploaded." |
| 0:22 | **#1 Weekly report.** Read the consequence marked *Key detail* for about 3 seconds (coverage fills in the panel), then **Approve**. | "I read the key detail. Coverage full. Approved, no friction." |
| 0:32 | **#2 Dependency patch.** Same: read the key detail, **Approve**. | "Routine requests stay fast. OverSight is learning my normal pace." |
| 0:40 | **#3 TLS renewal** and **#4 Preview scale-down.** Glance, approve quickly. Look at the trend bars dropping in *Session pattern*. | "Now I'm doing what everyone does: speeding up. Low-risk, so OverSight lets it go, but it notices the trend." |
| 0:52 | **#5 Deploy Database Configuration.** Look at the **title only**. Move straight to **Approve** (top right) and click within about a second. Do not look down at the consequences. | "This one looks routine too." |
| 0:55 | The card turns into **APPROVAL PAUSED**. Point at the big sentence. | "OverSight didn't approve. It paused on the exact line I skipped: 2,431 customer records will be permanently deleted." |
| 1:05 | Scroll slightly if needed and point at **Attention evidence** (heat on the title, critical region at 0%) and the reasons. | "Here's the evidence: my attention was up here; the critical sentence got nothing. And I approved far faster than my own baseline, after a run of rapid approvals." |
| 1:15 | Read the isolated sentence. The bar fills; **Critical consequence reviewed** appears. Click **I reviewed the critical consequence**. | "No 'Are you sure?', no five-second timer. It waits until the consequence has actually been looked at." |
| 1:30 | Press **S** (session analytics). | "Across the session, attention dropped approval after approval. OverSight calls that an approval fatigue pattern, raises its sensitivity, and switches to critical-only review mode." |
| 1:45 | Point at the disclaimer line. | "It doesn't claim I understood, and it doesn't say I'm tired. It shows the critical information probably wasn't looked at. Human approval shouldn't mean human autopilot." |

Optional extras if time allows:

- **Refocus (Level 2):** on *Grant repository access to CodeLens AI*, glance at the critical line for a moment, look back at the title, click Approve. The button turns into **Review critical consequence ->** and the sentence comes into focus.
- **Uncertainty:** press **D** and point at *Uncertainty* (sigma x, y) and *If approved now* (gaze trust). "It knows how far off its own estimate may be. When it can't tell the warning from the title, it doesn't pretend to."
- **Privacy proof:** open DevTools -> Network: only same-origin requests, no images; the CSP header shows `connect-src 'self'`.
- **Accessibility:** inside a pause, click *I cannot use camera-based attention verification* and type the consequence's number.
- **Custom request:** *Analyze a custom request* (left rail) -> pick an example -> OverSight finds the critical sentence in pasted text.

## What should happen (so you can tell if something is off)

| Moment | Expected |
|---|---|
| Reading the key detail on #1/#2 | *Live attention* coverage rises to 100%; "Gaze on: Consequence" |
| #3/#4 | Approved without friction (low risk); trend bars drop; "Review attention is trending down" |
| #5 trap | Pause; coverage ~0% on the critical region; heat on the title in the evidence map |
| Re-review | Progress fills in about 1 to 2 seconds of looking; confirm enabled |
| Session page | Attention bars fall across approvals; callout "Attention degradation detected" when the decline spans enough approvals |
| Diagnostics (D) during a review | *gaze trust* high; *separation* well above 2 sigma for the critical line |

## Reading trust and sigma (diagnostics, D)

- **Uncertainty -> sigma x · y:** how far off the current gaze estimate may be (one standard deviation, CSS px). It starts at the calibration's held-out error and grows when your head leaves the calibrated posture (*posture z* above 1.5), during blinks, and when drift is suspected. *confidence* is 100% at the calibrated error and drops as sigma grows.
- **Regions -> w · strength · s** per critical target: the current soft weight of gaze on it, the evidence so far (strong, partial, not observed, inconclusive, not visible) and its separation from the title, summary and buttons in sigma units. Below 2 sigma the target is *inconclusive*: gaze cannot tell it apart from its neighbours, so it is not judged by gaze.
- **If approved now -> gaze trust:** level, confidence and effective frame rate; *gaze · behavioral level* shows what each path would decide.
- **Performance:** inference time, processed and effective fps, the frame stride (1 in 2 or 1 in 3 means inference is slow) and the overlay's draw time.

What the levels mean for the decision:

| Trust | Decision | Re-review |
|---|---|---|
| high | gaze decides, as designed | by gaze |
| medium | gaze may ask for a refocus but not a pause; interaction timing is a floor | by gaze |
| low / none | interaction timing decides | manual acknowledgement |

## When trust is medium or low

The status line under the header tells you what is wrong:

| Status line | What to do |
|---|---|
| **Calibration stale: recalibrate.** | The window moved, was resized or zoomed. Put it back (maximized, zoom 100%) and press **C** to recalibrate. |
| **Possible drift: quick recheck.** | You moved or the camera was nudged. Click *Quick recheck* (3 dots, about 5 s). If it still reports a large error, recalibrate. |
| **Gaze uncertain: using interaction timing.** | Read the reason after it. Calibration quality low: recalibrate with front lighting. Critical text cannot be told apart from the title: recalibrate for a smaller error, or make the window taller so the consequence sits further from the title. Few gaze frames per second: close other tabs and apps, plug in the laptop, and check *Performance* in diagnostics. Face tracking lost: center your face, remove backlight. |

Medium trust without a status line (fair calibration, a slow camera, head outside the calibrated posture) is shown in diagnostics only. The demo still works: the trap pauses on the fast approval, because interaction timing alone requires it for a critical request. At low trust the re-review asks you to type the consequence's number instead of looking at it; that is the designed behavior, so say so.

## If something goes wrong

- **Trap approved without pausing:** your gaze estimate probably drifted onto the warning. Check with **D** that *gaze on (max weight)* shows *title* while you look at the title. Recalibrate (**C**), keep your head still, and click Approve right after glancing at the title.
- **OverSight shows "Critical consequence not yet on screen" (refocus) instead of pausing:** the warning was below the fold, so OverSight correctly refused to judge gaze on it. Make the window taller (before calibrating) or zoom the browser to 90% and recalibrate.
- **Attentive reading doesn't fill coverage:** calibration is off, or the target is *inconclusive* (see diagnostics). Recalibrate with better front lighting; remove strong backlight; glasses reflections can hurt.
- **Camera unavailable at the venue:** continue without camera. OverSight falls back to interaction timing; the trap still pauses on a fast approval and asks for manual acknowledgement. Say so openly.
- **Model or WASM missing (camera never starts):** `npm run setup:assets -- --check` tells you what is missing. Without a network, use the camera-free mode.
- **"Degradation detected" didn't appear on the trap:** it needs a clear decline across five approvals. Approve #3 and #4 faster, or show the session page after one more rapid approval. The pause itself does not depend on it.
- Need a clean slate: **R**. Need a new calibration: **C**.

Simulated gaze (pointer as gaze proxy) exists in Diagnostics for development and rehearsal without a camera. It is labeled on screen whenever it is on. Do not use it for judging; the demo is meant to run on live computer vision.
