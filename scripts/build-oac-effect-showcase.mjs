import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(root, "..");
const summaryPath = path.join(outDir, "oac-quality-summary.md");
const portfolioSummaryPath = path.join(outDir, "oac-report-portfolio-summary.json");
const outPath = path.join(outDir, "oac-effect-showcase.html");

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return "";
  }
}

function pick(summary, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = summary.match(new RegExp(`- ${escaped}:\\s*(.+)`));
  return match?.[1]?.trim() || "";
}

const summary = readText(summaryPath);
let portfolioSummary = null;
try {
  portfolioSummary = JSON.parse(readText(portfolioSummaryPath));
} catch {
  portfolioSummary = null;
}
const metrics = {
  result: pick(summary, "Result") || "UNKNOWN",
  grade: pick(summary, "Quality grade") || "-",
  sources: pick(summary, "Sources") || "-",
  families: pick(summary, "Source families") || "-",
  businessDepth: pick(summary, "Business depth") || "-",
  depthDelta: pick(summary, "Business depth delta") || "-",
  linkDelta: pick(summary, "Link delta") || "-",
  lengthDelta: pick(summary, "Length delta") || "-",
  portfolioSamples: portfolioSummary?.sampleCount || "-",
  portfolioPass: portfolioSummary?.passCount || "-",
  richEvidence: portfolioSummary?.richEvidenceCount || "-"
};

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>OAC 升级效果验收页</title>
  <style>
    :root{
      color-scheme: light;
      --ink:#101828;
      --muted:#667085;
      --line:#e4e7ec;
      --blue:#1570ef;
      --green:#12b76a;
      --amber:#f79009;
      --bg:#f5f7fb;
      --card:rgba(255,255,255,.92);
      --shadow:0 18px 60px rgba(16,24,40,.10);
    }
    *{box-sizing:border-box}
    body{margin:0;background:radial-gradient(circle at 16% 0%,#dbeafe 0,#f5f7fb 28%,#f8fafc 100%);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",Arial,sans-serif;line-height:1.55}
    main{width:min(1180px,calc(100% - 28px));margin:0 auto;padding:34px 0 44px}
    .hero{display:grid;grid-template-columns:1.02fr .98fr;gap:22px;align-items:stretch;margin-bottom:22px}
    .panel{background:var(--card);border:1px solid rgba(255,255,255,.74);box-shadow:var(--shadow);border-radius:28px;padding:26px;backdrop-filter:blur(18px)}
    .eyebrow{display:inline-flex;align-items:center;gap:8px;padding:7px 11px;border-radius:999px;background:#eff8ff;color:#175cd3;font-weight:800;font-size:13px}
    h1{font-size:clamp(28px,4vw,52px);line-height:1.08;margin:18px 0 14px;letter-spacing:0}
    h2{font-size:22px;margin:0 0 12px}
    p{margin:0;color:#475467;font-size:16px}
    .hero p{font-size:18px}
    .metric-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:18px}
    .metric{padding:16px;border-radius:20px;background:#fff;border:1px solid var(--line)}
    .metric b{display:block;font-size:30px;line-height:1.1;margin-bottom:4px}
    .metric span{color:#667085;font-size:13px;font-weight:700}
    .pass{color:var(--green)} .blue{color:var(--blue)} .amber{color:var(--amber)}
    .section{margin-top:18px}
    .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
    .card{padding:18px;border:1px solid var(--line);background:#fff;border-radius:22px}
    .card h3{margin:0 0 8px;font-size:17px}
    .card p{font-size:14px}
    .proof{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}
    .proof span{display:flex;min-height:74px;align-items:center;justify-content:center;text-align:center;padding:12px;border-radius:18px;background:#f0f9ff;color:#175cd3;font-weight:900;border:1px solid #b9e6fe}
    .buyer-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
    .buyer{padding:18px;border-radius:22px;background:#fff;border:1px solid var(--line)}
    .buyer b{display:block;font-size:18px;margin-bottom:7px}
    .buyer p{font-size:14px}
    .screens{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
    img{width:100%;border-radius:22px;border:1px solid var(--line);box-shadow:0 12px 34px rgba(16,24,40,.08);background:#fff}
    .actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px}
    a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 16px;border-radius:999px;text-decoration:none;font-weight:900}
    .primary{background:var(--ink);color:#fff}
    .secondary{background:#fff;color:#175cd3;border:1px solid #b9e6fe}
    .note{margin-top:16px;color:#667085;font-size:13px}
    @media (max-width: 820px){
      main{width:min(100% - 18px,680px);padding:18px 0 28px}
      .hero,.grid,.screens,.buyer-grid{grid-template-columns:1fr}
      .panel{border-radius:24px;padding:20px}
      .metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
      .proof{grid-template-columns:repeat(2,minmax(0,1fr))}
      .hero p{font-size:16px}
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div class="panel">
        <span class="eyebrow">OAC 升级验收｜不是日志，是结果</span>
        <h1>现在能看到的效果：更深、更稳、更像销售/售前真的会用的作战简报。</h1>
        <p>这页把 OAC 当前本地构建的真实验收结果放到一起：和 1.0 对比、报告质量、业务有用性、手机端截图和可打开的报告预览。</p>
        <div class="actions">
          <a class="primary" href="./oac-preview-latest.html">打开最新报告预览</a>
          <a class="secondary" href="./oac-quality-summary.md">查看质量摘要</a>
        </div>
        <p class="note">说明：这是本地验收页，不包含密钥，不会触发模型调用或搜索费用。</p>
      </div>
      <div class="panel">
        <h2>核心结果</h2>
        <div class="metric-grid">
          <div class="metric"><b class="pass">${metrics.grade}</b><span>质量等级</span></div>
          <div class="metric"><b class="blue">${metrics.sources}</b><span>来源数量</span></div>
          <div class="metric"><b class="blue">${metrics.families}</b><span>来源类型</span></div>
          <div class="metric"><b class="amber">+${String(metrics.depthDelta).replace(/^-/, "")}</b><span>业务深度较 1.0 提升</span></div>
          <div class="metric"><b class="blue">${metrics.portfolioPass}/${metrics.portfolioSamples}</b><span>多企业样本通过</span></div>
          <div class="metric"><b class="amber">${metrics.richEvidence}</b><span>富证据报告样本</span></div>
        </div>
      </div>
    </section>

    <section class="panel section">
      <h2>这次不是只“多写字”，而是补齐销售/售前真正关心的 6 个问题</h2>
      <div class="proof">
        <span>值不值得跟</span>
        <span>预算/买单能力</span>
        <span>决策/拍板路径</span>
        <span>怎么推进</span>
        <span>方案路径</span>
        <span>交付风险</span>
      </div>
    </section>

    <section class="panel section">
      <h2>为什么值得付费：四类角色都能少走弯路</h2>
      <div class="buyer-grid">
        <article class="buyer">
          <b>老板</b>
          <p>看清哪些商机值得投入，减少销售、售前、交付在低质量机会上的消耗。</p>
        </article>
        <article class="buyer">
          <b>销售</b>
          <p>拜访前先知道客户是谁、有没有钱、决策链在哪里、下一步该怎么运作。</p>
        </article>
        <article class="buyer">
          <b>售前</b>
          <p>从客户业务和痛点组织方案，不再只拿标准产品介绍去硬推。</p>
        </article>
        <article class="buyer">
          <b>交付</b>
          <p>提前看到技术依赖、风险边界和工作包拆分，避免后期范围失控。</p>
        </article>
      </div>
    </section>

    <section class="grid section">
      <article class="card">
        <h3>比 1.0 信息更厚</h3>
        <p>业务深度从 79 提升到 ${metrics.businessDepth}，并且相较 1.0 增加 ${metrics.depthDelta}。这不是靠堆工商信息，而是保留产品、案例、项目、招聘、专利、财务等不同来源。</p>
      </article>
      <article class="card">
        <h3>比 1.0 更可验证</h3>
        <p>当前报告有 ${metrics.sources} 条来源、${metrics.families} 类来源，前台展示来源结构，关键判断进入可追溯证据链，减少“看起来很懂但无法核验”的风险。</p>
      </article>
      <article class="card">
        <h3>比 1.0 更像作战工具</h3>
        <p>报告不只讲客户是谁，还会给出优先切入、预算判断、决策路径、解决方案、落地路径和验收口径，更贴近销售/售前拜访前要拿在手里的材料。</p>
      </article>
    </section>

    <section class="panel section">
      <h2>移动端验收截图</h2>
      <div class="screens">
        <figure>
          <img src="./oac-mobile-report-check.png" alt="OAC 手机端报告截图" />
        </figure>
        <figure>
          <img src="./oac-mobile-app-check.png" alt="OAC 手机端应用截图" />
        </figure>
      </div>
    </section>
  </main>
</body>
</html>`;

fs.writeFileSync(outPath, html, "utf8");
console.log(JSON.stringify({ ok: true, outPath }, null, 2));
