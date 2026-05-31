import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(root, "..");
const outPath = path.join(workspaceRoot, "oac-payworthiness-summary.json");
const mdPath = path.join(workspaceRoot, "oac-payworthiness-summary.md");

const C = {
  boss: "\u8001\u677f",
  sales: "\u9500\u552e",
  presales: "\u552e\u524d",
  delivery: "\u4ea4\u4ed8",
  worthBuy: "\u4e3a\u4ec0\u4e48\u503c\u5f97\u4e70",
  managementBuy: "\u7ba1\u7406\u5c42\u4e3a\u4ec0\u4e48\u4f1a\u4e70\u5355",
  worthFollow: "\u503c\u5f97\u91cd\u70b9\u8ddf\u8fdb",
  rating: "\u8bc4\u7ea7",
  budget: "\u9884\u7b97",
  buy: "\u4e70\u5355",
  decision: "\u51b3\u7b56\u94fe",
  risk: "\u98ce\u9669",
  next: "\u4e0b\u4e00\u6b65",
  profile: "\u4f01\u4e1a\u753b\u50cf",
  salesAnalysis: "\u5546\u52a1\u5206\u6790",
  solutionAnalysis: "\u65b9\u6848\u5206\u6790",
  deliveryAnalysis: "\u4ea4\u4ed8\u5206\u6790",
  actionGuide: "\u884c\u52a8\u6307\u5357",
  sow: "SOW\u5de5\u4f5c\u62c6\u5206",
  firstVisit: "\u521d\u8bbf\u4f5c\u6218\u60c5\u62a5",
  source: "\u6765\u6e90"
};

const FORBIDDEN = [
  "\u65e0\u6cd5\u5224\u65ad",
  "\u6570\u636e\u4e0d\u8db3",
  "\u4e0d\u8db3\u4ee5\u652f\u6491",
  "\u8bc1\u636e\u4e0d\u8db3",
  "\u5f85\u6838\u9a8c",
  "\u4eba\u5929",
  "\u5de5\u671f",
  "\u4ef7\u683c\u4f30\u7b97",
  "\u5de5\u4f5c\u91cf\u4f30\u7b97",
  "\u7c97\u4f30",
  "\u8d44\u6e90\u6295\u5165"
];

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

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

function sourceFamilyCount(report = {}) {
  const familyCounts = report.evidencePool?.familyCounts || {};
  return new Set([
    ...Object.entries(familyCounts)
      .filter(([, count]) => Number(count) > 0)
      .map(([family]) => family),
    ...((report.sources || []).map((item) => item.sourceFamily || item.topic || item.sourceType).filter(Boolean))
  ]).size;
}

function reportScore(report = {}) {
  return Number(report.sources?.length || 0) * 3 + sourceFamilyCount(report) * 12 + Number(report.businessInsightPack?.insights?.length || 0) * 4;
}

