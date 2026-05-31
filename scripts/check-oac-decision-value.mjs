import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(root, "..");
const outPath = path.join(workspaceRoot, "oac-decision-value-summary.json");
const mdPath = path.join(workspaceRoot, "oac-decision-value-summary.md");

const PERSPECTIVES = [
  {
    key: "profile",
    title: "\u4f01\u4e1a\u753b\u50cf",
    className: "profile-argument-section",
    mustHave: ["\u8425\u6536\u80fd\u529b", "\u4f01\u4e1a\u53d1\u5c55\u9636\u6bb5", "\u7ec4\u7ec7\u590d\u6742\u5ea6", "\u884c\u4e1a\u5730\u4f4d", "\u7ba1\u7406\u6210\u719f\u5ea6"],
    businessQuestion: "\u8fd9\u5bb6\u516c\u53f8\u662f\u8c01\u3001\u5356\u4ec0\u4e48\u3001\u4e1a\u52a1\u5e95\u5ea7\u662f\u4ec0\u4e48\u3002",
    min: 3,
    max: 7
  },
  {
    key: "sales",
    title: "\u5546\u52a1\u5206\u6790",
    className: "sales-argument-section",
    mustHave: ["\u662f\u5426\u6709\u91c7\u8d2d\u80fd\u529b", "\u662f\u5426\u6709\u91c7\u8d2d\u4e60\u60ef", "\u662f\u5426\u8fd1\u671f\u53ef\u80fd\u6709\u9884\u7b97", "\u662f\u5426\u5df2\u6709\u540c\u7c7b\u9879\u76ee\u8ff9\u8c61", "\u662f\u5426\u5b58\u5728\u8fdb\u5165\u7a97\u53e3", "\u5546\u52a1\u98ce\u9669"],
    businessQuestion: "\u503c\u4e0d\u503c\u5f97\u6295\u5165\uff0c\u5982\u4f55\u63a8\u8fdb\uff0c\u4e3b\u8981\u5546\u52a1\u98ce\u9669\u662f\u4ec0\u4e48\u3002",
    min: 6,
    max: 8
  },
  {
    key: "presales",
    title: "\u65b9\u6848\u5206\u6790",
    className: "presales-argument-section",
    mustHave: ["\u5ba2\u6237\u53ef\u80fd\u7684\u6838\u5fc3\u4e1a\u52a1\u573a\u666f", "\u75db\u70b9\u673a\u4f1a", "\u89e3\u51b3\u601d\u8def", "\u914d\u5957\u89e3\u51b3\u65b9\u6848", "\u6570\u5b57\u5316\u6210\u719f\u5ea6", "\u65b9\u6848\u98ce\u9669\u70b9"],
    businessQuestion: "\u5ba2\u6237\u4e3a\u4ec0\u4e48\u9700\u8981\u65b9\u6848\uff0c\u6211\u65b9\u5e94\u8be5\u5148\u8bb2\u4ec0\u4e48\u65b9\u6848\u3002",
    min: 6,
    max: 8
  },
  {
    key: "delivery",
    title: "\u4ea4\u4ed8\u5206\u6790",
    className: "delivery-argument-section",
    mustHave: ["SOW\u5de5\u4f5c\u62c6\u5206", "\u98ce\u9669\u8bc4\u4f30", "\u5e94\u5bf9\u65b9\u6848", "\u524d\u7f6e\u6761\u4ef6"],
    businessQuestion: "\u5927\u6982\u8981\u505a\u54ea\u4e9b\u5de5\u4f5c\uff0c\u4ea4\u4ed8\u98ce\u9669\u548c\u524d\u7f6e\u6761\u4ef6\u662f\u4ec0\u4e48\u3002",
    min: 3,
    max: 5
  },
  {
    key: "action",
    title: "\u884c\u52a8\u6307\u5357",
    className: "action-argument-section",
    mustHave: ["\u5f00\u573a\u5207\u5165", "\u5fc5\u95ee\u95ee\u9898", "\u5185\u90e8\u8fb9\u754c", "\u4f1a\u540e\u66f4\u65b0"],
    businessQuestion: "\u8fd9\u6b21\u62dc\u8bbf\u600e\u4e48\u5f00\u573a\u3001\u95ee\u4ec0\u4e48\u3001\u54ea\u4e9b\u8bdd\u4e0d\u80fd\u4e71\u8bf4\u3002",
    min: 3,
    max: 5
  }
];

const VALUE_DRAIN_PATTERN = /\u4fe1\u606f\u4e0d\u8db3|\u6570\u636e\u4e0d\u8db3|\u8bc1\u636e\u4e0d\u8db3|\u65e0\u6cd5\u5f62\u6210(?:\u6709\u6548)?(?:\u8bba\u70b9|\u89c2\u70b9|\u7ed3\u8bba)|\u5de5\u4f5c\u91cf\u4f30\u7b97|\u4eba\u5929|\u5de5\u671f|\u4ef7\u683c\u4f30\u7b97|\u8d44\u6e90\u6295\u5165/;

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

