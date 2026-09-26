import type { Metadata } from "next";
import { ConsoleView } from "@/components/approval/console-view";

export const metadata: Metadata = { title: "Approval console" };

export default function ConsolePage() {
  return <ConsoleView />;
}
