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
| Calibration model (a few dozen regression coefficients) | `sessionStorage` | This browser tab |
| Approval records: latency, coverage, attention score, intervention, reasons | `sessionStorage` | This browser tab; cleared by Reset |
| Gaze samples for the heatmap (card-relative x/y points) | Memory | The current request |
| UI preferences (overlay, diagnostics) | `localStorage` | Until cleared |
| Optional labeled dataset for the classifier (14 derived features per review) | `localStorage` | Until cleared in the Model lab |

Nothing is sent to a server except approval-request **text** for semantic analysis (`/api/analyze`). If an AI provider is configured, that text is forwarded to it server-side. Camera data never exists on the server.

## Choice and accessibility

- Camera use is opt-in on the setup screen, and "Continue without camera" is always available.
- The camera can be turned off at any time from the setup screen; closing the tab ends processing.
- Without a camera, OverSight uses interaction timing only and asks for **manual acknowledgement** of critical consequences (typing the consequence's key number, or confirming it when it has none). The same path is available inside any intervention via "I cannot use camera-based attention verification".
- When the face is not visible, OverSight pauses gaze-based judgement and falls back to behavioral signals. It never treats a missing face as evidence of not reading.

## Scope of claims

OverSight detects evidence that decision-critical information was probably not visually inspected. It does not claim comprehension, intent, or anything about the reviewer as a person. Session views explain decisions; they are not productivity or performance metrics.
