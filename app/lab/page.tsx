import type { Metadata } from "next";
import { ModelLab } from "@/components/dashboard/model-lab";

export const metadata: Metadata = { title: "Model lab" };

export default function LabPage() {
  return <ModelLab />;
}
