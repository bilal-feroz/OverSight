import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "How it works" };

const LAYERS = [
  {
    n: "01",
    name: "Semantic risk engine",
    kind: "AI layer",
    body: [
      "Every approval request is split into typed blocks with stable ids (title, reasoning, resources, changes, consequences).",
      "A deterministic rule engine grades each block (irreversible deletion, public exposure, unverified payees, sensitive data leaving the organization, outages, permission escalation...) and selects at most two attention targets.",
      "If an OpenAI-compatible model is configured, its analysis is merged on top. It can escalate, never de-escalate below the rules: a deterministic safety floor.",
    ],
  },
  {
    n: "02",
    name: "On-device computer vision",
    kind: "CV layer",
    body: [
      "MediaPipe Face Landmarker (478 landmarks with iris refinement) runs in the browser via WebAssembly. Frames are reduced to a handful of numbers: iris position inside each eye, eye-direction coefficients, head yaw/pitch, face position.",
      "Calibration fits ridge-regression models from those features to screen coordinates: 9 dots, then a few seconds of looking at a dot while turning the head, so ordinary head movement does not throw gaze off. Accuracy is then measured on 5 dots that were never used for fitting and reported as Good, Fair or Recalibration recommended.",
      "Gaze is smoothed with a One Euro filter and carries its measured uncertainty. Evidence for each critical sentence is weighted by how compatible every estimate is with looking at its live bounding box. When gaze at that accuracy cannot tell the sentence apart from the title or the buttons, OverSight says so and relies on interaction timing instead.",
    ],
  },
  {
    n: "03",
    name: "Behavioral signals & ML",
    kind: "Behavioral layer",
    body: [
      "Approval latency is compared with the reviewer's own baseline from their first attentive reviews, not with a fixed wait time.",
      "Visibility, scroll depth, fixations and sweep across the critical sentence add evidence; a rapid-approval streak and a declining attention trend raise intervention sensitivity.",
      "A logistic-regression classifier can be trained on labeled reviews in the Model lab. It ships untrained and, once validated, is advisory only.",
    ],
  },
  {
    n: "04",
    name: "Deterministic safety engine",
    kind: "Decision layer",
    body: [
      "An explainable attention-evidence score combines critical-region coverage, reading evidence, latency, visibility, presence and the session pattern.",
      "Risk sets the thresholds: routine requests are never blocked; critical ones pause when the critical consequence received near-zero attention.",
      "Every decision carries plain-language reasons, and approval re-enables only after the missed consequence is visually reviewed or manually acknowledged.",
    ],
  },
];

const LADDER = [
  { level: "0", name: "Normal", body: "No interruption.", tone: "text-safe" },
  { level: "1", name: "Nudge", body: "Subtle highlight; approval proceeds.", tone: "text-warn" },
  { level: "2", name: "Refocus", body: "Approve becomes “Review critical consequence →” and the sentence is brought into focus.", tone: "text-warn" },
  { level: "3", name: "Pause", body: "Only for high/critical risk with near-zero attention: the request collapses to the missed consequence until it is re-reviewed.", tone: "text-critical" },
];

