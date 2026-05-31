import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(root, "..");
const previewPath = path.join(workspaceRoot, "oac-preview-latest.html");
const outPath = path.join(workspaceRoot, "oac-preview-structure-summary.json");

const VIEWS = [
  { key: "profile", title: "\u4f01\u4e1a\u753b\u50cf", className: "view-profile", argumentClass: "profile-argument-section" },
  { key: "sales", title: "\u5546\u52a1\u5206\u6790", className: "view-sales", argumentClass: "sales-argument-section" },
  { key: "presales", title: "\u65b9\u6848\u5206\u6790", className: "view-presales", argumentClass: "presales-argument-section" },
  { key: "delivery", title: "\u4ea4\u4ed8\u5206\u6790", className: "view-delivery", argumentClass: "delivery-argument-section" },
  { key: "action", title: "\u884c\u52a8\u6307\u5357", className: "view-action", argumentClass: "action-argument-section" }
];

const VIEW_REQUIREMENTS = {
  profile: {
    min: 5,
    max: 7,
    orderedLabels: [
      "\u8425\u6536\u80fd\u529b",
      "\u4f01\u4e1a\u53d1\u5c55\u9636\u6bb5",
      "\u7ec4\u7ec7\u590d\u6742\u5ea6",
      "\u884c\u4e1a\u5730\u4f4d",
      "\u7ba1\u7406\u6210\u719f\u5ea6\u521d\u5224"
    ]
  },
  sales: {
    min: 6,
    max: 8,
    orderedLabels: [
      "\u662f\u5426\u6709\u91c7\u8d2d\u80fd\u529b",
      "\u662f\u5426\u6709\u91c7\u8d2d\u4e60\u60ef",
      "\u662f\u5426\u8fd1\u671f\u53ef\u80fd\u6709\u9884\u7b97",
      "\u662f\u5426\u5df2\u6709\u540c\u7c7b\u9879\u76ee\u8ff9\u8c61",
      "\u662f\u5426\u5df2\u6709\u4f9b\u5e94\u5546\u6216\u7ade\u54c1",
      "\u662f\u5426\u53ef\u80fd\u53ea\u662f\u4f4e\u4ef7\u503c\u5ba2\u6237",
      "\u662f\u5426\u5b58\u5728\u8fdb\u5165\u7a97\u53e3",
      "\u5546\u52a1\u98ce\u9669"
    ]
  },
  presales: {
    min: 6,
    max: 8,
    orderedLabels: [
      "\u5ba2\u6237\u53ef\u80fd\u7684\u6838\u5fc3\u4e1a\u52a1\u573a\u666f",
      "\u75db\u70b9\u673a\u4f1a",
      "\u89e3\u51b3\u601d\u8def",
      "\u914d\u5957\u89e3\u51b3\u65b9\u6848",
      "\u6570\u5b57\u5316\u6210\u719f\u5ea6",
      "\u53ef\u80fd\u5df2\u6709\u7cfb\u7edf",
      "\u66ff\u6362\u673a\u4f1a",
      "\u65b9\u6848\u98ce\u9669\u70b9"
    ]
  },
  delivery: { min: 3, max: 5, orderedLabels: ["SOW\u5de5\u4f5c\u62c6\u5206", "\u98ce\u9669\u8bc4\u4f30", "\u5e94\u5bf9\u65b9\u6848", "\u524d\u7f6e\u6761\u4ef6"] },
  action: { min: 3, max: 5, orderedLabels: ["\u5f00\u573a\u5207\u5165", "\u5fc5\u95ee\u95ee\u9898", "\u5185\u90e8\u8fb9\u754c", "\u4f1a\u540e\u66f4\u65b0"] }
};

