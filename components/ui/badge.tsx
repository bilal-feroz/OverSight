import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11.5px] font-medium leading-5 [&_svg]:size-3.5",
  {
    variants: {
      tone: {
        neutral: "border-line-strong bg-surface text-fg-muted",
        safe: "border-safe/35 bg-safe/10 text-safe",
        warn: "border-warn/35 bg-warn/10 text-warn",
        critical: "border-critical/40 bg-critical/10 text-critical",
        intel: "border-intel/35 bg-intel/10 text-intel",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export function Dot({ tone = "neutral", pulse = false, className }: { tone?: "neutral" | "safe" | "warn" | "critical" | "intel"; pulse?: boolean; className?: string }) {
  const color = {
    neutral: "bg-fg-subtle",
    safe: "bg-safe",
    warn: "bg-warn",
    critical: "bg-critical",
    intel: "bg-intel",
  }[tone];
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)} aria-hidden>
      {pulse && <span className={cn("absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping", color)} />}
      <span className={cn("relative inline-flex size-2 rounded-full", color)} />
    </span>
  );
}
