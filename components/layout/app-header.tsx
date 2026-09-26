"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Crosshair, Keyboard, Layers, RotateCcw, ScanFace, Users } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Dot } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/misc";
import { useCvStore } from "@/lib/store/cv-store";
import { useSessionStore } from "@/lib/store/session-store";
import { useUiStore } from "@/lib/store/ui-store";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/console", label: "Console" },
  { href: "/session", label: "Session" },
  { href: "/lab", label: "Model lab" },
];

export function AppHeader() {
  const pathname = usePathname();
  const overlay = useUiStore((s) => s.overlay);
  const diagnostics = useUiStore((s) => s.diagnostics);
  const setOverlay = useUiStore((s) => s.setOverlay);
  const setDiagnostics = useUiStore((s) => s.setDiagnostics);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const reset = useSessionStore((s) => s.reset);

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-canvas/95 px-3 backdrop-blur sm:gap-3 sm:px-4 md:gap-5">
      <Logo className="shrink-0" />
      <nav aria-label="Primary" className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {NAV.map((n) => {
          const current = pathname === n.href;
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "whitespace-nowrap rounded-md px-2 py-1.5 text-[13px] transition-colors sm:px-2.5",
                current ? "bg-surface text-fg" : "text-fg-muted hover:text-fg",
              )}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <SignalChips />
        <div className="mx-1 hidden h-5 w-px bg-line md:block" aria-hidden />
        <ToggleChip active={overlay} onClick={() => setOverlay(!overlay)} label="Attention overlay" shortcut="O">
          <Layers aria-hidden />
        </ToggleChip>
        <ToggleChip
          active={diagnostics}
          onClick={() => setDiagnostics(!diagnostics)}
          label="Diagnostics"
          shortcut="D"
          className="hidden md:inline-flex"
        >
          <Crosshair aria-hidden />
        </ToggleChip>
        <button
          type="button"
          onClick={reset}
          className="hidden h-8 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-fg-muted hover:bg-surface hover:text-fg sm:inline-flex"
          aria-label="Reset demo session (R)"
          title="Reset demo session (R)"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          <span className="hidden xl:inline">Reset</span>
        </button>
        <button
          type="button"
          onClick={() => setShortcutsOpen(true)}
          className="hidden size-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface hover:text-fg md:inline-flex"
          aria-label="Keyboard shortcuts (?)"
          title="Keyboard shortcuts (?)"
        >
          <Keyboard className="size-4" aria-hidden />
        </button>
      </div>
    </header>
  );
}

function ToggleChip({
  active,
  onClick,
  label,
  shortcut,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  shortcut: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${label} (${shortcut})`}
      title={`${label} (${shortcut})`}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-[12.5px] transition-colors [&_svg]:size-3.5",
        active ? "border-intel/50 bg-intel/10 text-intel" : "border-transparent text-fg-muted hover:bg-surface hover:text-fg",
        className,
      )}
    >
      {children}
      <span className="hidden 2xl:inline">{label}</span>
      <Kbd className="hidden lg:inline-flex">{shortcut}</Kbd>
    </button>
  );
}

export function SignalChips() {
  const status = useCvStore((s) => s.cameraStatus);
  const source = useCvStore((s) => s.source);
  const faces = useCvStore((s) => s.faceCount);
  const calibration = useCvStore((s) => s.calibration);
  const stale = useCvStore((s) => s.calibrationStale);

  const camera =
    source === "simulated"
      ? { tone: "warn" as const, text: "Simulated gaze" }
      : status === "active"
        ? { tone: "safe" as const, text: "Camera · on-device" }
        : status === "requesting" || status === "loading-model"
          ? { tone: "intel" as const, text: "Starting camera" }
          : { tone: "neutral" as const, text: "Camera off" };

  const cal = !calibration
    ? { tone: "warn" as const, text: "Not calibrated" }
    : stale || calibration.quality === "poor"
      ? { tone: "warn" as const, text: "Recalibrate" }
      : { tone: calibration.quality === "good" ? ("safe" as const) : ("intel" as const), text: `Calibration: ${calibration.quality === "good" ? "Good" : "Fair"}` };

  return (
    <div className="hidden items-center gap-1.5 md:flex" role="status" aria-label="Attention signal status">
      <Link href="/setup" className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-[12px] text-fg-muted hover:text-fg">
        <Dot tone={camera.tone} pulse={camera.tone === "safe"} />
        {camera.text}
      </Link>
      {source === "camera" && (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-[12px] text-fg-muted">
          {faces > 1 ? <Users className="size-3.5 text-warn" aria-hidden /> : <ScanFace className={cn("size-3.5", faces === 1 ? "text-safe" : "text-fg-subtle")} aria-hidden />}
          {faces === 1 ? "Face detected" : faces > 1 ? "Multiple faces" : "No face"}
        </span>
      )}
      {source === "camera" && (
        <Link href="/setup#calibrate" className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-raised px-2 text-[12px] text-fg-muted hover:text-fg">
          <Dot tone={cal.tone} />
          {cal.text}
        </Link>
      )}
    </div>
  );
}