const INVALID_POINT_PATTERN =
  /\u6570\u636e\u4e0d\u8db3|\u8bc1\u636e\u4e0d\u8db3|\u4e0d\u8db3\u4ee5\u652f\u6491|\u6ca1\u6709(?:\u660e\u786e|\u53ef\u7528)(?:\u8bba\u70b9|\u89c2\u70b9|\u7ed3\u8bba|\u4f9d\u636e)|\u65e0\u6cd5\u5f62\u6210(?:\u6709\u6548)?(?:\u8bba\u70b9|\u89c2\u70b9|\u7ed3\u8bba|\u5224\u65ad)/;
const DELIVERY_ESTIMATE_PATTERN =
  /\u4eba\u5929|\u5de5\u671f|\u4ef7\u683c\u4f30\u7b97|\u5de5\u4f5c\u91cf\u4f30\u7b97|\u7c97\u4f30|\u8d44\u6e90\u6295\u5165|\u8d39\u7528\u533a\u95f4|\u91c7\u8d2d\u4ef7\u683c/;

function walk(dir, callback) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, callback);
    else callback(full);
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function latestReportFile() {
  let latest = null;
  walk(path.join(root, "local-data"), (file) => {
    if (!file.endsWith(".json") || !file.includes(`${path.sep}reports${path.sep}`)) return;
    const stat = fs.statSync(file);
    if (!latest || stat.mtimeMs > latest.mtimeMs) latest = { file, mtimeMs: stat.mtimeMs };
  });
  return latest?.file || "";
}

