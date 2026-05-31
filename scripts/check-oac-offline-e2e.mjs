import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tenantId = "oac-offline-e2e";
const storeRoot = path.resolve(root, "..", "oac-offline-e2e-store", tenantId);

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
    if (file.includes(`${path.sep}${tenantId}${path.sep}`)) return;
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

function indexEntry(report) {
  return {
    reportId: report.reportId,
    companyName: report.companyName,
    standardName: report.standardName,
    targetCompanyName: report.targetCompanyName || report.standardName || report.companyName,
    companyKey: report.companyKey,
    sellerProfileId: report.sellerProfileId || "",
    sellerProfileName: report.sellerProfileName || "Unbound seller",
    sellerProfileSnapshot: report.sellerProfileSnapshot || null,
    reportMode: report.reportMode,
    activeRoundNo: report.activeRoundNo,
    roundCount: Array.isArray(report.rounds) ? report.rounds.length : 0,
    sourceCount: report.sourceCount,
    verifiedSourceCount: report.verifiedSourceCount,
    readableSourceCount: report.readableSourceCount,
    topicCoverageCount: report.topicCoverageCount,
    qualityLevel: report.qualityLevel,
    qualityLabel: report.qualityLabel,
    durationMs: report.durationMs,
    generatedAt: report.generatedAt,
    updatedAt: report.updatedAt,
    modelDisplay: report.modelDisplay,
    usedModels: report.usedModels || []
  };
}

function validate(report, html, index) {
  const round = activeRound(report);
  const strategy = report.solutionStrategy || round.solutionStrategy || {};
  const delivery = report.deliveryAssessment || round.deliveryAssessment || {};
  const failures = [];
  if (!hasText(strategy.currentSituation)) failures.push("missing strategy currentSituation");
  if (!hasText(strategy.overallApproach)) failures.push("missing strategy overallApproach");
  if (!Array.isArray(strategy.rankedSolutions) || strategy.rankedSolutions.length === 0) {
    failures.push("missing strategy rankedSolutions");
  }
  if (!hasText(delivery.architectureSketch)) failures.push("missing delivery architectureSketch");
  if (!Array.isArray(delivery.sowOutline) || delivery.sowOutline.length < 3) {
    failures.push("missing delivery sowOutline");
  }
  if (!Array.isArray(report.businessInsights) || report.businessInsights.length < 4) failures.push("missing businessInsights");
  if (!html.includes("report-view-tabs")) failures.push("missing perspective tabs");
  if (!html.includes("view-profile") || !html.includes("view-sales") || !html.includes("view-presales") || !html.includes("view-delivery")) {
    failures.push("missing role perspective panels");
  }
  if (!html.includes("solution-strategy-section")) failures.push("missing strategy html section");
  if (!html.includes("SOW工作拆分") || !html.includes("work-package-breakdown")) failures.push("missing SOW work package section");
  if (!html.includes("delivery-argument-section")) failures.push("missing delivery argument section");
  if (!html.includes("sales-pyramid")) failures.push("missing sales html section");
  const indexed = Array.isArray(index.reports) ? index.reports.find((item) => item.reportId === report.reportId) : null;
  if (!indexed) failures.push("missing index entry");
  if (indexed && indexed.targetCompanyName !== (report.targetCompanyName || report.standardName || report.companyName)) {
    failures.push("index target mismatch");
  }
  return failures;
}

async function main() {
  const sourceFile = process.argv[2] ? path.resolve(process.argv[2]) : latestReportFile();
  if (!sourceFile) throw new Error("No source report JSON found.");
  const source = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
  const reportMod = await import(pathToFileURL(path.join(root, "netlify", "lib", "report.mjs")).href + `?v=${Date.now()}`);

  const report = reportMod.normalizeReportShape({
    ...source,
    reportId: "offline-e2e-report",
    tenantId,
    updatedAt: new Date().toISOString()
  });
  const html = reportMod.renderReportHtml(report);

  const reportDir = path.join(storeRoot, "reports");
  const indexDir = path.join(storeRoot, "index");
  await mkdir(reportDir, { recursive: true });
  await mkdir(indexDir, { recursive: true });
  const reportPath = path.join(reportDir, `${report.reportId}.json`);
  const htmlPath = path.join(reportDir, `${report.reportId}.html`);
  const indexPath = path.join(indexDir, "reports.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  await writeFile(htmlPath, html, "utf8");
  let index = { reports: [] };
  try {
    index = JSON.parse(await readFile(indexPath, "utf8"));
  } catch {
    index = { reports: [] };
  }
  const nextReports = [indexEntry(report), ...(index.reports || []).filter((item) => item.reportId !== report.reportId)];
  await writeFile(indexPath, JSON.stringify({ reports: nextReports }, null, 2), "utf8");
  const savedReport = JSON.parse(await readFile(reportPath, "utf8"));
  const savedHtml = await readFile(htmlPath, "utf8");
  const savedIndex = JSON.parse(await readFile(indexPath, "utf8"));
  const failures = validate(savedReport, savedHtml, savedIndex);
  const result = { savedReport, savedHtml, savedIndex, failures };

  const previewPath = path.resolve(root, "..", "oac-offline-e2e-preview.html");
  fs.writeFileSync(previewPath, result.savedHtml, "utf8");
  const output = {
    ok: result.failures.length === 0,
    sourceFile,
    reportPath,
    previewPath,
    target: result.savedReport?.targetCompanyName || result.savedReport?.standardName || result.savedReport?.companyName,
    sourceCount: Array.isArray(result.savedReport?.sources) ? result.savedReport.sources.length : 0,
    indexCount: Array.isArray(result.savedIndex?.reports) ? result.savedIndex.reports.length : 0,
    failures: result.failures
  };
  console.log(JSON.stringify(output, null, 2));
  if (result.failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
