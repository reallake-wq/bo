import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(root, "..");
const outPath = path.join(workspaceRoot, "oac-commercial-value-summary.json");

const PANELS = [
  { key: "profile", label: "\u4f01\u4e1a\u753b\u50cf", className: "profile-argument-section", min: 3, max: 7 },
  { key: "sales", label: "\u5546\u52a1\u5206\u6790", className: "sales-argument-section", min: 6, max: 8 },
  { key: "presales", label: "\u65b9\u6848\u5206\u6790", className: "presales-argument-section", min: 6, max: 8 },
  { key: "delivery", label: "\u4ea4\u4ed8\u5206\u6790", className: "delivery-argument-section", min: 3, max: 3 },
  { key: "action", label: "\u884c\u52a8\u6307\u5357", className: "action-argument-section", min: 2, max: 2 }
];

const BAD_VALUE_PATTERN = /\u4fe1\u606f\u4e0d\u8db3|\u6570\u636e\u4e0d\u8db3|\u8bc1\u636e\u4e0d\u8db3|\u65e0\u6cd5\u5f62\u6210(?:\u6709\u6548)?(?:\u8bba\u70b9|\u89c2\u70b9|\u7ed3\u8bba)|\u5de5\u4f5c\u91cf\u4f30\u7b97|\u4eba\u5929|\u5de5\u671f|\u4ef7\u683c\u4f30\u7b97|\u8d44\u6e90\u6295\u5165/;

function walk(dir, callback) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, callback);
    else callback(full);
  }
}

function plainText(html = "") {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sectionHtml(html = "", className = "") {
  const marker = `<section class="battle-section argument-section ${className}`;
  const start = html.indexOf(marker);
  if (start < 0) return "";
  const tail = html.slice(start);
  const end = tail.indexOf("</section>");
  return end >= 0 ? tail.slice(0, end + 10) : tail;
}

function panelHtml(html = "", className = "") {
  const marker = `<div class="report-view-panel ${className}`;
  const start = html.indexOf(marker);
  if (start < 0) return "";
  const tail = html.slice(start);
  const next = tail.indexOf('<div class="report-view-panel', 1);
  return next >= 0 ? tail.slice(0, next) : tail;
}

function nodeCount(section = "") {
  return (section.match(/class="argument-node(?:\s|")/g) || []).length;
}

