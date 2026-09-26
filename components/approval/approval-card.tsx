"use client";

import { Fragment, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bot, Check, ChevronDown, CircleCheck, TriangleAlert, X } from "lucide-react";
import type { ApprovalRequest, ContentBlock } from "@/types/approval";
import type { CriticalRegion, SemanticAnalysis } from "@/types/semantic";
import type { ActiveApproval } from "@/lib/store/session-store";
import { AttentionRegion, RegionScope } from "@/components/attention/attention-region";
import { AttentionOverlay } from "@/components/attention/attention-overlay";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/misc";
import { isDecisionCritical } from "@/lib/risk/levels";
import { findBlock, focusRegionFor } from "@/lib/attention/targets";
import { cn, wordCount } from "@/lib/utils";
import { BlockText } from "./block-text";
import { DecisionBar } from "./decision-bar";
import { ManualAck } from "./manual-ack";

export interface ApprovalCardProps {
  request: ApprovalRequest;
  analysis: SemanticAnalysis | null;
  active: ActiveApproval;
  criticalOnly: boolean;
  overlay: boolean;
  cardRef: React.RefObject<HTMLElement | null>;
  reReviewProgress: number;
  reReviewSatisfied: boolean;
  onApprove: () => void;
  onReject: () => void;
  onConfirm: () => void;
  onReviewFocus: () => void;
  onManual: () => void;
}

