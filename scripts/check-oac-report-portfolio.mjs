import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(root, "..");
const outPath = path.join(workspaceRoot, "oac-report-portfolio-summary.json");

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

function has(text, pattern) {
  return new RegExp(pattern, "i").test(String(text || ""));
}

function sectionHtml(html = "", className = "") {
  const marker = `<section class="battle-section argument-section ${className}`;
  const start = html.indexOf(marker);
  if (start < 0) return "";
  const tail = html.slice(start);
  const end = tail.indexOf("</section>");
  return end >= 0 ? tail.slice(0, end + 10) : tail;
}

function argumentBranchCounts(section = "") {
  return section
    .split(/<details class="argument-node/)
    .slice(1)
    .map((node) => (node.match(/class="argument-branch"/g) || []).length);
}

function argumentClaims(section = "") {
  return String(section || "")
    .split(/<details class="argument-node/)
    .slice(1)
    .map((node) => {
      const summary = node.match(/<summary>[\s\S]*?<\/summary>/)?.[0] || "";
      const claim = summary.match(/<b>([\s\S]*?)<\/b>/)?.[1] || "";
      return plainText(claim);
    })
    .filter(Boolean);
}

function isCompleteClaim(text = "") {
  const clean = plainText(text).replace(/^\d+\s*[\uFF5C|]\s*/, "").trim();
  const compact = clean.replace(/\s+/g, "");
  if (compact.length < 8) return false;
  if (!/[\u3002\uFF01\uFF1F.!?]$/.test(clean)) return false;
  if (!/[\u4E00-\u9FFFA-Za-z0-9]/.test(compact)) return false;
  if (/^[A-Za-z0-9\s\uFF5C|:：-]{1,24}$/.test(clean)) return false;
  return true;
}

function hasEnoughBranches(branchCounts = [], min = 1) {
  return branchCounts.length > 0 && branchCounts.every((count) => count >= min);
}

function allPerspectiveBranchesOk(html = "") {
  return [
    "profile-argument-section",
    "sales-argument-section",
    "presales-argument-section",
    "delivery-argument-section",
    "action-argument-section"
  ].every((className) => hasEnoughBranches(argumentBranchCounts(sectionHtml(html, className))));
}

function allPerspectiveClaimsOk(html = "") {
  return [
    ["profile-argument-section", 3],
    ["sales-argument-section", 6],
    ["presales-argument-section", 6],
    ["delivery-argument-section", 3],
    ["action-argument-section", 2]
  ].every(([className, min]) => {
    const claims = argumentClaims(sectionHtml(html, className));
    return claims.length >= min && claims.every(isCompleteClaim);
  });
}

function cleanPortfolioChecks({ text, html, sourceCount, families }) {
  const actionText = plainText(sectionHtml(html, "action-argument-section"));
  return {
    perspectiveTabs:
      html.includes("report-view-tabs") &&
      html.includes('id="view-profile" checked') &&
      has(text, "\u4f01\u4e1a\u753b\u50cf") &&
      has(text, "\u5546\u52a1\u5206\u6790") &&
      has(text, "\u65b9\u6848\u5206\u6790") &&
      has(text, "\u4ea4\u4ed8\u5206\u6790") &&
      has(text, "\u884c\u52a8\u6307\u5357"),
    salesValue:
      html.includes("sales-argument-section") &&
      html.includes("argument-tree") &&
      has(text, "\u5ba2\u6237\u4f18\u5148\u7ea7|\u6295\u5165\u5efa\u8bae|\u503c\u5f97|\u91cd\u70b9\u8ddf\u8fdb|\u8f7b\u91cf\u63a8\u8fdb") &&
      has(text, "\u9884\u7b97|\u4e70\u5355|\u4ed8\u6b3e|\u8425\u6536|\u5229\u6da6") &&
      has(text, "\u7ec4\u7ec7\u4e0e\u5173\u952e\u4eba|\u51b3\u7b56\u94fe|\u62cd\u677f|\u9884\u7b97\u5f52\u5c5e|\u91c7\u8d2d|\u8d1f\u8d23\u4eba|\u89d2\u8272"),
    presalesValue:
      html.includes("presales-argument-section") &&
      has(text, "\u5ba2\u6237\u73b0\u72b6|\u75db\u70b9\u673a\u4f1a|\u603b\u4f53\u89e3\u51b3\u601d\u8def|\u63a8\u8350\u5207\u5165\u8bdd\u9898") &&
      has(text, "\u5ba2\u6237\u75db\u70b9") &&
      has(text, "\u65b9\u6848\u4ecb\u7ecd") &&
      has(text, "\u65b9\u6848\u4ef7\u503c") &&
      has(text, "\u9884\u671f\u6210\u6548"),
    deliveryValue:
      html.includes("delivery-argument-section") &&
      has(text, "\u4ea4\u4ed8\u5206\u6790|\u4ea4\u4ed8\u9884\u5224|SOW|\u5de5\u4f5c\u62c6\u5206") &&
      has(text, "\u4ea4\u4ed8\u98ce\u9669|\u4ea4\u4ed8\u4f9d\u8d56|\u6280\u672f\u8def\u5f84|\u6280\u672f\u67b6\u6784|\u524d\u7f6e\u6761\u4ef6"),
    actionValue:
      html.includes("action-argument-section") &&
      has(actionText, "\u884c\u52a8\u6307\u5357|\u73b0\u573a\u95ee\u5377|\u91cd\u70b9\u5173\u6ce8\u4e8b\u9879|\u62dc\u8bbf\u95ee\u5377"),
    actionGuideSection:
      html.includes("action-argument-section") &&
      has(actionText, "\u73b0\u573a\u95ee\u5377") &&
      has(actionText, "\u91cd\u70b9\u5173\u6ce8\u4e8b\u9879"),
    actionGuideNoOldScaffold:
      html.includes("action-argument-section") &&
      !has(actionText, "\u5f00\u573a\u5207\u5165|\u4f1a\u540e\u66f4\u65b0|\u5185\u90e8\u8fb9\u754c|\u4e0b\u4e00\u6b65\u52a8\u4f5c"),
    presalesPlaybook:
      html.includes("presales-argument-section") &&
      has(text, "\u5ba2\u6237\u53ef\u80fd\u7684\u6838\u5fc3\u4e1a\u52a1\u573a\u666f|\u5ba2\u6237\u6838\u5fc3\u4e1a\u52a1\u573a\u666f") &&
      has(text, "\u75db\u70b9\u673a\u4f1a") &&
      has(text, "\u89e3\u51b3\u601d\u8def") &&
      has(text, "\u914d\u5957\u89e3\u51b3\u65b9\u6848") &&
      has(text, "\u65b9\u6848\u98ce\u9669\u70b9|\u65b9\u6848\u4f18\u5148\u7ea7"),
    questionnaireValidation:
      html.includes("action-argument-section") &&
      has(actionText, "\u4e1a\u52a1\u573a\u666f") &&
      has(actionText, "\u9884\u7b97\u4e0e\u91c7\u8d2d") &&
      has(actionText, "\u7cfb\u7edf\u4e0e\u6570\u636e") &&
      has(actionText, "\u4ea4\u4ed8\u9a8c\u6536") &&
      has(actionText, "\u9884\u7b97|\u91c7\u8d2d") &&
      has(actionText, "\u6570\u636e|\u7cfb\u7edf|\u63a5\u53e3|\u6743\u9650|\u6837\u4f8b"),
    perspectiveBranchDensity: allPerspectiveBranchesOk(html),
    perspectiveCompleteClaims: allPerspectiveClaimsOk(html),
    evidenceUsable: sourceCount >= 10,
    evidenceRich: sourceCount >= 15 && families.size >= 5,
    noBadText: !has(
      text,
      "\u9690\u85cf\u4f4e\u76f8\u5173|\u654f\u611f\u4fe1\u606f\u6838\u9a8c|model-planning|\u4efb\u52a1\u4e2d\u5fc3\u540c\u6b65\u5f02\u5e38|\u98ce\u9669\uff1a\u98ce\u9669|\u5386\u53f2\u96c6\u56e2\u7ebf\u7d22\uff1a\u5386\u53f2|\u7c97\u4eba\u5929|\u4eba\u5929\u533a\u95f4|\u4fe1\u606f\u4e0d\u8db3|\u6570\u636e\u4e0d\u8db3|\u8bc1\u636e\u4e0d\u8db3|\u516c\u5f00\u6765\u6e90\u4e0d\u8db3|\u6765\u6e90\u4e0d\u8db3|\u8d44\u6599\u6709\u9650|\u5f53\u524d\u6ca1\u6709\u8db3\u591f|\u6ca1\u6709\u8db3\u4ee5|\u672a\u770b\u5230\u8db3\u591f|\u4e0d\u8db3\u4ee5(?:\u652f\u6491|\u5224\u65ad|\u5206\u6790)|\u4e0d\u80fd\u76f4\u63a5(?:\u5224|\u5224\u65ad|\u8bc4\u4f30|\u63a8\u65ad|\u652f\u6491)|\u5f85\u6838\u9a8c\u98ce\u9669|\u7528\u6237\u63d0\u4f9b\u7ebf\u7d22\u5f85\u786e\u8ba4|\u672a\u8bc1\u5b9e(?:\u5185\u5bb9|\u7ebf\u7d22)|\u7f6e\u4fe1\u5ea6\u4e2d|\u7f3a\u5c11(?:\u8d22\u52a1|\u9884\u7b97|\u8bc1\u636e|\u7ebf\u7d22|\u6570\u636e|\u6307\u6807)"
    )
  };
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
    if (!current || stat.mtimeMs > current.mtimeMs) {
      map.set(company, { file, report, mtimeMs: stat.mtimeMs });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function scoreReport({ file, report }, html) {
  const text = plainText(html);
  const sourceCount = Array.isArray(report.sources) ? report.sources.length : 0;
  const familyCounts = report.evidencePool?.familyCounts || {};
  const families = new Set([
    ...Object.entries(familyCounts).filter(([, count]) => Number(count) > 0).map(([family]) => family),
    ...(report.sources || []).map((item) => item.sourceFamily || item.topic || item.sourceType).filter(Boolean)
  ]);
  const checks = cleanPortfolioChecks({ text, html, sourceCount, families });
  const failures = Object.entries(checks)
    .filter(([key, ok]) => key !== "evidenceRich" && !ok)
    .map(([key]) => key);
  return {
    company: report.standardName || report.companyName || path.basename(file, ".json"),
    file,
    sourceCount,
    familyCount: families.size,
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
  const candidates = latestByCompany(files)
    .filter(({ report }) => (report.sources || []).length >= 10)
    .slice(0, 8);
  const results = [];
  for (const item of candidates) {
    const normalized = reportMod.normalizeReportShape(item.report);
    const html = reportMod.renderReportHtml(normalized);
    results.push(scoreReport({ file: item.file, report: normalized }, html));
  }
  const failures = results.flatMap((result) => result.failures.map((failure) => `${result.company}: ${failure}`));
  if (results.length < 5) failures.push(`portfolio sample too small: ${results.length}`);
  const richEvidenceCount = results.filter((result) => result.checks.evidenceRich).length;
  if (richEvidenceCount < 3) failures.push(`rich evidence sample too small: ${richEvidenceCount}`);
  const output = {
    ok: failures.length === 0,
    sampleCount: results.length,
    passCount: results.filter((item) => item.ok).length,
    richEvidenceCount,
    failures,
    results
  };
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
