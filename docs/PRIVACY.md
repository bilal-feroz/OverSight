# Privacy

**Video never leaves this device. We monitor the approval interaction, not the employee.**

OverSight uses a webcam to estimate whether decision-critical information was visually inspected before an approval. That capability is only acceptable if the camera cannot become a surveillance tool. This document states exactly what is and is not done.

## Camera frames stay local

- The camera stream is opened with `getUserMedia` and read by the MediaPipe Face Landmarker **inside the browser tab** (WebAssembly, GPU or CPU).
- Each frame is reduced immediately to a small set of numbers (iris position within each eye, eyelid aperture, eye-direction coefficients, head yaw/pitch/roll, face position). The frame itself is not stored, drawn to a persistent buffer, recorded, or transmitted.
- The optional preview on the setup screen renders the same local stream so the reviewer can frame themselves; it is labeled "Local preview, not recorded".
- The MediaPipe runtime (`/mediapipe/wasm`) and model (`/models/face_landmarker.task`) are served from the application's own origin.

## Enforced, not just promised

The app sends a Content-Security-Policy header with `connect-src 'self'` (see `next.config.ts`). The page can only make network requests to its own origin, so even a bug could not ship camera-derived data to a third party. You can verify this in DevTools: the Network tab shows only same-origin requests, and none of them carry image data.

## No identity, no biometrics, no inference about the person

- No facial recognition model and no identity embedding. OverSight cannot tell who is in front of the camera and never tries.
- No biometric identity storage.
- No age, gender, ethnicity or emotion inference.
- No fatigue, stress, sleepiness or other psychological-state inference. "Approval fatigue pattern" describes declining review behavior across approvals in the interaction, not the person.
- The face model also produces facial-expression coefficients; OverSight reads **only** the eye-direction and blink coefficients (`EYE_BLENDSHAPES` in `lib/cv/landmarks.ts`) and discards the rest in the frame loop (`lib/cv/camera-engine.ts`).
- A second face in view is used only to mark the attention signal as unreliable. It is not analyzed.

## What is stored

Derived numbers only:

| Data | Where | Lifetime |
|---|---|---|
| Calibration model (regression coefficients, held-out error summary, calibrated head posture as median/spread of yaw, pitch, face position and scale, window position and zoom) | `sessionStorage` | This browser tab |
| Approval records: latency, coverage, attention score, thoroughness, intervention, reasons | `sessionStorage` | This browser tab; cleared by Reset |
| Gaze samples for the heatmap (card-relative x/y points) | Memory | The current request |
| UI preferences (overlay, diagnostics) | `localStorage` | Until cleared |
| Optional study dataset (schema v2, see below) | `localStorage` | Until cleared in the Model lab |

Nothing is sent to a server except approval-request **text** for semantic analysis (`/api/analyze`). If an AI provider is configured, that text is forwarded to it server-side. Camera data never exists on the server.

## Study dataset (Model lab, schema v2)

Collection is opt-in and runs only while an operator has started a collection session in the Model lab. Each decision in the session stores one entry with:

- `sessionId`: a random id for the collection session; `participant`: a **pseudonymous code** typed by the operator (letters then digits, such as `P03`). The app rejects anything that looks like a name or an email.
- `scenarioId`, `condition` (the instructed condition: attentive, rapid approval, low attention, distracted, camera uncertain), `label` (derived from the condition), `risk`, `order` within the session.
- `tRelMs`: milliseconds since the collection session started. **No absolute timestamps** are stored; the schema rejects values that look like clock times.
- A calibration summary (quality, held-out median / 90th-percentile error, sigma) and a trust summary (level, confidence, effective frame rate, share of frames outside the calibrated posture).
- Named derived features (coverage, latency ratio, fixation counts, visibility, pointer and scroll activity, and temporal features of the session) with a feature-schema version. Missing evidence is recorded as missing.
- The deterministic outcome (thoroughness, intervention level, mode) and the inputs the policy used (scores, coverage, anomaly, trust level, session pattern), so decisions can be replayed in an evaluation.
- `policyVersion` and `appVersion`.

Never stored: video, images, face landmarks, identity, names, emails, clock times. Export is a JSON file; import validates the schema field by field. Legacy v1 files can still be imported for reference; they are kept apart, read-only, and never used for v2 models. The Model lab shows a notice to read to participants, and **Clear** removes everything. Get each participant's consent before collecting.

## Choice and accessibility

- Camera use is opt-in on the setup screen, and "Continue without camera" is always available.
- The camera can be turned off at any time from the setup screen; closing the tab ends processing.
- Without a camera, OverSight uses interaction timing only and asks for **manual acknowledgement** of critical consequences (typing the consequence's key number, or confirming it when it has none). The same path is available inside any intervention via "I cannot use camera-based attention verification".
- When the face is not visible, OverSight pauses gaze-based judgement and falls back to behavioral signals. It never treats a missing face as evidence of not reading.

## Scope of claims

OverSight detects evidence that decision-critical information was probably not visually inspected. It does not claim comprehension, intent, or anything about the reviewer as a person. Session views explain decisions; they are not productivity or performance metrics.
