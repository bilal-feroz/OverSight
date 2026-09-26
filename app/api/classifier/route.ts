import { readFile } from "node:fs/promises";
import path from "node:path";

// Read on every request: a model trained with `npm run train` should appear without a rebuild.
export const dynamic = "force-dynamic";

/** GET -> { model } from public/models/attention-classifier.json, or { model: null } if none was trained. */
export async function GET() {
  try {
    const raw = await readFile(path.join(process.cwd(), "public", "models", "attention-classifier.json"), "utf8");
    return Response.json({ model: JSON.parse(raw) });
  } catch {
    return Response.json({ model: null });
  }
}