export function ApprovalCard(props: ApprovalCardProps) {
  const { request, analysis, active, criticalOnly, overlay, cardRef } = props;
  const phase = active.phase;
  const regions = new Map<string, CriticalRegion>((analysis?.criticalRegions ?? []).map((r) => [r.fieldId, r]));
  const focusId = phase === "refocus" ? active.focusFieldId : null;
  const summaryRegion = regions.get("summary");
  const focusRegion = focusId && analysis ? focusRegionFor(request, analysis, focusId) : null;
  const focusKind = focusId ? (findBlock(request, focusId)?.kind ?? "summary") : null;
  const refocusProps: RefocusProps | null =
    focusId && focusRegion
      ? {
          satisfied: props.reReviewSatisfied,
          progress: props.reReviewProgress,
          manual: active.manual,
          statement: focusRegion.statement,
          onConfirm: props.onConfirm,
          onManual: props.onManual,
        }
      : null;
  const hasTarget = (blocks: ContentBlock[]) => blocks.some((b) => regions.has(b.id));
  const hasFocus = (blocks: ContentBlock[]) => blocks.some((b) => b.id === focusId);
  // Decision-critical content is never collapsed, and the section being re-reviewed is never dimmed.
  const collapseRoutine = (blocks: ContentBlock[]) => criticalOnly && !hasTarget(blocks);
  const dimUnlessFocused = (blocks: ContentBlock[]) => Boolean(focusId) && !hasFocus(blocks);

  const reasoning = request.blocks.filter((b) => b.kind === "reasoning");
  const resources = request.blocks.filter((b) => b.kind === "resource");
  const changes = request.blocks.filter((b) => b.kind === "change");
  const consequences = request.blocks.filter((b) => b.kind === "consequence" || b.kind === "detail");
  const metadata = request.blocks.filter((b) => b.kind === "metadata");
  const production = /\bprod(uction)?\b/i.test(request.environment);

  return (
    <RegionScope value={request.id}>
    <article
      ref={cardRef as React.RefObject<HTMLElement>}
      data-oversight-card
      data-item-id={request.id}
      aria-labelledby="approval-title"
      className="relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-raised shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_24px_48px_-24px_rgba(0,0,0,0.6)]"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3.5 short:py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <div
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-line-strong bg-surface text-fg-muted"
          >
            <Bot className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13.5px] text-fg">
              <span className="font-medium">{request.agent.name}</span>{" "}
              <span className="text-fg-muted">requests approval</span>
            </p>
            <p className="truncate font-mono text-[11.5px] text-fg-subtle">
              {request.agent.handle} · {request.requestedAgo}
            </p>
          </div>
        </div>
        <DecisionBar
          phase={phase}
          satisfied={props.reReviewSatisfied}
          onApprove={props.onApprove}
          onReject={props.onReject}
          onConfirm={props.onConfirm}
          onReviewFocus={props.onReviewFocus}
        />
      </header>

      <OutcomeBanner active={active} />

      {refocusProps && focusKind && !["consequence", "detail", "summary"].includes(focusKind) && (
        <div className="px-6 pt-4">
          <RefocusCallout {...refocusProps} showStatement />
        </div>
      )}

      <div className="px-6 pb-4 pt-5 short:pb-3 short:pt-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="font-mono">{request.actionType}</Badge>
          <Badge tone={production ? "warn" : "neutral"} className="font-mono">
            {request.environment}
          </Badge>
          {request.reference && <span className="font-mono text-[11.5px] text-fg-subtle">{request.reference}</span>}
        </div>
        <AttentionRegion
          regionId="title"
          regionRole={regions.has("title") ? "target" : "context"}
          label="Title"
          words={wordCount(request.title)}
          severity={regions.get("title")?.severity}
          tabIndex={focusId === "title" ? -1 : undefined}
          className={cn(
            "outline-none",
            focusId === "title" && "-mx-3 rounded-lg border border-critical/60 bg-critical/[0.07] px-3 pb-2",
          )}
        >
          <h2
            id="approval-title"
            className="mt-3 text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] text-fg short:mt-2 short:text-[23px]"
          >
            {request.title}
          </h2>
        </AttentionRegion>
        {/* When the only statement of the risk is the summary, the summary is the attention target. */}
        {focusKind === "summary" && refocusProps && (
          <div className="mt-3">
            <RefocusCallout {...refocusProps} />
          </div>
        )}
        <AttentionRegion
          regionId="summary"
          regionRole={summaryRegion ? "target" : "context"}
          label="Summary"
          words={wordCount(request.summary)}
          severity={summaryRegion?.severity}
          tabIndex={focusId === "summary" ? -1 : undefined}
          className={cn(
            "outline-none",
            summaryRegion && "-mx-3 mt-1 rounded-lg border px-3 py-1.5",
            summaryRegion && (focusId === "summary" || criticalOnly)
              ? "border-critical/60 bg-critical/[0.07] motion-safe:animate-pulse-once"
              : "border-transparent",
          )}
        >
          <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-fg-muted short:mt-1 short:text-[14px]">
            <BlockText
              text={request.summary}
              phrase={summaryRegion?.phrase}
              emphasize={Boolean(summaryRegion) && (criticalOnly || focusId === "summary")}
            />
          </p>
          {summaryRegion && (
            <span className="mt-1 inline-block font-mono text-[10px] uppercase tracking-[0.12em] text-critical/80">
              {isDecisionCritical(summaryRegion.severity) ? "Decision-critical" : "Key detail"}
            </span>
          )}
        </AttentionRegion>
      </div>

      {!analysis ? (
        <AnalyzingSkeleton />
      ) : (
        <>
          {reasoning.length > 0 && (
            <CollapsibleSection
              label="Agent reasoning"
              collapsedByDefault={collapseRoutine(reasoning)}
              forceOpen={hasFocus(reasoning)}
              summary={reasoning[0].text}
              dim={dimUnlessFocused(reasoning)}
            >
              {reasoning.map((b) => (
                <AttentionRegion
                  key={b.id}
                  regionId={b.id}
                  regionRole={regions.has(b.id) ? "target" : "content"}
                  label="Agent reasoning"
                  words={wordCount(b.text)}
                  severity={regions.get(b.id)?.severity}
                  tabIndex={focusId === b.id ? -1 : undefined}
                  className={cn("outline-none", focusId === b.id && focusRing)}
                >
                  <p className="max-w-[68ch] text-[14px] leading-relaxed text-fg/85 short:text-[13.5px]">{b.text}</p>
                </AttentionRegion>
              ))}
            </CollapsibleSection>
          )}

          {(resources.length > 0 || changes.length > 0) && (
            <div className="grid border-t border-line md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              {resources.length > 0 && (
                <CollapsibleSection
                  bare
                  label="Affected resources"
                  count={resources.length}
                  collapsedByDefault={collapseRoutine(resources)}
                  forceOpen={hasFocus(resources)}
                  summary={resources.map((r) => r.text).join(", ")}
                  dim={dimUnlessFocused(resources)}
                >
                  <div className="flex flex-wrap gap-1.5" role="list">
                    {resources.map((b) => (
                      <AttentionRegion
                        key={b.id}
                        role="listitem"
                        regionId={b.id}
                        regionRole={regions.has(b.id) ? "target" : "content"}
                        label="Affected resource"
                        words={wordCount(b.text)}
                        severity={regions.get(b.id)?.severity}
                        tabIndex={focusId === b.id ? -1 : undefined}
                        className={cn(
                          "rounded-md border border-line bg-surface px-2 py-1 font-mono text-[12px] text-fg-muted outline-none",
                          regions.has(b.id) && "border-critical/50 text-fg",
                          focusId === b.id && focusRing,
                        )}
                      >
                        {b.text}
                      </AttentionRegion>
                    ))}
                  </div>
                </CollapsibleSection>
              )}
              {changes.length > 0 && (
                <CollapsibleSection
                  bare
                  className="md:border-l md:border-line"
                  label="Changes"
                  count={changes.length}
                  collapsedByDefault={collapseRoutine(changes)}
                  forceOpen={hasFocus(changes)}
                  summary={changes.map((c) => c.label ?? c.text).join(", ")}
                  dim={dimUnlessFocused(changes)}
                >
                  <div role="list" className="divide-y divide-line/70 overflow-hidden rounded-lg border border-line">
                    {changes.map((b) => (
                      <ChangeRow key={b.id} block={b} region={regions.get(b.id)} focused={focusId === b.id} />
                    ))}
                  </div>
                </CollapsibleSection>
              )}
            </div>
          )}

          {consequences.length > 0 && (
            <section className="border-t border-line px-6 py-4 short:py-3" aria-label="Consequences">
              <h3 className="eyebrow mb-2.5 short:mb-1.5">{request.source === "custom" ? "Request details" : "Consequences"}</h3>
              <ConsequenceList
                blocks={consequences}
                regions={regions}
                focusId={focusId}
                criticalOnly={criticalOnly}
                refocus={focusKind === "consequence" || focusKind === "detail" ? refocusProps : null}
              />
            </section>
          )}

          {metadata.length > 0 && (
            <footer
              className={cn(
                "border-t border-line px-6 py-3 transition-opacity short:py-2",
                dimUnlessFocused(metadata) && "opacity-35",
              )}
            >
              {metadata.map((b) => (
                <AttentionRegion
                  key={b.id}
                  regionId={b.id}
                  regionRole={regions.has(b.id) ? "target" : "content"}
                  label="Metadata"
                  words={wordCount(b.text)}
                  severity={regions.get(b.id)?.severity}
                  tabIndex={focusId === b.id ? -1 : undefined}
                  className={cn("outline-none", focusId === b.id && focusRing)}
                >
                  <p className="font-mono text-[11.5px] text-fg-subtle">{b.text}</p>
                </AttentionRegion>
              ))}
            </footer>
          )}
        </>
      )}

      {overlay && analysis && (phase === "reviewing" || phase === "refocus") && <AttentionOverlay cardRef={cardRef} />}
    </article>
    </RegionScope>
  );
}

