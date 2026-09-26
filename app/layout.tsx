import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { AppProviders } from "@/components/providers/app-providers";
import "./globals.css";

// Satoshi by Indian Type Foundry (Fontshare), self-hosted so the CSP can stay `font-src 'self'`.
const satoshi = localFont({
  src: "./fonts/Satoshi-Variable.ttf",
  variable: "--font-satoshi",
  weight: "300 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "OverSight · Human approval shouldn't mean human autopilot",
    template: "%s · OverSight",
  },
  description:
    "OverSight is an attention-aware safety layer for human approval of AI actions. It detects evidence that decision-critical information was not visually inspected before approval, and intervenes only when it matters.",
};

export const viewport: Viewport = {
  themeColor: "#141312",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={satoshi.variable}>
      <body className="min-h-dvh">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
