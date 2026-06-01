import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  return [
    "Usage: node scripts/check-oac-report-quality.mjs [report.json] [options]",
    "",
    "Options:",
    "  --report <path>      Report JSON to inspect. Defaults to latest local report.",
    "  --baseline <path>    Optional 1.0 HTML baseline for comparison.",
    "  --no-baseline        Skip baseline discovery and judge by absolute quality gates.",
    "  --preview <path>     HTML preview output path.",
    "  --summary <path>     Markdown summary output path.",
    "  --help               Show this help."
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    reportFile: "",
    baselineFile: "",
    noBaseline: false,
    previewPath: path.resolve(root, "..", "oac-preview-latest.html"),
    summaryPath: path.resolve(root, "..", "oac-quality-summary.md")
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--help" || item === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (item === "--no-baseline") {
      options.noBaseline = true;
      continue;
    }
    if (item === "--report" || item === "--baseline" || item === "--preview" || item === "--summary") {
      const value = argv[index + 1];
      if (!value) throw new Error(`Missing value for ${item}`);
      index += 1;
      if (item === "--report") options.reportFile = path.resolve(value);
      if (item === "--baseline") options.baselineFile = path.resolve(value);
      if (item === "--preview") options.previewPath = path.resolve(value);
      if (item === "--summary") options.summaryPath = path.resolve(value);
      continue;
    }
    if (item.startsWith("--")) throw new Error(`Unknown option: ${item}`);
    if (!options.reportFile) options.reportFile = path.resolve(item);
    else throw new Error(`Unexpected extra argument: ${item}`);
  }
  return options;
}

const TERMS = {
  HolliCube: "HolliCube",
  Holli: "Holli",
  MES: "MES",
  APS: "APS",
  ERP: "ERP",
  WMS: "WMS",
  LIMS: "LIMS",
  AIOps: "AIOps",
  ecosystem: "\u751f\u6001",
  bid: "\u6295\u6807",
  presales: "\u552e\u524d",
  projectDelivery: "\u9879\u76ee\u4ea4\u4ed8",
  digitalFactory: "\u6570\u5b57\u5316\u5de5\u5382",
  industrialInternet: "\u5de5\u4e1a\u4e92\u8054\u7f51",
  solution: "\u89e3\u51b3\u65b9\u6848",
  customerCase: "\u5ba2\u6237\u6848\u4f8b",
  customer: "\u5ba2\u6237",
  delivery: "\u4ea4\u4ed8",
  operation: "\u8fd0\u7ef4",
  integration: "\u96c6\u6210"
};

