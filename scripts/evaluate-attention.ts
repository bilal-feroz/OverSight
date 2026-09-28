/**
 * Grouped evaluation of the rules vs. learned models on a collected dataset
 * (Model lab -> Export dataset). See docs/EVALUATION.md.
 *
 *   npm run evaluate -- data/training/oversight-dataset-v2.json [--out reports/study-1] [--bootstrap 1000] [--seed 1]
 *
 * Writes <out>.md and <out>.json and prints the decision.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseDatasetFile } from "../lib/ml/dataset";
import { evaluateDataset, reportMarkdown } from "../lib/ml/evaluate";

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
    console.error("Usage: npm run evaluate -- <dataset.json> [--out reports/<name>] [--bootstrap 1000] [--seed 1]");
    process.exit(1);
  }
  const parsed = parseDatasetFile(await readFile(input, "utf8"));
  if (parsed.version !== 2) {
    console.error("This is a legacy v1 dataset (read-only, no participants or sessions). Collect a v2 dataset in the Model lab.");
    process.exit(1);
  }
  const out = arg("out", path.join("reports", path.basename(input, path.extname(input))));
  const report = evaluateDataset(parsed.entries, {
    label: path.basename(input),
    bootstrap: Number(arg("bootstrap", "1000")),
    seed: Number(arg("seed", "1")),
  });
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(`${out}.md`, reportMarkdown(report));
  await writeFile(`${out}.json`, JSON.stringify(report, null, 2));
  for (const w of report.warnings) console.warn(w);
  console.log(
    `${report.sizes.entries} approvals, ${report.sizes.participants} participants, ${report.sizes.sessions} sessions (leave-one-${report.grouping}-out).`,
  );
  console.log(`Decision: ${report.decision.adopt ? "adopt the advisory model" : "ship rules only"}.`);
  for (const r of report.decision.reasons) console.log(`  - ${r}`);
  console.log(`Wrote ${out}.md and ${out}.json`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
