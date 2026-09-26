import type { Metadata } from "next";
import { SetupFlow } from "@/components/calibration/setup-flow";

export const metadata: Metadata = { title: "Camera & calibration" };

export default function SetupPage() {
  return <SetupFlow />;
}