export default function HowItWorks() {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="mx-auto flex h-16 max-w-[1100px] items-center justify-between px-6">
        <Logo />
        <Link href="/setup" className={cn(buttonVariants({ variant: "primary", size: "sm" }))}>
          Start demo <ArrowRight aria-hidden />
        </Link>
      </header>
      <main id="main" className="mx-auto max-w-[1100px] px-6 pb-20 pt-10">
        <div className="eyebrow">How it works</div>
        <h1 className="mt-3 max-w-[22ch] text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] md:text-[52px]">
          Checking attention where it matters, and nowhere else.
        </h1>
        <p className="mt-5 max-w-[68ch] text-[16px] leading-relaxed text-fg-muted">
          Human-in-the-loop controls assume the human is reading. Under a steady stream of routine approvals, sign-off
          becomes a reflex: the one request that deletes customer data looks like the nine before it. A click proves
          a decision was made, not that the consequence was seen. OverSight adds the missing evidence.
        </p>

        <section aria-label="Layers" className="mt-12 grid gap-4 md:grid-cols-2">
          {LAYERS.map((l) => (
            <article key={l.n} className="rounded-xl border border-line bg-raised p-6">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[12px] text-fg-subtle">{l.n}</span>
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-intel">{l.kind}</span>
              </div>
              <h2 className="mt-2 text-[19px] font-semibold tracking-tight">{l.name}</h2>
              <ul className="mt-3 space-y-2 text-[14px] leading-relaxed text-fg-muted">
                {l.body.map((b) => (
                  <li key={b} className="flex gap-2">
                    <span className="mt-[9px] size-1 shrink-0 rounded-full bg-fg-subtle" aria-hidden />
                    {b}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>

        <section aria-labelledby="ladder" className="mt-14">
          <h2 id="ladder" className="text-[22px] font-semibold tracking-tight">Intervention ladder</h2>
          <ol className="mt-5 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-4">
            {LADDER.map((s) => (
              <li key={s.level} className="bg-raised p-5">
                <div className={cn("font-mono text-[11px] uppercase tracking-[0.14em]", s.tone)}>Level {s.level}</div>
                <div className="mt-1.5 text-[16px] font-semibold">{s.name}</div>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-muted">{s.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-4 max-w-[76ch] text-[14px] leading-relaxed text-fg-muted">
            Across the session, OverSight also watches the sequence of approvals. When review attention declines across
            consecutive approvals it reports an approval fatigue pattern, raises intervention sensitivity and can switch
            to critical-only review mode. This describes behavior in the interaction; it is not a claim that anyone is
            tired.
          </p>
        </section>

        <section id="privacy" aria-labelledby="privacy-title" className="mt-14 grid gap-8 rounded-xl border border-line bg-raised p-6 md:grid-cols-[1fr_1.3fr]">
          <div>
            <h2 id="privacy-title" className="text-[22px] font-semibold tracking-tight">Privacy architecture</h2>
            <p className="mt-2 text-[15px] font-medium text-fg">Video never leaves this device.</p>
            <p className="mt-1 text-[14px] text-fg-muted">We monitor the approval interaction, not the employee.</p>
          </div>
          <ul className="space-y-2 text-[14px] leading-relaxed text-fg-muted">
            <li>Camera frames are processed in the browser tab and discarded; no frame is uploaded, stored or recorded.</li>
            <li>The page&apos;s Content Security Policy only allows network connections back to this origin.</li>
            <li>No facial recognition or identity model; no age, gender, ethnicity or emotion inference.</li>
            <li>Only eye-direction and blink coefficients are read from the face model; every other coefficient is discarded.</li>
            <li>Stored: derived numbers only (coverage, latency, dwell), in this browser session. Calibration is a few dozen numbers.</li>
            <li>The only server call sends approval-request text for semantic analysis, never camera data.</li>
            <li>A camera-free mode with manual acknowledgement is always available.</li>
          </ul>
        </section>

        <section aria-labelledby="limits" className="mt-14">
          <h2 id="limits" className="text-[22px] font-semibold tracking-tight">Honest limitations</h2>
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {[
              "Commodity webcam gaze is approximate (often 100–200 px of error). OverSight therefore checks whole regions, not individual words.",
              "Looking at a sentence is evidence of inspection, not of comprehension. OverSight never claims the latter.",
              "Calibration covers moderate head movement. Resizing, zooming or moving the window makes it stale, and OverSight stops using gaze until you recalibrate.",
              "Glasses, strong backlight and low light reduce landmark quality; the system degrades to behavioral signals rather than guessing.",
              "The ML classifier ships untrained. Any accuracy figure must come from your own labeled sessions.",
              "Rule-based semantic analysis covers common high-risk patterns; the optional AI layer extends coverage.",
            ].map((t) => (
              <li key={t} className="rounded-lg border border-line bg-raised px-4 py-3 text-[14px] leading-relaxed text-fg-muted">
                {t}
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-14 flex flex-wrap gap-3">
          <Link href="/setup" className={cn(buttonVariants({ variant: "primary", size: "lg" }))}>
            Start demo <ArrowRight aria-hidden />
          </Link>
          <Link href="/console" className={cn(buttonVariants({ variant: "secondary", size: "lg" }))}>
            Open console without camera
          </Link>
        </div>
      </main>
    </div>
  );
}
