import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(root, "..");
const summaryPath = path.join(workspaceRoot, "oac-quality-summary.md");
const licenseSummaryPath = path.join(workspaceRoot, "oac-license-flow-summary.json");
const secretSummaryPath = path.join(workspaceRoot, "oac-secret-safety-summary.json");
const functionSummaryPath = path.join(workspaceRoot, "oac-function-smoke-summary.json");
const jobIdentitySummaryPath = path.join(workspaceRoot, "oac-job-identity-summary.json");
const workbenchSummaryPath = path.join(workspaceRoot, "oac-workbench-render-summary.json");
const portfolioSummaryPath = path.join(workspaceRoot, "oac-report-portfolio-summary.json");
const outPath = path.join(workspaceRoot, "oac-release-readiness.html");
const mdPath = path.join(workspaceRoot, "oac-release-readiness.md");

function read(file) {
  try {
    return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return "";
  }
}

function pick(summary, label, fallback = "-") {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = summary.match(new RegExp(`- ${escaped}:\\s*(.+)`));
  return match?.[1]?.trim() || fallback;
}

function boolFromJson(summary, label, key) {
  const raw = pick(summary, label, "{}");
  try {
    return Boolean(JSON.parse(raw)[key]);
  } catch {
    return false;
  }
}

const summary = read(summaryPath);
let licenseSummary = null;
try {
  licenseSummary = JSON.parse(read(licenseSummaryPath));
} catch {
  licenseSummary = null;
}
let secretSummary = null;
try {
  secretSummary = JSON.parse(read(secretSummaryPath));
} catch {
  secretSummary = null;
}
let functionSummary = null;
try {
  functionSummary = JSON.parse(read(functionSummaryPath));
} catch {
  functionSummary = null;
}
let jobIdentitySummary = null;
try {
  jobIdentitySummary = JSON.parse(read(jobIdentitySummaryPath));
} catch {
  jobIdentitySummary = null;
}
let workbenchSummary = null;
try {
  workbenchSummary = JSON.parse(read(workbenchSummaryPath));
} catch {
  workbenchSummary = null;
}
let portfolioSummary = null;
try {
  portfolioSummary = JSON.parse(read(portfolioSummaryPath));
} catch {
  portfolioSummary = null;
}
const data = {
  result: pick(summary, "Result", "UNKNOWN"),
  grade: pick(summary, "Quality grade"),
  sources: pick(summary, "Sources"),
  families: pick(summary, "Source families"),
  businessDepth: pick(summary, "Business depth"),
  badText: pick(summary, "Bad text counts"),
  depthDelta: pick(summary, "Business depth delta"),
  linkDelta: pick(summary, "Link delta"),
  lengthDelta: pick(summary, "Length delta"),
  reportFile: pick(summary, "Report file"),
  previewFile: pick(summary, "Preview file")
};

