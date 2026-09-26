import type { Metadata } from "next";
import { SessionAnalytics } from "@/components/dashboard/session-analytics";

export const metadata: Metadata = { title: "Session analytics" };

export default function SessionPage() {
  return <SessionAnalytics />;
}
