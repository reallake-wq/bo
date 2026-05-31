import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, callback) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, callback);
    else callback(full, entry);
  }
}

function latestReportFile() {
  const base = path.join(root, "local-data");
  let latest = null;
  walk(base, (file) => {
    if (!file.endsWith(".json") || !file.includes(path.sep + "reports" + path.sep)) return;
    const stat = fs.statSync(file);
    if (!latest || stat.mtimeMs > latest.mtimeMs) latest = { file, mtimeMs: stat.mtimeMs };
  });
  return latest?.file || "";
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function activeRound(report) {
  const rounds = Array.isArray(report.rounds) ? report.rounds : [];
  return rounds.find((round) => Number(round.roundNo) === Number(report.activeRoundNo)) || rounds[0] || {};
}

function assertPersisted(report) {
  const round = activeRound(report);
  const strategy = report.solutionStrategy || round.solutionStrategy || {};
  const delivery = report.deliveryAssessment || round.deliveryAssessment || {};
  const failures = [];
  if (!hasText(strategy.currentSituation)) failures.push("solutionStrategy.currentSituation");
  if (!hasText(strategy.overallApproach)) failures.push("solutionStrategy.overallApproach");
  if (!Array.isArray(strategy.rankedSolutions) || strategy.rankedSolutions.length === 0) {
    failures.push("solutionStrategy.rankedSolutions");
  }
  if (!Array.isArray(strategy.implementationPath) || strategy.implementationPath.length === 0) {
    failures.push("solutionStrategy.implementationPath");
  }
  if (!hasText(delivery.architectureSketch)) failures.push("deliveryAssessment.architectureSketch");
  if (!Array.isArray(delivery.sowOutline) || delivery.sowOutline.length < 3) {
    failures.push("deliveryAssessment.sowOutline");
  }
  if (!Array.isArray(delivery.dependencies) || delivery.dependencies.length === 0) {
    failures.push("deliveryAssessment.dependencies");
  }
  if (!Array.isArray(delivery.deliveryRisks) || delivery.deliveryRisks.length === 0) {
    failures.push("deliveryAssessment.deliveryRisks");
  }
  if (!Array.isArray(report.businessInsights) || report.businessInsights.length < 4) {
    failures.push("businessInsights");
  }
  return failures;
}

async function main() {
  const reportFile = process.argv[2] ? path.resolve(process.argv[2]) : latestReportFile();
  if (!reportFile) throw new Error("No local report JSON found.");
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  const reportMod = await import(pathToFileURL(path.join(root, "netlify", "lib", "report.mjs")).href + `?v=${Date.now()}`);
  const normalized = reportMod.normalizeReportShape(report);
  const outFile = path.resolve(root, "..", "oac-persisted-regression-report.json");
  fs.writeFileSync(outFile, JSON.stringify(normalized, null, 2), "utf8");
  const reloaded = JSON.parse(fs.readFileSync(outFile, "utf8"));
  const failures = assertPersisted(reloaded);
  const output = {
    ok: failures.length === 0,
    reportFile,
    outFile,
    target: reloaded.targetCompanyName || reloaded.standardName || reloaded.companyName,
    sourceCount: Array.isArray(reloaded.sources) ? reloaded.sources.length : 0,
    businessInsights: Array.isArray(reloaded.businessInsights) ? reloaded.businessInsights.length : 0,
    failures
  };
  console.log(JSON.stringify(output, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