function selectRepresentativeReport() {
  const candidates = [];
  walk(path.join(root, "local-data"), (file) => {
    if (!file.endsWith(".json") || !file.includes(`${path.sep}reports${path.sep}`)) return;
    const report = readJson(file);
    if (!report) return;
    candidates.push({ file, report, score: reportScore(report) });
  });
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

function countTerm(text = "", term = "") {
  if (!term) return 0;
  return String(text).split(term).length - 1;
}

function businessDepth(text = "") {
  const terms = [
    "HolliCube",
    "MES",
    "APS",
    "ERP",
    "WMS",
    "LIMS",
    "AIOps",
    "\u751f\u6001",
    "\u62db\u6295\u6807",
    "\u552e\u524d",
    "\u9879\u76ee\u4ea4\u4ed8",
    "\u6570\u5b57\u5316\u5de5\u5382",
    "\u5de5\u4e1a\u4e92\u8054\u7f51",
    "\u5ba2\u6237\u6848\u4f8b",
    "\u7cfb\u7edf\u96c6\u6210"
  ];
  return terms.reduce((sum, term) => sum + countTerm(text, term), 0);
}

function readWorkbenchSummary() {
  return readJson(path.join(workspaceRoot, "oac-workbench-render-summary.json"), {});
}

function hasAll(text, terms) {
  return terms.every((term) => String(text || "").includes(term));
}

function hasAny(text, terms) {
  return terms.some((term) => String(text || "").includes(term));
}

function sectionText(html = "", viewClass = "") {
  const marker = `<div class="report-view-panel ${viewClass}`;
  const start = html.indexOf(marker);
  if (start < 0) return "";
  const tail = html.slice(start);
  const next = tail.indexOf('<div class="report-view-panel', marker.length);
  const section = next >= 0 ? tail.slice(0, next) : tail;
  return plainText(section);
}

function findBaselineHtml() {
  const roots = [
    path.join(process.env.USERPROFILE || "", "Downloads"),
    path.resolve("D:/\u6211\u7684\u6587\u6863/\u4e0b\u8f7d")
  ];
  const files = [];
  for (const dir of roots) {
    walk(dir, (file) => {
      const name = path.basename(file);
      if (file.endsWith(".html") && name.includes("1.0") && name.toLowerCase().includes("effect")) files.push(file);
      if (file.endsWith(".html") && name.includes("1.0") && name.includes("\u6548\u679c")) files.push(file);
    });
  }
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || "";
}

async function main() {
  const selected = selectRepresentativeReport();
  if (!selected) throw new Error("No local OAC report found for payworthiness check.");
  const { renderReportHtml } = await import(pathToFileURL(path.join(root, "netlify", "lib", "report.mjs")).href + `?v=${Date.now()}`);
  const html = renderReportHtml(selected.report);
  const text = plainText(html);
  const workbench = readWorkbenchSummary();
  const workbenchText = workbench?.metrics?.text || "";
  const baselineFile = findBaselineHtml();
  const baselineText = baselineFile ? plainText(fs.readFileSync(baselineFile, "utf8")) : "";
  const currentDepth = businessDepth(text);
  const baselineDepth = baselineText ? businessDepth(baselineText) : 0;
  const sourceCount = selected.report.sources?.length || 0;
  const familyCount = sourceFamilyCount(selected.report);
  const salesText = sectionText(html, "view-sales");
  const presalesText = sectionText(html, "view-presales");
  const deliveryText = sectionText(html, "view-delivery");
  const actionText = sectionText(html, "view-action");
  const firstScreenText = text.slice(0, 2200);
  const modernCoverDecision =
    html.includes("cover-rating-badge") &&
    hasAll(firstScreenText, ["\u5546\u673a\u8bc4\u7ea7", "\u4f18\u5148\u5207\u5165"]) &&
    hasAny(firstScreenText, [C.risk, "\u6838\u5fc3", "\u673a\u4f1a", C.next]);

  const checks = {
    bossSeesWhyToBuy:
      workbench?.ok &&
      hasAll(workbenchText, [C.boss, C.sales, C.presales, C.delivery]) &&
      hasAny(workbenchText, [C.worthBuy, C.managementBuy]),
    reportFirstScreenAnswersDecision:
      modernCoverDecision ||
      (hasAll(text.slice(0, 1800), [C.rating, C.decision, C.next]) &&
        hasAny(text.slice(0, 1800), [C.budget, C.buy]) &&
        hasAny(text.slice(0, 1800), [C.risk, "\u907f\u5751"])),
    fivePerspectivePyramid:
      hasAll(text, [C.profile, C.salesAnalysis, C.solutionAnalysis, C.deliveryAnalysis, C.actionGuide]) &&
      (html.match(/class="argument-node/g) || []).length >= 18 &&
      (html.match(/class="argument-branch"/g) || []).length >= 45,
    salesPaysOff:
      hasAll(salesText, [
        "\u662f\u5426\u6709\u91c7\u8d2d\u80fd\u529b",
        "\u662f\u5426\u6709\u91c7\u8d2d\u4e60\u60ef",
        "\u662f\u5426\u8fd1\u671f\u53ef\u80fd\u6709\u9884\u7b97",
        "\u662f\u5426\u5df2\u6709\u540c\u7c7b\u9879\u76ee\u8ff9\u8c61",
        "\u662f\u5426\u5b58\u5728\u8fdb\u5165\u7a97\u53e3",
        "\u5546\u52a1\u98ce\u9669"
      ]),
    presalesPaysOff:
      hasAll(presalesText, [
        "\u5ba2\u6237\u53ef\u80fd\u7684\u6838\u5fc3\u4e1a\u52a1\u573a\u666f",
        "\u75db\u70b9\u673a\u4f1a",
        "\u89e3\u51b3\u601d\u8def",
        "\u914d\u5957\u89e3\u51b3\u65b9\u6848",
        "\u6570\u5b57\u5316\u6210\u719f\u5ea6",
        "\u65b9\u6848\u98ce\u9669\u70b9"
      ]),
    deliveryPaysOff:
      hasAll(deliveryText, [C.sow, "\u98ce\u9669\u8bc4\u4f30", "\u5e94\u5bf9\u65b9\u6848", "\u524d\u7f6e\u6761\u4ef6"]) &&
      !FORBIDDEN.some((term) => deliveryText.includes(term)),
    actionPaysOff:
      hasAll(actionText, ["\u5f00\u573a\u5207\u5165", "\u5fc5\u95ee\u95ee\u9898", "\u5185\u90e8\u8fb9\u754c", "\u4f1a\u540e\u66f4\u65b0"]),
    evidenceIsRichEnough: sourceCount >= 30 && familyCount >= 8,
    clearlyBeatsV1: baselineDepth ? currentDepth >= baselineDepth * 2 : currentDepth >= 120,
    noTrustDrainers: !FORBIDDEN.some((term) => text.includes(term))
  };
  const failures = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key);
  const output = {
    ok: failures.length === 0,
    reportFile: selected.file,
    company: selected.report.standardName || selected.report.companyName || path.basename(selected.file, ".json"),
    sourceCount,
    familyCount,
    currentDepth,
    baselineFile,
    baselineDepth,
    depthRatio: baselineDepth ? Number((currentDepth / baselineDepth).toFixed(2)) : null,
    checks,
    failures
  };
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, [
    "# OAC Payworthiness Check",
    "",
    `- Result: ${output.ok ? "PASS" : "FAIL"}`,
    `- Company: ${output.company}`,
    `- Sources: ${sourceCount}`,
    `- Source families: ${familyCount}`,
    `- Business depth: ${currentDepth}`,
    `- Baseline depth: ${baselineDepth || "-"}`,
    `- Depth ratio: ${output.depthRatio || "-"}`,
    "",
    "## Checks",
    ...Object.entries(checks).map(([key, ok]) => `- [${ok ? "x" : " "}] ${key}`),
    failures.length ? `\n## Failures\n${failures.map((item) => `- ${item}`).join("\n")}` : ""
  ].join("\n"), "utf8");
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
}

main().catch((error) => {
  const output = { ok: false, error: error?.message || String(error) };
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
  process.exitCode = 1;
});
