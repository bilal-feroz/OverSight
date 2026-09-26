import { cn } from "@/lib/utils";

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface px-1 font-mono text-[10.5px] text-fg-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Progress({
  value,
  tone = "intel",
  className,
  label,
}: {
  value: number;
  tone?: "intel" | "safe" | "warn" | "critical" | "neutral";
  className?: string;
  label?: string;
}) {
  const color = {
    intel: "bar-accent",
    safe: "bg-safe",
    warn: "bg-warn",
    critical: "bg-critical",
    neutral: "bg-fg-subtle",
  }[tone];
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-overlay", className)}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-200 ease-out", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  className,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 disabled:opacity-40",
        checked ? "border-intel/60 bg-intel/25" : "border-line-strong bg-surface",
        className,
      )}
    >
      <span
        className={cn(
          "inline-block size-3.5 rounded-full transition-transform duration-150",
          checked ? "translate-x-[18px] bg-intel" : "translate-x-[2px] bg-fg-subtle",
        )}
      />
    </button>
  );
}

export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("eyebrow", className)}>{children}</div>;
}

export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-line bg-raised px-4 py-3.5", className)}>
      <div className="eyebrow">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight tabular">{value}</div>
      {hint && <div className="mt-1 text-xs text-fg-muted">{hint}</div>}
    </div>
  );
}