function argumentNodeCount(section = "") {
  return (section.match(/class="argument-node(?:\s|")/g) || []).length;
}

function branchCounts(section = "") {
  return section
    .split(/<details class="argument-node/)
    .slice(1)
    .map((node) => (node.match(/class="argument-branch"/g) || []).length);
}

function nodeClaimTexts(section = "") {
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

function hasCompletePoint(text = "") {
  const clean = plainText(text).replace(/^\d+\s*[\uFF5C|]\s*/, "").trim();
  if (clean.length < 8) return false;
  if (!/[。！？.!?]$/.test(clean)) return false;
  return !VALUE_DRAIN_PATTERN.test(clean);
}

function firstExistingIndex(text = "", terms = [], startAt = 0) {
  const from = Math.max(0, startAt);
  const indexes = terms.map((term) => text.indexOf(term, from)).filter((index) => index >= 0);
  return indexes.length ? Math.min(...indexes) : -1;
}

function containsEnough(text = "", terms = []) {
  return terms.filter((term) => text.includes(term)).length >= Math.min(terms.length, 3);
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

function checkPerspective(html = "", perspective) {
  const section = sectionHtml(html, perspective.className);
  const text = plainText(section);
  const nodes = argumentNodeCount(section);
  const branches = branchCounts(section);
  const claims = nodeClaimTexts(section);
  const completeClaims = claims.filter(hasCompletePoint).length;
  const checks = {
    exists: Boolean(section),
    nodeCount: nodes >= perspective.min && nodes <= perspective.max,
    branchDepth: branches.length === nodes && branches.every((count) => count >= 1),
    completeClaims: claims.length === nodes && completeClaims === claims.length,
    answersRoleQuestion: containsEnough(text, perspective.mustHave),
    noLowValueText: !VALUE_DRAIN_PATTERN.test(text)
  };
  return {
    ...perspective,
    nodes,
    branchCounts: branches,
    claimCount: claims.length,
    completeClaims,
    weakClaims: claims.filter((claim) => !hasCompletePoint(claim)).slice(0, 5),
    checks,
    ok: Object.values(checks).every(Boolean)
  };
}

function scoreReport({ file, report }, html) {
  const text = plainText(html);
  const perspectives = PERSPECTIVES.map((item) => checkPerspective(html, item));
  const deliveryPanel = plainText(panelHtml(html, "view-delivery"));
  const sowIndex = deliveryPanel.indexOf("SOW\u5de5\u4f5c\u62c6\u5206");
  const riskIndex = firstExistingIndex(deliveryPanel, ["\u98ce\u9669\u8bc4\u4f30", "\u98ce\u9669\u4e0e\u5e94\u5bf9", "\u98ce\u9669\u5185\u5bb9", "\u98ce\u9669"], sowIndex);
  const globalChecks = {
    tabOrder: PERSPECTIVES.every((item) => text.includes(item.title)),
    executiveCover: html.includes("cover-rating-badge"),
    profileFirst: html.indexOf("view-profile") >= 0 && html.indexOf("view-profile") < html.indexOf("view-sales"),
    deliveryOrder: sowIndex >= 0 && riskIndex >= 0 && sowIndex < riskIndex,
    workPackageDepth: (html.match(/class="sow-work-group"/g) || []).length >= 6,
    noDeliveryEstimate: !VALUE_DRAIN_PATTERN.test(deliveryPanel),
    evidenceEnough: Array.isArray(report.sources) && report.sources.length >= 6 && sourceFamilyCount(report) >= 2,
    noGlobalLowValue: !VALUE_DRAIN_PATTERN.test(text),
    noTemplateBoilerplate: !/\u7684\u5173\u952e\u5224\u65ad\u662f|\u6838\u5fc3\u5224\u65ad\u662f\uff1a/.test(text),
    noBadSentenceJoin: !/\u3002[\uff0c,]|\u3002\u662f\u5224\u65ad/.test(text),
    noInternalStyle: !/\u5148\u627f\u8ba4|\u53ef\u5148\u7406\u89e3\u4e3a|\u8be5\u4fe1\u606f|\u8fd9\u7c7b\u57fa\u7840\u4fe1\u606f/.test(text)
  };
  const failures = [
    ...Object.entries(globalChecks).filter(([, ok]) => !ok).map(([key]) => key),
    ...perspectives.filter((item) => !item.ok).map((item) => `${item.title}: ${Object.entries(item.checks).filter(([, ok]) => !ok).map(([key]) => key).join(",")}`)
  ];
  return {
    company: report.standardName || report.companyName || path.basename(file, ".json"),
    file,
    sourceCount: Array.isArray(report.sources) ? report.sources.length : 0,
    familyCount: sourceFamilyCount(report),
    perspectives,
    globalChecks,
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
    results,
    summaryPath: mdPath
  };
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, `# OAC Decision Value Check\n\n- ok: ${output.ok}\n- pass: ${output.passCount}/${output.sampleCount}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