function branchCounts(section = "") {
  return section
    .split(/<details class="argument-node/)
    .slice(1)
    .map((node) => (node.match(/class="argument-branch\b/g) || []).length);
}

function nodeClaims(section = "") {
  return String(section)
    .split(/<details class="argument-node/)
    .slice(1)
    .map((node) => {
      const summary = node.match(/<summary>[\s\S]*?<\/summary>/)?.[0] || "";
      const claim = summary.match(/<b>([\s\S]*?)<\/b>/)?.[1] || "";
      return plainText(claim);
    })
    .filter(Boolean);
}

function completeClaim(value = "") {
  const text = plainText(value).trim();
  if (text.length < 8) return false;
  if (!/[。！？.!?]$/.test(text)) return false;
  return !BAD_VALUE_PATTERN.test(text);
}

function firstExistingIndex(text = "", terms = [], startAt = 0) {
  const from = Math.max(0, startAt);
  const indexes = terms.map((term) => text.indexOf(term, from)).filter((index) => index >= 0);
  return indexes.length ? Math.min(...indexes) : -1;
}

function sourceFamilyCount(report = {}) {
  const counts = report.evidencePool?.familyCounts || {};
  const families = new Set([
    ...Object.entries(counts).filter(([, count]) => Number(count) > 0).map(([family]) => family),
    ...((report.sources || []).map((item) => item.sourceFamily || item.topic || item.sourceType).filter(Boolean))
  ]);
  return families.size;
}

function latestByCompany(files) {
  const map = new Map();
  for (const file of files) {
    let report = null;
    try {
      report = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const company = report.standardName || report.companyName || path.basename(file, ".json");
    const stat = fs.statSync(file);
    const current = map.get(company);
    if (!current || stat.mtimeMs > current.mtimeMs) map.set(company, { file, report, mtimeMs: stat.mtimeMs });
  }
  return Array.from(map.values()).sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function scoreReport({ file, report }, html) {
  const text = plainText(html);
  const sections = Object.fromEntries(PANELS.map((panel) => [panel.key, sectionHtml(html, panel.className)]));
  const panelsOk = PANELS.every((panel) => text.includes(panel.label));
  const counts = Object.fromEntries(PANELS.map((panel) => [panel.key, nodeCount(sections[panel.key])]));
  const branches = Object.fromEntries(PANELS.map((panel) => [panel.key, branchCounts(sections[panel.key])]));
  const claimsOk = PANELS.every((panel) => {
    const claims = nodeClaims(sections[panel.key]);
    return claims.length === counts[panel.key] && claims.every(completeClaim);
  });
  const densityOk = PANELS.every((panel) => counts[panel.key] >= panel.min && counts[panel.key] <= panel.max);
  const branchOk = Object.values(branches).every((items) => items.length && items.every((count) => count >= 1));
  const deliveryPanel = panelHtml(html, "view-delivery");
  const deliveryText = plainText(deliveryPanel);
  const sowIndex = firstExistingIndex(deliveryText, ["SOW\u5206\u89e3", "SOW\u5de5\u4f5c\u62c6\u5206"]);
  const riskIndex = firstExistingIndex(deliveryText, ["\u98ce\u9669\u8bc4\u4f30", "\u98ce\u9669\u4e0e\u5e94\u5bf9", "\u98ce\u9669\u5185\u5bb9", "\u98ce\u9669"], sowIndex);
  const actionPanel = panelHtml(html, "view-action");
  const actionText = plainText(actionPanel);
  const deliveryDecision =
    sowIndex >= 0 &&
    riskIndex >= 0 &&
    /\u5e94\u5bf9\u65b9\u6848|\u5e94\u5bf9\u63aa\u65bd/.test(deliveryText) &&
    /\u524d\u7f6e\u4f9d\u8d56|\u524d\u7f6e\u6761\u4ef6/.test(deliveryText) &&
    sowIndex < riskIndex;
  const checks = {
    tabOrder: panelsOk,
    pyramidDensity: densityOk,
    everyNodeHasSupport: Object.values(counts).every((count) => count > 0),
    decisionBranchDensity: branchOk,
    completeClaimSentences: claimsOk,
    actionGuideStructure:
      PANELS.every((panel) => text.includes(panel.label)) &&
      /\u73b0\u573a\u95ee\u5377/.test(actionText) &&
      /\u91cd\u70b9\u5173\u6ce8\u4e8b\u9879/.test(actionText) &&
      !/\u5f00\u573a\u5207\u5165|\u4f1a\u540e\u66f4\u65b0|\u5185\u90e8\u8fb9\u754c|\u4e0b\u4e00\u6b65\u52a8\u4f5c/.test(actionText),
    coverDecisionStrip: html.includes("cover-rating-badge"),
    salesDecision: /\u662f\u5426\u6709\u91c7\u8d2d\u80fd\u529b/.test(text) && /\u5546\u52a1\u98ce\u9669/.test(text),
    presalesDecision: /\u75db\u70b9\u673a\u4f1a/.test(text) && /\u914d\u5957\u89e3\u51b3\u65b9\u6848/.test(text),
    deliveryDecision,
    actionDecision:
      /\u4e1a\u52a1\u573a\u666f/.test(actionText) &&
      /\u9884\u7b97\u4e0e\u91c7\u8d2d/.test(actionText) &&
      /\u7cfb\u7edf\u4e0e\u6570\u636e/.test(actionText) &&
      /\u4ea4\u4ed8\u9a8c\u6536/.test(actionText),
    noLowValueClaims: !BAD_VALUE_PATTERN.test(text),
    enoughEvidence: Array.isArray(report.sources) && report.sources.length >= 6,
    enoughFamilies: sourceFamilyCount(report) >= 2
  };
  const failures = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key);
  return {
    company: report.standardName || report.companyName || path.basename(file, ".json"),
    file,
    sourceCount: Array.isArray(report.sources) ? report.sources.length : 0,
    familyCount: sourceFamilyCount(report),
    nodeCounts: counts,
    branchCounts: branches,
    checks,
    failures,
    ok: failures.length === 0
  };
}

async function main() {
  const reportMod = await import(pathToFileURL(path.join(root, "netlify", "lib", "report.mjs")).href + `?v=${Date.now()}`);
  const files = [];
  walk(path.join(root, "local-data"), (file) => {
    if (file.endsWith(".json") && file.includes(`${path.sep}reports${path.sep}`)) files.push(file);
  });
  const sample = latestByCompany(files).slice(0, 8);
  const results = sample.map((item) => {
    const normalized = reportMod.normalizeReportShape(item.report);
    const html = reportMod.renderReportHtml(normalized);
    return scoreReport({ ...item, report: normalized }, html);
  });
  const output = {
    ok: results.length > 0 && results.every((item) => item.ok),
    sampleCount: results.length,
    passCount: results.filter((item) => item.ok).length,
    failures: results.flatMap((item) => item.failures.map((failure) => `${item.company}: ${failure}`)),
    results
  };
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
