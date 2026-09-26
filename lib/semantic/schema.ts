import { z } from "zod";

/** Server-side validation of approval requests posted to /api/analyze. */
export const ContentBlockSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(["title", "summary", "reasoning", "resource", "change", "consequence", "metadata", "detail"]),
  text: z.string().max(2000),
  label: z.string().max(200).optional(),
  from: z.string().max(400).optional(),
  to: z.string().max(400).optional(),
});

export const ApprovalRequestSchema = z.object({
  id: z.string().min(1).max(120),
  agent: z.object({ name: z.string().max(120), handle: z.string().max(120) }),
  actionType: z.string().max(160),
  environment: z.string().max(160),
  title: z.string().min(1).max(300),
  summary: z.string().max(1200),
  blocks: z.array(ContentBlockSchema).max(60),
  requestedAgo: z.string().max(60),
  reference: z.string().max(120).optional(),
  source: z.enum(["seeded", "custom"]),
});