const BAD_PATTERNS = {
  emptyUnknown:
    "\u672a\u83b7\u53d6\u5230|\u672a\u53d6\u5f97|\u8d44\u6599\u4e0d\u8db3|\u516c\u5f00\u4fe1\u606f\u4e0d\u8db3",
  devLog:
    "\u9690\u85cf\u4f4e\u76f8\u5173|\u654f\u611f\u4fe1\u606f\u6838\u9a8c|model-planning|\u540e\u53f0\u51fd\u6570|\u4efb\u52a1\u4e2d\u5fc3\u540c\u6b65\u5f02\u5e38|\u6838\u5fc3\u89c2\u70b9|\u5c55\u5f00\u75db\u70b9|\u5c55\u5f00\u4ea4\u4ed8\u5224\u65ad\u4f9d\u636e|\u5c55\u5f00\u4f01\u4e1a\u753b\u50cf\u8d44\u6599",
  duplicateRisk:
    "\u98ce\u9669\uff1a\u98ce\u9669|\u5386\u53f2\u96c6\u56e2\u7ebf\u7d22\uff1a\u5386\u53f2",
  pseudoCoverRisk:
    "\u98ce\u9669\uff1a[^<\n]{0,160}(?:\u503c\u5f97(?:\u91cd\u70b9)?\u8ddf\u8fdb|\u5177\u5907(?:\u660e\u786e)?\u8865\u5145\u9700\u6c42|\u5efa\u8bae\u91cd\u70b9|\u5b81\u6ce2\u672c\u5730\u5177\u5907\u5f3a\u653f\u7b56\u8d44\u6e90|\u80a1\u6743\\/\u63a7\u5236\u6743\uff1a\u7cfb\u7edf\u5df2\u901a\u8fc7|\u7cfb\u7edf\u5df2\u901a\u8fc7(?:\u5b98\u65b9|\u6cd5\u9662|\u4fe1\u7528\u5e73\u53f0)[^<\n]{0,80}\u6838\u9a8c\u5230\u80a1\u6743)",
  weakQuestion:
    "<li>(?:\u4e86\u89e3|\u73b0\u573a\u786e\u8ba4|\u786e\u8ba4AI\u76f8\u5173\u9879\u76ee|\u786e\u8ba4\u4e0e\u96c6\u56e2|\u786e\u8ba4\u672c\u6b21|\u4f1a\u524d\u5c3d\u91cf\u4e86\u89e3)",
  hardBoundary:
    "\u5426\u5219\u4e0d\u8fdb\u5165\u91cd\u65b9\u6848\u548c\u6b63\u5f0f\u627f\u8bfa|\u672a\u9501\u5b9a\u9879\u4e0d\u8fdb\u5165\u627f\u8bfa",
  badPunctuation: "\u3002\uff1b|\uff1b\u3002|\uff0c\uff0c|\u3002\u3002",
  roughEffort: "\u7c97\u4eba\u5929|\u4eba\u5929\u533a\u95f4|\\d+\\s*[-~]\\s*\\d+\\s*\u4eba\u5929",
  deliveryInstruction:
    "\u4ea4\u4ed8\u5206\u6790[\\s\\S]{0,2600}(?:\u63a8\u8fdb\u524d\u8981\u9501\u5b9a|IT\u63a5\u53e3\u4eba|\u5ba2\u6237\u8d23\u4efb\u4eba|\u73b0\u573a\u8054\u7cfb\u4eba)",
  oldDeliveryScaffold:
    "\u4ea4\u4ed8\u5206\u6790[\\s\\S]{0,2600}(?:\u76f8\u5bf9\u96be\u70b9|\u4ea4\u4ed8\u8fb9\u754c|\u6574\u4f53\u590d\u6742\u6027|SOW\u5de5\u4f5c\u62c6\u5206)",
  ratingEcho:
    "\u51b3\u7b56\u98ce\u9669\u9700\u56f4\u7ed5\u5177\u4f53\u98ce\u9669\u590d\u6838|IT\\/\u6cd5\u52a1\\/\u4fe1\u606f\u5316\u8fb9\u754c\u5fc5\u987b\u524d\u7f6e\u9501\u5b9a|\u9879\u76ee\u7ea7\u9884\u7b97\u5f52\u5c5e\u3001\u63a8\u8fdb\u4eba\u548cIT\\/\u5b89\u5168\u5ba1\u6279\u51b3\u5b9a\u662f\u5426\u5347\u7ea7\u91cd\u65b9\u6848\u6295\u5165",
  incompleteSolutionField:
    "<em>(?:\u6211\u65b9\u673a\u4f1a|\u5ba2\u6237\u75db\u70b9|\u65b9\u6848\u4ecb\u7ecd|\u65b9\u6848\u4ef7\u503c|\u9002\u7528\u524d\u63d0)<\\/em><p>\\s*(?:\u80fd|\u53ef|\u53ef\u4ee5|\u80fd\u591f)?\\s*(?:\\.{2,}|\u2026|[，,：:；;])",
  weakWindow:
    "(?:\u5b58\u5728\u53ef\u8ddf\u8fdb\u7a97\u53e3|\u9884\u7b97\u7a97\u53e3\u6765\u81ea)[^<\n]{0,180}(?:\u672a\u660e\u786e|\u672a\u786e\u8ba4|\u672a\u8bc1\u5b9e|\u6700\u4f73\u5207\u5165\u70b9|\u878d\u8d44\u670d\u52a1)",
  financeAsBusinessQuestion:
    "\u73b0\u573a\u6700\u5148\u8981\u95ee\u6e05\uff1a\u73b0\u573a\u786e\u8ba4\u8fd1\u4e24\u5e74\u8425\u4e1a\u6536\u5165|\u5148\u95ee\u4e1a\u52a1\u75db\u70b9\\s*\u73b0\u573a\u786e\u8ba4\u8fd1\u4e24\u5e74\u8425\u4e1a\u6536\u5165|\u7cfb\u7edf\u672a\u80fd\u901a\u8fc7\u516c\u5f00\u6765\u6e90\u8bc1\u5b9e",
  financeAsPresalesTopic:
    "\u521d\u8bbf\u8bdd\u9898\u5e94\u4ece\u5ba2\u6237\u8fd1\u671f\u66b4\u9732\u51fa\u7684\u4e1a\u52a1\u548c\u80fd\u529b\u7f3a\u53e3\u5207\u5165\uff1a(?:\u516c\u5f00\u6e20\u9053\u5b58\u5728\u8d22\u52a1|\u5de5\u5546\u548c\u80a1\u6743)|\u65b9\u6848\u5206\u6790[\\s\\S]{0,1200}(?:\u516c\u5f00\u6e20\u9053\u5b58\u5728\u8d22\u52a1\u6216\u5e74\u62a5\u8bb0\u5f55|\u5de5\u5546\u548c\u80a1\u6743\u4fe1\u606f\u53ef\u7528\u4e8e\u5224\u65ad\u4e3b\u4f53\u8fb9\u754c)",
  financeAsTrigger:
    "\u8fd1\u671f(?:\u63a5\u89e6\u7a97\u53e3|\u89e6\u53d1)[^<\n]{0,180}(?:\u8d22\u52a1|\u5e74\u62a5|\u8425\u4e1a\u6536\u5165|\u51c0\u5229\u6da6|\u7ecf\u8425\u4f53\u91cf|\u4ed8\u6b3e\u8d28\u91cf|\u6ce8\u518c\u8d44\u672c|\u5de5\u5546)",
  financeAsActionQuestion:
    "\u884c\u52a8\u6307\u5357[\\s\\S]{0,1600}(?:\u73b0\u573a\u786e\u8ba4\u8fd1\u4e24\u5e74\u8425\u4e1a\u6536\u5165|\u5ba2\u6237\u6700\u8fd1\u4e24\u5e74\u7684\u7ecf\u8425\u89c4\u6a21|\u8425\u4e1a\u6536\u5165\u3001\u51c0\u5229\u6da6\u3001\u7814\u53d1\u6295\u5165)",
  invalidPointClaim:
    "\u6ca1\u6709(?:\u660e\u786e|\u53ef\u7528)(?:\u8bba\u70b9|\u89c2\u70b9|\u7ed3\u8bba|\u4f9d\u636e)|\u65e0\u6cd5\u5f62\u6210(?:\u6709\u6548)?(?:\u8bba\u70b9|\u89c2\u70b9|\u7ed3\u8bba|\u5224\u65ad)|\u4e0d\u80fd\u4f5c\u4e3a(?:\u6709\u6548)?(?:\u8bba\u70b9|\u89c2\u70b9|\u7ed3\u8bba|\u4f9d\u636e)|\u5c1a\u4e0d\u8db3\u4ee5(?:\u652f\u6491|\u5224\u65ad|\u5206\u6790)",
  academicLabel: "\u5206\u8bba\u70b9",
  systemNodeLabel: "\u5224\u65ad\u9879\\s*\\d+",
  lowValueClaim:
    "\u4fe1\u606f\u4e0d\u8db3|\u6570\u636e\u4e0d\u8db3|\u8bc1\u636e\u4e0d\u8db3|\u516c\u5f00\u6765\u6e90\u4e0d\u8db3|\u6765\u6e90\u4e0d\u8db3|\u8d44\u6599\u6709\u9650|\u5f53\u524d\u6ca1\u6709\u8db3\u591f|\u6ca1\u6709\u8db3\u4ee5|\u672a\u770b\u5230\u8db3\u591f|\u4e0d\u8db3\u4ee5(?:\u652f\u6491|\u5224\u65ad|\u5206\u6790)|\u4e0d\u80fd\u76f4\u63a5(?:\u5224|\u5224\u65ad|\u8bc4\u4f30|\u63a8\u65ad|\u652f\u6491)|\u5f85\u6838\u9a8c\u98ce\u9669|\u7528\u6237\u63d0\u4f9b\u7ebf\u7d22\u5f85\u786e\u8ba4|\u672a\u8bc1\u5b9e(?:\u5185\u5bb9|\u7ebf\u7d22)|\u7f6e\u4fe1\u5ea6\u4e2d|\u7f3a\u5c11(?:\u8d22\u52a1|\u9884\u7b97|\u8bc1\u636e|\u7ebf\u7d22|\u6570\u636e|\u6307\u6807)|\u7cfb\u7edf\u53d1\u73b0|\u53ea\u6709\u5355\u4e00\u6216\u95f4\u63a5\u7ebf\u7d22|\u7ebf\u7d22\u53ea\u4f5c\u4e3a\u5546\u52a1\u590d\u6838\u9879|\u516c\u5f00\u6e20\u9053\u5b58\u5728|\u4e0d\u5efa\u8bae\u627f\u8bfa|\u6b63\u5f0f\u62a5\u4ef7|\u8fc7\u65e9\u62a5\u4ef7|\u62a5\u4ef7\u7a7a\u95f4|\u62a5\u4ef7\u8fb9\u754c|\u5546\u52a1\u95f8\u95e8|\u5b9a\u5236\u5316\u5f00\u53d1\u5de5\u4f5c\u91cf|\u8d44\u6e90\u3001\u5468\u671f|\u6210\u7acb\u6761\u4ef6|\u5148\u786e\u8ba4|\u9700\u73b0\u573a\u5398\u6e05|\u9700\u786e\u8ba4|\u9700\u660e\u786e|\u9700\u4e86\u89e3|\u672a\u786e\u8ba4\u9879|\u5de5\u4f5c\u91cf\u4f30\u7b97|\u7c97\u4f30|\u8d44\u6e90\u6295\u5165"
};

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

