# Judging demo (90 to 120 seconds)

The goal: within five seconds of the pause, a judge sees **APPROVAL PAUSED**, the sentence that was skipped, and the heatmap proving it was skipped.

## Pre-flight (do this before judges arrive)

1. `npm run demo` and open `http://localhost:3000` in **Chrome** (or Edge). Close DevTools.
2. Maximize the window (or use F11 fullscreen) **before** calibrating, and keep browser zoom at 100%. Do not resize afterwards: calibration is tied to the window size (OverSight warns if it changes).
3. Light your face from the front (no bright window behind you). Webcam at the top of the screen, you at roughly arm's length (50 to 70 cm), face centered.
4. Start demo -> **Enable camera** -> checks turn green -> **Start calibration** (Space). Follow the dot with your eyes, head still. About 15 seconds.
5. On the gaze-check screen, look at each corner: the tile under your gaze should light up. If it says *Recalibration recommended* or the wrong tiles light up, press **Recalibrate**.
6. Open the console, press **R** (reset session). Optionally press **D** once to confirm "gaze intersects" follows your eyes over the card, then **D** again to hide it.
7. Do one full rehearsal, then press **R** again.

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

## If something goes wrong

- **Trap approved without pausing:** your gaze estimate probably drifted onto the warning. Check with **D** that "gaze intersects" shows *title* while you look at the title. Recalibrate (**C**), keep your head still, and click Approve right after glancing at the title.
- **OverSight shows "Critical consequence not yet on screen" (refocus) instead of pausing:** the warning was below the fold, so OverSight correctly refused to judge gaze on it. Make the window taller (before calibrating) or zoom the browser to 90% and recalibrate.
- **Attentive reading doesn't fill coverage:** calibration is off. Recalibrate with better front lighting; remove strong backlight; glasses reflections can hurt.
- **Camera unavailable at the venue:** continue without camera. OverSight falls back to interaction timing; the trap still pauses on a fast approval and asks for manual acknowledgement. Say so openly.
- **"Degradation detected" didn't appear on the trap:** it needs a clear decline across five approvals. Approve #3 and #4 faster, or show the session page after one more rapid approval. The pause itself does not depend on it.
- Need a clean slate: **R**. Need a new calibration: **C**.

Simulated gaze (pointer as gaze proxy) exists in Diagnostics for development and rehearsal without a camera. It is labeled on screen whenever it is on. Do not use it for judging; the demo is meant to run on live computer vision.
