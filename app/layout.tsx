import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AppProviders } from "@/components/providers/app-providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "OverSight · Human approval shouldn't mean human autopilot",
    template: "%s · OverSight",
  },
  description:
    "OverSight is an attention-aware safety layer for human approval of AI actions. It detects evidence that decision-critical information was not visually inspected before approval, and intervenes only when it matters.",
};

export const viewport: Viewport = {
  themeColor: "#080a0d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