function countTerms(html) {
  const counts = {};
  for (const [key, term] of Object.entries(TERMS)) {
    counts[key] = (html.match(new RegExp(term, "gi")) || []).length;
  }
  return counts;
}

function countBad(html) {
  const counts = {};
  for (const [key, pattern] of Object.entries(BAD_PATTERNS)) {
    counts[key] = (html.match(new RegExp(pattern, "g")) || []).length;
  }
  return counts;
}

function sumSelected(counts, keys) {
  return keys.reduce((sum, key) => sum + Number(counts[key] || 0), 0);
}

function plainText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstSectionHtml(html, className) {
  const marker = `<section class="${className}`;
  const start = String(html || "").indexOf(marker);
  if (start < 0) return "";
  const tail = String(html || "").slice(start);
  const end = tail.indexOf("</section>");
  return end >= 0 ? tail.slice(0, end + 10) : tail;
}

function firstHeaderHtml(html, className) {
  const marker = `<header class="${className}`;
  const start = String(html || "").indexOf(marker);
  if (start < 0) return "";
  const tail = String(html || "").slice(start);
  const end = tail.indexOf("</header>");
  return end >= 0 ? tail.slice(0, end + 9) : tail;
}

function argumentSectionDetails(html) {
  const sections = String(html || "").split('<section class="battle-section argument-section').slice(1);
  return sections.map((section) => {
    const openTag = section.split(">")[0] || "";
    const className = `battle-section argument-section ${openTag.replace(/^["'\s]+/g, "").replace(/["'\s]+$/g, "").trim()}`.trim();
    const content = section.split("</section>")[0] || "";
    const nodeChunks = content.split(/<details class="argument-node(?:\s|")/).slice(1);
    const nodes = nodeChunks.map((chunk) => {
      const summaryMatch = chunk.match(/<summary>[\s\S]*?<span>([\s\S]*?)<\/span>[\s\S]*?<b>([\s\S]*?)<\/b>/);
      const branchCount = (chunk.match(/class="[^"]*\bargument-branch\b/g) || []).length;
      const evidenceCount = (chunk.match(/class="evidence-chip"|<li>/g) || []).length;
      return {
        label: plainText(summaryMatch?.[1] || ""),
        claim: plainText(summaryMatch?.[2] || ""),
        branchCount,
        evidenceCount
      };
    });
    const branchCount = (content.match(/class="[^"]*\bargument-branch\b/g) || []).length;
    const unsupportedNodes = nodes.filter((node) => node.branchCount < 1).map((node) => node.label || node.claim || "unnamed");
    return {
      className,
      count: nodes.length,
      branchCount,
      unsupportedNodes,
      labels: nodes.map((node) => node.label),
      claims: nodes.map((node) => node.claim),
      nodeBranches: nodes.map((node) => node.branchCount),
      nodeEvidence: nodes.map((node) => node.evidenceCount)
    };
  });
}

