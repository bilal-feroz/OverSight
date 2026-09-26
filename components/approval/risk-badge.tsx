import { OctagonAlert, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import type { RiskLevel } from "@/types/approval";
import type { InterventionLevel } from "@/types/attention";
import { Badge } from "@/components/ui/badge";
import { INTERVENTION_LABEL, RISK_LABEL } from "@/lib/risk/levels";
import { cn } from "@/lib/utils";

const RISK_TONE = { LOW: "safe", MEDIUM: "neutral", HIGH: "warn", CRITICAL: "critical" } as const;
const RISK_ICON = { LOW: ShieldCheck, MEDIUM: Shield, HIGH: ShieldAlert, CRITICAL: OctagonAlert } as const;

/** Risk is conveyed by label + icon + color, never color alone. */
export function RiskBadge({ risk, className }: { risk: RiskLevel; className?: string }) {
  const Icon = RISK_ICON[risk];
  return (
    <Badge tone={RISK_TONE[risk]} className={className}>
      <Icon aria-hidden />
      {RISK_LABEL[risk]}
    </Badge>
  );
}

const INTERVENTION_TONE = { NORMAL: "safe", NUDGE: "warn", REFOCUS: "warn", PAUSE: "critical" } as const;

export function InterventionBadge({ level, className }: { level: InterventionLevel; className?: string }) {
  return (
    <Badge tone={INTERVENTION_TONE[level]} className={cn("font-mono uppercase tracking-wider", className)}>
      {INTERVENTION_LABEL[level]}
    </Badge>
  );
}

export function riskTextClass(risk: RiskLevel) {
  return {
    LOW: "text-safe",
    MEDIUM: "text-fg-muted",
    HIGH: "text-warn",
    CRITICAL: "text-critical",
  }[risk];
}
