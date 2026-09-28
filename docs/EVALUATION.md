# Evaluation

OverSight's safety decision is made by deterministic rules. A learned model may only ever *raise* concern, and only if it demonstrably helps. This document fixes how that is measured. Nothing in this repository is a result: there is no dataset and no trained model, and the synthetic fixtures in `tests/` exercise code paths only.

## 1. Collecting data (Model lab)

A **collection session** walks one participant through 18 approval requests in counterbalanced blocks of instructed conditions:

| Condition | Reviews | Instruction shown in the console | Label |
|---|---|---|---|
| Attentive | 4 | "Review as you normally would when it matters." | ATTENTIVE |
| Rapid approval | 4 | "Approve each request as fast as you comfortably can." | LOW_ATTENTION |
| Low attention | 4 | "Read only the title and summary, then decide." | LOW_ATTENTION |
| Distracted | 3 | "Look away from the screen for a few seconds during the review, then approve without re-reading." | LOW_ATTENTION |
| Camera uncertain | 3 | "Review carefully while moving around or leaning away (tracking will be poor)." | ATTENTIVE |

- **Block order** comes from a cyclic Latin square keyed by the participant code: across five consecutive codes (P01 to P05), every condition appears once in every block position. Codes are pseudonymous and chosen by the operator; the app rejects names and emails.
- **Scenarios** are shuffled per session (a fresh random session id seeds the shuffle), cycling through the seeded requests without immediate repeats.
- **Interventions** are computed and stored but not enforced while collecting.
- Camera-uncertain reviews are *attentive* reviews under poor tracking: they measure false interventions when gaze is unreliable, which matters most.
- Tell each participant what is recorded (see `docs/PRIVACY.md`) and get consent before starting. Calibrate once per participant.

Instructed conditions are weak supervision: they make low-attention behavior likely, not certain. Results must be reported with that caveat.

Each decision stores a schema-v2 entry (`lib/ml/dataset.ts`): session id, participant code, scenario, condition, label, risk, order, time since session start (no clock times), calibration and trust summaries, named features (`lib/ml/features.ts`, feature schema v2), the deterministic outcome, and the policy inputs needed to replay the decision (`lib/ml/replay.ts`).

## 2. Grouped evaluation

`npm run evaluate -- <dataset.json> [--out reports/<name>]` (`scripts/evaluate-attention.ts`, `lib/ml/evaluate.ts`) writes a markdown and a JSON report.

- **Grouping**: leave-one-participant-out cross-validation. With fewer than 5 participants it falls back to leave-one-session-out and prints a loud warning; no adoption decision can be made then.
- **No leakage**: feature standardization, missing-value imputation and Platt calibration are fitted inside the training folds only. A participant (or session) is never in both the training and the test fold. Features use only data available at decision time within the same session.
- **Models compared on identical folds**:
  - (a) *rules*: the deterministic policy's replayed decisions, and its continuous anomaly and pattern scores as rankers;
  - (b) logistic regression on current-review features;
  - (c) logistic regression on current-review + temporal + personal-baseline features;
  - (d) gradient-boosted trees: only with at least 8 participants, offline (not included in the app).

## 3. Metrics

- Discrimination and calibration (positive class = LOW_ATTENTION): PR-AUC, ROC-AUC, Brier score with reliability bins.
- **Policy level**, by replaying `decideIntervention` on every entry with and without the model's out-of-fold probability:
  - **False-intervention rate (FIR)**: share of ATTENTIVE approvals that receive REFOCUS or PAUSE.
  - **Missed-dangerous-approval rate (MDAR)**: share of LOW_ATTENTION approvals of HIGH or CRITICAL requests that receive no intervention (NORMAL).
- Everything overall and per condition. FIR under *camera uncertain* matters most.
- 95% confidence intervals by bootstrap resampling of participants.
- Sample sizes are always printed. With fewer than 3 groups a metric is printed as "insufficient data".

## 4. Pre-registered decision rule

Written on 2026-09-28, before any data was collected:

> Adopt the ML model only if, at a false-intervention rate within ±1 percentage point of the rule baseline, the missed-dangerous-approval rate drops by at least 20% relative, with a participant-bootstrap 95% confidence interval of that reduction that excludes 0, on at least 5 participants. Otherwise ship rules only and say so.

"At a false-intervention rate within ±1 point" means the model's thresholds are chosen on the training folds only, and the rule holds only if the *held-out* FIR also stays within ±1 point. A model whose metadata does not record a passing evaluation is never activated by the app (see `docs/TUNING.md`, ML influence).

## 5. What the app does with a model

Even a model that passes stays advisory (`lib/risk/intervention.ts`): above its sensitivity threshold it can raise intervention sensitivity (within the existing 1.5x cap), and when gaze trust is below high it can turn NORMAL or NUDGE on a MEDIUM-or-higher request into a REFOCUS with manual verification. It never lowers a level and never produces a PAUSE on its own.