function plainText(html = "") {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function panelHtml(html = "", className = "") {
  const marker = `<div class="report-view-panel ${className}`;
  const start = html.indexOf(marker);
  if (start < 0) return "";
  const tail = html.slice(start);
  const next = tail.indexOf('<div class="report-view-panel', marker.length);
  return next >= 0 ? tail.slice(0, next) : tail;
}

function argumentSectionHtml(panel = "", className = "") {
  const marker = `<section class="battle-section argument-section ${className}`;
  const start = panel.indexOf(marker);
  if (start < 0) return "";
  const tail = panel.slice(start);
  const end = tail.indexOf("</section>");
  return end >= 0 ? tail.slice(0, end + "</section>".length) : tail;
}

function count(pattern, text = "") {
  return (String(text).match(pattern) || []).length;
}

function invalidPointCount(text = "") {
  const sentences = String(text).match(/[^。；;]+[。；;]?/g) || [];
  return sentences.filter((sentence) => {
    if (!INVALID_POINT_PATTERN.test(sentence)) return false;
    return !/暂无法判断|无法判断|未查到明确|未查到客户作为甲方|已读来源未形成/.test(sentence);
  }).length;
}

function labelsInOrder(text = "", labels = []) {
  let cursor = -1;
  const present = [];
  for (const label of labels) {
    const index = text.indexOf(label);
    if (index >= 0) {
      present.push(label);
      if (index < cursor) return { ok: false, present, missing: labels.filter((item) => !present.includes(item)) };
      cursor = index;
    }
  }
  const minPresent = Math.min(labels.length, 3);
  return {
    ok: present.length >= minPresent,
    present,
    missing: labels.filter((item) => !present.includes(item))
  };
}

function argumentNodeLabels(argument = "") {
  return Array.from(String(argument).matchAll(/<summary>\s*<span>([\s\S]*?)<\/span>/g))
    .map((match) => plainText(match[1] || "").replace(/^\d+\s*[\uFF5C|]\s*/, ""))
    .filter(Boolean);
}

function labelsInNodeOrder(argument = "", labels = []) {
  const nodeLabels = argumentNodeLabels(argument);
  const present = nodeLabels.filter((label) => labels.includes(label));
  const indexes = present.map((label) => labels.indexOf(label));
  const ordered = indexes.every((value, index) => index === 0 || value > indexes[index - 1]);
  const minPresent = Math.min(labels.length, 3);
  return {
    ok: ordered && present.length >= minPresent,
    present,
    missing: labels.filter((item) => !present.includes(item))
  };
}

async function ensurePreview() {
  if (fs.existsSync(previewPath)) return fs.readFileSync(previewPath, "utf8");
  const file = latestReportFile();
  if (!file) throw new Error("No report found to render preview.");
  const report = readJson(file);
  const { renderReportHtml } = await import(pathToFileURL(path.join(root, "netlify", "lib", "report.mjs")).href + `?v=${Date.now()}`);
  const html = renderReportHtml(report);
  fs.writeFileSync(previewPath, html, "utf8");
  return html;
}

async function main() {
  const html = await ensurePreview();
  const text = plainText(html);
  const tabIndexes = VIEWS.map((view) => ({ ...view, index: text.indexOf(view.title) }));
  const panelResults = VIEWS.map((view) => {
    const panel = panelHtml(html, view.className);
    const argument = argumentSectionHtml(panel, view.argumentClass);
    const argumentText = plainText(argument);
    const nodeCount = count(/class="argument-node(?:\s|")/g, argument);
    const branchCount = count(/class="argument-branch"/g, argument);
    const requirement = VIEW_REQUIREMENTS[view.key] || { min: 3, max: 5, orderedLabels: [] };
    const labelOrder = labelsInNodeOrder(argument, requirement.orderedLabels);
    return {
      key: view.key,
      title: view.title,
      exists: Boolean(panel),
      hasArgumentSection: Boolean(argument),
      nodeCount,
      branchCount,
      nodeCountOk: nodeCount >= requirement.min && nodeCount <= requirement.max,
      branchCountOk: branchCount >= nodeCount,
      invalidPointCount: invalidPointCount(argumentText),
      expectedRange: [requirement.min, requirement.max],
      labelOrder
    };
  });
  const deliveryPanel = panelHtml(html, "view-delivery");
  const deliveryText = plainText(deliveryPanel);
  const failures = [];
  if (!/id="view-profile"\s+checked/.test(html)) failures.push("profile tab is not default");
  if (!tabIndexes.every((item) => item.index >= 0)) failures.push("missing tab label");
  if (!tabIndexes.every((item, index, arr) => index === 0 || item.index > arr[index - 1].index)) failures.push("tab order is wrong");
  for (const result of panelResults) {
    if (!result.exists) failures.push(`${result.key}: missing panel`);
    if (!result.hasArgumentSection) failures.push(`${result.key}: missing main argument section`);
    if (!result.nodeCountOk) failures.push(`${result.key}: first-level section count must be ${result.expectedRange[0]}-${result.expectedRange[1]}`);
    if (!result.branchCountOk) failures.push(`${result.key}: second-level branch count too low`);
    if (!result.labelOrder.ok) failures.push(`${result.key}: expected business labels missing or out of order`);
    if (result.invalidPointCount) failures.push(`${result.key}: invalid non-decision point leaked`);
  }
  if (!(deliveryText.indexOf("SOW\u5de5\u4f5c\u62c6\u5206") >= 0 && deliveryText.indexOf("\u98ce\u9669\u8bc4\u4f30") >= 0 && deliveryText.indexOf("SOW\u5de5\u4f5c\u62c6\u5206") < deliveryText.indexOf("\u98ce\u9669\u8bc4\u4f30"))) {
    failures.push("delivery SOW must appear before risk assessment");
  }
  if (DELIVERY_ESTIMATE_PATTERN.test(deliveryText)) failures.push("delivery estimate wording leaked");
  if (invalidPointCount(text)) failures.push("invalid non-decision point leaked globally");
  const output = {
    ok: failures.length === 0,
    previewPath,
    tabIndexes,
    panelResults,
    delivery: {
      hasSowBeforeRisk: failures.includes("delivery SOW must appear before risk assessment") ? false : true,
      hasEstimateWords: DELIVERY_ESTIMATE_PATTERN.test(deliveryText)
    },
    failures
  };
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
}

main().catch((error) => {
  const output = { ok: false, error: error?.message || String(error) };
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
  process.exitCode = 1;
});
