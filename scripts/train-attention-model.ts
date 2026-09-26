/**
 * Trains the layer-2 behavioral classifier from a dataset exported by the
 * Model lab (/lab -> Export dataset).
 *
 *   npm run train -- data/training/oversight-dataset.json [--lambda 1] [--out public/models/attention-classifier.json]
 *
 * Prints stratified cross-validation metrics and the most influential
 * coefficients, then writes the model JSON. The app loads
 * /models/attention-classifier.json automatically when no model has been
 * trained in the browser.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FEATURE_NAMES } from "../lib/ml/features";
import { parseDatasetFile } from "../lib/ml/dataset";
import { isClassifierUsable, topCoefficients, trainClassifier } from "../lib/ml/logistic";

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
  const entries = parseDatasetFile(await readFile(input, "utf8"));
  const model = trainClassifier(
    entries.map((e) => ({ features: e.features, label: e.label })),
    FEATURE_NAMES,
    lambda,
  );

  console.log(`Examples: ${model.samples.total} (${model.samples.attentive} attentive, ${model.samples.lowAttention} low-attention)`);
  if (model.metrics) {
    console.log(
      `Cross-validation (${model.metrics.folds}-fold): accuracy ${(model.metrics.accuracy * 100).toFixed(1)}%, AUC ${model.metrics.auc.toFixed(3)}, log-loss ${model.metrics.logLoss.toFixed(3)}`,
    );
  } else {
    console.log("Too few examples per class to cross-validate.");
  }
  console.log("Top coefficients (positive = more likely LOW_ATTENTION):");
  for (const c of topCoefficients(model, 8)) console.log(`  ${c.name.padEnd(24)} ${c.weight >= 0 ? "+" : ""}${c.weight.toFixed(3)}`);
  console.log(isClassifierUsable(model) ? "Model meets the activation bar (advisory use)." : "Model does NOT meet the activation bar; the app will display it but not use it.");

  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(model, null, 2));
  console.log(`Wrote ${out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
