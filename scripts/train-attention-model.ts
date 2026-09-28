/**
 * Trains the advisory behavioral model (layer 2) from a dataset exported by
 * the Model lab (/lab -> Export dataset), through the grouped evaluation of
 * docs/EVALUATION.md:
 *
 *   npm run train -- data/training/oversight-dataset-v2.json [--lambda 1] [--out public/models/attention-classifier.json]
 *
 * Prints the grouped evaluation and the pre-registered decision, then writes
 * the model JSON with its evaluation metadata. The app activates the model
 * only if that metadata records a passing evaluation; otherwise it is shown
 * but never used.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { trainAdvisoryModel } from "../lib/ml/advisory";
import { parseDatasetFile } from "../lib/ml/dataset";
import { reportMarkdown } from "../lib/ml/evaluate";
import { topCoefficients } from "../lib/ml/logistic";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function positional(): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      i++; // skip the flag's value
      continue;
    }
    return args[i];
  }
  return undefined;
}

async function main() {
  const input = positional();
  if (!input) {
    console.error("Usage: npm run train -- <dataset.json> [--lambda 1] [--out public/models/attention-classifier.json]");
    process.exit(1);
  }
  const lambda = Number(arg("lambda", "1"));
  const out = arg("out", "public/models/attention-classifier.json");
  const parsed = parseDatasetFile(await readFile(input, "utf8"));
  if (parsed.version !== 2) {
    console.error("This is a legacy v1 dataset (read-only). Collect a v2 dataset in the Model lab.");
    process.exit(1);
  }
  const { report, model, status } = trainAdvisoryModel(parsed.entries, { label: path.basename(input), lambda });
  console.log(reportMarkdown(report));
  if (!model) {
    console.error(status.reason);
    process.exit(1);
  }
  console.log("Top coefficients (positive = more likely LOW_ATTENTION):");
  for (const c of topCoefficients(model, 8)) console.log(`  ${c.name.padEnd(26)} ${c.weight >= 0 ? "+" : ""}${c.weight.toFixed(3)}`);
  console.log(status.active ? "Model passes the activation gate (advisory use)." : `Model is NOT activated: ${status.reason}`);

  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(model, null, 2));
  console.log(`Wrote ${out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
