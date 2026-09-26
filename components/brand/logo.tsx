import Link from "next/link";
import { cn } from "@/lib/utils";

/** Mark: an approval frame with a single focal point. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={cn("size-5", className)}>
      <rect x="2.75" y="4.75" width="18.5" height="14.5" rx="3.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 9.5h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.45" />
      <path d="M6.5 14.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.45" />
      <circle cx="16.25" cy="14.5" r="2.25" fill="var(--color-intel)" />
    </svg>
  );
}

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link
      href={href}
      className={cn("inline-flex items-center gap-2 text-fg", className)}
      aria-label="OverSight home"
    >
      <LogoMark />
      <span className="font-mono text-[13px] font-semibold tracking-[0.28em]">OverSight</span>
    </Link>
  );
}