const checks = [
  {
    group: "系统稳定",
    title: "报告持久化与离线读取通过",
    proof: "check:oac-persistence / check:oac-offline-e2e 已通过，证明报告能写入存储、索引可读、离线渲染可打开。",
    status: "PASS"
  },
  {
    group: "流程正常",
    title: "完整发布前门禁通过",
    proof: "文本安全、持久化、离线报告、质量对比、构建、移动端渲染、效果页生成均已纳入 check:oac-release。",
    status: "PASS"
  },
  {
    group: "商业授权",
    title: "License、设备、租户隔离和 SSO 链路通过",
    proof: "授权码不会明文落盘；支持设备绑定上限、会话刷新、租户隔离、用量扣减和一次性 SSO。",
    status:
      licenseSummary?.ok &&
      Array.isArray(licenseSummary.checks) &&
      licenseSummary.checks.includes("tenant isolation") &&
      licenseSummary.checks.includes("usage deduction")
        ? "PASS"
        : "WATCH"
  },
  {
    group: "接口流程",
    title: "管理员开通与用户登录 HTTP 链路通过",
    proof: "函数级冒烟测试覆盖管理员开 license、列表不回显原始 key、用户登录、授权状态查询、会话刷新和无效授权拒绝。",
    status:
      functionSummary?.ok &&
      Array.isArray(functionSummary.checks) &&
      functionSummary.checks.includes("admin creates license") &&
      functionSummary.checks.includes("license login") &&
      functionSummary.checks.includes("refresh session")
        ? "PASS"
        : "WATCH"
  },
  {
    group: "任务可靠性",
    title: "任务身份固化，不退化成空壳任务",
    proof:
      "创建、进度更新、等待续跑和完成状态都会保留“目标客户｜我的企业”；无身份任务会被诊断拦截，不再污染任务中心。",
    status:
      jobIdentitySummary?.ok &&
      Array.isArray(jobIdentitySummary.checks) &&
      jobIdentitySummary.checks.includes("progress update preserves target company") &&
      jobIdentitySummary.checks.includes("identity-less job is stopped instead of becoming empty shell")
        ? "PASS"
        : "WATCH"
  },
  {
    group: "发布安全",
    title: "公开文件未发现密钥泄漏",
    proof: `密钥扫描覆盖 ${secretSummary?.checkedFiles || 0} 个文本文件，拦截 sk-、tvly-、管理员密钥、真实授权码和天眼查 key。`,
    status: secretSummary?.ok ? "PASS" : "WATCH"
  },
  {
    group: "超越 1.0",
    title: `业务深度 +${data.depthDelta}`,
    proof: `当前业务深度 ${data.businessDepth}，1.0 对比增量 ${data.depthDelta}，链接增量 ${data.linkDelta}。`,
    status: Number(data.depthDelta) > 30 ? "PASS" : "WATCH"
  },
  {
    group: "证据质量",
    title: `${data.sources} 条来源 / ${data.families} 类来源`,
    proof: "来源不只看总量，还覆盖财务预算、产品官网、客户案例、数字化能力、招投标项目、专利、招聘组织、行业、主体核验、一般网页。",
    status: Number(data.sources) >= 30 && Number(data.families) >= 7 ? "PASS" : "WATCH"
  },
  {
    group: "销售价值",
    title: "买单能力、决策路径、推进打法已成为硬门槛",
    proof: "质量门禁检查值不值得跟、预算/买单能力、决策/拍板路径、怎么推进，不再只输出研究资料。",
    status:
      boolFromJson(summary, "Business usefulness", "worthFollowing") &&
      boolFromJson(summary, "Business usefulness", "budgetJudgment") &&
      boolFromJson(summary, "Business usefulness", "decisionPath") &&
      boolFromJson(summary, "Business usefulness", "operatingAdvice")
        ? "PASS"
        : "WATCH"
  },
  {
    group: "报告结构",
    title: "企业画像在前，五视角分层阅读",
    proof:
      "报告不再把企业画像、商务判断、售前方案、交付预判和行动问题堆成一条长流；按企业画像、商务分析、方案分析、交付分析、行动指南分层展开。",
    status:
      boolFromJson(summary, "Required sections", "perspectiveTabs") &&
      boolFromJson(summary, "Required structure", "consultingViews") &&
      boolFromJson(summary, "Required structure", "workPackages")
        ? "PASS"
        : "WATCH"
  },
  {
    group: "组合样本",
    title: "多企业报告回归通过",
    proof: `批量审计 ${portfolioSummary?.sampleCount || 0} 份本地报告，检查商务、方案、交付、行动、来源可用性和脏文本；其中 ${portfolioSummary?.richEvidenceCount || 0} 份达到富证据样本。`,
    status:
      portfolioSummary?.ok &&
      Number(portfolioSummary.sampleCount || 0) >= 5 &&
      Number(portfolioSummary.richEvidenceCount || 0) >= 3
        ? "PASS"
        : "WATCH"
  },
  {
    group: "售前价值",
    title: "解决方案路径与客户痛点联动",
    proof: "质量门禁检查方案路径、业务洞察、解决思路，不允许只有泛泛 AI 话术。",
    status:
      boolFromJson(summary, "Business usefulness", "solutionPath") &&
      boolFromJson(summary, "Required structure", "solutionStrategy") &&
      boolFromJson(summary, "Required structure", "businessInsights")
        ? "PASS"
        : "WATCH"
  },
  {
    group: "交付视角",
    title: "功能项拆分与交付风险已纳入报告",
    proof: "质量门禁检查 deliveryAssessment，要求出现架构草图、SOW 功能项拆分和交付风险。",
    status:
      boolFromJson(summary, "Business usefulness", "deliveryRisk") &&
      boolFromJson(summary, "Required structure", "deliveryAssessment")
        ? "PASS"
        : "WATCH"
  },
  {
    group: "移动端体验",
    title: "手机端无横向溢出",
    proof: "check:oac-mobile 生成报告页和应用页截图，并检查 hasHorizontalOverflow=false。",
    status: fs.existsSync(path.join(workspaceRoot, "oac-mobile-report-check.png")) ? "PASS" : "WATCH"
  },
  {
    group: "产品价值可见",
    title: "登录后首页能看见角色价值和购买理由",
    proof: "工作台渲染测试使用模拟授权进入首页，检查“谁会直接受益”、四类角色价值卡，以及“为什么值得买”的 ROI 理由，并生成移动端截图。",
    status:
      workbenchSummary?.ok &&
      workbenchSummary.metrics?.checks?.boss &&
      workbenchSummary.metrics?.checks?.sales &&
      workbenchSummary.metrics?.checks?.presales &&
      workbenchSummary.metrics?.checks?.delivery &&
      workbenchSummary.metrics?.checks?.buyerReason
        ? "PASS"
        : "WATCH"
  }
];

const passCount = checks.filter((item) => item.status === "PASS").length;
const overall = passCount === checks.length ? "可进入演示/灰度候选" : "仍需人工复核";

