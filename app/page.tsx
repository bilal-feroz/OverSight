import Link from "next/link";
import { ArrowRight, Bot, Eye, Hand, LockKeyhole, ScanText } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ExplainerVideoButton } from "@/components/brand/explainer-video";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FLOW = [
  {
    icon: Bot,
    title: "AI action",
    body: "An agent proposes a consequential action and asks a human to approve it.",
  },
  {
    icon: ScanText,
    title: "Semantic risk",
    body: "OverSight finds the few sentences that materially affect the decision.",
  },
  {
    icon: Eye,
    title: "Human attention",
    body: "On-device gaze and interaction signals show whether those sentences were looked at.",
  },
  {
    icon: Hand,
    title: "Intelligent intervention",
    body: "Only when critical content was skipped, approval pauses on exactly what was missed.",
  },
];

const PRINCIPLES = [
  {
    title: "Intervene only when necessary",
    body: "Friction depends on risk, attention evidence, critical-region coverage and behavioral anomaly. Routine approvals stay fast.",
  },
  {
    title: "Critical information, not all information",
    body: "Nobody is asked to stare at every field. Attention is checked against the consequences that change the decision.",
  },
  {
    title: "Privacy by design",
    body: "Video never leaves the device. No facial recognition, no identity, no emotion inference. It works without a camera, too.",
  },
];

const NOT_CLAIMED = [
  "It does not know whether you understood a request.",
  "It does not infer tiredness, stress or any psychological state.",
  "It is not medical-grade or research-grade eye tracking.",
  "It does not identify, recognize or profile the reviewer.",
];