function argumentNodeText(html, sectionClass, label) {
  const section = firstSectionHtml(html, `battle-section argument-section ${sectionClass}`);
  if (!section) return "";
  const nodeChunks = section.split(/<details class="argument-node(?:\s|")/).slice(1);
  const target = String(label || "");
  for (const chunk of nodeChunks) {
    const text = plainText(chunk);
    if (text.includes(target)) return text;
  }
  return "";
}

function argumentStats(html) {
  const details = argumentSectionDetails(html);
  const counts = details.map((section) => section.count);
  return {
    counts,
    details,
    max: counts.length ? Math.max(...counts) : 0,
    emptyEvidenceFallbacks: (String(html || "").match(/\u5f53\u524d\u6ca1\u6709\u53ef\u5c55\u5f00\u7684\u5f3a\u4f9d\u636e/g) || []).length
  };
}

const ROLE_ARGUMENT_REQUIREMENTS = {
  profile: {
    className: "profile-argument-section",
    min: 4,
    max: 7,
    minBranchesPerNode: 1,
    required: [
      "\u8425\u6536\u80fd\u529b",
      "\u4f01\u4e1a\u53d1\u5c55\u9636\u6bb5",
      "\u7ec4\u7ec7\u590d\u6742\u5ea6",
      "\u884c\u4e1a\u5730\u4f4d",
      "\u7ba1\u7406\u6210\u719f\u5ea6\u521d\u5224"
    ]
  },
  sales: {
    className: "sales-argument-section",
    min: 8,
    max: 8,
    minBranchesPerNode: 1,
    required: [
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
    className: "presales-argument-section",
    min: 6,
    max: 8,
    minBranchesPerNode: 1,
    required: [
      "\u5ba2\u6237\u53ef\u80fd\u7684\u6838\u5fc3\u4e1a\u52a1\u573a\u666f",
      "\u75db\u70b9\u673a\u4f1a",
      "\u89e3\u51b3\u601d\u8def",
      "\u914d\u5957\u89e3\u51b3\u65b9\u6848",
      "\u6570\u5b57\u5316\u6210\u719f\u5ea6",
      "\u53ef\u80fd\u5df2\u6709\u7cfb\u7edf",
      "\u65b9\u6848\u98ce\u9669\u70b9"
    ]
  },
  delivery: null,
  action: null
};

function roleArgumentCoverage(argumentsInfo) {
  const sections = argumentsInfo?.details || [];
  return Object.fromEntries(
    Object.entries(ROLE_ARGUMENT_REQUIREMENTS).filter(([, requirement]) => requirement).map(([role, requirement]) => {
      const section = sections.find((item) => item.className.includes(requirement.className)) || {};
      const labels = section.labels || [];
      const labelText = labels.join(" ");
      const count = Number(section.count || 0);
      const missing = requirement.required.filter((pattern) => !new RegExp(pattern).test(labelText));
      return [
        role,
        {
          thinNodes: (section.nodeBranches || [])
            .map((value, index) => ({ value: Number(value || 0), label: labels[index] || `node-${index + 1}` }))
            .filter((item) => item.value < Number(requirement.minBranchesPerNode || 1))
            .map((item) => item.label),
          ok:
            count >= requirement.min &&
            count <= requirement.max &&
            missing.length === 0 &&
            Number(section.branchCount || 0) >= count &&
            !(section.unsupportedNodes || []).length &&
            !(section.nodeBranches || []).some((value) => Number(value || 0) < Number(requirement.minBranchesPerNode || 1)),
          count,
          branchCount: Number(section.branchCount || 0),
          unsupportedNodes: section.unsupportedNodes || [],
          nodeBranches: section.nodeBranches || [],
          labels,
          missing
        }
      ];
    })
  );
}

function hasText(text, pattern) {
  return new RegExp(pattern, "i").test(String(text || ""));
}

function sellerProfileText(report = {}) {
  const profile = report.sellerProfileSnapshot || report.sellerProfile || {};
  return [
    report.sellerProfileName,
    profile.companyName,
    profile.mainBusiness,
    profile.summary,
    profile.coreProducts,
    profile.coreOfferings,
    profile.keywords,
    profile.typicalScenarios,
    profile.strengths
  ]
    .flatMap((item) => (Array.isArray(item) ? item : [item]))
    .filter(Boolean)
    .join(" ");
}

function isDigitalSeller(report = {}) {
  const text = sellerProfileText(report);
  return /AI|\u667a\u80fd\u4f53|Agent|\u8f6f\u4ef6|\u6570\u5b57\u5316|\u4fe1\u606f\u5316|\u5de5\u4e1a\u4e92\u8054\u7f51|\u5de5\u4e1a\u5927\u6570\u636e|\u6570\u636e\u95ee\u7b54|\u77e5\u8bc6\u5e93|\u7b97\u6cd5|SaaS|HolliCube|MES\/MOM|MOM\u667a\u80fd\u5236\u9020|\u751f\u6001\u4f19\u4f34\u5e94\u7528\u5f00\u53d1|\u5e94\u7528\u5b9a\u5236|\u6d41\u7a0b\u667a\u80fd\u5316/i.test(text);
}

function sellerPerspectiveMismatchCount(html = "", report = {}) {
  if (isDigitalSeller(report)) return 0;
  const profileText = sellerProfileText(report);
  if (!profileText) return 0;
  const forbidden = [
    "\u667a\u7528\u5f00\u7269",
    "HolliCube",
    "AIOps",
    "\u667a\u80fd\u4f53",
    "\u77e5\u8bc6\u5e93",
    "\u6570\u636e\u95ee\u7b54",
    "\u6295\u6807\u6750\u6599",
    "\u6807\u4e66",
    "\u6750\u6599\u590d\u7528",
    "\u751f\u6001\u5e94\u7528",
    "\u5e94\u7528\u63a5\u5165",
    "\u6d41\u7a0b\u667a\u80fd",
    "\u7f16\u6392\u5de5\u4f5c\u53f0"
  ].filter((term) => !profileText.includes(term));
  return forbidden.reduce((sum, term) => sum + (html.split(term).length - 1), 0);
}

function scoreHtml(html, report = {}) {
  const counts = countTerms(html);
  const bad = countBad(html);
  const sellerMismatchCount = sellerPerspectiveMismatchCount(html, report);
  if (sellerMismatchCount) bad.sellerPerspectiveMismatch = sellerMismatchCount;
  const allowedUnknownInInvalidCards = (html.match(/argument-node[^"]*invalid[\s\S]*?(?:无法判断|暂无法判断|未查到)/g) || []).length;
  if (bad.lowValueClaim && allowedUnknownInInvalidCards) {
    bad.lowValueClaim = Math.max(0, bad.lowValueClaim - allowedUnknownInInvalidCards);
  }
  const text = plainText(html);
  const salesEntryNodeText = argumentNodeText(html, "sales-argument-section", "是否存在进入窗口");
  if (
    /客户案例|典型项目|典型示范案例|为.{0,20}建设|承建|实施|交付|解决方案提供商|服务商/.test(salesEntryNodeText) &&
    !/采购人|招标人|采购单位|采购公告|采购意向|预算金额/.test(salesEntryNodeText)
  ) {
    bad.supplierDeliveryAsEntryWindow = 1;
  }
  const coverHeaderHtml = firstHeaderHtml(html, "hero battle-cover");
  const coverLeadMatch = coverHeaderHtml.match(/<p>([\s\S]*?)<\/p>/i);
  const coverHeaderText = plainText(coverLeadMatch?.[1] || coverHeaderHtml);
  const coverText = plainText(firstSectionHtml(html, "cover-decision-strip"));
  const coverSegments = coverHeaderText.split(/[|｜]/);
  const coverActionSegment = coverSegments.pop() || "";
  const headerFinanceOnlyAction =
    /[|｜][^|｜。]*(?:营业收入|净利润|毛利率|现金流|研发投入|财务指标|经营指标)[^|｜。]*$/.test(coverHeaderText) &&
    !/(?:场景|痛点|负责人|推进|验证|样例|方案|业务|流程)/.test(coverActionSegment);
  if (headerFinanceOnlyAction) bad.coverFinanceOnlyAction = (bad.coverFinanceOnlyAction || 0) + 1;
  if ([...coverActionSegment].length > 220) bad.coverActionTooLong = (bad.coverActionTooLong || 0) + 1;
  const actionSectionHtml = firstSectionHtml(html, "battle-section argument-section action-argument-section");
  const actionQuestionFieldCount = (actionSectionHtml.match(/<em>\u95ee\u9898\d+<\/em>/g) || []).length;
  const compactQuestionCategoryCount = (actionSectionHtml.match(/questionnaire-row-list/g) || []).length;
  if (actionQuestionFieldCount < 12 && compactQuestionCategoryCount < 4) bad.questionnaireTooThin = (bad.questionnaireTooThin || 0) + 1;
  const argumentsInfo = argumentStats(html);
  const roleCoverage = roleArgumentCoverage(argumentsInfo);
  if (!isDigitalSeller(report) && roleCoverage.presales) {
    roleCoverage.presales.missing = (roleCoverage.presales.missing || []).filter(
      (item) => item !== "\u6570\u5b57\u5316\u6210\u719f\u5ea6" && item !== "\u53ef\u80fd\u5df2\u6709\u7cfb\u7edf"
    );
    roleCoverage.presales.ok =
      roleCoverage.presales.count >= 4 &&
      roleCoverage.presales.branchCount >= 8 &&
      !(roleCoverage.presales.unsupportedNodes || []).length &&
      !roleCoverage.presales.missing.length;
  }
  const activeRound =
    Array.isArray(report.rounds)
      ? report.rounds.find((round) => Number(round.roundNo) === Number(report.activeRoundNo)) || report.rounds[0] || {}
      : {};
  const solutionStrategy = report.solutionStrategy || activeRound.solutionStrategy || {};
  const deliveryAssessment = report.deliveryAssessment || activeRound.deliveryAssessment || {};
  const salesThesis = report.salesThesis || activeRound.salesThesis || {};
  const sections = {
    perspectiveTabs:
      html.includes("report-view-tabs") &&
      /id="view-profile"\s+checked/.test(html) &&
      hasText(text, "\u4f01\u4e1a\u753b\u50cf") &&
      hasText(text, "\u5546\u52a1\u5206\u6790") &&
      hasText(text, "\u65b9\u6848\u5206\u6790") &&
      hasText(text, "\u4ea4\u4ed8\u5206\u6790") &&
      hasText(text, "\u884c\u52a8\u6307\u5357"),
    salesPyramid: html.includes("sales-pyramid") || html.includes("sales-argument-section"),
    solutionStrategy: html.includes("solution-strategy-section") || html.includes("presales-argument-section"),
    delivery: html.includes("delivery-argument-section") && html.includes("SOW\u5206\u89e3"),
    buying:
      html.includes("buying-section") ||
      hasText(text, "\u9884\u7b97|\u4e70\u5355|\u4ed8\u6b3e\u80fd\u529b|\u8425\u6536|\u5229\u6da6"),
    decision: html.includes("decision-section") || hasText(text, "\u51b3\u7b56\u94fe|\u62cd\u677f|\u9884\u7b97\u5f52\u5c5e|\u91c7\u8d2d\u6743")
  };
  const structure = {
    consultingViews:
      html.includes("view-profile") &&
      html.includes("view-sales") &&
      html.includes("view-presales") &&
      html.includes("view-delivery") &&
      html.includes("argument-tree"),
    workPackages:
      html.includes("delivery-argument-section") &&
      (html.includes("sow-module-fields") || html.includes("sow-row-fields") || html.includes("sow-fields")) &&
      hasText(text, "\u4e8c\u7ea7\u5de5\u4f5c\u9879|\u4e8c\u7ea7\u529f\u80fd\u9879") &&
      hasText(text, "\u96be\u70b9\u6807\u8bc6|\u96be\u70b9"),
    solutionStrategy: html.includes("presales-argument-section") && html.includes("battle-solution"),
    deliveryAssessment: html.includes("delivery-argument-section") && (html.includes("sow-module-fields") || html.includes("sow-row-fields") || html.includes("sow-fields")),
    deliveryOrder:
      html.indexOf("SOW\u5206\u89e3") >= 0 &&
      html.indexOf("\u98ce\u9669\u4e0e\u5e94\u5bf9") >= 0 &&
      html.indexOf("SOW\u5206\u89e3") < html.indexOf("\u98ce\u9669\u4e0e\u5e94\u5bf9"),
    businessInsights: Array.isArray(report.businessInsights) && report.businessInsights.length >= 4,
    coverDecisionStrip:
      html.includes("cover-rating-badge") &&
      hasText(text, "\u5546\u673a\u8bc4\u7ea7") &&
      hasText(text, "\u4f18\u5148\u5207\u5165|\u98ce\u9669|\u4e0b\u4e00\u6b65"),
    questionnaire:
      html.includes("action-argument-section") &&
      hasText(text, "\u73b0\u573a\u95ee\u5377") &&
      hasText(text, "\u91cd\u70b9\u5173\u6ce8\u4e8b\u9879") &&
      hasText(text, "\u4e1a\u52a1\u573a\u666f") &&
      hasText(text, "\u9884\u7b97\u4e0e\u91c7\u8d2d") &&
      hasText(text, "\u7cfb\u7edf\u4e0e\u6570\u636e")
  };
  const rankedSolutions = Array.isArray(solutionStrategy.rankedSolutions) ? solutionStrategy.rankedSolutions : [];
  const businessUsefulness = {
    worthFollowing: sections.salesPyramid && hasText(text, "\u503c\u5f97|\u7ee7\u7eed\u8ddf|\u91cd\u70b9\u63a8\u8fdb|\u8f7b\u91cf\u63a8\u8fdb"),
    coverDecisionStrip: structure.coverDecisionStrip,
    budgetJudgment: sections.buying || Boolean(salesThesis.budgetJudgment),
    decisionPath: sections.decision || Boolean(salesThesis.decisionPath),
    operatingAdvice: hasText(text, "\u600e\u4e48\u8fd0\u4f5c|\u4e0b\u4e00\u6b65|\u843d\u5730\u8def\u5f84|\u63a8\u8fdb"),
    solutionPath: sections.solutionStrategy && (rankedSolutions.length >= 2 || html.includes("battle-solution")),
    deliveryRisk:
      sections.delivery &&
      structure.deliveryOrder &&
      (hasText(text, "\u4e8c\u7ea7\u5de5\u4f5c\u9879|\u4e8c\u7ea7\u529f\u80fd\u9879") || html.includes("sow-table")),
    presalesPlaybook:
      html.includes("presales-argument-section") &&
      hasText(text, "\u6838\u5fc3\u4e1a\u52a1\u573a\u666f") &&
      hasText(text, "\u75db\u70b9\u673a\u4f1a") &&
      hasText(text, "\u89e3\u51b3\u601d\u8def") &&
      hasText(text, "\u914d\u5957\u89e3\u51b3\u65b9\u6848"),
    questionnaire: structure.questionnaire
  };
  const sources = Array.isArray(report.sources) ? report.sources : [];
  const familyCounts = sources.reduce((acc, source) => {
    const family = source.sourceFamily || "unknown";
    acc[family] = (acc[family] || 0) + 1;
    return acc;
  }, {});
  const businessDepth = sumSelected(counts, [
    "HolliCube",
    "MES",
    "APS",
    "ERP",
    "WMS",
    "LIMS",
    "customerCase",
    "projectDelivery",
    "integration",
    "bid",
    "presales"
  ]);
  return {
    length: html.length,
    links: (html.match(/https?:\/\//g) || []).length,
    sections,
    structure,
    businessUsefulness,
    bad,
    counts,
    sourceCount: sources.length,
    familyCount: Object.keys(familyCounts).length,
    familyCounts,
    businessDepth,
    digitalSeller: isDigitalSeller(report),
    argumentsInfo,
    roleCoverage
  };
}

function findBaseline() {
  const userProfile = process.env.USERPROFILE || "C:\\Users\\real";
  const candidates = [
    path.join("D:\\", "\u6211\u7684\u6587\u6863", "\u4e0b\u8f7d"),
    path.join(userProfile, "Downloads")
  ];
  for (const dir of candidates) {
    let found = "";
    walk(dir, (file) => {
      if (found) return;
      const name = path.basename(file);
      if (name.endsWith(".html") && name.includes("1.0")) found = file;
    });
    if (found) return found;
  }
  return "";
}

function compare(current, baselineHtml = "") {
  if (!baselineHtml) return null;
  const baseline = scoreHtml(baselineHtml);
  return {
    baseline: {
      length: baseline.length,
      links: baseline.links,
      counts: baseline.counts,
      businessDepth: baseline.businessDepth
    },
    deltas: {
      length: current.length - baseline.length,
      links: current.links - baseline.links,
      businessDepth: current.businessDepth - baseline.businessDepth
    }
  };
}

function failIfNeeded(result) {
  const failures = [];
  for (const [key, ok] of Object.entries(result.sections)) {
    if (key === "buying") continue;
    if (!ok) failures.push(`missing section: ${key}`);
  }
  for (const [key, ok] of Object.entries(result.structure || {})) {
    if (!ok) failures.push(`missing structured data: ${key}`);
  }
  for (const [key, ok] of Object.entries(result.businessUsefulness || {})) {
    if (!ok) failures.push(`missing business usefulness: ${key}`);
  }
  for (const [role, coverage] of Object.entries(result.roleCoverage || {})) {
    if (!coverage.ok) {
      failures.push(
        `missing role argument coverage: ${role} count=${coverage.count} branches=${coverage.branchCount} unsupported=${(coverage.unsupportedNodes || []).join("|")} missing=${coverage.missing.join("|")}`
      );
    }
  }
  for (const [key, count] of Object.entries(result.bad)) {
    if (count > 0) failures.push(`bad text ${key}: ${count}`);
  }
  if (result.sourceCount < 15) failures.push(`sourceCount too low: ${result.sourceCount}`);
  if (result.familyCount < 5) failures.push(`familyCount too low: ${result.familyCount}`);
  if (result.digitalSeller && result.businessDepth < 60) failures.push(`businessDepth too low: ${result.businessDepth}`);
  if ((result.argumentsInfo?.max || 0) > 8) failures.push(`too many first-level arguments: ${result.argumentsInfo.max}`);
  if ((result.argumentsInfo?.emptyEvidenceFallbacks || 0) > 0) failures.push(`empty evidence fallback rendered: ${result.argumentsInfo.emptyEvidenceFallbacks}`);
  return failures;
}

function failComparisonIfNeeded(comparison) {
  if (!comparison) return [];
  const failures = [];
  if (comparison.deltas.businessDepth < 30) {
    failures.push(`businessDepth does not clearly exceed baseline: +${comparison.deltas.businessDepth}`);
  }
  if (comparison.deltas.links < -10) {
    failures.push(`source links significantly below baseline: ${comparison.deltas.links}`);
  }
  return failures;
}

function qualityLabel(result, comparison) {
  const businessDelta = comparison?.deltas?.businessDepth;
  if (result.businessDepth >= 150 && (!Number.isFinite(businessDelta) || businessDelta >= 80)) return "A";
  if (result.businessDepth >= 100 && (!Number.isFinite(businessDelta) || businessDelta >= 30)) return "B";
  if (result.businessDepth >= 60) return "C";
  return "D";
}

function writeSummary(output) {
  const comparison = output.comparison;
  const lines = [
    "# OAC Report Quality Check",
    "",
    `- Result: ${output.ok ? "PASS" : "FAIL"}`,
    `- Quality grade: ${output.qualityGrade}`,
    `- Report file: ${output.reportFile}`,
    `- Preview file: ${output.previewPath}`,
    `- Sources: ${output.result.sourceCount}`,
    `- Source families: ${output.result.familyCount}`,
    `- Business depth: ${output.result.businessDepth}`,
    `- Argument counts: ${JSON.stringify(output.result.argumentsInfo)}`,
    `- Bad text counts: ${JSON.stringify(output.result.bad)}`,
    `- Required sections: ${JSON.stringify(output.result.sections)}`,
    `- Required structure: ${JSON.stringify(output.result.structure)}`,
    `- Business usefulness: ${JSON.stringify(output.result.businessUsefulness)}`,
    `- Role argument coverage: ${JSON.stringify(output.result.roleCoverage)}`
  ];
  if (comparison) {
    lines.push(
      "",
      "## Compared With 1.0",
      "",
      `- Baseline file: ${output.baselineFile}`,
      `- Business depth delta: ${comparison.deltas.businessDepth}`,
      `- Link delta: ${comparison.deltas.links}`,
      `- Length delta: ${comparison.deltas.length}`
    );
  }
  if (output.failures.length) {
    lines.push("", "## Failures", "", ...output.failures.map((item) => `- ${item}`));
  }
  const summaryPath = output.summaryPath || path.resolve(root, "..", "oac-quality-summary.md");
  fs.writeFileSync(summaryPath, `\uFEFF${lines.join("\n")}\n`, "utf8");
  return summaryPath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const reportFile = options.reportFile || latestReportFile();
  if (!reportFile) throw new Error("No local report JSON found.");
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  const reportMod = await import(pathToFileURL(path.join(root, "netlify", "lib", "report.mjs")).href + `?v=${Date.now()}`);
  const normalized = reportMod.normalizeReportShape(report);
  const html = reportMod.renderReportHtml(normalized);
  const previewPath = options.previewPath;
  fs.writeFileSync(previewPath, html, "utf8");
  const result = scoreHtml(html, normalized);
  const baselineFile = options.noBaseline ? "" : options.baselineFile || findBaseline();
  const comparison = baselineFile ? compare(result, fs.readFileSync(baselineFile, "utf8")) : null;
  const failures = [...failIfNeeded(result), ...failComparisonIfNeeded(comparison)];
  const qualityGrade = qualityLabel(result, comparison);
  const output = {
    ok: failures.length === 0,
    qualityGrade,
    reportFile,
    previewPath,
    result,
    baselineFile,
    comparison,
    failures,
    summaryPath: options.summaryPath
  };
  output.summaryPath = writeSummary(output);
  console.log(JSON.stringify(output, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