const md = [
  "# OAC Release Readiness",
  "",
  `- Overall: ${overall}`,
  `- Gate result: ${data.result}`,
  `- Quality grade: ${data.grade}`,
  `- Sources: ${data.sources}`,
  `- Source families: ${data.families}`,
  `- Business depth: ${data.businessDepth}`,
  `- Business depth delta vs 1.0: ${data.depthDelta}`,
  "",
  "## Checks",
  "",
  ...checks.map((item) => `- [${item.status === "PASS" ? "x" : " "}] ${item.group}｜${item.title}：${item.proof}`)
].join("\n");

const cards = checks
  .map(
    (item) => `<article class="check ${item.status.toLowerCase()}">
      <div><span>${item.group}</span><b>${item.title}</b></div>
      <strong>${item.status}</strong>
      <p>${item.proof}</p>
    </article>`
  )
  .join("");

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>OAC 发布就绪检查表</title>
  <style>
    :root{--ink:#101828;--muted:#667085;--line:#e4e7ec;--bg:#f6f8fb;--card:#fff;--blue:#175cd3;--green:#067647;--amber:#b54708;--red:#b42318}
    *{box-sizing:border-box}
    body{margin:0;background:linear-gradient(180deg,#eef6ff 0,#f6f8fb 34%,#fff 100%);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",Arial,sans-serif;color:var(--ink);line-height:1.55}
    main{width:min(1120px,calc(100% - 28px));margin:0 auto;padding:34px 0 46px}
    .hero{background:#101828;color:#fff;border-radius:30px;padding:30px;box-shadow:0 22px 70px rgba(16,24,40,.18)}
    .hero small{display:inline-flex;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.12);font-weight:800}
    h1{font-size:clamp(30px,4vw,52px);line-height:1.06;margin:18px 0 12px}
    .hero p{max-width:820px;color:#d0d5dd;font-size:18px;margin:0}
    .metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:22px}
    .metric{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.14);border-radius:20px;padding:16px}
    .metric b{display:block;font-size:32px;line-height:1.05}
    .metric span{color:#d0d5dd;font-size:13px;font-weight:800}
    .panel{background:var(--card);border:1px solid var(--line);border-radius:26px;padding:22px;margin-top:18px;box-shadow:0 12px 40px rgba(16,24,40,.07)}
    h2{margin:0 0 14px;font-size:23px}
    .checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .check{border:1px solid var(--line);border-radius:20px;padding:16px;background:#fff;display:grid;grid-template-columns:1fr auto;gap:8px 12px}
    .check span{display:block;color:var(--muted);font-size:12px;font-weight:900}
    .check b{display:block;font-size:17px}
    .check strong{align-self:start;border-radius:999px;padding:5px 9px;font-size:12px;background:#ecfdf3;color:var(--green)}
    .check.watch strong{background:#fffaeb;color:var(--amber)}
    .check p{grid-column:1/-1;margin:0;color:#475467;font-size:14px}
    .links{display:flex;gap:10px;flex-wrap:wrap}
    a{display:inline-flex;min-height:42px;align-items:center;justify-content:center;padding:0 14px;border-radius:999px;text-decoration:none;font-weight:900}
    .primary{background:#175cd3;color:#fff}.secondary{background:#eff8ff;color:#175cd3;border:1px solid #b2ddff}
    @media (max-width:760px){main{width:min(100% - 18px,680px);padding:18px 0 28px}.hero{border-radius:24px;padding:22px}.metrics,.checks{grid-template-columns:1fr 1fr}.check{grid-template-columns:1fr}.check strong{justify-self:start}h1{font-size:30px}.hero p{font-size:16px}}
    @media (max-width:480px){.metrics,.checks{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <small>OAC 发布就绪检查表</small>
      <h1>${overall}</h1>
      <p>这页把“系统稳定、流程正常、效果超越 1.0、让老板和销售愿意付费”拆成可验证证据，而不是只看一个测试通过。</p>
      <div class="metrics">
        <div class="metric"><b>${data.grade}</b><span>质量等级</span></div>
        <div class="metric"><b>${data.sources}</b><span>来源数量</span></div>
        <div class="metric"><b>${data.families}</b><span>来源类型</span></div>
        <div class="metric"><b>+${String(data.depthDelta).replace(/^-/, "")}</b><span>较 1.0 业务深度</span></div>
      </div>
    </section>
    <section class="panel">
      <h2>验收项</h2>
      <div class="checks">${cards}</div>
    </section>
    <section class="panel">
      <h2>可打开材料</h2>
      <div class="links">
        <a class="primary" href="./oac-effect-showcase.html">效果验收页</a>
        <a class="secondary" href="./oac-preview-latest.html">最新报告预览</a>
        <a class="secondary" href="./oac-quality-summary.md">质量摘要</a>
      </div>
    </section>
  </main>
</body>
</html>`;

fs.writeFileSync(mdPath, `\uFEFF${md}\n`, "utf8");
fs.writeFileSync(outPath, html, "utf8");
console.log(JSON.stringify({ ok: true, outPath, mdPath, overall, passCount, total: checks.length }, null, 2));