export default function Landing() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
        <Logo />
        <nav aria-label="Primary" className="flex items-center gap-1 text-[13.5px]">
          <Link href="/how-it-works" className="rounded-md px-3 py-1.5 text-fg-muted hover:text-fg">
            How it works
          </Link>
          <Link href="/console" className="rounded-md px-3 py-1.5 text-fg-muted hover:text-fg">
            Console
          </Link>
        </nav>
      </header>

      <main id="main">
        <section className="relative mx-auto grid max-w-[1200px] items-center gap-14 px-6 pb-20 pt-14 lg:grid-cols-[1.15fr_1fr] lg:pt-24">
          <div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <div className="eyebrow">Human-in-the-loop safety · Approval fatigue</div>
              <ExplainerVideoButton />
            </div>
            <h1 className="mt-5 max-w-[15ch] text-[48px] font-semibold leading-[1] tracking-[-0.045em] md:text-[72px]">
              Human approval shouldn&apos;t mean <span className="metallic-text animate-metallic-sheen">human autopilot.</span>
            </h1>
            <p className="mt-6 max-w-[56ch] text-[17px] leading-relaxed text-fg-muted">
              AI agents ask people to sign off on consequential actions. After enough routine requests, people stop
              reading. OverSight checks whether the information that materially affects a decision was actually looked
              at, and steps in only when the evidence says it wasn&apos;t.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/setup" className={cn(buttonVariants({ variant: "shiny", size: "lg" }))}>
                Start demo <ArrowRight aria-hidden />
              </Link>
              <Link href="/how-it-works" className={cn(buttonVariants({ variant: "secondary", size: "lg" }))}>
                How it works
              </Link>
            </div>
            <p className="mt-5 inline-flex items-center gap-2 text-[13px] text-fg-subtle">
              <LockKeyhole className="size-3.5 text-safe" aria-hidden />
              Proof that human oversight was actually human. Video never leaves this device.
            </p>
          </div>

          <HeroIllustration />
        </section>

        <section aria-labelledby="flow" className="border-y border-line bg-base">
          <div className="mx-auto max-w-[1200px] px-6 py-14">
            <h2 id="flow" className="eyebrow">How a decision flows</h2>
            <ol className="mt-6 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-4">
              {FLOW.map((step, i) => (
                <li key={step.title} className="relative bg-raised p-5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-fg-subtle">0{i + 1}</span>
                    <step.icon className="size-4 text-intel" aria-hidden />
                  </div>
                  <h3 className="mt-3 text-[16px] font-semibold tracking-tight">{step.title}</h3>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-muted">{step.body}</p>
                  {i < FLOW.length - 1 && (
                    <ArrowRight className="absolute right-3 top-5 hidden size-3.5 text-fg-subtle md:block" aria-hidden />
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="sav" className="mx-auto max-w-[1200px] px-6 py-16">
          <h2 id="sav" className="eyebrow">Semantic attention verification</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <blockquote className="rounded-xl border border-line bg-raised p-6">
              <p className="text-[13px] text-fg-subtle">Traditional eye tracking asks</p>
              <p className="mt-2 text-[22px] font-medium tracking-tight text-fg-muted">&ldquo;Where did the user look?&rdquo;</p>
            </blockquote>
            <blockquote className="rounded-xl border border-intel/30 bg-intel/[0.04] p-6">
              <p className="text-[13px] text-intel">OverSight asks</p>
              <p className="mt-2 text-[22px] font-medium tracking-tight text-fg">
                &ldquo;Did the user visually inspect the information that materially affects this decision?&rdquo;
              </p>
            </blockquote>
          </div>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {PRINCIPLES.map((p) => (
              <div key={p.title}>
                <h3 className="text-[16px] font-semibold tracking-tight">{p.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">{p.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="claims" className="border-t border-line">
          <div className="mx-auto grid max-w-[1200px] gap-8 px-6 py-14 md:grid-cols-[1fr_1.4fr]">
            <div>
              <h2 id="claims" className="text-[22px] font-semibold tracking-tight">What OverSight does not claim</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">
                It detects behavioral evidence that decision-critical information was probably not visually inspected
                before approval. That narrower claim is the one it can actually support.
              </p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {NOT_CLAIMED.map((c) => (
                <li key={c} className="rounded-lg border border-line bg-raised px-4 py-3 text-[14px] text-fg-muted">
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-6 py-6 text-[12.5px] text-fg-subtle">
          <span>OverSight · hackathon prototype for the Approval Fatigue challenge</span>
          <span>We monitor the approval interaction, not the employee.</span>
        </div>
      </footer>
    </div>
  );
}

/** A schematic of the core moment. Explicitly an illustration, not a measurement. */
function HeroIllustration() {
  return (
    <figure className="relative m-0" aria-label="Illustration of an approval paused on a skipped consequence">
      <div className="stage-glow rounded-2xl border border-line bg-raised p-5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] text-fg-subtle">release-orchestrator · requests approval</span>
          <span className="rounded-md border border-critical/50 bg-critical/10 px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-critical">
            Paused
          </span>
        </div>
        <div className="relative mt-4">
          <div
            aria-hidden
            className="absolute -left-4 -top-6 h-24 w-56 rounded-full bg-[radial-gradient(ellipse,rgba(206,215,227,0.22),transparent_70%)] blur-md"
          />
          <p className="relative text-[20px] font-semibold tracking-tight">Deploy Database Configuration</p>
          <p className="relative mt-1 text-[13px] text-fg-muted">This deployment updates the production database configuration.</p>
        </div>
        <div className="mt-4 space-y-1.5 text-[12.5px]">
          <Row>Connection pool resizes; clients reconnect within about 2 seconds.</Row>
          <Row>Read replicas restart one at a time.</Row>
          <div className="relative rounded-lg border border-dashed border-critical/80 bg-critical/[0.07] px-3 py-2 text-fg">
            <span className="absolute -top-2.5 left-3 bg-raised px-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-critical">
              Decision-critical · not inspected
            </span>
            This migration will permanently delete 2,431 customer records.
          </div>
          <Row>A configuration snapshot is written to the audit log.</Row>
        </div>
        <div className="mt-4 flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2.5">
          <span className="text-[12.5px] text-fg">You may have missed a critical consequence.</span>
          <span className="font-mono text-[11px] text-critical">Review →</span>
        </div>
      </div>
      <figcaption className="mt-3 text-center font-mono text-[10.5px] uppercase tracking-[0.14em] text-fg-subtle">
        Illustration · live demo uses your camera
      </figcaption>
    </figure>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-lg px-3 py-2 text-fg-muted">
      <span className="mt-[7px] size-1 shrink-0 rounded-full bg-fg-subtle" aria-hidden />
      {children}
    </div>
  );
}