function OutcomeBanner({ active }: { active: ActiveApproval }) {
  const decision = active.evaluation?.decision;
  const show = active.phase === "approved" || active.phase === "rejected";
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
          role="status"
        >
          {active.phase === "approved" ? (
            <div
              className={cn(
                "flex items-center gap-2 border-b px-6 py-2.5 text-[13px]",
                decision?.level === "NUDGE"
                  ? "border-warn/30 bg-warn/[0.07] text-warn"
                  : "border-safe/30 bg-safe/[0.07] text-safe",
              )}
            >
              <Check className="size-4 shrink-0" aria-hidden />
              <span className="font-medium">
                {active.outcome === "approved_after_review"
                  ? "Approved after review · critical consequence reviewed"
                  : active.label
                    ? `Approved · recorded as ${active.label.replace("_", " ").toLowerCase()} example`
                    : decision?.headline}
              </span>
              {decision?.level === "NUDGE" && decision.reasons[0] && (
                <span className="truncate text-fg-muted">· {decision.reasons[0].text}</span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 border-b border-line bg-surface px-6 py-2.5 text-[13px] text-fg-muted">
              <X className="size-4 shrink-0" aria-hidden />
              <span className="font-medium text-fg">Rejected</span>
              <span>· The agent&apos;s action will not run.</span>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CollapsibleSection({
  label,
  count,
  summary,
  collapsedByDefault,
  forceOpen,
  children,
  className,
  bare,
  dim,
}: {
  label: string;
  count?: number;
  summary: string;
  collapsedByDefault: boolean;
  /** Always expanded (the section holds content that is being re-reviewed). */
  forceOpen?: boolean;
  children: React.ReactNode;
  className?: string;
  bare?: boolean;
  dim?: boolean;
}) {
  const [override, setOverride] = useState<boolean | null>(null);
  const collapsed = forceOpen ? false : (override ?? collapsedByDefault);
  return (
    <section
      className={cn(
        "px-6 py-4 transition-opacity duration-200 short:py-3",
        !bare && "border-t border-line",
        dim && "opacity-35",
        className,
      )}
      aria-label={label}
    >
      <div className="mb-2.5 flex items-center justify-between gap-3 short:mb-1.5">
        <h3 className="eyebrow">
          {label}
          {count ? ` · ${count}` : ""}
        </h3>
        {collapsedByDefault && (
          <button
            type="button"
            onClick={() => setOverride(!collapsed)}
            className="inline-flex items-center gap-1 text-[11.5px] text-fg-subtle hover:text-fg"
            aria-expanded={!collapsed}
          >
            {collapsed ? "Show" : "Hide"}
            <ChevronDown className={cn("size-3.5 transition-transform", !collapsed && "rotate-180")} aria-hidden />
          </button>
        )}
      </div>
      {collapsed ? <p className="truncate text-[13px] text-fg-subtle">{summary}</p> : children}
    </section>
  );
}

function ChangeRow({ block, region, focused }: { block: ContentBlock; region?: CriticalRegion; focused?: boolean }) {
  return (
    <AttentionRegion
      role="listitem"
      regionId={block.id}
      regionRole={region ? "target" : "content"}
      label={block.label ? `Change · ${block.label}` : "Change"}
      words={wordCount(block.text)}
      severity={region?.severity}
      tabIndex={focused ? -1 : undefined}
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 bg-raised px-3 py-2 font-mono text-[12.5px] outline-none short:py-1.5",
        region && "bg-critical/[0.05]",
        focused && focusRing,
      )}
    >
      <span className="min-w-0 break-words text-fg-muted">{block.label ?? block.text}</span>
      {block.label && (
        <span className="ml-auto text-right">
          {block.from && (
            <>
              <span className="text-fg-subtle">{block.from}</span>
              <span className="px-1.5 text-fg-subtle">→</span>
            </>
          )}
          <span className="text-fg">{block.to}</span>
        </span>
      )}
    </AttentionRegion>
  );
}

interface RefocusProps {
  satisfied: boolean;
  progress: number;
  manual: boolean;
  statement: string;
  onConfirm: () => void;
  onManual: () => void;
  /** Quote the consequence inside the callout (when the highlighted block is small or far away). */
  showStatement?: boolean;
}

const focusRing = "rounded-md ring-2 ring-critical/70 ring-offset-2 ring-offset-raised motion-safe:animate-pulse-once";

function ConsequenceList({
  blocks,
  regions,
  focusId,
  criticalOnly,
  refocus,
}: {
  blocks: ContentBlock[];
  regions: Map<string, CriticalRegion>;
  focusId: string | null;
  criticalOnly: boolean;
  refocus: RefocusProps | null;
}) {
  const [showRoutine, setShowRoutine] = useState(false);
  const routineHidden = criticalOnly && !showRoutine;
  const hiddenCount = blocks.filter((b) => !regions.has(b.id)).length;

  return (
    <div role="list" className="space-y-1.5 short:space-y-1">
      {blocks.map((b) => {
        const region = regions.get(b.id);
        if (!region && routineHidden) return null;
        const focus = focusId === b.id;
        const critical = region ? isDecisionCritical(region.severity) : false;
        const emphasis = focus ? "focus" : region && criticalOnly ? "prominent" : region ? "subtle" : "none";
        return (
          <Fragment key={b.id}>
            {focus && refocus && <RefocusCallout {...refocus} />}
            <AttentionRegion
              role="listitem"
              regionId={b.id}
              regionRole={region ? "target" : "content"}
              label="Consequence"
              words={wordCount(b.text)}
              severity={region?.severity}
              tabIndex={focus ? -1 : undefined}
              className={cn(
                "relative flex items-start gap-3 rounded-lg border px-3 py-2.5 text-[14px] leading-relaxed outline-none transition-[opacity,background-color,border-color] duration-200 short:py-2",
                emphasis === "none" && "border-transparent",
                emphasis === "subtle" && "border-transparent",
                emphasis === "prominent" &&
                  (critical ? "border-critical/45 bg-critical/[0.06]" : "border-intel/35 bg-intel/[0.05]"),
                emphasis === "focus" && "border-critical/70 bg-critical/[0.08] motion-safe:animate-pulse-once",
                focusId && !focus && "opacity-35",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "mt-[9px] size-1.5 shrink-0 rounded-full",
                  region ? (critical ? "bg-critical" : "bg-intel") : "bg-fg-subtle/70",
                )}
              />
              <BlockText
                text={b.text}
                phrase={region?.phrase}
                emphasize={emphasis === "prominent" || emphasis === "focus"}
                className="min-w-0 flex-1 text-fg/90"
              />
              {region && (
                <span
                  className={cn(
                    "mt-0.5 shrink-0 rounded px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.12em]",
                    critical ? "text-critical/80" : "text-intel/80",
                    emphasis === "prominent" || emphasis === "focus"
                      ? critical
                        ? "bg-critical/15 text-critical"
                        : "bg-intel/15 text-intel"
                      : "",
                  )}
                >
                  {critical ? "Decision-critical" : "Key detail"}
                </span>
              )}
            </AttentionRegion>
          </Fragment>
        );
      })}
      {criticalOnly && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowRoutine((v) => !v)}
          className="ml-3 inline-flex items-center gap-1 text-[12px] text-fg-subtle hover:text-fg"
          aria-expanded={showRoutine}
        >
          {showRoutine ? "Hide" : "Show"} {hiddenCount} routine consequence{hiddenCount > 1 ? "s" : ""}
          <ChevronDown className={cn("size-3.5 transition-transform", showRoutine && "rotate-180")} aria-hidden />
        </button>
      )}
    </div>
  );
}

function RefocusCallout({ satisfied, progress, manual, statement, onConfirm, onManual, showStatement }: RefocusProps) {
  const manualDone = manual && satisfied;
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      role="alert"
      className="mb-1.5 rounded-lg border border-critical/40 bg-critical/[0.06] px-4 py-3"
    >
      <div className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-critical">
        <TriangleAlert className="size-3.5" aria-hidden /> Attention required
      </div>
      <p className="mt-1 text-sm text-fg">
        Your review pattern indicates that this consequence may have been skipped.
      </p>
      {showStatement && statement && (
        <p className="mt-2 text-[15px] font-semibold leading-snug text-fg">{statement}</p>
      )}
      {manual && !manualDone ? (
        <div className="mt-3">
          <ManualAck statement={statement} satisfied={false} />
        </div>
      ) : !satisfied ? (
        <div className="mt-3">
          <Progress value={progress} tone="critical" label="Re-review progress" className="bg-canvas/70" />
          <p className="mt-1.5 text-xs text-fg-muted">
            Read the highlighted consequence. Approval unlocks once OverSight registers that it was visually reviewed.
          </p>
          <button
            type="button"
            onClick={onManual}
            className="mt-2 text-xs text-fg-subtle underline underline-offset-2 hover:text-fg"
          >
            I cannot use camera-based attention verification
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-safe" role="status">
            <CircleCheck className="size-4" aria-hidden />
            {manual ? "Critical consequence acknowledged" : "Critical consequence reviewed"}
          </p>
          <Button variant="primary" size="sm" onClick={onConfirm} data-gaze-anchor>
            <Check aria-hidden /> Confirm approval
          </Button>
        </div>
      )}
    </motion.div>
  );
}

function AnalyzingSkeleton() {
  return (
    <div className="space-y-3 border-t border-line px-6 py-6" aria-busy="true" aria-label="Semantic analysis in progress">
      <div className="eyebrow text-intel">Semantic analysis in progress</div>
      {[0.9, 0.7, 0.8].map((w, i) => (
        <div key={i} className="h-3 animate-pulse rounded bg-overlay" style={{ width: `${w * 100}%` }} />
      ))}
    </div>
  );
}
