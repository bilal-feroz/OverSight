import { ApprovalRequestSchema } from "@/lib/semantic/schema";
import { analyzeOnServer, describeProvider } from "@/lib/semantic/server";

/** POST { request: ApprovalRequest } -> { analysis: SemanticAnalysis } */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = ApprovalRequestSchema.safeParse((body as { request?: unknown } | null)?.request);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid approval request.", issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }
  const analysis = await analyzeOnServer(parsed.data);
  return Response.json({ analysis });
}

/** GET -> which analyzer is active (never exposes the key). */
export async function GET() {
  return Response.json({ provider: describeProvider() });
}
