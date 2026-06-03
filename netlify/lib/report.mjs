import { callModel, extractJson } from "./ai.mjs";
import { ChevronDown, CircleAlert, Trophy } from "lucide";
import { clip } from "./util.mjs";
import { OPPORTUNITY_RATING_VERSION, buildOpportunityRating } from "./opportunity-rating.mjs";
import { TOPIC_NAMES, buildEvidencePool, cleanUrl, formatQualityWarnings, isHttpUrl, normalizeReportSources } from "./report-quality.mjs?v=oac-insight-20260531a";
import { applyFreshnessGuardrails } from "./evidence-freshness.mjs";

function e(value) {
  return tidyPunctuation(String(value ?? ""))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const staticIcons = { ChevronDown, CircleAlert, Trophy };

function icon(name, className = "icon") {
  const node = staticIcons[name];
  if (!node) return "";
  const children = node
    .map(([tag, attrs]) => {
      const attrText = Object.entries(attrs || {})
        .map(([key, value]) => `${key}="${e(value)}"`)
        .join(" ");
      return `<${tag} ${attrText}></${tag}>`;
    })
    .join("");
  return `<svg class="${e(className)}" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`;
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function formatDuration(ms) {
  const value = Number(ms || 0);
  if (!Number.isFinite(value) || value <= 0) return "-";
  const totalSeconds = Math.round(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours}小时${rest}分钟` : `${hours}小时`;
  }
  if (minutes > 0) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}

function normalizeNumericToken(raw = "") {
  const text = String(raw || "").replace(/，/g, ",").replace(/\s+/g, "");
  const match = text.match(/[-负－]?\d[\d,]*(?:\.\d{1,2})?/);
  return match ? match[0].replace(/^负/, "-").replace(/^－/, "-").replace(/,/g, "") : "";
}

function formatMetricValue(value, label = "") {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";
  const compact = raw.replace(/[,，\s]/g, "");
  const metricLabel = String(label || "");
  const expectsPercent = /毛利率|负债率|占比|比例|率/.test(metricLabel);
  const expectsPeople = /员工|人数|人员/.test(metricLabel);
  const expectsMoney = /收入|营收|净销售|销售额|利润|净利|现金流|投入|费用|资产|负债|金额|成本/.test(metricLabel);
  const expectsRevenue = /收入|营收|净销售|销售额/.test(metricLabel);
  const token = normalizeNumericToken(compact);
  const num = Number(token || compact.replace(/(亿元|万元|千元|百万元|元|人|%)/g, ""));
  if (!Number.isFinite(num)) return raw;
  const pretty = (n) => n.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  if (expectsPercent || (/%$/.test(compact) && !/利润|收入|现金流|投入|费用|资产|负债|客户/.test(metricLabel))) return `${pretty(num)}%`;
  if (expectsPeople || /人$/.test(compact)) {
    const people = Math.round(num);
    if (!Number.isFinite(people) || people <= 0 || people > 200000) return "待核验";
    return `${people.toLocaleString("zh-CN")}人`;
  }
  if (/亿元/.test(compact)) return `${pretty(num)}亿元`;
  if (/万元/.test(compact)) return Math.abs(num) >= 10000 ? `${pretty(num / 10000)}亿元` : `${pretty(num)}万元`;
  if (/元/.test(compact) || Math.abs(num) >= 100000) return Math.abs(num) >= 100000000 ? `${pretty(num / 100000000)}亿元` : `${pretty(num / 10000)}万元`;
  if (expectsMoney) {
    if (Math.abs(num) >= 10000) return `${pretty(num / 10000)}亿元`;
    if (expectsRevenue && Math.abs(num) < 1000) return `${pretty(num)}亿元`;
    if (Math.abs(num) >= 1000) return `${pretty(num)}万元`;
    if (Math.abs(num) < 100 && String(token).includes(".")) return `${pretty(num)}亿元`;
    return `${pretty(num)}万元`;
  }
  return raw;
}

function displayMetricValue(item = {}) {
  return formatMetricValue(item.value || item.body || item.insight, item.label || item.title);
}

function renderableMetric(item = {}) {
  const label = String(item.label || item.title || "");
  const raw = String(item.value || item.body || item.insight || "").trim();
  const formatted = displayMetricValue(item);
  if (!meaningful(formatted) || formatted === "-" || formatted === "待核验") return false;
  if (/员工|人数|人员/.test(label)) {
    const num = Number(String(formatted).replace(/[^\d]/g, ""));
    if (!Number.isFinite(num) || num <= 0 || num > 200000) return false;
  }
  if (/前五|客户集中|客户/.test(label)) {
    const compact = `${raw} ${formatted}`.replace(/\s+/g, "");
    if (/^0(?:\.0+)?(?:元|万元|亿元|%)?$/.test(compact) || /(?:^|[^1-9])0(?:\.0+)?万元/.test(compact)) return false;
    if (/^待/.test(formatted)) return false;
  }
  return true;
}

function list(items) {
  const seen = new Set();
  const values = arr(items)
    .map((item) => cleanListItem(item))
    .filter(meaningful)
    .filter((item) => !isNonDecisionClaim(item))
    .filter((item) => {
      const key = item.replace(/\s+/g, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return values.length ? `<ul>${values.map((item) => `<li>${e(item)}</li>`).join("")}</ul>` : "";
}

function sourceId(source, index) {
  return Number(source?.sourceId || source?.id || index + 1);
}

function normalizeSourceIdList(item) {
  return arr(item?.sourceIds || item?.sources || item?.evidenceSourceIds)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(0, 4);
}

function annualEvidenceOf(item) {
  const page = Number(item?.annualPage || item?.page || item?.annualReportPage || 0);
  if (!Number.isFinite(page) || page <= 0) return null;
  const rawExcerpt = item?.evidenceExcerpt || item?.context || item?.note || "";
  const label = String(item?.label || item?.title || "");
  const expectedKeywords = [];
  if (/收入|营收|净销售|销售额/.test(label)) expectedKeywords.push("收入", "营收", "销售");
  if (/归母|母公司/.test(label)) expectedKeywords.push("归属于", "母公司");
  if (/扣非/.test(label)) expectedKeywords.push("扣非", "非经常", "净利润");
  if (/现金流/.test(label)) expectedKeywords.push("现金流", "经营活动");
  if (/研发/.test(label)) expectedKeywords.push("研发");
  if (/员工|人数|人员/.test(label)) expectedKeywords.push("员工", "人数", "人员");
  if (/负债率|资产负债/.test(label)) expectedKeywords.push("负债");
  const unrelatedFinancialTable = /盈余公积|资本公积|未分配利润|所有者权益变动/.test(rawExcerpt) && /归母|母公司|扣非|收入|营收|净销售|现金流|研发|员工|人数|客户/.test(label);
  const excerpt = unrelatedFinancialTable || (expectedKeywords.length && !expectedKeywords.some((keyword) => String(rawExcerpt).includes(keyword)))
    ? ""
    : rawExcerpt;
  return {
    page,
    title: item?.annualFileName || "用户上传年报",
    excerpt,
    confidence: "高",
    sourceType: "用户上传年报"
  };
}

function evidenceLinks(item, sources = []) {
  const ids = normalizeSourceIdList(item);
  const annual = annualEvidenceOf(item);
  if (annual?.excerpt && /盈余公积|资本公积|未分配利润|所有者权益变动/.test(annual.excerpt)) {
    annual.excerpt = "";
  }
  if (!ids.length && !annual) return "";
  const sourceMap = new Map(arr(sources).map((source, index) => [sourceId(source, index), source]));
  const matched = ids.map((id) => ({ id, source: sourceMap.get(id) })).filter((row) => row.source && isHttpUrl(row.source.url));
  if (!matched.length && !annual) return "";
  const badges = [
    ...matched.map((row) => `<span class="evidence-badge">[${e(row.id)}]</span>`),
    annual ? `<span class="evidence-badge annual">[年报P${e(annual.page)}]</span>` : ""
  ].join("");
  return `<details class="evidence-links">
    <summary>${badges}</summary>
    <div>
      ${annual ? `<div class="evidence-item"><b>年报P${e(annual.page)}.</b> ${e(annual.title)}<small>${e([annual.sourceType, annual.confidence].filter(Boolean).join("｜"))}</small>${annual.excerpt ? `<em>${e(clip(annual.excerpt, 180))}</em>` : ""}</div>` : ""}
      ${matched
        .map(({ id, source }) => {
          const url = cleanUrl(source.url);
          const meta = [source.sourceType, source.domain, source.confidence].filter(Boolean).join("｜");
          const support = source.relevanceReason || source.usedFor || source.query || "";
          const title = cleanSourceTitleLabel(source);
          const excerpt = cleanSourceEvidenceShell(source.evidenceExcerpt || source.text || source.snippet || "", 180);
          return `<a href="${e(url)}" target="_blank" rel="noreferrer"><b>${e(id)}.</b> ${e(title)}${meta ? `<small>${e(meta)}</small>` : ""}${support ? `<small>支撑：${e(support)}</small>` : ""}${excerpt ? `<em>${e(excerpt)}</em>` : ""}</a>`;
        })
        .join("")}
    </div>
  </details>`;
}

function cardGrid(items, className = "card", sources = []) {
  return arr(items)
    .filter((item) => meaningful(item.body || item.summary || item.insight))
    .map((item) => `<article class="${className}"><h3>${e(item.title)}</h3>${evidenceLinks(item, sources)}<p>${e(item.body || item.summary || item.insight)}</p></article>`)
    .join("");
}

function evidenceCards(items, sources = []) {
  return arr(items)
    .filter((item) => meaningful(item.insight || arr(item.facts)[0]))
    .map(
      (item) => `<article class="profile-card"><h3>${e(item.title)}</h3>${evidenceLinks(item, sources)}
          <div class="label">依据</div>${list(item.facts)}
          <div class="label">判断</div><p>${e(item.insight)}</p>
          ${arr(item.toConfirm).length ? `<div class="label">现场问题</div>${list(item.toConfirm)}` : ""}
        </article>`
    )
    .join("");
}

function metricCards(items, sources = []) {
  return arr(items)
    .filter(renderableMetric)
    .map((item) => `<div class="metric"><b>${e(item.label)}</b><strong>${e(formatMetricValue(item.value, item.label))}</strong>${evidenceLinks(item, sources)}<span>${e(item.note)}</span></div>`)
    .join("");
}

function painCards(items, sources = []) {
  return arr(items)
    .filter((item) => meaningful(item.reasoning || item.aiEntry || item.sourceBasis))
    .map(
      (item) => `<article class="pain-card"><h3>${e(item.title)}</h3>${evidenceLinks(item, sources)}
          <div class="label">依据</div><p>${e(item.sourceBasis)}</p>
          <div class="label">判断</div><p>${e(item.reasoning)}</p>
          <div class="label">现场问题</div>${list(item.validationSignals)}
          <div class="entry">${e(item.aiEntry)}</div>
        </article>`
    )
    .join("");
}

function solutionCards(items, sources = []) {
  return arr(items)
    .filter((item) => meaningful(item.title || item.why || item.how))
    .map(
      (item) => `<article class="solution-card"><span class="tag">${e(item.priority)}</span><h3>${e(item.title)}</h3>${evidenceLinks(item, sources)}
          <div class="label">依据</div><p>${e(item.why)}</p>
          <div class="label">做法</div><small>${e(item.how)}</small>
        </article>`
    )
    .join("");
}

function sourceRows(items) {
  const rows = arr(items)
    .filter((item) => isHttpUrl(item.url))
    .map((item, index) => {
      const url = cleanUrl(item.url);
      const meta = [sourceFamilyLabel(item.sourceFamily), item.sourceType, item.domain, item.relevanceReason].filter(Boolean).join("｜");
      return `<tr><td><b>${e(sourceId(item, index))}.</b> ${e(cleanSourceTitleLabel(item))}${meta ? `<br><small>${e(meta)}</small>` : ""}</td><td>${e(cleanSourceEvidenceShell(item.usedFor || item.query || item.topic || "", 120))}</td><td>${e(item.confidence || "")}</td><td><a href="${e(url)}" target="_blank" rel="noreferrer">${e(item.domain || "来源链接")}</a></td></tr>`;
    })
    .join("");
  return rows || `<tr><td colspan="4">本次未读取到可校验的公开来源，建议补充关键词后重新生成。</td></tr>`;
}

function buildSourcePack(sources, max = 36, textLimit = 2600) {
  return normalizeReportSources(sources, max).map((source, index) => ({
    id: index + 1,
    title: source.title,
    url: source.url,
    confidence: source.confidence,
    topic: source.topic,
    query: source.query,
    sourceType: source.sourceType,
    sourceFamily: source.sourceFamily,
    relevanceReason: source.relevanceReason,
    snippet: clip(source.snippet || "", textLimit),
    evidenceExcerpt: clip(source.evidenceExcerpt || "", textLimit),
    domain: source.domain,
    text: clip(source.text || source.evidenceExcerpt || source.snippet || "", textLimit)
  }));
}

const SOURCE_FAMILY_LABELS = {
  finance_budget: "财务/预算",
  subject_registry: "主体核验",
  official_product: "官网/产品",
  customer_case: "客户案例",
  tender_project: "招投标/项目",
  hiring_org: "招聘/组织",
  patent_ip: "专利/软著",
  digital_capability: "数字化能力",
  industry_context: "行业背景",
  risk_legal: "风险/法律",
  general_web: "普通网页"
};

function sourceFamilyLabel(value = "") {
  return SOURCE_FAMILY_LABELS[value] || value || "";
}

function sourceFamilySummary(sources = []) {
  const pool = buildEvidencePool(sources);
  const counts = pool.familyCounts || {};
  return Object.entries(SOURCE_FAMILY_LABELS)
    .map(([key, label]) => ({ key, label, count: Number(counts[key] || 0) }))
    .filter((item) => item.count > 0);
}

function buildBusinessInsightPack(sourcePack = []) {
  const buckets = [
    { key: "official_product", title: "核心产品/平台" },
    { key: "customer_case", title: "客户案例/项目" },
    { key: "digital_capability", title: "数字化与系统能力" },
    { key: "tender_project", title: "招投标/交付线索" },
    { key: "patent_ip", title: "技术与知识产权" },
    { key: "hiring_org", title: "组织与岗位能力" },
    { key: "industry_context", title: "行业背景与市场压力" }
  ];
  return buckets
    .map((bucket) => {
      const rows = sourcePack
        .filter((source) => source.sourceFamily === bucket.key)
        .slice(0, 8)
        .map((source) => ({
          sourceId: source.id,
          title: source.title,
          domain: source.domain,
          excerpt: clip(source.evidenceExcerpt || source.snippet || source.text || source.query || source.relevanceReason || "", 360)
        }))
        .filter((item) => item.title || item.excerpt);
      return rows.length ? { title: bucket.title, sourceFamily: bucket.key, signals: rows } : null;
    })
    .filter(Boolean)
    .concat(buildThematicBusinessBuckets(sourcePack));
}

function deriveBusinessInsightsFromSources(sources = []) {
  const pack = buildSourcePack(sources, 55, 900);
  return buildBusinessInsightPack(pack)
    .map((bucket) => {
      const signals = arr(bucket.signals).slice(0, 3);
      const body = signals
        .map((signal) => {
          const title = compactText(signal.title, 70);
          const excerpt = compactText(signal.excerpt, 120);
          return [title, excerpt].filter(Boolean).join("：");
        })
        .filter(meaningful)
        .join("；");
      return cleanRoundTextItem({
        title: bucket.title,
        body,
        sourceIds: signals.map((signal) => Number(signal.sourceId)).filter(Number.isFinite),
        confidence: bucket.sourceFamily === "business_theme" ? "业务线索" : "公开信息"
      });
    })
    .filter((item) => meaningful(item.title) && meaningful(item.body))
    .slice(0, 9);
}

function buildThematicBusinessBuckets(sourcePack = []) {
  const themes = [
    { title: "生态/伙伴/集成线索", match: /生态|合作伙伴|伙伴网络|联合方案|系统集成|平台集成|集成|对接|ecosystem|partner|integration/i },
    { title: "ERP/SAP/WMS/LIMS 对接线索", match: /ERP|SAP|WMS|LIMS|MES|APS|SCADA|系统对接|数据接口|生产执行/i },
    { title: "AIOps/工业数据线索", match: /AIOps|可观测|运维|实时数据库|工业数据|数据治理|智能问答|industrial data/i },
    { title: "交付/实施/售前效率线索", match: /交付|实施|上线|运维|客户成功|售前|投标|招投标|implementation|delivery|pre-sales/i }
  ];
  const seen = new Set();
  return themes
    .map((theme) => {
      const signals = sourcePack
        .filter((source) => theme.match.test(`${source.title || ""} ${source.query || ""} ${source.text || ""}`))
        .filter((source) => {
          const key = `${theme.title}:${source.id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 6)
        .map((source) => ({
          sourceId: source.id,
          title: source.title,
          domain: source.domain,
          excerpt: clip(source.evidenceExcerpt || source.snippet || source.text || source.query || source.relevanceReason || "", 360)
        }));
      return signals.length ? { title: theme.title, sourceFamily: "business_theme", signals } : null;
    })
    .filter(Boolean);
}

function uniqModelUsage(items) {
  const seen = new Set();
  return arr(items)
    .filter((item) => item?.model)
    .map((item) => ({ model: String(item.model || ""), channel: String(item.channel || ""), purpose: String(item.purpose || "模型分析") }))
    .filter((item) => {
      const key = `${item.channel}|${item.model}|${item.purpose}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function modelDisplay(report) {
  const names = Array.from(new Set([...arr(report.usedModels).map((item) => item?.model).filter(Boolean), report.modelName].filter(Boolean)));
  return names.join(" / ") || "未调用模型";
}

function modelAttemptDetail(attempt, action = "调用模型") {
  const model = `${attempt.model || "unknown"}（${attempt.channel || "auto"}）`;
  if (attempt.status === "start") {
    return `${action}：${model}，连接/响应头最多 ${Math.round(Number(attempt.timeoutMs || 0) / 1000)} 秒。`;
  }
  if (attempt.status === "headers") return `${model} 已返回响应头，等待首段输出。`;
  if (attempt.status === "first-token") return `${model} 已开始输出，接口可用。`;
  if (attempt.status === "stream-progress") {
    return `${model} 正在流式输出，已收到约 ${Number(attempt.receivedChars || 0).toLocaleString("zh-CN")} 字符。`;
  }
  if (attempt.status === "success") return `${model} 已完整返回。`;
  return `${model} 本次尝试已结束：${attempt.error || attempt.status}；系统会自动切换备用模型或进入下一步。`;
}

function sourceDisplay(report) {
  const count = Number(report.verifiedSourceCount ?? report.sourceCount ?? 0);
  if (report.evidencePool?.label) {
    return report.annualReportEvidence ? `${report.evidencePool.label}｜年报` : report.evidencePool.label;
  }
  return report.annualReportEvidence ? `${count} 条外部链接 + 年报` : `${count} 条`;
}

const REQUIRED_FINANCIAL_METRICS = ["营业收入", "归母净利润", "扣非净利润", "毛利率", "经营现金流", "资产负债率", "研发投入", "员工数量", "前五大客户/客户集中度"];

function financeMetricFromText(text, label, patterns) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match?.[1]) {
      return {
        label,
        value: match[1].replace(/[；。\n\r]+$/g, "").trim(),
        note: "来自财务硬来源的结构化公开信息。"
      };
    }
  }
  return null;
}

function structuredFinanceMetricFromText(text, label, keys = []) {
  for (const key of keys) {
    const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = String(text || "").match(new RegExp(`"${escaped}"\\s*:\\s*"?([^",}\\n]+)"?`));
    const value = match?.[1]?.replace(/[；。\n\r]+$/g, "").trim();
    if (value && value !== "null" && value !== "undefined") {
      return {
        label,
        value,
        note: "来自天眼查财务结构化来源，需以客户最终披露口径核对。"
      };
    }
  }
  return null;
}

function extractedFinancialMetrics(financeSources) {
  const text = financeSources.map((source) => [source.evidenceExcerpt, source.snippet, source.text].filter(Boolean).join("\n")).join("\n");
  return [
    financeMetricFromText(text, "营业收入", [/营业收入[：:]\s*([^；。\n]+)/]) || structuredFinanceMetricFromText(text, "营业收入", ["total_revenue", "revenue", "operating_total_revenue_lrr_sq", "totalOperateIncome"]),
    financeMetricFromText(text, "归母净利润", [/归母净利润[：:]\s*([^；。\n]+)/]) || structuredFinanceMetricFromText(text, "归母净利润", ["net_profit_atsopc", "parentNetProfit", "netProfitAtsopc"]),
    financeMetricFromText(text, "扣非净利润", [/扣非净利润[：:]\s*([^；。\n]+)/]) || structuredFinanceMetricFromText(text, "扣非净利润", ["profit_deduct_nrgal_ly_sq", "profit_deduct_nrgal_lrr_sq", "basic_e_ps_net_of_nrgal"]),
    financeMetricFromText(text, "毛利率", [/毛利率[：:]\s*([^；。\n]+)/]) || structuredFinanceMetricFromText(text, "毛利率", ["gross_selling_rate", "grossMargin"]),
    financeMetricFromText(text, "经营现金流", [/经营现金流净额[：:]\s*([^；。\n]+)/, /经营现金流[：:]\s*([^；。\n]+)/]) || structuredFinanceMetricFromText(text, "经营现金流", ["ncf_from_oa", "net_operate_cash_flow", "cash_flow_from_operating", "netCashFlowFromOperating"]),
    financeMetricFromText(text, "资产负债率", [/资产负债率[：:]\s*([^；。\n]+)/]) || structuredFinanceMetricFromText(text, "资产负债率", ["asset_liab_ratio", "assetLiabRatio"]),
    financeMetricFromText(text, "总资产/总负债", [/总资产[：:]\s*([^；。\n]+；总负债[：:]\s*[^；。\n]+)/]),
    financeMetricFromText(text, "研发投入", [/研发投入[：:]\s*([^；。\n]+)/]) || structuredFinanceMetricFromText(text, "研发投入", ["rad_cost", "research_expense", "rdExpense"]),
    financeMetricFromText(text, "员工数量", [/员工数量[：:]\s*([^；。\n]+)/]),
    financeMetricFromText(text, "前五大客户/客户集中度", [/前五大客户\/客户集中度[：:]\s*([^；。\n]+)/])
  ].filter(Boolean);
}

function annualReportMetrics(company = {}) {
  const metrics = company.annualReportEvidence?.metrics || company.annualReportSummary?.metrics || [];
  return arr(metrics).map((item) => ({
    label: item.label || item.name || "年报指标",
    value: item.value || "未在上传年报中取得",
    note: `用户上传年报${item.page ? `第 ${item.page} 页` : ""}指标，需按客户最终披露口径核对。`,
    annualPage: item.page,
    annualFileName: company.annualReportEvidence?.fileName || company.annualReportSummary?.fileName || "用户上传年报",
    evidenceExcerpt: item.context || ""
  }));
}

function removeAnnualReportDownloadPrompts(report, company = {}) {
  if (!company.annualReportEvidence && !report.annualReportEvidence) return report;
  const blocked = /下载.*年报|补充.*年报|获取.*年报|最新.*年报|年报.*下载/;
  const filterItems = (items) => arr(items).filter((item) => !blocked.test(String(item || "")));
  return {
    ...report,
    requirements: {
      ...(report.requirements || {}),
      preMeeting: filterItems(report.requirements?.preMeeting),
      onSite: filterItems(report.requirements?.onSite)
    }
  };
}

function ensureFinancialMetrics(report, sources, company) {
  const stockCode = company.stockCode || String(company.aiNeeds || "").match(/(?<!\d)(?:60|68|00|30|83|87|43|92)\d{4}(?!\d)/)?.[0] || "";
  const financeSources = normalizeReportSources(sources, 80).filter((source) => source.topic === TOPIC_NAMES[1] || source.sourceType === "财务硬来源" || source.sourceFamily === "finance_budget" || /financial|annual|income_statement|balance_sheet|cash_flow|listing|stock/.test(source.structuredTool || ""));
  const sourceNames = financeSources.slice(0, 5).map((source) => source.domain || source.title || source.url).filter(Boolean);
  const existing = arr(report.customerInsights?.metrics);
  const extracted = [...annualReportMetrics(company), ...extractedFinancialMetrics(financeSources)];
  const metricKey = (label = "") => {
    const text = String(label || "");
    if (/营业|收入|净销售/.test(text)) return "营业收入";
    if (/归母|归属.*净利润/.test(text)) return "归母净利润";
    if (/扣非|非经常性损益/.test(text)) return "扣非净利润";
    if (/毛利/.test(text)) return "毛利率";
    if (/现金流/.test(text)) return "经营现金流";
    if (/资产负债|负债率/.test(text)) return "资产负债率";
    if (/研发/.test(text)) return "研发投入";
    if (/员工|人数/.test(text)) return "员工数量";
    if (/客户/.test(text)) return "前五大客户/客户集中度";
    return text || "其他指标";
  };
  const hasMetricIn = (items, label) => {
    const key = metricKey(label);
    return items.some((item) => metricKey(item.label || item.note || "") === key);
  };
  const mergedExisting = [
    ...extracted,
    ...existing.filter((item) => !hasMetricIn(extracted, item.label))
  ];
  const hasMetric = (label) => hasMetricIn(mergedExisting, label);
  const missing = REQUIRED_FINANCIAL_METRICS.filter((label) => !hasMetric(label));
  if (!missing.length && mergedExisting.length === existing.length) return removeAnnualReportDownloadPrompts(report, company);
  const hasAnnual = Boolean(company.annualReportEvidence || company.annualReportSummary);
  const missingReason = hasAnnual
    ? "已接入用户上传年报，但自动抽取没有形成可展示指标；缺失项只保留在内部状态，不进入正文。"
    : financeSources.length
    ? `已采集财务硬来源${sourceNames.length ? `：${sourceNames.join("、")}` : ""}，但没有形成可展示指标；缺失项只保留在内部状态。`
    : `已尝试按${stockCode ? `股票代码 ${stockCode}、` : ""}年报/公告/F10 财务来源检索，但没有形成可展示指标。`;
  return removeAnnualReportDownloadPrompts({
    ...report,
    customerInsights: {
      ...(report.customerInsights || {}),
      metrics: mergedExisting
    },
    financialSourceStatus: {
      stockCode,
      attempted: true,
      hardSourceCount: financeSources.length,
      hardSources: financeSources.slice(0, 8).map((source) => ({ title: source.title, url: source.url, domain: source.domain || "" })),
      missingMetrics: missing,
      missingReason
    }
  }, company);
}

const QUICK_CARD_TITLES = ["客户是谁", "客户卖什么", "有没有钱", "先切哪里"];
const CONCLUSION_TITLES = ["一句话判断", "优先切入", "核心依据", "主要风险", "下一步建议"];

function textFromCard(card = {}) {
  return String(card.body || card.summary || card.insight || arr(card.facts).join("；") || "").trim();
}

function firstUseful(items, fallback = "") {
  return arr(items).map(textFromCard).find(Boolean) || fallback;
}


function splitChineseSentences(text = "") {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[\u3002\uff1b;])\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function pickSentence(text, patterns = [], fallback = "") {
  const sentences = splitChineseSentences(text);
  for (const pattern of patterns) {
    const found = sentences.find((item) => pattern.test(item));
    if (found) return found;
  }
  return fallback || sentences[0] || String(text || "").trim();
}

function deriveQuickBody(title = "", text = "", fallback = "") {
  const value = String(text || "").trim();
  if (!value) return fallback;
  if (title.includes("\u5ba2\u6237\u662f\u8c01")) return pickSentence(value, [/\u4e00\u7ea7\u4f9b\u5e94\u5546|\u6574\u8f66\u5382|\u5ba2\u6237\u662f|\u4f01\u4e1a|\u516c\u53f8/], fallback);
  if (title.includes("\u5ba2\u6237\u5356\u4ec0\u4e48")) { const m=value.match(/(?:\u4e3b\u8981\u4ea7\u54c1(?:\u4e3a|\u5305\u62ec)?|\u4ea7\u54c1\u4e3a)([^\u3002\uff1b;]+)/); return m ? `\u4e3b\u8981\u4ea7\u54c1\u4e3a${m[1]}\u3002` : pickSentence(value, [/\u4e3b\u8981\u4ea7\u54c1|\u4ea7\u54c1\u4e3a|\u4ea7\u54c1\u7ebf|\u4e1a\u52a1|\u9500\u552e/], fallback); }
  if (title.includes("\u6709\u6ca1\u6709\u94b1")) return pickSentence(value, [/\u8425\u6536|\u6536\u5165|\u51c0\u5229\u6da6|\u5229\u6da6|\u73b0\u91d1\u6d41|\u7814\u53d1\u6295\u5165|\u8d22\u52a1/], fallback);
  if (title.includes("\u5148\u5207\u54ea\u91cc")) return pickSentence(value, [/\u5efa\u8bae|\u4f18\u5148|\u5207\u5165|\u751f\u4ea7|\u8d28\u91cf|\u4f9b\u5e94\u94fe|\u7814\u53d1/], fallback);
  return value;
}

function deriveConclusionBody(title = "", text = "", fallback = "") {
  const value = String(text || fallback || "").replace(/\s+/g, " ").trim();
  if (!value) return fallback;
  const patterns = title.includes("\u4e00\u53e5\u8bdd\u5224\u65ad")
    ? [/(?:\u5224\u65ad[\uff1a:])?[^\u3002\uff1b;]*(?:\u516c\u53f8|\u4f01\u4e1a|\u5ba2\u6237|\u4f9b\u5e94\u5546)[^\u3002\uff1b;]*[\u3002\uff1b;]?/]
    : title.includes("\u4f18\u5148\u5207\u5165")
      ? [/\u4f18\u5148[^\u3002\uff1b;]*[\u3002\uff1b;]?/, /\u5efa\u8bae\u4ece[^\u3002\uff1b;]*[\u3002\uff1b;]?/]
      : title.includes("\u6838\u5fc3\u4f9d\u636e")
        ? [/\u6838\u5fc3\u4f9d\u636e[^\u3002\uff1b;]*[\u3002\uff1b;]?/, /\u4f9d\u636e[^\u3002\uff1b;]*[\u3002\uff1b;]?/]
        : title.includes("\u4e3b\u8981\u98ce\u9669")
          ? [/\u4e3b\u8981\u98ce\u9669[^\u3002\uff1b;]*[\u3002\uff1b;]?/, /\u98ce\u9669[^\u3002\uff1b;]*[\u3002\uff1b;]?/]
          : [/\u4e0b\u4e00\u6b65\u5efa\u8bae[^\u3002\uff1b;]*[\u3002\uff1b;]?/, /\u4e0b\u4e00\u6b65[^\u3002\uff1b;]*[\u3002\uff1b;]?/];
  for (const pattern of patterns) {
    const found = value.match(pattern)?.[0]?.trim();
    if (found && found.length >= 6) return found;
  }
  return pickSentence(value, [], fallback);
}

function hasImpactfulSensitiveRisk(category = {}) {
  const text = `${category.label || ""} ${category.summary || ""} ${category.disposition || ""}`;
  if (/系统已通过.*核验到.*线索|通过官方\/法院\/信用平台等直接来源核验到|财务\/经营指标线索/.test(text)) return false;
  if (/财务|经营指标|经营/.test(text) && !/亏损|现金流为负|资不抵债|被执行|失信|限制高消费|经营异常|行政处罚|诉讼|合同纠纷|付款|回款|融资风险|重大项目风险|补贴风险/.test(text)) return false;
  if (category.status === "conflict") return true;
  if (!["verified", "multi_source"].includes(category.status)) return false;
  if (/股权|控制权/.test(text) && !/冲突|异常|变更|冻结|失控|复杂|争议|影响采购主体/.test(text)) return false;
  return /信用|法律|诉讼|失信|被执行|限制高消费|合同纠纷|回款|财务异常|亏损|现金流|融资风险|重大项目风险|补贴风险|客户名单/.test(text);
}

function deriveOpportunityRisk(report = {}) {
  const sensitive = arr(report.sensitiveVerification?.categories).filter(hasImpactfulSensitiveRisk);
  if (sensitive.length) {
    return `商机风险优先看${sensitive.map((item) => item.label).join("、")}：${sensitive
      .map((item) => item.summary || item.statusLabel || "存在需核验的影响项")
      .slice(0, 2)
      .join("；")}。`;
  }
  const pool = report.evidencePool || {};
  const high = Number(pool.highConfidenceCount || 0);
  const medium = Number(pool.mediumConfidenceCount || 0);
  const weak = Number(pool.weakClueCount || 0);
  if (weak > high + medium && weak >= 8) return "";
  const missing = arr(report.missingTopics || report.qualityWarnings)
    .join("、")
    .replace(/\s+/g, " ");
  if (/经营规模|财务|营业收入|利润|现金流/.test(missing)) return "";
  if (/数字化|AI|ERP|MES|PLM|QMS|APS/.test(missing)) return "";
  if (/痛点/.test(missing)) return "";
  const ratingRisks = arr(report.opportunityRating?.riskFlags).map((item) => actionableRiskText(item, 180)).filter(meaningful);
  if (ratingRisks.length) return ratingRisks.slice(0, 2).join("；");
  return "";
}

function normalizeQuickCards(report = {}) {
  const existing = arr(report.quickCards);
  const byTitle = new Map();
  for (const card of existing) {
    const title = String(card.title || "");
    for (const key of QUICK_CARD_TITLES) {
      if (title.includes(key) && !byTitle.has(key)) byTitle.set(key, card);
    }
  }
  const metrics = arr(report.customerInsights?.metrics).slice(0, 4);
  const metricText = metrics.length
    ? metrics.map((item) => `${item.label}${item.value ? ` ${formatMetricValue(item.value, item.label)}` : ""}`).join("；")
    : "";
  const fallback = {
    "客户是谁": {
      title: "客户是谁",
      body: firstUseful(report.customerInsights?.localCards, `${report.standardName || report.companyName || "目标客户"}，首轮要锁定本次拜访主体、工厂与集团关系。`),
      insight: "关键信息：锁定主体、区域、参会角色和是否为真实采购/试点对象。"
    },
    "客户卖什么": {
      title: "客户卖什么",
      body: firstUseful(report.customerInsights?.groupCards, "产品与客户结构决定切入点；优先从官网产品、客户案例、招聘和项目线索判断真实业务场景。"),
      insight: "关键信息：产品与客户结构决定切入点，不能按固定模板预设机会。"
    },
    "有没有钱": {
      title: "有没有钱",
      body: metricText,
      insight: "关键信息：预算能力不只看营收，还要看利润、现金流、研发投入和是否有明确项目触发。"
    },
    "先切哪里": {
      title: "先切哪里",
      body: arr(report.solutions)[0]?.title || arr(report.pains)[0]?.aiEntry || "先从可验证的小场景切入，避免直接承诺重系统改造。",
      insight: arr(report.solutions)[0]?.why || "关键信息：优先选择客户能提供样例、能现场验证、能快速解释价值的场景。"
    }
  };
  return QUICK_CARD_TITLES.map((title) => {
    const source = byTitle.get(title) || fallback[title];
    return {
      title,
      body: deriveQuickBody(title, textFromCard(source), fallback[title].body),
      insight: source.insight || fallback[title].insight || "",
      sourceIds: source.sourceIds || source.sources || source.evidenceSourceIds || []
    };
  });
}

function normalizeConclusions(report = {}) {
  const existing = arr(report.conclusions);
  const byTitle = new Map();
  for (const card of existing) {
    const title = String(card.title || "");
    for (const key of CONCLUSION_TITLES) {
      if (title.includes(key) && !byTitle.has(key)) byTitle.set(key, card);
    }
  }
  const firstConclusion = existing[0] || {};
  const firstSolution = arr(report.solutions)[0] || {};
  const firstPain = arr(report.pains)[0] || {};
  const scenarioBasis = buildScenarioCoreBasis(report);
  const warnings = arr(report.qualityWarnings).slice(0, 2).join("；");
  const fallback = {
    "一句话判断": textFromCard(firstConclusion) || `${report.standardName || report.companyName || "该客户"}具备会前研究价值，但仍需把公开信息与现场输入分开。`,
    "优先切入": firstSolution.title ? `${firstSolution.title}：${firstSolution.why || firstSolution.how || "建议围绕客户可提供样例的场景推进。"}` : firstPain.aiEntry || "优先从公开证据最充分、与我方能力最匹配、现场最容易验证的场景切入。",
    "核心依据": scenarioBasis || firstUseful(report.customerInsights?.localCards) || firstUseful(report.customerInsights?.groupCards) || "当前依据来自已审计公开来源、用户上传年报和客户补充线索。",
    "主要风险": deriveOpportunityRisk(report),
    "下一步建议": arr(report.requirements?.onSite)[0] || arr(report.requirements?.preMeeting)[0] || "下一步锁定参会角色、业务线、TOP痛点、系统现状和可用样例。"
  };
  return CONCLUSION_TITLES.map((title) => {
    const source = byTitle.get(title);
    const rawBody = source ? textFromCard(source) : "";
    const body =
      title === "核心依据" && scenarioBasis && !conclusionSupportsEntry(rawBody, report)
        ? scenarioBasis
        : deriveConclusionBody(title, rawBody, fallback[title]);
    return {
      title,
      body,
      sourceIds: source?.sourceIds || source?.sources || source?.evidenceSourceIds || firstConclusion.sourceIds || []
    };
  });
}

function scenarioKeywords(report = {}) {
  const text = [
    ...arr(report.pains).flatMap((item) => [item.title, item.sourceBasis, item.reasoning, item.aiEntry]),
    ...arr(report.solutions).flatMap((item) => [item.title, item.customerPain, item.introduction, item.value, item.why]),
    report.opportunityFit?.summary
  ].join(" ");
  return ["知识库", "数据问答", "智能体", "Agent", "生态", "伙伴", "集成", "HolliCube", "MES", "ERP", "WMS", "LIMS", "售前", "投标", "交付", "运维", "AIOps"]
    .filter((term) => text.includes(term));
}

function conclusionSupportsEntry(body = "", report = {}) {
  const text = String(body || "");
  if (!meaningful(text)) return false;
  const keywords = scenarioKeywords(report);
  if (!keywords.length) return true;
  if (keywords.some((term) => text.includes(term))) return true;
  return !/股权|控股|股东|分公司|区域|注册地址|国资|地方政府/.test(text);
}

function buildScenarioCoreBasis(report = {}) {
  const pains = arr(report.pains).filter((item) => meaningful(item.sourceBasis) || meaningful(item.reasoning) || meaningful(item.aiEntry));
  const solutions = arr(report.solutions).filter((item) => meaningful(item.title));
  if (!pains.length && !solutions.length) return "";
  const evidence = uniqueTexts(
    pains
      .flatMap((item) => [item.sourceBasis, item.reasoning])
      .map((item) => cleanBusinessText(item, 92))
      .filter(meaningful),
    3
  );
  const solutionTitles = uniqueTexts(solutions.map((item) => item.title).filter(meaningful), 3);
  const seller = report.sellerProfileName || report.sellerProfileSnapshot?.companyName || "我的企业";
  const sellerOffer = arr(report.sellerProfileSnapshot?.coreProducts || report.sellerProfileSnapshot?.coreOfferings).slice(0, 2).join("、");
  if (!evidence.length && !solutionTitles.length) return "";
  return [
    evidence.length ? `核心依据来自客户业务场景证据：${evidence.join("；")}。` : "",
    solutionTitles.length ? `因此首轮方案应围绕${solutionTitles.join("、")}展开。` : "",
    sellerOffer ? `${seller}的${sellerOffer}能力与这些场景存在交集，但仍需现场确认系统边界、样例数据和采购路径。` : ""
  ].filter(Boolean).join("");
}

function sanitizeRequirements(report = {}) {
  const rewrite = (item = "") =>
    String(item || "")
      .replace(/^通过公开渠道了解其当前使用的核心ERP、MES系统供应商及大致上线年限。?$/, "现场确认当前 ERP、MES、PLM、QMS 等系统使用情况、上线年限、供应商和数据导出边界。")
      .replace(/^查询客户注册资本、参保人数、营收区间等工商基础规模信息.*$/, "现场确认注册资本、人员规模、营收区间等基础经营口径与公开工商信息是否一致。")
      .replace(/^尝试查找客户在Alibaba国际站或其他B2B平台是否存续.*$/, "现场确认客户主要获客渠道、外贸平台使用情况和线上询盘转化压力。");
  return {
    ...report,
    requirements: {
      ...(report.requirements || {}),
      preMeeting: arr(report.requirements?.preMeeting).map(rewrite).filter(Boolean),
      onSite: arr(report.requirements?.onSite).map(rewrite).filter(Boolean)
    }
  };
}

function valueFromAnnualContext(item = {}) {
  const label = String(item.label || "");
  const context = String(item.context || item.evidenceExcerpt || "");
  if (!context) return item.value;
  const derived = annualMetricValueFromContext(label, context);
  return derived || item.value;
}

function annualMetricValueFromContext(label = "", context = "") {
  const metricLabel = String(label || "");
  if (!context) return "";
  const compact = context.replace(/\s+/g, "");
  const cny = (raw) => formatMetricValue(`${String(raw || "").replace(/[，,]/g, "")}元`, metricLabel);
  const wan = (raw) => formatMetricValue(`${String(raw || "").replace(/[，,]/g, "")}万元`, metricLabel);
  let match = null;
  if (/营业|收入|净销售/.test(metricLabel)) {
    match = compact.match(/营业收入([-\d,，]+(?:\.\d{2})?)/);
    if (match?.[1]) return cny(match[1]);
  }
  if (/归母|归属.*净利润/.test(metricLabel)) {
    match =
      compact.match(/归属于(?:上市公司|挂牌公司)股东的净利润([-\d,，]+(?:\.\d{2})?)/) ||
      compact.match(/归属于母公司所有者的净利润([-\d,，]+(?:\.\d{2})?)/) ||
      compact.match(/归母净利润([-\d,，]+(?:\.\d{2})?)/);
    if (match?.[1]) return cny(match[1]);
  }
  if (/扣非|非经常性损益/.test(metricLabel)) {
    match =
      compact.match(/归属于(?:上市公司|挂牌公司)股东的扣除非经常性损益后的净利润([-\d,，]+(?:\.\d{2})?)/) ||
      compact.match(/扣除非经常性损益后?的?净利润([-\d,，]+(?:\.\d{2})?)/) ||
      compact.match(/扣非净利润([-\d,，]+(?:\.\d{2})?)/);
    if (match?.[1]) return cny(match[1]);
  }
  if (/现金流/.test(metricLabel)) {
    match = compact.match(/经营活动产生的现金流量净额([-\d,，]+(?:\.\d{2})?)/) || compact.match(/经营现金流量净额([-\d,，]+(?:\.\d{2})?)/);
    if (match?.[1]) return cny(match[1]);
  }
  if (/研发/.test(metricLabel)) {
    match = compact.match(/研发费用([-\d,，]+(?:\.\d{1,2})?)万元/) || compact.match(/研发投入(?:金额)?([-\d,，]+(?:\.\d{1,2})?)万元/);
    if (match?.[1]) return wan(match[1]);
  }
  if (/员工|人数/.test(metricLabel)) {
    match = compact.match(/在职员工的数量合计(\d[\d,，]*)/) || compact.match(/合计(\d[\d,，]*)/);
    if (match?.[1]) return `${String(match[1]).replace(/[，,]/g, "")}人`;
  }
  if (/毛利|负债率|比例|占比|率/.test(metricLabel)) {
    const escaped = metricLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    match = compact.match(new RegExp(`${escaped}[^\\d-]{0,40}([-\\d.]+%)`));
    if (match?.[1]) return match[1];
  }
  return "";
}

function annualContexts(report = {}) {
  const out = [];
  const push = (item = {}, fallbackTitle = "") => {
    const context = String(item.context || item.evidenceExcerpt || item.excerpt || "");
    if (!context) return;
    out.push({
      context,
      page: item.page || item.annualPage || 0,
      annualFileName: item.annualFileName || report.annualReportEvidence?.fileName || "用户上传年报",
      evidenceExcerpt: context,
      note: fallbackTitle || item.title || item.label || "用户上传年报",
      value: item.value || ""
    });
  };
  for (const item of arr(report.annualReportEvidence?.metrics)) push(item);
  for (const item of arr(report.annualReportEvidence?.sections)) push(item, item.title);
  for (const item of arr(report.customerInsights?.metrics)) push(item);
  return out;
}

function annualMetricKey(label = "") {
  const text = String(label || "");
  if (/营业|收入|净销售/.test(text)) return "营业收入";
  if (/归母|归属.*净利润/.test(text)) return "归母净利润";
  if (/扣非|非经常性损益/.test(text)) return "扣非净利润";
  if (/毛利/.test(text)) return "毛利率";
  if (/现金流/.test(text)) return "经营现金流";
  if (/资产负债|负债率/.test(text)) return "资产负债率";
  if (/研发/.test(text)) return "研发投入";
  if (/员工|人数|职工/.test(text)) return "员工数量";
  return text;
}

function isUsableAnnualMetricValue(value = "") {
  const text = String(value || "").trim();
  return Boolean(text && !/未在|待人工核对|无法|未知/.test(text));
}

function derivedAnnualMetricMap(report = {}) {
  const contexts = annualContexts(report);
  const labels = ["营业收入", "归母净利润", "扣非净利润", "毛利率", "经营现金流", "资产负债率", "研发投入", "员工数量"];
  const map = new Map();
  for (const label of labels) {
    for (const context of contexts) {
      const directKey = annualMetricKey(context.note || "");
      const value = directKey === label && isUsableAnnualMetricValue(context.value)
        ? context.value
        : annualMetricValueFromContext(label, context.context);
      if (!value) continue;
      map.set(label, {
        label,
        value,
        note: `用户上传年报${context.page ? `第 ${context.page} 页` : ""}指标，需按客户最终披露口径核对。`,
        annualPage: context.page,
        annualFileName: context.annualFileName,
        evidenceExcerpt: context.evidenceExcerpt
      });
      break;
    }
  }
  return map;
}

function repairFinancialMetricsFromAnnual(report = {}, metrics = []) {
  const derived = derivedAnnualMetricMap(report);
  if (!derived.size) return metrics;
  const used = new Set();
  const repaired = arr(metrics).map((item) => {
    const key = annualMetricKey(item.label);
    const replacement = derived.get(key);
    if (!replacement) return repairAnnualMetric(item);
    used.add(key);
    return {
      ...item,
      ...replacement,
      label: item.label || replacement.label,
      page: replacement.annualPage || item.page,
      context: replacement.evidenceExcerpt || item.context
    };
  });
  for (const [key, item] of derived.entries()) {
    if (!used.has(key)) repaired.push(item);
  }
  return repaired;
}

function repairAnnualMetric(item = {}) {
  const label = String(item.label || "");
  const value = String(item.value || "");
  const repaired = valueFromAnnualContext(item);
  if (repaired && repaired !== value) return { ...item, value: repaired };
  if (/归母|归属.*净利润/.test(label) && /现金红利|每10股|派发|分红|利润分配/.test(String(item.context || item.evidenceExcerpt || ""))) {
    return { ...item, value: "上传年报中待人工核对" };
  }
  if (/研发/.test(label) && /万元/.test(String(item.context || item.evidenceExcerpt || "")) && /元$/.test(value) && !/万元$/.test(value)) {
    const num = value.match(/[-\d.]+/)?.[0];
    if (num) return { ...item, value: `${num}万元` };
  }
  if (/员工|人数/.test(label) && /^20\d{2}人$/.test(value)) {
    const fixed = valueFromAnnualContext(item);
    return { ...item, value: fixed && fixed !== value ? fixed : "上传年报中待人工核对" };
  }
  return item;
}

function compactText(value, max = 240) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const sliced = text.slice(0, max);
  const stops = ["。", "；", ";", "！", "？", ".", "，", ","].map((mark) => sliced.lastIndexOf(mark));
  const boundary = Math.max(...stops);
  if (boundary >= Math.floor(max * 0.55)) return sliced.slice(0, boundary + 1).trim();
  return sliced.replace(/[，,、：:；;\s]+$/g, "").trim();
}

function tidyPunctuation(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[；;]\s*[；;]+/g, "；")
    .replace(/。\s*[；;]/g, "；")
    .replace(/[；;]\s*。/g, "。")
    .replace(/，\s*[；;]/g, "；")
    .replace(/[：:]\s*[：:]+/g, "：")
    .trim();
}

function dedupeSentences(value = "") {
  const text = tidyPunctuation(value);
  const parts = text.match(/[^。；;!?！？]+[。；;!?！？]?/g) || [text];
  const seen = new Set();
  const kept = [];
  for (const part of parts) {
    const item = tidyPunctuation(part);
    const key = item.replace(/[。；;!?！？\s]/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(item);
  }
  return tidyPunctuation(kept.join(""));
}

function cleanBusinessText(value = "", max = 260) {
  let text = compactText(value, max);
  text = text.replace(/[#>*`_]+/g, "").replace(/[▲▼]/g, "");
  for (let i = 0; i < 3; i += 1) {
    text = text.replace(/^\s*(?:风险|主要风险|商机风险)\s*[：:]\s*/i, "").trim();
  }
  text = text
    .replace(/系统发现[^。；;]{0,60}线索，但(?:未取得直接强证据|只有单一或间接线索)[。；;]?/g, "")
    .replace(/公开资料不足/g, "初访前证据不足")
    .replace(/公开信息不足/g, "初访前证据不足")
    .replace(/尚未取得财务硬指标，预算判断只能作为初访参考/g, "当前主要是间接经营实力线索，预算判断按轻量验证处理")
    .replace(/尚未取得可用营收\/利润硬指标，预算能力只能保守判断/g, "当前主要是间接经营实力线索，大额项目投入需先核对预算窗口")
    .replace(/未取得直接强证据/g, "只有单一或间接线索")
    .replace(/用户提供线索待确认/g, "用户提供线索")
    .replace(/信用\/法律风险未证实线索/g, "信用/法律风险线索只作为商务复核项")
    .replace(/未证实内容进入待确认/g, "未形成正文结论")
    .replace(/未确认项/g, "未锁定项")
    .replace(/该信息/g, "这一信号")
    .replace(/这类基础信息/g, "这些主体信息")
    .replace(/不单独替代/g, "不能替代")
    .replace(/可先理解为/g, "主线是")
    .replace(/先承认/g, "正视")
    .replace(/泛泛讨论/g, "笼统讨论")
    .replace(/泛泛了解/g, "初步了解")
    .replace(/泛泛介绍/g, "标准功能介绍")
    .replace(/泛泛承诺/g, "抽象承诺")
    .replace(/泛泛兴趣/g, "初步兴趣")
    .replace(/参会人无法触达业务、IT或预算相关角色/g, "参会人只覆盖普通交流角色，不覆盖业务、IT或预算角色")
    .replace(/以已读来源为准，?未形成正文结论。?/g, "")
    .replace(/市场和客户压力需继续核对。?/g, "")
    .replace(/该数据期为[^。；;]{0,120}且属于[^。；;]{0,100}不能直接推断当前预算、付款或数字化投入状态[。；;]?/g, "该线索属于历史或集团层面的间接信息，只用于提示预算窗口和付款主体需优先核对。")
    .replace(/不能直接推断当前预算、付款或数字化投入状态/g, "只用于提示预算窗口和付款主体需优先核对")
    .replace(/([^。；;]{2,80})需现场厘清/g, "$1是首轮商务核对重点")
    .replace(/([^。；;]{2,80})需确认/g, "$1决定是否升级重方案投入")
    .replace(/([^。；;]{2,80})需明确/g, "$1是重方案投入前必须锁定的输入")
    .replace(/([^。；;]{2,80})需了解/g, "$1是重方案投入前必须掌握的信息")
    .replace(/先确认/g, "先核对")
    .replace(/需先评估/g, "应先评估")
    .replace(/需先明确/g, "应先明确")
    .replace(/需先锁定/g, "应先锁定")
    .replace(/需提供/g, "客户侧应提供")
    .replace(/需要提供/g, "客户侧应提供")
    .replace(/客户需要提供/g, "客户侧应提供")
    .replace(/确认样例/g, "核对样例")
    .replace(/确认客户/g, "核对客户")
    .replace(/确认现有/g, "核对现有")
    .replace(/确认本地/g, "核对本地")
    .replace(/成立条件确认后/g, "关键输入锁定后")
    .replace(/关键成立条件/g, "关键商务输入")
    .replace(/仍?是重方案投入前的商务闸门/g, "决定是否升级重方案投入")
    .replace(/仍?是进入重方案投入前的商务闸门/g, "决定是否升级重方案投入")
    .replace(/作为首轮商务闸门/g, "作为首轮商务核对重点")
    .replace(/过早报价/g, "过早投入承诺")
    .replace(/定制方案、报价和POC范围/g, "定制方案、投入边界和POC范围")
    .replace(/方案、报价或试点范围/g, "方案、投入边界或试点范围")
    .replace(/方案、报价或试点/g, "方案、投入边界或试点")
    .replace(/报价边界/g, "商务边界")
    .replace(/报价空间/g, "商务空间")
    .replace(/定制化开发工作量/g, "定制开发范围")
    .replace(/未锁定项不进入承诺/g, "清单外内容不进入本轮交付范围")
    .replace(/仍?是进入重方案前的成立条件/g, "决定是否升级重方案投入")
    .replace(/仍?是进入方案前的成立条件/g, "决定是否升级重方案投入")
    .replace(/进入重方案前的成立条件/g, "决定是否升级重方案投入")
    .replace(/进入方案前的成立条件/g, "决定是否升级重方案投入")
    .replace(/成立条件/g, "关键输入")
    .replace(/商务闸门/g, "升级投入判断项")
    .replace(/建议重点但轻量推进[：:]\s*先拿到真实痛点、预算归属和决策人，再升级定制方案投入[。；;]?/g, "建议作为重点商机经营，但先用小闭环验证价值；预算归属、决策人和真实痛点决定是否升级重方案。")
    .replace(/买单能力按项目和经营线索做轻量推进，初访必须锁定预算来源、采购流程和付款主体[。；;]?/g, "客户存在项目化采购和经营实力信号，适合先用小闭环验证价值；预算来源、采购流程和付款主体决定投入级别。")
    .replace(/买单能力先按项目采购线索轻量推进，第一轮重点验证预算来源、采购流程和付款主体[。；;]?/g, "客户存在项目化采购信号，首轮应围绕预算来源、采购流程和付款主体判断是否升级投入。")
    .replace(/买单能力按轻量推进处理，先验证预算来源、采购流程和付款主体，再决定是否投入重方案[。；;]?/g, "买单能力按小闭环验证处理；预算来源、采购流程和付款主体决定是否投入重方案。")
    .replace(/先拿具体场景、样例数据和下一步动作，再升级方案投入[。；;]?/g, "只有拿到具体场景、样例数据和可衡量指标，才值得升级方案投入。")
    .replace(/先拿到预算来源、付款主体和项目推进人/g, "把预算来源、付款主体和项目推进人作为升级投入判断项")
    .replace(/初访应追预算窗口、历史供应商和立项节奏/g, "商务推进应优先查清预算窗口、历史供应商和立项节奏")
    .replace(/初访可围绕([^，。；;]+)验证价值/g, "$1是优先切入话题")
    .replace(/，?是重方案投入前必须锁定的输入([^。；;]+)/g, "，需先核对$1")
    .replace(/自身AI产品成熟度可能不足，面临/g, "外部AI场景化能力仍有补强空间，形成")
    .replace(/可能面临交付资源紧张、客户问题响应慢的挑战/g, "形成交付资源紧张和客户响应效率压力")
    .replace(/可能对AI、大数据人才有持续需求/g, "AI、大数据人才是持续补强方向")
    .replace(/可能存在([^，。；;]{2,40})痛点/g, "$1是需要优先验证的痛点假设")
    .replace(/^(?:历史集团线索\s*[：:]\s*){2,}/i, "历史集团线索：")
    .replace(/^(?:历史财务线索\s*[：:]\s*){2,}/i, "历史财务线索：")
    .replace(/^(?:历史集团财务线索\s*[：:]\s*){2,}/i, "历史集团财务线索：")
    .replace(/^历史集团线索\s*[：:]\s*历史财务线索\s*[：:]\s*/i, "历史集团财务线索：")
    .replace(/^历史财务线索\s*[：:]\s*历史集团线索\s*[：:]\s*/i, "历史集团财务线索：")
    .replace(/^(?:历史集团线索\s*[：:]\s*){2,}/i, "历史集团线索：")
    .replace(/^(?:历史财务线索\s*[：:]\s*){2,}/i, "历史财务线索：")
    .replace(/^(?:历史集团财务线索\s*[：:]\s*){2,}/i, "历史集团财务线索：")
    .replace(/^(历史集团线索\s*[：:]\s*)+历史财务线索\s*[：:]\s*/i, "历史集团财务线索：")
    .replace(/^(历史财务线索\s*[：:]\s*)+历史集团线索\s*[：:]\s*/i, "历史集团财务线索：")
    .replace(/^历史集团线索\s*[：:]\s*历史集团财务线索\s*[：:]\s*/i, "历史集团财务线索：");
  text = text.replace(/信用\/法律风险线索只作为商务复核项[。；;]?/g, "");
  text = text.replace(/前置条件是确认/g, "前置条件是");
  text = text.replace(/未在公开资料中闭环，重方案投入前仍决定是否升级重方案投入/g, "未在公开资料中闭环，重方案投入前仍需确认");
  const freshnessMarker = "该数据期为";
  const firstFreshness = text.indexOf(freshnessMarker);
  const secondFreshness = firstFreshness >= 0 ? text.indexOf(freshnessMarker, firstFreshness + freshnessMarker.length) : -1;
  if (secondFreshness >= 0) {
    text = `${text.slice(0, secondFreshness).replace(/[。；;，,\s]+$/g, "")}。`;
  }
  text = text
    .replace(/([，,、；;：:])([。！？?])/g, "$2")
    .replace(/[，,、；;：:\s]+$/g, "");
  return dedupeSentences(text);
}

function isIncompleteFieldText(value = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (/\.{2,}|…/.test(text)) return true;
  if (/^[能可]$|^(?:能|可|可以|能够|需|需要|通过|用于|以|对|将|在|与|及|和|或|为|把|让)\s*[。；;，,：:]?$/.test(text)) return true;
  if (/[，,、：:；;]$/.test(text)) return true;
  if (/(?:能|可|可以|能够|需要|通过|用于|围绕|基于|面向|对接|支撑|形成|提供|解决|实现|提升)\s*$/.test(text)) return true;
  if (/^(?:我方机会|客户痛点|解决方案|方案价值|适用前提)\s*(?:能|可|可以|能够)?\s*$/.test(text)) return true;
  const compact = text.replace(/[。；;，,、：:\s'"“”‘’()（）【】\[\]\-—_·|/\\.!！？?]/g, "");
  return compact.length < 4;
}

function safeFieldText(value = "", fallback = "", max = 260) {
  const text = cleanBusinessText(value, max);
  if (meaningful(text) && !isIncompleteFieldText(text)) return text;
  return cleanBusinessText(fallback, max);
}

function substantiveText(value = "", minChars = 6) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/\.{2,}|…/.test(text)) return false;
  const compact = text.replace(/[。；;，,、：:\s'"“”‘’()（）【】\[\]\-—_·|/\\.!！？?]/g, "");
  if (compact.length < minChars) return false;
  if (/^(前置条件是|最大交付风险是|风险|主要风险|支撑判断|客户|涉及|前置条?|选|形成)$/i.test(compact)) return false;
  return true;
}

function normalizeVisibleSupportText(value = "", max = 180) {
  let text = cleanBusinessText(value, max)
    .replace(/^现场(?:顺势)?(?:探问|询问|确认|核对|厘清)\s*/g, "")
    .replace(/^会前(?:尽量)?(?:了解|确认|核对)\s*/g, "")
    .replace(/^需(?:要)?(?:先)?(?:了解|确认|核对|厘清|明确)\s*/g, "")
    .replace(/^先(?:了解|确认|核对|厘清|明确)\s*/g, "")
    .replace(/^了解\s*/g, "")
    .replace(/^确认\s*/g, "")
    .replace(/^核对\s*/g, "")
    .replace(/[。；;，,\s]+$/g, "");
  return text;
}

function cleanListItem(value = "", max = 180) {
  return normalizeVisibleSupportText(value, max).replace(/[。；;，,\s]+$/g, "");
}

function actionableDependencyText(value = "", max = 180) {
  let raw = cleanBusinessText(value, max)
    .replace(/^(?:前置条件是\s*)+/g, "")
    .replace(/^确认/g, "")
    .replace(/^需(?:要)?(?:先)?(?:现场)?(?:确认|核对|厘清)\s*/g, "")
    .replace(/^需(?:要)?(?:先)?明确\s*/g, "")
    .replace(/^需(?:要)?(?:先)?了解\s*/g, "")
    .replace(/^了解\s*/g, "")
    .replace(/，?否则不进入重方案和正式承诺。?$/g, "")
    .replace(/^推进前要锁定\s*/g, "")
    .replace(/^推进前需锁定\s*/g, "")
    .replace(/^推进前必须锁定\s*/g, "")
    .replace(/[。；;，,\s]+$/g, "");
  raw = raw
    .replace(/^需要客户/g, "客户")
    .replace(/[。]\s*需(?:要)?(?:先)?了解/g, "；掌握")
    .replace(/[。]\s*需(?:要)?(?:先)?明确/g, "；明确")
    .replace(/[。]\s*需(?:要)?(?:先)?(?:现场)?(?:确认|核对|厘清)/g, "；确认")
    .replace(/[；;]\s*需(?:要)?(?:先)?了解/g, "；掌握")
    .replace(/[；;]\s*需(?:要)?(?:先)?明确/g, "；明确")
    .replace(/[；;]\s*需(?:要)?(?:先)?(?:现场)?(?:确认|核对|厘清)/g, "；确认")
     .replace(/[，,]\s*需(?:要)?(?:先)?了解/g, "，掌握")
     .replace(/[，,]\s*需(?:要)?(?:先)?明确/g, "，明确")
     .replace(/[，,]\s*需(?:要)?(?:先)?(?:现场)?(?:确认|核对|厘清)/g, "，确认");
  if (!raw || !substantiveText(raw, 8) || isNonDecisionClaim(raw)) return "";
  return cleanBusinessText(raw, max);
}

function customerQuestionText(value = "", max = 180) {
  let text = cleanBusinessText(value, max)
    .replace(/^现场(?:顺势)?(?:探问|询问|确认|核对|厘清)\s*/g, "")
    .replace(/^会前(?:尽量)?(?:了解|确认|核对)\s*/g, "")
    .replace(/^需(?:要)?(?:先)?(?:了解|确认|核对|厘清|明确)\s*/g, "")
    .replace(/^先(?:了解|确认|核对|厘清|明确)\s*/g, "")
    .replace(/^了解\s*/g, "")
    .replace(/^确认\s*/g, "")
    .replace(/^核对\s*/g, "")
    .replace(/[。；;，,\s]+$/g, "");
  if (!text || !substantiveText(text, 8) || isNonDecisionClaim(text)) return "";
  if (/预算来源|审批流程|决策链|付款主体|采购流程/.test(text)) {
    return "本次项目的预算来源、审批流程、付款主体和决策链分别由谁负责？";
  }
  if (/近两年|营业收入|净利润|毛利率|现金流|研发投入/.test(text)) {
    return "这类项目通常走年度数字化预算、业务部门改善费用，还是专项立项？付款主体和审批人分别是谁？";
  }
  if (/系统|数据|接口|权限|样例|部署|安全|知识库|平台|API/.test(text)) {
    return `${text}目前由谁负责，哪些数据或接口可以用于小场景验证？`;
  }
  if (/痛点|目标|效率|成本|质量|交付|工艺|场景|流程|产线|生产/.test(text)) {
    return `${text}里最影响效率、质量或交付结果的环节是什么？`;
  }
  if (/风险|边界|合规|承诺|周期|集团|替代|关系/.test(text)) {
    return `${text}会影响本次项目范围、审批或验收吗？`;
  }
  return /[？?]$/.test(text) ? text : `${text}？`;
}

function isDependencyInstructionText(value = "") {
  const text = cleanBusinessText(value, 220);
  if (!meaningful(text)) return false;
  const startsLikeInstruction = /^(?:推进前|需(?:要)?|客户侧应提供|客户需要提供|提供|明确|确认|锁定|先)/.test(text);
  const hasRiskEffect = /未|不清|缺少|不足|导致|影响|风险|争议|返工|不能|冲突|扩散|验收/.test(text);
  return startsLikeInstruction && !hasRiskEffect;
}

function actionableRiskText(value = "", max = 180) {
  const raw = cleanBusinessText(value, max)
    .replace(/^主要风险[：:]\s*/g, "")
    .replace(/^风险[：:]\s*/g, "")
    .replace(/[。；;，,\s]+$/g, "");
  if (!raw || !substantiveText(raw, 8)) return "";
  if (isBackendRiskTemplateText(raw)) return "";
  if (isDependencyInstructionText(raw)) return "";
  if (/接口|数据|权限|样例|责任人|验收|上线范围|现场|视频|设备|系统|网络|安全|集成|需求扩散|返工/.test(raw)) {
    return cleanBusinessText(raw
      .replace(/现有系统接口、数据权限和样例质量未确认时，交付周期和效果不能锁定/g, "接口、数据权限和样例质量是交付成败关键，缺少任一项都会引发返工、范围扩张和验收争议")
      .replace(/客户侧责任人、验收指标和上线范围不清，会导致需求扩散和反复返工/g, "验收指标、上线范围和变更口径不清，会直接导致需求扩散和反复返工")
      .replace(/需要额外确认/g, "必须提前锁定"), max);
  }
  return isNonDecisionClaim(raw) ? "" : cleanBusinessText(raw, max);
}

function cleanRoundTextItem(item = {}) {
  if (!item || typeof item !== "object") return item;
  const next = { ...item };
  const textKeys = [
    "body",
    "summary",
    "insight",
    "note",
    "customerSignal",
    "pain",
    "opportunity",
    "sourceBasis",
    "reasoning",
    "aiEntry",
    "customerPain",
    "introduction",
    "value",
    "expectedImpact",
    "prerequisite",
    "how",
    "why"
  ];
  const listKeys = ["toConfirm", "validationSignals", "facts", "evidence", "deductions", "riskFlags", "uncertainties"];
  const decisionNarrativeKeys = new Set(["body", "summary", "insight", "note", "sourceBasis", "reasoning", "aiEntry", "pain", "opportunity"]);
  for (const key of textKeys) {
    if (typeof next[key] === "string") {
      const cleaned = cleanBusinessText(next[key], 520);
      next[key] = decisionNarrativeKeys.has(key) && isNonDecisionClaim(cleaned) ? "" : cleaned;
    }
  }
  for (const key of listKeys) {
    if (Array.isArray(next[key])) next[key] = next[key].map((value) => (typeof value === "string" ? cleanListItem(value, 220) : value)).filter(meaningful);
  }
  return next;
}

function cleanRoundSection(section = {}) {
  if (!section || typeof section !== "object") return section;
  return {
    ...section,
    items: arr(section.items).map(cleanRoundTextItem).filter((item) => meaningful(item.title) || meaningful(item.body) || meaningful(item.summary) || meaningful(item.insight))
  };
}

function decisionTextFromItem(item = {}) {
  return [
    item.body,
    item.summary,
    item.insight,
    item.note,
    item.sourceBasis,
    item.reasoning,
    item.aiEntry,
    item.customerPain,
    item.introduction,
    item.value,
    item.expectedImpact,
    item.prerequisite,
    item.how,
    item.why,
    ...arr(item.facts),
    ...arr(item.validationSignals),
    ...arr(item.toConfirm)
  ].filter(Boolean).join("；");
}

function cleanDecisionCardItems(items = [], limit = 12) {
  return arr(items)
    .map(cleanRoundTextItem)
    .filter((item) => meaningful(item.title) || meaningful(decisionTextFromItem(item)))
    .filter((item) => !isNonDecisionClaim(decisionTextFromItem(item)) || arr(item.facts).some(meaningful))
    .slice(0, limit);
}

function cleanDecisionMetrics(items = []) {
  return arr(items)
    .map(cleanRoundTextItem)
    .map((item) => ({
      ...item,
      note: isNonDecisionClaim(item.note || "") ? "" : item.note
    }))
    .filter(renderableMetric)
    .filter((item) => !isNonDecisionClaim(`${item.label || ""} ${item.value || ""} ${item.note || ""}`))
    .slice(0, 10);
}

function targetContextForSolution(context = {}) {
  const round = context.round || {};
  return [
    ...arr(round.customerInfo).flatMap((section) => arr(section.items).flatMap((item) => [section.title, item.title, item.body, item.insight, item.summary, ...arr(item.facts)])),
    ...arr(round.businessInsights).flatMap((item) => [item.title, item.body, item.insight, item.summary]),
    ...arr(round.painsAndOpportunities).flatMap((item) => [item.title, item.customerSignal, item.pain, item.opportunity, item.reasoning, item.sourceBasis]),
    round.inputSummary
  ].map((item) => cleanBusinessText(item, 180)).filter(meaningful).join(" ");
}

function isForcedSellerProductSolution(item = {}, context = {}) {
  const text = [item.title, item.customerPain, item.introduction, item.value, item.expectedImpact, item.why, item.how].filter(Boolean).join(" ");
  const targetText = targetContextForSolution(context);
  if (!meaningful(text)) return false;
  if (/排产|APS|计划排程|高级计划/.test(text)) {
    const hasTargetSchedulingNeed = /用户反馈|拜访反馈|内部排产|自身排产|排产需求|生产计划|计划员|插单|缺料|产能瓶颈|交期延期|调度效率|排程偏差|客户.{0,24}(需要|需求|痛点|问题|采购|招标|改造|升级|替换).{0,24}(排产|APS|计划|调度)|采购.{0,24}(排产|APS|计划|调度)|招标.{0,24}(排产|APS|计划|调度)/.test(targetText);
    const onlySellerInventory =
      /补充APS|集团.*APS产品|自身软件资产未覆盖|作为集团APS产品的补充|独立服务于.*制造企业|我方.*排产|曾经.*排产/.test(text) &&
      !/客户.*(排产|计划|调度|产能|交期|缺料|插单)|用户.*(排产|计划|调度)|拜访.*(排产|计划|调度)/.test(text);
    if (!hasTargetSchedulingNeed || onlySellerInventory) return true;
  }
  if (/追溯|质检|设备|视觉|知识库|数字员工/.test(text)) {
    const keyword = /追溯/.test(text)
      ? /追溯|批次|质量|召回|留痕/
      : /质检|视觉|摄像头|行为识别|知识库|文档|问答|材料|设备|维保|备件/.test(targetText);
    if (!keyword && /我方|曾经|已有产品|核心产品|标准产品/.test(text)) return true;
  }
  return false;
}

function isForcedSellerProductPain(item = {}, context = {}) {
  const text = [item.title, item.customerSignal, item.pain, item.opportunity, item.reasoning, item.sourceBasis, item.aiEntry].filter(Boolean).join(" ");
  const targetText = targetContextForSolution(context).replace(text, "");
  if (/排产|APS|计划排程|高级计划/.test(text)) {
    const hasInternalPain = /用户反馈|拜访反馈|内部排产|自身排产|排产需求|生产计划|计划员|插单|缺料|产能瓶颈|交期延期|调度效率|排程偏差|客户.{0,24}(需要|需求|痛点|问题|采购|招标|改造|升级|替换).{0,24}(排产|APS|计划|调度)|采购.{0,24}(排产|APS|计划|调度)|招标.{0,24}(排产|APS|计划|调度)/.test(targetText);
    const onlyProductCase =
      /集团.*APS产品|蒙牛项目|服务大型制造客户|客户案例|交付案例|补充APS|第三方智能排产/.test(text) &&
      !/客户.*(排产|计划|调度|产能|交期|缺料|插单)|用户.*(排产|计划|调度)|拜访.*(排产|计划|调度)/.test(text);
    if (!hasInternalPain || onlyProductCase) return true;
  }
  return false;
}

function contextReport(context = {}) {
  return context?.report || context?.rootReport || context || {};
}

function sellerCapabilityTerms(report = {}) {
  const profile = report.sellerProfileSnapshot || report.sellerProfile || {};
  const rawValues = [
    profile.companyName,
    profile.mainBusiness,
    profile.summary,
    profile.coreProducts,
    profile.coreOfferings,
    profile.targetCustomers,
    profile.typicalScenarios,
    profile.strengths,
    profile.keywords
  ].flatMap((item) => arr(item)).filter(Boolean);
  const rawText = rawValues.join(" ");
  const known = [
    "车灯", "执行器", "调光", "调光电机", "步进电机", "充电口盖", "远近光", "空调风门",
    "内外饰灯", "LED", "PCBA", "汽车电子", "新能源汽车", "整车厂", "主机厂", "零部件",
    "IATF16949", "供应商", "供货", "车型", "定点", "份额", "样品", "小批", "量产",
    "质量", "交付", "成本", "年降", "海外配套", "本地化配套", "产能", "BOM",
    "智能体", "知识库", "数据问答", "RAG", "软件", "系统", "平台", "算法", "SaaS",
    "咨询", "数字化", "信息化", "集成", "API", "AIOps", "HolliCube", "MES", "ERP", "WMS", "LIMS"
  ];
  const splitTerms = rawValues
    .flatMap((value) => String(value).split(/[、，,；;\/|｜\s（）()]+/g))
    .map((value) => cleanBusinessText(value, 32))
    .filter((value) => value.length >= 2 && value.length <= 18);
  const detected = known.filter((term) => rawText.includes(term));
  return uniqueTexts([...splitTerms, ...detected], 40);
}

function sellerCapabilityTextHasTerm(text = "", report = {}) {
  const source = String(text || "");
  if (!meaningful(source)) return false;
  return sellerCapabilityTerms(report).some((term) => term.length >= 2 && source.includes(term));
}

function nonDigitalSellerGenericFit(text = "") {
  return /供应商|供货|车型|定点|份额|质量|交付|成本|年降|认证|样品|小批|量产|研发协同|技术规格|技术要求|BOM|海外|本地化|产能|配套|零部件|主机厂|整车厂|客户订单|框架协议|准入/.test(String(text || ""));
}

function digitalSolutionAssumptionText(value = "") {
  return /智用开物|智能体|Agent|知识库|数据问答|RAG|HolliCube|AIOps|AI(?:辅助|分析|建模)|工业AI|编排工作台|投标售前|标书|投标材料|材料复用|材料生成|检索助手|问答助手|生态应用|伙伴应用|应用接入|场景智能体|流程智能化|上层应用定制|工具调用|API\/工具调用|知识运营|数据中台/.test(String(value || ""));
}

function sellerAllowsDigitalSolution(report = {}) {
  return sellerCapabilityMode(report) === "digital";
}

function sellerAlignedText(text = "", context = {}) {
  const report = contextReport(context);
  if (!sellerProfileText(report)) return true;
  if (sellerAllowsDigitalSolution(report)) return true;
  return sellerCapabilityTextHasTerm(text, report) || nonDigitalSellerGenericFit(text);
}

function sellerAlignedOpportunityForPain(item = {}, context = {}) {
  const report = contextReport(context);
  const offer = sellerCoreOffer(report);
  const text = [item.title, item.customerSignal, item.sourceBasis, item.reasoning, item.pain].join(" ");
  if (/海外|本地化|全球/.test(text)) return `围绕${offer}评估海外车型认证、本地化配套、仓储或伙伴协作路径，先确认客户海外工厂的采购政策和技术认证要求。`;
  if (/年降|成本|利润|毛利|降本/.test(text)) return `围绕${offer}做工艺降本、良率提升和交付稳定性方案，用可量化的成本/质量数据支撑年降谈判。`;
  if (/车型|新车型|定点|研发|技术|专利|执行器/.test(text)) return `围绕${offer}提前准备样品、测试数据和技术规格对标，争取在新车型定点前进入研发验证。`;
  if (/份额|供货|供应商|采购/.test(text)) return `围绕${offer}梳理现有供货车型、竞品份额、质量交付表现和报价空间，争取扩大供货份额。`;
  return "";
}

function sanitizeSellerPain(item = {}, context = {}) {
  const report = contextReport(context);
  if (sellerAllowsDigitalSolution(report)) return item;
  const groundingText = [item.title, item.customerSignal, item.sourceBasis, item.reasoning, item.pain].join(" ");
  const opportunityText = [item.aiEntry, item.opportunity].join(" ");
  if (digitalSolutionAssumptionText(opportunityText) && sellerAlignedText(groundingText, context)) {
    const replacement = sellerAlignedOpportunityForPain(item, context);
    return {
      ...item,
      aiEntry: replacement,
      opportunity: replacement || item.opportunity
    };
  }
  return item;
}

function isUnsupportedSellerCapabilityPain(item = {}, context = {}) {
  const report = contextReport(context);
  if (sellerAllowsDigitalSolution(report)) return false;
  const text = [item.title, item.customerSignal, item.sourceBasis, item.reasoning, item.pain, item.aiEntry, item.opportunity].join(" ");
  if (!digitalSolutionAssumptionText(text)) return false;
  const grounded = sellerAlignedText([item.title, item.customerSignal, item.sourceBasis, item.reasoning, item.pain].join(" "), context);
  const coreText = [item.title, item.reasoning, item.pain].join(" ");
  return !grounded || digitalSolutionAssumptionText(coreText);
}

function isUnsupportedSellerCapabilitySolution(item = {}, context = {}) {
  const report = contextReport(context);
  if (sellerAllowsDigitalSolution(report)) return false;
  const text = [item.title, item.customerPain, item.introduction, item.value, item.expectedImpact, item.why, item.how, item.body, item.prerequisite].join(" ");
  if (digitalSolutionAssumptionText(text)) return true;
  if (!sellerAlignedText(text, context) && sellerCapabilityTerms(report).length) return true;
  return false;
}

function usefulScenarioSignalForSeller(signal = {}, report = {}) {
  if (!usefulScenarioSignal(signal)) return false;
  if (sellerAllowsDigitalSolution(report)) return true;
  const text = [signal.title, signal.basis, signal.aiEntry, signal.topic].join(" ");
  if (digitalSolutionAssumptionText(text)) return false;
  return sellerAlignedText(text, { report });
}

function hasTargetSchedulingNeed(context = {}) {
  const targetText = targetContextForSolution(context);
  return /用户反馈|拜访反馈|内部排产|自身排产|排产需求|生产计划|计划员|插单|缺料|产能瓶颈|交期延期|调度效率|排程偏差|客户.{0,24}(需要|需求|痛点|问题|采购|招标|改造|升级|替换).{0,24}(排产|APS|计划|调度)|采购.{0,24}(排产|APS|计划|调度)|招标.{0,24}(排产|APS|计划|调度)/.test(targetText);
}

function isUnsupportedSchedulingDemandText(value = "", context = {}) {
  const text = cleanBusinessText(value, 320);
  if (!/排产|APS|计划排程|高级计划|智能排产/.test(text)) return false;
  if (hasTargetSchedulingNeed(context)) return false;
  return /明确.{0,16}(需求|补充需求|采购|改造|替换)|有.{0,12}(需求|痛点|机会)|需要.{0,12}(排产|APS|计划|调度)|补充.{0,12}(排产|APS|计划|调度)|排产.{0,12}(需求|痛点|采购|改造|替换)|APS.{0,12}(需求|采购|改造|替换)/.test(text);
}

function isUnsupportedSchedulingQuestion(value = "", context = {}) {
  const text = cleanBusinessText(value, 320);
  if (!/排产|APS|计划排程|高级计划|智能排产/.test(text)) return false;
  if (hasTargetSchedulingNeed(context)) return false;
  return /第三方智能排产|智能排产解决方案|排产方案|排产系统|排产采购|排产需求|APS.{0,20}(开放|替换|采购|需求|改造|补充)|排产.{0,20}(开放|替换|采购|需求|改造|补充)/.test(text);
}

function cleanDecisionSolutions(items = [], context = {}) {
  const cleaned = arr(items)
    .map(cleanRoundTextItem)
    .filter((item) => meaningful(item.title))
    .filter((item) => [item.customerPain, item.introduction, item.value, item.expectedImpact, item.how, item.why].some(meaningful))
    .filter((item) => !isNonDecisionClaim([item.customerPain, item.introduction, item.value, item.expectedImpact, item.how, item.why].join("；")))
    .filter((item) => !isUnsupportedSellerCapabilitySolution(item, context))
    .filter((item) => !isForcedSellerProductSolution(item, context));
  return normalizePrioritizedSolutions(cleaned, 8);
}

function explicitPriorityLabel(value = "") {
  const match = String(value || "").toUpperCase().match(/\bP\s*([0-9])\b/);
  if (!match) return "";
  return `P${Math.min(Number(match[1]), 2)}`;
}

function normalizePriorityLabel(value = "", index = 0) {
  return explicitPriorityLabel(value) || `P${Math.min(Math.max(Number(index) || 0, 0), 2)}`;
}

function priorityRank(value = "") {
  const label = explicitPriorityLabel(value);
  return label ? Number(label.slice(1)) : 99;
}

function prioritySorted(items = []) {
  return arr(items)
    .map((item, index) => ({ item, index, rank: priorityRank(item?.priority) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item);
}

function normalizePrioritizedSolutions(items = [], limit = 6) {
  return prioritySorted(
    arr(items)
      .map((item, index) => ({
        ...item,
        title: item.title || item.name || item.label || "",
        priority: normalizePriorityLabel(item.priority, index)
      }))
      .filter((item) => meaningful(item.title))
  ).slice(0, limit);
}

function priorityMatchKeywords(value = "") {
  const text = String(value || "");
  return [
    "知识库", "数据问答", "知识", "生态", "伙伴", "接入", "智能体", "编排",
    "投标", "售前", "标书", "交付", "预测", "维护", "运维", "AIOps",
    "跨系统", "流程", "HolliCube", "机理", "模型", "MES", "ERP", "WMS", "LIMS"
  ].filter((keyword) => text.includes(keyword));
}

function priorityMatchText(item = {}) {
  return [
    item.title,
    item.customerPain,
    item.pain,
    item.opportunity,
    item.aiEntry,
    item.introduction,
    item.value,
    item.why,
    item.sourceBasis,
    item.reasoning
  ].filter(meaningful).join(" ");
}

function painSolutionMatchScore(pain = {}, solution = {}) {
  const painText = priorityMatchText(pain);
  const solutionText = priorityMatchText(solution);
  const painKey = normalizeForCompare(painText);
  const solutionKey = normalizeForCompare(solutionText);
  const painTitle = normalizeForCompare(pain.title || "");
  const solutionTitle = normalizeForCompare(solution.title || "");
  let score = 0;
  if (painTitle && solutionKey.includes(painTitle)) score += 8;
  if (solutionTitle && painKey.includes(solutionTitle)) score += 8;
  if (painKey && solutionKey && (painKey.includes(solutionKey) || solutionKey.includes(painKey))) score += 6;
  const painKeywords = new Set(priorityMatchKeywords(painText));
  priorityMatchKeywords(solutionText).forEach((keyword) => {
    if (painKeywords.has(keyword)) score += 2;
  });
  return score;
}

function relatedPainForSolution(solution = {}, pains = [], fallbackIndex = 0) {
  const ranked = arr(pains)
    .map((pain, index) => ({ pain, index, score: painSolutionMatchScore(pain, solution) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked[0]?.score > 0 ? ranked[0].pain : arr(pains)[fallbackIndex] || {};
}

function alignPainPrioritiesWithSolutions(pains = [], solutions = [], limit = 8) {
  const visibleSolutions = normalizePrioritizedSolutions(solutions, Math.max(arr(solutions).length, 1));
  const aligned = arr(pains)
    .map(cleanRoundTextItem)
    .filter((item) => meaningful(item.title) || meaningful(item.pain) || meaningful(item.opportunity))
    .map((pain, index) => {
      const explicit = explicitPriorityLabel(pain.priority);
      if (explicit) return { ...pain, priority: explicit };
      const matched = visibleSolutions
        .map((solution, solutionIndex) => ({ solution, solutionIndex, score: painSolutionMatchScore(pain, solution) }))
        .sort((a, b) => b.score - a.score || a.solutionIndex - b.solutionIndex)[0];
      const fallback = visibleSolutions[index] || {};
      return {
        ...pain,
        priority: matched?.score > 0
          ? normalizePriorityLabel(matched.solution.priority, matched.solutionIndex)
          : normalizePriorityLabel(fallback.priority, index)
      };
    });
  return prioritySorted(aligned).slice(0, limit);
}

function painItemsForVisibleSolutions(pains = [], solutions = [], limit = 5) {
  const visibleSolutions = visibleSolutionCards(solutions, limit);
  const pool = arr(pains)
    .map(cleanRoundTextItem)
    .filter((item) => meaningful(item.title) || meaningful(item.pain) || meaningful(item.opportunity));
  if (!visibleSolutions.length) return alignPainPrioritiesWithSolutions(pool, [], limit);
  const used = new Set();
  const fallbackQueue = [...pool];
  return visibleSolutions
    .map((solution, solutionIndex) => {
      const ranked = pool
        .map((pain, painIndex) => ({
          pain,
          painIndex,
          key: normalizeForCompare(`${pain.title || ""}${pain.pain || ""}${pain.opportunity || ""}`) || String(painIndex),
          score: painSolutionMatchScore(pain, solution)
        }))
        .filter((item) => !used.has(item.key))
        .sort((a, b) => b.score - a.score || a.painIndex - b.painIndex);
      let picked = ranked[0]?.score > 0 ? ranked[0] : null;
      if (!picked) {
        while (fallbackQueue.length) {
          const next = fallbackQueue.shift();
          const key = normalizeForCompare(`${next.title || ""}${next.pain || ""}${next.opportunity || ""}`) || String(pool.indexOf(next));
          if (!used.has(key)) {
            picked = { pain: next, key };
            break;
          }
        }
      }
      if (!picked?.pain) return null;
      used.add(picked.key);
      return {
        ...picked.pain,
        priority: normalizePriorityLabel(solution.priority, solutionIndex)
      };
    })
    .filter(Boolean);
}

function visibleSolutionCards(items = [], limit = 5) {
  return normalizePrioritizedSolutions(items, limit);
}

function cleanDecisionPains(items = [], context = {}) {
  return arr(items)
    .map(cleanRoundTextItem)
    .map((item) => sanitizeSellerPain(item, context))
    .filter((item) => meaningful(item.title) || meaningful(item.reasoning) || meaningful(item.aiEntry) || meaningful(item.pain) || meaningful(item.opportunity))
    .filter((item) => !isNonDecisionClaim([item.sourceBasis, item.customerSignal, item.reasoning, item.pain, item.aiEntry, item.opportunity].join("；")))
    .filter((item) => !isUnsupportedSellerCapabilityPain(item, context))
    .filter((item) => !isForcedSellerProductPain(item, context))
    .slice(0, 8);
}

function cleanOpportunityFitData(fit = {}) {
  if (!fit || typeof fit !== "object") return fit;
  return {
    ...fit,
    summary: usefulDecisionText(fit.summary) || "",
    fitPoints: arr(fit.fitPoints).map(cleanListItem).filter(meaningful).filter((item) => !isNonDecisionClaim(item)).slice(0, 6),
    entryScenarios: arr(fit.entryScenarios).map(cleanListItem).filter(meaningful).filter((item) => !isNonDecisionClaim(item)).slice(0, 6),
    noCommitments: arr(fit.noCommitments).map(cleanListItem).filter(meaningful).filter((item) => !isNonDecisionClaim(item)).slice(0, 6),
    validationQuestions: arr(fit.validationQuestions).map(cleanListItem).filter(meaningful).slice(0, 8)
  };
}

function cleanStrategyData(strategy = {}, context = {}) {
  if (!strategy || typeof strategy !== "object") return strategy;
  const currentSituation = usefulDecisionText(strategy.currentSituation) || "";
  const rawOverallApproach = usefulDecisionText(strategy.overallApproach) || "";
  const overallApproach =
    sellerAllowsDigitalSolution(contextReport(context)) || !digitalSolutionAssumptionText(rawOverallApproach)
      ? rawOverallApproach
      : "";
  const implementationPath = arr(strategy.implementationPath)
    .map(cleanListItem)
    .filter(meaningful)
    .filter((item) => substantiveText(item, 8) && !isNonDecisionClaim(item))
    .slice(0, 8);
  const shouldCompletePath = meaningful(currentSituation) || meaningful(overallApproach) || arr(strategy.rankedSolutions).length;
  return {
    ...strategy,
    currentSituation,
    overallApproach,
    rankedSolutions: normalizePrioritizedSolutions(
      arr(strategy.rankedSolutions)
        .map(cleanRoundTextItem)
        .filter((item) => meaningful(item.title) || meaningful(item.why))
        .filter((item) => !isNonDecisionClaim(`${item.title || ""} ${item.why || ""}`))
        .filter((item) => !isUnsupportedSellerCapabilitySolution(item, context)),
      6
    ),
    implementationPath: implementationPath.length || !shouldCompletePath
      ? implementationPath
      : sellerCapabilityMode(contextReport(context)) === "digital"
        ? [
          "业务访谈先锁定真实痛点、责任部门和预算归属。",
          "P0场景先采集样例数据和流程材料，定义边界、指标和成功标准。",
          "按轻量验证、小范围试点、系统或知识体系集成三步推进。"
        ]
        : [
          "先确认客户具体车型、品类、现有供应商和技术/认证要求。",
          "P0场景先拿一个产品线做样品、测试、报价或份额提升闭环。",
          "按样品验证、小批试用、供应商准入和批量供货路径推进。"
        ]
  };
}

function defaultDeliverySowOutline() {
  return [
    { title: "业务应用前台", items: ["用户入口", "业务操作台", "结果展示与反馈"] },
    { title: "数据/知识底座", items: ["数据对象", "业务规则", "知识文档"] },
    { title: "系统连接器", items: ["接口适配", "权限审计", "日志追踪"] },
    { title: "运营管理后台", items: ["配置管理", "效果统计", "版本迭代"] }
  ];
}

function cleanDeliveryData(delivery = {}, context = {}) {
  if (!delivery || typeof delivery !== "object") return delivery;
  const report = contextReport(context);
  const sellerMode = sellerCapabilityMode(report);
  const rawArchitectureSketch = usefulDecisionText(delivery.architectureSketch) || "";
  const architectureSketch =
    sellerMode === "digital" || !digitalSolutionAssumptionText(rawArchitectureSketch)
      ? rawArchitectureSketch
      : "";
  const responsePlan = arr(delivery.responsePlan || delivery.mitigations || delivery.riskResponses)
    .map((item) => cleanBusinessText(item, 180))
    .filter(meaningful)
    .filter((item) => sellerMode === "digital" || !digitalSolutionAssumptionText(item))
    .slice(0, 5);
  const deliveryRisks = arr(delivery.deliveryRisks)
    .map(actionableRiskText)
    .filter(meaningful)
    .filter((item) => sellerMode === "digital" || !digitalSolutionAssumptionText(item))
    .slice(0, 6);
  const dependencies = arr(delivery.dependencies)
    .map(actionableDependencyText)
    .filter(meaningful)
    .filter((item) => sellerMode === "digital" || !digitalSolutionAssumptionText(item))
    .slice(0, 6);
  const sowOutline = arr(delivery.sowOutline)
    .map(cleanListItem)
    .filter(meaningful)
    .filter((item) => sellerMode === "digital" || !digitalSolutionAssumptionText(item))
    .filter((item) => substantiveText(item, 8) && !isNonDecisionClaim(item))
    .slice(0, 10);
  const shouldCompleteDelivery = meaningful(architectureSketch) || responsePlan.length || deliveryRisks.length || dependencies.length || sowOutline.length;
  const fallbackSowOutline = shouldCompleteDelivery
    ? sellerMode === "digital"
      ? defaultDeliverySowOutline().map((item) => `${item.title}：${arr(item.items).join("、")}`)
      : [
          "产品匹配确认：目标品类、技术参数、认证要求",
          "样品与质量验证：样品准备、测试数据、问题闭环",
          "商务与交付准备：报价、准入、产能和交付计划"
        ]
    : [];
  const fallbackDependencies = shouldCompleteDelivery
    ? sellerMode === "digital"
      ? [
        "现有系统清单、接口/API文档、读写权限、鉴权方式和日志审计要求。",
        "脱敏业务文档、系统样例、接口说明或离线数据样例。",
        "既有系统的只读/写入边界、账号权限和审计要求。"
      ]
      : [
        "目标车型、产品品类、技术规格、认证要求和验收标准。",
        "样品、图纸/BOM、测试工况、质量问题记录和竞品供应信息。",
        "供应商准入要求、报价口径、账期、合同主体和付款主体。"
      ]
    : [];
  const fallbackDeliveryRisks = shouldCompleteDelivery
    ? sellerMode === "digital"
      ? [
        "系统接口、权限和脱敏样例未锁定时，只能做轻量验证，不能承诺正式对接效果。",
        "客户既有平台能力边界不清时，方案定位容易与现有系统发生冲突。",
        "多系统数据口径和现场责任岗位不清，会影响数据问答、运维闭环和验收口径。"
      ]
      : [
        "技术规格、认证要求和测试工况未锁定时，样品验证可能反复返工。",
        "既有供应商、客户自研替代或目标价压力未摸清时，报价和份额判断容易失真。",
        "预测需求量、交付节奏和质量责任边界不清，会影响小批试用和量产放量。"
      ]
    : [];
  return {
    ...delivery,
    architectureSketch,
    deliveryRisks: deliveryRisks.length ? deliveryRisks : fallbackDeliveryRisks,
    dependencies: dependencies.length ? dependencies : fallbackDependencies,
    responsePlan,
    sowOutline: sowOutline.length ? sowOutline : fallbackSowOutline
  };
}

function hasUsefulStrategy(strategy = {}) {
  return Boolean(
    meaningful(strategy.currentSituation) ||
      meaningful(strategy.overallApproach) ||
      arr(strategy.rankedSolutions).some((item) => meaningful(item.title) || meaningful(item.why)) ||
      arr(strategy.implementationPath).some(meaningful)
  );
}

function hasUsefulDelivery(delivery = {}) {
  const sow = arr(delivery.sowOutline).filter(meaningful);
  const risks = arr(delivery.deliveryRisks).filter(meaningful);
  return Boolean(
    meaningful(delivery.architectureSketch) &&
      sow.length >= 3 &&
      risks.length >= 2
  );
}

function sanitizeReportDecisionData(report = {}) {
  const customerInsights = report.customerInsights || {};
  return {
    ...report,
    quickCards: cleanDecisionCardItems(report.quickCards, 4),
    conclusions: cleanDecisionCardItems(report.conclusions, 5),
    businessInsights: cleanDecisionCardItems(report.businessInsights, 12),
    pains: cleanDecisionPains(report.pains, { report }),
    solutions: cleanDecisionSolutions(report.solutions, { report }),
    opportunityFit: cleanOpportunityFitData(report.opportunityFit),
    solutionStrategy: cleanStrategyData(report.solutionStrategy, { report }),
    deliveryAssessment: cleanDeliveryData(report.deliveryAssessment, { report }),
    customerInsights: {
      ...customerInsights,
      localCards: cleanDecisionCardItems(customerInsights.localCards, 8),
      groupCards: cleanDecisionCardItems(customerInsights.groupCards, 8),
      metrics: cleanDecisionMetrics(customerInsights.metrics),
      digitalCards: cleanDecisionCardItems(customerInsights.digitalCards, 8)
    }
  };
}

function safeScenarioText(value = "", limit = 240) {
  return cleanBusinessText(value, limit)
    .replace(/智能排产/g, "计划协同")
    .replace(/排产调整/g, "计划调整")
    .replace(/排产/g, "计划协同");
}

function allTopicPainSignals(report = {}) {
  const briefSignals = arr(report.sourceBriefs || report.topicBriefs)
    .flatMap((brief) =>
      arr(brief.painSignals).map((signal) => ({
        ...signal,
        topic: brief.topic || "",
        sourceIds: arr(signal.sourceIds).length ? signal.sourceIds : arr(brief.sourceIds)
      }))
    );
  const insightSignals = [
    ...arr(report.businessInsights),
    ...arr(report.customerInsights?.digitalCards)
  ].map((item) => ({
    title: item.title || item.label,
    basis: item.body || item.summary || item.claim || item.insight,
    validationSignals: item.toConfirm || item.questions,
    aiEntry: item.aiEntry || item.opportunity || "",
    sourceIds: arr(item.sourceIds),
    topic: "业务洞察"
  }));
  return [...briefSignals, ...insightSignals]
    .filter((signal) => meaningful(signal.title) && (meaningful(signal.basis) || meaningful(signal.aiEntry)) && arr(signal.sourceIds).length);
}

function scenarioThemeFromText(value = "") {
  const text = String(value || "");
  if (/售前|投标|招投标|标书|项目文档|方案模板|验收材料|项目交付/.test(text)) return "presales_delivery";
  if (/运维|预测性维护|告警|AIOps|维修|备件|可观测/.test(text)) return "ops_closure";
  if (/生态|伙伴|应用融合|接入|开发者门户|应用市场|能力中心/.test(text)) return "ecosystem";
  if (/多系统|集成|互联互通|ERP|SAP|WMS|LIMS|MES/.test(text)) return "integration";
  if (/知识库|问答|知识沉淀|知识复用|数据问答|知识管理/.test(text)) return "knowledge";
  if (/HolliCube|智能体|Agent|机理模型|上层应用|流程智能化/.test(text)) return "agent_platform";
  return "";
}

function scenarioThemeKey(item = {}) {
  const title = item.title || item.label || item.priority || "";
  return (
    scenarioThemeFromText(title) ||
    scenarioThemeFromText([item.sourceBasis, item.basis, item.customerPain, item.reasoning, item.aiEntry, item.opportunity, item.body, item.summary].join(" ")) ||
    normalizeForCompare(title || item.body || item.summary || item.customerPain || item).slice(0, 80)
  );
}

function mergeScenarioItemsByTheme(primary = [], fallback = [], limit = 6) {
  const out = [];
  const seen = new Set();
  for (const item of [...arr(primary), ...arr(fallback)]) {
    const key = scenarioThemeKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, limit);
}

function scenarioSignalScore(signal = {}) {
  const text = [signal.title, signal.basis, signal.aiEntry, signal.topic].join(" ");
  let score = arr(signal.sourceIds).length;
  if (/知识库|问答|知识沉淀|数据问答/.test(text)) score += 7;
  if (/生态|伙伴|应用融合|接入/.test(text)) score += 6;
  if (/多系统|集成|互联互通|ERP|WMS|LIMS|MES|HolliCube/.test(text)) score += 5;
  if (/售前|投标|交付|项目文档|方案/.test(text)) score += 4;
  if (/运维|预测性维护|告警|AIOps|维修/.test(text)) score += 4;
  if (/智能体|Agent|流程智能化|上层应用定制/.test(text)) score += 3;
  if (/必然需要|可能存在|未提及具体/.test(text)) score -= 2;
  return score;
}

function usefulScenarioSignal(signal = {}) {
  const text = [signal.title, signal.basis, signal.aiEntry].join(" ");
  if (!arr(signal.sourceIds).length) return false;
  if (!/知识库|问答|智能体|Agent|生态|伙伴|应用|集成|互联|数据|治理|流程|交付|售前|投标|运维|维护|HolliCube|MES|ERP|WMS|LIMS/.test(text)) return false;
  if (/排产|APS/.test(text) && !/集成|MES|ERP|WMS|LIMS|HolliCube|蒙牛|计划调整/.test(text)) return false;
  return true;
}

function painFromSignal(signal = {}) {
  const text = [signal.title, signal.basis, signal.aiEntry].join(" ");
  const sourceBasis = safeScenarioText(signal.basis || signal.sourceBasis || "", 240);
  const sourceIds = arr(signal.sourceIds).slice(0, 6);
  if (/售前|投标|招投标|标书|项目交付|验收材料/.test(text)) {
    return {
      title: "投标售前与交付材料复用压力",
      sourceBasis,
      reasoning: "客户公开项目和招投标活动较活跃，且业务覆盖多行业、多系统集成场景，方案、标书、案例、验收口径和交付经验若仍靠人工分散维护，会影响售前响应和项目复制效率。",
      validationSignals: [
        "标书、方案、案例和验收文档是否已有统一材料库",
        "售前方案初稿和项目复盘材料目前由谁维护",
        "是否希望把行业案例、产品能力和交付模板做成可问答、可引用、可审计的助手"
      ],
      aiEntry: "用售前投标与交付知识库助手沉淀行业案例、产品能力、项目模板、验收口径和常见问答，先提升材料检索与方案初稿效率，再扩展到投标材料库。",
      sourceIds
    };
  }
  if (/运维|预测性维护|告警|AIOps|维修|备件|可观测/.test(text)) {
    return {
      title: "预测性维护到运维闭环的落地断点",
      sourceBasis,
      reasoning: "公开线索显示客户具备工业数据、模型和预测性维护方向，但从告警解释到维修建议、备件申请、工单处置和复盘沉淀之间仍需要业务闭环验证。",
      validationSignals: [
        "预测告警目前如何触达一线岗位，是否能自动生成工单",
        "故障知识、维修记录和备件信息是否能与告警联动",
        "客户更希望先做只读解释助手，还是接入正式工单流程"
      ],
      aiEntry: "用运维智能体或轻量 AIOps 工作流，把预测告警、故障知识、维修建议、备件申请和处置复盘串成可追踪闭环。",
      sourceIds
    };
  }
  if (/生态|伙伴|应用融合|接入/.test(text)) {
    return {
      title: "生态伙伴应用接入与治理压力",
      sourceBasis,
      reasoning: "客户正在推进平台生态和上层应用融合，伙伴数量和应用类型增加后，接入标准、接口权限、测试验收和交付管理会成为规模化复制的瓶颈。",
      validationSignals: [
        "当前生态伙伴数量、接入流程和验收标准",
        "HolliCube 对伙伴开放哪些接口、工具和数据边界",
        "是否已有开发者门户、应用市场或伙伴交付模板"
      ],
      aiEntry: "用生态应用接入与智能体编排工作台，把伙伴应用的接口、知识、流程和验收点沉淀为可复用模板。",
      sourceIds
    };
  }
  if (/多系统|集成|互联互通|ERP|SAP|WMS|LIMS|MES/.test(text)) {
    return {
      title: "多系统集成后的数据问答与流程协同压力",
      sourceBasis,
      reasoning: "客户案例涉及 MES、ERP、SAP、WMS、LIMS 等多系统集成，数据打通后仍可能存在口径解释、跨系统查询、人工流转和交付运维沟通成本。",
      validationSignals: [
        "高频查询和跨系统动作分别发生在哪些岗位",
        "数据口径和接口权限由谁维护",
        "是否能提供脱敏样例验证只读问答和流程辅助"
      ],
      aiEntry: "在现有平台和多系统接口之上，先做只读数据问答和流程辅助智能体，再按场景逐步接入任务流转。",
      sourceIds
    };
  }
  return {
    title: safeScenarioText(signal.title || "潜在痛点", 80),
    sourceBasis,
    reasoning: safeScenarioText(signal.reasoning || signal.body || signal.basis || "", 280),
    validationSignals: arr(signal.validationSignals || signal.toConfirm)
      .map((item) => safeScenarioText(item, 120))
      .filter(meaningful)
      .slice(0, 5),
    aiEntry: safeScenarioText(signal.aiEntry || signal.opportunity || "", 280),
    sourceIds
  };
}

function solutionFromPainSignal(signal = {}, index = 0) {
  const text = [signal.title, signal.basis, signal.aiEntry].join(" ");
  const basePain = safeScenarioText(signal.basis || signal.title || "", 220);
  const sourceIds = arr(signal.sourceIds).slice(0, 6);
  if (/生态|伙伴|应用融合|接入/.test(text)) {
    return {
      priority: index === 0 ? "P0" : "P1",
      title: "生态应用接入与智能体编排工作台",
      customerPain: basePain || "客户正在推进平台生态和上层应用融合，需要降低伙伴接入、应用编排和验收管理成本。",
      introduction: "围绕 HolliCube 生态应用接入，提供智能体编排、API/工具调用、知识库和应用验收流程，让伙伴应用可以按统一标准接入、测试和交付。",
      value: "减少重复接口沟通和交付标准不一致，把生态伙伴管理从人工协调转为可配置、可追踪的流程。",
      expectedImpact: "优先形成一个伙伴应用接入样板，再复制到更多行业应用和区域能力中心。",
      prerequisite: "确认伙伴类型、现有接入流程、HolliCube 可开放接口、权限边界和验收标准。",
      why: "客户公开线索显示其在吸收生态伙伴并融合上层应用，和智用开物的智能体基础平台存在交集。",
      how: "先选择一个伙伴应用做接入样板，梳理接口、知识、流程和验收点，再沉淀为可复用模板。",
      sourceIds
    };
  }
  if (/多系统|集成|互联互通|ERP|WMS|LIMS|MES/.test(text)) {
    return {
      priority: index === 0 ? "P0" : "P1",
      title: "跨系统数据问答与流程智能体",
      customerPain: basePain || "客户项目中涉及多系统互联互通，交付和运维阶段容易出现接口、数据口径和人工流转成本。",
      introduction: "在现有工业平台和 MES/ERP/WMS/LIMS 等系统之上，先做只读数据问答和流程辅助智能体，再按场景逐步接入任务流转。",
      value: "让售前、交付和客户现场能用自然语言查询系统数据、定位口径差异，并把常见跨系统动作固化为可审计流程。",
      expectedImpact: "降低跨系统查询和沟通成本，减少项目交付中反复解释口径、查表和人工转录的时间。",
      prerequisite: "确认可接入系统清单、数据口径、接口权限、脱敏样例和只读/写入边界。",
      why: "公开案例显示客户具备多系统集成经验，这更适合先做补充型数据问答和流程智能体，而不是替换其平台。",
      how: "先围绕一个已交付行业案例选取 3-5 个高频查询和流程动作，做轻量验证后再扩展。",
      sourceIds
    };
  }
  if (/运维|预测性维护|告警|AIOps|维修/.test(text)) {
    return {
      priority: index === 0 ? "P0" : "P2",
      title: "预测性维护闭环与运维智能体",
      customerPain: basePain || "客户具备工业数据和模型基础，但预测结果是否能转成工单、备件、处置和复盘闭环仍需验证。",
      introduction: "把预测告警、故障知识、维修建议、备件申请和处置复盘组织为运维智能体工作流，作为现有工业数据平台的上层应用补充。",
      value: "把数据洞察从看板提醒推进到岗位可执行动作，提升运维响应和经验复用效率。",
      expectedImpact: "先验证告警解释、处置建议和知识追溯，再决定是否接入正式工单或备件系统。",
      prerequisite: "确认设备台账、历史告警、维修记录、权限边界和现场责任岗位。",
      why: "公开内容出现预测性维护和工业智能线索，适合用上层应用定制做轻量闭环验证。",
      how: "选取一个设备或产线场景，先做告警解释与知识推荐，再评估是否接入工单闭环。",
      sourceIds
    };
  }
  if (/售前|投标|交付|项目文档|方案/.test(text)) {
    return {
      priority: index === 0 ? "P0" : "P1",
      title: "售前投标与交付知识库助手",
      customerPain: basePain || "客户以项目制交付为主，方案、标书、案例和验收材料容易重复生产，且版本一致性难管。",
      introduction: "沉淀行业案例、产品能力、项目模板、验收口径和常见问答，构建面向售前和交付团队的材料生成与检索助手。",
      value: "提升方案复用率、减少材料重复劳动，并让客户案例和交付经验更容易在团队间复用。",
      expectedImpact: "先在一个行业线验证方案初稿、问答检索和验收材料生成，再扩展到投标材料库。",
      prerequisite: "提供脱敏案例、方案模板、标书目录、验收文档和权限规则。",
      why: "客户的项目和生态交付线索较强，知识库与材料助手能避开替换核心平台的风险。",
      how: "先做脱敏材料库和方案问答，再加入模板化生成、引用溯源和版本审核。",
      sourceIds
    };
  }
  if (/智能体|Agent|机理模型|HolliCube|流程智能化|上层应用/.test(text)) {
    return {
      priority: index === 0 ? "P0" : "P2",
      title: "HolliCube 上层智能体编排试点",
      customerPain: basePain || "客户已有工业平台和模型基础，但从数据服务到岗位可执行应用之间仍需要场景化编排。",
      introduction: "把 HolliCube 中的数据服务、模型能力和业务工具封装为智能体可调用能力，先做一个只读分析或辅助决策场景。",
      value: "在不替换现有平台的前提下，验证智能体对工业场景的补充价值。",
      expectedImpact: "形成一个可演示、可解释、可复用的上层应用样板。",
      prerequisite: "确认平台接口、工具调用边界、样例数据和责任岗位。",
      why: "客户已有工业平台和模型线索，智用开物更适合做上层智能体编排补充。",
      how: "先做只读查询和建议生成，再评估是否进入工具调用或流程闭环。",
      sourceIds
    };
  }
  return {
    priority: index === 0 ? "P0" : "P2",
    title: /知识|问答|数据/.test(text) ? "工业知识库与数据问答平台" : safeScenarioText(signal.title || "场景智能体轻量验证", 60),
    customerPain: basePain || safeScenarioText(signal.title || "客户场景仍需现场确认。", 180),
    introduction: safeScenarioText(signal.aiEntry || "围绕该线索做知识库、数据问答或场景智能体的轻量验证。", 260),
    value: "把公开线索转成可验证的业务场景，降低首轮交流中的方案误判。",
    expectedImpact: "形成是否进入二次交流、样例验证或正式方案的判断依据。",
    prerequisite: "确认业务负责人、样例数据、系统边界和客户侧成功指标。",
    why: "该方向来自分主题证据整理，适合作为会前假设而非正式承诺。",
    how: "先现场确认场景强度，再决定是否做轻量验证。",
    sourceIds
  };
}

function augmentScenarioPainsAndSolutions(report = {}) {
  const existingPains = arr(report.pains);
  const existingSolutions = arr(report.solutions);
  const signals = allTopicPainSignals(report)
    .filter((signal) => usefulScenarioSignalForSeller(signal, report))
    .sort((a, b) => scenarioSignalScore(b) - scenarioSignalScore(a));
  const signalPains = signals.map(painFromSignal);
  const mergedPains = mergeScenarioItemsByTheme(existingPains, signalPains, 6);
  const existingSolutionTitles = new Set(existingSolutions.map((item) => normalizeForCompare(item.title)));
  const signalSolutions = signals
    .map((signal, index) => solutionFromPainSignal(signal, index))
    .filter((item) => meaningful(item.title) && !existingSolutionTitles.has(normalizeForCompare(item.title)));
  const mergedSolutions = mergeByTitle(existingSolutions, signalSolutions, 8);
  return {
    ...report,
    pains: cleanDecisionPains(mergedPains, { report }),
    solutions: cleanDecisionSolutions(mergedSolutions, { report })
  };
}

function joinReadable(items = [], separator = "；") {
  const seen = new Set();
  const values = [];
  for (const item of arr(items)) {
    const value = cleanListItem(item);
    const key = value.replace(/\s+/g, "");
    if (!value || seen.has(key)) continue;
    seen.add(key);
    values.push(value);
  }
  return values.join(separator);
}

function joinRatingReadable(items = [], separator = "；") {
  const seen = new Set();
  const values = [];
  for (const item of arr(items)) {
    const value = cleanBusinessText(item, 180).replace(/[。；;，,\s]+$/g, "");
    const key = ratingTextKey(value);
    if (!value || seen.has(key)) continue;
    seen.add(key);
    values.push(value);
  }
  return values.join(separator);
}

function stripFieldPrefix(value, labels = []) {
  let text = compactText(value, 260);
  for (let i = 0; i < 2; i += 1) {
    const labelPattern = labels.length ? labels.join("|") : "风险|主要风险|优先切入|下一步动作|核心依据|一句话判断";
    text = text.replace(new RegExp(`^\\s*(?:${labelPattern})\\s*[：:：]\\s*`, "i"), "").trim();
  }
  return cleanBusinessText(text);
}

function meaningful(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^(?:\.{2,}|…+|选\s*\.{2,}|形成\s*\.{2,}|前置条件是\s*\.{2,}|最大交付风险是\s*\.{2,})$/.test(text)) return false;
  if (/^(待确认|暂无|无|未获取|未取得|未在已读取公开来源中取得|公开来源不足|当前来源不足)/.test(text)) return false;
  if (/^(已采集来源，待核验数值|上传年报中待人工核对|未取得可读财务硬来源)$/.test(text)) return false;
  if (isBackendRiskTemplateText(text)) return false;
  if (/信息置信度不足|企业信息不足|无法分析|无法判断|无法评估|分析不了|判断不了|没有数据|数据不足|不足以支撑|支撑不足|不能支撑|不能判断|隐藏低相关|重复或错误来源|资料有限|证据不足|以已读来源为准|未证实内容|需继续核对|用户提供线索待确认|无法给出有效判断|没有明确(?:观点|结论|依据)|没有可用(?:观点|结论|依据)|无法形成(?:有效)?(?:观点|结论|判断)|不能作为(?:有效)?(?:观点|结论|依据)|尚不足以(?:支撑|判断|分析)/.test(text)) return false;
  return true;
}

function isBackendRiskTemplateText(value = "") {
  const text = cleanBusinessText(value, 260);
  return /系统未能通过公开来源证实|未能通过公开来源证实信用|公开来源证实信用\/法律风险|建议会前核对企业信用记录/.test(text);
}

function isNonDecisionClaim(value) {
  const text = cleanBusinessText(value, 260);
  if (!meaningful(text)) return true;
  return /当前信息不足|信息不足|资料有限|证据不足|公开来源不足|来源不足|数据不足|缺少(?:财务|预算|证据|线索|数据|指标)|缺少[^，。；;]{0,18}(?:支撑|依据)|当前没有足够|没有足以|未看到足够|仍偏少|系统发现|只有单一或间接线索|线索只作为商务复核项|无法(?:评估|判断|分析|确认|锁定|给出)|无法形成|不能形成|不能锁定|不能直接(?:判|判断|评估|推断|支撑)|不足以(?:支撑|判断|分析|作为|证明)|支撑不足|不(?:构成|足以构成)(?:有效)?(?:论点|依据|判断|结论)|没有(?:明确|可用)(?:结论|观点|依据)|尚未|待确认|未证实|置信度[高中低]?|未(?:发现|取得|获取|形成|公开证实).{0,16}(?:线索|证据|来源|信息)|仍需(?:先)?(?:现场)?(?:确认|核对|厘清)|需(?:先)?(?:现场)?(?:确认|核对|厘清)|需要(?:先)?(?:现场)?(?:确认|核对|厘清)|仅供(?:参考|核对)|只能作为(?:初访)?参考|只(?:能|用于|作为).{0,18}(?:核对|复核)/.test(text);
}

function isMethodEvidenceText(value = "") {
  const text = cleanBusinessText(value, 220);
  return /可用于判断|用于判断|可用于支撑|用于支撑|用于设计|用于确定|信息可用于|线索可用于|决定首轮应|初访应|首轮应|商务推进应|售前应|后续应|建议|需(?:要)?(?:先)?|判断入口|阶段判断|变化信号|拜访含义|沟通切口|控制边界/.test(text);
}

function isConcreteHiringEvidenceText(value = "") {
  const text = cleanBusinessText(value, 260);
  if (!meaningful(text)) return false;
  if (/人才招聘|招聘信息|加入我们|join us|招聘岗位列表|职位列表/i.test(text) && !/工程师|开发|算法|数据|实施|交付|运维|测试|架构|产品经理|项目经理|销售|售前|咨询|安全|AI|大模型|MES|APS|ERP|WMS|LIMS|SCADA|岗位[:：]|职位[:：]|薪资|经验/.test(text)) return false;
  return /招聘|岗位|职位/.test(text) && /工程师|开发|算法|数据|实施|交付|运维|测试|架构|产品经理|项目经理|销售|售前|咨询|安全|AI|大模型|MES|APS|ERP|WMS|LIMS|SCADA|薪资|经验/.test(text);
}

function isStrategicHiringEvidenceText(value = "") {
  const text = cleanBusinessText(value, 300);
  if (!isConcreteHiringEvidenceText(text)) return false;
  return /招聘规模|批量招聘|大量招聘|多岗位|多个岗位|若干岗位|团队扩张|新设团队|新建团队|组织扩张|校招|社招|招聘\s*\d+\s*人|岗位\s*\d+\s*个|AI|大模型|算法|数据|架构|MES|APS|ERP|WMS|LIMS|SCADA|实施|交付|售前|咨询/.test(text);
}

function isLowValueEvidenceText(value = "") {
  const text = cleanBusinessText(value, 260);
  if (!meaningful(text)) return true;
  const genericHiring =
    /人才招聘|招聘信息|加入我们|join us|招聘岗位列表|职位列表/i.test(text) &&
    !isConcreteHiringEvidenceText(text);
  return genericHiring || /招投标查询|最新招标|今日招标|公司招投标查询|中标查询|企业黄页|采购网黄页|_招投标_|_知识产权_|企业展厅|产品中心|详情\s*-\s*|天眼查 API｜招投标|结构化数据：招投标|工商和股权信息可用于|股权信息可用于|变化信号，工商|可用于判断|用于判断|可用于支撑|用于支撑|招聘线索说明客户正在补组织|项目化采购线索说明客户可能有预算|资料中出现|资料显示|可读来源|主题覆盖|初访判断门槛/.test(text);
}

function isDeliveryEstimateText(value = "") {
  return /人天|工期|周期估算|价格估算|报价估算|预算估算|资源投入|工作量估算|粗估|粗人天|投入\s*\d+|费用区间|采购价格/.test(String(value || ""));
}

function stripLowValueDecisionFragments(value) {
  const text = cleanBusinessText(value, 320);
  if (!text) return "";
  const parts = text.match(/[^。；;]+[。；;]?/g) || [text];
  const kept = parts
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !isNonDecisionClaim(item));
  return cleanBusinessText(kept.join("").replace(/[；;，,]+$/g, ""), 260);
}

function usefulDecisionText(value) {
  const text = stripLowValueDecisionFragments(value);
  return meaningful(text) && !isNonDecisionClaim(text) ? text : "";
}

function usefulEvidenceText(value, max = 180) {
  const text = normalizeVisibleSupportText(value, max);
  return meaningful(text) && !isNonDecisionClaim(text) && !isMethodEvidenceText(text) && !isLowValueEvidenceText(text) ? text : "";
}

function sameText(a, b) {
  return String(a || "").replace(/\s+/g, "").trim() === String(b || "").replace(/\s+/g, "").trim();
}

function usefulItems(items = []) {
  return arr(items).filter((item) => {
    if (typeof item === "string") return meaningful(item);
    return [
      item?.title,
      item?.body,
      item?.summary,
      item?.insight,
      item?.sourceBasis,
      item?.reasoning,
      item?.aiEntry,
      item?.why,
      item?.how,
      item?.introduction,
      item?.solutionIntro,
      item?.value,
      ...arr(item?.facts),
      ...arr(item?.validationSignals),
      ...arr(item?.toConfirm)
    ].some(meaningful);
  });
}

function solutionValue(item = {}) {
  return compactText(item.value || item.expectedImpact || item.outcome || item.why || item.how || "用于把客户问题收敛到可验证、可推进的业务场景。", 170);
}

function solutionIntro(item = {}) {
  return compactText(
    item.introduction ||
      item.solutionIntro ||
      item.how ||
      item.body ||
      "围绕客户当前最可能成立的业务问题，先做轻量化场景验证，再决定是否进入正式方案。",
    220
  );
}

function solutionPrerequisite(item = {}) {
  return actionableDependencyText(
    item.prerequisite ||
      item.assumption ||
      arr(item.validationSignals)[0] ||
      "业务负责人、样例数据、现有系统边界和下一步动作已经锁定。",
    150
  );
}

function buildQuestionnaire(report = {}) {
  const questions = [...arr(report.requirements?.onSite), ...arr(report.requirements?.preMeeting)]
    .map((item) => compactText(item, 170))
    .filter(meaningful);
  const buckets = [
    { title: "业务问题", match: /痛点|业务|目标|效率|成本|质量|交付|工艺|销售|客户|场景|流程|产线|生产/, exclude: /营收|营业收入|净利润|利润|毛利|现金流|研发投入|预算|付款|报价|采购|决策|立项/ },
    { title: "IT与数据", match: /系统|数据|ERP|MES|PLM|QMS|接口|权限|部署|安全|样例|脱敏|知识库/ },
    { title: "预算与决策", match: /预算|报价|付款|决策|采购|负责人|角色|下一步|POC|立项|营收|营业收入|净利润|利润|毛利|现金流|研发投入/ },
    { title: "风险与边界", match: /风险|边界|合规|不能|限制|信用|法务|集团|承诺|周期/ }
  ];
  return buckets
    .map((bucket) => ({
      title: bucket.title,
      questions: questions
        .filter((item) => bucket.match.test(item) && !(bucket.exclude && bucket.exclude.test(item)))
        .slice(0, 4)
    }))
    .filter((bucket) => bucket.questions.length);
}

function buildBattleRound(report = {}, type = "pre_visit", inputText = "", previousRating = null) {
  const rating = ratingOf(report);
  const conclusions = normalizeConclusions(report);
  const fit = report.opportunityFit || {};
  const solutions = cleanDecisionSolutions(usefulItems(report.solutions), { report }, 6);
  const pains = alignPainPrioritiesWithSolutions(cleanDecisionPains(usefulItems(report.pains), { report }), solutions, 6);
  const customerSections = [
    { key: "local", title: "主体与股权/区域", items: usefulItems(report.customerInsights?.localCards) },
    { key: "market", title: "产品与客户", items: usefulItems(report.customerInsights?.groupCards) },
    { key: "business", title: "业务洞察", items: usefulItems(report.businessInsights) },
    { key: "finance", title: "财务与规模", items: usefulItems(report.customerInsights?.metrics) },
    { key: "digital", title: "数字化与AI线索", items: usefulItems(report.customerInsights?.digitalCards) },
    { key: "risk", title: "风险线索", items: usefulItems(report.sensitiveVerification?.categories).filter(hasImpactfulSensitiveRisk) }
  ].filter((section) => section.items.length);
  const sourceIds = Array.from(
    new Set([
      ...conclusions.flatMap((item) => normalizeSourceIdList(item)),
      ...pains.flatMap((item) => normalizeSourceIdList(item)),
      ...solutions.flatMap((item) => normalizeSourceIdList(item))
    ])
  ).slice(0, 8);
  const roundChanges =
    type === "post_visit"
      ? arr(report.changeSummary).filter((item) => !/商机评级由|信息尚不足以改变|尚不足以改变评级|没有产生实质变化/.test(String(item || "")))
      : ["已完成会前研判，建议带着方案假设和问题清单进入首次拜访。"];
  const changeSummary =
    type === "post_visit"
      ? Array.from(
          new Set(
            [
              ...roundChanges
            ].filter(Boolean)
          )
        ).slice(0, 8)
      : roundChanges;
  return {
    roundNo: 1,
    type,
    inputText: type === "post_visit" ? inputText : "",
    inputSummary: type === "post_visit" ? feedbackNeedSummary(inputText) || compactText(inputText, 260) : "首轮会前公开信息研判。",
    generatedAt: report.updatedAt || report.generatedAt || new Date().toISOString(),
    opportunityRating: rating,
    conclusions,
    customerInfo: customerSections,
    painsAndOpportunities: pains.map((item) => cleanRoundTextItem({
      priority: item.priority,
      title: item.title || "痛点机会",
      customerSignal: item.sourceBasis || item.basis || arr(item.facts)[0] || item.reasoning || evidenceTextFromSources(report, item),
      pain: item.reasoning || item.body || item.insight || item.basis || evidenceTextFromSources(report, item),
      opportunity: item.aiEntry || item.opportunity || arr(fit.entryScenarios)[0] || "",
      toConfirm: arr(item.validationSignals || item.toConfirm),
      sourceIds: normalizeSourceIdList(item)
    })),
    solutionCards: solutions.map((item) => cleanRoundTextItem({
      priority: item.priority || "P1",
      title: item.title || "建议方案",
      customerPain: item.customerPain || item.why || item.sourceBasis || "",
      introduction: solutionIntro(item),
      value: solutionValue(item),
      expectedImpact: item.expectedImpact || item.outcome || item.why || "",
      prerequisite: solutionPrerequisite(item),
      body: item.how || item.body || "",
      sourceIds: normalizeSourceIdList(item)
    })),
    salesThesis: report.salesThesis || null,
    solutionStrategy: report.solutionStrategy || null,
    deliveryAssessment: report.deliveryAssessment || null,
    questionnaire: buildQuestionnaire(report),
    internalNotes: [
      ...arr(fit.noCommitments).map((item) => `承诺边界：${item}`),
      ...arr(rating?.riskFlags).map((item) => `风险关注：${item}`)
    ].filter(isActionableInternalNote).slice(0, 10),
    sourceIds,
    changeSummary,
    roundDelta: type === "post_visit" ? report.roundDelta || null : null
  };
}

function evidenceTextFromSources(report = {}, item = {}) {
  const ids = normalizeSourceIdList(item);
  if (!ids.length) return "";
  const sources = arr(report.sources);
  const titles = ids
    .map((id) => sources.find((source) => Number(source.sourceId) === Number(id)))
    .filter(Boolean)
    .map((source) => source.title || source.usedFor || source.relevanceReason || "")
    .filter(meaningful)
    .slice(0, 2);
  return titles.length ? `依据来源：${titles.join("；")}` : "";
}

function isActionableInternalNote(value) {
  const text = cleanInternalNote(value);
  if (!meaningful(text)) return false;
  if (/信息缺口|信息不足|置信度|无法分析|来源不足|待确认|隐藏低相关|重复|错误来源/.test(text)) return false;
  if (/线索只作为商务复核项|线索需按公开平台复核|只有单一或间接线索|系统发现信用|未形成正文结论/.test(text)) return false;
  return /承诺边界|风险关注|付款|信用|法务|诉讼|被执行|回款|预算|决策|采购|集团|IT|数据|合规|边界|周期|免费|POC|供应商|既有系统/.test(text);
}

function cleanInternalNote(value) {
  return compactText(value, 240)
    .replace(/^不建议承诺[：:]\s*/g, "承诺边界：")
    .replace(/^不建议承诺/g, "承诺边界：")
    .replace(/^(不建议承诺|风险关注|主要风险)[：:]\s*(?:\1[：:]?\s*)+/, "$1：")
    .replace(/^(承诺边界)[：:]\s*(?:\1[：:]?\s*)+/, "$1：")
    .replace(/^风险[：:]\s*风险[：:]\s*/, "风险：")
    .trim();
}

function roundPainFromReportPain(report = {}, item = {}) {
  return cleanRoundTextItem({
    priority: explicitPriorityLabel(item.priority),
    title: item.title || "痛点机会",
    customerSignal: item.sourceBasis || item.basis || arr(item.facts)[0] || item.reasoning || evidenceTextFromSources(report, item),
    pain: item.reasoning || item.body || item.insight || item.basis || evidenceTextFromSources(report, item),
    opportunity: item.aiEntry || item.opportunity || arr(report.opportunityFit?.entryScenarios)[0] || "",
    toConfirm: arr(item.validationSignals || item.toConfirm),
    sourceIds: normalizeSourceIdList(item)
  });
}

function roundSolutionFromReportSolution(item = {}, index = 0) {
  return cleanRoundTextItem({
    priority: normalizePriorityLabel(item.priority, index),
    title: item.title || "建议方案",
    customerPain: item.customerPain || item.why || item.sourceBasis || "",
    introduction: solutionIntro(item),
    value: solutionValue(item),
    expectedImpact: item.expectedImpact || item.outcome || item.why || "",
    prerequisite: solutionPrerequisite(item),
    body: item.how || item.body || "",
    sourceIds: normalizeSourceIdList(item)
  });
}

function normalizeExistingRound(report, round = {}, index = 0) {
  const feedback = round.type === "post_visit" ? feedbackSignalPack(round.inputText || round.inputSummary) : { hasActionable: false };
  const changeSummary = feedback.hasActionable
    ? mergeByTitle(
        feedback.changeSummary,
        arr(round.changeSummary).filter((item) => !/商机评级由|信息尚不足以改变|尚不足以改变评级|没有产生实质变化/.test(String(item || ""))),
        8
      )
    : arr(round.changeSummary);
  const reportPainFallback = cleanDecisionPains(arr(report.pains), { report, round }).map((item) => roundPainFromReportPain(report, item));
  const rawSourceFallback = feedback.hasActionable
    ? mergeByTitle(
        feedback.pains.map((item) => ({
          priority: explicitPriorityLabel(item.priority),
          title: item.title,
          customerSignal: item.sourceBasis,
          pain: item.reasoning,
          opportunity: item.aiEntry,
          toConfirm: item.validationSignals,
          sourceIds: []
        })),
        round.painsAndOpportunities,
        8
      )
    : mergeScenarioItemsByTheme(arr(round.painsAndOpportunities), reportPainFallback, 6);
  const reportSolutionFallback = cleanDecisionSolutions(arr(report.solutions), { report, round })
    .map((item, solutionIndex) => roundSolutionFromReportSolution(item, solutionIndex));
  const rawSolutions = feedback.hasActionable
    ? mergeByTitle(feedback.solutions, round.solutionCards, 8)
    : mergeByTitle(round.solutionCards, reportSolutionFallback, 6);
  const normalizedRawSolutions = cleanDecisionSolutions(rawSolutions, { report, round });
  const sourceFallback = alignPainPrioritiesWithSolutions(rawSourceFallback, normalizedRawSolutions, 8);
  const solutionCards = normalizedRawSolutions.map((item, solutionIndex) => {
    const sourcePain = relatedPainForSolution(item, sourceFallback, solutionIndex);
    const customerPain = compactText(item.customerPain || item.pain || item.sourceBasis || sourcePain.pain || item.why, 260);
    const introduction = solutionIntro(item);
    let value = compactText(item.value || item.solutionValue || item.why || item.how || item.body, 240);
    const expectedImpact = compactText(item.expectedImpact || item.impact || item.outcome, 220);
    if (sameText(value, customerPain)) value = compactText(item.body || item.how || item.expectedImpact, 220);
    return cleanRoundTextItem({
      ...cleanRoundTextItem(item),
      priority: normalizePriorityLabel(item.priority, solutionIndex),
      customerPain,
      introduction,
      value,
      expectedImpact,
      prerequisite: solutionPrerequisite(item),
      sourceIds: normalizeSourceIdList(item)
    });
  });
  const customerInfo = arr(round.customerInfo)
    .map(cleanRoundSection)
    .filter((section) => arr(section.items).length);
  const businessSectionIndex = customerInfo.findIndex((section) => {
    const label = `${section.key || ""} ${section.title || ""}`;
    return /business|业务洞察|产品平台|客户案例|项目案例|生态|交付线索/.test(label);
  });
  const businessItems = usefulItems(round.businessInsights || report.businessInsights).slice(0, 12);
  if (businessSectionIndex >= 0 && businessItems.length) {
    customerInfo[businessSectionIndex] = {
      ...customerInfo[businessSectionIndex],
      key: customerInfo[businessSectionIndex].key || "business",
      title: customerInfo[businessSectionIndex].title || "业务洞察",
      items: mergeByTitle(arr(customerInfo[businessSectionIndex].items), businessItems, 12)
    };
  } else if (businessItems.length) {
    customerInfo.splice(Math.min(customerInfo.length, 2), 0, {
      key: "business",
      title: "业务洞察",
      items: businessItems.map(cleanRoundTextItem)
    });
  }

  return {
    ...round,
    roundNo: Number(round.roundNo || index + 1),
    generatedAt: round.generatedAt || report.updatedAt || report.generatedAt || new Date().toISOString(),
    conclusions: (feedback.hasActionable ? mergeByTitle(feedback.conclusions, round.conclusions, 8) : arr(round.conclusions)).map((item) => ({
      ...cleanRoundTextItem(item),
      body: stripFieldPrefix(item.body || item.summary || item.insight, [item.title, "风险", "主要风险", "优先切入", "下一步动作", "核心依据"]).trim()
    })),
    customerInfo,
    painsAndOpportunities: usefulItems(sourceFallback.map(cleanRoundTextItem)),
    solutionCards: usefulItems(solutionCards),
    salesThesis: round.salesThesis || report.salesThesis || null,
    solutionStrategy: round.solutionStrategy || report.solutionStrategy || null,
    deliveryAssessment: round.deliveryAssessment || report.deliveryAssessment || null,
    questionnaire: arr(round.questionnaire)
      .map((group) => ({ ...group, questions: arr(group.questions).map((item) => compactText(item, 180)).filter(meaningful) }))
      .filter((group) => arr(group.questions).length),
    internalNotes: (feedback.hasActionable ? mergeByTitle(feedback.internalNotes, round.internalNotes, 8) : arr(round.internalNotes))
      .map(cleanInternalNote)
      .filter(isActionableInternalNote)
      .slice(0, 8),
    sourceIds: Array.from(new Set(arr(round.sourceIds).map((item) => Number(item)).filter(Number.isFinite))).slice(0, 12),
    changeSummary,
    roundDelta: feedback.hasActionable ? { ...(round.roundDelta || {}), ...feedback } : round.roundDelta || null
  };
}

export function ensureReportRounds(report = {}) {
  const existing = arr(report.rounds);
  if (existing.length) {
    const rounds = existing.map((round, index) => normalizeExistingRound(report, round, index));
    const activeRoundNo = Number(report.activeRoundNo || rounds[rounds.length - 1].roundNo);
    return { ...report, reportMode: "battleBrief", rounds, activeRoundNo };
  }
  const round = buildBattleRound(report, "pre_visit");
  return { ...report, reportMode: "battleBrief", rounds: [round], activeRoundNo: 1 };
}

export function appendPostVisitRound(currentReport = {}, updatedReport = {}, inputText = "") {
  const current = ensureReportRounds(currentReport);
  const next = ensureReportRounds({
    ...updatedReport,
    rounds: current.rounds,
    activeRoundNo: current.activeRoundNo
  });
  const previousRating = arr(current.rounds).at(-1)?.opportunityRating || current.opportunityRating || null;
  const round = {
    ...buildBattleRound(next, "post_visit", inputText, previousRating),
    roundNo: arr(current.rounds).length + 1,
    generatedAt: next.updatedAt || new Date().toISOString()
  };
  return {
    ...next,
    reportMode: "battleBrief",
    rounds: [...arr(current.rounds), round],
    activeRoundNo: round.roundNo,
    userSupplementInsights: [...arr(current.userSupplementInsights), ...arr(next.userSupplementInsights)].slice(-12),
    changeSummary: round.changeSummary,
    updatedSections: ["拜访反馈", "结论与建议", "行动指南", "配套解决方案", "拜访问卷", "内部注意事项"]
  };
}

export function normalizeReportShape(report = {}) {
  const sanitized = sanitizeReportDecisionData(sanitizeRequirements(report));
  const normalized = ensureFinancialMetrics(sanitized, arr(sanitized.sources), sanitized);
  const annualReportEvidence = normalized.annualReportEvidence
    ? {
        ...normalized.annualReportEvidence,
        metrics: repairFinancialMetricsFromAnnual(normalized, arr(normalized.annualReportEvidence.metrics))
      }
    : normalized.annualReportEvidence;
  const fixedNormalized = {
    ...normalized,
    annualReportEvidence,
    customerInsights: {
      ...(normalized.customerInsights || {}),
      metrics: repairFinancialMetricsFromAnnual(
        { ...normalized, annualReportEvidence },
        arr(normalized.customerInsights?.metrics)
      )
    }
  };
  const scenarioAugmented = augmentScenarioPainsAndSolutions(fixedNormalized);
  const explicitBusinessInsights = usefulItems(scenarioAugmented.businessInsights);
  const derivedBusinessInsights = deriveBusinessInsightsFromSources(scenarioAugmented.sources);
  const thematicBusinessInsights = derivedBusinessInsights.filter((item) => /线索/.test(item.title || ""));
  const shaped = {
    ...scenarioAugmented,
    annualReportEvidence,
    quickCards: normalizeQuickCards(scenarioAugmented),
    conclusions: normalizeConclusions(scenarioAugmented),
    businessInsights: explicitBusinessInsights.length
      ? mergeByTitle(explicitBusinessInsights, thematicBusinessInsights, 12)
      : derivedBusinessInsights,
    customerInsights: {
      ...(scenarioAugmented.customerInsights || {}),
      localCards: arr(scenarioAugmented.customerInsights?.localCards),
      groupCards: arr(scenarioAugmented.customerInsights?.groupCards),
      metrics: arr(scenarioAugmented.customerInsights?.metrics),
      digitalCards: arr(scenarioAugmented.customerInsights?.digitalCards)
    }
  };
  const guarded = ensureReportRounds(applyFreshnessGuardrails(sanitizeReportDecisionData(shaped)));
  const roundsWithStrategy = arr(guarded.rounds).map((round) => {
    const nextRound = { ...round };
    const cleanedStrategy = cleanStrategyData(nextRound.solutionStrategy, { report: guarded, round: nextRound });
    const cleanedDelivery = cleanDeliveryData(nextRound.deliveryAssessment, { report: guarded, round: nextRound });
    nextRound.solutionStrategy = hasUsefulStrategy(cleanedStrategy) ? cleanedStrategy : buildSolutionStrategy(guarded, nextRound);
    nextRound.deliveryAssessment = hasUsefulDelivery(cleanedDelivery) ? cleanedDelivery : buildDeliveryAssessment(guarded, nextRound);
    return {
      ...nextRound,
      solutionStrategy: cleanStrategyData(nextRound.solutionStrategy, { report: guarded, round: nextRound }),
      deliveryAssessment: cleanDeliveryData(nextRound.deliveryAssessment, { report: guarded, round: nextRound }),
      painsAndOpportunities: cleanDecisionPains(nextRound.painsAndOpportunities, { round: nextRound, report: guarded }),
      solutionCards: cleanDecisionSolutions(nextRound.solutionCards, { round: nextRound, report: guarded }),
      conclusions: cleanDecisionCardItems(nextRound.conclusions, 8),
      customerInfo: arr(nextRound.customerInfo).map(cleanRoundSection).filter((section) => arr(section.items).length),
      internalNotes: arr(nextRound.internalNotes).map(cleanInternalNote).filter(isActionableInternalNote)
    };
  });
  const active =
    roundsWithStrategy.find((round) => Number(round.roundNo) === Number(guarded.activeRoundNo)) ||
    roundsWithStrategy[0] ||
    {};
  const withStrategicViews = {
    ...guarded,
    rounds: roundsWithStrategy,
    solutionStrategy: (() => {
      const cleaned = cleanStrategyData(guarded.solutionStrategy || active.solutionStrategy, { report: guarded, round: active });
      return hasUsefulStrategy(cleaned) ? cleaned : cleanStrategyData(buildSolutionStrategy(guarded, active), { report: guarded, round: active });
    })(),
    deliveryAssessment: (() => {
      const cleaned = cleanDeliveryData(guarded.deliveryAssessment || active.deliveryAssessment, { report: guarded, round: active });
      return hasUsefulDelivery(cleaned) ? cleaned : cleanDeliveryData(buildDeliveryAssessment(guarded, active), { report: guarded, round: active });
    })()
  };
  return sanitizeReportDecisionData(withStrategicViews);
}

async function analyzeTopic(company, topic, sources, onModelAttempt = async () => {}) {
  const topicSources = sources.filter((source) => source.topic === topic || source.query?.includes(topic));
  const pack = buildSourcePack(topicSources.length ? topicSources : sources, 8, 2200);
  if (!pack.length) {
    return { topic, facts: [], metrics: [], implications: [], painSignals: [], uncertainties: ["本主题未形成可用观点。"], sourceIds: [] };
  }
  const financeInstruction =
    topic === TOPIC_NAMES[1]
      ? `经营规模与财务主题强制要求：metrics 必须优先提取营业收入/净销售额、净利润或归母净利润、毛利率或经营利润率、经营现金流、资产负债率或总资产负债、研发投入、员工规模、客户集中度。若来源没有对应财务数据，不要补占位指标；只输出能支撑买单能力、经营状态或风险判断的指标。`
      : "";
  const messages = [
    {
      role: "system",
      content: "你是售前客户研究分析师。只返回严格 JSON，不要 Markdown。所有判断必须基于给定来源；无法形成有用观点时不要硬写结论，把缺口转为现场问题或内部边界。"
    },
    {
      role: "user",
      content: `请针对主题“${topic}”提取可用于商机判断的证据，写给一线会前准备使用，避免空话。${financeInstruction}
企业信息：${JSON.stringify(company, null, 2)}
敏感信息核验结果：${JSON.stringify(company.sensitiveVerification || {}, null, 2)}
来源：${JSON.stringify(pack, null, 2)}
业务洞察规则：除“企业主体与本地信息”外，不要用工商登记、股权、注册资本这类主体核验来源单独推导业务痛点。产品/客户/数字化/痛点主题要优先使用官网产品、客户案例、项目新闻、招聘、专利、招投标、行业背景来源；弱线索可用于提出现场验证问题。
业务细节保留规则：如果来源中出现具体产品、系统、平台、客户、项目或生态词，例如 MES、APS、ERP、SAP、WMS、LIMS、EAM、QMS、AIOps、HolliCube、HolliMES、HolliEMS、数字化工厂、客户案例、生态伙伴、能力中心、产品手册、部署周期、项目交付，摘要必须保留这些原词，不能只写“数字化能力较强”。
敏感信息规则：涉及限制高消费、失信、被执行、诉讼、合同纠纷、回款困难、股权控制、融资、财务指标等内容时，只能使用敏感信息核验结果和直接来源。未证实线索不得写成事实或风险结论，也不要包装成“风险不足以证实”的无效论点。
时间新鲜度规则：必须区分“网页发布时间”和“事实/财务数据期”。超过12个月的财务、利润、亏损、现金流、预算线索只能作为背景事实或商务核对问题，不得直接推断当前预算收紧、付款困难或投入不足。母公司/集团数据只能作为间接线索，不能替代目标客户自身判断。
返回 JSON：
{
  "topic": "${topic}",
  "facts": [{"claim":"可核验事实或第三方线索","sourceIds":[1,2],"confidence":"公开信息/第三方线索/合理推断/现场问题"}],
  "metrics": [{"label":"指标","value":"数值或区间","sourceIds":[1],"note":"说明"}],
  "implications": [{"title":"关键信息","body":"这说明客户可能处于什么经营压力或机会中","sourceIds":[1]}],
  "painSignals": [{"title":"潜在痛点","basis":"依据","validationSignals":["现场可确认的指标口径"],"aiEntry":"AI切入方向","sourceIds":[1]}],
  "uncertainties": ["现场要问清的问题"],
  "sourceIds": [1,2,3]
}`
    }
  ];
  try {
    const answer = await callModel(messages, {
      runtimeMode: company.runtimeMode,
      temperature: 0.1,
      maxTokens: 3600,
      timeoutMs: 180000,
      totalTimeoutMs: 210000,
      headerTimeoutMs: 30000,
      firstTokenTimeoutMs: 90000,
      streamIdleTimeoutMs: 45000,
      streamMaxMs: 180000,
      onAttempt: onModelAttempt
    });
    return { ...extractJson(answer.content), _modelName: answer.model, _modelChannel: answer.channel };
  } catch (error) {
    return {
      topic,
      facts: [],
      metrics: [],
      implications: [],
      painSignals: [],
      uncertainties: [`${topic} 分析失败：${error?.message || String(error)}`],
      sourceIds: []
    };
  }
}

function finalPrompt(company, sourcePack, topicBriefs, quality) {
  const aiNeeds = String(company.aiNeeds || company.userContext?.aiNeeds || "").trim();
  const sellerProfile = company.sellerProfileSnapshot || null;
  const businessInsightPack = buildBusinessInsightPack(sourcePack);
  const qualityInstruction =
    quality.qualityLevel === "limited"
      ? "本次来源较少，只输出有证据或用户线索支撑的观点；缺失内容不生成空卡，转入拜访问卷或内部边界。"
      : quality.qualityLevel === "brief"
        ? "本次来源达到简版报告门槛但不足正式报告门槛。未被来源支撑的内容不要写成观点，只写成现场问题或内部边界。"
        : "本次来源达到正式报告门槛。观点必须有明确依据；不要用“无法判断”凑栏目。";

  return `请基于“我的企业信息”“分主题证据摘要”“业务洞察包”和“可校验来源清单”生成深度商机挖掘报告 JSON。报告给销售和售前会前准备使用，必须采用金字塔结构：最上层先给行动结论，再逐层拆解预算/决策链/运作打法/痛点方案/落地路径。
质量约束：${qualityInstruction}
我的企业信息：${JSON.stringify(sellerProfile || {}, null, 2)}
敏感信息核验结果：${JSON.stringify(company.sensitiveVerification || {}, null, 2)}
硬性要求：
1. 语言直接、专业、可外发；不要出现内部保护、责任归因、渠道身份标签或先免费验证等不适合外发的表达。
2. 不把推断写成事实；前台只输出对销售/售前/交付有行动价值的观点，缺少依据的内容不要凑成结论。
2a. 所有结论、分论点和支撑判断都必须是“明确观点句 + 明确论据”。不要把“没有数据、无法判断、证据不足、需进一步核对、数据不足以支撑”写成论点；没有可用观点就不要输出该项，宁可缺省也不要生成无效信息。
3. 经营痛点必须写依据来源，不能只写行业常识。
3a. sourceType 为“线索来源/弱线索来源/行业背景来源”或 confidence 为“低”的资料，只能用于线索提示和现场问题；不得单独支撑确定性结论。
3b. 限制高消费、失信、被执行、诉讼、合同纠纷、回款困难、股权控制、融资、营收、利润、客户名单、重大项目、政府补贴等敏感/重要信息，必须以“敏感信息核验结果”为准。未证实或冲突的信息不得进入研究结论，也不要写成无效风险提示。
3c. 时间新鲜度必须按事实数据期判断，不按网页发布时间判断。财务/预算/亏损/现金流等数据超过12个月时，只能作为历史背景或现场核对问题，不得写成当前主要风险；母公司、集团或股东层面的数据只能作为间接线索，不得直接推断目标客户当前预算收紧。若存在更新的融资、IPO辅导、扩产、招聘、营收增长等信号，必须平衡表达。
4. 研究结论必须是多卡片，不要大段文字。
5. 客户画像必须分成多框：主体与股权/区域、产品与客户、经营规模与财务、数字化与AI、组织与决策、潜在采购约束。
6. 不要生成 sources 字段。来源由系统用真实 URL 补入；但所有关键结论、画像卡片、财务指标、痛点和方案必须尽量带 sourceIds，用于在正文旁展示证据链接。
7. 用户输入的 AI 需求属于“用户提供线索”，优先用于调整切入方向和现场确认问题，但不得写成公开事实。
7a. 所有“切入点、方案建议、是否值得跟进”必须结合我的企业信息。不得默认我方一定是智用开物，也不得提出我方能力之外的重交付承诺。
7b. solutions 必须写成面向客户交流的完整方案包，不能直接复制 pains 的标题。只输出由实际证据、用户线索或我方能力匹配支撑的方案，通常 2-5 个；每个方案都要包含客户痛点、方案介绍、我方价值、预期成效和适用前提。
7c. 我的企业信息里的“核心产品/服务、典型场景、历史案例”是能力边界和可参考经验，不是固定产品清单。方案应来自“我方能力范围 × 目标客户场景证据/用户反馈”的交集。
7d. 不得因为我方做过排产、追溯、知识库、视觉、设备、零部件等，就默认目标客户需要同类方案；也不得因为这是我方能力就一概排除。只有目标客户资料或用户反馈出现对应痛点、项目、采购、系统、流程或场景时，才可提出该类具体方案；否则应抽象成能力适配、轻量验证或现场问题。
7e. 如果目标客户本身是软件商、集成商、设备商或方案提供商，要区分“客户对外服务的产品/案例”和“客户自己作为甲方要采购/改造的需求”。对外交付案例只能用于理解客户业务和生态合作可能，不能直接推断其内部采购需求。
8. customerInsights.metrics 必须先呈现财务硬指标：营业收入/净销售额、净利润或归母净利润、毛利率或经营利润率、经营现金流、资产负债率或总资产负债、研发投入、员工规模、客户集中度。若来源没有对应数据，不要生成占位指标；不要写“未取得”“待核验”类空信息。
9. 若企业信息包含 stockCode 或来源包含“财务硬来源”，必须优先使用财务硬来源抽取指标；不得笼统写“公开来源未采集到财务数据”，必须说明已查来源与缺失原因。
10. 若企业信息包含 annualReportEvidence，必须把它作为用户上传年报证据使用，优先级高于第三方网页；引用时写“用户上传年报”并保留页码或章节。
11. 若已包含 annualReportEvidence，requirements 里不得再写“下载/补充/获取最新年报”；只能写“核对年报第几页指标口径”或“确认业务口径”。
12. requirements 里不要要求一线“通过公开渠道查询 ERP/MES/PLM 供应商、工商、招聘、官网、B2B 平台”等本系统应检索的事项；如果公开检索没有结果，写成“现场确认”问题。
13. quickCards 必须严格返回 4 个对象，标题分别为：客户是谁、客户卖什么、有没有钱、先切哪里。
14. conclusions 必须严格返回 5 个对象，标题分别为：一句话判断、优先切入、核心依据、主要风险、下一步建议。
15. “主要风险”必须写商机风险：预算/付款/决策链/既有供应商/合规信用/集团IT边界/证据缺口/需求成熟度等；不要写“需求未确认、系统边界不清、数据授权不明确”这类通用句。
16. opportunityFit 必须返回“我方能力匹配”模块：能力契合点、可切入场景、不建议承诺事项、会前验证问题。若我的企业信息为空或过少，不要凑判断，只保留最小化现场问题。
17. 必须使用“业务洞察包”提炼 businessInsights。工商/主体核验资料只用于身份、股权、风险和决策链；不得单独支撑业务痛点。业务痛点和方案优先从官网产品、客户案例、项目新闻、招聘、专利、招投标、行业背景中提炼。
18. 若业务洞察包包含产品平台、案例、生态伙伴、系统集成、投标/售前、项目交付等线索，必须在客户信息、痛点或方案中体现；若只是弱线索，转为现场问题，不要删除。
18a. 对业务洞察包中出现的具体产品/平台/系统/客户名必须保留原词，例如 MES、APS、ERP、SAP、WMS、LIMS、EAM、QMS、AIOps、HolliCube、HolliMES、HolliEMS、客户案例、标杆项目、生态伙伴、能力中心、产品手册等；不得只概括成“数字化能力”。
18b. 如果业务洞察包里出现“生态/伙伴/集成线索”“ERP/SAP/WMS/LIMS 对接线索”“AIOps/工业数据线索”“交付/实施/售前效率线索”，必须在 businessInsights、pains 或 solutions 中至少承接到对应判断；没有证据时不要编造，只写成待验证问题。
18c. businessInsights 应优先输出 6-9 个有信息量的业务洞察卡片。只要来源支持，就要覆盖产品平台、客户案例、系统集成、生态伙伴/能力中心、招投标/售前、项目交付、技术/IP、组织能力。不允许把这些合并成一个笼统卡片。
18d. solutions 不只写“能做 AI”，要体现“客户场景 -> 方案介绍 -> 价值 -> 成效 -> 前提”。若来源包含产品手册、部署周期、价格区间或系统集成信息，应转化为方案边界和切入建议。
19. salesThesis 必须站在销售视角回答四个问题：这个客户是否值得继续跟；有没有预算/买单能力；决策链和拍板路径可能在哪里；如果想成单应该怎么运作。必须先按维度收集证据，再形成观点，不能先写观点再硬配论据；采购能力只能用企业规模、财务/融资、客户作为甲方的招采/采购记录支撑；客户对外交付案例只能用于理解业务场景，不能证明客户有采购能力、采购习惯、同类项目采购或竞品供应商。
20. solutionStrategy 必须站在售前视角回答四个问题：客户现状与问题；总体解决思路；分项方案优先级；落地路径。不要只列产品名，要把客户现状、痛点、方案价值和推进路径串起来。
21. deliveryAssessment 必须站在交付视角做初步评估：技术路径、交付依赖、主要交付风险、应对方案和SOW分解。交付页只展示 SOW分解、风险与应对、前置依赖三类；风险和应对必须绑定成同一张表，不要拆成两个模块；前置依赖只写技术条件（数据、接口、权限、安全、部署、验收口径），不要写锁定负责人、会后更新、开场切入等非技术废话。不要输出资源数量、人天、工期或价格估算；本阶段只按功能模块/工作项拆分，不要按需求澄清、原型验证、上线运营这类实施流程拆分；每个工作包尽量拆到“一级功能模块/二级功能项”，不能承诺未锁定的接口、数据、周期和效果。
22. 拜访问卷必须随“我的企业信息”变化。若我的企业不是软件/IT/数字化服务商，不要默认生成 IT/数据/系统类问题；应围绕我方主营业务和核心产品生成业务场景、产品技术匹配、采购交付、质量/合规/付款等问题。

企业信息：${JSON.stringify(company, null, 2)}
用户已掌握的 AI 需求线索：${aiNeeds || "无"}
分主题证据摘要：${JSON.stringify(topicBriefs, null, 2)}
业务洞察包：${JSON.stringify(businessInsightPack, null, 2)}
可校验来源清单：${JSON.stringify(sourcePack.map(({ text, ...source }) => source), null, 2)}

必须返回以下 JSON：
{
  "standardName": "企业标准名",
  "aliases": ["别名"],
  "region": "地区",
  "industry": "行业",
  "quickCards": [
    {"title":"客户是谁","body":"短句","insight":"关键信息","sourceIds":[1]},
    {"title":"客户卖什么","body":"短句","insight":"关键信息","sourceIds":[1]},
    {"title":"有没有钱","body":"短句","insight":"关键信息","sourceIds":[1]},
    {"title":"先切哪里","body":"短句","insight":"关键信息","sourceIds":[1]}
  ],
  "conclusions": [
    {"title":"一句话判断","body":"结论内容","sourceIds":[1,2]},
    {"title":"优先切入","body":"结论内容","sourceIds":[1,2]},
    {"title":"核心依据","body":"结论内容","sourceIds":[1,2]},
    {"title":"主要风险","body":"结论内容","sourceIds":[1,2]},
    {"title":"下一步建议","body":"结论内容","sourceIds":[1,2]}
  ],
  "customerInsights": {
    "localCards": [{"title":"主体与股权/区域","facts":["依据"],"insight":"判断","toConfirm":["现场问题"],"sourceIds":[1]}],
    "groupCards": [{"title":"产品与客户/集团与行业背景","facts":["依据"],"insight":"判断","toConfirm":["现场问题"],"sourceIds":[2]}],
    "metrics": [{"label":"指标","value":"数值","note":"说明和来源口径","sourceIds":[3]}],
    "digitalCards": [{"title":"数字化与AI/组织与决策/潜在采购约束","facts":["依据"],"insight":"判断","toConfirm":["现场问题"],"sourceIds":[4]}]
  },
  "businessInsights": [{"title":"业务洞察主题","body":"基于业务来源提炼的客户业务、产品平台、项目案例、生态交付或组织能力判断","sourceIds":[1,2],"confidence":"公开信息/第三方线索/弱线索/现场问题"}],
  "salesThesis": {"summary":"给销售看的总判断","worthFollowing":"是否值得继续跟及理由","budgetJudgment":"预算/买单能力判断及依据","decisionPath":"决策链/拍板路径判断及依据","operatingAdvice":"想成单应该怎么运作"},
  "opportunityFit": {"summary":"基于我的企业信息的匹配判断","fitPoints":["能力契合点"],"entryScenarios":["可切入场景"],"noCommitments":["不建议承诺事项"],"validationQuestions":["会前验证问题"]},
  "pains": [{"title":"经营痛点","sourceBasis":"具体来源和依据","reasoning":"痛点推导","validationSignals":["现场可确认的指标口径"],"aiEntry":"AI切入方向","sourceIds":[1,2]}],
  "solutions": [{"priority":"P1/P2/P0","title":"方案","customerPain":"客户痛点","introduction":"方案介绍","value":"方案价值","expectedImpact":"预期成效","prerequisite":"适用前提","why":"优先级理由","how":"做法","sourceIds":[1,2]}],
  "solutionStrategy": {"currentSituation":"客户现状与问题","overallApproach":"总体解决思路","rankedSolutions":[{"priority":"P0","title":"方案标题","why":"排序理由"}],"implementationPath":["第一步","第二步","第三步"]},
  "deliveryAssessment": {"architectureSketch":"技术路径","deliveryRisks":["交付风险"],"dependencies":["交付依赖"],"sowOutline":["按功能项拆分的SOW工作包，写到一级工作包和二级工作项，不写人天/工期/价格"]},
  "requirements": {"preMeeting":["会前尽量了解"],"onSite":["现场顺势探问"]},
  "keywords": ["用于模糊搜索的关键词"]
}`;
}

function firstTexts(items = [], key = "claim", limit = 4) {
  return arr(items)
    .map((item) => (typeof item === "string" ? item : item?.[key] || item?.title || item?.body || item?.note || ""))
    .filter(Boolean)
    .slice(0, limit);
}

function topicBrief(topicBriefs = [], topicName = "") {
  return arr(topicBriefs).find((item) => item?.topic === topicName) || {};
}

function buildFallbackStructuredReport(company, sourcePack, topicBriefs, quality, error) {
  const standardName = company.standardName || company.name || company.query || "未命名企业";
  const subject = topicBrief(topicBriefs, TOPIC_NAMES[0]);
  const finance = topicBrief(topicBriefs, TOPIC_NAMES[1]);
  const market = topicBrief(topicBriefs, TOPIC_NAMES[2]);
  const digital = topicBrief(topicBriefs, TOPIC_NAMES[3]);
  const pain = topicBrief(topicBriefs, TOPIC_NAMES[4]);
  const metrics = firstTexts(finance.metrics, "value", 8).length
    ? arr(finance.metrics).slice(0, 8)
    : [];
  const fallbackWarning = `最终整合未完整完成，系统已用分主题证据生成结构化简报：${error?.message || String(error)}`;
  return {
    standardName,
    aliases: company.aliases || [],
    region: company.region || "",
    industry: company.industry || "",
    quickCards: [
      { title: "客户是谁", body: firstTexts(subject.facts, "claim", 1)[0] || `${standardName}，主体信息需结合来源继续核对。`, insight: "来自已读取来源的保底摘要。", sourceIds: arr(subject.sourceIds).slice(0, 2) },
      { title: "客户卖什么", body: firstTexts(market.facts, "claim", 1)[0] || "产品和客户结构需现场确认。", insight: "优先看产品客户与市场压力来源。", sourceIds: arr(market.sourceIds).slice(0, 2) },
      { title: "有没有钱", body: firstTexts(finance.metrics, "value", 1)[0] || "财务指标需核对。", insight: "优先使用年报、公告或财务硬来源。", sourceIds: arr(finance.sourceIds).slice(0, 2) },
      { title: "先切哪里", body: firstTexts(pain.painSignals, "aiEntry", 1)[0] || "先从客户已提需求和可验证小场景切入。", insight: "保底版不输出无证据强结论。", sourceIds: arr(pain.sourceIds).slice(0, 2) }
    ],
    conclusions: [
      { title: "一句话判断", body: "本次已完成证据采集和分主题整理，但最终整合模型超时；建议将本报告作为会前参考继续核对。", sourceIds: [] },
      { title: "优先切入", body: firstTexts(pain.painSignals, "aiEntry", 1)[0] || company.aiNeeds || "围绕客户已知需求线索做轻量验证。", sourceIds: arr(pain.sourceIds).slice(0, 2) },
      { title: "核心依据", body: `已形成 ${sourcePack.length} 条来源证据池，其中结论只使用可追溯来源。`, sourceIds: sourcePack.slice(0, 3).map((item) => item.id) },
      { title: "主要风险", body: "保底版未完成最终模型整合，主要风险是预算能力、决策链、既有系统供应商和付款质量尚未被充分核验。", sourceIds: [] },
      { title: "下一步建议", body: "先带着来源角标和问题清单做会前讨论；如需正式方案，再补客户目标、系统现状和数据样例。", sourceIds: [] }
    ],
    customerInsights: {
      localCards: [{ title: "主体与本地信息", facts: firstTexts(subject.facts), insight: "主体信息以已读来源和核验结果为准。", toConfirm: arr(subject.uncertainties), sourceIds: arr(subject.sourceIds).slice(0, 3) }],
      groupCards: [{ title: "产品与客户/市场", facts: firstTexts(market.facts), insight: firstTexts(market.implications, "body", 1)[0] || "市场和客户压力需继续核对。", toConfirm: arr(market.uncertainties), sourceIds: arr(market.sourceIds).slice(0, 3) }],
      metrics,
      digitalCards: [{ title: "数字化与AI", facts: firstTexts(digital.facts), insight: firstTexts(digital.implications, "body", 1)[0] || "数字化现状需现场确认。", toConfirm: arr(digital.uncertainties), sourceIds: arr(digital.sourceIds).slice(0, 3) }]
    },
    salesThesis: {
      summary: "模型整合超时，建议把本报告作为会前证据清单和轻量商机判断使用。",
      worthFollowing: "是否重点跟进需结合客户真实痛点、预算归属和参会角色确认。",
      budgetJudgment: firstTexts(finance.metrics, "value", 1)[0] || "预算/买单能力未形成硬结论，需现场确认。",
      decisionPath: "项目级推进人、预算归属和最终拍板人需现场确认。",
      operatingAdvice: "先围绕一个可验证业务场景确认痛点和样例，再决定是否投入定制方案。"
    },
    pains: arr(pain.painSignals).slice(0, 4).map((item) => ({
      title: item.title || "潜在痛点",
      sourceBasis: item.basis || "来自分主题证据整理。",
      reasoning: item.body || item.title || "需现场确认痛点强度。",
      validationSignals: item.validationSignals || ["确认业务场景、指标口径和数据可用性。"],
      aiEntry: item.aiEntry || "围绕该线索做场景澄清，再判断AI切入方向。",
      sourceIds: item.sourceIds || arr(pain.sourceIds).slice(0, 2)
    })),
    solutions: [
      { priority: "P1", title: "先做轻量场景确认", customerPain: "当前已形成可交流线索，需先把业务场景和成功指标收敛清楚。", introduction: "以证据池和用户线索锁定一个可验证小场景。", value: "把交流从标准功能介绍收敛到可确认的客户问题和成功指标。", expectedImpact: "形成下一步是否进入方案深化和轻量验证的判断依据。", prerequisite: "确认业务目标、系统边界、数据样例和验收口径。", why: "先以证据池和用户线索锁定小场景。", how: "确认业务目标、系统边界、数据样例和成功指标后再进入方案。", sourceIds: sourcePack.slice(0, 2).map((item) => item.id) }
    ],
    solutionStrategy: {
      currentSituation: firstTexts(pain.painSignals, "body", 1)[0] || "客户现状和问题需结合现场信息继续确认。",
      overallApproach: "先把公开线索收敛为一个可验证场景，再围绕业务应用、知识/数据底座、系统连接和运营后台拆方案。",
      rankedSolutions: [{ priority: "P1", title: "先做轻量场景确认", why: "保底版优先降低误判和重投入风险。" }],
      implementationPath: ["确认业务目标、责任人和预算归属。", "准备样例数据、流程材料和系统清单。", "按业务应用、知识/数据底座、系统连接和运营后台拆分方案边界。"]
    },
    deliveryAssessment: {
      architectureSketch: "业务数据/文档/系统样例 → 知识库或场景智能体 → 工作台/报表/告警输出。",
      deliveryRisks: ["数据样例、系统接口、权限边界和验收口径会直接影响正式交付范围。"],
      dependencies: ["现有系统清单和接口边界", "脱敏样例、字段字典或流程材料", "权限、安全和部署要求"],
      sowOutline: ["业务应用前台", "知识/数据底座", "系统连接器", "运营管理后台"]
    },
    requirements: {
      preMeeting: ["确认参会角色、业务线、最关注的业务问题和是否已有数据样例。"],
      onSite: ["围绕来源角标逐条确认：哪些是事实、哪些是线索、哪些需要客户补充。"]
    },
    keywords: [standardName, company.region, company.industry, company.aiNeeds].filter(Boolean),
    qualityWarnings: [...arr(quality.qualityWarnings), fallbackWarning],
    qualityLevel: quality.qualityLevel,
    qualityLabel: `${quality.qualityLabel || "报告"}（保底生成）`
  };
}

export async function generateStructuredReport(company, sources, quality, onProgress = async () => {}, options = {}) {
  const sourcePack = buildSourcePack(sources, 55, 1600);
  const topicBriefs = arr(options.checkpoint?.topicBriefs).slice(0, TOPIC_NAMES.length);
  const usedModels = uniqModelUsage([...(sources.usedModels || []), ...arr(options.checkpoint?.usedModels)]);
  const analysisLabels = ["客户画像", "财务指标", "市场与客户", "数字化与AI", "痛点机会"];
  for (let i = 0; i < TOPIC_NAMES.length; i += 1) {
    const topic = TOPIC_NAMES[i];
    const label = analysisLabels[i] || topic;
    if (topicBriefs[i]) {
      await onProgress(80 + Math.round(((i + 1) / TOPIC_NAMES.length) * 10), `模型分析：${label}`, {
        phaseKey: "analysis",
        detail: `已从断点恢复“${topic}”证据整理结果，继续后续步骤。`,
        sourceCount: sourcePack.length,
        qualityLevel: quality.qualityLevel,
        completed: i + 1,
        total: TOPIC_NAMES.length
      });
      continue;
    }
    await onProgress(80 + Math.round((i / TOPIC_NAMES.length) * 10), `模型分析：${label}`, {
      phaseKey: "analysis",
      detail: `正在调用模型整理“${topic}”证据，可能需要 1-3 分钟。`,
      sourceCount: sourcePack.length,
      qualityLevel: quality.qualityLevel,
      completed: i,
      total: TOPIC_NAMES.length
    });
    const brief = await analyzeTopic(company, topic, sources, async (attempt) => {
      await onProgress(80 + Math.round((i / TOPIC_NAMES.length) * 10), `模型分析：${label}`, {
        phaseKey: "analysis",
        detail: modelAttemptDetail(attempt, "正在整理分主题证据"),
        sourceCount: sourcePack.length,
        qualityLevel: quality.qualityLevel,
        completed: i,
        total: TOPIC_NAMES.length,
        currentModel: `${attempt.model}（${attempt.channel}）`
      });
    });
    if (brief?._modelName) usedModels.push({ model: brief._modelName, channel: brief._modelChannel, purpose: `证据整理：${topic}` });
    await onProgress(82 + Math.round((i / TOPIC_NAMES.length) * 9), `模型分析：${label}`, {
      phaseKey: "analysis",
      detail: `已完成“${topic}”证据整理，继续处理下一组主题。`,
      sourceCount: sourcePack.length,
      qualityLevel: quality.qualityLevel,
      completed: i + 1,
      total: TOPIC_NAMES.length,
      currentModel: brief?._modelName ? `${brief._modelName}（${brief._modelChannel || "默认通道"}）` : ""
    });
    topicBriefs[i] = brief;
    await options.onCheckpoint?.({
      topicBriefs,
      analysisIndex: i + 1,
      usedModels: uniqModelUsage(usedModels),
      analysisStage: "topic-briefs"
    });
    if (options.shouldYield?.()) await options.onYield?.();
  }
  await options.onCheckpoint?.({
    topicBriefs,
    analysisIndex: TOPIC_NAMES.length,
    usedModels: uniqModelUsage(usedModels),
    analysisStage: "final"
  });
  if (options.shouldYield?.()) await options.onYield?.();
  await onProgress(92, "模型分析：最终校验", {
    phaseKey: "analysis",
    detail: "正在把分主题证据整合为客户认知、财务指标、痛点、方案建议和前置要求。",
    sourceCount: sourcePack.length,
    qualityLevel: quality.qualityLevel
  });
  let answer;
  try {
    answer = await callModel(
      [
        { role: "system", content: "你是售前技术的首席客户研究与解决方案顾问。只返回严格 JSON，不要 Markdown，不要解释。" },
        { role: "user", content: finalPrompt(company, sourcePack, topicBriefs, quality) }
      ],
      {
        runtimeMode: company.runtimeMode,
        temperature: 0.15,
        maxTokens: 10000,
        timeoutMs: 240000,
        totalTimeoutMs: 270000,
        headerTimeoutMs: 30000,
        firstTokenTimeoutMs: 90000,
        streamIdleTimeoutMs: 45000,
        streamMaxMs: 240000,
        onAttempt: async (attempt) => {
          await onProgress(92, "模型分析：最终校验", {
            phaseKey: "analysis",
            detail: modelAttemptDetail(attempt, "正在整合最终报告"),
            sourceCount: sourcePack.length,
            qualityLevel: quality.qualityLevel,
            currentModel: `${attempt.model}（${attempt.channel}）`
          });
        }
      }
    );
  } catch (error) {
    const fallback = buildFallbackStructuredReport(company, sourcePack, topicBriefs, quality, error);
    const finalUsedModels = uniqModelUsage(usedModels);
    return {
      ...fallback,
      sourceBriefs: topicBriefs,
      sources: normalizeReportSources(sources, 60).map(({ text, readable, ...source }, index) => ({
        sourceId: index + 1,
        ...source,
        usedFor: source.usedFor || source.topic || source.query || "公开信息核验"
      })),
      evidencePool: buildEvidencePool(sources),
      modelName: "fallback-report-builder",
      modelChannel: "local",
      usedModels: finalUsedModels,
      modelDisplay: modelDisplay({ ...fallback, usedModels: finalUsedModels })
    };
  }
  usedModels.push({ model: answer.model, channel: answer.channel, purpose: "报告整合" });
  await onProgress(95, "模型分析：报告整合完成", {
    phaseKey: "analysis",
    detail: "报告结构化整合完成，正在进入最终保存和渲染。",
    sourceCount: sourcePack.length,
    qualityLevel: quality.qualityLevel,
    currentModel: `${answer.model}（${answer.channel}）`
  });
  const parsed = normalizeReportShape(ensureFinancialMetrics(extractJson(answer.content), sources, company));
  const finalUsedModels = uniqModelUsage(usedModels);
  return {
    ...parsed,
    sourceBriefs: topicBriefs,
    sources: normalizeReportSources(sources, 60).map(({ text, readable, ...source }, index) => ({
      sourceId: index + 1,
      ...source,
      usedFor: source.usedFor || source.topic || source.query || "公开信息核验"
    })),
    evidencePool: buildEvidencePool(sources),
    modelName: answer.model,
    modelChannel: answer.channel,
    usedModels: finalUsedModels,
    modelDisplay: modelDisplay({ ...parsed, modelName: answer.model, usedModels: finalUsedModels })
  };
}

function isDfmInput(input) {
  return /DFM|可制造性|研发|工艺评审|设计制造|研发需要/i.test(String(input || ""));
}

function supplementCard(input) {
  return {
    title: "用户提供线索",
    facts: [input],
    insight: "这条会前补充不作为公开事实；它用于调整现场探问重点和方案优先级。",
    toConfirm: ["客户是否已明确 DFM/可制造性评审的业务目标、输入资料、评审流程和责任部门。"]
  };
}

function mergeByTitle(primary = [], fallback = [], limit = 8) {
  const out = [];
  const seen = new Set();
  for (const item of [...arr(primary), ...arr(fallback)]) {
    const title = String(item?.title || item?.label || item?.priority || item || "").replace(/\s+/g, "");
    const key = title || compactText(item?.body || item?.summary || item?.pain || item?.customerPain || item, 40);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, limit);
}

function feedbackLines(input = "") {
  return String(input || "")
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) =>
      line
        .replace(/^[\w\u4e00-\u9fa5@·\s-]{1,28}\s+\d{4}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}\s*/g, "")
        .replace(/^[\w\u4e00-\u9fa5@·\s-]{1,28}\s+\d{1,2}:\d{2}\s*/g, "")
        .trim()
    )
    .filter(meaningful);
}

function feedbackNeedSummary(input = "") {
  const lines = feedbackLines(input);
  const useful = lines.filter((line) =>
    /客户|需求|想要|希望|需要|现在|目前|难点|问题|原因|效果|场景|具体|通过|达到|如果|告警|预警|识别|生成|分析|核对|自动|减少|提升|每月|每个|工位|机台|包装|系统|数据/.test(line)
  );
  const picked = (useful.length ? useful : lines).filter((line, index, all) => all.findIndex((item) => item === line) === index).slice(0, 5);
  return compactText(picked.join("；"), 420);
}

function feedbackStructuredSummary(input = "", delta = {}) {
  const text = String(input || "");
  const lines = feedbackLines(text).filter((line, index, all) => all.findIndex((item) => item === line) === index);
  const line = (pattern) => lines.find((item) => pattern.test(item)) || "";
  const hasVideoVision = /视频|监控|摄像头|大华|视觉|行为识别|违规|告警|预警|识别/.test(text);
  const hasPackaging = /包装|包装箱|装箱|错装|混装|串箱|错箱|不同客户|客户包装|机台A|机台B|A的东西|B的包装/.test(text);
  const hasDocument = /材料|公文|讲话稿|会议纪要|专报|经济运行分析|工作总结|政务信息稿|格式|文风|word|wps|写材料/.test(text);
  const hasKnowledge = /知识库|术语|政策|文件|名录|产业口号|本地知识|持续入库|记忆|模板|信息源不足/.test(text);
  const signals = arr(delta.signals).filter(meaningful);

  if (hasVideoVision && hasPackaging) {
    return [
      { title: "客户场景", body: "电子元器件包装生产线；两个机台产出的东西相同，但分别对应不同客户的包装箱。" },
      { title: "当前问题", body: "包装箱物料不足或现场操作混乱时，工人可能把A机台产品装进B客户包装箱，形成错箱/混装风险。" },
      { title: "期望效果", body: "基于现有大华监控视频识别人员操作和包装行为，发现疑似违规时及时告警。" },
      { title: "已知条件", body: "产线上端有摄像头，且每个工位都有视频覆盖；还要确认画面角度、清晰度、光照、遮挡和包装箱可识别特征。" },
      { title: "下一步要问", body: "拿脱敏视频样例、A/B包装箱区别、违规动作定义、告警处置流程，以及可接受的误报率和漏报率。" }
    ];
  }

  if (hasDocument || hasKnowledge) {
    return [
      { title: "客户场景", body: compactText(line(/材料|公文|讲话稿|会议纪要|专报|经济运行分析|工作总结|政务信息稿/) || "办公室综合材料生产与知识检索场景。", 180) },
      { title: "当前问题", body: compactText(line(/难点|问题|缺少|不足|不敢|格式|准确|深度|反复|数据/) || "材料写作依赖人工经验，数据、术语、格式、文风和知识更新都需要稳定支撑。", 220) },
      { title: "期望效果", body: compactText(line(/希望|愿望|需求|需要|支持|生成|严格|深度|前瞻|记住|个性化/) || "希望用智能体完成资料检索、写稿、格式规范、风格适配和人工审校辅助。", 220) },
      { title: "已知条件", body: compactText(line(/word|wps|模板|材料类型|月均|每月|部署|私有化|服务器|知识库/) || "需进一步确认材料类型、模板、知识来源、部署方式和月度处理量。", 220) },
      { title: "下一步要问", body: "要一份脱敏历史材料、格式模板、常用术语/政策文件、审稿标准和优先验证的材料类型。" }
    ].filter((item) => meaningful(item.body));
  }

  const scene = line(/场景|生产线|产线|办公室|部门|客户|用于|工位|机台|系统|材料|设备|供应商|研发|质量|销售|服务/);
  const problem = line(/难点|问题|原因|现在|目前|原来|不足|人工|耗时|错误|违规|缺少|反复|来回|效率/);
  const target = line(/希望|想要|需要|达到|愿望|效果|自动|生成|识别|告警|预警|减少|提升|支持/);
  const known = line(/用的是|每个|都有|系统|服务器|部署|数据|摄像头|word|wps|月均|每月|已|当前/);
  const next = line(/安排|讨论|提供|确认|样例|会议|具体|再|下一步/);
  const fallback = feedbackNeedSummary(text);
  return [
    { title: "客户场景", body: compactText(scene || (signals.length ? `${signals.join("、")}相关场景。` : fallback), 180) },
    { title: "当前问题", body: compactText(problem || "客户已提出具体业务诉求，但问题发生频率、影响范围和现有处理方式还需要进一步拆清。", 220) },
    { title: "期望效果", body: compactText(target || "希望通过智能体或自动化能力减少人工处理、降低错误或提升响应效率。", 220) },
    { title: "已知条件", body: compactText(known || "已知条件不足，需要继续确认现有系统、数据/材料、权限和责任人。", 220) },
    { title: "下一步要问", body: compactText(next || "请客户提供一个真实样例，明确输入、规则、输出、异常处理和验收指标。", 220) }
  ].filter((item) => meaningful(item.body));
}

function explicitNeedDetected(input = "") {
  const text = String(input || "");
  const intent = /客户|需求|想要|希望|需要|愿望|现在|目前|难点|问题|原因|效果|场景|具体|通过|达到|如果|每月|每个|工位|机台|系统|数据/.test(text);
  const action = /AI|智能体|大模型|知识库|视频|监控|摄像头|视觉|识别|告警|预警|对账|开票|材料|公文|讲话稿|会议纪要|专报|分析|报告|PPT|排产|计划|质量|设备|流程|自动|核对|生成|格式|文风|插件|制图|上传|部署|服务器/.test(text);
  return intent && action;
}

function genericFeedbackConclusion(signals = [], needSummary = "") {
  const scene = signals.length ? signals.join("、") : "客户明确业务场景";
  const basis = needSummary || "用户反馈中已经出现具体业务对象、目标效果或现场约束。";
  return [
    {
      title: "一句话判断",
      body: `本轮反馈已经从初步交流推进到“${scene}”的可验证场景，下一步应围绕客户原话拆业务规则、样例数据和验证边界。`,
      sourceIds: []
    },
    {
      title: "优先切入",
      body: "先选择一个客户已经描述清楚的高频场景做轻量验证，把输入、规则、输出、责任人和成功指标定义清楚，再决定是否进入方案深化。",
      sourceIds: []
    },
    {
      title: "主要商机风险",
      body: "风险不在于有没有AI兴趣，而在于客户场景能否被拆成可验证规则，且数据、样例、权限、责任边界和验收指标是否能拿到。",
      sourceIds: []
    },
    {
      title: "下一步动作",
      body: "要求客户提供一个真实样例：现场流程、现有系统/材料、当前人工做法、判断规则、异常处理和期望输出。",
      sourceIds: []
    },
    {
      title: "核心依据",
      body: `拜访反馈要点：${basis}`,
      sourceIds: []
    }
  ];
}

function genericFeedbackPain(signals = [], sourceBasis = "", needSummary = "") {
  return {
    title: signals.length ? `${signals[0]}已形成可验证需求` : "客户已提出明确业务场景但规则仍需拆解",
    sourceBasis,
    reasoning:
      needSummary ||
      "客户已经描述了业务对象、目标效果或当前问题，但还需要把现有流程、样例数据、判断规则、责任人和验收标准拆清楚，才能避免泛AI交流变成无边界交付。",
    validationSignals: ["真实样例或样本材料", "当前人工流程和耗时", "判断规则/异常规则", "输出物格式", "责任人和验收指标"],
    aiEntry: "场景验证型智能体：先围绕一个真实样例完成输入解析、规则判断、结果生成和人工复核闭环，再评估系统集成。"
  };
}

function genericFeedbackSolution(signals = []) {
  const title = signals.length ? `${signals[0]}场景验证方案` : "场景验证型智能体";
  return {
    priority: "P1",
    title,
    customerPain: "客户已经提出具体业务诉求，但尚需把场景、规则、数据和验收指标拆清楚，才能进入可交付方案。",
    introduction: "用一个真实样例做最小验证：明确输入、处理规则、输出结果、人工复核点和异常处理方式。",
    value: "把交流从“AI能做什么”转成“这个具体场景能不能跑通、能省多少时间、能降低什么风险”。",
    expectedImpact: "预期形成可演示的流程闭环和下一步实施边界，帮助客户判断投入产出比。",
    prerequisite: "客户需提供样例材料、现有流程、判断规则、期望输出和负责验收的业务人员。"
  };
}

function feedbackSignalPack(input = "") {
  const text = String(input || "").trim();
  const signals = [];
  const hasCrossSystem = /多系统|跨系统|导入|导出|查数|改表|核对|录入|流转|ERP|财务结算|订单系统|制造管理|供应商管理|K3|捷客云|写客云/.test(text);
  const hasReconciliation = /对账|开票|供应商|发票|结算|付款|应付|财务/.test(text);
  const hasPlanning = /排产员|订购员|排产|订购|订单|计划|生产计划|插单|缺料|换线/.test(text);
  const hasLowValueWork = /低增值|重复操作|人工|办公室人员|来回|大量|工作量|效率/.test(text);
  const hasVideoVision = /视频|监控|摄像头|大华|视觉|行为识别|违规|告警|预警|识别/.test(text);
  const hasProductionLine = /生产线|产线|工位|机台|设备|包装生产线/.test(text);
  const hasPackagingErrorProofing = /包装|包装箱|装箱|错装|混装|串箱|错箱|不同客户|客户包装|物料不足|机台A|机台B|A的东西|B的包装/.test(text);
  const hasLineVisionProofing = hasVideoVision && (hasProductionLine || hasPackagingErrorProofing);
  const hasDocumentAgent = /材料|公文|讲话稿|会议纪要|专报|经济运行分析|工作总结|政务信息稿|党政公文|格式|文风|word|wps|PPT|制图|写材料/.test(text);
  const hasKnowledgeAgent = /知识库|术语|政策|文件|名录|产业口号|本地知识|持续入库|记忆|范式|模板|最新知识|信息源不足/.test(text);
  const hasResearchAgent = /deep research|深度研究|行业趋势|战略前瞻|研判|分析|数据比较少|精准度不足|信息收集|质量检索/.test(text);

  if (hasCrossSystem) signals.push("跨系统数据采集、核对与流转");
  if (hasReconciliation) signals.push("供应商自动对账与开票");
  if (hasPlanning) signals.push("排产/订购/计划类岗位重复操作");
  if (hasLowValueWork) signals.push("办公室低增值重复操作减负");
  if (hasLineVisionProofing) signals.push("产线视频识别与违规预警");
  if (hasPackagingErrorProofing) signals.push("包装错箱/混装防错");
  if (hasDocumentAgent) signals.push("材料写作与格式规范智能体");
  if (hasKnowledgeAgent) signals.push("本地知识库与术语更新");
  if (hasResearchAgent) signals.push("深度研究与研判分析");

  const needSummary = feedbackNeedSummary(text);
  const hasExplicitNeed = explicitNeedDetected(text);
  if (!signals.length && hasExplicitNeed) signals.push("客户明确业务场景待验证");

  if (!signals.length) {
    return {
      hasActionable: false,
      summary: compactText(text, 220),
      changeSummary: ["已记录拜访反馈，但本轮信息尚不足以改变评级、方案或痛点优先级。"],
      updatedSections: ["拜访反馈"]
    };
  }

  const sourceBasis = `拜访反馈提到：${signals.join("、")}。这会直接影响场景、样例、数据/材料、责任岗位和验收指标的核对顺序。`;
  const conclusions = hasLineVisionProofing
    ? [
        {
          title: "一句话判断",
          body: "客户已把需求收敛到电子元器件包装产线的视觉防错场景：用现有大华监控视频识别人员/物料操作是否违规，并在错箱、混装等风险出现前告警。",
          sourceIds: []
        },
        {
          title: "优先切入",
          body: "优先做“产线视觉防错告警智能体”，先验证两个机台、两个客户包装箱、一个固定工位的错装/混装识别闭环，而不是继续泛谈知识库或智能排产。",
          sourceIds: []
        },
        {
          title: "主要商机风险",
          body: "关键风险在于现有监控摄像头是否满足产线识别条件，包括角度、清晰度、光照、遮挡、包装箱可区分特征、误报容忍度和告警闭环。",
          sourceIds: []
        },
        {
          title: "下一步动作",
          body: "要求客户提供一段脱敏视频样例、工位布局图、A/B包装箱区别、违规判定规则和告警处置流程，再决定是否进入视觉POC。",
          sourceIds: []
        },
        {
          title: "核心依据",
          body: "拜访反馈明确出现大华监控、电子元器件包装生产线、两个机台产品相同但客户包装箱不同、工人可能错装、希望预警等具体业务线索。",
          sourceIds: []
        }
      ]
    : hasDocumentAgent || hasKnowledgeAgent || hasResearchAgent
      ? [
          {
            title: "一句话判断",
            body: "客户需求已从泛AI交流收敛到材料写作、格式规范、本地知识库和研判分析等办公室高频工作，适合按“材料智能体团队”做场景验证。",
            sourceIds: []
          },
          {
            title: "优先切入",
            body: "优先选择一种高频材料，如经济运行分析、领导讲话稿、工作总结或政务信息稿，先验证知识检索、内容生成、格式规范和人工审校闭环。",
            sourceIds: []
          },
          {
            title: "主要商机风险",
            body: "关键风险在于政务表述准确性、材料格式、知识更新、私有化部署、数据来源不足和人工审校责任边界。",
            sourceIds: []
          },
          {
            title: "下一步动作",
            body: "请客户提供一份脱敏历史材料、格式模板、常用术语/政策文件、写作风格要求和审稿流程，先做一类材料的样稿验证。",
            sourceIds: []
          },
          {
            title: "核心依据",
            body: `拜访反馈要点：${needSummary || signals.join("、")}。`,
            sourceIds: []
          }
        ]
      : hasExplicitNeed && !hasCrossSystem && !hasReconciliation && !hasPlanning && !hasLowValueWork
        ? genericFeedbackConclusion(signals, needSummary)
        : [
        {
          title: "一句话判断",
          body: "客户反馈已从泛AI交流转向明确的跨系统流程自动化需求，商机应优先按“办公/业务流程智能体 + 数据核对自动化”推进，而不是继续泛谈知识库或质量追溯。",
          sourceIds: []
        },
        {
          title: "优先切入",
          body: hasReconciliation
            ? "优先切入供应商对账与开票场景，用小范围数据和规则样例验证自动核对、异常解释、凭证辅助生成和人工复核闭环。"
            : "优先切入跨系统查数、导表、核对、录入和规则判断场景，先把一个岗位的重复操作跑通。",
          sourceIds: []
        },
        {
          title: "主要商机风险",
          body: "风险不再是需求不明确，而是系统权限、数据口径、异常规则、财务/业务复核责任和供应商边界是否能被客户授权验证。",
          sourceIds: []
        },
        {
          title: "下一步动作",
          body: "要求客户提供1个典型流程样例：输入系统、导出字段、核对规则、异常处理方式、最终输出物和当前人工耗时。",
          sourceIds: []
        },
        {
          title: "核心依据",
          body: `拜访反馈明确出现${signals.join("、")}，说明客户已有可验证的岗位级流程痛点。${needSummary ? `客户原话要点：${needSummary}` : ""}`,
          sourceIds: []
        }
      ];

  const pains = [
    hasDocumentAgent || hasKnowledgeAgent || hasResearchAgent
      ? {
          title: "材料写作依赖人工经验，知识来源和格式要求难以稳定复用",
          sourceBasis,
          reasoning:
            "客户反馈涉及经济运行分析、讲话稿、会议纪要、专报、工作总结、政务信息稿等多类材料，同时关注格式规范、政策术语、本地知识和战略研判深度，说明痛点不是单次写稿，而是材料生产流程和知识体系缺少智能化支撑。",
          validationSignals: ["高频材料类型", "历史模板和格式规范", "本地术语/政策文件来源", "月度材料量", "审稿流程和责任人"],
          aiEntry: "材料智能体团队：检索本地知识与政策术语，生成不同材料初稿，自动套用格式要求，并保留人工审校和风格记忆。"
        }
      : null,
    hasLineVisionProofing
      ? {
          title: "包装产线存在错箱/混装风险，需要实时防错告警",
          sourceBasis,
          reasoning: "两个机台产出的产品外观相同但归属不同客户，包装箱物料不足或现场操作混乱时，工人可能把A机台产品装入B客户包装箱。一旦流出，会带来客户投诉、返工、追溯和质量责任风险。",
          validationSignals: ["是否每个工位都有可用视频流", "A/B包装箱是否有可稳定识别特征", "错装发生频率和损失", "告警后谁处理", "可接受误报率/漏报率"],
          aiEntry: "视觉防错智能体：基于固定工位视频识别包装箱、人员操作路径和违规动作，实时输出告警、截图留痕和复核记录。"
        }
      : null,
    hasVideoVision && !hasLineVisionProofing
      ? {
          title: "视频行为识别需求已出现，但场景规则仍需收敛",
          sourceBasis,
          reasoning: "客户提出用监控视频做人员行为识别和违规告警，说明需求方向明确；但必须先把识别对象、违规动作、摄像头条件和告警闭环定义清楚。",
          validationSignals: ["识别对象是人、物料、包装箱还是动作", "摄像头型号/分辨率/角度", "违规规则清单", "告警触达方式", "样例视频是否可提供"],
          aiEntry: "视频识别场景验证：先用脱敏样例视频判断可识别性，再定义算法、边缘部署和告警流程。"
        }
      : null,
    hasCrossSystem
      ? {
          title: "跨系统数据采集、核对与流转成本高",
          sourceBasis,
          reasoning: "多个业务系统之间缺少自动化连接和统一规则引擎，员工需要反复导出、复制、核对和录入，容易形成低效率、差错和责任不清。",
          validationSignals: ["每天跨系统导入/导出次数", "单次核对耗时", "常见异常类型", "最终输出给谁复核", "涉及哪些系统和字段"],
          aiEntry: "流程智能体：围绕固定业务流程读取多系统数据，按规则自动核对，输出异常清单、解释原因和待人工确认项。"
        }
      : null,
    hasReconciliation
      ? {
          title: "供应商对账与开票依赖人工核对",
          sourceBasis,
          reasoning: "供应商对账涉及ERP、订单、供应商单据、微信/表格材料和财务口径，规则多、异常多，适合先做可控的小场景验证。",
          validationSignals: ["供应商数量和月度对账单量", "当前对账耗时", "K3/捷客云等系统可导出字段", "异常差异处理规则", "开票前的审批与复核人"],
          aiEntry: "供应商对账智能体：自动读取对账单与系统数据，生成差异解释、复核清单和开票辅助材料。"
        }
      : null,
    hasPlanning
      ? {
          title: "排产/订购/计划岗位存在重复判断工作",
          sourceBasis,
          reasoning: "排产员、订购员等岗位需要在订单、库存、生产和供应商信息之间反复查数与判断，若规则稳定，可逐步沉淀为辅助决策智能体。",
          validationSignals: ["排产/订购规则是否稳定", "人工调整频率", "异常场景清单", "是否已有APS/MES/ERP导出数据", "哪些决策必须人工确认"],
          aiEntry: "计划协同助手：先做缺料、插单、库存和交付影响分析，不直接替代最终排产决策。"
        }
      : null
  ].filter(Boolean);
  if (!pains.length && hasExplicitNeed) pains.push(genericFeedbackPain(signals, sourceBasis, needSummary));

  const solutions = [
    hasDocumentAgent || hasKnowledgeAgent || hasResearchAgent
      ? {
          priority: "P1",
          title: "办公室材料智能体团队",
          customerPain: "材料写作类型多、格式要求严、政策术语和本地知识需要准确，人工临时写稿和改格式耗时高。",
          introduction: "先围绕一种高频材料做样稿验证：接入脱敏历史材料、格式模板、政策文件和本地术语，形成检索、起草、润色、格式检查和人工审校闭环。",
          value: "把个人经验沉淀为可复用的材料生产流程，提升写稿效率、格式一致性和表述准确性。",
          expectedImpact: "预期缩短初稿准备时间，减少格式返工，提高经济运行分析和政务材料的知识覆盖与表达稳定性。",
          prerequisite: "需提供脱敏历史材料、模板格式、术语/政策文件、审稿标准、部署方式和数据安全要求。"
        }
      : null,
    hasKnowledgeAgent
      ? {
          priority: hasDocumentAgent ? "P2" : "P1",
          title: "本地知识库与术语更新专员",
          customerPain: "本地政策、企业名录、产业口号、对口文件和术语表达需要准确，且会持续变化。",
          introduction: "建立可维护的本地知识库，支持政策文件入库、术语识别、版本更新、引用追溯和材料生成时自动调用。",
          value: "降低材料表述错误和知识过期风险，让新政策、新名录和本地口径能持续沉淀。",
          expectedImpact: "提高材料准确率和一致性，减少人工查找和反复校对。",
          prerequisite: "知识来源、更新责任人、入库频率、引用规范和权限边界已经锁定。"
        }
      : null,
    hasLineVisionProofing
      ? {
          priority: "P1",
          title: "产线视觉防错告警智能体",
          customerPain: "电子元器件包装线上，不同客户的产品可能外观一致，现场存在把A机台产品装进B客户包装箱的错箱/混装风险。",
          introduction: "围绕一个固定产线场景做轻量POC：接入大华视频流或样例视频，识别工位、包装箱、人员取放动作和违规规则，发现疑似错装时即时告警并截图留痕。",
          value: "把事后抽检和人工巡检前移为实时预警，降低错箱流出、客户投诉和返工追溯成本。",
          expectedImpact: "预期形成“识别-告警-复核-留痕”的闭环，先验证误报率、漏报率和现场处置效率，再决定是否扩展到更多工位。",
          prerequisite: "需提供脱敏视频样例、工位摄像头位置、包装箱可识别特征、违规动作定义、告警方式和现场复核责任人。"
        }
      : null,
    hasVideoVision && !hasLineVisionProofing
      ? {
          priority: "P1",
          title: "视频行为识别场景验证",
          customerPain: "客户希望基于现有监控视频识别人员违规行为并告警，但业务规则、画面质量和告警闭环尚未确认。",
          introduction: "先用客户提供的样例视频做可识别性评估，确认要识别的人、物、动作和违规边界，再设计轻量验证。",
          value: "避免一开始承诺完整视觉系统，先判断现有摄像头和场景是否具备AI识别条件。",
          expectedImpact: "快速判断可做/不可做、需要补哪些摄像头或光照条件，并形成POC边界。",
          prerequisite: "需提供样例视频、摄像头参数、识别规则、告警流程和误报容忍度。"
        }
      : null,
    hasReconciliation
      ? {
          priority: hasLineVisionProofing || (hasVideoVision && !hasLineVisionProofing) ? "P2" : "P1",
          title: "供应商对账与开票智能体",
          customerPain: "供应商对账、开票前核对和异常解释依赖人工在多个系统和表格之间来回处理。",
          introduction: "先选1-2个供应商或一个结算周期做样例，把K3/订单系统/供应商对账单/微信材料等输入统一成可核对的数据包。",
          value: "减少财务和业务人员的重复核对工作，让异常差异可解释、可复核、可追溯。",
          expectedImpact: "预期形成自动差异清单、异常原因建议、开票辅助材料和人工复核记录，先验证节省时间和降低差错。",
          prerequisite: "客户需提供脱敏样例、字段说明、核对规则、异常处理规则和最终复核责任人。"
        }
      : null,
    hasCrossSystem
      ? {
          priority: hasLineVisionProofing || (hasVideoVision && !hasLineVisionProofing) ? "P2" : hasReconciliation ? "P2" : "P1",
          title: "跨系统数据核对与流转智能体",
          customerPain: "订单、制造、供应商、ERP/财务等系统之间存在大量查数、导数、改表、核对和录入工作。",
          introduction: "把一个岗位的固定流程拆成输入、规则、判断、输出四段，用智能体辅助完成数据读取、规则判断和结果生成。",
          value: "把低增值重复操作转为可审计的半自动流程，释放岗位时间，并降低人工错漏。",
          expectedImpact: "先以一个高频流程验证：人工耗时下降、异常处理更清楚、输出物更规范。",
          prerequisite: "系统导出权限、数据字段、流程规则、异常边界和人工确认点已经锁定。"
        }
      : null,
    hasPlanning
      ? {
          priority: hasLineVisionProofing || (hasVideoVision && !hasLineVisionProofing) ? "P3" : "P3",
          title: "计划与订购辅助决策助手",
          customerPain: "排产员、订购员需要反复查订单、库存、供应商与生产信息，规则判断依赖经验。",
          introduction: "先不做完整排产系统，先做缺料、插单、交付影响和订购建议的辅助分析。",
          value: "降低计划岗位的查数和初判负担，让异常影响更快暴露。",
          expectedImpact: "缩短计划准备时间，提高异常响应速度，保留人工最终决策权。",
          prerequisite: "订单、库存、BOM、供应商交期和生产约束具备可导出样例。"
        }
      : null
  ].filter(Boolean);
  if (!solutions.length && hasExplicitNeed) solutions.push(genericFeedbackSolution(signals));

  const requirements = {
    preMeeting: [
      hasLineVisionProofing ? "请客户提供1-2段脱敏产线视频样例，覆盖正常装箱和疑似违规/错箱动作。" : "",
      hasLineVisionProofing ? "请客户说明A/B机台、A/B包装箱、客户标签、工位位置和当前错装防错流程。" : "",
      hasVideoVision ? "请客户确认现有大华摄像头是否可提供视频流、回放片段或SDK/RTSP接入方式。" : "",
      "请客户提供一个最典型的跨系统流程样例：涉及哪些系统、谁操作、输入是什么、输出是什么。",
      "请客户列出当前人工核对规则：哪些字段必须一致，哪些差异允许人工判断。",
      hasReconciliation ? "供应商对账场景需提供脱敏对账单、系统导出字段、开票前复核流程和异常处理样例。" : "",
      hasPlanning ? "计划/订购场景需提供订单、库存、供应商交期、生产约束和人工调整规则样例。" : "",
      hasDocumentAgent ? "材料智能体场景需提供脱敏历史材料、模板格式、常用术语和审稿标准。" : "",
      hasKnowledgeAgent ? "知识库场景需提供政策文件、名录、术语表、更新频率和权限要求。" : "",
      hasExplicitNeed && !hasDocumentAgent && !hasLineVisionProofing && !hasCrossSystem ? "请客户提供一个最真实的业务样例，用于拆解输入、规则、输出和验收指标。" : ""
    ].filter(Boolean),
    onSite: [
      hasLineVisionProofing ? "A/B包装箱靠什么区分：颜色、标签、条码、文字、位置还是人工动作路径？" : "",
      hasLineVisionProofing ? "错装一旦发生，目前如何发现、谁处理、平均造成多少返工或客户风险？" : "",
      hasVideoVision ? "现场可接受的误报率和漏报率是多少，告警要推给谁，是否需要截图/短视频留痕？" : "",
      "这个流程现在每周/每月处理多少单，涉及几个人，每次平均耗时多久？",
      "异常差异通常有哪些类型，最终由谁确认、谁承担责任？",
      "哪些系统允许导出数据，哪些系统只能人工查询，是否允许脱敏样例验证？",
      "客户希望先减少人工耗时、降低错漏、提升复核透明度，还是支撑后续系统集成？",
      hasDocumentAgent ? "不同材料类型的审稿标准、文风要求和最终责任人分别是谁？" : "",
      hasKnowledgeAgent ? "哪些知识必须保持最新，更新后由谁确认，是否需要引用来源和版本留痕？" : ""
    ].filter(Boolean)
  };

  return {
    hasActionable: true,
    summary: `${signals.join("、")}成为本轮新增强线索。`,
    signals,
    conclusions,
    pains,
    solutions,
    requirements,
    internalNotes: [
      ...(hasVideoVision
        ? [
            "不建议直接承诺现有监控摄像头一定能完成产线级识别；必须先看样例视频、角度、清晰度、光照和遮挡。",
            "不建议把需求只表述为“行为识别”，应收敛为可判定的业务规则：错箱、混装、取放路径、包装箱标签或工位区域。"
          ]
        : []),
      "不建议承诺直接替代人工审批或财务最终判断，应定位为辅助核对、异常解释和复核留痕。",
      "不建议一开始承诺打通所有系统，先从可导出的样例数据和单一流程验证。",
      "涉及财务、供应商和开票数据时，需先明确数据脱敏、权限、日志留痕和责任边界。"
    ],
    keywords: [
      ...(hasVideoVision ? ["视频识别", "视觉防错", "违规告警", "大华监控", "产线视频"] : []),
      ...(hasPackagingErrorProofing ? ["包装错箱", "混装防错", "客户包装箱", "电子元器件包装"] : []),
      "跨系统流程",
      "数据核对",
      "供应商对账",
      "开票辅助",
      "流程智能体",
      "异常解释",
      "人工复核"
    ],
    changeSummary: [
      `本轮新增强线索：${signals.join("、")}。`,
      hasLineVisionProofing
        ? "已将优先切入调整为产线视觉防错告警智能体。"
        : "已将优先切入从泛AI/知识库调整为流程智能体与数据核对自动化。",
      "已更新痛点、解决方案、拜访问卷和内部注意事项。"
    ],
    updatedSections: ["评级", "结论与建议", "痛点与机会", "行动指南", "配套解决方案", "拜访问卷", "内部注意事项"]
  };
}

function applyUserSupplementHints(report, userInput) {
  const input = String(userInput || "").trim();
  const feedback = feedbackSignalPack(input);
  const next = {
    ...report,
    userSupplementInsights: [...arr(report.userSupplementInsights), supplementCard(input)],
    changeSummary: feedback.changeSummary || ["已新增“用户补充线索”模块。"],
    updatedSections: feedback.updatedSections || ["用户补充线索"],
    aiNeeds: compactText([report.aiNeeds, feedback.hasActionable ? feedback.summary : input].filter(Boolean).join("；"), 1000),
    roundDelta: feedback
  };
  if (feedback.hasActionable) {
    next.conclusions = mergeByTitle(feedback.conclusions, next.conclusions, 8);
    next.pains = mergeByTitle(feedback.pains, next.pains, 8);
    next.solutions = mergeByTitle(feedback.solutions, next.solutions, 8);
    next.internalNotes = mergeByTitle(feedback.internalNotes, next.internalNotes, 8);
    next.customerInsights = {
      ...(next.customerInsights || {}),
      digitalCards: [
        {
          title: "用户反馈：流程自动化需求",
          body: feedback.summary,
          insight: "该线索来自拜访反馈，不作为公开事实；但可直接用于调整下一轮交流重点。",
          toConfirm: feedback.requirements.onSite
        },
        ...arr(next.customerInsights?.digitalCards)
      ].slice(0, 6)
    };
    next.requirements = {
      ...(next.requirements || {}),
      preMeeting: Array.from(new Set([...arr(feedback.requirements.preMeeting), ...arr(next.requirements?.preMeeting)])).slice(0, 12),
      onSite: Array.from(new Set([...arr(feedback.requirements.onSite), ...arr(next.requirements?.onSite)])).slice(0, 12)
    };
    next.keywords = Array.from(new Set([...arr(next.keywords), ...feedback.keywords]));
  }
  if (isDfmInput(input)) {
    next.changeSummary.push("已强化研发 DFM/可制造性评审相关痛点、方案和现场确认问题。");
    next.updatedSections.push("研究结论", "经营痛点", "初步方案", "前置要求");
    next.conclusions = [
      { title: "补充线索", body: "客户已提出研发侧 DFM 能力诉求，建议把交流重点从泛 AI 介绍收敛到“研发知识沉淀、可制造性评审、工艺经验复用”的可验证场景。" },
      ...arr(next.conclusions).filter((item) => item.title !== "补充线索")
    ].slice(0, 6);
    next.customerInsights = {
      ...(next.customerInsights || {}),
      digitalCards: [
        supplementCard("客户提出研发需要 DFM 能力，可能涉及可制造性评审、工艺知识复用、设计问题闭环和跨部门协同。"),
        ...arr(next.customerInsights?.digitalCards)
      ].slice(0, 6)
    };
    next.pains = [
      {
        title: "研发 DFM 与工艺知识复用",
        sourceBasis: "用户提供线索：客户提出研发需要 DFM 能力；待现场确认其设计评审、工艺评审、问题闭环和知识库现状。",
        reasoning: "若研发阶段缺少结构化 DFM 规则和历史问题复用，容易在设计转制造、试制、量产导入中产生返工、沟通成本和经验依赖。",
        validationSignals: ["是否已有 DFM 检查清单/规则库", "设计评审问题是否能结构化沉淀", "研发、工艺、质量之间的问题闭环周期", "历史问题是否能按产品/零件/工艺快速检索"],
        aiEntry: "研发 DFM 知识助手：把设计规范、工艺经验、质量问题和历史评审记录沉淀为可问答、可追溯、可复用的规则与建议。"
      },
      ...arr(next.pains).filter((item) => !/DFM|可制造性|研发/.test(`${item.title}${item.aiEntry}`))
    ].slice(0, 6);
    next.solutions = [
      {
        priority: "P1",
        title: "研发 DFM 知识助手",
        why: "客户已直接提出 DFM 能力诉求，属于比泛办公 AI 更明确的业务切入点。",
        how: "先确认 DFM 资料范围、历史问题样例、评审流程和责任部门，再评估知识库问答、规则检索、评审清单生成和问题闭环辅助。"
      },
      ...arr(next.solutions).filter((item) => !/DFM|可制造性|研发/.test(`${item.title}${item.how}`))
    ].slice(0, 5);
    next.requirements = {
      ...(next.requirements || {}),
      preMeeting: [
        "DFM 需求由哪个部门提出：研发、工艺、质量、制造工程还是管理层。",
        "是否有可脱敏的 DFM 清单、设计规范、历史评审问题、工艺问题和返工案例。",
        ...arr(next.requirements?.preMeeting)
      ].slice(0, 10),
      onSite: [
        "现场确认 DFM 的业务目标：减少设计返工、缩短评审周期、复用工艺经验，还是支撑新人上手。",
        "确认 DFM 规则是否需要与 PLM/MES/QMS 或文档库集成。",
        ...arr(next.requirements?.onSite)
      ].slice(0, 10)
    };
    next.keywords = Array.from(new Set([...arr(next.keywords), "DFM", "可制造性评审", "研发知识库", "工艺知识复用", "设计问题闭环"]));
  }
  next.changeSummary = Array.from(new Set(next.changeSummary));
  next.updatedSections = Array.from(new Set(next.updatedSections));
  return normalizeReportShape(next);
}

export async function improveStructuredReport(report, userInput) {
  const currentRound = activeRound(normalizeReportShape(report));
  const safeReport = {
    reportId: report.reportId,
    standardName: report.standardName,
    sellerProfileName: report.sellerProfileName,
    sellerProfileSnapshot: report.sellerProfileSnapshot,
    opportunityRating: report.opportunityRating,
    activeRoundNo: report.activeRoundNo,
    latestRound: {
      roundNo: currentRound.roundNo,
      conclusions: currentRound.conclusions,
      painsAndOpportunities: currentRound.painsAndOpportunities,
      solutionCards: currentRound.solutionCards,
      questionnaire: currentRound.questionnaire,
      internalNotes: currentRound.internalNotes
    },
    sourceBriefs: arr(report.sourceBriefs).slice(0, 5),
    sources: normalizeReportSources(report.sources || [], 16).map(({ text, readable, ...source }, index) => ({
      sourceId: source.sourceId || index + 1,
      title: source.title,
      url: source.url,
      confidence: source.confidence,
      sourceType: source.sourceType,
      usedFor: source.usedFor || source.topic || source.query
    }))
  };
  const messages = [
    {
      role: "system",
      content: "你是售前客户研究与解决方案顾问。只返回严格 JSON，不要 Markdown。用户补充内容必须标为“用户提供线索”或转成“现场问题”，不得伪装成公开事实。"
    },
    {
      role: "user",
      content: `请基于当前商机报告和用户补充信息，完善报告结构。用于一线会前准备，语言直接、专业、可外发。
硬性要求：
1. 不要新增或编造来源，不要生成 sources 字段。
2. 必须返回 changeSummary、updatedSections、userSupplementInsights。
3. 先提炼用户补充信息中的“业务场景、现有做法、客户痛点、目标效果、关键约束、下一步样例”。只要出现具体业务场景或客户目标，就必须影响至少一个结论、一个痛点、一个方案和一个前置问题，不得只追加摘要。
4. 如果补充信息涉及 DFM/可制造性/研发/工艺评审，必须新增或强化“研发 DFM 知识助手/可制造性评审/工艺知识复用”相关内容。
5. 如果补充信息涉及视频、监控、视觉识别、违规告警、生产线、包装、错装、混装，必须新增或强化“视觉识别/产线防错/告警闭环”相关内容。
6. 如果补充信息涉及材料、公文、会议纪要、讲话稿、专报、知识库、政策术语、格式规范，必须新增或强化“材料智能体/本地知识库/格式专员/研判分析”相关内容。
7. 保持原有 JSON 字段结构。
用户补充信息：${userInput}
当前报告：${JSON.stringify(safeReport, null, 2)}`
    }
  ];
  let answer;
  let parsed;
  try {
    answer = await callModel(messages, { runtimeMode: report.runtimeMode, temperature: 0.12, maxTokens: 16000, timeoutMs: 220000 });
    parsed = extractJson(answer.content);
  } catch (error) {
    answer = { model: "local-supplement-rule", channel: "local", content: "" };
    parsed = {
      changeSummary: [`模型完善暂时失败，已先根据补充信息生成规则化更新：${error.message}`],
      updatedSections: ["用户补充线索"]
    };
  }
  const now = new Date().toISOString();
  const usedModels = uniqModelUsage([...(report.usedModels || []), { model: answer.model, channel: answer.channel, purpose: "补充信息完善" }]);
  const merged = {
    ...report,
    ...parsed,
    reportId: report.reportId,
    companyName: report.companyName,
    companyKey: report.companyKey,
    generatedAt: report.generatedAt,
    updatedAt: now,
    durationMs: report.durationMs,
    sources: report.sources || [],
    sourceCount: report.sourceCount,
    rawSourceCount: report.rawSourceCount,
    verifiedSourceCount: report.verifiedSourceCount,
    readableSourceCount: report.readableSourceCount,
    topicCoverageCount: report.topicCoverageCount,
    coveredTopics: report.coveredTopics,
    missingTopics: report.missingTopics,
    qualityLevel: report.qualityLevel,
    qualityLabel: report.qualityLabel,
    qualityWarnings: report.qualityWarnings || [],
    userSupplements: [...arr(report.userSupplements), { at: now, text: userInput }],
    modelName: answer.model,
    modelChannel: `${answer.channel}/refine`,
    usedModels,
    modelDisplay: modelDisplay({ ...report, ...parsed, modelName: answer.model, usedModels })
  };
  return applyUserSupplementHints(merged, userInput);
}

function ratingOf(report) {
  const rating = report.opportunityRating;
  if (rating?.version === OPPORTUNITY_RATING_VERSION) return rating;
  return buildOpportunityRating(report);
}

function ratingClass(rating) {
  if (rating.status !== "rated") return "rating-not-rated";
  return `rating-${String(rating.grade || "D").toLowerCase()}`;
}

function ratingTitle(rating) {
  if (rating.status !== "rated") return "暂不评级";
  return `${rating.grade || "-"}级｜${rating.priorityLevel || rating.label}｜${rating.score}分`;
}

function usefulRatingEvidence(items = []) {
  return arr(items)
    .map((item) => cleanBusinessText(item, 180))
    .filter(meaningful)
    .filter((item) => !isNonDecisionClaim(item))
    .filter((item) => !/[？?]$/.test(item) && !/本次项目的预算来源、审批流程、付款主体和决策链分别由谁负责/.test(item))
    .filter((item) => !/资料中出现|可读来源|主题覆盖|初访判断门槛|系统已检索信用\/法律风险方向|报告已识别可能相关|资料显示客户具备一定信息化|已绑定我的企业|目标客户线索与我的企业存在关键词重合|报告形成了\s*\d+\s*个|来源质量提醒|项目级预算归属、推进人和IT\/安全审批决定是否升级重方案投入/.test(item))
    .slice(0, 3);
}

function ratingTextKey(value = "") {
  return cleanBusinessText(value, 260).replace(/[。；;，,、：:\s'"“”‘’()（）【】\[\]\-—_·|/\\.!！？?]/g, "");
}

function dedupeRatingItems(items = [], blocked = []) {
  const blockedKeys = arr(blocked).map(ratingTextKey).filter(Boolean);
  const seen = new Set();
  return arr(items)
    .filter((item) => {
      const key = ratingTextKey(item);
      if (!key) return false;
      if (blockedKeys.some((blockedKey) => key.includes(blockedKey) || blockedKey.includes(key))) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

function ratingDisplaySummary(report = {}, item = {}) {
  const round = activeRound(report);
  const key = String(item.key || "");
  const budgetMetrics = [
    bestMetricText(report, [/营收|营业收入|净销售|收入/]),
    bestMetricText(report, [/净利润|利润|归母|扣非/]),
    bestMetricText(report, [/现金流/]),
    bestMetricText(report, [/毛利/]),
    bestMetricText(report, [/研发/])
  ].filter((value) => meaningful(value) && !/不公示|未公示|未披露|选择不公示|未取得|暂无|待核验/.test(value));
  const topPain = arr(round.painsAndOpportunities).find((pain) => meaningful(pain.title || pain.pain || pain.opportunity)) || {};
  const topSolution = arr(round.solutionCards).find((solution) => meaningful(solution.title)) || {};
  const scene = shortSceneTitle(topSolution.title || topPain.title || topPain.pain || topPain.opportunity || "");
  const scenarioBasis = buildScenarioCoreBasis(report);
  const decisionPeople = firstDecisionPeopleSummary(arr(report.sources));
  const riskEvidence = usefulRatingEvidence([
    ...arr(item.deductions),
    ...arr(item.evidence),
    ...arr(report.opportunityRating?.riskFlags),
    report.opportunityRating?.riskGate?.summary,
    ...arr(report.opportunityRating?.riskGate?.reasons)
  ]);
  const hardRisks = riskEvidence.filter((text) => /被执行|失信|诉讼|行政处罚|经营异常|付款|回款|合同纠纷|信用\/法律/.test(text));
  const boundaryRisks = riskEvidence.filter((text) => /安全|合规|数据|接口|审批|系统/.test(text));

  if (key === "budgetAbility") {
    if (budgetMetrics.length) {
      return {
        conclusion: `预算承载只能由已查到的经营金额辅助判断：${budgetMetrics.slice(0, 4).join("；")}。项目级预算仍需单独核实，不把经营规模直接等同采购意愿。`,
        evidence: budgetMetrics
      };
    }
    const indirectBudgetEvidence = usefulRatingEvidence([...arr(item.evidence), ...arr(item.deductions)])
      .filter((text) => /融资|注册资本|人员规模|资质|营收|利润|现金流|预算|采购|项目|经营实力|经营体量/.test(text))
      .filter((text) => !/当前主要是间接经营实力线索/.test(text));
    if (indirectBudgetEvidence.length) {
      return {
        conclusion: `预算证据偏间接：${indirectBudgetEvidence.slice(0, 2).join("；")}。本轮只能按小闭环验证处理，不能写成项目级预算已明确。`,
        evidence: indirectBudgetEvidence
      };
    }
    return {
      conclusion: "未查到可展示的营收、利润、现金流或项目预算金额，本轮不形成预算强判断。",
      evidence: []
    };
  }
  if (key === "triggerStrength") {
    return scene
      ? {
        conclusion: `需求方向集中在“${scene}”，评级只把它作为待验证需求，不把静态荣誉或注册地当成进入窗口。`,
        evidence: usefulRatingEvidence([topPain.sourceBasis, topPain.reasoning, topPain.customerSignal, topSolution.customerPain, topSolution.introduction, scenarioBasis])
      }
      : {
        conclusion: "未形成具体需求方向，评级不把泛数字化或行业背书当成真实需求触发。",
        evidence: []
      };
  }
  if (key === "decisionRiskControl") {
    if (hardRisks.length) {
      return {
        conclusion: `存在明确商务或信用风险，当前应降低投入优先级：${hardRisks[0]}。`,
        evidence: hardRisks
      };
    }
    if (decisionPeople && boundaryRisks.length) {
      return {
        conclusion: `决策风险中等：公开资料能看到${decisionPeople}等组织线索，但系统接入、数据安全或合规审批仍可能影响落地节奏。`,
        evidence: [decisionPeople]
      };
    }
    if (boundaryRisks.length) {
      return {
        conclusion: "决策风险中等：未发现信用或法律否决项，但系统接入、数据安全或合规审批属于落地变量，不能据此直接放大投入。",
        evidence: []
      };
    }
    if (decisionPeople) {
      return {
        conclusion: `公开资料只能看到${decisionPeople}等角色线索，尚不能确认本项目需求发起人、技术把关人和最终拍板路径。`,
        evidence: [decisionPeople]
      };
    }
    return {
      conclusion: "未查到本项目真实拍板链条，不把工商高管或泛组织信息写成确定决策路径。",
      evidence: []
    };
  }
  if (key === "capabilityFit") {
    const sellerOffer = arr(report.sellerProfileSnapshot?.coreProducts || report.sellerProfileSnapshot?.coreOfferings).slice(0, 2).join("、");
    return scene
      ? {
        conclusion: `${sellerOffer ? `我方能力“${sellerOffer}”` : "我方能力"}与“${scene}”存在初步交集，只有客户确认场景、数据和系统边界后才升级方案。`,
        evidence: usefulRatingEvidence([scenarioBasis, topSolution.introduction, topSolution.value])
      }
      : {
        conclusion: "尚未形成足够具体的客户场景，能力匹配只能作为推测信息。",
        evidence: usefulRatingEvidence([scenarioBasis])
      };
  }
  if (key === "implementationReadiness") {
    const systemEvidence = usefulRatingEvidence([
      ...arr(item.evidence),
      ...arr(item.deductions),
      ...arr(round.customerInfo).flatMap((section) => arr(section.items).flatMap((entry) => [entry.body, entry.insight, entry.summary, ...arr(entry.facts)]))
    ]).filter((text) => /数据|接口|系统|MES|APS|ERP|WMS|LIMS|SCADA|PLM|QMS|权限|安全|部署|样例/.test(text));
    return systemEvidence.length
      ? {
        conclusion: `落地条件重点看数据、接口、系统和安全边界：${systemEvidence.slice(0, 2).join("；")}。`,
        evidence: systemEvidence
      }
      : {
        conclusion: "未查到具体系统、数据、接口或部署条件，交付准备度只能保守看待。",
        evidence: []
      };
  }
  const conclusion = cleanBusinessText(item.conclusion || "", 220);
  if (/项目级预算归属、推进人和IT\/安全审批决定是否升级重方案投入/.test(conclusion)) {
    return {
      conclusion: "该维度缺少具体事实，本轮只作为推测信息保留，不写成确定判断。",
      evidence: []
    };
  }
  return {
    conclusion,
    evidence: usefulRatingEvidence(item.evidence)
  };
}

function ratingDisplayParts(report = {}, item = {}) {
  const display = ratingDisplaySummary(report, item);
  const conclusion = cleanBusinessText(display.conclusion || item.conclusion, 260);
  const evidence = dedupeRatingItems(usefulRatingEvidence(display.evidence?.length ? display.evidence : item.evidence), [conclusion]);
  const deductions = dedupeRatingItems(usefulRatingEvidence(item.deductions), [conclusion, ...evidence]);
  return { display: { ...display, conclusion }, evidence, deductions };
}

function ratingPanel(report) {
  const rating = ratingOf(report);
  const basis = usefulDecisionText(rating.modelBasis) || "OAC 初访优先级模型参考 BANT、MEDDICC 和售前交付可行性评估，用于判断初次拜访前是否值得投入售前资源。";
  const method = usefulDecisionText(rating.scoringMethod) || "评分采用加权评分、关键短板封顶和风险闸门；只展示可形成判断的维度。";
  const minimum = rating.minimumDimension?.title ? `${rating.minimumDimension.title} ${rating.minimumDimension.score}分` : "";
  const modelNote =
    rating.status === "rated"
      ? `<div class="rating-model-note">
          <article><b>模型依据</b><p>${e(cleanBusinessText(basis, 260))}</p></article>
          <article><b>计分方式</b><p>${e(cleanBusinessText(`${method}${minimum ? ` 当前短板：${minimum}。` : ""}`, 420))}</p></article>
        </div>`
      : "";
  const riskGateSummary = usefulDecisionText(rating.riskGate?.summary || "");
  const riskGateReasons = arr(rating.riskGate?.reasons).map(usefulDecisionText).filter(Boolean);
  const riskGate = riskGateSummary || riskGateReasons.length
    ? `<div class="risk-gate">
        <b>风险闸门</b>
        ${riskGateSummary ? `<p>${e(cleanBusinessText(riskGateSummary, 220))}</p>` : ""}
        ${riskGateReasons.length ? `<ul>${riskGateReasons.map((item) => `<li>${e(cleanBusinessText(item, 180))}</li>`).join("")}</ul>` : ""}
      </div>`
    : "";
  const guidance =
    rating.status === "rated"
      ? `<div class="rating-guidance">
          <article>
            <b>售前投入建议</b>
        <p>${e(cleanBusinessText(rating.presalesAdvice || rating.nextAction || "锁定客户真实需求和下一步动作。", 220))}</p>
          </article>
          <article>
            <b>升级投入闸门</b>
            <ul>${arr(rating.qualificationConditions).map((item) => `<li>${e(cleanBusinessText(item, 180))}</li>`).join("") || "<li>锁定客户主体、参会角色、业务场景和数据边界。</li>"}</ul>
          </article>
          <article>
            <b>暂缓/降级信号</b>
            <ul>${arr(rating.disqualificationSignals).map((item) => `<li>${e(cleanBusinessText(item, 180))}</li>`).join("") || "<li>没有明确业务场景、推进人或下一步动作。</li>"}</ul>
          </article>
          <article>
            <b>资源边界</b>
            <p>${e(cleanBusinessText(rating.resourceBoundary || "定制方案、投入边界和POC范围在关键输入锁定后再进入。", 220))}</p>
          </article>
        </div>`
      : "";
  const details =
    rating.status === "rated"
      ? `<div class="rating-detail">
          ${modelNote}
          <div class="rating-dim-grid">
            ${arr(rating.dimensions)
              .filter((item) => item.status !== "unknown")
              .filter((item) => usefulDecisionText(ratingDisplaySummary(report, item).conclusion || item.conclusion || ""))
              .map((item) => {
                const { display, evidence, deductions } = ratingDisplayParts(report, item);
                return `<article class="rating-dim">
                  <div class="rating-dim-head"><b>${e(item.title)}</b><strong>${e(item.displayScore || `${item.score}分`)}</strong></div>
                  <div class="rating-bar"><i style="width:${Math.max(0, Math.min(Number(item.score) || 0, 100))}%"></i></div>
                  <p><b>结论</b>${e(cleanBusinessText(display.conclusion || item.conclusion, 260))}</p>
                  ${evidence.length ? `<p><b>论据</b>${e(joinRatingReadable(evidence))}</p>` : ""}
                  ${deductions.length ? `<p><b>关键短板</b>${e(joinRatingReadable(deductions))}</p>` : ""}
                </article>`;
              })
              .join("")}
          </div>
          ${arr(rating.riskFlags).map(usefulDecisionText).filter(Boolean).length ? `<div class="risk-tags">${arr(rating.riskFlags).map(usefulDecisionText).filter(Boolean).map((item) => `<span>${e(item)}</span>`).join("")}</div>` : ""}
          ${riskGate}
          ${guidance}
        </div>`
      : `<div class="rating-detail"><p>${e(rating.notRatedReason || "当前只适合做资格筛选。")}</p></div>`;
  return `<section class="rating-section"><details class="rating-card ${e(ratingClass(rating))}">
    <summary>
      <div class="rating-score">
        ${icon(rating.status === "rated" ? "Trophy" : "CircleAlert")}
        <b>${e(ratingTitle(rating))}</b>
        <span>${e(usefulDecisionText(rating.summary) || rating.presalesAdvice || rating.nextAction || rating.notRatedReason || "本轮不展示无证据评级结论")}</span>
      </div>
      <div class="rating-toggle">${icon("ChevronDown")}查看评估理由</div>
    </summary>
    ${details}
  </details></section>`;
}

function ratingBadge(report) {
  const rating = ratingOf(report);
  const title = rating.status === "rated" ? `${rating.grade || "-"}｜${rating.score ?? "-"}分` : "暂不评级";
  const basis = usefulDecisionText(rating.modelBasis) || "OAC 初访优先级模型参考 BANT、MEDDICC 和售前交付可行性评估，用于判断初次拜访前是否值得投入售前资源。";
  const method = usefulDecisionText(rating.scoringMethod) || "评分采用加权评分、关键短板封顶和风险闸门；只展示可形成判断的维度。";
  const minimum = rating.minimumDimension?.title ? `当前短板：${rating.minimumDimension.title} ${rating.minimumDimension.score}分。` : "";
  const dimensions = arr(rating.dimensions)
    .filter((item) => item.status !== "unknown")
    .filter((item) => usefulDecisionText(ratingDisplaySummary(report, item).conclusion || item.conclusion || ""))
    .slice(0, 6);
  return `<details class="cover-rating-badge ${e(ratingClass(rating))}">
    <summary>
      ${icon(rating.status === "rated" ? "Trophy" : "CircleAlert")}
      <span>商机评级</span>
      <b>${e(title)}</b>
    </summary>
    <div class="cover-rating-popover">
      <strong>${e(usefulDecisionText(rating.summary) || rating.presalesAdvice || rating.notRatedReason || "本轮不展示无证据评级结论")}</strong>
      ${rating.status === "rated" ? `<div class="cover-rating-model">
        <b>模型说明</b>
        <p>${e(cleanBusinessText(`${basis} ${method} ${minimum}`, 520))}</p>
      </div>` : ""}
      ${dimensions.length ? `<div class="cover-rating-dims">${dimensions
        .map((item) => {
          const { display, evidence, deductions } = ratingDisplayParts(report, item);
          return `<article>
            <div><b>${e(item.title)}</b><span>${e(item.displayScore || `${item.score}分`)}</span></div>
            <p>${e(cleanBusinessText(display.conclusion || item.conclusion, 220))}</p>
            ${evidence.length ? `<small>论据：${e(joinRatingReadable(evidence))}</small>` : ""}
            ${deductions.length ? `<small>短板：${e(joinRatingReadable(deductions))}</small>` : ""}
          </article>`;
        })
        .join("")}</div>` : ""}
    </div>
  </details>`;
}

function displayQualityLabel(report = {}) {
  const label = String(report.qualityLabel || "正式报告");
  if (/证据不足|资料有限/.test(label)) return "线索参考版";
  if (/简版|来源偏少/.test(label)) return "简版报告";
  return label;
}

function qualityBanner(report) {
  const warnings = formatQualityWarnings(report.qualityWarnings || []);
  const title =
    report.qualityLevel === "diagnostic"
      ? "线索偏少，仅作检索诊断"
      : report.qualityLevel === "limited"
        ? "线索有限，仅供会前参考"
        : report.qualityLevel === "brief"
          ? "来源偏少，建议谨慎使用"
          : "来源达到正式报告门槛";
  return `<div class="quality-banner quality-${e(report.qualityLevel || "formal")}">
    <b>${e(title)}</b>
    <span>质量：${e(displayQualityLabel(report))}｜来源 ${e(sourceDisplay(report))}｜可读来源 ${e(report.readableSourceCount ?? 0)} 条｜主题覆盖 ${e(report.topicCoverageCount ?? 0)} 类</span>
    ${warnings.length ? `<ul>${warnings.map((item) => `<li>${e(item)}</li>`).join("")}</ul>` : ""}
  </div>`;
}

function annualReportPanel(report) {
  const evidence = report.annualReportEvidence;
  if (!evidence) return "";
  const metrics = arr(evidence.metrics).filter(renderableMetric).slice(0, 9);
  const sections = arr(evidence.sections).slice(0, 6);
  return `<details class="annual-panel">
    <summary><h2>年报提取信息</h2><span>展开核对自动提取的财务、人员和章节证据</span></summary>
    <div class="annual-summary">
      <div><b>${e(evidence.fileName || "用户上传年报")}</b><span>${e(evidence.pageCount || "-")} 页｜可读文字 ${e(evidence.textLength || 0)} 字｜证据优先级：用户上传资料</span></div>
      <p>年报只作为会前证据包使用，自动提取结果建议与原 PDF 表格核对。</p>
    </div>
    ${metrics.length ? `<div class="metric-grid annual-metrics">${metrics.map((item) => `<div class="metric"><b>${e(item.label)}</b><strong>${e(displayMetricValue(item))}</strong>${evidenceLinks({ annualPage: item.page, evidenceExcerpt: item.context, annualFileName: evidence.fileName }, [])}<span>用户上传年报${item.page ? `第 ${e(item.page)} 页` : ""}，建议按原 PDF 表格核对口径。</span></div>`).join("")}</div>` : ""}
    ${sections.length ? `<div class="grid two">${sections.map((item) => `<article class="card"><h3>${e(item.title)}</h3><p>${e(item.excerpt)}</p><small>页码：${e(item.page)}</small></article>`).join("")}</div>` : ""}
  </details>`;
}

function sensitiveVerificationSection(report) {
  const categories = arr(report.sensitiveVerification?.categories);
  if (!categories.length) return "";
  const impactful = categories.filter(hasImpactfulSensitiveRisk);
  const cards = categories
    .map((item) => {
      const evidence = arr(item.evidence).slice(0, 4);
      const queries = arr(item.searchedQueries).slice(0, 4);
      return `<article class="verification-card verification-${e(item.status || "unknown")}">
        <div class="verification-head">
          <h3>${e(item.label)}</h3>
          <span>${e(item.statusLabel || item.status || "已核验")}</span>
        </div>
        <p>${e(item.summary || "系统已完成公开核验。")}</p>
        ${item.disposition ? `<div class="label">报告处理</div><p>${e(item.disposition)}</p>` : ""}
        ${evidence.length ? `<div class="verification-evidence">${evidence
          .map((source) => {
            const url = cleanUrl(source.url);
            return `<a href="${e(url)}" target="_blank" rel="noreferrer">
              <b>${e(source.title || source.domain || "核验来源")}</b>
              <small>${e([source.domain, source.confidence, source.supportLevel].filter(Boolean).join("｜"))}</small>
              ${source.excerpt ? `<em>${e(clip(source.excerpt, 160))}</em>` : ""}
            </a>`;
          })
          .join("")}</div>` : `<div class="muted">系统未取得可直接公开证实的来源。</div>`}
        ${queries.length ? `<details class="verification-queries"><summary>已检索方向</summary>${list(queries)}</details>` : ""}
      </article>`;
    })
    .join("");
  const impactCards = impactful
    .map((item) => `<article class="card risk-card"><h3>${e(item.label)}</h3><p>${e(item.summary || item.statusLabel || "该项会影响商机判断。")}</p><small>${e(item.disposition || "已按核验结果进入风险判断。")}</small></article>`)
    .join("");
  return `<section>
    <h2>系统核验记录</h2>
    ${
      impactful.length
        ? `<p class="lead">以下为已证实、多源支持或存在冲突且会影响商机判断的风险。</p><div class="grid two">${impactCards}</div>`
        : `<p class="lead">系统已完成信用、法律、股权、财务和重大项目信息复核，未发现足以进入研究结论的已证实风险。</p>`
    }
    <details class="verification-details">
      <summary>查看完整核验记录</summary>
      <div class="grid two">${cards}</div>
    </details>
  </section>`;
}

function userSupplementSection(report) {
  const cards = arr(report.userSupplementInsights);
  if (!cards.length) return "";
  return `<section><h2>用户补充线索</h2><div class="grid two">${evidenceCards(cards)}</div></section>`;
}

function opportunityFitSection(report) {
  const fit = report.opportunityFit || {};
  const profile = report.sellerProfileSnapshot || {};
  if (!fit.summary && !profile.companyName) return "";
  const cards = [
    {
      title: "我方企业",
      body: profile.companyName || report.sellerProfileName || "未绑定我的企业",
      insight: profile.summary || "旧报告未绑定我的企业。"
    },
    {
      title: "能力契合点",
      facts: arr(fit.fitPoints).length ? fit.fitPoints : arr(profile.coreOfferings),
      insight: fit.summary || "需要补充我的企业信息后再判断匹配度。"
    },
    {
      title: "可切入场景",
      facts: arr(fit.entryScenarios).length ? fit.entryScenarios : arr(profile.typicalScenarios),
      insight: "用于把交流从标准功能介绍收敛到可验证场景。"
    },
    {
      title: "承诺边界",
      facts: arr(fit.noCommitments).length ? fit.noCommitments : arr(profile.noCommitments),
      insight: "避免在需求、数据和验收口径不清时过度承诺。"
    }
  ];
  return `<section><h2>2. 我方能力匹配</h2><div class="grid four">${evidenceCards(cards)}</div>${arr(fit.validationQuestions).length ? `<div class="card fit-questions"><h3>会前验证问题</h3>${list(fit.validationQuestions)}</div>` : ""}</section>`;
}

function renderDiagnosticSections(report) {
  const diagnosis = report.diagnosis || {};
  return `
    <section><h2>1. 检索诊断</h2>${cardGrid(report.conclusions)}</section>
    <section><h2>2. 未达门槛原因</h2>
      <div class="grid two">
        <article class="card"><h3>已覆盖主题</h3>${list(diagnosis.coveredTopics)}</article>
        <article class="card"><h3>缺少主题</h3>${list(diagnosis.missingTopics)}</article>
      </div>
    </section>
    <section><h2>3. 建议补充信息</h2>
      <div class="require-grid">
        <article class="card"><h3>会前尽量了解</h3>${list(report.requirements?.preMeeting)}</article>
        <article class="card"><h3>现场顺势探问</h3>${list(report.requirements?.onSite)}</article>
      </div>
    </section>`;
}

function activeRound(report) {
  const rounds = arr(report.rounds);
  if (!rounds.length) return buildBattleRound(report, "pre_visit");
  return rounds.find((round) => Number(round.roundNo) === Number(report.activeRoundNo)) || rounds[rounds.length - 1];
}

function conclusionByTitle(round, patterns = [], fallback = "") {
  const cards = arr(round.conclusions);
  for (const pattern of patterns) {
    const found = cards.find((item) => pattern.test(String(item.title || "")));
    if (found) return compactText(found.body || found.summary || found.insight, 180);
  }
  return compactText(fallback, 180);
}

function shortRatingText(report) {
  const rating = ratingOf(report);
  if (rating.status !== "rated") return "暂不评级";
  return `${rating.priorityLevel || rating.grade || "观察"}｜${rating.score ?? "-"}分`;
}

function isGenericTopJudgment(value = "") {
  const text = String(value || "").replace(/\s+/g, "");
  if (!text) return true;
  return /具备跟进价值|先把客户痛点|决策链和预算窗口问实|当前信息置信度|基于公开证据|建议先做轻量验证|再决定是否投入/.test(text);
}

function buildExecutiveBrief(report, round) {
  const rating = ratingOf(report);
  let oneLine = stripFieldPrefix(conclusionByTitle(round, [/一句话|判断|是否值得/], `${report.standardName || "该客户"}建议先做轻量验证，再决定是否投入方案资源。`), ["一句话判断", "判断"]);
  if (isGenericTopJudgment(oneLine)) {
    oneLine = stripFieldPrefix(rating.summary || rating.presalesAdvice || oneLine, ["建议", "一句话判断", "判断"]);
  }
  const entry = stripFieldPrefix(conclusionByTitle(round, [/优先切入|先切|切入/], arr(round.solutionCards)[0]?.title || arr(round.painsAndOpportunities)[0]?.opportunity || "先从最容易验证价值的小场景切入。"), ["优先切入", "先切"]);
  const rawRisk = cleanBusinessText(stripFieldPrefix(conclusionByTitle(round, [/风险|注意/], deriveOpportunityRisk(report)), ["风险", "主要风险", "商机风险"]), 220);
  const risk = usefulDecisionText(rawRisk) ? rawRisk : "";
  const next = stripFieldPrefix(conclusionByTitle(round, [/下一步|动作|建议/], rating.nextAction || rating.presalesAdvice || "锁定参会角色、真实痛点、预算归属和可验证样例。"), ["下一步", "下一步动作", "建议"]);
  const reason = stripFieldPrefix(conclusionByTitle(round, [/依据|理由|核心/], arr(round.painsAndOpportunities)[0]?.pain || "基于公开证据、客户画像和我方能力匹配度形成初步判断。"), ["核心依据", "依据", "理由"]);
  if (isUnsupportedSchedulingDemandText(oneLine, { report, round })) {
    const scene = shortSceneTitle(
      arr(round.solutionCards).find((item) => meaningful(item.title))?.title ||
        arr(round.painsAndOpportunities).find((item) => meaningful(item.title || item.pain || item.opportunity))?.title ||
        entry,
      44
    );
    oneLine = scene
      ? `${report.standardName || "该客户"}具备工业数字化和AI场景基础，但具体需求仍需围绕“${scene}”现场验证；建议先做轻量场景澄清，再决定方案投入。`
      : `${report.standardName || "该客户"}具备进一步沟通价值，但具体需求和预算仍需现场验证；建议先做轻量场景澄清，再决定方案投入。`;
  }
  return {
    oneLine: cleanBusinessText(oneLine, 260),
    entry: cleanBusinessText(entry, 220),
    risk: cleanBusinessText(risk, 220),
    next: cleanBusinessText(next, 220),
    reason: cleanBusinessText(reason, 220),
    rating: shortRatingText(report)
  };
}

function isNarrowFinanceAction(value = "") {
  const text = String(value || "");
  return /营业收入|净利润|毛利率|现金流|研发投入|财务指标|经营指标/.test(text) && !/场景|痛点|负责人|推进|验证|样例|方案|业务|流程/.test(text);
}

function shortSceneTitle(value = "", max = 32) {
  const text = cleanBusinessText(value, 90)
    .replace(/^\s*(?:P[0-9]|优先级[一二三四五六七八九十0-9]+)\s*[｜|:：-]\s*/i, "")
    .trim();
  if (!text) return "";
  const parts = text
    .split(/[：:｜|]/)
    .map((item) => cleanBusinessText(item, max + 12))
    .filter(meaningful);
  const preferred =
    parts.find((item) => /场景|方案|平台|智能体|知识库|排产|质量|视觉|经营|材料|系统|Holli|MES|APS|ERP|WMS|LIMS/i.test(item)) ||
    parts[0] ||
    text;
  return cleanBusinessText(preferred, max);
}

function salesForwardNextAction(report, round, brief = buildExecutiveBrief(report, round)) {
  const explicitNext = stripFieldPrefix(conclusionByTitle(round, [/下一步|动作|建议/], ""), ["下一步", "下一步动作", "建议"]);
  const candidates = [explicitNext, brief.next, ratingOf(report).presalesAdvice]
    .map((item) => cleanBusinessText(item, 160))
    .filter((item) => usefulDecisionText(item) && !isNarrowFinanceAction(item));
  const solution = arr(round.solutionCards).find((item) => meaningful(item.title));
  if (solution?.title) {
    return sellerCapabilityMode(report) === "digital"
      ? `围绕“${shortSceneTitle(solution.title)}”约业务和IT/数据负责人做场景澄清，锁定样例、价值指标和下一步验证方式。`
      : `围绕“${shortSceneTitle(solution.title)}”约采购、研发、质量或项目负责人做品类澄清，锁定技术规格、样品测试、报价边界和下一步验证方式。`;
  }
  const pain = arr(round.painsAndOpportunities).find((item) => meaningful(item.title || item.pain || item.opportunity));
  if (pain) {
    return `围绕“${shortSceneTitle(pain.title || pain.pain || pain.opportunity)}”做一次场景访谈，锁定问题强度、责任人和可验证样例。`;
  }
  return candidates[0] || (sellerCapabilityMode(report) === "digital"
    ? "约业务负责人和技术/数据负责人做场景澄清，锁定真实痛点、样例数据和下一步验证方式。"
    : "约采购、研发、质量或项目负责人做品类澄清，锁定技术规格、样品测试、报价边界和下一步验证方式。");
}

function dimensionByKey(report, key) {
  return arr(report.opportunityRating?.dimensions).find((item) => item.key === key) || {};
}

function supportBullets(values = [], max = 3) {
  return arr(values)
    .map((item) => cleanBusinessText(item, 140))
    .filter(meaningful)
    .filter((item) => !isNonDecisionClaim(item))
    .filter((item) => !/可读来源|主题覆盖|初访判断门槛|资料显示|资料中出现|系统已检索|报告已识别/.test(item))
    .slice(0, max);
}

function bestMetricText(report, patterns = []) {
  const metrics = arr(report.customerInsights?.metrics).filter(renderableMetric);
  const found = metrics.find((item) => patterns.some((pattern) => pattern.test(`${item.label || ""} ${item.title || ""} ${item.value || ""}`)));
  if (!found) return "";
  const label = found.label || found.title || "经营指标";
  const value = displayMetricValue(found);
  if (!meaningful(value)) return "";
  return `${label}：${value}`;
}

function firstDecisionPeopleSummary(sources = []) {
  const people = usefulDecisionPeople(extractDecisionPeople(sources));
  if (!people.length) return "";
  return people
    .slice(0, 3)
    .map((person) => `${person.name}（${person.role}）`)
    .join("、");
}

function buildSalesPyramid(report, round, sources = []) {
  const explicit = round.salesThesis || report.salesThesis || {};
  const rating = ratingOf(report);
  const brief = buildExecutiveBrief(report, round);
  const budget = dimensionByKey(report, "budgetAbility");
  const decision = dimensionByKey(report, "decisionRiskControl");
  const budgetMetrics = [
    bestMetricText(report, [/营收|营业收入|净销售|收入/]),
    bestMetricText(report, [/净利润|利润|归母|扣非/]),
    bestMetricText(report, [/现金流/]),
    bestMetricText(report, [/研发/])
  ].filter((item) => Boolean(item) && !/不公示|未公示|未披露|未单独披露|选择不公示|未取得|暂无|待核验/.test(item));
  const budgetEvidence = supportBullets([...budgetMetrics, ...arr(budget.evidence), ...arr(budget.deductions)], 4);
  const people = firstDecisionPeopleSummary(sources);
  const decisionEvidence = supportBullets([people ? `可查角色：${people}` : "", ...arr(decision.evidence), ...arr(decision.deductions)], 4);
  const operatingEvidence = supportBullets([
    brief.entry,
    brief.next,
    ...arr(rating.qualificationConditions),
    ...allRenderedQuestions(round, report)
  ], 4);
  const cards = [
    {
      title: "是否值得继续跟",
      verdict: explicit.worthFollowing || rating.summary || brief.oneLine,
      evidence: supportBullets([brief.reason, ...arr(rating.qualificationConditions)], 3),
      tone: rating.grade === "A" || rating.grade === "S" ? "strong" : rating.grade === "C" || rating.grade === "D" ? "watch" : "normal"
    },
    {
      title: "预算/买单能力",
      verdict:
        explicit.budgetJudgment ||
        (budgetEvidence.length
          ? budget.conclusion || "客户存在经营、采购或项目线索支撑，适合先做小闭环价值验证；预算来源和付款主体决定是否升级重方案。"
          : ""),
      evidence: budgetEvidence,
      requiresEvidence: true,
      tone: budget.score >= 75 ? "strong" : budget.score < 58 ? "risk" : "watch"
    },
    {
      title: "决策链/拍板路径",
      verdict:
        explicit.decisionPath ||
        (decisionEvidence.length
          ? decision.conclusion || "当前入口应从可见经营/职能角色切入，项目推进人和最终拍板路径决定成交效率。"
          : ""),
      evidence: decisionEvidence,
      requiresEvidence: true,
      tone: decision.score >= 75 ? "strong" : decision.score < 58 ? "risk" : "watch"
    },
    {
      title: "怎么运作更合适",
      verdict: explicit.operatingAdvice || rating.presalesAdvice || brief.next,
      evidence: operatingEvidence.length ? operatingEvidence : ["只有拿到具体场景、样例数据和下一步责任人，才值得升级方案投入。"],
      tone: "normal"
    }
  ].filter((card) => usefulDecisionText(card.verdict) && (!card.requiresEvidence || arr(card.evidence).length));
  return {
    summary: explicit.summary || brief.oneLine,
    sourceIds: Array.from(new Set([...arr(round.sourceIds), ...arr(round.conclusions).flatMap((item) => normalizeSourceIdList(item))])).slice(0, 6),
    cards
  };
}

function executiveBriefSection(report, round, sources) {
  const pyramid = buildSalesPyramid(report, round, sources);
  const brief = buildExecutiveBrief(report, round);
  const rating = ratingOf(report);
  return `<section class="executive-brief sales-pyramid">
    <div class="brief-main">
      <span class="brief-label">一句话结论</span>
      <h2>${e(cleanBusinessText(pyramid.summary, 260))}</h2>
      <p>${e(cleanBusinessText(rating.summary || brief.reason, 260))}</p>
      ${pyramid.sourceIds.length ? evidenceLinks({ sourceIds: pyramid.sourceIds }, sources) : ""}
    </div>
    <div class="brief-side sales-pyramid-grid">
      ${pyramid.cards.map((card) => `<article class="${e(card.tone || "")}"><span>${e(card.title)}</span><b>${e(cleanBusinessText(card.verdict, 260))}</b>${arr(card.evidence).length ? `<small>${e(cleanBusinessText(joinReadable(card.evidence), 320))}</small>` : ""}</article>`).join("")}
    </div>
  </section>`;
}

function coverDecisionStrip(report, round, sources = []) {
  const pyramid = buildSalesPyramid(report, round, sources);
  const brief = buildExecutiveBrief(report, round);
  const rating = ratingOf(report);
  const forwardNext = salesForwardNextAction(report, round, brief);
  const budgetDimension = dimensionByKey(report, "budgetAbility");
  const budgetMetrics = [
    bestMetricText(report, [/营收|营业收入|净销售|收入/]),
    bestMetricText(report, [/净利润|利润|归母|扣非/]),
    bestMetricText(report, [/现金流/]),
    bestMetricText(report, [/研发/])
  ].filter((item) => Boolean(item) && !/不公示|未公示|未披露|选择不公示|未取得|暂无|待核验/.test(item));
  const budgetSignal = combinedSignal(round, sources, /营收|营业收入|净利润|利润|现金流|研发投入|注册资本|实缴|融资|上市|招标|中标|采购|预算|项目金额|合同金额|固定资产|扩产|产能/i, 3);
  const byTitle = (pattern) => arr(pyramid.cards).find((card) => pattern.test(String(card.title || ""))) || {};
  const worth = byTitle(/值得|优先级|投入/);
  const budget = byTitle(/预算|买单/);
  const decision = byTitle(/决策|采购|拍板/);
  const budgetValue =
    usefulDecisionText(budget.verdict) ||
    usefulDecisionText(budgetDimension.conclusion) ||
    (budgetMetrics.length
      ? `买单能力先看经营指标，当前可重点参考${budgetMetrics.slice(0, 2).join("、")}。`
      : arr(budgetSignal.evidence).length
        ? "客户存在项目化采购信号，首轮应围绕预算来源、采购流程和付款主体判断是否升级投入。"
        : "第一轮只做场景价值验证，不投入重方案或定制POC。");
  const budgetNote =
    usefulEvidenceTexts([arr(budget.evidence)[0], arr(budgetSignal.evidence)[0], arr(budgetDimension.evidence)[0], arr(budgetDimension.deductions)[0]].filter(isConcreteBudgetEvidence), 1)[0] ||
    "";
  const { risk, riskNote } = businessRiskSummary(report, rating, brief);
  const cards = [
    {
      label: "评级",
      value: rating.status === "rated" ? `${rating.grade || "-"}级｜${rating.score ?? "-"}分` : shortRatingText(report),
      note: arr(worth.evidence)[0] || rating.nextAction,
      tone: "strong"
    },
    {
      label: "预算/买单",
      value: budgetValue,
      note: budgetNote,
      tone: budget.tone || "watch"
    },
    {
      label: "决策链",
      value:
        usefulDecisionText(decision.verdict) ||
        "先从可见经营角色和历史采购线索切入，项目推进人、预算归属和拍板路径决定成交效率。",
      note: "",
      tone: decision.tone || "watch"
    },
    {
      label: "风险/避坑",
      value: risk,
      note: "",
      tone: "risk"
    },
    {
      label: "下一步",
      value: forwardNext,
      note: "",
      tone: "next"
    }
  ]
    .map((card) => ({ ...card, value: coverCardValue(card.value), note: usefulDecisionText(card.note) }))
    .filter((card) => usefulDecisionText(card.value));
  const seenCoverSignals = [];
  for (const card of cards) {
    const valueKey = normalizeForCompare(card.value);
    const noteKey = normalizeForCompare(card.note);
    const duplicated = noteKey && seenCoverSignals.some((key) => key && (key.includes(noteKey) || noteKey.includes(key)));
    if (duplicated || (noteKey && valueKey && (valueKey.includes(noteKey) || noteKey.includes(valueKey)))) {
      card.note = "";
    }
    seenCoverSignals.push(valueKey);
    if (card.note) seenCoverSignals.push(normalizeForCompare(card.note));
  }
  if (!cards.length) return "";
  return `<section class="cover-decision-strip">
    ${cards.map((card) => `<article class="${e(card.tone || "")}"><span>${e(card.label)}</span><b>${e(card.value)}</b>${card.note ? `<small>${e(card.note)}</small>` : ""}</article>`).join("")}
  </section>`;
}

function coverCardValue(value = "") {
  const cleaned = cleanBusinessText(value, 190);
  const first = splitChineseSentences(cleaned)[0] || cleaned;
  return cleanBusinessText(first, 150);
}

function coverRiskText(value = "") {
  const risk = cleanBusinessText(value, 110)
    .replace(/^风险[：:，,\s]*/g, "")
    .replace(/^风险线索[：:，,\s]*/g, "")
    .trim();
  if (!risk) return "";
  if (/^(?:线索|需核验|待核验)[，,、；;\s]*(?:需核验|待核验)?/.test(risk)) return "";
  if (/商机风险优先看财务\/经营指标|系统已通过官方\/法院\/信用平台/.test(risk)) return "";
  return risk;
}

function businessRiskSummary(report = {}, rating = {}, brief = {}) {
  const decisionRisk = dimensionByKey(report, "decisionRiskControl");
  const actionableRiskFlags = arr(rating.riskFlags)
    .map((item) => actionableRiskText(item, 180))
    .filter(meaningful);
  const actionableDeductions = arr(decisionRisk.deductions)
    .map((item) => actionableRiskText(item, 180))
    .filter(meaningful);
  const riskBag = [
    ...actionableRiskFlags,
    ...actionableDeductions,
    rating.riskGate?.summary,
    ...arr(rating.riskGate?.reasons),
    brief.risk
  ].join("；");
  const riskNote =
    usefulEvidenceTexts([...actionableDeductions, ...actionableRiskFlags, ...arr(rating.riskGate?.reasons), brief.risk], 1)[0] ||
    "";
  if (!riskNote) {
    return {
      risk: "",
      riskNote: ""
    };
  }
  const risk =
    /项目级|预算归属|决策|拍板|采购权/.test(riskBag)
      ? "最大商务风险是项目级预算归属和拍板路径，绕错入口会消耗售前资源。"
      : /付款|回款|信用|法律|诉讼|被执行|合同/.test(riskBag)
        ? "付款、信用和合同风险决定是否升级投入，复核前只适合轻量推进。"
        : /数据|系统|安全|IT|审批|合规/.test(riskBag)
        ? "主要落地风险在IT、数据和安全审批边界。"
        : usefulEvidenceTexts([brief.risk, ...arr(rating.riskFlags)], 1)[0] || "";
  return { risk, riskNote };
}

function roundTabs(report) {
  const rounds = arr(report.rounds);
  if (rounds.length <= 1) return "";
  return `<section class="round-switch"><details><summary>历史轮次与拜访反馈</summary><div class="round-tabs" role="tablist">${rounds
    .map((round) => `<button class="${Number(round.roundNo) === Number(report.activeRoundNo) ? "active" : ""}" type="button" data-round-target="round-${e(round.roundNo)}">第 ${e(round.roundNo)} 轮｜${round.type === "post_visit" ? "拜访反馈" : "会前研判"}</button>`)
    .join("")}</div></details></section>`;
}

function roundConclusionCards(report, round, sources) {
  return `<section class="battle-section">
    <h2>1. 结论与建议</h2>
    <div class="battle-hero-grid">
      ${arr(round.conclusions).slice(0, 5).map((item) => `<article class="battle-card conclusion-card"><h3>${e(item.title)}</h3>${evidenceLinks(item, sources)}<p>${e(item.body || item.summary || item.insight)}</p></article>`).join("")}
    </div>
  </section>`;
}

function roundFeedbackInline(round) {
  if (round.type !== "post_visit") return "";
  const rawText = String(round.inputText || "").trim();
  const summary = feedbackNeedSummary(rawText) || (meaningful(round.inputSummary) ? round.inputSummary : "");
  const changes = arr(round.changeSummary)
    .filter(meaningful)
    .filter((item) => !/商机评级由|信息尚不足以改变|尚不足以改变评级|没有产生实质变化/.test(String(item || "")))
    .slice(0, 3);
  const raw = rawText;
  const delta = round.roundDelta || {};
  const signals = arr(delta.signals).filter(meaningful).slice(0, 8);
  const structured = feedbackStructuredSummary(rawText, delta);
  if (!structured.length && !summary && !changes.length && !raw && !signals.length) return "";
  return `<section class="round-feedback-inline">
    <div>
      <span>本轮拜访反馈提炼</span>
      ${signals.length ? `<p><b>新增信号：</b>${e(signals.join("、"))}</p>` : ""}
      ${structured.length ? `<div class="feedback-summary-grid">${structured.map((item) => `<article><b>${e(item.title)}</b><p>${e(item.body)}</p></article>`).join("")}</div>` : summary ? `<p>${e(summary)}</p>` : ""}
      ${changes.length ? `<small>${e(joinReadable(changes))}</small>` : ""}
      ${raw ? `<details class="round-raw"><summary>查看原始记录</summary><pre>${e(raw)}</pre></details>` : ""}
    </div>
  </section>`;
}

function sourceText(source = {}) {
  return compactText([source.title, source.snippet, source.evidenceExcerpt, source.relevanceReason, source.text].filter(Boolean).join(" "), 2400);
}

function decisionItemText(item = {}) {
  return [item.title, item.label, item.body, item.summary, item.insight, item.note, ...arr(item.facts), ...arr(item.toConfirm)].filter(Boolean).join(" ");
}

function isDecisionText(value = "") {
  return /决策|采购|预算|立项|招标|中标|合同|法定代表人|董事长|总经理|实际控制人|负责人|股东|控股|集团|总部|上市|港股|证券|股票|交易所|IT负责人|信息化|数字化负责人/.test(
    String(value || "")
  );
}

function isConcreteDecisionSignal(value = "") {
  const text = compactText(value, 260);
  if (!isDecisionText(text)) return false;
  if (
    /资料中出现|资料显示|可读来源|主题覆盖|初访判断门槛|系统已检索|报告已识别|可能相关|仍可能不清|风险项较多|不等同于|待确认|需.*确认|当前存在明显短板|信息置信度|尚未取得|只能保守/.test(
      text
    )
  ) {
    return false;
  }
  return /法定代表人|董事长|总经理|实际控制人|执行董事|董事|监事|经理|负责人|股东|控股|母公司|子公司|总部|上市|港股|证券|股票|交易所|采购|招标|中标|合同|立项|预算|投资|付款|回款/.test(
    text
  );
}

function isConcreteBudgetSignal(value = "") {
  const text = compactText(value, 220);
  if (
    /资料中出现|资料显示|可读来源|主题覆盖|初访判断门槛|系统已检索|报告已识别|可能相关|仍可能不清|风险项较多|不等同于|待确认|需.*确认|当前存在明显短板|信息置信度/.test(
      text
    )
  ) {
    return false;
  }
  return /营收|收入|销售额|利润|净利|现金流|研发投入|预算|投资|采购|招标|中标|合同|立项|付款|回款|万元|亿元/.test(text);
}

function validPersonName(name = "") {
  const text = String(name || "").trim();
  if (!/^[\u4e00-\u9fa5]{2,4}$/.test(text)) return false;
  return !/公司|有限|股份|集团|宁波|科技|电器|电子|信息|智能|董事|经理|代表|法人|暂无|人员|来源|客户|企业/.test(text);
}

function extractDecisionPeople(sources = []) {
  const people = new Map();
  const add = (name, role, source, index, text = "") => {
    if (!validPersonName(name) || !meaningful(role)) return;
    const key = `${name}-${role}`;
    const sid = sourceId(source, index);
    const previous = people.get(key) || { name, role, sourceIds: [], insight: "", contact: "" };
    previous.sourceIds = Array.from(new Set([...previous.sourceIds, sid])).slice(0, 4);
    const around = compactText(text, 180);
    if (!previous.insight && /履历|曾任|毕业|采访|表示|认为|提出|强调|致辞|公开/.test(around)) {
      previous.insight = around;
    }
    if (!previous.contact) {
      const contact = around.match(/(?:电话|手机|联系方式|邮箱|Email|E-mail)[：:\s]*([0-9\-+（）() ]{7,}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
      if (contact?.[1]) previous.contact = compactText(contact[1], 80);
    }
    people.set(key, previous);
  };
  arr(sources).forEach((source, index) => {
    const text = sourceText(source);
    if (!text) return;
    const patterns = [
      { re: /(法定代表人|董事长|总经理|实际控制人|执行董事|董事|监事|经理|负责人)[：:\s]{0,8}([\u4e00-\u9fa5]{2,4})/g, roleIndex: 1, nameIndex: 2 },
      { re: /([\u4e00-\u9fa5]{2,4})(?:，|,|\s|现任|担任|为|任|系|是){0,6}(法定代表人|董事长|总经理|实际控制人|执行董事|董事|监事|经理|负责人)/g, roleIndex: 2, nameIndex: 1 }
    ];
    for (const pattern of patterns) {
      let match = null;
      while ((match = pattern.re.exec(text))) {
        add(match[pattern.nameIndex], match[pattern.roleIndex], source, index, text.slice(Math.max(0, match.index - 80), match.index + 160));
      }
    }
  });
  return Array.from(people.values()).slice(0, 6);
}

function extractDecisionPeopleFromRound(round = {}) {
  const people = new Map();
  const add = (name, role, sourceIds = [], text = "") => {
    if (!validPersonName(name) || !meaningful(role)) return;
    const key = `${name}-${role}`;
    const previous = people.get(key) || { name, role, sourceIds: [], insight: "", contact: "" };
    previous.sourceIds = Array.from(new Set([...previous.sourceIds, ...arr(sourceIds).map(Number).filter(Number.isFinite)])).slice(0, 4);
    const around = compactText(text, 180);
    if (!previous.insight && /法定代表人|董事长|总经理|实际控制人|执行董事|主要人员|高管|负责人|分管|公开/.test(around)) {
      previous.insight = around;
    }
    if (!previous.contact) {
      const contact = around.match(/(?:电话|手机|联系方式|邮箱|Email|E-mail)[：:\s]*([0-9\-+（）() ]{7,}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
      if (contact?.[1]) previous.contact = compactText(contact[1], 80);
    }
    people.set(key, previous);
  };
  arr(round.customerInfo).forEach((section) => {
    arr(section.items).forEach((item) => {
      const text = decisionItemText(item);
      if (!text) return;
      const sourceIds = normalizeSourceIdList(item);
      const patterns = [
        { re: /(法定代表人|董事长|总经理|实际控制人|执行董事|董事|监事|经理|负责人)[：:\s]{0,8}([\u4e00-\u9fa5]{2,4})/g, roleIndex: 1, nameIndex: 2 },
        { re: /([\u4e00-\u9fa5]{2,4})(?:，|,|\s|现任|担任|为|任|系|是){0,6}(法定代表人|董事长|总经理|实际控制人|执行董事|董事|监事|经理|负责人)/g, roleIndex: 2, nameIndex: 1 }
      ];
      for (const pattern of patterns) {
        let match = null;
        while ((match = pattern.re.exec(text))) {
          add(match[pattern.nameIndex], match[pattern.roleIndex], sourceIds, text.slice(Math.max(0, match.index - 80), match.index + 160));
        }
      }
    });
  });
  return Array.from(people.values()).slice(0, 6);
}

function mergeDecisionPeople(...groups) {
  const people = new Map();
  groups.flat().filter(Boolean).forEach((person) => {
    if (!validPersonName(person.name) || !meaningful(person.role)) return;
    const key = `${person.name}-${person.role}`;
    const previous = people.get(key) || { ...person, sourceIds: [], insight: "", contact: "" };
    previous.sourceIds = Array.from(new Set([...arr(previous.sourceIds), ...arr(person.sourceIds)].map(Number).filter(Number.isFinite))).slice(0, 4);
    previous.insight = previous.insight || person.insight || "";
    previous.contact = previous.contact || person.contact || "";
    people.set(key, previous);
  });
  return Array.from(people.values()).slice(0, 8);
}

function decisionRoleValue(role = "", insight = "") {
  const text = `${role} ${insight}`;
  if (/实际控制人|董事长|总经理|法定代表人|执行董事/.test(text)) return "经营/拍板线索";
  if (/信息化|数字化|IT|技术|研发|质量|生产|设备|供应链|采购|财务|招标|合同|项目负责人/.test(text)) return "项目相关职能线索";
  if (/公开表态|采访|表示|提出|强调|主导|牵头|负责|分管/.test(text)) return "公开履历/表达线索";
  return "";
}

function decisionPersonAction(person = {}) {
  const role = String(person.role || "");
  if (/实际控制人|董事长|总经理|法定代表人|执行董事/.test(role)) return "可作为预算、立项或最终拍板链路的上层核对对象。";
  if (/信息化|数字化|IT|技术/.test(role)) return "可核对其是否参与系统选型、数据接入和安全评审。";
  if (/质量|生产|设备|供应链|采购|财务/.test(role)) return "可核对其是否掌握业务痛点、付款条件或落地约束。";
  if (/负责人/.test(role)) return "需进一步确认其负责范围，以及是否参与本次项目。";
  return "";
}

function usefulDecisionPeople(people = []) {
  return arr(people)
    .filter((person) => {
      const role = String(person.role || "");
      const insight = String(person.insight || "");
      const sourceCount = arr(person.sourceIds).length;
      if (/高管|股东|监事|主要人员/.test(role) && !insight) return false;
      if (/法定代表人|董事长|总经理|实际控制人|执行董事/.test(role)) return true;
      if (/信息化|数字化|IT|技术|研发|质量|生产|设备|供应链|采购|财务|招标|合同|项目负责人/.test(role)) return true;
      if (/公开表态|采访|表示|提出|强调|履历|曾任|负责|分管|主导|牵头/.test(insight)) return true;
      return sourceCount >= 2 && Boolean(decisionRoleValue(role, insight));
    })
    .slice(0, 5);
}

function decisionSurfaceSection(report, round, sources = []) {
  const people = usefulDecisionPeople(mergeDecisionPeople(extractDecisionPeople(sources), extractDecisionPeopleFromRound(round)));
  const sectionSignals = arr(round.customerInfo)
    .flatMap((section) =>
      arr(section.items).map((item) => ({
        title: item.title || item.label || section.title || "决策线索",
        body: compactText(item.body || item.insight || item.summary || arr(item.facts)[0] || "", 220),
        sourceIds: normalizeSourceIdList(item),
        text: `${section.title || ""} ${decisionItemText(item)}`
      }))
    )
    .filter((item) => normalizeSourceIdList(item).length > 0 && isConcreteDecisionSignal(item.text) && meaningful(item.body))
    .slice(0, 4);
  const sourceSignals = sourceSignalRows(
    sources,
    /法定代表人|董事长|总经理|实际控制人|主要人员|高管|股东|控股|集团|总部|上市|港股|采购人|招标人|合同主体|付款主体/,
    4,
    {
      sourcePredicate: (source) => /tianyancha|subject_registry|tender_project|finance_budget|risk_legal/.test(`${source.provider || ""} ${source.structuredProvider || ""} ${source.sourceFamily || ""}`),
      signalPredicate: (text) => isConcreteDecisionSignal(text)
    }
  ).map((row) => ({
    title: "公开组织/采购线索",
    body: row.text,
    sourceIds: [row.sourceId],
    text: row.text
  }));
  const actionableSignals = [...sectionSignals, ...sourceSignals]
    .filter((item) => !/资料中出现|资料显示|可读来源|主题覆盖|待确认|不等同于/.test(item.body))
    .slice(0, 3);
  const personBranches = people.map((person) => ({
    title: `${person.name}｜${person.role}`,
    claim: [
      decisionRoleValue(person.role, person.insight) || "公开角色线索",
      decisionPersonAction(person) || "需核实其是否参与本次项目"
    ].filter(Boolean).join("："),
    evidence: [
      person.contact ? `公开联系方式：${person.contact}` : "",
      person.insight ? compactText(person.insight, 130) : ""
    ].filter(meaningful),
    sourceIds: person.sourceIds,
    forceDisplay: true
  }));
  const orgBranches = actionableSignals.map((item) => ({
    title: item.title,
    claim: item.body,
    evidence: [],
    sourceIds: item.sourceIds,
    forceDisplay: true
  }));
  const executivePeople = people.filter((person) => /法定代表人|董事长|总经理|实际控制人|执行董事/.test(`${person.role || ""} ${person.insight || ""}`));
  const projectPeople = people.filter((person) => /信息化|数字化|IT|技术|研发|质量|生产|设备|供应链|采购|财务|招标|合同|项目负责人/.test(`${person.role || ""} ${person.insight || ""}`));
  const allSourceIds = Array.from(
    new Set([
      ...people.flatMap((person) => arr(person.sourceIds)),
      ...actionableSignals.flatMap((item) => arr(item.sourceIds))
    ].map(Number).filter(Number.isFinite))
  ).slice(0, 8);
  const summary = people.length
    ? `公开信息能确认${people.slice(0, 3).map((person) => `${person.name}（${person.role}）`).join("、")}等角色；项目级发起人、技术把关人和预算审批人仍要在拜访中拆开核实。`
    : "未查到可直接用于推进的公开关键人；本轮不能假设工商负责人就是项目拍板人。";
  const evidenceRows = [
    executivePeople.length
      ? {
          title: "经营层公开角色",
          body: executivePeople.slice(0, 4).map((person) => `${person.name}｜${person.role}${person.contact ? `｜${person.contact}` : ""}`).join("；"),
          sourceIds: executivePeople.flatMap((person) => arr(person.sourceIds))
        }
      : null,
    projectPeople.length
      ? {
          title: "项目对口公开角色",
          body: projectPeople.slice(0, 4).map((person) => `${person.name}｜${person.role}${person.contact ? `｜${person.contact}` : ""}`).join("；"),
          sourceIds: projectPeople.flatMap((person) => arr(person.sourceIds))
        }
      : null,
    actionableSignals.length
      ? {
          title: "组织/项目公开线索",
          body: actionableSignals.map((item) => item.body).slice(0, 2).join("；"),
          sourceIds: actionableSignals.flatMap((item) => arr(item.sourceIds))
        }
      : null
  ].filter(Boolean);
  const invalid = !evidenceRows.length;
  return `<section class="decision-chain-compact">
    <div class="decision-chain-head ${invalid ? "invalid" : ""}">
      <span>决策链条</span>
      <b>${e(summary)}</b>
      ${evidenceRows.length ? `<div class="decision-chain-evidence">
        ${evidenceRows.map((row) => `<article>
          <em>${e(row.title)}</em>
          <p>${e(row.body)}</p>
          ${normalizeSourceIdList(row).length ? evidenceLinks(row, sources) : ""}
        </article>`).join("")}
      </div>` : `<p class="decision-chain-empty">未查到能支撑销售动作的公开关键人、岗位角色或联系方式；本轮不要假设工商负责人就是项目拍板人。</p>`}
    </div>
  </section>`;
}

function customerInfoSections(round, sources) {
  const sections = arr(round.customerInfo)
    .map((section) => ({
      ...section,
      items:
        section.key === "finance"
          ? arr(section.items).filter(renderableMetric)
          : section.key === "risk"
            ? arr(section.items)
                .filter(hasImpactfulSensitiveRisk)
                .filter((item) => usefulDecisionText(item.body || item.insight || item.summary || arr(item.facts)[0] || item.disposition))
            : arr(section.items).filter((item) =>
                usefulDecisionText(item.body || item.insight || item.summary || arr(item.facts)[0] || item.disposition)
              )
    }))
    .filter((section) => arr(section.items).length);
  if (!sections.length) return "";
  return `<section class="battle-section">
    <h2>客户信息</h2>
    <div class="info-section-grid">
      ${sections
        .map((section) => `<article class="info-block"><h3>${e(section.title)}</h3>${arr(section.items)
          .slice(0, section.key === "finance" ? 8 : section.key === "business" ? 12 : 4)
          .map((item) => {
            if (section.key === "finance") {
              return `<div class="info-metric"><b>${e(item.label || item.title || "指标")}</b><strong>${e(displayMetricValue(item))}</strong>${evidenceLinks(item, sources)}${meaningful(item.note) ? `<span>${e(item.note)}</span>` : ""}</div>`;
            }
            const lineText = cleanBusinessText(item.body || item.insight || arr(item.facts)[0] || item.summary, 220);
            return usefulDecisionText(lineText) ? `<div class="info-line"><b>${e(item.title || item.label || "信息")}</b>${evidenceLinks(item, sources)}<p>${e(lineText)}</p></div>` : "";
          })
          .join("")}</article>`)
        .join("")}
    </div>
  </section>`;
}

function buyingAbilitySection(report, round, sources = []) {
  const rating = report.opportunityRating || {};
  const budget = arr(rating.dimensions).find((item) => item.key === "budgetAbility") || {};
  const metrics = arr(report.customerInsights?.metrics);
  const validMetrics = metrics
    .filter(renderableMetric)
    .filter((item) => /营收|营业收入|净销售|收入|利润|现金流|研发|资产负债|负债率|注册资本|实缴|融资/.test(`${item.label || ""} ${item.title || ""}`))
    .slice(0, 6);
  const evidence = arr(budget.evidence)
    .filter((item) => meaningful(item) && !/尚未取得|只能作为初访参考|资料不足|未公开|不公示/.test(item))
    .slice(0, 3);
  const deductions = arr(budget.deductions)
    .filter((item) => meaningful(item) && !/尚未取得|只能保守|未公开|不公示/.test(item))
    .slice(0, 3);
  const hasHardMetric = validMetrics.some((item) => /营收|营业收入|净销售|收入|利润|现金流|研发|资产负债|负债率|注册资本|实缴|融资/.test(`${item.label || ""} ${item.title || ""}`));
  const hasClearJudgment = budget.score >= 72 || budget.score < 58 || evidence.length >= 2 || deductions.length || hasHardMetric;
  if (!hasClearJudgment) return "";
  return `<section class="battle-section buying-section">
    <h2>经营与买单能力</h2>
    <div class="buying-grid">
      <article class="buying-verdict">
        <span>初访判断</span>
        <b>${e(cleanBusinessText(budget.conclusion || "预算与付款能力需结合客户现场信息继续核验。", 220))}</b>
        ${budget.displayScore || budget.score ? `<small>预算与付款能力：${e(budget.displayScore || `${budget.score}分`)}</small>` : ""}
      </article>
      ${validMetrics.length ? `<article class="buying-card"><h3>可用经营指标</h3>${validMetrics
        .map((item) => `<div class="buying-metric"><span>${e(item.label || item.title)}</span><b>${e(displayMetricValue(item))}</b>${evidenceLinks(item, sources)}${meaningful(item.note) ? `<small>${e(compactText(item.note, 90))}</small>` : ""}</div>`)
        .join("")}</article>` : ""}
      ${evidence.length ? `<article class="buying-card"><h3>间接支撑信号</h3>${list(evidence.map((item) => cleanBusinessText(item, 180)))}</article>` : ""}
      ${deductions.length ? `<article class="buying-card caution"><h3>需要保守看待</h3>${list(deductions.map((item) => cleanBusinessText(item, 180)))}</article>` : ""}
    </div>
  </section>`;
}

function painsAndOpportunitySection(round, sources) {
  const pains = arr(round.painsAndOpportunities).filter((item) => meaningful(item.title) || meaningful(item.pain) || meaningful(item.opportunity));
  if (!pains.length) return "";
  return `<section class="battle-section">
    <h2>痛点与机会</h2>
    <div class="pain-grid">
      ${pains.map((item) => `<article class="pain-card"><h3>${e(item.title)}</h3>${evidenceLinks(item, sources)}
        ${meaningful(item.customerSignal) ? `<div class="label">客户现象</div><p>${e(item.customerSignal)}</p>` : ""}
        ${meaningful(item.pain) ? `<div class="label">痛点判断</div><p>${e(item.pain)}</p>` : ""}
        ${meaningful(item.opportunity) ? `<div class="entry">${e(item.opportunity)}</div>` : ""}
        ${arr(item.toConfirm).length ? `<div class="label">现场确认</div>${list(item.toConfirm)}` : ""}
      </article>`).join("")}
    </div>
  </section>`;
}

function buildSolutionStrategy(report, round) {
  const explicit = round.solutionStrategy || report.solutionStrategy || {};
  const sellerMode = sellerCapabilityMode(report);
  const solutions = cleanDecisionSolutions(arr(round.solutionCards).filter((item) => meaningful(item.title)), { report, round });
  const pains = alignPainPrioritiesWithSolutions(arr(round.painsAndOpportunities).filter((item) => meaningful(item.title) || meaningful(item.pain)), solutions, 8);
  const topPain = pains[0] || {};
  const p0 = solutions.find((item) => String(item.priority || "").toUpperCase() === "P0") || solutions[0] || {};
  const ranked = solutions.slice(0, 5).map((item, index) => ({
    priority: normalizePriorityLabel(item.priority, index),
    title: item.title || "建议方案",
    why: item.value || item.why || item.expectedImpact || item.customerPain || ""
  }));
  const defaultPath = [
    ...(sellerMode === "digital"
      ? [
          "业务访谈先锁定真实痛点、责任部门和预算归属。",
          "P0场景先采集样例数据和流程材料，定义边界、指标和成功标准。",
          "按轻量验证、小范围试点、系统或知识体系集成三步推进。"
        ]
      : [
          "先确认客户具体车型、品类、现有供应商和技术/认证要求。",
          "P0场景先拿一个产品线做样品、测试、报价或份额提升闭环。",
          "按样品验证、小批试用、供应商准入和批量供货路径推进。"
        ])
  ];
  return {
    currentSituation: explicit.currentSituation || topPain.pain || topPain.customerSignal || "",
    overallApproach:
      (sellerMode === "digital" || !digitalSolutionAssumptionText(explicit.overallApproach) ? explicit.overallApproach : "") ||
      (p0.title
        ? sellerMode === "digital"
          ? `围绕“${p0.title}”建立第一切入点，再用知识库、数据问答或自动化能力补齐交付和复用链路。`
          : `围绕“${p0.title}”建立第一切入点，再按产品匹配、样品验证、商务准入和批量供货路径推进。`
        : "先把客户问题收敛到一个可验证场景，再逐步扩大到流程、数据和组织协同。"),
    rankedSolutions: arr(explicit.rankedSolutions).length ? cleanDecisionSolutions(explicit.rankedSolutions, { report, round }) : ranked,
    implementationPath: arr(explicit.implementationPath).filter((item) => sellerMode === "digital" || !digitalSolutionAssumptionText(item)).length
      ? arr(explicit.implementationPath).filter((item) => sellerMode === "digital" || !digitalSolutionAssumptionText(item))
      : defaultPath
  };
}

function solutionStrategySection(report, round) {
  const strategy = buildSolutionStrategy(report, round);
  const hasContent =
    meaningful(strategy.currentSituation) ||
    meaningful(strategy.overallApproach) ||
    arr(strategy.rankedSolutions).length ||
    arr(strategy.implementationPath).length;
  if (!hasContent) return "";
  return `<section class="battle-section solution-strategy-section">
    <h2>售前解决思路</h2>
    <div class="strategy-grid">
      ${meaningful(strategy.currentSituation) ? `<article><span>客户现状与问题</span><p>${e(strategy.currentSituation)}</p></article>` : ""}
      ${meaningful(strategy.overallApproach) ? `<article><span>总体解决思路</span><p>${e(strategy.overallApproach)}</p></article>` : ""}
      ${arr(strategy.rankedSolutions).length ? `<article><span>方案优先级</span><div class="strategy-rank">${arr(strategy.rankedSolutions).map((item) => `<b>${e(item.priority || "P1")}｜${e(item.title || item.name || "方案")}</b>${meaningful(item.why || item.reason) ? `<small>${e(compactText(item.why || item.reason, 120))}</small>` : ""}`).join("")}</div></article>` : ""}
      ${arr(strategy.implementationPath).length ? `<article><span>落地路径</span>${list(arr(strategy.implementationPath).map((item) => compactText(item, 120)).filter(meaningful))}</article>` : ""}
    </div>
  </section>`;
}

function solutionWorkItems(solution = {}, report = {}) {
  const text = `${solution.title || ""} ${solution.introduction || ""} ${solution.value || ""} ${solution.prerequisite || ""}`;
  const items = [];
  if (sellerCapabilityMode(report) !== "digital") {
    items.push("需求与规格确认：确认车型平台、产品品类、技术参数、认证要求和验收口径。");
    items.push("样品与测试验证：准备样品、测试数据、质量记录和问题闭环。");
    items.push("商务与供应准入：完成报价、供应商准入、账期、交付计划和合同边界。");
    items.push("小批与量产准备：安排产能、物料、工艺、质量控制和交付节奏。");
    return items;
  }
  if (/排产|APS|计划|调度/.test(text)) {
    items.push("排产规则库：维护设备、人员、物料、交期和优先级约束。");
    items.push("优化引擎：输出可解释排程、瓶颈提示和多方案对比。");
    items.push("异常重排模块：处理插单、缺料、设备异常和交期变化。");
    items.push("排产看板：展示产能负荷、计划达成率和异常原因。");
  } else if (/预测性维护|运维|AIOps|故障|维修|备件|处置复盘/.test(text)) {
    items.push("告警知识库：沉淀告警规则、故障原因、处置建议和引用来源。");
    items.push("故障诊断助手：结合设备状态、历史案例和知识库输出排查路径。");
    items.push("工单处置闭环：串联建议、派单、处理记录、备件申请和结果确认。");
    items.push("运维复盘看板：统计告警命中、处理时长、复发问题和知识更新。");
  } else if (/视频|摄像头|视觉|图像|画面|错装|违规动作|行为识别/.test(text)) {
    items.push("视频接入模块：接入摄像头画面、区域配置和工位映射。");
    items.push("行为识别模块：识别违规动作、错装错放和异常停留。");
    items.push("告警联动模块：推送现场告警、留存截图和处置记录。");
    items.push("复核标注台：人工复核误报漏报并沉淀样本。");
  } else if (/知识库|文档|问答|RAG|材料|公文|报告/.test(text)) {
    items.push("知识资产库：沉淀制度、模板、术语、项目文档和案例经验。");
    items.push("检索问答模块：支持多轮问答、出处追溯和权限过滤。");
    items.push("内容生成模块：按模板生成材料、报告、纪要或方案初稿。");
    items.push("知识运营模块：支持更新、审核、版本和反馈闭环。");
  } else if (/智能体|AI|agent|HolliCube|工业AI|平台/.test(text)) {
    items.push("场景智能体中心：管理不同业务场景的智能体、工具和提示词。");
    items.push("工业知识库层：沉淀行业 know-how、工艺规则、产品文档和项目经验。");
    items.push("数据与系统连接器：对接 HolliCube、MES/APS/ERP/WMS/LIMS 等系统数据。");
    items.push("流程编排与工具调用：支持查询、分析、生成、告警和任务流转。");
    items.push("权限审计与运营台：管理角色权限、调用日志、效果反馈和版本迭代。");
  } else {
    items.push("业务应用前台：承载客户侧高频使用入口和关键操作。");
    items.push("数据/知识底座：管理结构化数据、文档知识和业务规则。");
    items.push("系统连接器：对接现有业务系统、权限和日志。");
    items.push("管理后台：配置角色、流程、模板、指标和运营反馈。");
  }
  return Array.from(new Set(items)).slice(0, 5);
}

function solutionWorkPackages(solution = {}, report = {}) {
  const text = `${solution.title || ""} ${solution.introduction || ""} ${solution.value || ""} ${solution.expectedImpact || ""} ${solution.prerequisite || ""}`;
  if (sellerCapabilityMode(report) !== "digital") {
    if (/国六|国七|排放|EGR|涡轮|增压|VTG|SCR|NOx|PM|柴油|天然气/.test(text)) {
      return [
        { title: "排放系统匹配", items: ["国七/国六法规目标和技术路线确认", "EGR率、冷却效率和增压效率参数对齐", "发动机平台和应用工况梳理"] },
        { title: "样机与台架验证", items: ["EGR阀/冷却器/涡轮样机方案", "台架测试工况和性能数据", "耐久、排放和热效率验证闭环"] },
        { title: "定点与量产资料", items: ["技术方案包和标定边界", "质量体系与认证资料", "报价、产能和交付计划"] }
      ];
    }
    if (/新能源|电驱|电机|逆变器|电驱动|热管理|电池热管理|乘员舱热管理|混动|纯电|氢内燃机/.test(text)) {
      return [
        { title: "动力平台匹配", items: ["混动/纯电/氢内燃机技术路线确认", "功率等级、热负荷和布置空间对齐", "现有供应商和定点阶段识别"] },
        { title: "电驱/热管理样件验证", items: ["电机/逆变器/热管理模块规格包", "样件测试计划和台架数据", "热管理边界工况和失效模式复核"] },
        { title: "量产导入准备", items: ["国产化产能与供应周期确认", "质量体系和PPAP资料准备", "小批试供与量产爬坡计划"] }
      ];
    }
    if (/海外工厂|海外新工厂|泰国|越南|东南亚|跨境|本地化配套|本地化供货|海外供货|当地法规/.test(text)) {
      return [
        { title: "海外准入与认证", items: ["目标工厂采购政策确认", "当地法规/认证要求梳理", "客户海外车型技术规格对齐"] },
        { title: "本地化供货方案", items: ["仓储/伙伴/组装模式评估", "交付周期和安全库存设计", "跨境物流与售后响应边界"] },
        { title: "小批验证与放量", items: ["样品和测试计划", "小批订单交付", "质量问题闭环和量产节奏确认"] }
      ];
    }
    if (/成本|年降|毛利|利润|降本/.test(text)) {
      return [
        { title: "成本结构拆解", items: ["材料/工艺/良率成本拆分", "竞品价格与客户目标价对齐", "可让利和不可让利边界确认"] },
        { title: "工艺与质量优化", items: ["良率提升措施", "替代材料或结构优化验证", "质量数据和失效模式复盘"] },
        { title: "商务谈判支撑", items: ["降本测算表", "报价版本管理", "年降交换条件和交付承诺边界"] }
      ];
    }
    if (/车型|定点|研发|技术|专利|执行器|样品|测试/.test(text)) {
      return [
        { title: "车型需求确认", items: ["车型平台和生命周期确认", "执行器/电机/PCBA技术参数对齐", "竞品或自研替代风险识别"] },
        { title: "样品开发验证", items: ["样品方案设计", "测试数据与认证资料准备", "问题清单和改版闭环"] },
        { title: "定点推进材料", items: ["技术方案包", "质量体系与产能证明", "报价和交付计划"] }
      ];
    }
    return [
      { title: "产品匹配确认", items: ["目标品类和应用场景确认", "技术参数/认证/验收口径对齐", "现有供应商与替代边界梳理"] },
      { title: "样品与质量验证", items: ["样品准备", "测试数据和质量记录", "问题闭环与版本确认"] },
      { title: "商务与交付准备", items: ["报价与账期确认", "供应商准入资料", "产能、物料和交付计划"] }
    ];
  }
  if (/排产|APS|计划|调度/.test(text)) {
    return [
      {
        title: "排产规则库",
        items: ["订单优先级与交期规则", "设备/人员/工装/物料约束", "换线、批量、产能和班次规则"]
      },
      {
        title: "排程优化引擎",
        items: ["自动生成排产方案", "多方案仿真比较", "瓶颈设备和延期风险提示"]
      },
      {
        title: "异常重排模块",
        items: ["插单/缺料/设备故障重排", "交期变化影响分析", "重排前后差异说明"]
      },
      {
        title: "排产协同看板",
        items: ["计划达成率看板", "异常原因追踪", "生产/计划/仓储协同提醒"]
      }
    ];
  }
  if (/预测性维护|运维|AIOps|故障|维修|备件|处置复盘/.test(text)) {
    return [
      {
        title: "告警知识库",
        items: ["告警规则入库", "故障原因和处置建议沉淀", "引用出处追溯"]
      },
      {
        title: "故障诊断助手",
        items: ["设备状态摘要", "历史案例匹配", "排查路径生成"]
      },
      {
        title: "工单处置闭环",
        items: ["处置建议推送", "工单和备件申请联动", "处理结果确认"]
      },
      {
        title: "运维复盘看板",
        items: ["告警命中统计", "处理时长分析", "复发问题和知识更新"]
      }
    ];
  }
  if (/视频|摄像头|视觉|图像|画面|错装|违规动作|行为识别/.test(text)) {
    return [
      {
        title: "视频接入与区域配置",
        items: ["摄像头接入", "工位/区域/产线映射", "识别范围和屏蔽区域配置"]
      },
      {
        title: "行为识别能力",
        items: ["违规动作识别", "错装错放识别", "异常停留或越界识别"]
      },
      {
        title: "告警与处置闭环",
        items: ["实时告警推送", "截图/视频片段留存", "处置记录和复盘统计"]
      },
      {
        title: "样本与模型运营",
        items: ["误报漏报复核", "样本标注沉淀", "规则/模型版本管理"]
      }
    ];
  }
  if (/知识库|文档|问答|RAG|材料|公文|报告/.test(text)) {
    return [
      {
        title: "知识资产库",
        items: ["政策/制度/模板入库", "术语和口径管理", "项目案例和经验沉淀"]
      },
      {
        title: "检索问答能力",
        items: ["多源检索", "答案出处追溯", "权限过滤和引用审计"]
      },
      {
        title: "内容生成能力",
        items: ["材料初稿生成", "格式模板套用", "多文风和多场景输出"]
      },
      {
        title: "知识运营后台",
        items: ["知识更新审核", "版本管理", "反馈纠错和持续优化"]
      }
    ];
  }
  if (/智能体|AI|agent|HolliCube|工业AI|平台/.test(text)) {
    return [
      {
        title: "场景智能体中心",
        items: ["智能体模板库", "工具调用配置", "多场景任务编排"]
      },
      {
        title: "工业知识库层",
        items: [
          "行业 know-how 库",
          "产品文档/项目经验库",
          "规则、术语和标准口径库"
        ]
      },
      {
        title: "系统连接器",
        items: [
          "HolliCube 数据接口",
          "MES/APS/ERP/WMS/LIMS 适配",
          "权限、日志和审计接口"
        ]
      },
      {
        title: "业务工作台",
        items: [
          "问答/分析/生成入口",
          "告警与任务流转",
          "效果反馈和运营看板"
        ]
      }
    ];
  }
  return [
    { title: "业务应用前台", items: ["用户入口", "业务操作台", "结果展示与反馈"] },
    { title: "数据/知识底座", items: ["数据对象", "业务规则", "知识文档"] },
    { title: "系统连接器", items: ["接口适配", "权限审计", "日志追踪"] },
    { title: "运营管理后台", items: ["配置管理", "效果统计", "版本迭代"] }
  ];
}

function buildDeliveryAssessment(report, round) {
  const explicit = round.deliveryAssessment || report.deliveryAssessment || {};
  const solutions = arr(round.solutionCards);
  const sellerMode = sellerCapabilityMode(report);
  const prerequisites = Array.from(
    new Set(
      solutions
        .map((item) => item.prerequisite)
        .filter(meaningful)
        .slice(0, 5)
    )
  );
  const questionDeps = arr(round.questionnaire)
    .filter((group) => /IT|数据|风险|边界|预算|决策/.test(group.title || ""))
    .flatMap((group) => arr(group.questions))
    .filter(meaningful)
    .slice(0, 4);
  const firstSolution = solutions[0] || {};
  const architecture =
    explicit.architectureSketch ||
    (firstSolution.title
      ? sellerMode === "digital"
        ? `围绕“${firstSolution.title}”构建：客户业务数据/文档/系统样例 → 知识库或场景智能体 → 业务工作台/告警/报告输出。`
        : `围绕“${firstSolution.title}”构建：客户车型/品类需求 → 样品与测试验证 → 商务准入与供货计划 → 小批/量产交付。`
      : sellerMode === "digital"
        ? "客户业务数据/文档/系统样例 → 知识库或场景智能体 → 工作台/告警/报告输出。"
        : "客户需求规格 → 样品测试 → 商务准入 → 小批/量产交付。");
  const riskTexts = arr(explicit.deliveryRisks)
    .map((item) => actionableRiskText(item, 190))
    .filter(meaningful);
  const dependencyTexts = (arr(explicit.dependencies).length ? arr(explicit.dependencies) : [...prerequisites, ...questionDeps].slice(0, 6))
    .map((item) => actionableDependencyText(item, 190))
    .filter(meaningful);
  const sowTexts = arr(explicit.sowOutline)
    .map(cleanListItem)
    .filter(meaningful)
    .filter((item) => !isDeliveryEstimateText(item))
    .filter((item) => substantiveText(item, 8) && !isNonDecisionClaim(item));
  const fallbackSow = solutions.length
    ? solutions.slice(0, 6).map((item) => {
        const groups = solutionWorkPackages(item, report).map((group) => group.title).filter(meaningful).slice(0, 3);
        return `${cleanBusinessText(item.title || "功能项", 48)}：${groups.length ? groups.join("、") : "输入、处理、输出与管理能力"}`;
      })
    : defaultDeliverySowOutline().map((item) => `${item.title}：${arr(item.items).join("、")}`);
  const fallbackDependencies = [
    ...(sellerMode === "digital"
      ? [
          "现有系统清单、接口/API文档、读写权限、鉴权方式和日志审计要求。",
          "脱敏业务文档、数据样例、字段字典、更新频率和质量规则。",
          "部署方式、网络/服务器资源、安全权限、SSO/账号体系和审计留痕要求。",
          "验收数据集、指标口径、边界样例和变更处理机制。"
        ]
      : [
          "目标车型、产品品类、技术规格、认证要求和验收标准。",
          "样品、图纸/BOM、测试工况、质量问题记录和竞品供应信息。",
          "供应商准入要求、报价口径、账期、合同主体和付款主体。",
          "预测需求量、交付节奏、产能要求、包装/物流和售后响应要求。"
        ])
  ];
  const fallbackRisks = [
    ...(sellerMode === "digital"
      ? [
          "系统接口、权限和脱敏样例未锁定时，只能做轻量验证，不能承诺正式对接效果。",
          "客户已有 HolliCube、和言智能问答等能力，方案定位若变成平台替代会引发技术路线冲突。",
          "多系统数据口径、接口边界和验收指标不清，会影响数据问答、运维闭环和验收口径。"
        ]
      : [
          "技术规格、认证要求和测试工况未锁定时，样品验证可能反复返工。",
          "既有供应商、客户自研替代或目标价压力未摸清时，报价和份额判断容易失真。",
          "预测需求量、交付节奏和质量责任边界不清，会影响小批试用和量产放量。"
        ])
  ];
  return {
    architectureSketch: architecture,
    dependencies: (dependencyTexts.filter(isSpecificDeliveryDependency).length ? dependencyTexts.filter(isSpecificDeliveryDependency) : fallbackDependencies).slice(0, 6),
    deliveryRisks: (riskTexts.length ? riskTexts : fallbackRisks).slice(0, 5),
    responsePlan: arr(explicit.responsePlan || explicit.mitigations || explicit.riskResponses).length
      ? arr(explicit.responsePlan || explicit.mitigations || explicit.riskResponses)
      : (sellerMode === "digital"
        ? [
          "先用一个最小业务闭环验证价值，再决定是否进入系统集成和正式项目范围。",
          "把数据样例、接口权限、部署条件和验收口径列成客户侧准备清单，清单外内容不进入本轮交付范围。",
          "把验收口径提前写清，包括准确率、效率提升、告警命中、报表质量或人工节省口径。"
        ]
        : [
          "先用一个车型/品类的小样品或小批订单验证技术、质量和交付价值。",
          "把规格、认证、样品、报价、账期和准入资料列成客户侧准备清单。",
          "把验收口径提前写清，包括测试指标、质量责任、交付节奏和量产放量条件。"
        ]),
    sowOutline: (sowTexts.length ? sowTexts : fallbackSow).slice(0, 8)
  };
}

function isSpecificDeliveryDependency(value = "") {
  const text = cleanBusinessText(value, 220);
  if (!meaningful(text)) return false;
  if (/负责人|责任人|接口人|联系人|参会|沟通|会后|下一步|预算|采购流程|拍板|决策链|合同|付款/.test(text)) return false;
  if (/锁定客户真实业务样例|锁定验收指标|锁定业务、IT\/数据|系统边界和责任人清单|数据安全要求/.test(text)) return false;
  return /提供|上传|开放|接入|授权|样例|接口|账号|权限|摄像头|视频|工位|产线|系统|ERP|MES|APS|WMS|LIMS|数据|文档|模板|验收|部署|网络|服务器|安全|脱敏|字段|口径|鉴权|审计|车型|品类|技术规格|认证|图纸|BOM|测试|工况|质量|供应商准入|报价|账期|合同主体|付款主体|需求量|产能|物料|包装|物流|售后/.test(text);
}

function deliveryRiskCategory(text = "") {
  if (/技术规格|认证|测试工况|样品|图纸|BOM|参数|质量|失效/.test(text)) return "技术与认证风险";
  if (/供应商|自研|目标价|报价|年降|准入|账期|合同|份额/.test(text)) return "商务准入风险";
  if (/产能|物料|交付|小批|量产|物流|海外|本地化|安全库存/.test(text)) return "供应交付风险";
  if (/接口|系统|ERP|MES|APS|WMS|LIMS|权限|账号|日志|API|SDK|SSO/.test(text)) return "系统集成风险";
  if (/数据|样例|字段|口径|脱敏|知识|文档|质量|主数据|规则/.test(text)) return "数据风险";
  if (/现场|摄像头|视频|设备|网络|服务器|部署|PLC|硬件/.test(text)) return "现场与部署风险";
  if (/算法|模型|识别|优化|仿真|误报|漏报/.test(text)) return "算法与模型风险";
  if (/验收|指标|范围|需求|返工|边界|准确率|SLA/.test(text)) return "验收口径风险";
  if (/安全|合规|权限|审计/.test(text)) return "安全合规风险";
  return "交付风险";
}

function responseForDeliveryRisk(risk = "", response = "") {
  const explicit = cleanBusinessText(response, 180);
  if (meaningful(explicit) && !/先用一个最小业务闭环|把数据样例|把验收口径提前写清/.test(explicit)) return explicit;
  const category = deliveryRiskCategory(risk);
  if (category === "系统集成风险") return "先确认目标系统、接口方式、读写权限、调用频率和日志审计要求。";
  if (category === "技术与认证风险") return "先确认技术规格、测试工况、认证要求和样品验收标准，再承诺开发或交付范围。";
  if (category === "商务准入风险") return "先核对现有供应商、目标价、账期、准入资料和合同边界，再进入正式报价。";
  if (category === "供应交付风险") return "先确认预测需求量、产能、物料、交付节奏和质量责任边界，再承诺放量节奏。";
  if (category === "数据风险") return "先拿到样例数据/文档，确认字段口径、脱敏规则、更新频率和人工复核口径。";
  if (category === "现场与部署风险") return "先确认设备/摄像头/网络/服务器条件，必要时现场踏勘后再承诺效果。";
  if (category === "算法与模型风险") return "先用小样本验证准确率、误报漏报和复核流程，再决定是否扩大模型范围。";
  if (category === "验收口径风险") return "先定义本期功能范围、验收指标、边界样例和变更处理机制。";
  if (category === "安全合规风险") return "先确认部署方式、数据安全、权限分级和审计留痕要求。";
  return "先把风险对应的客户准备项列清，再决定是否进入正式交付范围。";
}

function customerPrepForDeliveryRisk(risk = "", dependency = "") {
  const explicit = cleanBusinessText(dependency, 160);
  if (isSpecificDeliveryDependency(explicit)) return explicit;
  const category = deliveryRiskCategory(risk);
  if (category === "系统集成风险") return "提供现有系统清单、接口文档、测试账号、鉴权方式和权限审计要求。";
  if (category === "技术与认证风险") return "提供图纸/BOM、技术规格、测试工况、认证要求、样品和历史质量问题记录。";
  if (category === "商务准入风险") return "提供供应商准入要求、目标价区间、账期、合同主体和现有供应商边界。";
  if (category === "供应交付风险") return "提供预测需求量、交付节奏、包装物流要求、质量责任和量产放量条件。";
  if (category === "数据风险") return "提供可脱敏样例、字段说明、模板文档和业务口径。";
  if (category === "现场与部署风险") return "提供现场点位、网络/服务器条件、设备型号和部署约束。";
  if (category === "算法与模型风险") return "提供样本集、标注口径、边界样例和人工复核规则。";
  if (category === "验收口径风险") return "提供试点范围、验收指标、边界样例和变更审批规则。";
  if (category === "安全合规风险") return "提供安全规范、部署要求、账号权限和审计留痕要求。";
  return "提供对应样例、系统边界和验收口径。";
}

function deliveryRiskMatrixRows(delivery = {}) {
  const risks = arr(delivery.deliveryRisks).filter((item) => meaningful(item) && !isDeliveryEstimateText(item)).slice(0, 5);
  if (!risks.length) return [];
  return risks.map((risk, index) => ({
    category: deliveryRiskCategory(risk),
    risk: cleanBusinessText(risk, 190),
    response: responseForDeliveryRisk(risk, arr(delivery.responsePlan)[index]),
    prep: customerPrepForDeliveryRisk(risk, arr(delivery.dependencies)[index])
  }));
}

function deliveryAssessmentSection(report, round) {
  const delivery = buildDeliveryAssessment(report, round);
  const rows = deliveryRiskMatrixRows(delivery);
  if (!rows.length) return "";
  return `<section class="battle-section delivery-section">
    <h2>风险与应对矩阵</h2>
    <div class="delivery-risk-table">
      <div class="delivery-risk-head"><span>风险分类</span><span>风险内容</span><span>应对措施</span><span>客户准备</span></div>
      ${rows.map((row) => `<div class="delivery-risk-row">
        <b>${e(row.category)}</b>
        <p>${e(row.risk)}</p>
        <p>${e(row.response)}</p>
        <p>${e(row.prep)}</p>
      </div>`).join("")}
    </div>
  </section>`;
}

function isBudgetDecisionQuestion(text = "") {
  return /预算|报价|付款|决策|采购|负责人|角色|下一步|POC|立项|营收|营业收入|净利润|利润|毛利|现金流|研发投入|财务|付款条件|预算来源|审批流程|决策链/.test(String(text || ""));
}

function isDataQuestion(text = "") {
  return /系统|数据|ERP|MES|PLM|QMS|接口|权限|部署|安全|样例|脱敏|知识库|平台|API/.test(String(text || ""));
}

function isRiskQuestion(text = "") {
  return /风险|边界|合规|不能|限制|信用|法务|集团|承诺|周期|替代|关系|付款条件/.test(String(text || ""));
}

function isUsefulQuestionText(text = "") {
  return meaningful(text) && !isNonDecisionClaim(text) && !/系统未能|未能通过公开来源证实|未公开证实|公开来源不足|证据不足|资料有限|隐藏低相关|重复或错误来源/.test(String(text || ""));
}

function sellerProfileText(report = {}) {
  const profile = report.sellerProfileSnapshot || report.sellerProfile || {};
  return [
    profile.companyName,
    profile.mainBusiness,
    profile.coreProducts,
    profile.coreOfferings,
    profile.summary,
    profile.targetCustomers,
    profile.typicalScenarios,
    profile.strengths,
    profile.keywords
  ]
    .flatMap((item) => arr(item))
    .filter(Boolean)
    .join(" ");
}

function sellerCapabilityMode(report = {}) {
  const text = sellerProfileText(report);
  const strongDigital = /AI|智能体|Agent|软件|数字化|信息化|工业互联网|工业大数据|数据问答|知识库|算法|SaaS|HolliCube|MES\/MOM|MOM智能制造|生态伙伴应用开发|应用定制|流程智能化/.test(text);
  const physicalOrTrade = /汽车|零部件|主机厂|整车厂|动力系统|热管理|电驱动|执行器|车灯|PCBA|设备|硬件|产线|维保|备件|材料|模具|制造|电器|电子|能源|电池|光伏|机械|供应链|外贸|贸易|物流|报关|海外仓|大宗商品|能源化工|现货|后市场|仓储/.test(text);
  if (strongDigital) return "digital";
  if (physicalOrTrade) return "industrial";
  return "general";
}

function sellerCoreOffer(report = {}) {
  const profile = report.sellerProfileSnapshot || report.sellerProfile || {};
  return cleanBusinessText(arr(profile.coreProducts).join("、") || profile.coreProducts || profile.mainBusiness || profile.coreOfferings || "我方产品/服务", 80);
}

function contextualQuestionnaire(round = {}, report = {}) {
  return Object.values(contextualQuestionnaireGroups(round, report)).flat();
}

function contextualQuestionnaireGroups(round = {}, report = {}) {
  const pain = arr(round.painsAndOpportunities).find((item) => meaningful(item.title) || meaningful(item.pain) || meaningful(item.opportunity)) || {};
  const solution = arr(round.solutionCards).find((item) => meaningful(item.title)) || {};
  const painTitle = cleanBusinessText(pain.title || pain.pain || pain.opportunity || "", 48);
  const solutionTitle = cleanBusinessText(solution.title || "", 48);
  const systems = systemNamesFromEvidence([
    ...arr(round.businessInsights).flatMap((item) => [item.title, item.body, item.insight]),
    ...arr(round.customerInfo).flatMap((section) => arr(section.items).flatMap((item) => [item.title, item.body, item.insight, ...arr(item.facts)])),
    ...arr(round.solutionCards).flatMap((item) => [item.title, item.customerPain, item.introduction, item.prerequisite])
  ], 5);
  const knownSystems = systems.length ? systems.join("、") : "";
  const coreScene = painTitle || solutionTitle || cleanBusinessText(buildExecutiveBrief(report, round).entry || "", 48);
  const sellerMode = sellerCapabilityMode(report);
  const sellerOffer = sellerCoreOffer(report);
  if (sellerMode !== "digital") {
    const business = [];
    if (coreScene) {
      business.push(`客户是否把“${coreScene}”列为本轮优先业务场景，影响的是收入、成本、质量、交付还是客户满意度？`);
    }
    business.push("客户当前使用或采购同类产品/服务的场景、频次、规模和痛点分别是什么？");
    business.push("客户现在的供应商或内部解决方式是谁，最不满意的是质量、交期、价格、服务还是适配能力？");
    business.push("如果先做小范围验证，客户希望覆盖哪个产品线、区域、项目、客户或流程？");

    const product = [];
    product.push(`客户对${sellerOffer}最关键的技术指标、认证要求、接口边界或验收标准是什么？`);
    product.push("客户现有产品/设备/系统/供应商清单是什么，哪些部分需要替换、补位或联合交付？");
    product.push("客户是否有样品、图纸、BOM、工况参数、测试数据或历史质量问题可用于评估匹配度？");
    product.push("客户内部谁负责技术确认、质量认可、试用验证和最终验收？");

    const procurement = [];
    procurement.push("本次采购或合作预算来自哪个部门、项目、客户订单、年度预算或专项资金？");
    procurement.push("客户采购流程是询价、招标、指定供应商、框架协议还是项目制采购？");
    procurement.push("付款主体、合同主体、账期和供应商准入要求分别是什么？");
    procurement.push("如果验证通过，下一步是样品测试、小批试用、商务报价、招采流程还是高层评审？");

    const risk = [];
    risk.push("哪些质量、交付、合规、安全、售后或保密要求会直接影响能否成交？");
    risk.push("是否存在既有供应商绑定、认证周期、客户指定品牌或价格红线？");
    risk.push("哪些承诺不能在本轮给出：价格、交期、性能、产能、质保、账期或独家条款？");
    risk.push("客户需要先提供哪些样品、资料、现场条件或责任人，否则无法推进下一步？");
    return {
      业务与场景: uniqueTexts(business, 8),
      产品与技术匹配: uniqueTexts(product, 8),
      采购与交付: uniqueTexts(procurement, 8),
      风险与边界: uniqueTexts(risk, 8)
    };
  }
  const business = [];
  if (coreScene) {
    business.push(`客户是否把“${coreScene}”列为本轮优先场景，为什么是现在要解决？`);
    business.push(`这个场景影响哪个经营指标：效率、质量、交付、成本、合规还是客户满意度？`);
  }
  if (solutionTitle) {
    business.push(`如果围绕“${solutionTitle}”先做轻量验证，客户希望看到哪一个可量化结果？`);
  }
  business.push("客户现有做法靠人工、Excel、原有系统还是外部服务，哪个岗位每天最受影响？");
  business.push("是否已经有真实样例、历史数据、异常记录或客户原话，用来验证问题是否高频高痛？");
  business.push("如果只选一个小范围试点，客户希望覆盖哪个部门、产线、区域、产品或流程？");

  const it = [];
  it.push(knownSystems ? `当前业务涉及哪些具体系统或平台，是否包括 ${knownSystems}，每个系统分别掌握哪些关键数据？` : "当前业务涉及哪些具体系统或平台，请客户直接列出系统名称、归属部门和关键数据？");
  it.push("这些系统能否导出数据、开放接口或提供离线样例，数据口径由谁维护？");
  it.push("客户是否允许提供脱敏样例、离线数据或测试账号，用于验证模型、知识库或自动化流程？");
  it.push("是否存在私有化、内网、国产化、等保、安全审计或数据不出域要求？");
  it.push("业务文档、SOP、制度文件、报表模板和历史案例由谁提供，后续由谁持续维护？");

  const budget = [];
  budget.push("本项目预算来自业务部门、IT部门、集团专项、年度预算还是政府补贴项目？");
  budget.push("决策链上谁发起需求、谁负责技术把关、谁审批预算、谁负责采购流程？");
  budget.push("如果首轮验证通过，下一步是二次交流、方案会、POC、立项还是招采流程？");
  budget.push("付款主体和合同主体是否与本次拜访主体一致，是否需要集团或关联公司审批？");
  budget.push("客户愿意为什么结果付费：降本、人效、质量、合规、交付提速还是客户满意度？");

  const risk = [];
  risk.push("哪些数据、流程、制度或客户信息不能外发，哪些内容必须私有化或脱敏处理？");
  risk.push("是否存在既有供应商、集团标准、历史系统或安全制度，会限制我方接入范围？");
  risk.push("验收标准如何定义，哪些效果不能在首轮交流中承诺？");
  risk.push("是否存在付款周期、合同流程、权限审批、现场环境或硬件条件等硬约束？");
  risk.push("客户需要先提供哪些责任人、样例数据、系统权限或现场条件，否则项目无法推进？");

  return {
    业务问题: uniqueTexts(business, 8),
    IT与数据: uniqueTexts(it, 8),
    预算与决策: uniqueTexts(budget, 8),
    风险与边界: uniqueTexts(risk, 8)
  };
}

function normalizedQuestionnaireGroups(round = {}, report = {}) {
  const contextGroups = contextualQuestionnaireGroups(round, report);
  const all = uniqueTexts(
    [
      ...arr(round.questionnaire)
        .flatMap((group) => arr(group.questions))
        .map((item) => customerQuestionText(item)),
      ...Object.values(contextGroups).flat()
    ],
    32
  )
    .filter(isUsefulQuestionText)
    .filter((item) => !isUnsupportedSchedulingQuestion(item, { report, round }));
  if (sellerCapabilityMode(report) !== "digital") {
    const sellerSafeQuestions = all.filter((item) => !digitalSolutionAssumptionText(item));
    return Object.entries(contextGroups)
      .map(([title, questions]) => ({
        title,
        questions: uniqueTexts([...arr(questions), ...sellerSafeQuestions.filter((item) => {
          if (/业务|场景/.test(title)) return !isBudgetDecisionQuestion(item) && !isRiskQuestion(item);
          if (/产品|技术/.test(title)) return isDataQuestion(item) || /产品|质量|技术|认证|样品|图纸|BOM|工况|指标|验收/.test(item);
          if (/采购|交付/.test(title)) return isBudgetDecisionQuestion(item) || /采购|交付|合同|付款|报价|试用|小批|招标/.test(item);
          if (/风险|边界/.test(title)) return isRiskQuestion(item) || /质量|交期|保密|准入|供应商|认证|承诺/.test(item);
          return true;
        })], 7)
      }))
      .filter((group) => group.questions.length);
  }
  const groups = [
    {
      title: "业务问题",
      questions: uniqueTexts([...arr(contextGroups["业务问题"]), ...all.filter((item) => !isBudgetDecisionQuestion(item) && !isDataQuestion(item) && !isRiskQuestion(item))], 7)
    },
    { title: "IT与数据", questions: uniqueTexts([...arr(contextGroups["IT与数据"]), ...all.filter((item) => isDataQuestion(item))], 7) },
    { title: "预算与决策", questions: uniqueTexts([...arr(contextGroups["预算与决策"]), ...all.filter((item) => isBudgetDecisionQuestion(item))], 7) },
    {
      title: "风险与边界",
      questions: uniqueTexts(
        [
          ...arr(contextGroups["风险与边界"]),
          ...all.filter((item) => isRiskQuestion(item) && (/不能|限制|合规|安全|付款|合同|审批|硬约束|承诺|供应商|集团标准|验收|法务|权限/.test(item) || !isDataQuestion(item)))
        ],
        7
      )
    }
  ];
  return groups.filter((group) => group.questions.length);
}

function questionnaireGoal(title = "") {
  if (/业务/.test(title)) return "判断客户是不是真有高优先级业务场景，以及价值指标是否足够清楚。";
  if (/产品|技术/.test(title)) return "判断我方产品/服务能否匹配客户的技术、质量、认证和验收要求。";
  if (/采购|交付/.test(title)) return "判断采购路径、付款主体、供应商准入和交付节奏是否清楚。";
  if (/IT|数据/.test(title)) return "判断方案能不能落到客户的数据、系统、部署和安全边界里。";
  if (/预算|决策/.test(title)) return "判断谁买单、谁拍板、下一步能不能进入正式推进流程。";
  if (/风险|边界/.test(title)) return "判断哪些承诺不能给，哪些条件不到位会导致项目失败。";
  return "";
}

function allRenderedQuestions(round = {}, report = {}) {
  return normalizedQuestionnaireGroups(round, report).flatMap((group) => group.questions);
}

function questionsByGroup(round = {}, pattern = /.*/, report = {}) {
  return normalizedQuestionnaireGroups(round, report)
    .filter((group) => pattern.test(String(group.title || "")))
    .flatMap((group) => arr(group.questions))
    .filter(meaningful);
}

function uniqueTexts(values = [], max = 6) {
  const seen = new Set();
  return arr(values)
    .map((item) => cleanBusinessText(item, 180))
    .filter(meaningful)
    .filter((item) => {
      const key = item.replace(/\s+/g, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
}

function coreBusinessQuestion(report = {}, round = {}, brief = {}) {
  const pain = arr(round.painsAndOpportunities).find((item) => meaningful(item.title) || meaningful(item.pain) || meaningful(item.opportunity)) || {};
  const solution = arr(round.solutionCards).find((item) => meaningful(item.title)) || {};
  const painTitle = cleanBusinessText(pain.title || pain.pain || pain.opportunity || "", 70);
  const solutionTitle = cleanBusinessText(solution.title || "", 70);
  if (painTitle) return `客户是否把“${painTitle}”视为当前优先级场景，现有流程中最影响效率、质量或交付的环节是什么？`;
  if (solutionTitle) return `围绕“${solutionTitle}”，客户最想先验证哪个业务场景和价值指标？`;
  const entry = cleanBusinessText(brief.entry || brief.oneLine || "", 90);
  return entry ? `围绕“${entry}”，客户当前最希望解决的业务问题是什么？` : "客户当前最想优先解决的业务场景是什么，衡量价值的指标是什么？";
}

function actionGuideSection(report, round) {
  const brief = buildExecutiveBrief(report, round);
  const coreQuestion = coreBusinessQuestion(report, round, brief);
  const businessQuestions = questionsByGroup(round, /业务/, report);
  const otherQuestions = allRenderedQuestions(round, report);
  const questions = uniqueTexts([coreQuestion, ...businessQuestions, ...otherQuestions], 4);
  const notes = arr(round.internalNotes).map(usefulDecisionText).filter(Boolean).filter(isActionableInternalNote).slice(0, 3);
  const solutions = arr(round.solutionCards);
  const actions = [
    {
      title: "先把话题带到这里",
      body: brief.entry || solutions[0]?.title || "先从最容易验证价值的小场景切入。",
      tone: "focus"
    },
    {
      title: "现场必须问清",
      body: questions.length ? joinReadable(questions) : "确认参会角色、当前痛点、预算归属、数据边界和下一步决策机制。",
      tone: "ask"
    },
    {
      title: "暂时不要承诺",
      body: notes.length ? joinReadable(notes) : brief.risk || "需求、数据和验收口径未清楚前，不承诺重交付范围、周期和免费验证。",
      tone: "risk"
    }
  ].filter((item) => meaningful(item.body));
  if (!actions.length) return "";
  return `<section class="battle-section action-section">
    <h2>行动指南</h2>
    <div class="action-guide-grid">
      ${actions.map((item) => `<article class="action-card ${e(item.tone)}"><span>${e(item.title)}</span><b>${e(item.body)}</b></article>`).join("")}
    </div>
  </section>`;
}

function tabClaim(title, summary, kicker = "") {
  return `<div class="perspective-claim">
    ${kicker ? `<div class="claim-tags"><span>${e(kicker)}</span></div>` : ""}
    <h2>${e(cleanBusinessText(title, 220))}</h2>
    ${summary ? `<p>${e(cleanBusinessText(summary, 360))}</p>` : ""}
  </div>`;
}

function claimSentence(value, fallback = "", max = 260) {
  const text = cleanBusinessText(value || fallback, max).replace(/^[：:，,；;\s]+/, "");
  const useful = usefulDecisionText(text);
  if (!useful) return "";
  return /[。！？.!?]$/.test(useful) ? useful : `${useful}。`;
}

function forcedSentence(value, fallback = "", max = 260) {
  const text = cleanBusinessText(value || fallback, max).replace(/^[：:，,；;\s]+/, "");
  if (!text) return "";
  return /[。！？.!?]$/.test(text) ? text : `${text}。`;
}

function usefulEvidenceTexts(values = [], max = 5) {
  return arr(values)
    .map((item) => cleanBusinessText(item, 180))
    .filter(meaningful)
    .filter((item) => !isNonDecisionClaim(item))
    .filter((item) => !isMethodEvidenceText(item))
    .filter((item) => !isLowValueEvidenceText(item))
    .filter((item) => !/资料中出现|资料显示|可读来源|主题覆盖|初访判断门槛|系统已检索|报告已识别可能相关|信息置信度不足|隐藏低相关|待确认/.test(item))
    .slice(0, max);
}

function argumentEvidenceTexts(node = {}) {
  const max = node.maxEvidence || 5;
  if (node.allowConfirmEvidence) {
    return arr(node.evidence)
      .map((item) => cleanBusinessText(item, 180))
      .filter(meaningful)
      .filter((item) => !isNonDecisionClaim(item))
      .filter((item) => !isLowValueEvidenceText(item))
      .slice(0, max);
  }
  return usefulEvidenceTexts(node.evidence, max);
}

function collectSourceIds(items = []) {
  return Array.from(new Set(arr(items).flatMap((item) => normalizeSourceIdList(item)))).slice(0, 6);
}

function hasArgumentSupport(node = {}) {
  if (node.forceDisplay) return true;
  if (node.allowBoundaryEvidence && arr(node.evidence).some(meaningful)) return true;
  return arr(node.evidence).some((item) => usefulEvidenceText(item)) || normalizeSourceIdList(node).length > 0;
}

function normalizeForCompare(text = "") {
  return String(text || "")
    .replace(/<[^>]+>/g, "")
    .replace(/[“”"「」『』：:，,。！？!?\s]/g, "")
    .trim();
}

function isNearDuplicateText(a = "", b = "", minLength = 18) {
  const left = normalizeForCompare(a);
  const right = normalizeForCompare(b);
  if (!left || !right) return false;
  if (Math.min(left.length, right.length) < minLength) return false;
  return left.includes(right) || right.includes(left);
}

function basisFromClaimOrEvidence(claim = "", evidence = []) {
  const text = cleanBusinessText(claim, 240).replace(/[。！？.!?]+$/g, "");
  const basis = text.match(/(?:依据是|依据为|主要依据是|触发依据是)(.+)$/)?.[1] || "";
  const cleanedBasis = cleanBusinessText(basis.replace(/^[:：，,\s]+/g, ""), 180);
  if (meaningful(cleanedBasis)) return claimSentence(cleanedBasis, "", 180);
  const evidenceText = signalTextSummary(evidence, 1, 150) || evidenceDecisionSummary(evidence, "");
  return evidenceText ? claimSentence(evidenceText, "", 180) : "";
}

function removeClaimDuplicateEvidence(evidence = [], claim = "", { keepFallback = true } = {}) {
  const claimKey = normalizeForCompare(claim);
  const original = arr(evidence)
    .map((item) => usefulEvidenceText(item, 180))
    .filter(Boolean);
  const cleaned = original.filter((item) => {
    const itemKey = normalizeForCompare(item);
    if (!itemKey) return false;
    if (!claimKey) return true;
    return !(claimKey.includes(itemKey) || itemKey.includes(claimKey));
  });
  return cleaned.length ? cleaned : (keepFallback ? original.slice(0, 1) : []);
}

function argumentBranchTitles(label = "") {
  const text = String(label || "");
  if (/营收能力/.test(text)) return ["营收指标", "利润指标", "现金流与毛利"];
  if (/客户优先级/.test(text)) return ["规模与资本依据", "组织与客户依据", "标杆与行业依据"];
  if (/企业发展阶段/.test(text)) return ["政策与项目入选", "合作与新增项目", "投资与组织变化"];
  if (/经营状态/.test(text)) return ["经营指标", "压力来源", "预算依据"];
  if (/组织复杂度/.test(text)) return ["股权主体", "组织链路", "采购主体"];
  if (/行业地位/.test(text)) return ["公开背书", "案例信号", "标杆价值"];
  if (/管理成熟度/.test(text)) return ["技术资产", "系统线索", "组织线索"];
  if (/风险状态/.test(text)) return ["风险事实", "信用线索", "合规线索"];
  if (/采购能力|预算|买单/.test(text)) return ["体量依据", "预算线索", "资质背书"];
  if (/采购习惯/.test(text)) return ["甲方采购记录", "采购节奏", "历史预算线索"];
  if (/近期可能有预算|近期预算/.test(text)) return ["触发信号", "预算窗口", "资金线索"];
  if (/同类项目/.test(text)) return ["项目线索", "延伸空间", "历史采购"];
  if (/供应商|竞品/.test(text)) return ["既有伙伴", "我方差异", "合作位置"];
  if (/低价值客户/.test(text)) return ["明确负面事实", "买单能力削弱依据", "业务匹配削弱依据"];
  if (/进入窗口|近期触发|接触窗口|切入话题|推进打法|开场切入/.test(text)) return ["触发因素", "业务话题", "窗口依据"];
  if (/商务风险|避坑|风险评估/.test(text)) return ["风险来源", "影响范围", "控制边界"];
  if (/核心业务场景/.test(text)) return ["业务场景", "场景依据", "方案入口"];
  if (/客户现状/.test(text)) return ["现状信号", "业务影响", "方案入口"];
  if (/痛点机会/.test(text)) return ["客户现象", "痛点依据", "机会依据"];
  if (/解决思路|应对方案/.test(text)) return ["总体思路", "关键动作", "实施顺序"];
  if (/配套解决方案|方案优先级/.test(text)) return ["P0场景", "P1扩展", "方案取舍"];
  if (/数字化成熟度/.test(text)) return ["技术信号", "系统基础", "组织能力"];
  if (/可能已有系统/.test(text)) return ["系统线索", "集成关系", "业务约束"];
  if (/替换机会/.test(text)) return ["替换触发", "增量价值", "替换边界"];
  if (/方案风险点/.test(text)) return ["风险来源", "落地影响", "应对边界"];
  if (/SOW|工作拆分/.test(text)) return ["一级工作包", "二级工作项", "难点标识"];
  if (/前置条件|内部边界/.test(text)) return ["客户侧输入", "我方边界", "推进条件"];
  if (/必问问题/.test(text)) return ["业务验证", "预算验证", "数据验证"];
  if (/会后更新/.test(text)) return ["新增事实", "判断刷新", "下一轮动作"];
  return ["支撑判断一", "支撑判断二", "支撑判断三"];
}

function branchEvidenceMatcher(label = "", title = "") {
  const scope = `${label} ${title}`;
  if (/营收能力/.test(scope) && /营收|收入/.test(scope)) return /营业收入|营收|收入|净销售|销售额/;
  if (/营收能力/.test(scope) && /利润/.test(scope)) return /净利润|归母|扣非|利润/;
  if (/营收能力/.test(scope) && /现金流|毛利/.test(scope)) return /经营现金流|现金流|毛利率|毛利/;
  if (/客户优先级/.test(scope) && /规模|资本/.test(scope)) return /注册资本|实缴资本|参保人数|员工|营收|营业收入|收入|成立/;
  if (/客户优先级/.test(scope) && /组织|客户/.test(scope)) return /客户名单|客户案例|子公司|分支|对外投资|服务对象|行业客户|区域/;
  if (/客户优先级/.test(scope) && /标杆|行业/.test(scope)) return /入选|榜单|协会|政府项目|首版次|总包商|示范|资质|认证|排名|补助/;
  if (/企业发展阶段/.test(scope) && /政策|入选/.test(scope)) return /入选|补助|重点研发|总包商|首版次|政策项目|政府项目|专项资金/;
  if (/企业发展阶段/.test(scope) && /合作|新增/.test(scope)) return /新设|新建|扩张|扩产|投产|产能|战略合作|重大合作|签约|产学研合作|近期中标|项目金额|合同金额/;
  if (/企业发展阶段/.test(scope) && /投资|组织/.test(scope)) return /投资|融资|上市|并购|募投|组织调整|高管变更|招聘规模|批量招聘|多岗位|团队扩张/;
  if (/经营状态/.test(scope) && /经营指标/.test(scope)) return /营收|营业收入|收入|净利润|利润|现金流|毛利|资产负债|研发投入|注册资本|实缴/;
  if (/经营状态/.test(scope) && /压力来源/.test(scope)) return /亏损|承压|处罚|诉讼|被执行|行政处罚|成本|降本|监管|合规|回款|付款/;
  if (/经营状态/.test(scope) && /预算依据/.test(scope)) return /预算|采购|招标|项目金额|合同金额|补助|融资|上市|研发投入|固定资产/;
  if (/组织复杂度/.test(scope) && /股权/.test(scope)) return /股东|持股|股权|控股|受益所有人|法定代表人/;
  if (/组织复杂度/.test(scope) && /组织/.test(scope)) return /集团|子公司|分支机构|对外投资|区域|关联|主要人员|高管/;
  if (/组织复杂度/.test(scope) && /采购主体/.test(scope)) return /采购人|招标人|采购单位|业主单位|付款主体|合同主体|本地主体|集团/;
  if (/行业地位/.test(scope)) return /入选|榜单|协会|政府项目|首版次|总包商|示范|典型|标杆|排名|资质|认证|客户案例|专精特新|单项冠军|隐形冠军|高新技术企业|瞪羚|企业技术中心|工程技术中心|奖|奖项|荣誉|获奖|获评|认定/;
  if (/管理成熟度/.test(scope)) return /IT岗位|数据岗位|算法|运维|软著|软件著作权|专利|ISO|信息安全|系统采购|平台|MES|APS|ERP|WMS|LIMS|SCADA|工业互联网|数字化|智能制造|HolliCube/;
  if (/风险状态|商务风险/.test(scope)) return /被执行|失信|限制高消费|诉讼|合同纠纷|行政处罚|经营异常|处罚|付款|回款|风险/;
  if (/采购能力|预算|买单/.test(scope) && /体量/.test(scope)) return /营收|营业收入|收入|净利润|利润|现金流|注册资本|实缴|融资|上市|研发投入/;
  if (/采购能力|预算|买单/.test(scope) && /预算/.test(scope)) return /采购人|招标人|采购单位|采购公告|预算金额|采购预算|项目金额|合同金额|政府采购|采购意向/;
  if (/采购能力|预算|买单/.test(scope) && /资质|背书/.test(scope)) return /入选|资质|认证|政府项目|补助|重点研发|总包商|榜单/;
  if (/采购习惯/.test(scope)) return /采购人|招标人|采购单位|采购公告|预算金额|采购预算|政府采购|采购意向|采购平台|历史采购|供应商记录/;
  if (/同类项目|可能已有系统|替换机会|核心业务场景|数字化成熟度|痛点机会|解决思路|配套解决方案|方案风险点/.test(scope)) return /客户案例|项目|系统|MES|APS|ERP|WMS|LIMS|SCADA|平台|HolliCube|数字化|工业互联网|智能制造|招标|采购|中标|交付|专利|软著|招聘|岗位|数据|算法|运维/;
  if (/供应商|竞品/.test(scope)) return /供应商|合作伙伴|服务商|实施商|集成商|SAP|Oracle|Microsoft|微软|阿里|腾讯|华为|用友|金蝶|达索|西门子|大华|海康|中标单位/;
  if (/进入窗口|触发|开场切入/.test(scope)) return /采购意向|采购预算|预算金额|采购公告|招标公告|招标计划|政府采购|新建|扩产|投产|新基地|产能|投资|立项|项目金额|合同金额|融资|上市|IPO|募投|并购|组织调整|高管变更|专项资金|政府补助|补贴|重点研发|技改|改造/;
  return null;
}

function branchEvidenceAllowed(label = "", title = "", value = "") {
  const scope = `${label} ${title}`;
  const text = cleanBusinessText(value, 260);
  if (!meaningful(text)) return false;
  if (isMethodEvidenceText(text)) return false;
  if (/营收能力/.test(scope)) return /营业收入|营收|收入|净利润|归母|扣非|利润|毛利率|经营现金流|现金流|财报|年报/.test(text);
  if (/企业发展阶段/.test(scope)) return isDevelopmentStageEvidenceText(text);
  if (/近期可能有预算|预算窗口/.test(scope)) return isBudgetWindowEvidenceText(text);
  if (/采购能力|预算|买单/.test(scope)) return isPurchaseBudgetEvidenceText(text);
  if (/采购习惯/.test(scope)) return isBuyerProcurementEvidenceText(text);
  if (/供应商|竞品/.test(scope)) return isCustomerSupplierCompetitorEvidenceText(text);
  if (/低价值客户/.test(scope)) return isConcreteLowValueEvidenceText(text);
  if (/同类项目/.test(scope)) return isSameProjectEvidenceText(text);
  if (/进入窗口|近期触发|触发因素/.test(scope)) {
    if (/招聘|岗位|人才/.test(text) && !isStrategicHiringEvidenceText(text)) return false;
    if (isProductCatalogTitleOnly(text)) return false;
    return isEntryWindowEvidenceText(text);
  }
  if (/组织复杂度|组织链路|股权主体|采购主体/.test(scope)) return isRegistryOrgEvidenceText(text) || isBuyerProcurementEvidenceText(text);
  return true;
}

function selectBranchEvidence(label = "", title = "", evidence = [], used = new Set()) {
  const cleaned = arr(evidence)
    .map((item) => usefulEvidenceText(item, 180))
    .filter(Boolean)
    .filter((item) => branchEvidenceAllowed(label, title, item))
    .filter((item) => !used.has(normalizeForCompare(item)));
  const matcher = branchEvidenceMatcher(label, title);
  const matched = matcher ? cleaned.filter((item) => matcher.test(item)) : [];
  if (matcher && !matched.length) return [];
  const picked = (matcher ? matched : cleaned).slice(0, 2);
  picked.forEach((item) => used.add(normalizeForCompare(item)));
  return picked;
}

function allowSupplementalArgumentBranches(label = "") {
  return false;
}

function sourceLikeBranchClaim(value = "") {
  return /命中企业名称|命中别名|命中集团\/品牌|天眼查 API|启信宝|爱企查|企查查|谈职|企业展厅|公司招投标查询|最新招标中标消息|_招投标_|_知识产权_|详情\s*-\s*/.test(String(value || ""));
}

function questionLikeBranchClaim(value = "") {
  return /[？?]$|分别由谁负责|处于什么区间|由谁负责|是否已经|能否提供|有没有|是什么/.test(String(value || ""));
}

function reframeBranchQuestion(title = "", body = "") {
  const scope = `${title}${body}`;
  if (/预算|买单|收入|营收|利润|研发投入|付款|采购/.test(scope)) {
    return "买单能力要先按可承受的小闭环验证推进，只有预算来源、审批流程和付款主体清楚后才升级重方案投入。";
  }
  if (/决策|拍板|角色|负责人|责任人/.test(scope)) {
    return "决策链要把需求发起人、预算负责人、技术把关人和最终拍板人拆开看，入口选错会直接拖慢成交。";
  }
  if (/数据|系统|接口|权限|样例/.test(scope)) {
    return "数据和系统边界决定方案能否落地，样例、接口、权限和部署约束不清时只能做轻量验证。";
  }
  return "这个问题用于把初访交流从产品宣讲推进到可判断、可验证、可安排下一步的商机判断。";
}

function reframeSourceBranch(title = "", body = "") {
  const scope = `${title}${body}`;
  const text = cleanBusinessText(scope, 260);
  if (/招投标|中标|采购/.test(scope)) {
    return isBuyerProcurementEvidenceText(body) || isSameProjectEvidenceText(body) ? cleanBusinessText(body, 160) : "";
  }
  if (/专利|软著|知识产权|研发/.test(scope)) {
    return cleanBusinessText(body, 160);
  }
  if (/招聘|岗位/.test(scope)) {
    if (!isConcreteHiringEvidenceText(text)) return "";
    return cleanBusinessText(body, 160);
  }
  if (/工商|股权|高管|主体/.test(scope)) {
    if (!isRegistryOrgEvidenceText(text)) return "";
    return cleanBusinessText(body, 160);
  }
  return "";
}

function completeBranchClaim(title = "", rawClaim = "") {
  const sentence = claimSentence(rawClaim, "", 180);
  if (!sentence) return "";
  const body = sentence.replace(/[。！？.!?]+$/g, "");
  const titleText = String(title || "");
  if (sourceLikeBranchClaim(body)) {
    const reframed = reframeSourceBranch(titleText, body);
    return reframed ? claimSentence(reframed, "", 180) : "";
  }
  if (questionLikeBranchClaim(sentence) && !/必问问题|业务验证|预算验证|数据验证/.test(titleText)) {
    return claimSentence(reframeBranchQuestion(titleText, body), "", 180);
  }
  const compact = sentence.replace(/\s+/g, "");
  if (compact.length >= 16) return sentence;
  if (/预算|买单|收入|营收|利润|财务|采购|付款/.test(`${titleText}${body}`)) {
    return claimSentence(`买单能力的支撑依据是${body}，适合继续验证项目预算入口和付款主体。`, "", 180);
  }
  if (/风险|合规|信用|法务|避坑|边界/.test(`${titleText}${body}`)) {
    return claimSentence(`商务风险判断是${body}，推进时应先控制数据、合规和承诺边界。`, "", 180);
  }
  if (/角色|采购|拍板|决策/.test(`${titleText}${body}`)) {
    return claimSentence(`决策链判断可参考${body}，初访应进一步锁定需求发起人与拍板路径。`, "", 180);
  }
  return claimSentence(`${titleText || "支撑判断"}显示${body}，这一信号会影响后续推进策略。`, "", 180);
}

function supplementalArgumentBranches(node = {}, evidence = []) {
  const label = String(node.label || "");
  const claim = cleanBusinessText(node.claim || "", 180).replace(/[。！？.!?]+$/g, "");
  if (!claim || isNonDecisionClaim(claim)) return [];
  const sourceIds = normalizeSourceIdList(node);
  const firstEvidence = arr(evidence).slice(0, 2);
  const make = (title, body) => ({
    title,
    claim: claimSentence(body, "", 180),
    evidence: firstEvidence,
    sourceIds
  });
  if (/客户现状/.test(label)) {
    return [
      make("现状信号", `${claim}，初访应围绕这条主线追问真实流程、责任部门和衡量指标`),
      make("方案入口", "方案切入应先落到一个可验证的小场景，用样例、规则和业务指标证明价值")
    ];
  }
  if (/痛点机会/.test(label)) {
    return [
      make("痛点主线", `${claim}，售前应把它转成客户可感知的损失、效率或质量指标`),
      make("机会判断", "机会要优先选择我方能力能快速验证、客户也愿意提供样例的场景")
    ];
  }
  if (/解决思路|方案优先级/.test(label)) {
    return [
      make("方案抓手", `${claim}，本轮先用轻量验证证明价值，再决定是否扩大范围`),
      make("取舍原则", "不把所有可能场景一次讲完，先推最能验证价值和决策意愿的入口")
    ];
  }
  return [
    make("补充论据", `${claim}，这一信号会影响本轮商机投入和方案优先级`),
    make("行动依据", "首轮交流需要把该信号落实到客户原话、业务样例和下一步安排")
  ];
}

function argumentBranchItems(node = {}, evidence = []) {
  const explicit = arr(node.branches)
    .map((branch) => {
      if (typeof branch === "string") return { title: "支撑判断", claim: completeBranchClaim("支撑判断", branch), evidence: [] };
      const title = cleanBusinessText(branch.title || branch.label || "支撑判断", 36);
      const forceBranch = Boolean(node.forceDisplay || branch.forceDisplay);
      const rawClaim = branch.claim || branch.body || branch.summary || "";
      const branchEvidence = uniqueTexts(branch.evidence || branch.facts || [], 4)
        .map((item) => forceBranch ? cleanBusinessText(item, 180) : usefulEvidenceText(item, 180))
        .filter(Boolean);
      const branchClaim = forceBranch ? forcedSentence(rawClaim, "", 180) : completeBranchClaim(title, rawClaim);
      const dedupedClaim = isNearDuplicateText(branchClaim, node.claim)
        ? (basisFromClaimOrEvidence(branchClaim, branchEvidence) || branchClaim)
        : branchClaim;
      return {
        title,
        claim: dedupedClaim,
        kind: branch.kind || "",
        fields: arr(branch.fields)
          .map((field) => ({
            label: cleanBusinessText(field.label || field.title || "", 28),
            value: cleanBusinessText(field.value || field.body || field.text || "", 260)
          }))
          .filter((field) => meaningful(field.label) && meaningful(field.value)),
        rows: arr(branch.rows)
          .map((row) => {
            const rowLabel = typeof row === "string" ? row : row.label || row.title || row.task || row.name || "";
            return {
              label: cleanBusinessText(rowLabel, 240),
              description: cleanBusinessText(typeof row === "string" ? "" : row.description || row.introduction || row.summary || row.body || "", 180),
              hard: Boolean(row.hard),
              difficulty: cleanBusinessText(row.difficulty || (row.hard ? "难点" : ""), 24)
            };
          })
          .filter((row) => meaningful(row.label)),
        evidence: branchEvidence,
        sourceIds: normalizeSourceIdList(branch),
        annualPage: branch.annualPage || branch.page || branch.annualReportPage,
        annualFileName: branch.annualFileName,
        evidenceExcerpt: branch.evidenceExcerpt || branch.context || branch.note || ""
      };
    })
    .filter((branch) => node.forceDisplay ? Boolean(String(branch.claim || "").trim()) : (meaningful(branch.claim) && !isNonDecisionClaim(branch.claim)));
  if (node.useExplicitBranchesOnly) return explicit.slice(0, 5);
  if (explicit.length >= 2) return explicit.slice(0, 4);
  let titles = argumentBranchTitles(node.label);
  if (/采购习惯/.test(String(node.label || "")) && /乙方|不能据此|不能.*甲方/.test(String(node.claim || ""))) {
    titles = ["乙方项目线索", "交付案例", "不能推断甲方采购"];
  }
  const usedEvidence = new Set();
  const generated = titles
    .map((title, index) => {
      const picked = selectBranchEvidence(node.label, title, evidence, usedEvidence);
      if (!picked.length) return null;
      return {
        title: title || `支撑判断${index + 1}`,
        claim: completeBranchClaim(title || `支撑判断${index + 1}`, picked[0]),
        evidence: picked.slice(1),
        sourceIds: []
      };
    })
    .filter(Boolean)
    .filter((branch) => meaningful(branch.claim) && !isNonDecisionClaim(branch.claim));
  const baseBranches = [...explicit, ...generated]
    .filter((branch) => meaningful(branch.claim) && !isNonDecisionClaim(branch.claim));
  if (/采购习惯/.test(String(node.label || "")) && /乙方|不能据此|不能.*甲方/.test(String(node.claim || ""))) {
    const hasBoundary = baseBranches.some((branch) => /不能推断甲方采购|不能证明.*甲方|甲方.*采购习惯/.test(`${branch.title}${branch.claim}`));
    if (!hasBoundary) {
      baseBranches.push({
        title: "不能推断甲方采购",
        claim: "这些项目能说明客户具备对外交付能力，但不能证明其作为甲方有稳定采购习惯。",
        evidence: [],
        sourceIds: []
      });
    }
  }
  const combined = baseBranches
    .filter((branch) => meaningful(branch.claim) && !isNonDecisionClaim(branch.claim));
  const seen = new Set();
  return combined
    .filter((branch) => {
      const key = normalizeForCompare(branch.claim);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

function perspectiveDetailPack(title, bodyHtml, subtitle = "") {
  if (!meaningful(bodyHtml)) return "";
  return `<details class="perspective-detail-pack">
    <summary><span>${e(title)}</span>${subtitle ? `<small>${e(subtitle)}</small>` : ""}</summary>
    <div class="perspective-detail-body">${bodyHtml}</div>
  </details>`;
}

function argumentTreeSection({ className = "", kicker = "", thesis = "", summary = "", nodes = [], sources = [], showClaim = true }) {
  const cleanNodes = arr(nodes)
    .map((node) => {
      const forceNode = Boolean(node.forceDisplay);
      const claim = forceNode ? forcedSentence(node.claim, node.fallback || "", 260) : claimSentence(node.claim, node.fallback || "", 260);
      const rawEvidence = forceNode || node.allowBoundaryEvidence
        ? arr(node.evidence).map((item) => cleanBusinessText(item, 180)).filter((item) => Boolean(String(item || "").trim()))
        : argumentEvidenceTexts(node);
      const evidence = removeClaimDuplicateEvidence(rawEvidence, claim);
      const invalid = Boolean(node.invalid) || /^未查到|.*暂无法判断|.*无法判断|.*未形成有效判断|.*未形成.*结论/.test(claim);
      return {
        ...node,
        claim,
        evidence,
        invalid,
        branches: argumentBranchItems({ ...node, claim }, evidence)
      };
    })
    .filter((node) => (node.forceDisplay ? Boolean(String(node.claim || "").trim()) : usefulDecisionText(node.claim)) && hasArgumentSupport(node) && node.branches.length);
  const cleanThesis = claimSentence(thesis, "", 280) || cleanNodes[0]?.claim || "";
  if (!cleanThesis && !cleanNodes.length) return "";
  return `<section class="battle-section argument-section ${e(className)}">
    ${showClaim && cleanThesis ? tabClaim(cleanThesis, summary, kicker) : ""}
    ${cleanNodes.length ? `<div class="argument-tree">
      ${cleanNodes
        .map((node, index) => {
          const toneClass = node.invalid ? "" : e(node.tone || "");
          const branchTitle = /delivery-argument-section/.test(className)
            ? (/SOW/.test(String(node.label || "")) ? "功能明细" : "明细")
            : /action-argument-section/.test(className)
              ? (/现场问卷/.test(String(node.label || "")) ? "问题分类" : "关注项")
              : "";
          const branchTitleHtml = branchTitle && branchTitle !== "明细"
            ? `<div class="argument-evidence-title">${e(branchTitle)}</div>`
            : "";
          const hasBranchSources = node.branches.some((branch) => normalizeSourceIdList(branch).length);
          const nodeSourceRow = !hasBranchSources && normalizeSourceIdList(node).length
            ? `<div class="argument-source-row"><span>资料来源</span>${evidenceLinks(node, sources)}</div>`
            : "";
          return `<details class="argument-node ${toneClass} ${node.invalid ? "invalid" : ""} ${node.wide ? "wide" : ""}" ${node.open ? "open" : ""}>
          <summary>
            <span>${e(`${String(index + 1).padStart(2, "0")}｜${node.label || "关键判断"}`)}</span>
            <b>${e(node.claim)}</b>
          </summary>
          <div class="argument-node-body">
            ${node.branches.length ? `${branchTitleHtml}
              <div class="argument-branches">
                ${node.branches.map((branch) => {
                  const branchEvidence = removeClaimDuplicateEvidence(
                    removeClaimDuplicateEvidence(branch.evidence || [], branch.claim, { keepFallback: false }),
                    node.claim,
                    { keepFallback: false }
                  );
                  const branchInvalid = Boolean(branch.invalid) || /^未查到|.*暂无法判断|.*无法判断|.*未形成有效判断|.*未形成.*结论/.test(`${branch.title || ""}${branch.claim || ""}`);
                  return `<details class="argument-branch ${e(branch.kind || "")}${branchInvalid ? " invalid" : ""}" open>
                    <summary>
                      <span>${e(branch.title)}</span>
                      <b>${e(branch.claim)}</b>
                    </summary>
                    <div class="argument-branch-body">
                      ${arr(branch.rows).length ? `<div class="sow-module-rows ${e(branch.kind || "")}">
                        ${arr(branch.rows).map((row) => branch.kind === "sow-module-fields"
                          ? `<div class="sow-module-row${row.hard ? " hard" : ""}"><span class="sow-row-main"><em>${e(row.label)}</em>${row.description ? `<small>${e(row.description)}</small>` : ""}</span><span>${row.hard ? "✓ 难点" : ""}</span></div>`
                          : `<div class="sow-module-row${row.hard ? " hard" : ""}"><span>${e(row.label)}</span><span>${row.hard ? "✓ 难点" : ""}</span></div>`).join("")}
                      </div>` : arr(branch.fields).length ? `<div class="argument-field-grid ${e(branch.kind || "")}">${arr(branch.fields)
                        .map((field) => `<div class="argument-field"><em>${e(field.label)}</em><p>${e(field.value)}</p></div>`)
                        .join("")}</div>` : branchEvidence.length ? `<ul>${branchEvidence.map((item) => `<li>${e(item)}</li>`).join("")}</ul>` : ""}
                      ${evidenceLinks(branch, sources)}
                    </div>
                  </details>`;
                }).join("")}
              </div>` : ""}
            ${node.note ? `<p class="argument-note">${e(cleanBusinessText(node.note, 180))}</p>` : ""}
            ${nodeSourceRow}
          </div>
        </details>`;
        })
        .join("")}
    </div>` : ""}
  </section>`;
}

function firstRoundInfoText(round = {}, sectionPattern = /.*/) {
  const item = arr(round.customerInfo)
    .filter((section) => sectionPattern.test(`${section.key || ""} ${section.title || ""}`))
    .flatMap((section) => arr(section.items))
    .find((entry) => meaningful(entry.body || entry.insight || entry.summary || arr(entry.facts)[0] || displayMetricValue(entry)));
  if (!item) return "";
  return compactText(item.body || item.insight || item.summary || arr(item.facts)[0] || `${item.label || item.title || "指标"}：${displayMetricValue(item)}`, 220);
}

function isGenericSourceBody(text = "") {
  return /天眼查 API 直接|按企业名称\/统一社会信用代码返回|命中企业名称|命中别名|命中集团\/品牌|主体核对来源|用于支撑|来源/.test(String(text || ""));
}

function sourceDecisionSignalText(source = {}) {
  const title = compactText(source.title || source.domain || source.sourceType || "外部线索", 80);
  const body = cleanSourceEvidenceShell(source.evidenceExcerpt || source.snippet || source.text || "", 220);
  if (meaningful(body) && !isGenericSourceBody(body) && !isLowValueEvidenceText(body)) return body;
  const titleText = `${source.title || ""} ${source.sourceType || ""} ${source.sourceFamily || ""} ${source.topic || ""}`;
  if (isLowValueEvidenceText(titleText)) return "";
  if (/天眼查 API|主体核验来源|命中企业名称|命中别名|命中集团\/品牌/i.test(titleText)) return "";
  if (/招投标|中标|采购|tender/i.test(titleText)) return title;
  if (/财务|年报|finance|budget/i.test(titleText)) return "";
  if (/招聘|岗位|hiring/i.test(titleText) && !isStrategicHiringEvidenceText(`${titleText} ${body}`)) return "";
  if (isProductCatalogTitleOnly(titleText) && !meaningful(body)) return "";
  if (/APS|高级计划|排产|计划排程|生产计划|MES|制造执行|生产执行|HolliCube|工业互联网|工业数据|数据中台|主数据|数据治理|软件著作权|专利|知识产权|patent|ip|招聘|岗位|hiring/i.test(titleText)) return title;
  if (/工商|主体|股权|受益|人员|高管|registry/i.test(titleText)) return "";
  return "";
}

function cleanSourceEvidenceShell(value = "", max = 220) {
  let text = compactText(value, Math.max(max * 2, 360));
  text = text
    .replace(/请输入问题（例如：[^。；;]*）\s*/g, "")
    .replace(/支持\d+多种语言问答。?\s*/g, "")
    .replace(/隐私承诺：[^。；;]*。?\s*/g, "")
    .replace(/企业会员享有免费提问。?\s*/g, "")
    .replace(/产品\)\.\s*企业管理AI\)[^。；;]{0,360}(?:中国管理模式|关于金蝶|成为合作伙伴)\)\.?/g, "")
    .replace(/企业管理AI\)[^。；;]{0,320}(?:中国管理模式|关于金蝶|成为合作伙伴)\)\.?/g, "")
    .replace(/#{1,6}\s*(?:CONTENTS|SERVICE|关于MarkLines全球汽车信息平台|公司概要|业务内容|资本构成|主要产品)\.?\s*/gi, "")
    .replace(/\|\s*\d{4}年\d{1,2}月\s*\|/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  text = text.replace(/^(?:[.。]\s*)+/, "").replace(/[：:｜|\-_\s]+$/g, "");
  return cleanBusinessText(text, max);
}

function cleanSourceTitleLabel(source = {}) {
  const raw = source.title || source.domain || source.sourceType || "资料来源";
  const cleaned = cleanSourceEvidenceShell(raw, 96)
    .replace(/^[-_｜|：:\s]+|[-_｜|：:\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (meaningful(cleaned) && !/^(请输入问题|支持\d+多种语言|CONTENTS|SERVICE)$/i.test(cleaned)) return cleaned;
  return source.domain || source.sourceType || "资料来源";
}

function sourceSearchText(source = {}) {
  return [
    source.title,
    source.snippet,
    source.evidenceExcerpt,
    source.text,
    source.relevanceReason,
    source.usedFor,
    source.query,
    source.sourceType,
    source.sourceFamily,
    source.topic,
    source.domain
  ]
    .filter(Boolean)
    .join(" ");
}

function isProcurementDirectoryOnlyText(value = "") {
  const text = cleanBusinessText(value, 300);
  if (!meaningful(text)) return false;
  const directoryLike = /招投标|招标项目|工程招投标|供应商门户|供应商平台|采购平台|tender|bidchance|爱企查/i.test(text);
  const hasConcreteDetail = /采购人|招标人|采购单位|业主单位|预算金额|采购预算|项目编号|项目名称|中标单位|成交供应商|合同金额|项目金额|万元|亿元/.test(text);
  return directoryLike && !hasConcreteDetail;
}

function isBuyerProcurementEvidenceText(value = "") {
  const text = cleanBusinessText(value, 260);
  if (!meaningful(text)) return false;
  if (isProcurementDirectoryOnlyText(text)) return false;
  const hasConcreteDetail = /采购人|招标人|采购单位|业主单位|招标单位|预算金额|采购预算|项目编号|项目名称|采购项目|中标单位|成交供应商|合同金额|项目金额|中标结果|成交结果|中标公告|成交公告|合同公告|万元|亿元|租赁|采购公告|招标公告|申购说明|发行公告|招投标记录：/.test(text);
  if (/招投标查询|最新招标|今日招标|公司招投标查询|中标查询|企业黄页|采购网黄页|_招投标_|天眼查 API｜招投标|结构化数据：招投标/.test(text) && !hasConcreteDetail) return false;
  if (/招标项目[_｜| -].{0,80}招投标|工程招投标|招投标[-_]/.test(text) && !hasConcreteDetail) return false;
  if (/为.{0,20}建设|承建|实施|交付|客户案例|典型示范案例|项目获奖|获评|近期中标|中标金额|项目获取能力|服务商|解决方案提供商/.test(text) && !/采购人|招标人|采购单位|业主单位|采购公告|招标公告|采购意向|预算金额/.test(text)) return false;
  return hasConcreteDetail || /采购人|招标人|采购单位|业主单位|招标单位|采购公告|招标公告|竞争性谈判|询价公告|采购意向|招标计划|预算金额|采购预算|采购项目|项目编号|中标公告|成交公告|合同公告|政府采购|投标邀请|招标文件|发布采购|甲方/.test(text);
}

function isSupplierDeliveryEvidenceText(value = "") {
  const text = cleanBusinessText(value, 260);
  if (/招投标查询|最新招标|今日招标|公司招投标查询|中标查询|企业黄页|采购网黄页|_招投标_|天眼查 API｜招投标|结构化数据：招投标/.test(text)) return false;
  return meaningful(text) && /近期中标|中标金额|客户案例|为.{0,20}建设|承建|实施|交付|项目获奖|典型示范案例|项目中集成|项目获取能力|解决方案提供商|服务商/.test(text);
}

function isDevelopmentStageEvidenceText(value = "") {
  const text = cleanBusinessText(value, 320);
  if (!meaningful(text)) return false;
  if (/招聘|岗位|人才/.test(text) && !isStrategicHiringEvidenceText(text)) return false;
  if (isProductCatalogTitleOnly(text)) return false;
  if (isSupplierDeliveryEvidenceText(text) && !/近期|202[4-9]|入选|补助|重点研发|总包商|新建|新设|扩产|投产|产能|战略合作|重大合作|签约|融资|上市|并购|募投/.test(text)) return false;
  return /新设|新建|扩张|扩产|投产|产能|融资|上市|并购|募投|战略合作|重大合作|签约|组织调整|高管变更|裁员|舆情|入选|补助|专项资金|重点研发|总包商|首版次|采购公告|采购意向|项目金额|合同金额|近期中标|中标金额|政策项目|政府项目|数字化改造总包商|产学研合作/.test(text) || isStrategicHiringEvidenceText(text);
}

function isCustomerSupplierCompetitorEvidenceText(value = "") {
  const text = cleanBusinessText(value, 280);
  if (!meaningful(text)) return false;
  if (isSupplierDeliveryEvidenceText(text) && !isBuyerProcurementEvidenceText(text)) return false;
  if (/蒙牛|客户案例|为.{0,20}建设|承建|实施|交付|项目获奖|典型示范案例|解决方案提供商|服务商/.test(text) && !/采购人|招标人|采购单位|业主单位|采购公告|中标单位|成交供应商|供应商记录|历史供应商|采购平台|系统供应商|实施商|集成商/.test(text)) return false;
  return /中标单位|成交供应商|供应商记录|历史供应商|供应商[：:\/]|客户[：:\/]|采购占比|采购金额|销售占比|销售金额|报告期|采购平台|系统供应商|既有供应商|合作供应商|合作伙伴|实施商|集成商|竞品|SAP|Oracle|Microsoft|微软|阿里|腾讯|华为|用友|金蝶|达索|西门子|大华|海康/.test(text);
}

function isSameProjectEvidenceText(value = "") {
  const text = cleanBusinessText(value, 280);
  if (!meaningful(text)) return false;
  if (/招聘|岗位|职位/.test(text)) return false;
  if (isProductCatalogTitleOnly(text)) return false;
  if (isSupplierDeliveryEvidenceText(text) && !isBuyerProcurementEvidenceText(text)) return false;
  return isBuyerProcurementEvidenceText(text);
}

function isSellerAdjacentProcurementEvidenceText(value = "", report = {}) {
  const text = cleanBusinessText(value, 320);
  if (!isSameProjectEvidenceText(text)) return false;
  if (!/采购人|招标人|采购单位|业主单位|招标单位|采购公告|招标公告|采购意向|采购项目|项目编号|中标单位|成交供应商|中标公告|成交公告|合同公告|合同金额|项目金额|预算金额|采购预算|政府采购|投标邀请|招标文件|发布采购|甲方/.test(text)) return false;
  if (/财务决算|财务审计|审计|会计师|税务鉴证|法律服务|律师|物业|保洁|安保|办公用品|印刷|食堂|餐饮|体检|保险|车辆租赁|公务用车|装修|会议服务|广告宣传|培训服务/.test(text)) return false;
  const profileText = sellerProfileText(report);
  const mode = sellerCapabilityMode(report);
  if (mode === "digital") {
    return /软件|系统|平台|数据|算法|AI|智能体|知识库|MES|APS|ERP|WMS|LIMS|SCADA|工业互联网|数字化|信息化|自动化|流程|问答|运维|AIOps/.test(text);
  }
  if (/汽车|零部件|动力系统|热管理|电驱|涡轮|EGR|正时|点火|发动机|主机厂|整车/i.test(profileText)) {
    return /汽车|零部件|动力系统|发动机|内燃机|排放|国六|国七|EGR|涡轮|增压器|冷却器|热管理|电驱|电机|逆变器|正时|凸轮|点火线圈|传感器|执行器|配套|样件|台架|PPAP|质量认证/.test(text);
  }
  if (/供应链|物流|外贸|贸易|仓储|报关|海外仓/i.test(profileText)) {
    return /物流|仓储|报关|货代|运输|供应链|外贸|进出口|海外仓|配送|通关|港口/.test(text);
  }
  if (/设备|硬件|产线|制造|机械/i.test(profileText)) {
    return /设备|硬件|产线|生产线|机械|工装|夹具|模具|维保|备件|安装|调试/.test(text);
  }
  return /产品|设备|服务|项目|采购|招标|合同/.test(text);
}

function isBudgetWindowEvidenceText(value = "") {
  const text = cleanBusinessText(value, 280);
  if (!meaningful(text)) return false;
  if (/未明确|未确认|未证实|尚未|暂无|未查到|未发现|不能证明|不构成|仅作为|仅用于|只作为|可能|推测/.test(text)) return false;
  if (/招聘|岗位|职位|客户案例|为.{0,20}建设|承建|实施|交付|项目获奖|典型示范案例|解决方案提供商|服务商/.test(text) && !isBuyerProcurementEvidenceText(text)) return false;
  if (isBuyerProcurementEvidenceText(text)) return true;
  if (/上市募资|募投|年度规划|政府补贴|补助|专项资金|采购意向|预算金额|采购预算|项目金额|合同金额/.test(text)) return true;
  if (/新项目|新基地|新建|扩产|投产/.test(text) && /投资|预算|金额|招标|采购|立项|建设|产能/.test(text)) return true;
  return false;
}

function isConcreteLowValueEvidenceText(value = "") {
  const text = cleanBusinessText(value, 260);
  if (!meaningful(text)) return false;
  if (/信息不足|证据不足|资料有限|不能判断|无法判断|规则|约束|负面信号|投入约束|经营边界/.test(text)) return false;
  return /被执行|失信|限制高消费|经营异常|行政处罚|合同纠纷|付款纠纷|回款纠纷|亏损|资不抵债|吊销|注销|长期无采购|规模小|参保人数\s*[0-9]{1,2}人|注册资本\s*[0-9]{1,3}万/.test(text);
}

function isProductCatalogTitleOnly(value = "") {
  const text = cleanBusinessText(value, 220);
  return /产品中心|提供智能化系统解决方案|^APS\+?-|^MES\+?-|^工业软件-/.test(text) && !/客户案例|中标|建设|承建|交付|获奖|项目中集成|数字化工厂|示范案例/.test(text);
}

function isScaleEvidenceText(value = "") {
  const text = cleanBusinessText(value, 260);
  if (!meaningful(text)) return false;
  if (/产品中心|解决方案|APS|MES|ERP|WMS|LIMS|SCADA|HolliCube|软件著作权|专利|客户案例/.test(text) && !/入选|榜单|总包商|政府项目|重点研发|补助|注册资本|实缴|参保人数|员工|子公司|分支|对外投资|专精特新|单项冠军|隐形冠军|高新技术企业|瞪羚|企业技术中心|工程技术中心|科技进步|奖|荣誉|获奖|获评|认定/.test(text)) return false;
  return /注册资本|实缴资本|参保人数|员工规模|员工数量|员工|分支机构|子公司|对外投资|注册于|成立|客户名单|行业排名|行业榜单|协会|入选|首版次|总包商|政府项目|重点研发|补助|上市|融资|专精特新|单项冠军|隐形冠军|高新技术企业|瞪羚|企业技术中心|工程技术中心|科技进步|奖|奖项|荣誉|获奖|获评|认定/.test(text);
}

function isRegistryOrgEvidenceText(value = "") {
  const text = cleanBusinessText(value, 260);
  if (!meaningful(text)) return false;
  if (/产品中心|APS|MES|ERP|WMS|LIMS|SCADA|HolliCube|客户案例|解决方案/.test(text)) return false;
  return /股东|持股|股权|控股|受益所有人|法定代表人|董监高|高管|主要人员|对外投资|子公司|分支机构|集团|关联|统一社会信用代码|注册地址|注册于|注册资本|实缴资本/.test(text);
}

function isIndustryPositionEvidenceText(value = "") {
  const text = cleanBusinessText(value, 260);
  return meaningful(text) && /行业榜单|协会|入选|首版次|总包商|示范案例|客户案例|政府项目|重点研发|补助|标杆|典型|排名|资质|认证|客户名单|专精特新|单项冠军|隐形冠军|高新技术企业|瞪羚|企业技术中心|工程技术中心|科技进步|奖|奖项|荣誉|获奖|获评|认定/.test(text);
}

function isMaturityEvidenceText(value = "") {
  const text = cleanBusinessText(value, 260);
  return meaningful(text) && /IT岗位|数据岗位|算法|运维|软著|软件著作权|专利|ISO|信息安全|系统采购|平台|MES|APS|ERP|WMS|LIMS|SCADA|工业互联网|数字化|智能制造|数据中台|主数据|HolliCube/.test(text);
}

function isPurchaseBudgetEvidenceText(value = "") {
  const text = cleanBusinessText(value, 260);
  if (!meaningful(text)) return false;
  if (isProcurementDirectoryOnlyText(text)) return false;
  if (/不公示|未公示|未披露|未单独披露|选择不公示|未取得|暂无|待核验|缺少可用|缺少|未查到|无法|未形成|不能证明|未明确|未确认|未证实|尚未|未发现|不构成|仅作为|仅用于|只作为|可能|推测/.test(text)) return false;
  if (/公开资料存在|当前主要是间接|预算判断按|间接经营实力线索|资料中出现|资料显示/.test(text)) return false;
  if (isSupplierDeliveryEvidenceText(text) && !isBuyerProcurementEvidenceText(text)) return false;
  return isConcreteBudgetEvidence(text) || isScaleEvidenceText(text) || isBuyerProcurementEvidenceText(text);
}

function sourceSignalRows(sources = [], pattern, max = 5, options = {}) {
  const rows = [];
  const excludeFamilies = new Set(arr(options.excludeFamilies));
  const excludePattern = options.excludePattern;
  arr(sources).forEach((source, index) => {
    if (excludeFamilies.has(source.sourceFamily)) return;
    const text = sourceSearchText(source);
    if (excludePattern && excludePattern.test(text)) return;
    if (!pattern.test(text)) return;
    if (typeof options.sourcePredicate === "function" && !options.sourcePredicate(source, text)) return;
    const signalText = sourceDecisionSignalText(source);
    if (!meaningful(signalText)) return;
    if (isMethodEvidenceText(signalText)) return;
    if (isLowValueEvidenceText(signalText)) return;
    if (excludePattern && excludePattern.test(signalText)) return;
    if (typeof options.signalPredicate === "function" && !options.signalPredicate(signalText, source)) return;
    rows.push({
      text: signalText,
      sourceId: sourceId(source, index)
    });
  });
  const seen = new Set();
  return rows
    .filter((row) => {
      const key = row.text.replace(/\s+/g, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
}

function structuredProcurementEvidenceRows(sources = [], max = 5) {
  const acceptedTools = new Set(["get_bidding_info", "search_bids", "get_suppliers_and_customers"]);
  const rows = arr(sources)
    .map((source, index) => {
      const tool = String(source.structuredTool || "");
      const sourceText = sourceSearchText(source);
      const body = sourceDecisionSignalText(source);
      const structuredProcurement =
        source.isStructuredEvidence &&
        (acceptedTools.has(tool) || /天眼查 API｜(?:招投标|招投标搜索|供应商\/客户)/.test(source.title || ""));
      const concreteProcurement =
        /招投标记录|采购人|招标人|采购单位|中标结果|成交结果|采购金额|采购占比|供应商[：:]|search_bids|get_bidding_info|get_suppliers_and_customers/i.test(sourceText);
      if (!structuredProcurement || !concreteProcurement || !meaningful(body)) return null;
      return {
        text: compactText(body, 240),
        sourceId: sourceId(source, index)
      };
    })
    .filter(Boolean);
  const seen = new Set();
  return rows
    .filter((row) => {
      const key = normalizeForCompare(row.text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
}

function sellerAdjacentProcurementRows(sources = [], report = {}, max = 6) {
  const rows = arr(sources).flatMap((source, index) => {
    const raw = [
      source.title,
      source.evidenceExcerpt,
      source.snippet,
      source.text,
      source.usedFor,
      source.query
    ]
      .filter(Boolean)
      .join("\n");
    const clauses = uniqueTexts(
      cleanSourceEvidenceShell(raw, 1200)
        .split(/[。；;\n\r]+/)
        .map((item) => cleanBusinessText(item, 240))
        .filter(meaningful),
      30
    );
    return clauses
      .filter((clause) => isSellerAdjacentProcurementEvidenceText(clause, report))
      .map((clause) => ({
        text: clause,
        sourceId: sourceId(source, index)
      }));
  });
  const seen = new Set();
  return rows
    .filter((row) => {
      const key = normalizeForCompare(row.text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
}

function customerInfoSignalRows(round = {}, pattern, max = 5, options = {}) {
  const excludeKeys = new Set(arr(options.excludeKeys));
  const excludePattern = options.excludePattern;
  const rows = arr(round.customerInfo)
    .filter((section) => !excludeKeys.has(section.key))
    .flatMap((section) =>
      arr(section.items).flatMap((item) => {
        const metricText = section.key === "finance" ? `${item.label || item.title || "经营指标"}：${displayMetricValue(item)}` : "";
        const candidates = uniqueTexts([
          metricText,
          ...arr(item.facts),
          item.body,
          item.insight,
          item.summary
        ], 10);
        return candidates.map((candidate) => {
          const text = `${section.title || ""} ${item.title || ""} ${item.label || ""} ${candidate || ""} ${arr(item.facts).join(" ")}`;
          if (excludePattern && excludePattern.test(text)) return null;
          if (!pattern.test(text)) return null;
          if (typeof options.itemPredicate === "function" && !options.itemPredicate(section, item, candidate, text)) return null;
          return {
            text: compactText(candidate, 170),
            sourceIds: normalizeSourceIdList(item)
          };
        });
      })
    )
    .filter((item) => item && meaningful(item.text))
    .filter((item) => !isMethodEvidenceText(item.text))
    .filter((item) => !isLowValueEvidenceText(item.text))
    .filter((item) => !(excludePattern && excludePattern.test(item.text)));
  const seen = new Set();
  return rows
    .filter((item) => {
      const key = normalizeForCompare(item.text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
}

function combinedSignal(round, sources, pattern, max = 5, options = {}) {
  const sourceRows = sourceSignalRows(sources, pattern, max, options);
  const infoRows = customerInfoSignalRows(round, pattern, max, options);
  const evidence = [...sourceRows.map((row) => row.text), ...infoRows.map((row) => row.text)]
    .filter(meaningful)
    .slice(0, max);
  const sourceIds = Array.from(new Set([...sourceRows.map((row) => row.sourceId), ...infoRows.flatMap((row) => row.sourceIds || [])]))
    .filter((value) => Number.isFinite(Number(value)))
    .slice(0, 6);
  return { evidence, sourceIds };
}

function filterSignal(signal = {}, predicate = () => true) {
  const evidence = arr(signal.evidence).filter((item) => predicate(item));
  if (!evidence.length) return { evidence: [], sourceIds: [] };
  if (evidence.length !== arr(signal.evidence).length) {
    return { evidence, sourceIds: [] };
  }
  return {
    evidence,
    sourceIds: arr(signal.sourceIds)
  };
}

function isPresalesEfficiencyEvidenceText(value = "") {
  const text = cleanBusinessText(value, 320);
  if (!meaningful(text)) return false;
  if (/招投标|投标|中标|标书|资质材料|采购公告|招标公告|投标邀请/.test(text)) return true;
  return /项目制|项目交付|定制项目/.test(text) && /售前|标书|资质|版本|方案材料|重复/.test(text);
}

function isEcosystemIntegrationEvidenceText(value = "") {
  const text = cleanBusinessText(value, 320);
  if (!meaningful(text)) return false;
  return /生态伙伴|本地化能力中心|能力中心|伙伴接入|平台融合|行业信息化产品|HolliCube|本地生态服务公司|区域产业集群/.test(text);
}

function isRealtimeDataEvidenceText(value = "") {
  const text = cleanBusinessText(value, 320);
  if (!meaningful(text)) return false;
  return /实时性|完备性|安全性|二次计算|时序数据|实时监控|高频|性能|稳定性|运维|工业时序数据库|云边数据交互/.test(text);
}

function reportInsightSignalRows(report = {}, round = {}, pattern, predicate = () => true, max = 5) {
  const containers = [
    ...arr(report.sourceBriefs).flatMap((brief) => [...arr(brief.facts), ...arr(brief.implications)]),
    ...arr(round.sourceBriefs).flatMap((brief) => [...arr(brief.facts), ...arr(brief.implications)]),
    ...arr(report.businessInsights),
    ...arr(round.businessInsights)
  ].filter(Boolean);
  const rows = containers.flatMap((item) => {
    const candidates = uniqueTexts([
      item.claim,
      item.body,
      item.insight,
      item.summary,
      item.value,
      item.customerSignal,
      item.pain,
      item.opportunity,
      item.reasoning,
      item.sourceBasis,
      item.introduction,
      item.expectedImpact,
      item.prerequisite,
      ...arr(item.facts),
      ...arr(item.implementationPath)
    ], 10);
    return candidates
      .map((candidate) => {
        const text = cleanBusinessText(candidate, 260);
        if (!meaningful(text)) return null;
        if (!pattern.test(text)) return null;
        if (!predicate(text)) return null;
        return { text, sourceIds: normalizeSourceIdList(item) };
      })
      .filter(Boolean);
  });
  const seen = new Set();
  return rows.filter((row) => {
    const key = normalizeForCompare(row.text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, max);
}

function operationalEvidenceRank(key = "", text = "") {
  const value = cleanBusinessText(text, 320);
  if (key === "presalesEfficiency") {
    if (/(?:\d+\s*次.{0,12}招投标|招投标.{0,12}\d+\s*次)/.test(value)) return -1;
    if (/招投标|投标|中标/.test(value) && /\d+\s*次|万元|项目/.test(value)) return 0;
    if (/标书|资质材料|版本一致|方案素材/.test(value)) return 1;
  }
  if (key === "ecosystemIntegration") {
    if (/本地化能力中心|生态伙伴|行业信息化产品|伙伴接入/.test(value)) return 0;
    if (/HolliCube|平台融合|能力中心/.test(value)) return 1;
  }
  if (key === "realtimeData") {
    if (/二次计算|实时监控|时序数据|工业时序数据库|实时性/.test(value)) return 0;
    if (/云边数据交互|性能|稳定性|运维/.test(value)) return 1;
  }
  return 3;
}

function operationalInsightItems(report = {}, round = {}, sources = []) {
  if (sellerCapabilityMode(report) !== "digital") return [];
  const signalOptions = {
    excludeFamilies: ["finance_budget", "subject_registry", "risk_legal"],
    excludeKeys: ["finance", "risk", "local"],
    excludePattern: /工商|主体边界|股权|集团关系|受益所有人|董监高|注册资本|实缴|财务|年报|经营体量|预算能力|付款能力/i
  };
  const definitions = [
    {
      key: "presalesEfficiency",
      title: "投标与项目制带来的售前成本高",
      pattern: /招投标|投标|中标|标书|资质|售前|项目制|项目交付|采购公告|招标公告|定制项目/i,
      directPattern: /标书|资质材料|售前成本|版本一致|重复生产|项目制交付|投标成本|方案复用/i,
      evidencePredicate: isPresalesEfficiencyEvidenceText,
      pain:
        "公开资料显示客户存在招投标、中标或项目交付线索，标书、方案、资质材料和版本一致性可能形成重复售前成本。",
      opportunity:
        "可优先验证标书/方案素材库、资质材料库、项目经验复用和版本审批流程，用企业智能体把重复材料生产压缩成可管控的知识流。",
      confirm:
        "现场重点核对近一年投标/方案材料产出频率、常用资质包、版本审核责任和重复修改原因。"
    },
    {
      key: "ecosystemIntegration",
      title: "生态伙伴融合成本高",
      pattern: /生态伙伴|能力中心|本地化能力中心|伙伴|融合|接口|数据模型|验收标准|集成|HolliCube|平台生态|行业信息化产品/i,
      directPattern: /接口|数据模型|验收标准|重复交付|集成|融合成本|伙伴接入|系统集成/i,
      evidencePredicate: isEcosystemIntegrationEvidenceText,
      pain:
        "公开资料显示客户存在平台融合、能力中心或生态伙伴线索，伙伴接入时接口、数据模型、版本和验收标准不统一，可能带来重复交付压力。",
      opportunity:
        "可围绕伙伴接入规范、接口知识库、行业模板和验收标准沉淀做验证，帮助销售/交付团队减少重复解释和重复实施。",
      confirm:
        "现场重点核对伙伴接入流程、接口文档、数据模型口径、版本管理和验收模板是否已经标准化。"
    },
    {
      key: "realtimeData",
      title: "平台实时数据链路压力",
      pattern: /实时性|完备性|安全性|二次计算|时序数据|实时监控|高频|性能|稳定性|运维|告警|吞吐|延迟|设备数据/i,
      directPattern: /实时性|完备性|安全性|二次计算|时序数据|实时监控|高频|性能|稳定性|运维压力/i,
      evidencePredicate: isRealtimeDataEvidenceText,
      pain:
        "公开资料涉及工业数据实时性、完备性、安全性、二次计算或实时监控场景，平台性能、稳定性和运维能力会成为落地压力。",
      opportunity:
        "可从实时链路监控、异常告警、知识化运维和高频数据处理问起，验证企业智能体是否能补齐一线运维和数据解释能力。",
      confirm:
        "现场重点核对数据刷新频率、二次计算规则、告警闭环、异常复核流程和现有运维工具。"
    }
  ];
  return definitions
    .map((definition) => {
      const scopedOptions = {
        ...signalOptions,
        sourcePredicate: (_source, text) => definition.evidencePredicate(text),
        signalPredicate: (text) => definition.evidencePredicate(text),
        itemPredicate: (_section, _item, candidate, text) => definition.evidencePredicate(`${candidate || ""} ${text || ""}`)
      };
      const signal = combinedSignal(round, sources, definition.pattern, 5, scopedOptions);
      const reportRows = reportInsightSignalRows(report, round, definition.pattern, definition.evidencePredicate, 8);
      const evidenceCandidates = [
        ...reportRows.map((row) => row.text),
        ...arr(signal.evidence).map((item) => cleanBusinessText(item, 220))
      ]
        .filter(definition.evidencePredicate)
        .sort((a, b) => operationalEvidenceRank(definition.key, a) - operationalEvidenceRank(definition.key, b));
      const evidence = uniqueTexts(evidenceCandidates, 5);
      if (!evidence.length) return null;
      const evidenceText = evidence.join(" ");
      const isDirect = definition.directPattern.test(evidenceText);
      const evidenceLevel = isDirect ? "公开证据" : "推测信息";
      const sourceBasis = evidenceDecisionSummary(evidence, definition.title);
      const reasoningPrefix = evidenceLevel === "推测信息" ? "推测信息：公开资料可支撑方向，但需用客户原话或流程样例复核。" : "公开证据：来源已直接出现相关场景或压力线索。";
      return {
        key: definition.key,
        title: definition.title,
        customerSignal: evidence[0],
        pain: definition.pain,
        opportunity: definition.opportunity,
        aiEntry: definition.opportunity,
        reasoning: `${reasoningPrefix} ${sourceBasis}`,
        sourceBasis,
        toConfirm: [definition.confirm],
        evidenceLevel,
        sourceIds: Array.from(new Set([...arr(signal.sourceIds), ...reportRows.flatMap((row) => arr(row.sourceIds))])).slice(0, 6)
      };
    })
    .filter(Boolean);
}

function operationalInsightPattern(key = "") {
  if (key === "presalesEfficiency") return /投标|招投标|标书|资质|售前|项目制|项目交付|版本一致/i;
  if (key === "ecosystemIntegration") return /生态|伙伴|能力中心|融合|接口|数据模型|验收标准|HolliCube/i;
  if (key === "realtimeData") return /实时|二次计算|时序|监控|性能|稳定性|运维|高频/i;
  return null;
}

function hasEquivalentOperationalInsight(key = "", text = "") {
  const value = cleanBusinessText(text, 800);
  if (key === "presalesEfficiency") {
    return /投标与项目制|售前成本|标书|资质材料|版本一致|重复生产|(?:\d+\s*次)?招投标.{0,40}(?:\d+\s*次|中标|万元)/.test(value);
  }
  if (key === "ecosystemIntegration") {
    return /生态伙伴融合成本|伙伴接入|本地化能力中心|行业信息化产品|生态.{0,30}(?:接口|数据模型|验收标准|重复交付)/.test(value);
  }
  if (key === "realtimeData") {
    return /平台实时数据链路压力|二次计算|实时监控|时序数据|工业时序数据库|实时性.{0,20}(?:性能|稳定性|运维)/.test(value);
  }
  return false;
}

function mergeOperationalPainItems(primary = [], operational = [], limit = 8) {
  const raw = arr(primary).filter((item) => meaningful(item.title) || meaningful(item.pain) || meaningful(item.opportunity));
  const existingText = raw.map((item) => `${item.title || ""} ${item.pain || ""} ${item.opportunity || ""} ${item.customerSignal || ""}`).join(" ");
  const supplemental = arr(operational).filter((item) => {
    const pattern = operationalInsightPattern(item.key);
    if (!pattern || !pattern.test(existingText)) return true;
    return !hasEquivalentOperationalInsight(item.key, existingText);
  });
  const out = [];
  const seen = new Set();
  const push = (item) => {
    if (!item) return;
    const key = normalizeForCompare(`${item.title || ""}${item.pain || ""}${item.opportunity || ""}`) || normalizeForCompare(item.customerSignal || "");
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };
  push(raw[0]);
  supplemental.forEach(push);
  raw.slice(1).forEach(push);
  return out.slice(0, limit);
}

function isActionTriggerSignal(value = "") {
  const text = cleanBusinessText(value, 260);
  if (!meaningful(text)) return false;
  if (/招聘|岗位|人才/.test(text) && !isStrategicHiringEvidenceText(text)) return false;
  if (isSupplierDeliveryEvidenceText(text) && !/入选|补助|专项资金|重点研发|总包商|政府项目|数字化改造总包商|首版次|政策|监管|国产化|安全|合规|战略合作|重大合作|签约/.test(text)) return false;
  if (isProductCatalogTitleOnly(text)) return false;
  const actionPattern =
    /扩张|扩产|新建|新增|投产|产能|融资|上市|并购|战略合作|重大合作|签约|招投标|中标|采购项目|招聘|高管|组织调整|处罚|诉讼|监管|政策|国产化|安全|合规|转型|升级|项目|立项|合作/i;
  const staticPattern =
    /财务\/年报记录|经营体量|付款质量|营业收入|净利润|利润|现金流|研发投入|注册资本|实缴|工商|主体核验|股权信息可用于|年报|财报|统一社会信用代码|法定代表人|成立时间/i;
  if (!actionPattern.test(text)) return false;
  if (staticPattern.test(text) && !/招投标|中标|采购项目|招聘|扩张|扩产|新建|新增|投产|产能|融资|上市|并购|战略合作|重大合作|签约|高管|组织调整|处罚|诉讼|监管|政策|国产化|安全|合规|转型|升级|项目|立项|客户案例|合作/i.test(text)) {
    return false;
  }
  return true;
}

function isEntryWindowEvidenceText(value = "") {
  const text = cleanBusinessText(value, 280);
  if (!meaningful(text)) return false;
  if (/未明确|未确认|未证实|尚未|暂无|未查到|未发现|不能证明|不构成|仅作为|仅用于|只作为|可作为|最佳切入点|可跟进|可能|推测/.test(text)) return false;
  if (/招聘|岗位|人才/.test(text) && !isStrategicHiringEvidenceText(text)) return false;
  if (isProductCatalogTitleOnly(text)) return false;
  if (isSupplierDeliveryEvidenceText(text) && !isBuyerProcurementEvidenceText(text)) return false;
  if (isBuyerProcurementEvidenceText(text)) return true;
  const staticHonor = /扎根|隐形冠军|专精特新|单项冠军|高新技术企业|行业地位|政策荣誉|专业化程度|智能制造水平|获奖|获评|认定|荣誉|资质|认证/.test(text);
  const concreteAction = /采购|招标|采购意向|招标计划|预算金额|采购预算|项目金额|合同金额|立项|投资|金额|扩产|新建|新基地|投产|产能|技改|改造|募投|融资|并购|IPO|专项资金|政府补助|补贴|重点研发/.test(text);
  if (staticHonor && !concreteAction) return false;
  if (/采购意向|招标计划|预算金额|采购预算|采购公告|招标公告|项目编号|合同公告|政府采购/.test(text)) return true;
  if (/新设|新建|扩张|扩产|投产|产能|新基地|技改|改造/.test(text) && /投资|预算|金额|招标|采购|立项|建设|产能|募投|专项资金|补助/.test(text)) return true;
  if (/(?:完成|获得|启动|拟|计划|募集|募资|战略|股权|上市|IPO|募投|并购).{0,12}(?:融资|资金|投资)|(?:融资|资金|投资).{0,12}(?:完成|获得|启动|拟|计划|募集|募资|战略|股权|上市|IPO|募投|并购)/.test(text)) return true;
  if (/组织调整|高管变更/.test(text) && /数字化|信息化|智能制造|采购|供应链|生产|质量|研发|IT|技术|数据/.test(text)) return true;
  if (/政府补助|补贴|专项资金|重点研发/.test(text) && /项目|资金|补助|补贴|专项|申报|采购|招标|改造|建设|立项|预算|金额/.test(text)) return true;
  return isStrategicHiringEvidenceText(text);
}

function isConcreteBudgetEvidence(value = "") {
  const text = cleanBusinessText(value, 220);
  if (!meaningful(text)) return false;
  if (/财务\/年报记录用于判断|经营体量和付款质量|资料中出现|资料显示|可读来源|主题覆盖|初访判断门槛/.test(text)) return false;
  return /营收|营业收入|净销售|收入|净利润|利润|现金流|研发投入|毛利|资产负债|融资|上市|招标|中标|采购|预算|项目金额|合同金额|万元|亿元|付款|回款/i.test(text);
}

function signalClaim(prefix, signal, fallback = "") {
  if (arr(signal.evidence).length) return `${prefix}：${signal.evidence[0]}`;
  return fallback;
}

function decisionPathClaim({ people = "", procurementSignal = {}, decision = {} } = {}) {
  if (arr(procurementSignal.evidence).length) {
    return `采购路径应优先追项目和历史供应商线索：${cleanBusinessText(arr(procurementSignal.evidence)[0], 150)}`;
  }
  if (people) {
    return `初访入口可先从${cleanBusinessText(people, 80)}相关职能切入，再向业务负责人和预算负责人上收。`;
  }
  return usefulDecisionText(decision.conclusion) || "";
}

function actionOpeningSentence(report = {}, round = {}, brief = {}) {
  const topSolution = arr(round.solutionCards).find((item) => meaningful(item.title)) || {};
  const topPain = arr(round.painsAndOpportunities).find((item) => meaningful(item.title || item.pain || item.opportunity)) || {};
  const topic = cleanBusinessText(topSolution.title || topPain.title || topPain.pain || "", 80);
  if (topic) return `开场先围绕“${topic}”问现状、损失和目标指标，再顺势引出我方方案。`;
  return usefulDecisionText(brief.entry) || "现场应先用客户关心的业务场景开场，而不是先讲产品清单。";
}

function intelCard({ title, verdict, body = "", evidence = [], sourceIds = [], tone = "" }, sources = []) {
  const cleanVerdict = claimSentence(verdict, "", 180);
  if (!cleanVerdict) return "";
  const cleanEvidence = usefulEvidenceTexts(evidence, 3);
  return `<article class="first-visit-card ${e(tone)}">
    <span>${e(title)}</span>
    <b>${e(cleanVerdict)}</b>
    ${body ? `<p>${e(cleanBusinessText(body, 170))}</p>` : ""}
    ${sourceIds.length ? evidenceLinks({ sourceIds }, sources) : ""}
    ${cleanEvidence.length ? `<ul>${cleanEvidence.map((item) => `<li>${e(item)}</li>`).join("")}</ul>` : ""}
  </article>`;
}

function decisionTreeSection({ title, subtitle = "", cards = [], sources = [], className = "" }) {
  const visibleCards = arr(cards).filter((card) => usefulDecisionText(card?.verdict || ""));
  if (!visibleCards.length) return "";
  const cardHtml = visibleCards.map((card) => intelCard(card, sources)).filter(meaningful).join("");
  if (!cardHtml) return "";
  return `<section class="decision-tree-section ${e(className)}">
    <div class="section-head">
      <span>${e(title)}</span>
      ${subtitle ? `<p>${e(subtitle)}</p>` : ""}
    </div>
    <div class="decision-tree-grid">${cardHtml}</div>
  </section>`;
}

function firstVisitIntelSection({ report, round, sources, pyramid, rating, brief, budget, decision, budgetMetrics, people, triggerSignal, procurementSignal, competitorSignal, riskEvidence, operating }) {
  const questions = allRenderedQuestions(round, report);
  const pains = arr(round.painsAndOpportunities).filter((item) => meaningful(item.title) || meaningful(item.pain) || meaningful(item.opportunity));
  const topPain = pains[0] || {};
  const worth = arr(pyramid.cards)[0] || {};
  const actionableRiskEvidence = arr(riskEvidence).map(usefulDecisionText).filter(Boolean);
  const cards = [
    {
      title: "客户优先级",
      verdict: worth.verdict || rating.summary || brief.oneLine,
      body: `评级 ${rating.grade || "待评估"}｜${rating.score || "-"} 分。${rating.nextAction || brief.next || ""}`,
      evidence: [...arr(worth.evidence), brief.reason],
      sourceIds: arr(pyramid.sourceIds).slice(0, 4),
      tone: worth.tone || "strong"
    },
    {
      title: "经营状态、近期触发与切入话题",
      verdict:
        brief.entry ||
        (arr(triggerSignal.evidence).length ? `近期接触窗口来自：${triggerSignal.evidence[0]}` : "") ||
        topPain.opportunity ||
        topPain.pain,
      body: "把经营状态、近期触发和推荐切入话题合并判断：为什么现在见，以及第一句话从哪里打开。",
      evidence: [...arr(triggerSignal.evidence), brief.reason, topPain.sourceBasis, topPain.reasoning],
      sourceIds: Array.from(new Set([...arr(triggerSignal.sourceIds), ...collectSourceIds([topPain])])).slice(0, 6),
      tone: arr(triggerSignal.evidence).length ? "strong" : "watch"
    },
    {
      title: "采购习惯、关键人和决策链",
      verdict: decisionPathClaim({ people, procurementSignal, decision }),
      body: "这一项合并回答：谁可能影响采购、客户习惯怎么走、我们应该从业务、技术还是管理入口推进。",
      evidence: [people ? `可查角色：${people}` : "", ...arr(procurementSignal.evidence), ...arr(decision.evidence), ...arr(decision.deductions)],
      sourceIds: arr(procurementSignal.sourceIds),
      tone: decision.score >= 75 ? "strong" : decision.score < 58 ? "risk" : "watch"
    },
    {
      title: "风险提醒与避坑",
      verdict: actionableRiskEvidence.length
        ? `当前最该避开的坑是：${actionableRiskEvidence[0]}`
        : arr(competitorSignal.evidence).length
          ? `已有竞品/供应商线索，初访要先判断是替换、补位还是联合交付：${competitorSignal.evidence[0]}`
          : "",
      body: "客户明确业务场景、样例数据、责任人和验收口径后，再进入定制方案、投入边界或试点范围讨论。",
      evidence: [...actionableRiskEvidence, ...arr(competitorSignal.evidence)],
      sourceIds: arr(competitorSignal.sourceIds),
      tone: "risk"
    },
    {
      title: "必问问题与下一步",
      verdict: questions.length ? `这次必须先问：${questions[0]}` : operating.verdict || rating.presalesAdvice || brief.next,
      body: "会后根据客户回答决定进入二次交流、需求调研、方案演示、高层引荐或暂缓投入。",
      evidence: [...questions.slice(0, 4), operating.verdict, rating.nextAction],
      tone: "strong"
    }
  ].filter((card) => usefulDecisionText(card.verdict) && (arr(card.evidence).some(meaningful) || arr(card.sourceIds).length || /必问问题|下一步/.test(card.title)));
  return `<section class="first-visit-intel-section">
    <div class="section-head">
      <span>初访作战情报</span>
      <p>把外部资料加工成会前决策卡：先判断值不值得见，再决定聊什么、问什么、避什么坑。</p>
    </div>
    <div class="first-visit-grid">${cards.map((card) => intelCard(card, sources)).join("")}</div>
  </section>`;
}

function presalesPlaybookSection({ round, sources, strategy, pains, solutions, industryPressure, topicSignal }) {
  const topPain = arr(pains)[0] || {};
  const topSolution = arr(solutions)[0] || {};
  const solutionEvidence = arr(solutions)
    .slice(0, 4)
    .map((item) => `${item.priority || "P1"}｜${item.title}${item.value ? `：${item.value}` : ""}`);
  const pathEvidence = arr(strategy.implementationPath).length
    ? arr(strategy.implementationPath)
    : ["先拿一个可验证小场景确认价值，再讨论系统集成、数据授权和正式方案范围。"];
  return decisionTreeSection({
    title: "售前方案作战树",
    subtitle: "把客户现状、痛点假设、解决思路、方案排序和落地路径串起来，避免售前只拿产品清单去讲。",
    className: "presales-playbook-section",
    sources,
    cards: [
      {
        title: "客户现状",
        verdict: strategy.currentSituation || topPain.customerSignal || topPain.pain || "当前应先围绕已见业务线索建立客户现状假设。",
        body: "现状判断用于决定第一场交流从哪个业务场景切入，而不是作为客户内部事实直接断言。",
        evidence: [topPain.customerSignal, topPain.sourceBasis, ...arr(industryPressure.evidence)],
        sourceIds: [...normalizeSourceIdList(topPain), ...arr(industryPressure.sourceIds)].slice(0, 5),
        tone: "watch"
      },
      {
        title: "痛点假设",
        verdict: topPain.opportunity || topPain.pain || "优先验证客户最容易量化价值的业务痛点。",
        body: "痛点假设需要在初访中用问题验证，验证通过后再转成正式方案范围。",
        evidence: arr(pains).slice(0, 4).map((item) => item.pain || item.opportunity || item.customerSignal || item.title),
        sourceIds: collectSourceIds(arr(pains).slice(0, 4)),
        tone: "strong"
      },
      {
        title: "解决思路",
        verdict: strategy.overallApproach || "先做场景收敛，再形成流程、数据和系统协同的分阶段方案。",
        body: "这一层是售前主线，用来把多个分项方案串成一个客户听得懂的总体打法。",
        evidence: pathEvidence,
        tone: "strong"
      },
      {
        title: "方案排序",
        verdict: topSolution.title ? `建议先讲${topSolution.priority || "P0"}：${topSolution.title}。` : "方案应按价值可见度和落地难度排序，不宜平均铺开。",
        body: "优先讲能快速验证价值、能牵出后续系统集成机会的方案。",
        evidence: solutionEvidence,
        sourceIds: collectSourceIds(arr(solutions).slice(0, 4)),
        tone: "watch"
      },
      {
        title: "价值验证与落地路径",
        verdict: arr(pathEvidence)[0],
        body: "价值要落到指标：节省时间、减少错误、提高追溯、降低返工或缩短交付；路径要先确认场景、样例、数据、系统、责任人和预算窗口。",
        evidence: [...pathEvidence, ...arr(topicSignal.evidence).slice(0, 3)],
        sourceIds: arr(topicSignal.sourceIds).slice(0, 4),
        tone: ""
      }
    ]
  });
}

function visitValidationSection(report, round, sources = []) {
  const rating = ratingOf(report);
  const brief = buildExecutiveBrief(report, round);
  const coreQuestion = coreBusinessQuestion(report, round, brief);
  const questions = allRenderedQuestions(round, report);
  const businessQuestions = questionsByGroup(round, /业务/, report);
  const budgetQuestions = questionsByGroup(round, /预算|决策/, report);
  const dataQuestions = questionsByGroup(round, /IT|数据/, report);
  const notes = arr(round.internalNotes).filter(isActionableInternalNote);
  const budget = dimensionByKey(report, "budgetAbility");
  const decision = dimensionByKey(report, "decisionRiskControl");
  let procurementSignal = combinedSignal(round, sources, /招标|采购|合同|预算|项目金额|采购金额|投标邀请|采购人|招标人|采购单位|政府采购/i, 5, {
    sourcePredicate: (_source, text) => isBuyerProcurementEvidenceText(text),
    signalPredicate: isBuyerProcurementEvidenceText,
    itemPredicate: (_section, _item, candidate) =>
      isBuyerProcurementEvidenceText(candidate) &&
      /招投标|供应商|采购人|招标人|采购单位|采购公告|招标公告|采购金额|采购占比|成交供应商|中标单位/.test(candidate) &&
      !/营收|净利润|现金流|预算来源|审批流程|付款主体|决策链/.test(candidate)
  });
  const procurementSourceRows = sourceSignalRows(sources, /招标|采购|合同|预算|项目金额|采购金额|投标邀请|采购人|招标人|采购单位|政府采购|供应商/i, 8, {
    sourcePredicate: (source, text) => /tender_project/.test(source.sourceFamily || "") && isBuyerProcurementEvidenceText(text),
    signalPredicate: isBuyerProcurementEvidenceText
  });
  if (procurementSourceRows.length) {
    procurementSignal = {
      evidence: procurementSourceRows.map((row) => row.text).slice(0, 6),
      sourceIds: procurementSourceRows.map((row) => row.sourceId).filter((value) => Number.isFinite(Number(value))).slice(0, 6)
    };
  }
  const procurementDirectorySignal = combinedSignal(round, sources, /招投标|招标项目|采购平台|供应商门户|供应商平台|工程招投标/i, 5, {
    sourcePredicate: (_source, text) => isProcurementDirectoryOnlyText(text),
    signalPredicate: isProcurementDirectoryOnlyText,
    itemPredicate: (_section, _item, candidate) => isProcurementDirectoryOnlyText(candidate)
  });
  return decisionTreeSection({
    title: "初访验证清单",
    subtitle: "把外部情报转成现场必须问实的问题，避免拜访结束后仍不知道能不能推进。",
    className: "visit-validation-section",
    sources,
    cards: [
      {
        title: "先问业务痛点",
        verdict: coreQuestion || businessQuestions[0] || "先问客户当前最痛的业务场景，而不是先介绍产品功能。",
        body: "目标是判断客户是否真的有业务牵引，而不是只有初步兴趣。",
        evidence: uniqueTexts([coreQuestion, ...businessQuestions], 3),
        tone: "strong"
      },
      {
        title: "问清预算与决策链",
        verdict: budget.conclusion || decision.conclusion || "必须确认项目是否立项、预算归属、需求发起人、技术把关人、采购流程和最终拍板人。",
        body: "这是判断售前投入深度的关键：预算和拍板路径不清，就不要贸然进入重方案。",
        evidence: [...budgetQuestions, ...arr(budget.evidence), ...arr(procurementSignal.evidence), ...arr(decision.evidence), ...arr(decision.deductions)].slice(0, 5),
        sourceIds: arr(procurementSignal.sourceIds).slice(0, 4),
        tone: "watch"
      },
      {
        title: "确认数据与系统边界",
        verdict: "要问清数据能否提供、系统能否接入、是否允许脱敏样例或离线验证。",
        body: "这决定方案能否落地，也决定演示、POC 和后续投入边界。",
        evidence: dataQuestions.length ? dataQuestions.slice(0, 4) : questions.filter((item) => /数据|系统|接口|权限|样例|脱敏|部署|安全/.test(item)).slice(0, 4),
        tone: ""
      },
      {
        title: "内部承诺边界",
        verdict: notes[0] || "需求、数据、预算和决策链锁定前，不承诺范围、效果和免费验证。",
        body: "这一项是给销售/售前自己看的，用来保护投入空间和验收口径。",
        evidence: notes.slice(0, 4),
        tone: "risk"
      },
      {
        title: "会后推进动作",
        verdict: rating.nextAction || brief.next || "会后应推动二次交流、需求调研、样例验证或高层引荐。",
        body: "拜访反馈输入系统后，评级、方案、问题清单和内部注意事项会按最新轮次刷新。",
        evidence: [rating.presalesAdvice, brief.entry, brief.reason],
        tone: "strong"
      }
    ]
  });
}

function salesPyramidConsultingSection(report, round, sources = []) {
  const pyramid = buildSalesPyramid(report, round, sources);
  const rating = ratingOf(report);
  const brief = buildExecutiveBrief(report, round);
  return `<section class="battle-section perspective-section sales-consulting-section">
    ${tabClaim(pyramid.summary || brief.oneLine, `评级 ${rating.grade || "待评估"}｜${rating.score || "-"} 分。${cleanBusinessText(rating.nextAction || brief.next, 180)}`, "商务分析")}
    <div class="pyramid-stack">
      ${pyramid.cards.map((card, index) => `<details class="pyramid-node ${e(card.tone || "")}" ${index === 0 ? "open" : ""}>
        <summary><span>${e(card.title)}</span><b>${e(cleanBusinessText(card.verdict, 220))}</b></summary>
        ${arr(card.evidence).length ? list(arr(card.evidence).map((item) => cleanBusinessText(item, 180))) : `<p>${e("当前没有足够可用依据，先不强行展开。")}</p>`}
      </details>`).join("")}
    </div>
    ${pyramid.sourceIds.length ? `<div class="claim-evidence">${evidenceLinks({ sourceIds: pyramid.sourceIds }, sources)}</div>` : ""}
  </section>`;
}

function profileBranchItems(section = {}, body = "", evidence = []) {
  const title = cleanBusinessText(section.title || section.key || "客户信息", 36);
  const lines = uniqueTexts([body, ...arr(evidence)], 4).filter(usefulDecisionText);
  const first = cleanBusinessText(lines[0] || body || title, 150);
  const second = cleanBusinessText(lines[1] || lines[0] || body || title, 150);
  const key = String(section.key || section.title || "");
  const byType = (() => {
    if (/finance|财务|经营|规模/.test(key)) {
      return [
        { title: "规模信号", claim: `经营指标显示客户的规模判断入口是：${first}。`, evidence: [first] },
        { title: "买单含义", claim: `买单能力要把${second}与项目预算、付款主体和采购流程一起验证。`, evidence: [second] },
        { title: "商务用途", claim: "这些指标会影响首轮投入强度、报价节奏和是否升级正式方案。", evidence: lines.slice(0, 3) }
      ];
    }
    if (/risk|风险|法务|信用/.test(key)) {
      return [
        { title: "风险信号", claim: `当前可见风险重点是：${first}。`, evidence: [first] },
        { title: "商务影响", claim: "风险线索会影响付款条件、合同边界和是否需要管理层提前参与。", evidence: lines.slice(0, 2) },
        { title: "使用方式", claim: "风险信息只用于设计避坑动作，不替代正式尽调或客户内部确认。", evidence: lines.slice(0, 3) }
      ];
    }
    if (/digital|AI|数字|系统|技术/.test(key)) {
      return [
        { title: "技术基础", claim: `技术和系统基础的主要信号是：${first}。`, evidence: [first] },
        { title: "方案入口", claim: "数字化线索决定AI智能体是嵌入既有系统，还是先做轻量工作台和知识库。", evidence: lines.slice(0, 2) },
        { title: "验证重点", claim: "初访应把系统边界、数据权限和当前工具链问清，避免方案落不到现场。", evidence: lines.slice(0, 3) }
      ];
    }
    if (/business|产品|客户|市场|业务|案例/.test(key)) {
      return [
        { title: "业务场景", claim: `业务画像的核心信号是：${first}。`, evidence: [first] },
        { title: "客户/市场含义", claim: "产品、客户和案例线索决定首轮应讲客户业务问题，而不是只讲我方功能。", evidence: lines.slice(0, 2) },
        { title: "方案用途", claim: "这些业务线索会影响痛点排序、方案优先级和现场问题清单。", evidence: lines.slice(0, 3) }
      ];
    }
    return [
      { title: "关键事实", claim: `${title}的关键事实是：${first}。`, evidence: [first] },
      { title: "业务含义", claim: "这些主体信息决定客户主体边界、沟通对象和后续方案适配范围。", evidence: lines.slice(0, 2) },
      { title: "判断用途", claim: "主体边界是商务、方案和交付判断的底座，商机结论仍要结合预算、需求和推进路径。", evidence: lines.slice(0, 3) }
    ];
  })();
  return byType
    .map((branch) => ({
      ...branch,
      claim: usefulDecisionText(branch.claim),
      evidence: arr(branch.evidence).map(usefulEvidenceText).filter(Boolean)
    }))
    .filter((branch) => meaningful(branch.claim));
}

function trimSentenceEnd(text = "") {
  return String(text || "").trim().replace(/[。；;，,\s]+$/g, "");
}

function profileNodeClaim(section = {}, title = "", body = "") {
  const key = String(section.key || section.title || "");
  const fact = trimSentenceEnd(cleanBusinessText(body || "", 210));
  if (!meaningful(fact)) return "";
  if (/finance|财务|经营|规模/.test(key)) {
    return `${fact}。这是判断预算承载和买单能力的主要经营信号，首轮应继续核对项目预算来源、采购主体和付款节奏。`;
  }
  if (/risk|风险|法务|信用/.test(key)) {
    return `当前可见风险集中在：${fact}。商务推进应把付款条件、合同边界和风控核验前置。`;
  }
  if (/digital|AI|数字|系统|技术/.test(key)) {
    return `数字化线索显示：${fact}。初访应先问清系统边界、数据权限和现有工具链。`;
  }
  if (/business|产品|客户|市场|业务|案例/.test(key)) {
    return `客户业务画像显示：${fact}。方案交流应围绕真实经营场景展开，而不是只讲我方功能。`;
  }
  if (/local|主体|股权|区域|工商|高管|组织/.test(key) || /主体|股权|区域|工商|高管|组织/.test(title)) {
    return `主体和组织边界显示：${fact}。商务推进应先确认本地主体、集团关系和实际拍板路径。`;
  }
  return `${title || "客户画像"}的主线是：${fact}。后续商务、方案和交付判断都应围绕它展开。`;
}

function infoEvidenceBySection(round = {}, sectionPattern = /.*/, itemPattern = /.*/, max = 5) {
  const rows = arr(round.customerInfo)
    .filter((section) => sectionPattern.test(`${section.key || ""} ${section.title || ""}`))
    .flatMap((section) =>
      arr(section.items).flatMap((item) => {
        const metricText = section.key === "finance" ? `${item.label || item.title || "经营指标"}：${displayMetricValue(item)}` : "";
        const candidates = uniqueTexts([
          metricText,
          ...arr(item.facts),
          item.body,
          item.insight,
          item.summary
        ], 12);
        return candidates.map((text) => {
          const haystack = `${section.title || ""} ${item.title || ""} ${item.label || ""} ${text} ${arr(item.facts).join(" ")}`;
          return itemPattern.test(haystack) && usefulEvidenceText(text) && !isLowValueEvidenceText(text) ? { text: usefulEvidenceText(text), sourceIds: normalizeSourceIdList(item) } : null;
        });
      })
    )
    .filter(Boolean);
  const seen = new Set();
  return rows
    .filter((item) => {
      const key = normalizeForCompare(item.text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, max);
}

function mergeEvidenceRows(...groups) {
  const seen = new Set();
  return groups
    .flat()
    .filter(Boolean)
    .map((item) => (typeof item === "string" ? { text: item, sourceIds: [] } : item))
    .filter((item) => meaningful(item.text))
    .filter((item) => {
      const key = normalizeForCompare(item.text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function evidenceTexts(rows = [], max = 5) {
  return rows.map((item) => item.text).filter(meaningful).slice(0, max);
}

function evidenceSummary(rows = [], max = 2, limit = 96) {
  return evidenceTexts(rows, max)
    .map((item) => cleanBusinessText(item, limit))
    .filter(meaningful)
    .join("；");
}

function evidenceSourceIds(rows = [], max = 6) {
  return Array.from(new Set(rows.flatMap((item) => arr(item.sourceIds)).map((item) => Number(item)).filter(Number.isFinite))).slice(0, max);
}

function financialProfileKey(label = "") {
  const key = annualMetricKey(label);
  if (/营业收入|归母净利润|扣非净利润|毛利率|经营现金流/.test(key)) return key;
  if (/营收|收入|销售额|净销售/.test(label)) return "营业收入";
  if (/净利润|利润/.test(label)) return "归母净利润";
  if (/毛利/.test(label)) return "毛利率";
  if (/现金流/.test(label)) return "经营现金流";
  return "";
}

function moneyValueInYi(value = "") {
  const text = String(value || "").replace(/,/g, "");
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const num = Number(match[0]);
  if (!Number.isFinite(num)) return null;
  if (/亿元/.test(text)) return num;
  if (/万元/.test(text)) return num / 10000;
  if (/元/.test(text)) return num / 100000000;
  return null;
}

function maxMoneyInYiByPattern(evidence = [], pattern = /.*/) {
  const values = arr(evidence)
    .filter((text) => pattern.test(String(text || "")))
    .map((text) => moneyValueInYi(text))
    .filter((value) => Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}

function financialCapacityLabel(evidence = []) {
  const revenue = maxMoneyInYiByPattern(evidence, /营收|营业收入|收入|销售额/);
  const profit = maxMoneyInYiByPattern(evidence, /归母净利润|净利润|利润/);
  const cash = maxMoneyInYiByPattern(evidence, /现金流/);
  const strong = (revenue ?? 0) >= 50 || (profit ?? 0) >= 5 || (cash ?? 0) >= 5;
  const medium = (revenue ?? 0) >= 5 || (profit ?? 0) > 0 || (cash ?? 0) > 0;
  if (strong) return "采购承载能力较强";
  if (medium) return "采购承载能力中等以上";
  if ((revenue ?? 0) > 0) return "采购承载能力有基础但不宜按强预算判断";
  return "采购承载能力只能作谨慎初判";
}

function financialKpiRowsForProfile(report = {}, round = {}) {
  const rows = [];
  const seen = new Set();
  const push = (key, value, meta = {}) => {
    const label = financialProfileKey(key);
    const formatted = typeof value === "string" ? value.trim() : displayMetricValue({ label, value });
    if (!label || !meaningful(formatted) || formatted === "待核验" || /^0(?:\.0+)?(?:元|万元|亿元|%)?$/.test(formatted)) return;
    if (/不公示|未公示|未披露|选择不公示|未取得|暂无/.test(formatted)) return;
    const dedupe = normalizeForCompare(`${label}${formatted}`);
    if (!dedupe || seen.has(dedupe)) return;
    seen.add(dedupe);
    rows.push({
      label,
      value: formatted,
      text: `${label}：${formatted}`,
      sourceIds: normalizeSourceIdList(meta),
      annualPage: meta.annualPage || meta.page,
      annualFileName: meta.annualFileName,
      evidenceExcerpt: meta.evidenceExcerpt || meta.context || meta.note || ""
    });
  };
  for (const item of arr(report.customerInsights?.metrics)) {
    if (!renderableMetric(item)) continue;
    const key = financialProfileKey(item.label || item.title || "");
    if (!key) continue;
    push(key, displayMetricValue(item), item);
  }
  for (const item of arr(round.customerInfo).filter((section) => /finance|财务|经营|规模/.test(`${section.key || ""} ${section.title || ""}`)).flatMap((section) => arr(section.items))) {
    if (!renderableMetric(item)) continue;
    const key = financialProfileKey(item.label || item.title || "");
    if (!key) continue;
    push(key, displayMetricValue(item), item);
  }
  for (const item of derivedAnnualMetricMap(report).values()) {
    const key = financialProfileKey(item.label);
    if (!key) continue;
    push(key, item.value, item);
  }
  infoEvidenceBySection(round, /finance|财务|经营|规模/, /营业收入|营收|收入|净利润|归母|扣非|利润|毛利率|经营现金流|现金流/, 8)
    .forEach((row) => {
      const key = financialProfileKey(row.text);
      if (key) push(key, row.text.replace(new RegExp(`^${key}[：:]?`), ""), row);
    });
  const order = ["营业收入", "归母净利润", "扣非净利润", "毛利率", "经营现金流"];
  return rows.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
}

function financialCapacityClaim(rows = []) {
  if (!arr(rows).length) return "未查到可用的营收、利润、毛利率或现金流指标，暂不形成营收能力结论。";
  const byLabel = new Map(rows.map((row) => [row.label, row.text]));
  const revenueYi = moneyValueInYi(byLabel.get("营业收入"));
  const profitText = byLabel.get("归母净利润") || byLabel.get("扣非净利润") || "";
  const profitYi = moneyValueInYi(profitText);
  const cashText = byLabel.get("经营现金流") || "";
  const cashYi = moneyValueInYi(cashText);
  if ((Number.isFinite(profitYi) && profitYi < 0) || (Number.isFinite(cashYi) && cashYi < 0)) {
    return "营收能力存在承压信号，重方案投入前必须核对预算来源和付款主体。";
  }
  if (Number.isFinite(revenueYi) && revenueYi >= 10) {
    return "营收能力较强，具备承载中大型项目预算的财务基础。";
  }
  if (Number.isFinite(revenueYi) && revenueYi >= 1) {
    return "营收能力中等，适合从可验证的小闭环项目切入。";
  }
  if (byLabel.has("营业收入")) {
    return "营收能力已有收入指标支撑，但项目预算空间仍需结合利润和现金流判断。";
  }
  return "营收能力只能做局部判断，缺少营业收入指标支撑。";
}

function financialKpiBoardBranch(rows = []) {
  const fields = arr(rows).slice(0, 8).map((row) => ({
    label: row.label,
    value: row.value || String(row.text || "").replace(new RegExp(`^${row.label}[：:]?`), "")
  }));
  const annualRows = arr(rows).filter((row) => row.annualPage || row.annualFileName || row.evidenceExcerpt);
  const pageSummary = uniqueTexts(
    annualRows
      .map((row) => [row.annualFileName || "年报", row.annualPage ? `P${row.annualPage}` : ""].filter(Boolean).join(" "))
      .filter(meaningful),
    3
  ).join("；");
  if (pageSummary) fields.push({ label: "来源口径", value: `同一财务看板合并展示，来源集中为${pageSummary}。` });
  return {
    title: "财务KPI看板",
    claim: financialCapacityClaim(rows),
    fields,
    kind: "finance-kpi-board",
    evidence: evidenceTexts(rows, 8),
    sourceIds: evidenceSourceIds(rows),
    forceDisplay: true
  };
}

function organizationComplexityAssessment(rows = []) {
  const evidence = arr(rows).filter((row) => meaningful(row.text));
  const complexRows = evidence.filter((row) => /集团|子公司|分支机构|对外投资|控股|关联|受益所有人|多层|母公司/.test(row.text));
  const basicRows = evidence.filter((row) => /统一社会信用代码|注册地址|注册于|注册资本|实缴资本|法定代表人|股东|持股|董监高|主要人员/.test(row.text));
  if (complexRows.length) {
    return {
      label: "组织链条偏复杂",
      claim: "组织链条偏复杂，依据是已查到集团、子公司、分支机构、对外投资、控股或关联等组织结构线索。",
      evidence: evidenceTexts(complexRows, 6),
      sourceIds: evidenceSourceIds(complexRows),
      tone: "watch",
      branches: [
        {
          title: "复杂链条证据",
          claim: "已查到集团、子公司、分支机构、对外投资、控股或关联等组织结构线索，说明组织边界不能按单一主体理解。",
          evidence: evidenceTexts(complexRows, 5),
          sourceIds: evidenceSourceIds(complexRows)
        }
      ]
    };
  }
  if (basicRows.length) {
    return {
      label: "组织边界相对集中",
      claim: "公开资料只支持基础工商主体判断，未形成组织链条复杂结论。",
      evidence: evidenceTexts(basicRows, 5),
      sourceIds: evidenceSourceIds(basicRows),
      tone: "",
      branches: [
        {
          title: "主体边界",
          claim: "已查到基础登记和人员信息，但缺少集团、子公司、分支机构或多层投资等复杂链条证据。",
          evidence: evidenceTexts(basicRows, 4),
          sourceIds: evidenceSourceIds(basicRows)
        }
      ]
    };
  }
  return {
    label: "组织边界未判断",
    claim: "",
    evidence: [],
    sourceIds: [],
    tone: "",
    branches: []
  };
}

function industryPositionClaim(rows = []) {
  const text = arr(rows).map((row) => row.text || row).join(" ");
  const summary = cleanBusinessText(evidenceDecisionSummary(rows, "公开背书"), 170).replace(/[，,。；;\s]+$/g, "");
  if (/专精特新|单项冠军|隐形冠军|高新技术企业|瞪羚|企业技术中心|工程技术中心|奖|奖项|荣誉|获奖|获评|认定/.test(text)) {
    return `行业地位有荣誉、资质或奖项背书：${summary}。这些背书说明客户具备细分领域认可度，但不能单独证明项目预算。`;
  }
  return `行业地位有公开背书：${summary}。这些背书可用于判断客户可信度，但不能单独证明项目预算。`;
}

function industryPositionEvidenceText(value = "") {
  const text = cleanBusinessText(value, 420);
  const sentence = splitChineseSentences(text).find((item) => isIndustryPositionEvidenceText(item));
  return sentence ? cleanBusinessText(sentence, 180) : cleanBusinessText(text, 180);
}

function entryWindowClaimFromEvidence(values = []) {
  const evidence = arr(values)
    .filter(meaningful)
    .filter((item) => isEntryWindowEvidenceText(item));
  if (!evidence.length) return "未查到明确进入窗口。";
  const text = evidence.join(" ");
  const types = [];
  if (/采购意向|采购预算|预算金额|采购公告|招标公告|政府采购|招标计划/.test(text)) types.push("采购/预算动作");
  if (/项目金额|合同金额|立项|技改|改造/.test(text)) types.push("项目/改造动作");
  if (/新建|扩产|投产|新基地|产能/.test(text)) types.push("扩产/建设动作");
  if (/(?:完成|获得|启动|拟|计划|募集|募资|战略|股权|上市|IPO|募投|并购).{0,12}(?:融资|资金|投资)|(?:融资|资金|投资).{0,12}(?:完成|获得|启动|拟|计划|募集|募资|战略|股权|上市|IPO|募投|并购)/.test(text)) types.push("融资/募投动作");
  if (/组织调整|高管变更/.test(text)) types.push("组织变化");
  if (/专项资金|政府补助|补贴|重点研发/.test(text)) types.push("政策资金项目");
  const summary = signalTextSummary(evidence, 1, 100);
  return summary
    ? `存在可跟进窗口：近期出现${uniqueTexts(types, 3).join("、") || "具体触发事件"}，依据是${summary}。`
    : "未查到明确进入窗口。";
}

function profilePriorityLevel({ metrics = [], scaleRows = [], industryRows = [] }) {
  const supportCount = arr(metrics).length + arr(scaleRows).length + arr(industryRows).length;
  if (arr(metrics).length >= 3 || (arr(scaleRows).length >= 3 && arr(industryRows).length >= 2)) return "高";
  if (arr(metrics).length >= 1 || supportCount >= 3) return "中";
  return "低";
}

function stageLabelFromEvidence(rows = []) {
  const text = rows.map((item) => item.text).join(" ");
  if (/扩张|扩产|新增|新建|投产|招聘|中标|合作|项目|入选|总包商/.test(text)) return "扩张/转型";
  if (/亏损|承压|处罚|诉讼|被执行|裁员|收缩/.test(text)) return "承压";
  if (/转型|升级|数字化|智能制造|AI|工业互联网/.test(text)) return "转型";
  return "稳定";
}

function operatingLabelFromEvidence(rows = []) {
  const text = rows.map((item) => item.text).join(" ");
  if (/亏损|现金流|被执行|诉讼|处罚|承压|付款|回款/.test(text)) return "资金/合规压力";
  if (/转型|数字化|智能制造|AI|工业互联网|升级/.test(text)) return "转型";
  if (/中标|项目|增长|扩张|招聘|入选/.test(text)) return "增长";
  return "稳定经营";
}

function isOperatingStatusEvidenceText(value = "") {
  const text = cleanBusinessText(value, 300);
  if (!meaningful(text)) return false;
  if (/注册资本|实缴资本|注册地址|注册于|法定代表人|股东|持股|对外投资/.test(text)) return false;
  if (/客户案例|项目获奖|为.{0,20}建设|承建|实施|交付|解决方案提供商|服务商/.test(text)) return false;
  return /营收|营业收入|收入|净利润|归母|扣非|利润|现金流|毛利|资产负债|研发投入|亏损|承压|被执行|诉讼|行政处罚|经营异常|回款|付款|融资|上市|募投|裁员|扩产|投产|新基地/.test(text);
}

function evidenceCategorySummary(rows = [], fallback = "外部证据") {
  const text = rows.map((item) => (typeof item === "string" ? item : item.text || item.claim || item.body || "")).join(" ");
  const categories = [];
  if (/营收|营业收入|收入|净利润|利润|现金流|毛利|研发投入|资产负债/.test(text)) categories.push("经营指标");
  if (/预算金额|采购预算|采购人|招标人|采购单位|采购公告|政府采购|采购意向|项目金额|合同金额/.test(text)) categories.push("甲方采购记录");
  if (/融资|上市|募投|补助|专项资金|重点研发|政府项目/.test(text)) categories.push("资金与政策项目");
  if (/新建|新设|扩产|投产|产能|战略合作|重大合作|签约|组织调整|高管变更/.test(text)) categories.push("扩张与组织动作");
  if (/入选|榜单|首版次|总包商|示范|资质|认证/.test(text)) categories.push("外部背书");
  if (/股东|持股|控股|受益所有人|法定代表人|董监高|子公司|分支机构|对外投资|集团/.test(text)) categories.push("工商与组织结构");
  if (/被执行|失信|限制高消费|诉讼|合同纠纷|行政处罚|经营异常|付款|回款/.test(text)) categories.push("信用与法务风险");
  if (/MES|APS|ERP|WMS|LIMS|SCADA|PLM|QMS|CRM|OA|HolliCube|工业互联网|数字化工厂|软件著作权|专利|软著/.test(text)) categories.push("系统与技术资产");
  return uniqueTexts(categories, 4).join("、") || fallback;
}

function evidenceDecisionSummary(rows = [], fallback = "公开来源") {
  const texts = arr(rows)
    .map((item) => cleanBusinessText(typeof item === "string" ? item : item.text || item.claim || item.body || "", 110))
    .filter(meaningful)
    .filter((item) => !/^已查到|^以下|^当前边界/.test(item))
    .slice(0, 2);
  return texts.length ? texts.join("；") : fallback;
}

function signalTextSummary(values = [], max = 2, limit = 92) {
  return arr(values)
    .map((item) => cleanBusinessText(typeof item === "string" ? item : item.text || item.claim || item.body || "", limit))
    .filter(meaningful)
    .filter((item) => !/^已查到|^以下|^当前边界/.test(item))
    .slice(0, max)
    .join("；");
}

function budgetWindowClaimFromEvidence(values = []) {
  const evidence = arr(values).filter(isBudgetWindowEvidenceText);
  if (!evidence.length) return "未查到明确预算窗口，近期预算未形成有效判断。";
  const text = evidence.join(" ");
  const types = [];
  if (/采购意向|采购预算|预算金额|采购公告|政府采购/.test(text)) types.push("采购/预算公告");
  if (/项目金额|合同金额|中标金额|投资额/.test(text)) types.push("项目金额");
  if (/补助|补贴|专项资金|政府项目|重点研发|科创/.test(text)) types.push("政府补贴/政策项目");
  if (/(?:完成|获得|启动|拟|计划|募集|募资|战略|股权|上市|IPO|募投|并购).{0,12}(?:融资|资金|投资)|(?:融资|资金|投资).{0,12}(?:完成|获得|启动|拟|计划|募集|募资|战略|股权|上市|IPO|募投|并购)/.test(text)) types.push("融资/募资");
  if (/新建|新设|扩产|投产|新基地|重大合作|签约/.test(text)) types.push("新项目/扩张动作");
  const summary = signalTextSummary(evidence, 1, 95);
  return summary
    ? `客户近期预算窗口来自${uniqueTexts(types, 3).join("、") || "公开项目动作"}：${summary}。`
    : "未查到明确预算窗口，近期预算未形成有效判断。";
}

function digitalMaturityClaimFromEvidence(rows = []) {
  const names = systemNamesFromEvidence(rows, 6);
  if (!arr(rows).length) return "未查到可用的数字化成熟度线索。";
  if (names.length >= 4) return `客户已有${names.join("、")}等多类系统/平台线索，数字化基础偏强。`;
  if (names.length >= 2) return `客户已有${names.join("、")}等系统/平台线索，数字化基础处于可切入阶段。`;
  if (names.length === 1) return `客户至少已有${names[0]}线索，数字化成熟度仍需结合系统边界核实。`;
  return "客户有数字化或技术资产线索，但未形成清晰系统清单。";
}

function replacementClaimFromEvidence(values = []) {
  const evidence = arr(values).filter(meaningful);
  if (!evidence.length) return "未查到系统替换机会。";
  const summary = signalTextSummary(evidence, 1, 100);
  if (/旧系统|替换|升级|改造/.test(evidence.join(" "))) {
    return summary ? `替换/升级机会来自公开线索：${summary}。` : "客户存在系统升级、改造或替换线索。";
  }
  return summary ? `当前只把邻近系统线索作为增量切入参考：${summary}；本轮不按替换项目推进。` : "当前只有邻近系统线索，本轮按增量合作验证，不按替换项目推进。";
}

function solutionRiskClaimFromEvidence(values = []) {
  const evidence = arr(values).filter(meaningful);
  if (!evidence.length) return "未查到具体方案风险点。";
  const text = evidence.join(" ");
  const risks = [];
  if (/接口|集成|对接|系统多|MES|APS|ERP|WMS|LIMS|SCADA|PLM|QMS/.test(text)) risks.push("系统集成边界");
  if (/数据|权限|样例|质量|口径|主数据|数据治理/.test(text)) risks.push("数据权限与样例质量");
  if (/私有化|安全|合规|监管|审计|政务|保密/.test(text)) risks.push("安全合规");
  if (/现场|部署|硬件|摄像头|网络|PLC|设备/.test(text)) risks.push("现场部署条件");
  if (/验收|指标|责任人|范围|周期|返工/.test(text)) risks.push("验收范围与责任人");
  const summary = signalTextSummary(evidence, 1, 90);
  return `主要方案风险集中在${uniqueTexts(risks, 3).join("、") || "落地条件"}${summary ? `，依据是：${summary}` : ""}。`;
}

function isIndustrialRequirementEvidenceText(value = "") {
  const text = cleanBusinessText(value, 320);
  if (!meaningful(text)) return false;
  if (/请输入问题|支持\d+多种语言|隐私承诺|企业会员|CONTENTS|SERVICE|公司概要/.test(text)) return false;
  if (/企业管理AI|企业AI操作系统|资源中心|博客文章|干货下载|客户成功|成为合作伙伴|关于金蝶|中国管理模式/.test(text)) return false;
  if (/案例\d+|装载机智能工厂|柳工/.test(text) && !/国六|国七|EGR|涡轮|热管理|电驱|新能源动力|发动机|海外工厂|泰国|越南|质量|认证|测试|规格|排放/.test(text)) return false;
  if (/总部设在|始建于|旗下拥有|多元化发展|公司概要|资本构成|三大产业板块|物流及供应链服务/.test(text) && !/海外工厂|海外新工厂|泰国|越南|投产|产能|认证|质量|测试|规格|排放|国六|国七|EGR|涡轮|热管理|电驱|新能源动力|定点/.test(text)) return false;
  return /国六|国七|排放|EGR|涡轮|增压|热管理|电驱|新能源|混动|纯电|氢内燃机|发动机|工厂|投产|产能|供应链|合作伙伴|本地化|海外|认证|质量|测试|样品|技术规格|技术路线|量产|定点|成本|年降|准入|功率|效率/.test(text);
}

function industrialRequirementEvidenceClauses(values = [], max = 6) {
  return uniqueTexts(
    arr(values)
      .flatMap((value) =>
        cleanSourceEvidenceShell(value, 1000)
          .split(/[。；;\n\r]+/)
          .map(focusIndustrialRequirementClause)
      )
      .filter((item) => !(/总部设在|始建于|下辖|生产基地布局|年销售收入|生产能力|内燃机生产基地/.test(item) && !/海外工厂|海外新工厂|泰国|越南|投产|国六|国七|EGR|涡轮|热管理|电驱|质量|认证|测试|规格/.test(item)))
      .filter((item) => isIndustrialRequirementEvidenceText(item)),
    max
  );
}

function focusIndustrialRequirementClause(value = "") {
  const text = cleanBusinessText(value, 260);
  if (!meaningful(text)) return "";
  if (/泰国|越南|海外工厂|海外新工厂|投产/.test(text)) {
    const event = text.match(/(?:20\d{2}年[^。；;]{0,180}(?:泰国|越南|海外工厂|海外新工厂|投产)[^。；;]{0,180})/);
    if (event?.[0]) return cleanBusinessText(event[0], 220);
  }
  if (/国六|国七|EGR|涡轮|热管理|电驱|新能源动力|质量|认证|测试|规格|定点/.test(text)) {
    const event = text.match(/(?:[^。；;]{0,80}(?:国六|国七|EGR|涡轮|热管理|电驱|新能源动力|质量|认证|测试|规格|定点)[^。；;]{0,160})/);
    if (event?.[0]) return cleanBusinessText(event[0], 220);
  }
  return text;
}

function isSupplierAlternativeEvidenceText(value = "") {
  const text = cleanBusinessText(value, 320);
  if (!meaningful(text)) return false;
  if (/请输入问题|支持\d+多种语言|隐私承诺|企业会员|CONTENTS|SERVICE|公司概要/.test(text)) return false;
  if (/旗下拥有|始建于|业务内容|主要产品|物流及供应链服务/.test(text) && !/供应商(?:体系|准入|定点|名录|大会|评价|开发|管理)|(?:现有|既有|外部|国际|核心|战略).{0,12}供应商|供应链合作伙伴|合作伙伴大会|博世|自研|替代|准入|定点/.test(text)) return false;
  return /供应商(?:体系|准入|定点|名录|大会|评价|开发|管理)|(?:现有|既有|外部|国际|核心|战略).{0,12}供应商|供应链合作伙伴|合作伙伴大会|技术伙伴|博世|自研|替代|竞品|准入|定点|目标价|外部技术伙伴/.test(text);
}

function workGroupComplexity(group = {}, solution = {}) {
  const text = `${group.title || ""} ${arr(group.items).join(" ")} ${solution.title || ""} ${solution.prerequisite || ""}`;
  if (/接口|连接器|集成|权限|审计|模型|识别|优化引擎|算法|HolliCube|MES|APS|ERP|WMS|LIMS|SCADA|PLC|摄像头|视频/.test(text)) {
    return { level: "高", label: "难", className: "hard" };
  }
  if (/数据|知识库|规则|样本|后台|运营|看板|告警|流程/.test(text)) {
    return { level: "中", label: "中", className: "medium" };
  }
  return { level: "低", label: "易", className: "easy" };
}

function workTaskComplexity(task = "", group = {}, solution = {}) {
  const text = `${task || ""} ${group.title || ""} ${solution.prerequisite || ""}`;
  if (/接口|连接器|集成|权限|审计|模型|识别|优化|算法|HolliCube|MES|APS|ERP|WMS|LIMS|SCADA|PLC|摄像头|视频|多方案|仿真|误报|漏报|样本标注/.test(text)) {
    return { level: "高", label: "难", className: "hard", rank: 3 };
  }
  if (/数据|知识|规则|样本|版本|运营|看板|告警|流程|模板|口径|规则库|区域|映射|复核|审计|反馈/.test(text)) {
    return { level: "中", label: "中", className: "medium", rank: 2 };
  }
  return { level: "低", label: "易", className: "easy", rank: 1 };
}

function workPackageComplexity(groups = [], solution = {}) {
  const taskScores = arr(groups)
    .flatMap((group) => arr(group.items).map((item) => workTaskComplexity(item, group, solution)))
    .filter(Boolean);
  const hardCount = taskScores.filter((item) => item.className === "hard").length;
  const mediumCount = taskScores.filter((item) => item.className === "medium").length;
  if (hardCount >= 2 || (hardCount >= 1 && mediumCount >= 2)) return { level: "高", label: "难", className: "hard" };
  if (hardCount >= 1 || mediumCount >= 2) return { level: "中", label: "中", className: "medium" };
  return { level: "低", label: "易", className: "easy" };
}

function relativeTaskComplexityMap(groups = [], solution = {}) {
  const tasks = arr(groups)
    .flatMap((group, groupIndex) =>
      arr(group.items).map((task, taskIndex) => ({
        groupIndex,
        taskIndex,
        key: `${groupIndex}:${taskIndex}`,
        task,
        base: workTaskComplexity(task, group, solution)
      }))
    )
    .filter((item) => meaningful(item.task));
  const ranked = [...tasks].sort((a, b) => (b.base.rank || 0) - (a.base.rank || 0) || a.groupIndex - b.groupIndex || a.taskIndex - b.taskIndex);
  const hardLimit = Math.max(1, Math.ceil(ranked.length * 0.25));
  const mediumLimit = Math.max(hardLimit + 1, Math.ceil(ranked.length * 0.65));
  const out = new Map();
  ranked.forEach((item, index) => {
    let next = item.base;
    if (index < hardLimit && item.base.rank >= 3) next = { level: "高", label: "难", className: "hard", rank: 3 };
    else if (index < mediumLimit && item.base.rank >= 2) next = { level: "中", label: "中", className: "medium", rank: 2 };
    else next = { level: "低", label: "易", className: "easy", rank: 1 };
    out.set(item.key, next);
  });
  return out;
}

function sowTaskDescription(task = "", group = {}, solution = {}) {
  const text = `${task || ""} ${group.title || ""}`;
  const patterns = [
    [/国七|国六|法规目标|排放.*技术路线/, "确认目标法规、排放路线和预研节奏，判断 EGR、SCR、涡轮等方案边界。"],
    [/EGR率|冷却效率|增压效率/, "把 EGR、冷却和增压指标转成参数表，用于判断样机规格和标定范围。"],
    [/发动机平台|应用工况/, "明确发动机平台、燃料类型、负载工况和整车应用，避免样件验证偏离真实场景。"],
    [/EGR阀|冷却器|涡轮样机/, "形成可送测样机清单，明确每个样件的接口、规格和供样批次。"],
    [/台架测试|性能数据/, "把测试工况、数据口径和合格标准前置，作为技术进入下一阶段的依据。"],
    [/耐久|热效率|排放.*闭环/, "用耐久、排放和热效率数据闭环验证，降低后续定点和量产风险。"],
    [/技术方案包|标定边界/, "整理方案参数、标定边界和适配说明，支撑研发评审和客户内部立项。"],
    [/功率等级|热负荷|布置空间/, "确认动力平台约束，判断电驱、热管理部件是否需要结构或规格调整。"],
    [/电机|逆变器|热管理模块|规格包/, "明确部件规格、接口和性能边界，形成可比选的样件配置。"],
    [/热管理边界|失效模式/, "梳理高温、低温、长坡、重载等边界工况，并提前识别失效模式。"],
    [/技术路线确认|混动|纯电|氢内燃机/, "确认客户动力路线和量产节奏，决定先投哪类样件和技术资源。"],
    [/现有供应商|定点阶段/, "识别当前供应商格局和定点进度，判断进入窗口和差异化竞争点。"],
    [/PPAP|质量体系|认证资料/, "准备质量体系、PPAP和认证材料，支撑客户供应商准入和量产审核。"],
    [/小批试供|量产爬坡/, "用小批试供验证交付、质量和节拍，为后续量产爬坡留出问题闭环周期。"],
    [/车型平台|生命周期/, "确认目标车型、量产节奏和生命周期，判断是否值得投入样品和定点资源。"],
    [/执行器|电机|PCBA|技术参数|技术规格/, "把客户技术要求拆成可验证参数，明确我方产品是否满足或需要定制。"],
    [/竞品|自研|替代/, "识别客户现有供应商或自研替代风险，确定差异化竞争点。"],
    [/样品|测试|认证/, "通过样品、测试数据和认证资料证明产品匹配度。"],
    [/质量|失效|良率|问题闭环/, "用质量记录和问题闭环能力降低客户导入风险。"],
    [/报价|账期|供应商准入|合同/, "完成商务准入和交易边界确认，避免技术验证后卡在采购流程。"],
    [/产能|物料|交付计划|安全库存/, "确认供货能力和交付节奏，支撑客户放量或海外配套要求。"],
    [/海外|本地化|跨境|物流/, "评估海外供货、仓储、伙伴协作和售后响应的可行性。"],
    [/材料|工艺|成本|年降|目标价/, "拆解成本结构和降本空间，为价格谈判提供依据。"],
    [/政策|制度|模板入库/, "把制度、模板、规范和历史材料纳入知识库，形成可检索、可引用的基础资料。"],
    [/术语|口径/, "统一客户内部术语、字段含义和表达口径，减少跨团队理解偏差。"],
    [/案例|经验/, "沉淀历史方案、项目复盘和交付经验，支持售前与交付复用。"],
    [/多源检索/, "从文档库、业务资料和系统数据中统一检索候选内容。"],
    [/出处|追溯/, "保留答案引用来源，方便业务人员复核、引用和追责。"],
    [/权限|审计/, "按角色控制可见范围，并记录访问、引用和调用日志。"],
    [/初稿|材料.*生成|生成入口/, "基于知识库和模板生成初稿，减少重复撰写和格式整理。"],
    [/格式|模板套用/, "把固定格式、章节结构和输出规范配置成可复用模板。"],
    [/文风|场景输出/, "按不同业务场景调整表达风格、内容颗粒度和输出格式。"],
    [/更新|审核/, "管理知识新增、修改和审核流程，避免过期内容直接进入输出。"],
    [/版本管理|版本迭代/, "记录知识、规则和应用版本，支持回溯、对比和灰度更新。"],
    [/反馈|纠错|运营看板/, "收集使用反馈、错误样例和效果指标，推动持续优化。"],
    [/智能体模板/, "沉淀常用场景的角色、提示词、工具和输出规范，便于快速复用。"],
    [/工具调用/, "配置智能体可调用的系统、接口和业务工具，控制调用边界。"],
    [/任务编排|流程编排/, "把查询、分析、生成、审批或告警等步骤编排成可执行流程。"],
    [/know-how|行业|工艺/, "沉淀行业经验、工艺规则和专家知识，支撑专业问答与方案生成。"],
    [/产品文档|项目经验/, "汇总产品资料、实施文档和项目经验，支撑售前和交付复用。"],
    [/规则|标准口径/, "统一业务规则、术语和验收口径，降低跨团队协作返工。"],
    [/HolliCube|接口|连接器|适配/, "对接客户现有平台或业务系统，打通数据读取和工具调用入口。"],
    [/MES|APS|ERP|WMS|LIMS/, "接入核心业务系统数据，为问答、分析和流程辅助提供上下文。"],
    [/问答|分析/, "提供业务人员直接使用的查询、分析和生成入口。"],
    [/告警|任务流转/, "把异常提醒、待办分派和处理结果纳入闭环记录。"],
    [/摄像头|视频接入/, "接入现场视频源，并完成点位、区域和工位关系配置。"],
    [/识别|模型|样本/, "识别目标对象或行为，并用复核样本持续优化准确率。"],
    [/排产|排程|调度/, "根据订单、资源和约束生成计划结果，辅助计划人员评估可执行性。"],
    [/看板|统计/, "展示运行状态、关键指标和异常分布，方便持续运营。"]
  ];
  const matched = patterns.find(([pattern]) => pattern.test(text));
  if (matched) return matched[1];
  const moduleTitle = cleanBusinessText(group.title || "该模块", 28);
  const solutionTitle = cleanBusinessText(solution.title || "本方案", 36);
  return `${moduleTitle}中的可交付功能，用于支撑${solutionTitle}落地。`;
}

function sowTaskRowsForSolution(item = {}, index = 0, report = {}) {
  const groups = solutionWorkPackages(item, report);
  const complexityMap = relativeTaskComplexityMap(groups, item);
  return groups.flatMap((group, groupIndex) =>
    arr(group.items)
      .filter(meaningful)
      .map((task, taskIndex) => {
        const complexity = complexityMap.get(`${groupIndex}:${taskIndex}`) || workTaskComplexity(task, group, item);
        return {
          priority: item.priority || `P${Math.min(index, 2)}`,
          solutionTitle: cleanBusinessText(item.title || "方案", 58),
          moduleTitle: cleanBusinessText(group.title || "功能模块", 48),
          task: cleanBusinessText(task, 180),
          description: cleanBusinessText(sowTaskDescription(task, group, item), 180),
          solutionIndex: index,
          moduleIndex: groupIndex,
          taskIndex,
          hard: complexity.className === "hard",
          sourceIds: normalizeSourceIdList(item)
        };
      })
  );
}

function sowArgumentBranches(report = {}, round = {}, delivery = {}) {
  const solutions = visibleSolutionCards(arr(round.solutionCards).filter((item) => meaningful(item.title)), 5);
  const fallbackItems = !solutions.length
    ? arr(delivery.sowOutline)
        .filter(meaningful)
        .filter((item) => !isDeliveryEstimateText(item))
        .slice(0, 4)
        .map((item, index) => {
          const [title, rest] = String(item).split(/[：:]/);
          return {
            priority: `P${Math.min(index, 2)}`,
            title: cleanBusinessText(title || item, 48),
            introduction: cleanBusinessText(rest || item, 140),
            prerequisite: arr(delivery.dependencies)[index] || ""
          };
        })
    : [];
  const workItems = solutions.length ? solutions : fallbackItems;
  const rows = workItems.flatMap((item, index) => sowTaskRowsForSolution(item, index, report));
  const groups = new Map();
  rows.forEach((row) => {
    const key = `${row.priority}|${row.solutionTitle}|${row.moduleTitle}`;
    if (!groups.has(key)) {
      groups.set(key, {
        priority: row.priority,
        solutionTitle: row.solutionTitle,
        moduleTitle: row.moduleTitle,
        solutionIndex: row.solutionIndex,
        moduleIndex: row.moduleIndex,
        tasks: [],
        sourceIds: []
      });
    }
    const group = groups.get(key);
    group.tasks.push({ label: row.task, description: row.description, hard: row.hard });
    group.sourceIds = uniqueTexts([...group.sourceIds, ...arr(row.sourceIds)], 8);
  });
  return [...groups.values()]
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || (a.solutionIndex || 0) - (b.solutionIndex || 0) || (a.moduleIndex || 0) - (b.moduleIndex || 0))
    .slice(0, 8)
    .map((group) => ({
    title: `${group.priority}｜${group.solutionTitle}`,
    claim: `一级功能：${group.moduleTitle}`,
    rows: group.tasks.slice(0, 10),
    evidence: group.tasks.map((task) => task.label).slice(0, 4),
    kind: "sow-module-fields",
    sourceIds: group.sourceIds,
    forceDisplay: true
  }));
}

function sowTaskList(group = {}, solution = {}, complexityMap = null, groupIndex = 0) {
  const items = arr(group.items).filter(meaningful);
  if (!items.length) return "";
  return `<ul class="sow-task-list">${items
    .map((item, taskIndex) => {
      const complexity = complexityMap?.get(`${groupIndex}:${taskIndex}`) || workTaskComplexity(item, group, solution);
      const marker = complexity.className === "hard" ? `<i class="sow-task-complexity hard">难点</i>` : "";
      return `<li><span>${e(item)}</span>${marker}</li>`;
    })
    .join("")}</ul>`;
}

function namedSystemEvidenceRows(values = []) {
  const rows = arr(values)
    .filter(Boolean)
    .map((item) => (typeof item === "string" ? { text: item } : { ...item, text: item.text || item.claim || item.body || item.summary || "" }))
    .filter((row) => {
      const text = cleanBusinessText(row.text, 300);
      if (!meaningful(text)) return false;
      if (/招聘|岗位|职位/.test(text)) return false;
      return /HolliCube|MES|APS|ERP|WMS|LIMS|SCADA|PLM|QMS|CRM|OA|SAP|用友|金蝶|达索|西门子|工业互联网|数字化工厂|数据中台|数据治理|软件著作权|软著|专利/.test(text);
    });
  return mergeEvidenceRows(...rows.map((row) => [row]));
}

function systemNamesFromEvidence(values = [], max = 5) {
  const text = arr(values)
    .filter(Boolean)
    .map((item) => cleanBusinessText(typeof item === "string" ? item : item.text || item.claim || item.body || item.summary || "", 260))
    .join(" ");
  const names = [];
  const known = ["HolliCube", "MES", "APS", "ERP", "WMS", "LIMS", "SCADA", "PLM", "QMS", "CRM", "OA", "SAP"];
  known.forEach((name) => {
    const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (re.test(text)) names.push(name);
  });
  if (/用友/.test(text)) names.push("用友");
  if (/金蝶/.test(text)) names.push("金蝶");
  if (/达索/.test(text)) names.push("达索");
  if (/西门子/.test(text)) names.push("西门子");
  if (/数据中台/.test(text)) names.push("数据中台");
  if (/工业互联网/.test(text)) names.push("工业互联网平台");
  return Array.from(new Set(names)).slice(0, max);
}

function organizationComplexityLabel(rows = []) {
  const text = rows.map((item) => item.text).join(" ");
  if (/集团|子公司|分支|股权|对外投资|受益所有人|控股|关联/.test(text)) return "组织链条偏复杂";
  return "组织边界相对集中";
}

function riskLabelFromEvidence(rows = []) {
  const text = rows.map((item) => item.text).join(" ");
  if (/被执行|失信|限制高消费|诉讼|合同纠纷|行政处罚|经营异常|付款|回款/.test(text)) return "存在需前置复核的风险线索";
  return "未见足以改变初访策略的公开风险";
}

function firstUsefulInfoLine(round = {}, sectionPattern = /.*/, itemPattern = /.*/) {
  const item = arr(round.customerInfo)
    .filter((section) => sectionPattern.test(`${section.key || ""} ${section.title || ""}`))
    .flatMap((section) => arr(section.items))
    .find((entry) => {
      const text = entry.body || entry.insight || entry.summary || arr(entry.facts)[0] || entry.title || entry.label || "";
      return usefulDecisionText(text) && itemPattern.test(String(text || ""));
    });
  if (!item) return "";
  return cleanBusinessText(item.body || item.insight || item.summary || arr(item.facts)[0] || item.title || item.label || "", 180);
}

function firstMatchingInfoLine(round = {}, sectionPattern = /.*/, itemPattern = /.*/, max = 190) {
  for (const section of arr(round.customerInfo).filter((item) => sectionPattern.test(`${item.key || ""} ${item.title || ""}`))) {
    for (const entry of arr(section.items)) {
      const candidates = uniqueTexts([
        ...arr(entry.facts),
        entry.body,
        entry.summary,
        entry.insight
      ], 10);
      const match = candidates
        .map((item) => cleanBusinessText(item, max))
        .find((item) => meaningful(item) && itemPattern.test(item));
      if (match) return match;
    }
  }
  return "";
}

function firstProfileSourceLine(sources = [], pattern = /.*/, max = 190) {
  const preferred = arr(sources)
    .filter((source) => !/finance_budget|risk_legal/.test(source.sourceFamily || ""))
    .sort((a, b) => {
      const score = (source) =>
        (/official_product|customer_case|subject_registry/.test(source.sourceFamily || "") ? 2 : 0) +
        (/官网|年报|可持续发展|公司资料|工商登记/.test(`${source.title || ""}${source.usedFor || ""}`) ? 1 : 0);
      return score(b) - score(a);
    });
  for (const source of preferred) {
    const candidates = uniqueTexts([
      source.evidenceExcerpt,
      source.snippet,
      source.text
    ], 8);
    for (const raw of candidates) {
      const text = cleanBusinessText(raw, 520);
      const sentence = text
        .split(/[。；;\n]/)
        .map((item) => cleanBusinessText(item.replace(/[#>*`_]+/g, "").replace(/[▲▼]/g, ""), max).replace(/^[.。·\s]+/g, "").replace(/\.\s+/g, "，"))
        .find((item) => pattern.test(item) && meaningful(item) && !isGenericSourceBody(item));
      if (sentence) return sentence;
    }
  }
  return "";
}

function compactProfileRows(rows = []) {
  const seen = new Set();
  return rows
    .filter((row) => row && meaningful(row.body))
    .filter((row) => {
      const key = normalizeForCompare(row.body);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

function basicCustomerProfileIntro(round = {}, sources = []) {
  const subject = firstUsefulInfoLine(round, /local|主体|股权|区域|工商|组织/, /注册|主体|股权|法定代表人|注册地址|高新区|集团|子公司|对外投资|控股/);
  const businessScope =
    firstMatchingInfoLine(round, /business|业务|产品|客户|market|案例/, /主营|经营范围|生产|经销|提供|专注于|业务|乳制品|制造|服务/) ||
    firstProfileSourceLine(sources, /主营|经营范围|生产|经销|提供|专注于|业务|乳制品|制造|服务/);
  const product =
    firstProfileSourceLine(sources, /产品矩阵|产品|品类|品牌|液态奶|冰淇淋|奶粉|奶酪|平台|系统|工业互联网|智能制造/) ||
    firstMatchingInfoLine(round, /business|业务|产品|客户|market|案例/, /产品|品类|品牌|平台|系统|液态奶|冰淇淋|奶粉|奶酪|Holli|MES|APS|ERP|WMS|LIMS|工业互联网|智能制造/);
  const customer =
    firstMatchingInfoLine(round, /business|业务|产品|客户|market|案例/, /客户|消费者|服务对象|客户名单|服务于|面向|全球消费者/) ||
    firstProfileSourceLine(sources, /客户|消费者|服务对象|服务于|面向|全球消费者|中国和全球消费者/);
  const productLine =
    product && normalizeForCompare(product) === normalizeForCompare(businessScope)
      ? cleanBusinessText(product.replace(/^主营业务为生产及经销/, "核心产品包括").replace(/^主营业务为/, "核心产品/服务包括"), 190)
      : product;
  const rows = compactProfileRows([
    subject ? { title: "主体/区域", body: subject } : null,
    businessScope ? { title: "经营范围", body: businessScope } : null,
    productLine ? { title: "核心产品", body: productLine } : null,
    customer ? { title: "主要客户/服务对象", body: customer } : null
  ]);
  if (!rows.length) return "";
  return `<section class="customer-brief-strip">
    ${rows.map((row) => `<article><span>${e(row.title)}</span><b>${e(row.body)}</b></article>`).join("")}
  </section>`;
}

function customerProfilePerspective(report, round, sources = []) {
  const rating = ratingOf(report);
  const metricRows = infoEvidenceBySection(round, /finance|财务|经营|规模/, /.*/, 8);
  const registryRows = mergeEvidenceRows(
    infoEvidenceBySection(round, /local|主体|股权|区域|工商|高管|组织/, /股东|持股|股权|控股|受益所有人|法定代表人|董监高|高管|主要人员|对外投资|子公司|分支机构|集团|关联|统一社会信用代码|注册地址|注册于|注册资本|实缴资本/, 8)
      .filter((row) => isRegistryOrgEvidenceText(row.text)),
    combinedSignal(round, sources, /注册资本|实缴|成立|股权|控股|受益所有人|高管|法定代表人|子公司|分支|对外投资|集团|主体|区域/i, 6, {
      sourcePredicate: (source, text) => /subject_registry/.test(source.sourceFamily || "") || isRegistryOrgEvidenceText(text),
      signalPredicate: isRegistryOrgEvidenceText,
      itemPredicate: (_section, _item, candidate) => isRegistryOrgEvidenceText(candidate)
    }).evidence.map((text) => ({ text }))
  );
  const scaleRows = mergeEvidenceRows(
    infoEvidenceBySection(round, /local|主体|股权|区域|工商|business|业务|产品|客户|market|案例|finance|财务|经营|规模/, /注册资本|实缴资本|参保人数|员工规模|员工数量|分支机构|子公司|对外投资|客户名单|行业排名|行业榜单|协会|入选|首版次|总包商|政府项目|重点研发|补助|上市|融资|专精特新|单项冠军|隐形冠军|高新技术企业|瞪羚|企业技术中心|工程技术中心|科技进步|奖|奖项|荣誉|获奖|获评|认定/, 8)
      .filter((row) => isScaleEvidenceText(row.text)),
    combinedSignal(round, sources, /注册资本|实缴|参保人数|员工|子公司|分支|对外投资|客户名单|行业榜单|入选|首版次|总包商|政府项目|重点研发|补助|上市|融资|专精特新|单项冠军|隐形冠军|高新技术企业|瞪羚|企业技术中心|工程技术中心|科技进步|奖|奖项|荣誉|获奖|获评|认定/i, 6, {
      sourcePredicate: (_source, text) => isScaleEvidenceText(text),
      signalPredicate: isScaleEvidenceText,
      itemPredicate: (_section, _item, candidate) => isScaleEvidenceText(candidate)
    }).evidence.map((text) => ({ text }))
  );
  const businessRows = mergeEvidenceRows(
    infoEvidenceBySection(round, /business|业务|产品|客户|market|案例/, /.*/, 6),
    combinedSignal(round, sources, /官网|产品|客户案例|行业|榜单|协会|政府项目|案例|平台|MES|APS|ERP|WMS|LIMS|Holli|工业互联网|智能制造|专精特新|单项冠军|隐形冠军|高新技术企业|瞪羚|企业技术中心|工程技术中心|科技进步|奖|奖项|荣誉|获奖|获评|认定/i, 6, {
      excludeFamilies: ["subject_registry", "finance_budget", "risk_legal"]
    }).evidence.map((text) => ({ text }))
  );
  const industryDirectRows = infoEvidenceBySection(
    round,
    /local|主体|股权|区域|工商|business|业务|产品|客户|market|案例|finance|财务|经营|规模/,
    /行业榜单|协会|入选|首版次|总包商|示范案例|典型示范|客户案例|政府项目|重点研发|补助|标杆|典型|排名|资质|认证|专精特新|单项冠军|隐形冠军|高新技术企业|瞪羚|企业技术中心|工程技术中心|科技进步|奖|奖项|荣誉|获奖|获评|认定/,
    12
  )
    .map((row) => ({ ...row, text: industryPositionEvidenceText(row.text) }))
    .filter((row) => isIndustryPositionEvidenceText(row.text));
  const industryRows = mergeEvidenceRows(
    industryDirectRows,
    scaleRows.filter((row) => isIndustryPositionEvidenceText(row.text)),
    businessRows.filter((row) => isIndustryPositionEvidenceText(row.text))
  );
  const triggerRows = mergeEvidenceRows(
    combinedSignal(round, sources, /融资|上市|并购|新设|新建|基地|招聘|中标|项目|合作|扩张|扩产|转型|数字化|智能制造|升级|裁员|舆情|入选|补助|重点研发/i, 6, {
      excludeFamilies: ["subject_registry"],
      sourcePredicate: (_source, text) => isDevelopmentStageEvidenceText(text),
      signalPredicate: isDevelopmentStageEvidenceText,
      itemPredicate: (_section, _item, candidate) => isDevelopmentStageEvidenceText(candidate)
    }).evidence.map((text) => ({ text }))
  ).filter((row) => isDevelopmentStageEvidenceText(row.text));
  const industrySupportRows = mergeEvidenceRows(industryRows, triggerRows.filter((row) => isIndustryPositionEvidenceText(row.text)));
  const maturityRows = mergeEvidenceRows(
    infoEvidenceBySection(round, /digital|AI|数字|系统|技术/, /.*/, 5),
    combinedSignal(round, sources, /数字化|IT岗位|数据岗位|软著|专利|官网技术|系统采购|软件著作权|平台|算法|运维|MES|APS|ERP|WMS|LIMS/i, 6, {
      sourcePredicate: (_source, text) => isMaturityEvidenceText(text),
      signalPredicate: isMaturityEvidenceText,
      itemPredicate: (_section, _item, candidate) => isMaturityEvidenceText(candidate)
    }).evidence.map((text) => ({ text }))
  );
  const riskRows = mergeEvidenceRows(
    infoEvidenceBySection(round, /risk|风险|法务|信用/, /.*/, 5),
    combinedSignal(round, sources, /司法|诉讼|被执行|失信|限制高消费|经营异常|行政处罚|舆情|付款纠纷|合同纠纷|处罚/i, 6).evidence.map((text) => ({ text }))
  ).filter((row) => isConcreteLowValueEvidenceText(row.text));
  const financeKpiRows = financialKpiRowsForProfile(report, round);
  const stage = stageLabelFromEvidence(triggerRows);
  const operatingRows = mergeEvidenceRows(metricRows, triggerRows.filter((row) => isOperatingStatusEvidenceText(row.text)), riskRows);
  const operating = operatingLabelFromEvidence(operatingRows);
  const orgAssessment = organizationComplexityAssessment(registryRows);
  const riskLabel = riskLabelFromEvidence(riskRows);
  const nodes = [
    {
      label: "营收能力",
      claim: financialCapacityClaim(financeKpiRows),
      evidence: evidenceTexts(financeKpiRows, 8),
      sourceIds: evidenceSourceIds(financeKpiRows),
      branches: financeKpiRows.length
        ? [financialKpiBoardBranch(financeKpiRows)]
        : [{
          title: "当前边界",
          claim: "未查到营收、利润、毛利率或现金流等可用指标。",
          evidence: [],
          invalid: true,
          forceDisplay: true
        }],
      forceDisplay: true,
      allowBoundaryEvidence: true,
      useExplicitBranchesOnly: true,
      invalid: !financeKpiRows.length,
      tone: financeKpiRows.length ? "strong" : "watch"
    },
    {
      label: "企业发展阶段",
      claim: triggerRows.length ? `企业发展阶段呈${stage}信号，主要依据是${evidenceCategorySummary(triggerRows)}。` : "企业发展阶段暂不作为本轮推进判断依据。",
      evidence: evidenceTexts(triggerRows, 6),
      sourceIds: evidenceSourceIds(triggerRows),
      branches: triggerRows.length
        ? [{
          title: "发展阶段依据",
          claim: `当前发展阶段判断来自${evidenceCategorySummary(triggerRows)}。`,
          evidence: evidenceTexts(triggerRows, 6),
          sourceIds: evidenceSourceIds(triggerRows),
          forceDisplay: true
        }]
        : [{
          title: "可用线索",
          claim: "公开材料未出现近期融资、扩产、新设基地、政策项目入选或重大合作变化。",
          evidence: [],
          invalid: true,
          forceDisplay: true
      }],
      forceDisplay: true,
      useExplicitBranchesOnly: true,
      invalid: !triggerRows.length,
      tone: triggerRows.length ? (/扩张|转型/.test(stage) ? "strong" : /承压/.test(stage) ? "risk" : "") : "watch"
    },
    {
      label: "经营状态",
      claim: operatingRows.length ? `经营状态更接近${operating}，判断来自${evidenceCategorySummary(operatingRows)}。` : "",
      evidence: evidenceTexts(operatingRows, 6),
      sourceIds: evidenceSourceIds(operatingRows),
      tone: /压力/.test(operating) ? "risk" : /增长|转型/.test(operating) ? "strong" : ""
    },
    {
      label: "组织复杂度",
      claim: orgAssessment.claim || "组织复杂度暂按单一推进主体处理。",
      evidence: orgAssessment.evidence,
      sourceIds: orgAssessment.sourceIds,
      branches: orgAssessment.claim
        ? orgAssessment.branches
        : [{
          title: "组织线索",
          claim: "公开材料未出现集团、子公司、分支机构、对外投资或采购主体分离线索。",
          evidence: [],
          invalid: true,
          forceDisplay: true
        }],
      useExplicitBranchesOnly: true,
      forceDisplay: true,
      invalid: !orgAssessment.claim,
      tone: orgAssessment.claim ? orgAssessment.tone : "watch"
    },
    {
      label: "行业地位",
      claim: industrySupportRows.length ? industryPositionClaim(industrySupportRows) : "行业地位暂不作为本轮推进判断依据。",
      evidence: evidenceTexts(industrySupportRows, 6),
      sourceIds: evidenceSourceIds(industrySupportRows),
      branches: industrySupportRows.length
        ? []
        : [{
          title: "公开背书",
          claim: "公开材料未出现可用于判断行业地位的荣誉、资质、奖项、榜单或标杆案例线索。",
          evidence: [],
          invalid: true,
          forceDisplay: true
        }],
      forceDisplay: true,
      useExplicitBranchesOnly: !industrySupportRows.length,
      invalid: !industrySupportRows.length,
      tone: industrySupportRows.length ? "strong" : "watch"
    },
    {
      label: "管理成熟度初判",
      claim: maturityRows.length ? `管理成熟度有${systemNamesFromEvidence(maturityRows).join("、") || "技术资产/系统"}线索，适合先问现有系统边界和外部合作意愿。` : "管理成熟度暂按基础信息处理，本轮不作为重方案投入依据。",
      evidence: evidenceTexts(maturityRows, 6),
      sourceIds: evidenceSourceIds(maturityRows),
      branches: maturityRows.length
        ? []
        : [{
          title: "技术线索",
          claim: "公开材料未出现现有系统、数字化平台、专利软著、IT或数据岗位等成熟度线索。",
          evidence: [],
          invalid: true,
          forceDisplay: true
        }],
      forceDisplay: true,
      useExplicitBranchesOnly: !maturityRows.length,
      invalid: !maturityRows.length,
      tone: "watch"
    },
    {
      label: "风险状态",
      claim: riskRows.length ? `${riskLabel}。` : "",
      evidence: evidenceTexts(riskRows, 6),
      sourceIds: evidenceSourceIds(riskRows),
      tone: /风险线索/.test(riskLabel) ? "risk" : ""
    }
  ].filter((node) => node.forceDisplay || arr(node.evidence).length || normalizeSourceIdList(node).length);
  return `<div class="report-view-panel view-profile">
    ${basicCustomerProfileIntro(round, sources)}
    ${argumentTreeSection({
      className: "profile-argument-section",
      kicker: "企业画像",
      thesis: "",
      summary: "",
      nodes,
      sources,
      showClaim: false
    })}
  </div>`;
}

function salesPerspective(report, round, sources = []) {
  const pyramid = buildSalesPyramid(report, round, sources);
  const rating = ratingOf(report);
  const brief = buildExecutiveBrief(report, round);
  const budget = dimensionByKey(report, "budgetAbility");
  const decision = dimensionByKey(report, "decisionRiskControl");
  const budgetMetrics = [
    bestMetricText(report, [/营收|营业收入|净销售|收入/]),
    bestMetricText(report, [/净利润|利润|归母|扣非/]),
    bestMetricText(report, [/现金流/]),
    bestMetricText(report, [/研发/])
  ].filter((item) => Boolean(item) && !/不公示|未公示|未披露|选择不公示|未取得|暂无|待核验/.test(item));
  const people = firstDecisionPeopleSummary(sources);
  const riskEvidence = usefulEvidenceTexts([
    ...arr(rating.riskFlags),
    rating.riskGate?.summary,
    ...arr(rating.riskGate?.reasons),
    ...arr(rating.disqualificationSignals),
    brief.risk
  ], 5);
  const cards = pyramid.cards;
  const worth = cards[0] || {};
  const operating = cards[3] || {};
  const triggerSignal = filterSignal(
    combinedSignal(round, sources, /扩张|扩产|新建|新增|投产|产能|融资|上市|并购|战略合作|重大合作|签约|招投标|中标|采购项目|招聘|高管|组织调整|处罚|诉讼|监管|政策|国产化|安全|合规|转型|升级|项目|立项|客户案例|合作/i, 5),
    isActionTriggerSignal
  );
  const entryWindowSignal = filterSignal(triggerSignal, isEntryWindowEvidenceText);
  let procurementSignal = combinedSignal(round, sources, /招标|采购|合同|预算|项目金额|采购金额|投标邀请|采购人|招标人|采购单位|政府采购/i, 5, {
    sourcePredicate: (_source, text) => isBuyerProcurementEvidenceText(text),
    signalPredicate: isBuyerProcurementEvidenceText,
    itemPredicate: (_section, _item, candidate) => isBuyerProcurementEvidenceText(candidate)
  });
  const structuredProcurementRows = structuredProcurementEvidenceRows(sources, 5);
  if (structuredProcurementRows.length) {
    procurementSignal = {
      evidence: structuredProcurementRows.map((row) => row.text),
      sourceIds: Array.from(new Set(structuredProcurementRows.map((row) => row.sourceId))).slice(0, 6)
    };
  }
  const procurementDirectorySignal = combinedSignal(round, sources, /招投标|招标项目|采购平台|供应商门户|供应商平台|工程招投标/i, 5, {
    sourcePredicate: (_source, text) => isProcurementDirectoryOnlyText(text),
    signalPredicate: isProcurementDirectoryOnlyText,
    itemPredicate: (_section, _item, candidate) => isProcurementDirectoryOnlyText(candidate)
  });
  const competitorSignal = combinedSignal(round, sources, /竞品|供应商|合作伙伴|服务商|实施商|集成商|SAP|Oracle|Microsoft|微软|阿里|腾讯|华为|用友|金蝶|达索|西门子|大华|海康|中标单位|成交供应商/i, 5, {
    sourcePredicate: (_source, text) => sellerCapabilityMode(report) === "digital" ? isCustomerSupplierCompetitorEvidenceText(text) : isSupplierAlternativeEvidenceText(text),
    signalPredicate: (text) => sellerCapabilityMode(report) === "digital" ? isCustomerSupplierCompetitorEvidenceText(text) : isSupplierAlternativeEvidenceText(text),
    itemPredicate: (_section, _item, candidate) => sellerCapabilityMode(report) === "digital" ? isCustomerSupplierCompetitorEvidenceText(candidate) : isSupplierAlternativeEvidenceText(candidate)
  });
  const supplierProjectSignal = combinedSignal(round, sources, /中标|客户案例|为.{0,20}建设|承建|实施|交付|典型示范案例|项目获奖|项目中集成|解决方案提供商|服务商/i, 6, {
    sourcePredicate: (_source, text) => isSupplierDeliveryEvidenceText(text),
    signalPredicate: isSupplierDeliveryEvidenceText,
    itemPredicate: (_section, _item, candidate) => isSupplierDeliveryEvidenceText(candidate)
  });
  const budgetSignal = combinedSignal(round, sources, /营收|营业收入|净利润|利润|现金流|研发投入|注册资本|实缴|融资|上市|采购人|招标人|采购单位|采购公告|预算|项目金额|合同金额|固定资产|扩产|产能/i, 6, {
    sourcePredicate: (_source, text) => isPurchaseBudgetEvidenceText(text),
    signalPredicate: isPurchaseBudgetEvidenceText,
    itemPredicate: (_section, _item, candidate) => isPurchaseBudgetEvidenceText(candidate)
  });
  const budgetEvidence = uniqueTexts([
    ...budgetMetrics,
    ...arr(budgetSignal.evidence).filter(isPurchaseBudgetEvidenceText),
    ...arr(budget.evidence).filter(isPurchaseBudgetEvidenceText),
    ...arr(budget.deductions).filter(isPurchaseBudgetEvidenceText)
  ], 6);
  const riskSummary = businessRiskSummary(report, rating, brief);
  const concreteRiskEvidence = riskEvidence.filter(isConcreteLowValueEvidenceText);
  const sameProjectInfoSignal = combinedSignal(round, [], /软件|系统|咨询|设备|服务|产品|零部件|汽车电子|车灯|执行器|调光|电机|PCBA|智能体|AI|知识库|数据|MES|APS|ERP|WMS|LIMS|排产|质量|追溯|工业互联网|数字化|自动化/i, 6, {
    excludeFamilies: ["subject_registry", "finance_budget", "risk_legal"],
    sourcePredicate: (_source, text) => isSellerAdjacentProcurementEvidenceText(text, report),
    signalPredicate: (text) => isSellerAdjacentProcurementEvidenceText(text, report),
    itemPredicate: (_section, _item, candidate) => isSellerAdjacentProcurementEvidenceText(candidate, report)
  });
  const sameProjectRows = sellerAdjacentProcurementRows(sources, report, 6);
  const sameProjectEvidence = uniqueTexts([
    ...sameProjectRows.map((row) => row.text),
    ...arr(sameProjectInfoSignal.evidence).filter((text) => isSellerAdjacentProcurementEvidenceText(text, report))
  ], 6);
  const sameProjectSourceIds = Array.from(new Set([
    ...sameProjectRows.map((row) => row.sourceId),
    ...arr(sameProjectInfoSignal.sourceIds)
  ])).slice(0, 6);
  const lowValueRows = mergeEvidenceRows(
    riskEvidence.filter(isConcreteLowValueEvidenceText).map((text) => ({ text })),
    budgetEvidence.filter(isConcreteLowValueEvidenceText).map((text) => ({ text }))
  );
  const positiveBudgetEvidence = budgetEvidence.filter((text) => !/缺少|未查到|无法|未形成|不能证明|不公示|未披露|未单独披露|暂无|待核验/.test(text));
  const hardProcurementBudgetEvidence = positiveBudgetEvidence.filter((text) => /采购人|招标人|采购单位|采购公告|招标公告|采购意向|预算金额|采购预算|项目金额|合同金额|政府采购|招标计划/.test(text));
  const financialBudgetEvidence = positiveBudgetEvidence.filter((text) => /营收|营业收入|净利润|利润|现金流|毛利|研发投入/.test(text));
  const directPurchaseEvidence = uniqueTexts([...hardProcurementBudgetEvidence, ...financialBudgetEvidence], 6);
  const capitalOnlyEvidence = positiveBudgetEvidence.filter((text) => !directPurchaseEvidence.includes(text));
  const decisionPeople = usefulDecisionPeople(extractDecisionPeople(sources));
  const decisionPeopleEvidence = decisionPeople.map((person) =>
    `${person.name}：${person.role}${person.insight ? `，${cleanBusinessText(person.insight, 90)}` : ""}`
  );
  const forcedBranch = (title, claim, evidence = [], sourceIds = []) => ({
    title,
    claim,
    evidence,
    sourceIds,
    forceDisplay: true
  });
  const boundaryBranch = (claim) => ({ ...forcedBranch("当前边界", claim, []), invalid: true });
  const procurementDetailClaim = (evidence = []) => {
    const text = arr(evidence).join(" ");
    const count = text.match(/招投标记录[：:](?:该查询实体共有)?\s*(\d+)\s*条/)?.[1] || "";
    const supplier = text.match(/供应商[：:]\s*([^，；;。]+)/)?.[1] || "";
    const samples = uniqueTexts(
      text
        .split(/[；;。]/)
        .map((item) => cleanBusinessText(item, 110).replace(/[，,、;；：:\s]+$/g, ""))
        .filter((item) => /采购人|招标人|采购单位|招标公告|中标结果|成交结果|供应商|采购金额|项目|租赁|申购说明/.test(item)),
      3
    );
    const summary = [
      count ? `招投标记录约 ${count} 条` : "",
      supplier ? `供应商记录包含${supplier}` : "",
      samples.length ? `样本包括${samples.join("、")}` : ""
    ].filter(Boolean).join("；");
    return summary
      ? `已查到客户作为甲方或采购相关主体的公开线索：${summary}。`.replace(/，。/g, "。")
      : "已查到公开采购或供应商线索，可用于定性判断其会留下公告、成交或供应商记录。";
  };
  const purchaseLevel = directPurchaseEvidence.length
    ? hardProcurementBudgetEvidence.length
      ? `采购承载能力较强，并且已查到客户作为甲方的采购或预算线索；依据是${evidenceDecisionSummary(hardProcurementBudgetEvidence, "可用采购/预算线索")}。`
      : `${financialCapacityLabel(financialBudgetEvidence)}；依据是${evidenceDecisionSummary(financialBudgetEvidence, "经营金额线索")}。这些数据回答“有没有钱/承载力”，不等同于本项目已经有预算。`
    : positiveBudgetEvidence.length
    ? `采购承载能力可作中等以上判断；依据是${evidenceCategorySummary(positiveBudgetEvidence, "基础体量线索")}。`
    : "未查到营收、现金流、预算或历史采购线索，采购能力未形成有效判断。";
  const purchaseAbilityClaim =
    purchaseLevel;
  const purchaseHabitClaim =
    arr(procurementSignal.evidence).length
      ? `客户存在公开招投标或项目制采购记录，采购习惯可作定性判断：会通过公告、招标/成交结果或供应商记录留下痕迹，但当前样本仍需区分融资公告、办公采购和业务系统采购。`
      : arr(procurementDirectorySignal.evidence).length
        ? "只查到招投标/供应商门户目录入口，尚未查到具体采购项目、预算金额或成交供应商明细。"
    : "未查到客户作为甲方的公开采购记录，采购习惯未形成有效判断。";
  const purchaseHabitEvidence = arr(procurementSignal.evidence).length
    ? arr(procurementSignal.evidence)
    : arr(procurementDirectorySignal.evidence).length
      ? arr(procurementDirectorySignal.evidence)
    : ["已读来源未形成客户作为甲方的采购公告、采购平台记录或供应商记录；现有材料主要体现客户对外交付能力。"];
  const nearBudgetEvidence = uniqueTexts([...arr(entryWindowSignal.evidence), ...arr(procurementSignal.evidence), ...arr(budgetSignal.evidence)].filter(isBudgetWindowEvidenceText), 6);
  const nearBudgetClaim =
    nearBudgetEvidence.length
      ? budgetWindowClaimFromEvidence(nearBudgetEvidence)
    : "未查到明确预算窗口，近期预算未形成有效判断。";
  const sameProjectClaim =
    sameProjectEvidence.length
      ? `客户已有同类采购迹象，不是纯陌生品类机会；依据是${evidenceDecisionSummary(sameProjectEvidence, "客户作为甲方的同类采购线索")}。`
      : `未查到客户作为甲方采购与${sellerCoreOffer(report)}相关产品/服务的记录。`;
  const sameProjectSupport = sameProjectEvidence.length
    ? sameProjectEvidence
    : [`已读来源中可见客户业务、供应链或招投标目录线索，但未形成客户作为甲方采购${sellerCoreOffer(report)}或同类服务的具体记录。`];
  const supplierClaim =
    arr(competitorSignal.evidence).length
      ? sellerCapabilityMode(report) === "digital"
        ? `客户已有供应商、实施商、系统商或竞品线索，首次交流要避开正面替换式打法。`
        : `客户存在既有供应链、外部技术伙伴、自研替代或竞品线索，首次交流要先判断我方在具体品类中的差异化位置。`
      : "未查到客户已有供应商、实施商、系统商或竞品替换线索。";
  const supplierEvidence = arr(competitorSignal.evidence).length
    ? arr(competitorSignal.evidence)
    : ["已读来源未形成客户作为甲方采购时的中标单位、成交供应商、系统供应商或竞品替换记录。"];
  const lowValueClaim =
    lowValueRows.length
      ? "客户存在低价值或谨慎推进信号。"
      : "未查到明确低价值客户信号。";
  const lowValueEvidence = lowValueRows.length
    ? evidenceTexts(lowValueRows, 5)
    : ["已读来源未形成被执行、失信、经营异常、付款纠纷或长期无采购记录等明确低价值信号。"];
  const entryWindowClaim =
    arr(entryWindowSignal.evidence).length
      ? entryWindowClaimFromEvidence(arr(entryWindowSignal.evidence))
      : "未查到明确进入窗口。";
  const entryWindowEvidence = arr(entryWindowSignal.evidence).length
    ? arr(entryWindowSignal.evidence)
    : ["已读来源未出现新项目、新基地、组织调整、旧系统替换或明确采购触发事件。"];
  const decisionChainClaim = decisionPeople.length
    ? "公开资料可见关键人或高管角色线索，决策链应从经营层与项目职能双线核实。"
    : "未查到有行动价值的公开关键人线索，决策链未形成有效判断。";
  const decisionChainEvidence = decisionPeopleEvidence.length
    ? decisionPeopleEvidence
    : ["已读来源未形成明确的信息化、业务、采购、财务或项目负责人线索；仅凭工商高管不能推断本项目实际拍板人。"];
  const nodes = [
    {
      label: "是否有采购能力",
      claim: purchaseAbilityClaim,
      evidence: positiveBudgetEvidence,
      branches: [
        hardProcurementBudgetEvidence.length
          ? forcedBranch("采购/预算依据", "有客户作为甲方的采购公告、招标公告、项目金额、预算金额或供应商记录，可直接支撑采购能力判断。", hardProcurementBudgetEvidence)
          : financialBudgetEvidence.length
            ? forcedBranch("财务能力依据", "营收、利润、现金流或资产规模可直接支撑采购承载能力判断；项目级预算另看采购入口和预算归属。", financialBudgetEvidence)
          : capitalOnlyEvidence.length
            ? forcedBranch("体量依据", "基础体量或资本信息只能支撑承载能力初判，尚不能证明项目级预算。", capitalOnlyEvidence)
            : boundaryBranch("未查到营收、融资、预算、项目金额或历史采购记录。")
      ],
      sourceIds: arr(budgetSignal.sourceIds),
      allowConfirmEvidence: true,
      allowBoundaryEvidence: true,
      forceDisplay: true,
      useExplicitBranchesOnly: true,
      tone: hardProcurementBudgetEvidence.length ? "strong" : budget.score < 58 ? "risk" : "watch"
    },
    {
      label: "是否有采购习惯",
      claim: purchaseHabitClaim,
      evidence: purchaseHabitEvidence,
      branches: arr(procurementSignal.evidence).length
        ? [forcedBranch("采购记录依据", procurementDetailClaim(arr(procurementSignal.evidence)), arr(procurementSignal.evidence), arr(procurementSignal.sourceIds))]
        : arr(procurementDirectorySignal.evidence).length
          ? [forcedBranch("目录线索", "只查到招投标或供应商门户入口；当前证据没有给出具体采购内容、预算金额或成交供应商，不能当作采购习惯强证据。", arr(procurementDirectorySignal.evidence), arr(procurementDirectorySignal.sourceIds))]
        : [boundaryBranch("未查到客户作为甲方的采购公告、采购平台记录或供应商记录。")],
      sourceIds: arr(procurementSignal.sourceIds).length ? arr(procurementSignal.sourceIds) : arr(procurementDirectorySignal.sourceIds),
      allowConfirmEvidence: true,
      allowBoundaryEvidence: true,
      forceDisplay: true,
      useExplicitBranchesOnly: true,
      tone: arr(procurementSignal.evidence).length ? "strong" : arr(procurementDirectorySignal.evidence).length ? "watch" : ""
    },
    {
      label: "是否近期可能有预算",
      claim: nearBudgetClaim,
      evidence: nearBudgetEvidence.length ? nearBudgetEvidence : ["已读来源未出现采购意向、预算金额、政府补贴或项目金额等直接预算窗口。"],
      branches: nearBudgetEvidence.length
        ? [forcedBranch("具体预算信号", budgetWindowClaimFromEvidence(nearBudgetEvidence), nearBudgetEvidence)]
        : [{ ...boundaryBranch("未查到采购意向、预算金额、政府补贴、项目金额或融资募资等预算窗口。"), invalid: true }],
      sourceIds: Array.from(new Set([...arr(entryWindowSignal.sourceIds), ...arr(procurementSignal.sourceIds), ...arr(budgetSignal.sourceIds)])).slice(0, 6),
      allowConfirmEvidence: true,
      allowBoundaryEvidence: true,
      forceDisplay: true,
      useExplicitBranchesOnly: true,
      tone: arr(entryWindowSignal.evidence).length ? "strong" : "watch"
    },
    {
      label: "是否已有同类项目迹象",
      claim: sameProjectClaim,
      evidence: sameProjectSupport,
      branches: sameProjectEvidence.length
        ? [forcedBranch("甲方同类采购", `已查到客户作为甲方采购与${sellerCoreOffer(report)}相邻的产品、服务或项目记录；这支撑“同类项目不是空白”，但具体替换、扩份额或新增品类仍要看当前供应商和技术规格。`, sameProjectEvidence, sameProjectSourceIds)]
        : [boundaryBranch("客户对外给别人交付的案例不能证明客户自己采购过同类项目。")],
      sourceIds: sameProjectEvidence.length ? sameProjectSourceIds : [],
      allowConfirmEvidence: true,
      allowBoundaryEvidence: true,
      forceDisplay: true,
      useExplicitBranchesOnly: true,
      tone: sameProjectEvidence.length ? "strong" : ""
    },
    {
      label: "是否已有供应商或竞品",
      claim: supplierClaim,
      evidence: supplierEvidence,
      branches: arr(competitorSignal.evidence).length
        ? [forcedBranch(sellerCapabilityMode(report) === "digital" ? "供应商/竞品线索" : "供应链/替代线索", sellerCapabilityMode(report) === "digital" ? "已查到客户作为甲方采购、合作或系统建设时出现的供应商、实施商、系统商或竞品线索。" : "已查到客户外部技术伙伴、自研替代、供应链或竞品相关线索；需现场核对与我方产品品类是否直接相关。", arr(competitorSignal.evidence), arr(competitorSignal.sourceIds))]
        : [boundaryBranch("未查到客户作为甲方采购时的中标单位、成交供应商、系统供应商或竞品替换记录。")],
      sourceIds: arr(competitorSignal.sourceIds),
      allowConfirmEvidence: true,
      allowBoundaryEvidence: true,
      forceDisplay: true,
      useExplicitBranchesOnly: true,
      tone: arr(competitorSignal.evidence).length ? "watch" : ""
    },
    {
      label: "是否可能只是低价值客户",
      claim: lowValueClaim,
      evidence: lowValueEvidence,
      branches: lowValueRows.length
        ? [forcedBranch("低价值信号", "已查到经营异常、被执行、失信、付款纠纷、长期无采购或明显规模不匹配等硬线索。", evidenceTexts(lowValueRows, 5), evidenceSourceIds(lowValueRows))]
        : [boundaryBranch("未查到被执行、失信、经营异常、付款纠纷、长期无采购或明显规模不匹配等硬线索。")],
      sourceIds: lowValueRows.length ? evidenceSourceIds(lowValueRows) : [],
      allowConfirmEvidence: true,
      allowBoundaryEvidence: true,
      forceDisplay: true,
      useExplicitBranchesOnly: true,
      tone: lowValueRows.length ? "risk" : ""
    },
    {
      label: "是否存在进入窗口",
      claim: entryWindowClaim,
      evidence: entryWindowEvidence,
      branches: arr(entryWindowSignal.evidence).length
        ? [forcedBranch("进入窗口线索", entryWindowClaimFromEvidence(arr(entryWindowSignal.evidence)), arr(entryWindowSignal.evidence), arr(entryWindowSignal.sourceIds))]
        : [boundaryBranch("未查到采购预算、招标计划、融资募投、扩产建设、技改立项或组织变化等具体触发事件。")],
      sourceIds: arr(entryWindowSignal.sourceIds),
      allowConfirmEvidence: true,
      allowBoundaryEvidence: true,
      forceDisplay: true,
      useExplicitBranchesOnly: true,
      tone: arr(entryWindowSignal.evidence).length ? "strong" : "watch"
    },
    {
      label: "商务风险",
      claim: concreteRiskEvidence.length ? "客户存在需要前置控制的商务风险。" : "未查到明确商务风险硬证据。",
      evidence: concreteRiskEvidence.length ? [riskSummary.riskNote, ...concreteRiskEvidence].filter(isConcreteLowValueEvidenceText) : ["已读来源未出现被执行、失信、付款纠纷、合同诉讼或固定供应商风险硬证据。"],
      branches: concreteRiskEvidence.length
        ? [forcedBranch("商务风险证据", "已查到付款纠纷、被执行、合同诉讼、固定供应商或资金承压等硬线索。", concreteRiskEvidence)]
        : [boundaryBranch("未查到被执行、失信、付款纠纷、合同诉讼、固定供应商或资金承压硬证据。")],
      allowConfirmEvidence: true,
      allowBoundaryEvidence: true,
      forceDisplay: true,
      useExplicitBranchesOnly: true,
      tone: concreteRiskEvidence.length ? "risk" : "watch"
    }
  ];
  return `<div class="report-view-panel view-sales">
    ${argumentTreeSection({
      className: "sales-argument-section",
      kicker: "商务分析",
      thesis: pyramid.summary || brief.oneLine,
      summary: "这一页只展示已找到有效依据的销售决策问题；没有甲方采购、竞品或风险证据时，不用规则硬凑结论。",
      nodes,
      sources,
      showClaim: false
    })}
  </div>`;
}

function presalesPerspective(report, round, sources = []) {
  const strategy = buildSolutionStrategy(report, round);
  const sellerMode = sellerCapabilityMode(report);
  const rawPains = arr(round.painsAndOpportunities).filter((item) => meaningful(item.title) || meaningful(item.pain) || meaningful(item.opportunity));
  const operationalPains = operationalInsightItems(report, round, sources);
  const solutions = visibleSolutionCards(arr(round.solutionCards).filter((item) => meaningful(item.title)), 5);
  const pains = painItemsForVisibleSolutions(mergeOperationalPainItems(rawPains, operationalPains, 8), solutions, solutions.length || 5);
  const topPain = pains[0] || rawPains[0] || {};
  const topSolution = solutions[0] || {};
  const painSummary =
    firstRoundInfoText(round, /business|业务|digital|数字化/) ||
    topPain.pain ||
    topPain.customerSignal ||
    "";
  const businessSignalOptions = {
    excludeFamilies: ["finance_budget", "subject_registry", "risk_legal"],
    excludeKeys: ["finance", "risk", "local"],
    excludePattern: /工商|主体边界|股权|集团关系|上层决策|受益所有人|董监高|注册资本|实缴|财务|年报|经营体量|预算能力|付款能力/i
  };
  const industryPressure = combinedSignal(
    round,
    sources,
    /行业|政策|监管|竞争|价格|国产化|安全|合规|节能|出海|市场|需求变化|技术趋势|AI|智能制造|工业互联网/i,
    5,
    businessSignalOptions
  );
  const topicSignal = combinedSignal(
    round,
    sources,
    /招聘|岗位|系统|平台|数据|算法|安全|运维|质量|交付|客服|运营|产能|效率|流程|知识库|排产|追溯|风控|审计/i,
    5,
    businessSignalOptions
  );
  const coreSceneSignal = combinedSignal(
    round,
    sources,
    /业务|产品线|服务对象|客户案例|行业|平台|工厂|生产|制造|流程|供应链|质量|研发|销售|服务|Holli|MES|APS|ERP|WMS|LIMS/i,
    6,
    businessSignalOptions
  );
  const digitalMaturitySignal = combinedSignal(
    round,
    sources,
    /IT岗位|数据岗位|系统采购|软著|专利|官网技术|数字化|信息化|工业互联网|平台|算法|运维|数据治理|MES|APS|ERP|WMS|LIMS/i,
    6,
    businessSignalOptions
  );
  const existingSystemSignal = combinedSignal(
    round,
    sources,
    /MES|APS|ERP|WMS|LIMS|SCADA|PLM|QMS|CRM|OA|SAP|用友|金蝶|西门子|达索|系统建设|技术栈|历史供应商|系统采购/i,
    6,
    businessSignalOptions
  );
  const replacementSignal = combinedSignal(
    round,
    sources,
    /旧系统|升级|替换|重复采购|运维岗位|系统改造|系统升级|二期|扩容|续建|改造|负面反馈|低效|数据孤岛|接口/i,
    6,
    businessSignalOptions
  );
  const solutionRiskSignal = combinedSignal(
    round,
    sources,
    /行业特殊|监管|数据复杂|系统多|部署|私有化|安全|接口|集成|现场|验收|权限|合规|数据安全/i,
    6,
    businessSignalOptions
  );
  const existingAlternativeSignal = combinedSignal(
    round,
    sources,
    /自研|专利|供应商|合作伙伴|采购平台|供应商门户|供应链|竞品|替代|NVIDIA|英伟达|定点|准入/i,
    6,
    businessSignalOptions
  );
  const industrialOpportunitySignal = combinedSignal(
    round,
    sources,
    /份额|新车型|新品类|海外|本地化|定点|扩产|销量|车型平台|供应链|配套|采购体量/i,
    6,
    businessSignalOptions
  );
  const industrialRiskSignal = combinedSignal(
    round,
    sources,
    /认证|质量|交付|成本|年降|目标价|自研|替代|专利|供应商|海外|本地化|准入|测试|样品|产能|账期/i,
    6,
    businessSignalOptions
  );
  const industrialRequirementEvidence = industrialRequirementEvidenceClauses(
    [...arr(topicSignal.evidence), ...arr(industryPressure.evidence)].filter((item) => !isProcurementDirectoryOnlyText(item)),
    6
  );
  const alternativeEvidence = uniqueTexts(
    arr(existingAlternativeSignal.evidence).filter((item) => !isProcurementDirectoryOnlyText(item)).filter(isSupplierAlternativeEvidenceText),
    6
  );
  const opportunityEvidence = industrialRequirementEvidenceClauses(arr(industrialOpportunitySignal.evidence).filter((item) => !isProcurementDirectoryOnlyText(item)), 6);
  const industrialRiskEvidence = uniqueTexts([
    ...industrialRequirementEvidenceClauses(arr(industrialRiskSignal.evidence).filter((item) => !isProcurementDirectoryOnlyText(item)), 6),
    ...arr(industrialRiskSignal.evidence).filter((item) => !isProcurementDirectoryOnlyText(item)).filter(isSupplierAlternativeEvidenceText)
  ], 6);
  const solutionSummary = topSolution.title
    ? `${topSolution.priority || "P0"} 方案应先围绕“${cleanBusinessText(topSolution.title, 60)}”展开，再按价值和可落地性扩展。`
    : "配套解决方案应先围绕最强痛点做一个可验证闭环，不宜一次铺开所有能力。";
  const coreSceneEvidence = arr(coreSceneSignal.evidence).filter((item) => !/产品中心|提供智能化系统解决方案|企业展厅|详情\s*-\s*/.test(String(item || "")));
  const coreSceneLead = cleanBusinessText(strategy.currentSituation || painSummary || topPain.customerSignal || coreSceneEvidence[0] || "", 130)
    .replace(/[。；;，,]+$/, "");
  const digitalRows = namedSystemEvidenceRows(arr(digitalMaturitySignal.evidence).map((text) => ({ text })));
  const existingRows = namedSystemEvidenceRows(arr(existingSystemSignal.evidence).map((text) => ({ text })));
  const digitalNames = systemNamesFromEvidence(digitalRows);
  const existingNames = systemNamesFromEvidence(existingRows);
  const forcedBranch = (title, claim, evidence = [], sourceIds = []) => ({
    title,
    claim,
    evidence,
    sourceIds,
    forceDisplay: true
  });
  const boundaryBranch = (claim) => ({ ...forcedBranch("当前边界", claim, []), invalid: true });
  const structuredBranch = (title, claim, fields = [], sourceIds = [], kind = "") => ({
    title,
    claim,
    fields,
    sourceIds,
    kind,
    forceDisplay: true
  });
  const solutionBranches = solutions.map((item, index) => {
    const relatedPain = relatedPainForSolution(item, pains, index) || topPain || {};
    const customerPain = safeFieldText(
      item.customerPain || item.pain || item.sourceBasis || relatedPain.pain || relatedPain.customerSignal || "",
      "本方案的痛点仍需通过客户原话、样例或现场流程进一步确认。",
      260
    );
    const intro = safeFieldText(
      item.introduction || item.solutionIntro || item.how || item.body || "",
      `围绕“${cleanBusinessText(item.title || "建议方案", 70)}”形成一个可演示、可验证的解决闭环。`,
      280
    );
    const value = safeFieldText(
      item.value || item.solutionValue || item.why || "",
      "用于把交流从产品功能介绍推进到客户可感知的效率、质量、成本或交付结果。",
      260
    );
    const expected = safeFieldText(
      item.expectedImpact || item.impact || item.outcome || "",
      "预期成效暂不承诺具体数值，首轮应先锁定客户认可的衡量指标。",
      240
    );
    const prereq = safeFieldText(
      item.prerequisite || item.precondition || item.condition || "",
      "需要客户提供业务样例、数据口径、系统边界和责任人后再进入方案深化。",
      240
    );
    const fields = [
      { label: "客户痛点", value: customerPain },
      { label: "方案介绍", value: intro },
      { label: "方案价值", value },
      { label: "预期成效", value: expected },
      { label: "适用前提", value: prereq }
    ];
    return structuredBranch(
      `${item.priority || "P1"}｜${cleanBusinessText(item.title || "方案", 44)}`,
      `${normalizePriorityLabel(item.priority, index)} 方案是“${cleanBusinessText(item.title || "建议方案", 70)}”。`,
      fields,
      normalizeSourceIdList(item),
      "solution-fields"
    );
  });
  const painBranches = pains.map((item, index) =>
    structuredBranch(
      `${normalizePriorityLabel(item.priority, index)}｜${cleanBusinessText(item.title || "痛点机会", 42)}`,
      safeFieldText(item.opportunity || item.pain || item.customerSignal || item.title, "当前只形成待验证机会，需由客户场景、样例数据和价值指标确认后再展开方案。", 170),
      [
        { label: "客户现象", value: safeFieldText(item.customerSignal || item.sourceBasis || "", "未形成足够具体的客户现象，需现场补客户原话或流程样例。", 260) },
        { label: "痛点判断", value: safeFieldText(item.pain || item.reasoning || "", "痛点强度暂不稳定，需确认发生频率、影响岗位和损失指标。", 260) },
        { label: "我方机会", value: safeFieldText(item.opportunity || item.aiEntry || "", "当前只形成待验证机会，需由客户场景、样例数据和价值指标确认后再展开方案。", 260) },
        { label: item.evidenceLevel || "现场验证", value: safeFieldText(item.evidenceLevel ? `${item.reasoning || ""} ${uniqueTexts(arr(item.toConfirm).map((q) => cleanBusinessText(q, 120)), 2).join("；")}` : uniqueTexts(arr(item.toConfirm).map((q) => cleanBusinessText(q, 120)), 3).join("；"), "确认场景优先级、样例数据、责任人和可衡量成效。", 280) }
      ],
      normalizeSourceIdList(item),
      "pain-fields"
    )
  );
  const nodes = [
    {
      label: "客户可能的核心业务场景",
      claim: coreSceneLead
        ? `客户核心业务场景是“${coreSceneLead}”。`
        : "未查到足够具体的核心业务场景。",
      evidence: uniqueTexts([...coreSceneEvidence, painSummary, topPain.customerSignal], 6),
      branches: coreSceneEvidence.length
        ? [forcedBranch("业务场景依据", "已查到以下业务、产品、服务对象、客户案例或行业属性线索。", coreSceneEvidence, arr(coreSceneSignal.sourceIds))]
        : [boundaryBranch("未查到官网业务、产品线、服务对象、客户案例或行业属性等可用依据。")],
      sourceIds: Array.from(new Set([...arr(coreSceneSignal.sourceIds), ...normalizeSourceIdList(topPain)])).slice(0, 6),
      forceDisplay: true,
      allowBoundaryEvidence: true,
      useExplicitBranchesOnly: true,
      tone: "strong"
    },
    {
      label: "痛点机会",
      claim: topPain.opportunity || topPain.pain || "未查到可支撑的痛点机会。",
      evidence: pains.slice(0, 8).map((item) => item.pain || item.opportunity || item.customerSignal || item.title),
      branches: painBranches.length ? painBranches : [boundaryBranch("未查到能支撑痛点判断的客户现象、项目记录或业务线索。")],
      sourceIds: collectSourceIds(pains.slice(0, 8)),
      forceDisplay: true,
      allowBoundaryEvidence: true,
      useExplicitBranchesOnly: true,
      open: true,
      wide: true,
      tone: "strong"
    },
    {
      label: "解决思路",
      claim: strategy.overallApproach || "解决思路暂不能形成有效判断。",
      evidence: arr(strategy.implementationPath),
      branches: [
        forcedBranch("总体思路", strategy.overallApproach || "未形成可用的总体解决思路。", arr(strategy.implementationPath).slice(0, 3)),
        forcedBranch("推进路径", arr(strategy.implementationPath)[0] || "未形成明确推进路径。", arr(strategy.implementationPath).slice(1, 4))
      ],
      allowConfirmEvidence: true,
      allowBoundaryEvidence: true,
      forceDisplay: true,
      useExplicitBranchesOnly: true,
      tone: "normal"
    },
    {
      label: "配套解决方案",
      claim: solutionSummary,
      evidence: solutions.slice(0, 6).map((item) => `${item.priority || "P1"}｜${item.title}${item.value ? `：${item.value}` : item.introduction ? `：${item.introduction}` : ""}`),
      branches: solutionBranches.length ? solutionBranches : [boundaryBranch("未形成可用的配套解决方案。")],
      sourceIds: collectSourceIds(solutions.slice(0, 5)),
      forceDisplay: true,
      allowBoundaryEvidence: true,
      useExplicitBranchesOnly: true,
      open: true,
      wide: true,
      tone: "watch"
    },
    {
      label: sellerMode === "digital" ? "数字化成熟度" : "技术/供应链成熟度",
      claim: sellerMode === "digital"
        ? digitalMaturityClaimFromEvidence(digitalRows)
        : industrialRequirementEvidence.length
          ? `客户存在明确技术或供应链约束，方案必须先锁定产品匹配、质量认证和交付能力；依据是${evidenceDecisionSummary(industrialRequirementEvidence, "技术/供应链线索")}。`
          : "未查到足够具体的技术、质量、认证或供应链要求。",
      evidence: sellerMode === "digital" ? evidenceTexts(digitalRows, 6) : industrialRequirementEvidence,
      branches: sellerMode === "digital"
        ? (digitalRows.length
        ? [forcedBranch("数字化线索", "已查到以下系统、IT岗位、数据岗位、系统采购、软著、专利或官网技术描述。", evidenceTexts(digitalRows, 6), arr(digitalMaturitySignal.sourceIds))]
        : [boundaryBranch("未查到IT岗位、数据岗位、系统采购、软著、专利或官网技术描述。")])
        : (industrialRequirementEvidence.length
          ? [forcedBranch("技术/供应链线索", "以下线索直接指向客户的产品、质量、交付、成本或供应链协同要求。", industrialRequirementEvidence, Array.from(new Set([...arr(topicSignal.sourceIds), ...arr(industryPressure.sourceIds)])).slice(0, 6))]
          : [boundaryBranch("未查到技术规格、认证、质量、交付、成本或供应链协同等具体要求。")]),
      sourceIds: sellerMode === "digital" ? arr(digitalMaturitySignal.sourceIds) : Array.from(new Set([...arr(topicSignal.sourceIds), ...arr(industryPressure.sourceIds)])).slice(0, 6),
      allowConfirmEvidence: true,
      allowBoundaryEvidence: true,
      forceDisplay: true,
      useExplicitBranchesOnly: true,
      tone: (sellerMode === "digital" ? digitalRows.length : industrialRequirementEvidence.length) ? "strong" : "watch"
    },
    {
      label: sellerMode === "digital" ? "可能已有系统" : "既有供应商/自研替代",
      claim: sellerMode === "digital"
        ? (existingRows.length
        ? `可查到的系统/平台包括${existingNames.length ? existingNames.join("、") : "公开系统线索"}。`
        : "未查到具体系统名称。")
        : alternativeEvidence.length
          ? `客户存在既有供应链、外部技术伙伴或自研替代线索：${evidenceDecisionSummary(alternativeEvidence, "替代/伙伴线索")}。`
          : "未查到既有供应商、自研替代或外部技术伙伴的具体线索。",
      evidence: sellerMode === "digital" ? evidenceTexts(existingRows, 6) : alternativeEvidence,
      branches: sellerMode === "digital"
        ? (existingRows.length
        ? [forcedBranch("系统名称依据", "已查到以下具体系统、平台、技术栈或历史供应商名称。", evidenceTexts(existingRows, 6), arr(existingSystemSignal.sourceIds))]
        : [boundaryBranch("未查到MES、APS、ERP、WMS、LIMS、SCADA、PLM、QMS、CRM、OA、SAP、用友、金蝶等具体系统名称。")])
        : (alternativeEvidence.length
          ? [forcedBranch("替代/伙伴线索", "以下线索用于判断现有供应链、外部伙伴、自研替代或准入门槛。", alternativeEvidence, arr(existingAlternativeSignal.sourceIds))]
          : [boundaryBranch("未查到既有供应商、自研替代、外部技术伙伴或准入门槛的具体线索。")]),
      sourceIds: sellerMode === "digital" ? arr(existingSystemSignal.sourceIds) : arr(existingAlternativeSignal.sourceIds),
      allowConfirmEvidence: true,
      allowBoundaryEvidence: true,
      forceDisplay: true,
      useExplicitBranchesOnly: true,
      tone: (sellerMode === "digital" ? existingRows.length : alternativeEvidence.length) ? "watch" : ""
    },
    {
      label: sellerMode === "digital" ? "替换机会" : "扩份额/新品类机会",
      claim: sellerMode === "digital"
        ? replacementClaimFromEvidence(arr(replacementSignal.evidence))
        : opportunityEvidence.length
          ? `扩份额或新品类机会来自${evidenceDecisionSummary(opportunityEvidence, "业务机会线索")}。`
          : "未查到足够具体的扩份额、新车型、新品类或海外配套机会线索。",
      evidence: sellerMode === "digital" ? arr(replacementSignal.evidence) : opportunityEvidence,
      branches: sellerMode === "digital"
        ? (arr(replacementSignal.evidence).length
        ? [forcedBranch("替换触发", replacementClaimFromEvidence(arr(replacementSignal.evidence)), arr(replacementSignal.evidence), arr(replacementSignal.sourceIds))]
        : [boundaryBranch("未查到旧系统采购时间、负面反馈、重复采购、升级项目或招聘运维岗位。")])
        : (opportunityEvidence.length
          ? [forcedBranch("机会线索", "以下线索支撑扩份额、新车型定点、新品类准入或海外配套判断。", opportunityEvidence, arr(industrialOpportunitySignal.sourceIds))]
          : [boundaryBranch("未查到扩份额、新车型定点、新品类准入或海外配套的具体触发线索。")]),
      sourceIds: sellerMode === "digital" ? arr(replacementSignal.sourceIds) : arr(industrialOpportunitySignal.sourceIds),
      allowConfirmEvidence: true,
      allowBoundaryEvidence: true,
      forceDisplay: true,
      useExplicitBranchesOnly: true,
      tone: (sellerMode === "digital" ? arr(replacementSignal.evidence).length : opportunityEvidence.length) ? "strong" : "watch"
    },
    {
      label: "方案风险点",
      claim: sellerMode === "digital"
        ? solutionRiskClaimFromEvidence(arr(solutionRiskSignal.evidence))
        : industrialRiskEvidence.length
          ? `方案风险主要来自技术认证、质量交付、成本年降、既有供应商或自研替代线索：${evidenceDecisionSummary(industrialRiskEvidence, "风险线索")}。`
          : "未查到足以改变方案边界的技术、质量、成本或供应链风险线索。",
      evidence: sellerMode === "digital" ? uniqueTexts([...arr(solutionRiskSignal.evidence), ...arr(industryPressure.evidence)], 6) : uniqueTexts([...industrialRiskEvidence, ...arr(industryPressure.evidence)], 6),
      branches: sellerMode === "digital"
        ? (arr(solutionRiskSignal.evidence).length
        ? [forcedBranch("风险依据", solutionRiskClaimFromEvidence(uniqueTexts([...arr(solutionRiskSignal.evidence), ...arr(industryPressure.evidence)], 6)), uniqueTexts([...arr(solutionRiskSignal.evidence), ...arr(industryPressure.evidence)], 6), Array.from(new Set([...arr(solutionRiskSignal.sourceIds), ...arr(industryPressure.sourceIds)])).slice(0, 6))]
        : [boundaryBranch("未查到行业特殊性、数据复杂、系统多、监管强或部署要求高等具体线索。")])
        : (industrialRiskEvidence.length
          ? [forcedBranch("风险依据", "以下线索用于判断技术认证、质量交付、成本年降、既有供应商或自研替代风险。", uniqueTexts([...industrialRiskEvidence, ...arr(industryPressure.evidence)], 6), Array.from(new Set([...arr(industrialRiskSignal.sourceIds), ...arr(industryPressure.sourceIds)])).slice(0, 6))]
          : [boundaryBranch("未查到技术认证、质量交付、成本年降、既有供应商或自研替代等具体风险线索。")]),
      sourceIds: sellerMode === "digital" ? Array.from(new Set([...arr(solutionRiskSignal.sourceIds), ...arr(industryPressure.sourceIds)])).slice(0, 6) : Array.from(new Set([...arr(industrialRiskSignal.sourceIds), ...arr(industryPressure.sourceIds)])).slice(0, 6),
      allowConfirmEvidence: true,
      allowBoundaryEvidence: true,
      forceDisplay: true,
      useExplicitBranchesOnly: true,
      tone: "risk"
    }
  ].filter(Boolean);
  return `<div class="report-view-panel view-presales">
    ${argumentTreeSection({
      className: "presales-argument-section",
      kicker: "方案分析",
      thesis: strategy.overallApproach || "售前方案应先收敛到可验证场景，再扩展为完整方案。",
      summary: "这一页站在售前视角，把客户现状、痛点机会、解决思路和方案优先级串成一条方案逻辑。",
      nodes,
      sources,
      showClaim: false
    })}
  </div>`;
}

function deliveryWorkPackageSection(round, report = {}) {
  const delivery = buildDeliveryAssessment(report, round);
  const solutions = arr(round.solutionCards).filter((item) => meaningful(item.title)).slice(0, 6);
  const fallbackWorkItems = !solutions.length
    ? arr(delivery.sowOutline)
        .filter(meaningful)
        .filter((item) => !isDeliveryEstimateText(item))
        .slice(0, 5)
        .map((item, index) => ({
          priority: `P${Math.min(index, 2)}`,
          title: cleanBusinessText(item, 48),
          introduction: "按该功能模块拆出二级能力、输入输出、系统边界和客户侧准备项。"
        }))
    : [];
  const workItems = solutions.length ? solutions : fallbackWorkItems;
  if (!workItems.length) return "";
  const rows = workItems.flatMap((item, index) => sowTaskRowsForSolution(item, index, report));
  if (!rows.length) return "";
  return `<section class="battle-section delivery-work-section">
    <h2>SOW分解</h2>
    <p class="section-lead">按可交付功能项拆到一级模块和二级能力，不按实施流程拆分，也不在会前报告里承诺投入规模、上线节奏或商务条款。</p>
    <div class="sow-table">
      <div class="sow-table-head"><span>方案/一级功能</span><span>二级功能项</span><span>难点</span></div>
      ${rows.map((row) => `<article class="sow-table-row${row.hard ? " hard-row" : ""}">
        <div class="sow-primary-cell">
          <span>${e(row.priority)}</span>
          <b>${e(row.solutionTitle)}</b>
          <small>${e(row.moduleTitle)}</small>
        </div>
        <div class="sow-task-cell">
          <b>${e(row.task)}</b>
        </div>
        <div class="sow-difficulty-cell">${row.hard ? `<i class="sow-task-complexity hard">难点</i>` : `<span class="sow-empty">-</span>`}</div>
      </article>`).join("")}
    </div>
    <p class="sow-note">这里只拆工作项目；后续再按数据、接口、硬件、现场环境和验收口径单独核算。</p>
  </section>`;
}

function deliveryBranches(items = [], titlePrefix = "要点") {
  const defaults = ["客户侧输入、输出和验收口径是交付范围边界。", "未确认的接口、数据和权限不进入本轮承诺范围。"];
  return uniqueTexts([...arr(items), ...defaults], 4).slice(0, 4).map((item, index) => ({
    title: `${titlePrefix}${index + 1}`,
    claim: cleanBusinessText(item, 180),
    evidence: [item],
    forceDisplay: true
  }));
}

function deliveryRiskLevel(value = "") {
  const text = cleanBusinessText(value, 260);
  if (/无法提供|规格未锁定|认证要求未锁定|目标价压力|自研替代|产能不足|质量责任不清/.test(text)) return "高";
  if (/技术规格|认证|测试|样品|图纸|BOM|供应商|目标价|产能|物料|交付|小批|量产|海外|本地化/.test(text)) return "中";
  if (/数据质量差|无法提供|接口不可用|无接口|安全禁止|权限不足|多系统|算法|模型|现场设备|PLC|摄像头|验收口径不清|准确率|误报|漏报/.test(text)) return "高";
  if (/数据|接口|权限|系统|安全|部署|样例|验收|边界/.test(text)) return "中";
  return "低";
}

function defaultResponseForRisk(value = "") {
  const category = deliveryRiskCategory(value);
  if (category === "数据风险") return "先提供脱敏样例和字段字典，确认数据口径、缺失率、更新频率和可导出范围。";
  if (category === "系统集成风险") return "先确认现有系统清单、接口方式、调用频率、鉴权方式和测试环境，不承诺未开放接口。";
  if (category === "安全与权限风险") return "先确认部署方式、账号权限、数据脱敏、日志审计和安全审批要求。";
  if (category === "算法与模型风险") return "先用小样本验证准确率、误报漏报和人工复核流程，再决定是否扩大模型范围。";
  if (category === "现场环境风险") return "先核对现场网络、服务器、设备协议、摄像头/PLC接入方式和边缘部署条件。";
  if (category === "验收口径风险") return "先把可验收指标、样例范围、边界场景和不承诺项写清。";
  return "先收敛范围、样例、接口、权限和验收口径，边界外内容不进入本轮承诺。";
}

function deliveryRiskResponseBranches(report = {}, round = {}, delivery = {}) {
  const risks = uniqueTexts(arr(delivery.deliveryRisks).filter(meaningful).filter((item) => !isDeliveryEstimateText(item)), 5);
  const responses = uniqueTexts(arr(delivery.responsePlan).filter(meaningful).filter((item) => !isDeliveryEstimateText(item)), 5);
  const solutionRisks = arr(round.solutionCards)
    .flatMap((item) => [item.prerequisite, item.risk, item.deliveryRisk, item.boundary])
    .filter(meaningful)
    .filter((item) => !isDependencyInstructionText(item))
    .filter((item) => /数据|接口|系统|权限|安全|部署|验收|模型|算法|现场|设备/.test(item));
  const mergedRisks = uniqueTexts([...risks, ...solutionRisks], 5);
  const sourceItems = mergedRisks.length
    ? mergedRisks
    : ["数据样例、系统接口、权限安全和验收口径未确认时，交付范围不能扩大。"];
  return sourceItems.slice(0, 5).map((risk, index) => {
    const response = responses[index] || responses.find((item) => deliveryRiskCategory(item) === deliveryRiskCategory(risk)) || defaultResponseForRisk(risk);
    return {
      title: `${deliveryRiskCategory(risk)}｜${deliveryRiskLevel(risk)}`,
      claim: cleanBusinessText(risk, 160),
      fields: [
        { label: "风险类别", value: deliveryRiskCategory(risk) },
        { label: "风险说明", value: cleanBusinessText(risk, 220) },
        { label: "风险级别", value: deliveryRiskLevel(risk) },
        { label: "应对方案", value: cleanBusinessText(response, 220) }
      ],
      kind: "risk-response-fields",
      evidence: [risk, response].filter(meaningful),
      forceDisplay: true
    };
  });
}

function isTechnicalDependencyText(value = "") {
  const text = cleanBusinessText(value, 240);
  if (!meaningful(text)) return false;
  if (/负责人|责任人|参会|沟通|会后|下一步|预算|商务|采购流程|拍板|决策链|合同|付款|优先级|内部推动|锁定负责人/.test(text)) return false;
  return /数据|样例|字段|口径|接口|API|SDK|系统|MES|APS|ERP|WMS|LIMS|SCADA|PLM|QMS|CRM|OA|SSO|权限|账号|安全|合规|审计|脱敏|日志|部署|私有化|网络|服务器|数据库|硬件|设备|PLC|摄像头|视频|RTSP|边缘|验收|指标|车型|品类|技术规格|认证|图纸|BOM|测试|工况|质量|供应商准入|报价|账期|需求量|产能|物料|包装|物流|售后/.test(text);
}

function normalizeTechnicalDependency(value = "") {
  const text = cleanBusinessText(value, 220)
    .replace(/客户侧确认业务负责人、?IT接口人、?数据责任人和验收负责人。?/g, "")
    .replace(/^推进前(?:要|需|必须)?锁定\s*/g, "")
    .replace(/^(?:需(?:要)?|先|现场|推进前|客户侧)?(?:确认|核对|厘清|明确|锁定)\s*/g, "")
    .replace(/业务负责人|IT接口人|数据责任人|验收负责人|客户责任人|客户侧责任人|现场联系人|负责人|责任人|接口人|联系人|参会角色|预算窗口|采购流程|拍板路径/g, "")
    .replace(/需?IT部门配合/g, "")
    .replace(/需?[^，。；;]{0,8}部门配合/g, "")
    .replace(/客户侧确认业务、?IT、?数据和验收/g, "")
    .replace(/[，,；;\s]+$/g, "");
  if (!isTechnicalDependencyText(text)) return "";
  return text;
}

function technicalDependencyBranches(delivery = {}, round = {}, report = {}) {
  const sellerMode = sellerCapabilityMode(report);
  const dependencies = uniqueTexts([
    ...arr(delivery.dependencies),
    ...arr(round.solutionCards).flatMap((item) => [item.prerequisite, item.precondition, item.condition])
  ], 8)
    .map(normalizeTechnicalDependency)
    .filter(meaningful)
    .slice(0, 5);
  const base = dependencies.length
    ? dependencies
    : sellerMode === "digital"
      ? ["数据样例、字段字典、系统接口/API、部署环境、安全权限、日志审计和验收数据口径。"]
      : ["车型/品类需求、技术规格、认证要求、样品/图纸/BOM、测试工况、质量记录和交付节奏。"];
  return base.slice(0, 5).map((item, index) => ({
    title: `技术依赖${index + 1}`,
    claim: cleanBusinessText(item, 180),
    fields: [
      { label: "技术依赖", value: cleanBusinessText(item, 180) },
      { label: "具体要求", value: defaultResponseForRisk(item) },
      { label: "影响范围", value: sellerMode === "digital"
        ? (/接口|系统|API|SDK|SSO/.test(item) ? "影响系统集成和上线范围。" : /数据|样例|字段|口径/.test(item) ? "影响模型、知识库和验收准确性。" : /安全|权限|审计|部署|网络/.test(item) ? "影响部署方式和安全审批。" : "影响验收口径和变更范围。")
        : (/车型|品类|技术规格|认证|测试|样品|图纸|BOM/.test(item) ? "影响样品验证、技术认可和定点判断。" : /产能|物料|包装|物流|交付|售后/.test(item) ? "影响小批试用、量产放量和交付承诺。" : "影响验收口径和商务准入边界。") }
    ],
    kind: "dependency-fields",
    evidence: [item],
    forceDisplay: true
  }));
}

function deliveryArgumentSection(report, round) {
  const delivery = buildDeliveryAssessment(report, round);
  const sellerMode = sellerCapabilityMode(report);
  const sow = arr(delivery.sowOutline).filter(meaningful).slice(0, 4);
  const sowBranches = sowArgumentBranches(report, round, delivery);
  const riskBranches = deliveryRiskResponseBranches(report, round, delivery);
  const dependencyBranches = technicalDependencyBranches(delivery, round, report);
  const riskTitles = uniqueTexts(riskBranches.map((branch) => String(branch.title || "").replace(/｜.*/, "").trim()).filter(meaningful), 3);
  const riskClaim = riskTitles.length
    ? `主要交付风险集中在${riskTitles.join("、")}，首轮只能承诺已核验边界内的轻量验证。`
    : "主要交付风险集中在接口、权限、数据样例和验收口径，首轮只能承诺已核验边界内的轻量验证。";
  return argumentTreeSection({
    className: "delivery-argument-section",
    kicker: "交付分析",
    thesis: delivery.architectureSketch || "交付应先按功能项拆范围，再锁定数据、接口、权限和验收边界。",
    summary: "这一页只保留交付视角需要的三件事：SOW分解、风险与应对、技术前置依赖。",
    nodes: [
      {
        label: "SOW分解",
        claim: "本轮SOW只按可交付功能项拆分，难点只标注到具体二级功能项。",
        evidence: sow,
        branches: sowBranches.length ? sowBranches : deliveryBranches(sow, "功能项"),
        forceDisplay: true,
        useExplicitBranchesOnly: true,
        open: true,
        wide: true
      },
      {
        label: "风险与应对",
        claim: riskClaim,
        evidence: riskBranches.flatMap((branch) => branch.evidence),
        branches: riskBranches,
        forceDisplay: true,
        useExplicitBranchesOnly: true,
        tone: "risk"
      },
    {
      label: "前置依赖",
      claim: sellerMode === "digital"
        ? "落地前置条件集中在数据、接口、权限、安全、部署和验收口径，任一缺口都会压缩可承诺范围。"
        : "落地前置条件集中在车型/品类需求、技术规格、认证测试、样品/BOM、质量记录和交付节奏，任一缺口都会压缩可承诺范围。",
        evidence: dependencyBranches.flatMap((branch) => branch.evidence),
        branches: dependencyBranches,
        forceDisplay: true,
        useExplicitBranchesOnly: true,
        tone: "watch"
      }
    ],
    sources: arr(report.sources),
    showClaim: false
  });
}

function deliveryPerspective(report, round) {
  return `<div class="report-view-panel view-delivery">
    ${deliveryArgumentSection(report, round)}
  </div>`;
}

function actionQuestionnaireBranches(report = {}, round = {}) {
  const brief = buildExecutiveBrief(report, round);
  const coreQuestion = coreBusinessQuestion(report, round, brief);
  const groups = normalizedQuestionnaireGroups(round, report);
  const groupQuestions = (pattern) => groups
    .filter((group) => pattern.test(String(group.title || "")))
    .flatMap((group) => arr(group.questions));
  const businessQuestions = uniqueTexts([coreQuestion, ...groupQuestions(/业务|场景|问题/)], 5);
  const budgetQuestions = uniqueTexts(groupQuestions(/预算|决策|采购|采购与交付/), 5);
  const dataQuestions = uniqueTexts(groupQuestions(/IT|数据|系统|接口|产品|技术/), 5);
  const deliveryQuestions = uniqueTexts(groupQuestions(/交付|部署|安全|验收|权限|风险|边界/), 5);
  const fallbackQuestions = {
    "业务场景": [
      "客户当前最优先的业务场景是什么，为什么现在要解决？",
      "这个场景影响哪个经营指标：效率、质量、成本、交付还是合规？",
      "如果只做一个小范围验证，客户希望覆盖哪个部门、产线、区域或流程？"
    ],
    "预算与采购": [
      "本项目预算来自业务部门、IT部门、集团专项、年度预算还是政府补贴项目？",
      "决策链上谁发起需求、谁负责技术把关、谁审批预算、谁负责采购流程？",
      "如果验证通过，下一步是方案会、POC、立项还是招采流程？"
    ],
    "系统与数据": [
      "当前业务涉及哪些系统或平台，每个系统分别掌握哪些关键数据？",
      "这些系统能否导出数据、开放接口或提供离线样例？",
      "是否存在私有化、内网、等保、安全审计或数据不出域要求？"
    ],
    "交付验收": [
      "可验收的样例范围、指标口径、异常场景和不承诺项是什么？",
      "客户侧能否提供字段字典、样例数据、测试账号、权限和部署环境？",
      "哪些安全、权限、部署或验收条件不到位会导致项目延期或降级？"
    ]
  };
  const rowsForQuestions = (title, questions) => {
    const picked = uniqueTexts([...arr(questions), ...arr(fallbackQuestions[title])], 5).slice(0, 4);
    return picked.map((question, index) => ({
      label: `${index + 1}. ${cleanBusinessText(question, 220)}`
    }));
  };
  const make = (title, questions, _goal, claim) => {
    const rows = rowsForQuestions(title, questions);
    return {
      title,
      claim: cleanBusinessText(claim, 170),
      rows,
      kind: "questionnaire-row-list",
      evidence: rows.map((row) => row.label).slice(0, 4),
      forceDisplay: true
    };
  };
  return [
    make(
      "业务场景",
      businessQuestions,
      "确认真实场景、影响岗位、损失指标和优先级。",
      "业务场景要同时问清优先级、影响指标、现有做法和试点范围。"
    ),
    make(
      "预算与采购",
      budgetQuestions,
      "区分经营体量、推测预算和项目级预算，避免把财务能力误写成采购意愿。",
      "预算采购要问清预算来源、采购路径、付款主体和下一步流程。"
    ),
    make(
      "系统与数据",
      dataQuestions,
      "判断方案能否落地，以及哪些能力只能先做小样例验证。",
      "系统数据要问清系统清单、接口方式、样例数据、权限和安全要求。"
    ),
    make(
      "交付验收",
      deliveryQuestions,
      "把交付风险落到数据、接口、权限、部署和验收口径。",
      "交付验收要问清验收指标、边界样例、部署条件和不承诺项。"
    )
  ];
}

function actionFocusBranches(report = {}, round = {}, sources = []) {
  const rating = ratingOf(report);
  const delivery = buildDeliveryAssessment(report, round);
  const financeRows = financialKpiRowsForProfile(report, round);
  const topPain = arr(round.painsAndOpportunities).find((item) => meaningful(item.title || item.pain || item.opportunity)) || {};
  const topSolution = arr(round.solutionCards).find((item) => meaningful(item.title)) || {};
  const concreteSensitive = arr(report.sensitiveVerification?.categories).filter(hasImpactfulSensitiveRisk);
  const procurementSignal = combinedSignal(round, sources, /招标|采购|合同|预算|项目金额|采购金额|投标邀请|采购人|招标人|采购单位|政府采购/i, 4, {
    sourcePredicate: (_source, text) => isBuyerProcurementEvidenceText(text),
    signalPredicate: isBuyerProcurementEvidenceText,
    itemPredicate: (_section, _item, candidate) => isBuyerProcurementEvidenceText(candidate)
  });
  const entrySignal = filterSignal(
    combinedSignal(round, sources, /采购意向|招标计划|预算金额|采购预算|采购公告|招标公告|新建|扩产|投产|融资|募投|并购|专项资金|政府补助|技改|改造|组织调整|高管变更/i, 5),
    isEntryWindowEvidenceText
  );
  const riskTexts = usefulRatingEvidence([
    ...arr(rating.riskFlags),
    rating.riskGate?.summary,
    ...arr(rating.riskGate?.reasons),
    ...concreteSensitive.map((item) => item.summary || item.statusLabel || item.label)
  ]).filter((text) => /被执行|失信|诉讼|行政处罚|经营异常|付款|回款|安全|合规|数据|接口|采购|预算/.test(text));
  const technicalDeps = technicalDependencyBranches(delivery, round).flatMap((branch) => branch.evidence).slice(0, 3);
  const make = (title, claim, evidence = [], kind = "attention-compact-fields") => ({
    title,
    claim: cleanBusinessText(claim, 180),
    fields: [
      { label: "关注项", value: title },
      { label: "判断依据", value: cleanBusinessText(evidenceDecisionSummary(evidence, claim), 220) },
      { label: "处理边界", value: cleanBusinessText(claim, 220) }
    ],
    kind,
    evidence: evidence.filter(meaningful).slice(0, 4),
    forceDisplay: true
  });
  const branches = [];
  if (arr(procurementSignal.evidence).length) {
    branches.push(make("甲方采购线索", "已查到客户作为采购人/招标人/采购单位的记录，采购路径可作为商务重点复核。", arr(procurementSignal.evidence)));
  } else if (financeRows.length) {
    branches.push(make("推测信息", "仅有经营金额可辅助判断预算承载，尚不能证明本项目预算、采购窗口或采购意愿。", evidenceTexts(financeRows, 5), "attention-compact-fields inferred"));
  }
  if (arr(entrySignal.evidence).length) {
    branches.push(make("进入窗口", entryWindowClaimFromEvidence(arr(entrySignal.evidence)), arr(entrySignal.evidence)));
  }
  operationalInsightItems(report, round, sources).forEach((item) => {
    branches.push(make(
      item.title,
      `${item.evidenceLevel === "推测信息" ? "推测信息：" : ""}${item.opportunity || item.pain} ${arr(item.toConfirm)[0] || ""}`,
      [item.sourceBasis, item.reasoning, item.customerSignal, item.pain].filter(meaningful),
      item.evidenceLevel === "推测信息" ? "attention-compact-fields inferred" : "attention-compact-fields"
    ));
  });
  if (topPain.title || topPain.pain || topPain.opportunity) {
    branches.push(make(
      "需求真实性",
      `“${shortSceneTitle(topPain.title || topPain.pain || topPain.opportunity)}”需要用客户原话、流程样例和价值指标证明，不按泛场景硬推方案。`,
      [topPain.sourceBasis, topPain.reasoning, topPain.customerSignal, topPain.pain, topPain.opportunity].filter(meaningful)
    ));
  } else if (topSolution.title) {
    branches.push(make(
      "方案边界",
      `“${shortSceneTitle(topSolution.title)}”只能作为推测信息，需由客户场景证据确认后再扩大方案范围。`,
      [topSolution.customerPain, topSolution.introduction, topSolution.value].filter(meaningful),
      "attention-compact-fields inferred"
    ));
  }
  if (technicalDeps.length) {
    branches.push(make("技术前置依赖", "数据、接口、权限、安全、部署和验收口径会决定方案是否能落地。", technicalDeps));
  }
  if (riskTexts.length) {
    branches.push(make("敏感风险", "敏感风险只引用具体事实；没有硬风险时不把财务/经营核验写成风险。", riskTexts));
  }
  if (!branches.length) {
    branches.push(make("推测信息", "当前公开证据不足，只能把预算、需求和技术边界作为待验证事项。", ["公开资料未形成可直接支撑的商务或方案强判断。"], "attention-compact-fields inferred"));
  }
  return branches.slice(0, 7);
}

function actionPerspective(report, round, sources = []) {
  const questionBranches = actionQuestionnaireBranches(report, round);
  const focusBranches = actionFocusBranches(report, round, sources);
  const nodes = [
    {
      label: "现场问卷",
      claim: "现场问卷按业务场景、预算采购、系统数据和交付验收分类，问题只服务于判断。",
      evidence: questionBranches.flatMap((branch) => branch.evidence),
      branches: questionBranches,
      allowConfirmEvidence: true,
      forceDisplay: true,
      useExplicitBranchesOnly: true,
      open: false,
      wide: true,
      tone: "watch"
    },
    {
      label: "重点关注事项",
      claim: "重点关注事项来自商务、方案和交付页中会影响判断的敏感点。",
      evidence: focusBranches.flatMap((branch) => branch.evidence),
      branches: focusBranches,
      allowConfirmEvidence: true,
      forceDisplay: true,
      useExplicitBranchesOnly: true,
      open: false,
      wide: true,
      tone: "risk"
    }
  ];
  return `<div class="report-view-panel view-action">
    ${argumentTreeSection({
      className: "action-argument-section",
      kicker: "行动指南",
      thesis: "行动指南只保留现场问卷和重点关注事项。",
      summary: "这一页不再展示开场话术、会后更新或通用推进说明。",
      nodes,
      sources,
      showClaim: false
    })}
  </div>`;
}

function actionNextStepText(value = "") {
  const text = cleanBusinessText(value, 180);
  if (!text || isNonDecisionClaim(text)) return "";
  if (/近两年|营业收入|净利润|毛利率|现金流|研发投入/.test(text)) {
    return "下一步把本次项目预算来源、采购流程、付款主体和审批人锁清，再决定是否投入重方案。";
  }
  if (/预算来源|审批流程|决策链|付款主体|采购流程/.test(text)) {
    return "下一步锁定项目预算来源、采购流程、付款主体和拍板路径。";
  }
  return text;
}

function usableActionNote(value = "") {
  const text = cleanBusinessText(value, 180);
  if (!meaningful(text)) return "";
  if (isBackendRiskTemplateText(text)) return "";
  if (/不\s*\.{2,}|不承\s*\.{2,}|不\s*…|承诺边界[:：]?\s*不\s*$/.test(text)) return "";
  return text.replace(/^(?:承诺边界|风险关注|主要风险)[：:]\s*/g, "").trim();
}

function roundHistorySection(report) {
  const rounds = arr(report.rounds);
  if (rounds.length <= 1) return "";
  return `<section class="round-history-section">
    <details>
      <summary>历史轮次与拜访反馈</summary>
      <div class="round-history-list">
        ${rounds.map((round) => `<article>
          <b>第 ${e(round.roundNo)} 轮｜${round.type === "post_visit" ? "拜访反馈分析" : "会前研判"}</b>
          ${round.type === "post_visit" && meaningful(round.inputSummary) ? `<p>${e(cleanBusinessText(round.inputSummary, 260))}</p>` : ""}
          ${arr(round.changeSummary).length ? list(arr(round.changeSummary).map((item) => usefulDecisionText(item)).filter(Boolean).slice(0, 4)) : ""}
        </article>`).join("")}
      </div>
    </details>
  </section>`;
}

function reportPerspectiveTabs(report, round, sources = []) {
  return `<section class="report-perspective-shell">
    <input class="report-view-radio" type="radio" name="report-view" id="view-profile" checked>
    <input class="report-view-radio" type="radio" name="report-view" id="view-sales">
    <input class="report-view-radio" type="radio" name="report-view" id="view-presales">
    <input class="report-view-radio" type="radio" name="report-view" id="view-delivery">
    <input class="report-view-radio" type="radio" name="report-view" id="view-action">
    <div class="report-view-tabs" role="tablist" aria-label="报告视角">
      <label for="view-profile">企业画像</label>
      <label for="view-sales">商务分析</label>
      <label for="view-presales">方案分析</label>
      <label for="view-delivery">交付分析</label>
      <label for="view-action">行动指南</label>
    </div>
    <div class="report-view-panels">
      ${customerProfilePerspective(report, round, sources)}
      ${salesPerspective(report, round, sources)}
      ${presalesPerspective(report, round, sources)}
      ${deliveryPerspective(report, round)}
      ${actionPerspective(report, round, sources)}
    </div>
  </section>`;
}

function solutionBattleSection(round, sources) {
  const solutions = arr(round.solutionCards).filter((item) => meaningful(item.title) || meaningful(item.value) || meaningful(item.body));
  if (!solutions.length) return "";
  const field = (item, keys, fallback = "") => {
    for (const key of keys) {
      const value = compactText(item?.[key], 280);
      if (meaningful(value)) return value;
    }
    return fallback;
  };
  return `<section class="battle-section">
    <h2>配套解决方案</h2>
    <details class="battle-solution-group" open>
      <summary>查看 ${e(solutions.length)} 个方案建议</summary>
      <div class="battle-solution-grid">
      ${solutions.map((item, index) => {
        const customerPain = field(item, ["customerPain", "pain", "sourceBasis"], arr(round.painsAndOpportunities)[index]?.pain || "");
        const intro = field(item, ["introduction", "solutionIntro", "how", "body"], item.title || "");
        let value = field(item, ["value", "solutionValue", "why"], "");
        const impact = field(item, ["expectedImpact", "impact", "outcome"], "");
        let body = sameText(item.body, value) || sameText(item.body, impact) || sameText(item.body, intro) ? "" : compactText(item.body, 240);
        if (sameText(value, customerPain) && meaningful(body)) {
          value = body;
          body = "";
        }
        const prerequisite = actionableDependencyText(
          field(item, ["prerequisite", "precondition", "condition"], "业务场景、数据边界、责任人和预算窗口已经锁定。"),
          180
        );
        return `<article class="battle-solution"><div class="solution-head"><span class="tag">${e(item.priority || `S${index + 1}`)}</span><h3>${e(item.title)}</h3></div>${evidenceLinks(item, sources)}
          <div class="label">客户痛点</div><p>${e(customerPain || "当前最适合先把客户场景收敛到一个可验证的业务问题。")}</p>
          <div class="label">方案介绍</div><p>${e(intro || "围绕已识别问题设计轻量验证场景。")}</p>
          <div class="label">方案价值</div><p>${e(value || "把交流从标准功能介绍收敛到可验证的业务价值。")}</p>
          <div class="label">预期成效</div><p>${e(impact || "优先验证效率提升、错误减少、响应提速或人工节省等可量化口径。")}</p>
          <div class="label">适用前提</div><p>${e(prerequisite)}</p>
          ${meaningful(body) ? `<small>${e(body)}</small>` : ""}
        </article>`;
      }).join("")}
      </div>
    </details>
  </section>`;
}

function questionnaireSection(report, round) {
  const groups = normalizedQuestionnaireGroups(round, report);
  if (!groups.length) return "";
  return `<section class="battle-section">
    <h2>拜访问卷</h2>
    <div class="question-grid">${groups.map((group) => `<article class="question-card">
      <h3>${e(group.title)}</h3>
      <p class="question-goal">${e(questionnaireGoal(group.title))}</p>
      ${list(group.questions)}
    </article>`).join("")}</div>
  </section>`;
}

function internalNotesSection(round) {
  const notes = arr(round.internalNotes).filter(isActionableInternalNote);
  if (!notes.length) return "";
  return `<section class="battle-section internal-section">
    <h2>内部注意事项</h2>
    <div class="card">${list(notes)}</div>
  </section>`;
}

function infoGapSection(report) {
  const gaps = [...arr(report.missingTopics), ...arr(report.qualityWarnings).map((item) => item?.message || item)].filter(meaningful);
  if (!gaps.length) return "";
  return `<details class="source-overview"><summary>采集说明</summary>${list(gaps.slice(0, 12))}</details>`;
}

function renderNormalSections(report) {
  const sources = report.sources || [];
  const rounds = arr(report.rounds).length ? arr(report.rounds) : [activeRound(report)];
  const activeNo = Number(report.activeRoundNo || rounds[rounds.length - 1]?.roundNo || 1);
  const active = rounds.find((round) => Number(round.roundNo) === activeNo) || rounds[rounds.length - 1];
  return `
    ${reportPerspectiveTabs(report, active, sources)}
    ${roundHistorySection(report)}`;
}

function evidenceBackstageSection(report) {
  const pool = report.evidencePool || buildEvidencePool(report.sources || []);
  const high = Number(pool.highConfidenceCount || 0);
  const medium = Number(pool.mediumConfidenceCount || 0);
  const weak = Number(pool.weakClueCount || 0);
  const familyStats = sourceFamilySummary(report.sources || []);
  return `<section class="backstage-section">
    <details>
      <summary>资料来源</summary>
      <div class="backstage-stack">
        <div class="source-summary-card">
          <b>本报告引用 ${e(sourceDisplay(report))}</b>
          <span>高置信 ${e(high)} 条｜中置信 ${e(medium)} 条｜弱线索 ${e(weak)} 条。正文结论优先使用高/中置信来源，弱线索仅作为会前问题参考。</span>
          ${familyStats.length ? `<div class="source-family-list">${familyStats.map((item) => `<i>${e(item.label)} ${e(item.count)} 条</i>`).join("")}</div>` : ""}
        </div>
        ${annualReportPanel(report)}
        <details class="source-overview"><summary>查看引用来源</summary><table><colgroup><col style="width:24%"><col style="width:42%"><col style="width:12%"><col style="width:22%"></colgroup><thead><tr><th>资料</th><th>用于支撑的判断</th><th>置信度</th><th>链接</th></tr></thead><tbody>${sourceRows(report.sources)}</tbody></table></details>
      </div>
    </details>
  </section>`;
}

export function renderReportHtml(report) {
  report = normalizeReportShape(report);
  const generated = report.generatedAt ? new Date(report.generatedAt).toLocaleString("zh-CN") : "";
  const duration = formatDuration(report.durationMs);
  const isDiagnostic = report.qualityLevel === "diagnostic";
  const currentRound = activeRound(report);
  const cover = buildExecutiveBrief(report, currentRound);
  const coverNext = salesForwardNextAction(report, currentRound, cover);
  const coverRisk = coverRiskText(cover.risk);
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(report.standardName)}｜商机参谋团 OAC 作战简报</title>
<style>
:root{--ink:#17212b;--muted:#5e6975;--line:#d8e0e7;--paper:#f6f8fa;--teal:#007c82;--blue:#215f9c;--green:#5f7f35;--warn:#9a5b00;--danger:#b63f35}
*{box-sizing:border-box}body{margin:0;background:#eef3f6;color:var(--ink);font-family:"Microsoft YaHei","Alibaba PuHuiTi","Noto Sans SC",Arial,sans-serif;font-size:15px;line-height:1.66}
a{color:var(--blue);text-decoration:none;border-bottom:1px solid rgba(33,95,156,.25)}.icon{width:18px;height:18px;vertical-align:-3px}.source-family-list{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.source-family-list i{font-style:normal;border-radius:999px;padding:3px 9px;background:#eef2ff;color:#3730a3;font-size:12px;font-weight:800}.page{max-width:1120px;margin:0 auto;background:#fff;box-shadow:0 18px 50px rgba(23,33,43,.12)}
.hero{padding:42px 48px 34px;color:#fff;background:linear-gradient(135deg,#17212b 0%,#214653 62%,#f5f7fa 62%)}.kicker{display:inline-flex;padding:6px 12px;border:1px solid rgba(255,255,255,.35);border-radius:999px;color:#dfecef;font-size:13px;font-weight:700}
h1{max-width:820px;margin:22px 0 12px;font-size:35px;line-height:1.18}.hero>p{max-width:760px;margin:0;color:#e6eef1;font-size:16px}.quick{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:28px}.quick div{min-height:132px;padding:14px;border-radius:8px;background:rgba(255,255,255,.94);color:var(--ink)}.quick b{display:block;margin-bottom:6px;color:var(--teal);font-size:16px}.quick span{display:block;color:var(--muted);font-size:13px;line-height:1.45;margin-top:6px}
section{padding:30px 48px 10px}h2{margin:0 0 14px;padding-bottom:8px;border-bottom:2px solid var(--line);font-size:23px;line-height:1.25}h3{margin:0 0 8px;color:var(--blue);font-size:16px}.page>section>h3{margin:30px 0 12px}.page>section>h2+h3{margin-top:6px}.lead,.muted{margin:0 0 16px;color:var(--muted)}
.quality-banner{margin:22px 48px 0;border:1px solid var(--line);border-radius:8px;padding:13px 16px;background:#fbfcfd}.quality-banner b{display:block;margin-bottom:3px}.quality-banner span{display:block;color:var(--muted);font-size:13px}.quality-banner ul{margin-top:8px}.quality-formal{border-left:5px solid var(--teal)}.quality-brief{border-left:5px solid var(--warn);background:#fff9ef}.quality-limited{border-left:5px solid #c76b19;background:#fff7ed}.quality-diagnostic{border-left:5px solid var(--danger);background:#fff4f2}
.annual-panel{margin:22px 48px 0;border:1px solid var(--line);border-radius:10px;padding:0 18px 8px;background:linear-gradient(180deg,#fbfdfd 0%,#fff 100%)}.annual-panel summary{display:flex;justify-content:space-between;gap:16px;align-items:center;cursor:pointer;padding:16px 0 12px}.annual-panel summary h2{margin:0}.annual-panel summary span{color:var(--muted);font-size:13px}.annual-summary{display:flex;justify-content:space-between;gap:18px;align-items:start;margin-bottom:12px}.annual-summary b{display:block;color:var(--teal);font-size:16px}.annual-summary span,.annual-summary p,.annual-panel small{color:var(--muted);font-size:13px}.annual-summary p{margin:0;max-width:380px}
.rating-section{padding-top:10px}.rating-card{width:100%;margin:0;border:1px solid var(--line);border-radius:10px;background:#fbfcfd;overflow:hidden}.rating-card summary{display:flex;justify-content:space-between;gap:16px;align-items:center;cursor:pointer;list-style:none;padding:16px 18px}.rating-card summary::-webkit-details-marker{display:none}.rating-score{display:grid;grid-template-columns:22px auto;gap:2px 10px;align-items:center}.rating-score .icon{grid-row:1 / span 2;color:var(--teal);margin-top:2px}.rating-score b{font-size:18px}.rating-score span{grid-column:2;color:var(--muted);font-size:13px}.rating-toggle{display:inline-flex;align-items:center;gap:6px;color:var(--muted);font-size:13px;font-weight:800;white-space:nowrap}.rating-card[open] .rating-toggle .icon{transform:rotate(180deg)}.rating-detail{border-top:1px solid var(--line);padding:16px 18px 18px}.rating-model-note{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:12px}.rating-model-note article{border:1px solid var(--line);border-radius:8px;background:#fff;padding:12px}.rating-model-note b{display:block;color:var(--blue);margin-bottom:5px}.rating-model-note p{margin:0;color:var(--muted);font-size:13px;line-height:1.55}.rating-dim-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.rating-dim{border:1px solid var(--line);border-radius:8px;background:#fff;padding:12px}.rating-dim-head{display:flex;justify-content:space-between;gap:12px}.rating-dim-head strong{color:var(--teal)}.rating-bar{height:6px;margin:8px 0 10px;border-radius:999px;background:#e5ecef;overflow:hidden}.rating-bar i{display:block;height:100%;border-radius:999px;background:var(--teal)}.rating-dim p{margin:7px 0 0;color:var(--muted);font-size:12px;line-height:1.5}.rating-dim p b{display:inline-block;color:var(--ink);margin-right:6px}.rating-dim-unknown{background:#f8fafc!important}.rating-dim-unknown .rating-dim-head strong{color:#8a96a3!important}.risk-tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.risk-tags span{border-radius:999px;padding:4px 9px;background:#fff4f2;color:var(--danger);font-size:12px;font-weight:800}.risk-gate{margin-top:12px;border:1px solid #f0c8c3;border-radius:8px;background:#fff7f5;padding:12px}.risk-gate b{display:block;color:var(--danger);margin-bottom:4px}.risk-gate p{margin:0;color:var(--ink);font-size:13px}.risk-gate ul{margin-top:6px}.rating-guidance{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:14px}.rating-guidance article{border:1px solid var(--line);border-radius:8px;background:#fff;padding:12px}.rating-guidance b{display:block;color:var(--teal);margin-bottom:6px}.rating-guidance p,.rating-guidance ul{margin:0;color:var(--ink);font-size:13px;line-height:1.55}.rating-guidance ul{padding-left:18px}.rating-guidance li+li{margin-top:4px}.rating-a{border-left:5px solid #16885f}.rating-b{border-left:5px solid #216fa2}.rating-c{border-left:5px solid #b36b00;background:#fff9ef}.rating-d,.rating-not-rated{border-left:5px solid #8a96a3;background:#f7f9fb}
.verification-card{border:1px solid var(--line);border-radius:8px;background:#fbfcfd;padding:15px 16px}.verification-head{display:flex;justify-content:space-between;gap:12px;align-items:start}.verification-head span{border-radius:999px;padding:3px 9px;background:#eef7f7;color:var(--teal);font-size:12px;font-weight:800;white-space:nowrap}.verification-verified .verification-head span{background:#e9f7ef;color:#16885f}.verification-multi_source .verification-head span{background:#eef5fb;color:var(--blue)}.verification-conflict .verification-head span,.verification-unverified .verification-head span{background:#fff4f2;color:var(--danger)}.verification-card p{margin:0 0 10px}.verification-evidence{display:grid;gap:7px}.verification-evidence a{display:block;border:1px solid var(--line);border-radius:7px;background:#fff;padding:8px 10px}.verification-evidence small,.verification-evidence em{display:block;color:var(--muted);font-size:12px}.verification-evidence em{margin-top:4px;font-style:normal}.verification-queries{margin-top:10px}.verification-queries summary{cursor:pointer;color:var(--blue);font-weight:800}.verification-details{margin-top:12px;border:1px solid var(--line);border-radius:8px;background:#fbfcfd;padding:12px 14px}.verification-details summary{cursor:pointer;color:var(--blue);font-weight:800}.verification-details .grid{margin-top:12px}.risk-card{border-left:5px solid var(--warn);background:#fffdf7}.risk-card small{display:block;margin-top:8px;color:var(--muted);line-height:1.45}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.grid.two{grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}.grid.two>*:only-child{grid-column:1/-1}.battle-cover{padding:40px 48px 34px;background:linear-gradient(135deg,#0f1c26 0%,#183946 58%,#eaf7f7 58%)}.cover-meta{display:flex;gap:10px;align-items:center;flex-wrap:wrap;color:#dfecef;font-size:13px}.battle-cover h1{max-width:880px;margin:18px 0 12px;font-size:34px;line-height:1.18}.battle-cover p{max-width:860px;color:#e9f2f3}.cover-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}.cover-actions span{max-width:430px;border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:7px 12px;background:rgba(255,255,255,.12);color:#fff;font-weight:800}.cover-actions .risk{background:rgba(154,91,0,.18);border-color:rgba(255,218,150,.38)}.executive-brief{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(320px,.75fr);gap:18px;padding-top:26px}.brief-main{border:1px solid #b7dddd;border-radius:12px;background:linear-gradient(180deg,#f0fbfa 0%,#fff 100%);padding:22px}.brief-label{display:inline-flex;border-radius:999px;background:#dff4f1;color:var(--teal);padding:4px 10px;font-size:12px;font-weight:900}.brief-main h2{border:0;padding:0;margin:12px 0 8px;font-size:28px;color:#0f2f35}.brief-main p{margin:0;color:#334150}.brief-side{display:grid;grid-template-columns:1fr;gap:10px}.brief-side article{border:1px solid var(--line);border-radius:10px;background:#fff;padding:13px 14px}.brief-side span{display:block;color:var(--muted);font-size:12px;font-weight:900;margin-bottom:4px}.brief-side b{display:block;color:#132231;line-height:1.45}.brief-side small{display:block;color:var(--muted);margin-top:5px;line-height:1.45}.brief-side .risk{border-color:#ead7aa;background:#fffaf2}.brief-side .next{border-color:#b7dddd;background:#f3fbfa}.battle-hero-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}.battle-card,.card,.profile-card,.pain-card,.solution-card,.info-block,.question-card,.battle-solution{border:1px solid var(--line);border-radius:8px;background:#fbfcfd;padding:15px 16px}.battle-card:first-child{grid-column:span 2;background:#eef8f7;border-color:#b7dddd}.battle-card p,.card p,.profile-card p,.pain-card p,.solution-card p,.battle-solution p,.info-line p{margin:0}.change-strip{margin-top:12px;border:1px solid #d7e8e7;border-left:5px solid var(--teal);border-radius:8px;background:#f3fbfa;padding:12px 14px}.change-strip b{display:block;color:var(--teal);margin-bottom:6px}.round-switch{padding-top:8px}.round-switch details,.backstage-section>details{border:1px solid var(--line);border-radius:10px;background:#fbfcfd;padding:13px 15px}.round-switch summary,.backstage-section>details>summary{cursor:pointer;font-weight:900;color:var(--blue)}.round-tabs{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0}.round-tabs button{border:0;border-radius:999px;padding:6px 12px;background:#eef5fb;color:var(--blue);font-size:12px;font-weight:800;cursor:pointer}.round-tabs button.active{background:var(--teal);color:#fff}.round-panel{display:none}.round-panel.active{display:block}.info-section-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.info-block h3{border-bottom:1px solid var(--line);padding-bottom:7px;margin-bottom:10px}.info-line,.info-metric{border-top:1px solid #e9eef2;padding-top:9px;margin-top:9px}.info-line:first-of-type,.info-metric:first-of-type{border-top:0;padding-top:0;margin-top:0}.info-line b,.info-metric b{display:block;color:#334150;margin-bottom:4px}.info-metric strong{display:block;color:var(--teal);font-size:21px;overflow-wrap:anywhere}.info-metric span,.battle-solution small{display:block;color:var(--muted);font-size:13px;line-height:1.5}.battle-solution-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.question-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.internal-section .card{background:#fffaf2;border-color:#ead7aa}.backstage-section{padding-top:16px}.backstage-stack{display:grid;gap:12px;margin-top:14px}.backstage-section .quality-banner,.backstage-section .rating-card,.backstage-section .annual-panel{margin:0}.backstage-section section{padding:0}.label{color:var(--teal);font-weight:800;font-size:13px;margin:9px 0 5px}ul{margin:0;padding-left:18px}li{margin:3px 0}.evidence-links{margin:0 0 9px}.evidence-links summary{display:inline-flex;align-items:center;gap:4px;width:max-content;max-width:100%;padding:2px 8px;border-radius:999px;background:#eaf7f7;color:var(--teal);font-size:12px;font-weight:800;cursor:pointer;list-style:none}.evidence-badge{color:var(--teal);font-weight:900}.evidence-badge.annual{color:#8a5a00}.evidence-links summary::-webkit-details-marker{display:none}.evidence-links div{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}.evidence-links a,.evidence-links .evidence-item{display:inline-flex;flex-direction:column;min-width:min(220px,100%);max-width:calc(50% - 3px);border:1px solid var(--line);border-radius:10px;background:#fff;padding:7px 9px;color:var(--ink);font-size:12px;line-height:1.45}.evidence-links .evidence-item{border-color:#ead7aa;background:#fff8e8}.evidence-links small{display:block;color:var(--muted);margin-top:2px}.evidence-links em{display:block;margin-top:4px;color:#526070;font-style:normal}.metric-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:12px 0 16px}.metric{border:1px solid var(--line);border-radius:8px;background:#fff;padding:14px;min-height:128px;overflow:visible}.metric b{display:block;color:var(--muted);font-size:13px}.metric strong{display:block;color:var(--teal);font-size:22px;margin:4px 0;overflow-wrap:anywhere}.metric span,.solution-card small{display:block;color:var(--muted);font-size:13px;line-height:1.5}.pain-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.pain-card .entry{margin-top:10px;padding:9px 10px;border-radius:6px;background:#eef7f7;color:var(--teal);font-weight:800}.solution-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.tag{display:inline-block;padding:2px 8px;border-radius:999px;background:var(--teal);color:#fff;font-weight:800;font-size:12px;margin-bottom:8px}.require-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.source-overview{border:1px solid var(--line);border-radius:8px;background:#fbfcfd;padding:12px 14px}.source-overview summary{cursor:pointer;font-weight:800;color:var(--blue)}table{width:100%;border-collapse:collapse;table-layout:fixed;margin:12px 0 18px;font-size:14px}th{background:var(--ink);color:#fff;text-align:left;padding:10px 11px;font-weight:700}td{border:1px solid var(--line);padding:10px 11px;vertical-align:top;overflow-wrap:anywhere}tr:nth-child(even) td{background:#f8fafc}.footer{padding:18px 48px 34px;color:var(--muted);font-size:13px}
@media(max-width:850px){.hero,section,.footer{padding-left:22px;padding-right:22px}.battle-cover{padding-top:30px;padding-bottom:28px;background:linear-gradient(145deg,#0f1c26 0%,#183946 100%)}.battle-cover h1{font-size:28px}.cover-actions span{border-radius:10px}.quality-banner,.annual-panel{margin-left:22px;margin-right:22px}.quick,.grid,.grid.two,.executive-brief,.battle-hero-grid,.info-section-grid,.battle-solution-grid,.question-grid,.metric-grid,.pain-grid,.solution-grid,.require-grid,.rating-model-note,.rating-dim-grid,.rating-guidance{grid-template-columns:1fr}.brief-main h2{font-size:24px}.battle-card:first-child{grid-column:auto}.rating-card summary,.annual-summary{display:block}.rating-toggle{margin-top:8px}h1{font-size:29px}}
body{background:linear-gradient(180deg,#07111f 0%,#101b2f 28%,#eef3f8 28%,#f6f8fb 100%)}.page{background:#fff;border-left:1px solid #dbe5f0;border-right:1px solid #dbe5f0}.battle-cover{background:linear-gradient(135deg,#07111f 0%,#14243a 58%,#243b65 100%);border-bottom:1px solid rgba(255,255,255,.12)}.battle-cover h1{color:#f8fafc}.battle-cover p{color:#cbd5e1}.cover-actions span{border-color:rgba(147,197,253,.28);background:rgba(37,99,235,.18);color:#e0f2fe}.cover-actions .risk{background:#fff7ed;color:#7c2d12;border-color:#fed7aa}.kicker{background:rgba(15,23,42,.42);border-color:rgba(147,197,253,.38);color:#bfdbfe}.executive-brief{gap:16px}.brief-main{border-color:#bfd0ff;background:linear-gradient(180deg,#eef4ff 0%,#fff 100%);box-shadow:0 18px 40px rgba(15,23,42,.08)}.brief-label{background:#dbeafe;color:#1d4ed8}.brief-main h2{color:#172554}.brief-side article,.battle-card,.info-block,.pain-card,.battle-solution,.question-card,.card{border-color:#d8e2ef;border-radius:14px;background:linear-gradient(180deg,#fff 0%,#f8fbff 100%);box-shadow:0 10px 26px rgba(15,23,42,.06)}.brief-side article:nth-child(1){border-left:5px solid #2563eb}.brief-side article:nth-child(2){border-left:5px solid #7c3aed}.brief-side .risk{border-left:5px solid #f59e0b;background:#fff7ed;color:#7c2d12}.brief-side .risk b,.brief-side .risk span,.brief-side .risk small{color:#7c2d12}.brief-side .next{border-left:5px solid #0891b2;background:#ecfeff}.battle-section h2{color:#111827;border-bottom-color:#dbe5f0}.battle-hero-grid{grid-template-columns:repeat(5,minmax(0,1fr))}.battle-card:first-child{background:#eef4ff;border-color:#bfccff}.info-block h3,.question-card h3,.pain-card h3,.battle-solution h3{color:#1d4ed8}.info-metric strong{color:#1d4ed8}.label{color:#7c3aed}.pain-card .entry{background:#eef2ff;color:#3730a3}.action-guide-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.action-card{border:1px solid #d8e2ef;border-radius:16px;padding:15px;background:#fff;box-shadow:0 10px 26px rgba(15,23,42,.06)}.action-card span{display:block;margin-bottom:7px;color:#64748b;font-size:12px;font-weight:900}.action-card b{display:block;color:#0f172a;line-height:1.55}.action-card.focus{border-left:5px solid #2563eb}.action-card.ask{border-left:5px solid #0891b2}.action-card.risk{border-left:5px solid #f59e0b;background:#fff7ed;color:#7c2d12}.action-card.risk b,.action-card.risk span{color:#7c2d12}.risk-gate,.risk-card{background:#fff7ed!important;color:#7c2d12!important;border-color:#fed7aa!important}.risk-gate b,.risk-card h3,.risk-card small{color:#7c2d12!important}.battle-solution summary{cursor:pointer;display:flex;align-items:center;gap:10px;list-style:none}.battle-solution summary::-webkit-details-marker{display:none}.battle-solution[open]{background:linear-gradient(180deg,#fff 0%,#f8fbff 100%)}.tag{background:linear-gradient(135deg,#2563eb,#7c3aed)}.evidence-links summary{background:#e0f2fe;color:#0369a1}.backstage-section>details{background:#f8fafc}.footer{background:#f8fafc;color:#64748b}.page{width:100%;max-width:none;border-left:0;border-right:0;box-shadow:none}.battle-cover{margin:0}.hero.battle-cover{padding-left:max(22px,calc((100vw - 1120px)/2 + 48px));padding-right:max(22px,calc((100vw - 1120px)/2 + 48px))}@media(max-width:850px){body{background:#07111f}.battle-cover{padding:24px 18px}.battle-cover h1{font-size:25px}.cover-actions span{width:100%;max-width:none}.action-guide-grid,.battle-hero-grid,.info-section-grid,.battle-solution-grid,.question-grid{grid-template-columns:1fr}.brief-main{padding:18px}.brief-side article{padding:12px}.battle-section{padding-top:22px}.page{border:0}.hero.battle-cover{padding-left:18px;padding-right:18px}}
/* iOS report brief override */
:root{--ios-bg:#f2f2f7;--ios-card:#fff;--ios-card-2:#f9f9fb;--ios-text:#111827;--ios-secondary:#6b7280;--ios-separator:rgba(60,60,67,.18);--ios-blue:#007aff;--ios-green:#34c759;--ios-orange:#ff9500;--ios-red:#ff3b30;--ios-shadow:0 10px 30px rgba(15,23,42,.08);--ink:var(--ios-text);--muted:var(--ios-secondary);--line:var(--ios-separator);--teal:var(--ios-blue);--blue:var(--ios-blue)}
body{background:var(--ios-bg)!important;color:var(--ios-text);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI","Microsoft YaHei","Alibaba PuHuiTi",sans-serif;font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}.page{background:var(--ios-bg);box-shadow:none;overflow-x:hidden}.hero.battle-cover{position:relative;margin:10px auto 0;width:min(calc(100% - 20px),1120px);border-radius:28px;padding:22px;background:radial-gradient(circle at 88% 8%,rgba(255,214,10,.32),transparent 26%),linear-gradient(145deg,#07111f 0%,#182642 62%,#2a4778 100%);overflow:visible}.cover-meta{font-size:12px}.battle-cover h1{margin:14px 0 8px;font-size:clamp(22px,5.2vw,36px);font-weight:850;letter-spacing:0;overflow-wrap:anywhere;word-break:break-word}.battle-cover p{font-size:13px;line-height:1.55;overflow-wrap:anywhere}.cover-actions{gap:8px;margin-top:14px}.cover-actions span{max-width:none;border:0;border-radius:16px;padding:9px 11px;background:rgba(255,255,255,.13);font-size:13px;overflow-wrap:anywhere}.cover-actions .risk{background:rgba(255,149,0,.16);color:#ffe1b0;border:0}.cover-rating-badge{position:absolute;right:18px;top:18px;z-index:9}.cover-rating-badge>summary{display:flex;align-items:center;gap:7px;min-height:40px;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:7px 11px;background:rgba(255,255,255,.16);color:#fff;box-shadow:0 12px 28px rgba(0,0,0,.18);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);cursor:pointer;list-style:none}.cover-rating-badge>summary::-webkit-details-marker{display:none}.cover-rating-badge>summary span{font-size:12px;color:rgba(255,255,255,.72);font-weight:900}.cover-rating-badge>summary b{font-size:14px;color:#fff}.cover-rating-badge .icon{width:17px;height:17px;color:#ffd60a}.cover-rating-popover{position:absolute;right:0;top:calc(100% + 8px);width:min(430px,calc(100vw - 42px));border:1px solid rgba(255,255,255,.48);border-radius:22px;padding:14px;background:rgba(255,255,255,.96);box-shadow:0 24px 58px rgba(15,23,42,.24);color:var(--ios-text)}.cover-rating-popover strong{display:block;margin-bottom:10px;font-size:15px;line-height:1.5}.cover-rating-dims{display:grid;gap:8px}.cover-rating-dims article{border-radius:16px;background:rgba(0,122,255,.07);padding:10px}.cover-rating-dims article div{display:flex;justify-content:space-between;gap:10px;align-items:center}.cover-rating-dims b{color:var(--ios-text);font-size:13px}.cover-rating-dims span{color:var(--ios-blue);font-weight:900;font-size:12px}.cover-rating-dims p{margin:6px 0 0;color:var(--ios-secondary);font-size:12px;line-height:1.45}.cover-rating-dims small{display:block;margin-top:5px;color:var(--ios-secondary);font-size:11px;line-height:1.4}
section{width:min(calc(100% - 20px),1120px);margin:10px auto 0;padding:0}.battle-section h2,section>h2{border:0;margin:0 0 10px;padding:0;color:var(--ios-text);font-size:20px;font-weight:850}.executive-brief{grid-template-columns:minmax(0,1fr) minmax(280px,.72fr);gap:10px;padding-top:10px}.brief-main,.brief-side article,.battle-card,.info-block,.pain-card,.battle-solution,.question-card,.card,.action-card,.source-overview,.verification-card,.rating-card,.quality-banner,.annual-panel{border:0!important;border-radius:22px!important;background:var(--ios-card)!important;box-shadow:var(--ios-shadow)!important}.brief-main{padding:18px}.brief-label,.tag,.evidence-links summary{border-radius:999px;background:rgba(0,122,255,.12)!important;color:var(--ios-blue)!important}.brief-main h2{font-size:23px;color:var(--ios-text);line-height:1.18}.brief-main p,.brief-side small,.info-metric span,.battle-solution small,.metric span,.lead,.muted{color:var(--ios-secondary)}.brief-side{gap:8px}.brief-side article{padding:13px}.brief-side span,.action-card span{color:var(--ios-secondary);font-size:12px}.brief-side b,.action-card b{color:var(--ios-text)}.brief-side .risk,.action-card.risk,.risk-card,.risk-gate{background:rgba(255,149,0,.12)!important;color:#7a3d00!important}.brief-side .next{background:rgba(52,199,89,.10)!important}.action-guide-grid,.info-section-grid,.pain-grid,.battle-solution-grid,.question-grid,.grid.two{gap:10px}.info-block,.pain-card,.battle-solution,.question-card,.card,.action-card{padding:14px}.info-block h3,.question-card h3,.pain-card h3,.battle-solution h3{color:var(--ios-text);font-size:16px}.info-line,.info-metric{border-top:1px solid var(--ios-separator)}.info-metric strong,.metric strong{color:var(--ios-blue);font-size:22px}.label{color:var(--ios-blue);font-size:12px}.pain-card .entry{border-radius:14px;background:rgba(0,122,255,.10);color:var(--ios-blue)}.battle-solution summary{min-height:42px}.backstage-section{padding-top:4px}.backstage-section>details,.round-switch details{border:0;border-radius:20px;background:rgba(118,118,128,.10);box-shadow:none;padding:13px}.backstage-section>details>summary,.round-switch summary{color:var(--ios-blue)}.footer{width:min(calc(100% - 20px),1120px);margin:10px auto 20px;border-radius:20px;background:rgba(118,118,128,.10);padding:12px 14px;color:var(--ios-secondary)}
@media(max-width:850px){body{background:var(--ios-bg)!important;overflow-x:hidden}.hero.battle-cover{width:calc(100% - 18px);margin-top:8px;border-radius:26px;padding:18px}.cover-rating-badge{position:relative;right:auto;top:auto;margin:0 0 10px auto;width:max-content;max-width:100%}.cover-rating-popover{position:absolute;right:0;width:min(360px,calc(100vw - 36px))}.cover-rating-badge>summary{min-height:36px;padding:6px 10px}.battle-cover h1{font-size:22px;line-height:1.22}.cover-actions span{width:100%;border-radius:14px}section,.footer{width:calc(100% - 18px);padding-left:0!important;padding-right:0!important}.executive-brief,.action-guide-grid,.battle-hero-grid,.info-section-grid,.battle-solution-grid,.question-grid,.pain-grid,.metric-grid,.grid,.grid.two,.rating-guidance,.rating-model-note,.rating-dim-grid{grid-template-columns:1fr}.brief-main{padding:16px}.brief-side article,.action-card,.info-block,.pain-card,.battle-solution,.question-card,.card{padding:13px}.backstage-section{margin-bottom:4px}}
.round-feedback-inline{width:min(calc(100% - 20px),1120px);margin:10px auto 0}.round-feedback-inline>div{border:0;border-radius:20px;background:rgba(52,199,89,.10);box-shadow:var(--ios-shadow);padding:12px 14px}.round-feedback-inline span{display:block;color:#1f7a3a;font-size:12px;font-weight:900;margin-bottom:4px}.round-feedback-inline p{margin:0;color:var(--ios-text);line-height:1.55}.round-feedback-inline p+p{margin-top:6px}.round-feedback-inline small{display:block;margin-top:7px;color:var(--ios-secondary);line-height:1.45}.feedback-summary-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px}.feedback-summary-grid article{border-radius:14px;background:rgba(255,255,255,.72);padding:9px 10px}.feedback-summary-grid b{display:block;color:var(--ios-text);font-size:13px;margin-bottom:4px}.feedback-summary-grid p{color:var(--ios-secondary);font-size:13px;line-height:1.5}.round-raw{margin-top:9px;border-radius:14px;background:rgba(255,255,255,.72);padding:9px 10px}.round-raw summary{cursor:pointer;color:var(--ios-blue);font-weight:850;font-size:13px}.round-raw pre{white-space:pre-wrap;word-break:break-word;margin:8px 0 0;color:var(--ios-text);font:13px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro Text","Microsoft YaHei",sans-serif}.decision-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.decision-card{border:0;border-radius:22px;background:var(--ios-card);box-shadow:var(--ios-shadow);padding:14px}.decision-card h3{margin:0 0 9px;color:var(--ios-text);font-size:16px}.decision-card small{display:block;color:var(--ios-secondary);font-size:12px;line-height:1.45;margin-top:8px}.decision-person{border-top:1px solid var(--ios-separator);padding-top:8px;margin-top:8px}.decision-person:first-of-type{border-top:0;padding-top:0;margin-top:0}.decision-person b{display:inline-block;color:var(--ios-text);margin-right:8px}.decision-person span{display:inline-block;border-radius:999px;background:rgba(0,122,255,.10);color:var(--ios-blue);font-size:12px;font-weight:850;padding:2px 7px}.decision-person p{margin:5px 0 0;color:var(--ios-secondary);font-size:13px;line-height:1.5}.buying-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:10px}.buying-verdict,.buying-card{border:0;border-radius:22px;background:var(--ios-card);box-shadow:var(--ios-shadow);padding:14px}.buying-verdict{background:linear-gradient(180deg,rgba(0,122,255,.12),rgba(255,255,255,.94))}.buying-verdict span,.buying-card h3{display:block;margin:0 0 8px;color:var(--ios-secondary);font-size:12px;font-weight:900}.buying-verdict b{display:block;color:var(--ios-text);font-size:16px;line-height:1.55}.buying-verdict small,.buying-metric small{display:block;margin-top:7px;color:var(--ios-secondary);font-size:12px;line-height:1.45}.buying-card.caution{background:rgba(255,149,0,.12)}.buying-metric{border-top:1px solid var(--ios-separator);padding-top:8px;margin-top:8px}.buying-metric:first-of-type{border-top:0;padding-top:0;margin-top:0}.buying-metric span{display:block;color:var(--ios-secondary);font-size:12px;font-weight:850}.buying-metric b{display:inline-block;margin-top:2px;color:var(--ios-blue);font-size:17px}
.cover-decision-strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;margin-top:10px}.cover-decision-strip article{border:0;border-radius:20px;background:var(--ios-card);box-shadow:var(--ios-shadow);padding:12px 13px}.cover-decision-strip span{display:block;color:var(--ios-secondary);font-size:12px;font-weight:900;margin-bottom:5px}.cover-decision-strip b{display:block;color:var(--ios-text);font-size:14px;line-height:1.45}.cover-decision-strip small{display:block;margin-top:5px;color:var(--ios-secondary);font-size:12px;line-height:1.4}.cover-decision-strip .strong{background:rgba(52,199,89,.11)}.cover-decision-strip .watch{background:rgba(255,149,0,.12)}.cover-decision-strip .risk{background:rgba(255,59,48,.10)}.cover-decision-strip .next{background:rgba(0,122,255,.10)}
.source-summary-card{border:0;border-radius:20px;background:var(--ios-card);box-shadow:var(--ios-shadow);padding:14px}.source-summary-card b{display:block;color:var(--ios-text);margin-bottom:5px}.source-summary-card span{display:block;color:var(--ios-secondary);font-size:13px;line-height:1.5}.battle-solution-group{border:0;border-radius:22px;background:rgba(118,118,128,.10);padding:12px}.battle-solution-group>summary{cursor:pointer;color:var(--ios-blue);font-weight:850;list-style:none}.battle-solution-group>summary::-webkit-details-marker{display:none}.solution-head{display:flex;align-items:center;gap:9px;margin-bottom:6px}.solution-head h3{margin:0}.battle-solution-grid{margin-top:12px}
.sales-pyramid{grid-template-columns:1fr;gap:10px}.sales-pyramid .brief-main{background:linear-gradient(180deg,#ffffff 0%,#f4f8ff 100%)!important}.sales-pyramid .brief-main h2{font-size:clamp(24px,4vw,34px);line-height:1.2}.sales-pyramid-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.sales-pyramid-grid article{min-height:146px}.sales-pyramid-grid article.strong{background:rgba(52,199,89,.12)!important}.sales-pyramid-grid article.watch{background:rgba(255,149,0,.12)!important}.sales-pyramid-grid article.risk{background:rgba(255,59,48,.10)!important}.sales-pyramid-grid small{display:block;margin-top:8px;color:var(--ios-secondary);font-size:12px;line-height:1.45}.solution-strategy-section .strategy-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.strategy-grid article{border:0;border-radius:22px;background:var(--ios-card);box-shadow:var(--ios-shadow);padding:14px}.strategy-grid span{display:block;margin-bottom:8px;color:var(--ios-secondary);font-size:12px;font-weight:900}.strategy-grid p{margin:0;color:var(--ios-text);line-height:1.55}.strategy-rank{display:grid;gap:8px}.strategy-rank b{display:block;color:var(--ios-text);line-height:1.4}.strategy-rank small{display:block;color:var(--ios-secondary);font-size:12px;line-height:1.45;margin-top:3px}
.customer-brief-strip{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;width:100%;margin:10px 0 12px;padding:0}.customer-brief-strip article{border:1px solid rgba(15,23,42,.08);border-radius:22px;background:#fff;box-shadow:0 14px 34px rgba(15,23,42,.07);padding:15px 17px}.customer-brief-strip span{display:inline-flex;border-radius:999px;background:#eff6ff;color:#1d4ed8;padding:3px 9px;font-size:12px;font-weight:900}.customer-brief-strip b{display:block;margin-top:8px;color:#0f172a;font-size:15px;line-height:1.6}
.delivery-section .delivery-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.delivery-grid article{border:0;border-radius:22px;background:var(--ios-card);box-shadow:var(--ios-shadow);padding:14px}.delivery-grid article.wide{grid-column:span 2}.delivery-grid article.risk{background:rgba(255,149,0,.12)}.delivery-grid span{display:block;margin-bottom:8px;color:var(--ios-secondary);font-size:12px;font-weight:900}.delivery-grid p{margin:0;color:var(--ios-text);line-height:1.55}.delivery-grid small{display:block;margin-top:8px;color:var(--ios-secondary);font-size:12px;line-height:1.45}.delivery-risk-table{display:grid;gap:0;border:1px solid rgba(15,23,42,.10);border-radius:22px;background:#fff;box-shadow:0 14px 34px rgba(15,23,42,.07);overflow:hidden}.delivery-risk-head,.delivery-risk-row{display:grid;grid-template-columns:1fr 1.7fr 1.7fr 1.4fr}.delivery-risk-head{background:#0f172a;color:#fff;font-size:12px;font-weight:900}.delivery-risk-head span{padding:10px 12px}.delivery-risk-row>*{margin:0;padding:12px;border-top:1px solid rgba(15,23,42,.08);line-height:1.55}.delivery-risk-row b{color:#1d4ed8}.delivery-risk-row p{color:#243244;font-size:13px}
@media(max-width:850px){.decision-grid,.feedback-summary-grid,.buying-grid,.sales-pyramid-grid,.solution-strategy-section .strategy-grid,.delivery-section .delivery-grid,.customer-brief-strip{grid-template-columns:1fr}.delivery-risk-head{display:none}.delivery-risk-row{grid-template-columns:1fr}.delivery-risk-row>*{border-top:1px solid rgba(15,23,42,.08)}.cover-decision-strip{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.cover-decision-strip .next{grid-column:1/-1}.cover-decision-strip article{padding:11px}.cover-decision-strip small{display:none}.round-feedback-inline{width:calc(100% - 18px)}.sales-pyramid-grid article{min-height:auto}.solution-strategy-section .strategy-grid{gap:8px}.delivery-grid article.wide{grid-column:auto}}
.report-perspective-shell{width:min(calc(100% - 20px),1120px);margin:10px auto 0;padding:0}.report-view-radio{position:absolute;opacity:0;pointer-events:none}.report-view-tabs{position:sticky;top:0;z-index:5;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;margin:0 0 10px;padding:8px;border-radius:22px;background:rgba(255,255,255,.78);box-shadow:0 12px 34px rgba(15,23,42,.08);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}.report-view-tabs label{display:flex;align-items:center;justify-content:center;min-height:42px;border-radius:16px;color:#5f6b7a;font-weight:900;font-size:13px;cursor:pointer;white-space:nowrap}.report-view-panels{display:block}.report-view-panel{display:none}.report-view-panel>section{width:100%;margin:10px 0 0}.report-view-panel .rating-section{width:100%;margin:10px 0 0;padding:0}.perspective-claim{border:0;border-radius:26px;background:linear-gradient(145deg,#ffffff 0%,#f3f7ff 100%);box-shadow:var(--ios-shadow);padding:18px;margin:0 0 10px}.perspective-claim span{display:inline-flex;border-radius:999px;padding:4px 10px;background:rgba(0,122,255,.10);color:var(--ios-blue);font-size:12px;font-weight:900}.perspective-claim h2{border:0;margin:10px 0 6px;padding:0;font-size:24px;color:var(--ios-text);line-height:1.22}.perspective-claim p{margin:0;color:var(--ios-secondary);line-height:1.55}.pyramid-stack{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.pyramid-node{border:0;border-radius:22px;background:var(--ios-card);box-shadow:var(--ios-shadow);padding:0;overflow:hidden}.pyramid-node summary{display:grid;gap:5px;cursor:pointer;list-style:none;padding:15px}.pyramid-node summary::-webkit-details-marker{display:none}.pyramid-node summary span{color:var(--ios-secondary);font-size:12px;font-weight:900}.pyramid-node summary b{color:var(--ios-text);font-size:16px;line-height:1.5}.pyramid-node ul,.pyramid-node p{margin:0;padding:0 15px 15px 32px;color:var(--ios-secondary);font-size:13px}.pyramid-node.strong{background:rgba(52,199,89,.10)}.pyramid-node.watch{background:rgba(255,149,0,.12)}.pyramid-node.risk{background:rgba(255,59,48,.10)}.claim-evidence{margin-top:10px}.section-lead{margin:0 0 10px;color:var(--ios-secondary);font-size:13px;line-height:1.55}.work-package-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.work-package-grid article{border:0;border-radius:22px;background:var(--ios-card);box-shadow:var(--ios-shadow);padding:14px}.work-package-grid span{display:inline-flex;border-radius:999px;background:linear-gradient(135deg,#007aff,#7c3aed);color:white;font-size:12px;font-weight:900;padding:2px 8px}.work-package-grid h3{margin:9px 0 6px;color:var(--ios-text)}.work-package-grid p{margin:0;color:var(--ios-secondary);font-size:13px;line-height:1.55}.work-package-grid b{display:block;margin-top:9px;color:var(--ios-blue)}.work-package-breakdown{display:grid;gap:7px;margin-top:10px}.sow-work-group{border:1px solid rgba(0,122,255,.12);border-radius:15px;background:rgba(0,122,255,.045);overflow:hidden}.sow-work-group summary{cursor:pointer;list-style:none;padding:9px 10px;color:var(--ios-text);font-size:13px;font-weight:900}.sow-work-group summary::-webkit-details-marker{display:none}.sow-work-group ul{margin:0;padding:0 12px 10px 28px;color:var(--ios-secondary);font-size:12px;line-height:1.55}.sow-note{margin:10px 0 0;color:var(--ios-secondary);font-size:13px}.round-history-section{width:min(calc(100% - 20px),1120px);margin:10px auto 0;padding:0}.round-history-section>details{border:0;border-radius:22px;background:rgba(118,118,128,.10);padding:13px 15px}.round-history-section summary{cursor:pointer;color:var(--ios-blue);font-weight:900}.round-history-list{display:grid;gap:10px;margin-top:12px}.round-history-list article{border-radius:18px;background:rgba(255,255,255,.82);padding:12px}.round-history-list b{display:block;color:var(--ios-text);margin-bottom:5px}.round-history-list p{margin:0;color:var(--ios-secondary);font-size:13px;line-height:1.55}.argument-section{padding-top:0}.argument-tree{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.argument-node{border:0;border-radius:22px;background:var(--ios-card);box-shadow:var(--ios-shadow);overflow:hidden}.argument-node summary{display:grid;gap:6px;cursor:pointer;list-style:none;padding:15px}.argument-node summary::-webkit-details-marker{display:none}.argument-node summary span{width:max-content;max-width:100%;border-radius:999px;background:rgba(0,122,255,.10);color:var(--ios-blue);padding:3px 9px;font-size:12px;font-weight:900}.argument-node summary b{color:var(--ios-text);font-size:16px;line-height:1.5}.argument-node-body{border-top:1px solid var(--ios-separator);padding:12px 15px 15px}.argument-node-body ul{margin:0;padding-left:18px;color:var(--ios-secondary);font-size:13px;line-height:1.55}.argument-node-body p{margin:0;color:var(--ios-secondary);font-size:13px;line-height:1.55}.argument-branches{display:grid;gap:8px;margin:0 0 12px}.argument-branch{border:1px solid rgba(0,122,255,.12);border-radius:16px;background:rgba(0,122,255,.045);padding:10px 11px}.argument-branch span{display:inline-flex;margin-bottom:6px;border-radius:999px;background:rgba(0,122,255,.10);color:var(--ios-blue);font-size:11px;font-weight:900;padding:2px 8px}.argument-branch b{display:block;color:var(--ios-text);font-size:13px;line-height:1.5}.argument-branch ul{margin-top:6px;font-size:12px}.argument-node.strong{background:rgba(52,199,89,.10)}.argument-node.watch{background:rgba(255,149,0,.12)}.argument-node.risk{background:rgba(255,59,48,.10)}.argument-node.risk summary span{background:rgba(255,59,48,.12);color:var(--ios-red)}.argument-node.watch summary span{background:rgba(255,149,0,.14);color:#a05a00}.perspective-detail-pack{margin:10px 0 0;border:0;border-radius:22px;background:rgba(118,118,128,.10);padding:0;overflow:hidden}.perspective-detail-pack>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;list-style:none;padding:13px 15px;color:var(--ios-blue);font-weight:900}.perspective-detail-pack>summary::-webkit-details-marker{display:none}.perspective-detail-pack>summary small{color:var(--ios-secondary);font-size:12px;font-weight:700;text-align:right}.perspective-detail-body{padding:0 12px 12px}.perspective-detail-body section{width:100%;margin:0;padding:0}.perspective-detail-body section+section{margin-top:10px}.perspective-detail-body h2{font-size:18px;margin-top:4px}
#view-profile:checked~.report-view-tabs label[for="view-profile"],#view-sales:checked~.report-view-tabs label[for="view-sales"],#view-presales:checked~.report-view-tabs label[for="view-presales"],#view-delivery:checked~.report-view-tabs label[for="view-delivery"],#view-action:checked~.report-view-tabs label[for="view-action"]{background:var(--ios-blue);color:#fff;box-shadow:0 8px 22px rgba(0,122,255,.22)}
#view-profile:checked~.report-view-panels .view-profile,#view-sales:checked~.report-view-panels .view-sales,#view-presales:checked~.report-view-panels .view-presales,#view-delivery:checked~.report-view-panels .view-delivery,#view-action:checked~.report-view-panels .view-action{display:block}
@media(max-width:850px){.report-perspective-shell,.round-history-section{width:calc(100% - 18px)}.report-view-tabs{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px;border-radius:20px;padding:6px}.report-view-tabs label{min-width:0;min-height:38px;font-size:11px}.perspective-claim{border-radius:22px;padding:15px}.perspective-claim h2{font-size:21px}.pyramid-stack,.argument-tree,.work-package-grid{grid-template-columns:1fr}.pyramid-node summary,.argument-node summary{padding:13px}.pyramid-node ul,.pyramid-node p{padding:0 13px 13px 28px}.argument-node-body{padding:11px 13px 13px}.perspective-detail-pack>summary{display:grid;gap:3px}.perspective-detail-pack>summary small{text-align:left}}
.perspective-claim .claim-tags{display:flex;flex-wrap:wrap;gap:6px}.perspective-claim .claim-tags span:first-child{background:linear-gradient(135deg,#0f172a,#334155);color:#fff}.argument-evidence-title{display:inline-flex;align-items:center;width:max-content;max-width:100%;margin:0 0 8px;border-radius:999px;background:rgba(15,23,42,.08);color:#334155;padding:3px 9px;font-size:12px;font-weight:900}
.first-visit-intel-section{width:100%;margin:10px 0 0;padding:0}.first-visit-intel-section .section-head{border:0;border-radius:22px;background:linear-gradient(145deg,#eef6ff 0%,#fff 100%);box-shadow:var(--ios-shadow);padding:14px 16px;margin:0 0 10px}.first-visit-intel-section .section-head span{display:inline-flex;border-radius:999px;background:rgba(0,122,255,.10);color:var(--ios-blue);font-size:12px;font-weight:900;padding:4px 10px}.first-visit-intel-section .section-head p{margin:8px 0 0;color:var(--ios-secondary);font-size:13px;line-height:1.5}.first-visit-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.first-visit-card{border:0;border-radius:22px;background:var(--ios-card);box-shadow:var(--ios-shadow);padding:14px}.first-visit-card span{display:inline-flex;border-radius:999px;background:rgba(0,122,255,.10);color:var(--ios-blue);font-size:12px;font-weight:900;padding:3px 9px}.first-visit-card b{display:block;margin:8px 0 6px;color:var(--ios-text);font-size:15px;line-height:1.45}.first-visit-card p,.first-visit-card li{color:var(--ios-secondary);font-size:13px;line-height:1.5}.first-visit-card ul{margin:8px 0 0;padding-left:18px}.first-visit-card.strong{background:rgba(52,199,89,.10)}.first-visit-card.watch{background:rgba(255,149,0,.12)}.first-visit-card.risk{background:rgba(255,59,48,.10)}
.decision-tree-section{width:100%;margin:10px 0 0;padding:0}.decision-tree-section .section-head{border:0;border-radius:22px;background:linear-gradient(145deg,#f6f8ff 0%,#fff 100%);box-shadow:var(--ios-shadow);padding:14px 16px;margin:0 0 10px}.decision-tree-section .section-head span{display:inline-flex;border-radius:999px;background:rgba(124,58,237,.10);color:#6d28d9;font-size:12px;font-weight:900;padding:4px 10px}.decision-tree-section .section-head p{margin:8px 0 0;color:var(--ios-secondary);font-size:13px;line-height:1.5}.decision-tree-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
@media(max-width:850px){.first-visit-grid,.decision-tree-grid{grid-template-columns:1fr}.first-visit-card{padding:13px}}
.battle-cover{background:linear-gradient(145deg,#0b1220 0%,#172033 54%,#22304a 100%)!important;box-shadow:0 24px 70px rgba(15,23,42,.20)}
.battle-cover:before{content:"";position:absolute;inset:0;border-radius:28px;background:linear-gradient(90deg,rgba(255,255,255,.06),transparent 38%);pointer-events:none}
.battle-cover h1{max-width:800px;margin-top:18px!important;margin-bottom:12px!important;font-size:clamp(23px,4.5vw,34px)!important;line-height:1.34!important;font-weight:850!important;letter-spacing:0!important}
.battle-cover p{max-width:780px;font-size:14px!important;line-height:1.78!important;color:#d5deeb!important}
.cover-actions{display:grid!important;grid-template-columns:minmax(0,1.45fr) minmax(260px,.9fr);gap:12px!important;margin-top:18px!important}
.cover-actions span{display:block!important;width:auto!important;max-width:none!important;border:1px solid rgba(148,163,184,.24)!important;border-radius:18px!important;background:rgba(255,255,255,.08)!important;padding:13px 15px!important;color:#eef4ff!important;font-size:14px!important;line-height:1.72!important}
.cover-actions .risk{background:rgba(15,23,42,.34)!important;color:#e8eef7!important;border-color:rgba(148,163,184,.28)!important}
.cover-rating-badge>summary{background:rgba(255,255,255,.12)!important;border-color:rgba(226,232,240,.24)!important}
.cover-rating-badge.rating-a,.cover-rating-badge.rating-b,.cover-rating-badge.rating-c,.cover-rating-badge.rating-d,.cover-rating-badge.rating-not-rated{border-left:0!important;background:transparent!important}
.cover-rating-badge .icon{color:#93c5fd!important}.cover-rating-badge>summary span{color:#cbd5e1!important}
.report-view-tabs{box-shadow:0 10px 28px rgba(15,23,42,.07)!important}.report-view-tabs label{color:#64748b!important}
#view-profile:checked~.report-view-tabs label[for="view-profile"],#view-sales:checked~.report-view-tabs label[for="view-sales"],#view-presales:checked~.report-view-tabs label[for="view-presales"],#view-delivery:checked~.report-view-tabs label[for="view-delivery"],#view-action:checked~.report-view-tabs label[for="view-action"]{background:#0f172a!important;color:#fff!important;box-shadow:none!important}
.argument-tree{gap:12px!important}.argument-node{border:1px solid rgba(15,23,42,.08)!important;background:#fff!important;box-shadow:0 14px 34px rgba(15,23,42,.07)!important}
.argument-node.strong,.argument-node.watch,.argument-node.risk{background:#fff!important}
.argument-node.strong{border-left:4px solid #2563eb!important}.argument-node.watch{border-left:4px solid #64748b!important}.argument-node.risk{border-left:4px solid #dc2626!important}
.argument-node summary{gap:8px!important;padding:17px 18px!important}.argument-node summary span{background:#eff6ff!important;color:#1d4ed8!important}.argument-node.watch summary span{background:#f1f5f9!important;color:#475569!important}.argument-node.risk summary span{background:#fef2f2!important;color:#b91c1c!important}
.argument-node summary b{font-size:16px!important;line-height:1.62!important;color:#0f172a!important}
.argument-node-body{padding:14px 18px 18px!important;border-top:1px solid rgba(15,23,42,.08)!important}
.argument-evidence-title{background:#f8fafc!important;color:#334155!important;border:1px solid rgba(15,23,42,.08)!important}
.argument-node .evidence-links>summary{display:inline-flex!important;flex-direction:row!important;flex-wrap:nowrap!important;align-items:center!important;gap:4px!important;width:max-content!important;max-width:100%!important;white-space:nowrap!important}.argument-node .evidence-links>summary .evidence-badge{display:inline!important;width:auto!important;max-width:none!important;margin:0!important;padding:0!important;border-radius:0!important;background:transparent!important;color:var(--ios-blue)!important;font-size:12px!important;font-weight:900!important;line-height:1.2!important}
.argument-source-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid rgba(15,23,42,.08);color:#64748b;font-size:12px;font-weight:800}.argument-source-row>span{color:#64748b}.argument-source-row .evidence-links{margin:0!important}
.argument-node .evidence-links div{display:flex!important;flex-wrap:wrap!important;gap:6px!important}.argument-node .evidence-links a,.argument-node .evidence-links .evidence-item{display:inline-flex!important;flex-direction:column!important;min-width:min(220px,100%)!important;max-width:calc(50% - 3px)!important;border-radius:12px!important}
.argument-node-body ul{color:#243244!important;font-size:14px!important;line-height:1.74!important;padding-left:20px!important}
.argument-node-body li{margin:6px 0!important}.argument-branch{background:#f8fafc!important;border-color:rgba(15,23,42,.08)!important}.argument-branch span{background:#eef2ff!important;color:#334155!important}.argument-branch b{font-size:13px!important;line-height:1.64!important;color:#172033!important}
.argument-note{margin:0 0 10px!important;border-left:3px solid #2563eb;border-radius:10px;background:#f8fafc;padding:9px 11px!important;color:#334155!important;font-size:13px!important;line-height:1.62!important}
.question-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:12px!important}.question-card{padding:17px 18px!important}.question-card h3{margin-bottom:6px!important;color:#0f172a!important;font-size:16px!important}.question-goal{margin:0 0 12px!important;border-left:3px solid #2563eb;border-radius:10px;background:#f8fafc;padding:8px 10px!important;color:#334155!important;font-size:13px!important;line-height:1.62!important}.question-card ul{display:grid;gap:7px;margin:0!important;padding-left:20px!important;color:#172033!important;font-size:14px!important;line-height:1.72!important}.question-card li{margin:0!important}
.argument-field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px}.argument-field{border:1px solid rgba(15,23,42,.08);border-radius:14px;background:#fff;padding:11px 12px}.argument-field em{display:inline-flex;width:max-content;max-width:100%;margin:0 0 6px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-style:normal;font-size:11px;font-weight:900;padding:2px 8px}.argument-field p{margin:0!important;color:#172033!important;font-size:13px!important;line-height:1.68!important}.argument-field-grid.solution-fields{grid-template-columns:repeat(5,minmax(0,1fr))}.argument-field-grid.solution-fields .argument-field:first-child{grid-column:span 2}.argument-field-grid.solution-fields .argument-field:nth-child(2){grid-column:span 3}.argument-field-grid.solution-fields .argument-field:nth-child(3),.argument-field-grid.solution-fields .argument-field:nth-child(4),.argument-field-grid.solution-fields .argument-field:nth-child(5){grid-column:span 1}.argument-field-grid.pain-fields{grid-template-columns:repeat(4,minmax(0,1fr))}.argument-field-grid.finance-kpi-board{grid-template-columns:repeat(4,minmax(0,1fr))}.argument-field-grid.finance-kpi-board .argument-field:last-child:nth-child(n+4){grid-column:1/-1;background:#f8fafc}.argument-field-grid.risk-response-fields,.argument-field-grid.questionnaire-fields,.argument-field-grid.attention-fields,.argument-field-grid.dependency-fields{grid-template-columns:repeat(4,minmax(0,1fr))}.argument-field-grid.risk-response-fields .argument-field:nth-child(2),.argument-field-grid.risk-response-fields .argument-field:nth-child(4),.argument-field-grid.questionnaire-fields .argument-field:nth-child(2),.argument-field-grid.attention-fields .argument-field:nth-child(2),.argument-field-grid.attention-fields .argument-field:nth-child(3),.argument-field-grid.dependency-fields .argument-field:nth-child(2){grid-column:span 2}.argument-field-grid.inferred .argument-field{background:#f8fafc}.argument-field-grid.inferred .argument-field em{background:#e5e7eb;color:#475569}.argument-node.invalid{border-left-color:#94a3b8!important;background:#f8fafc!important;box-shadow:none!important}.argument-node.invalid summary span,.argument-branch.invalid span{background:#e5e7eb!important;color:#64748b!important}.argument-node.invalid summary b,.argument-branch.invalid b{color:#64748b!important}.argument-branch.invalid{background:#f8fafc!important;border-style:dashed!important;border-color:#cbd5e1!important}.argument-branch.invalid .argument-field{background:#f8fafc!important}.argument-branch.invalid .argument-field p{color:#64748b!important}.argument-node.wide{grid-column:1/-1}.presales-argument-section .argument-node summary b{font-size:17px!important;line-height:1.58!important}.presales-argument-section .argument-branch{background:#fff!important}.presales-argument-section .argument-branch b{font-size:14px!important;line-height:1.62!important}.delivery-work-section .work-package-grid{grid-template-columns:1fr!important;gap:12px!important}.delivery-work-section .work-package-grid article{display:grid!important;grid-template-columns:minmax(260px,.44fr) minmax(0,1fr);gap:14px 18px;align-items:start;border:1px solid rgba(15,23,42,.08)!important;background:#fff!important;padding:16px 18px!important}.delivery-work-section .work-package-grid article>span,.delivery-work-section .work-package-grid article>h3,.delivery-work-section .work-package-grid article>p,.delivery-work-section .work-package-grid article>.work-item-kicker,.delivery-work-section .work-package-grid article>.package-complexity{grid-column:1}.delivery-work-section .work-package-grid article>.work-package-breakdown{grid-column:2;grid-row:1 / span 6;margin-top:0!important}.delivery-work-section .work-package-grid h3{font-size:17px!important;line-height:1.5!important;margin:8px 0 7px!important}.delivery-work-section .work-package-grid p{font-size:13px!important;line-height:1.7!important;color:#334155!important}.delivery-work-section .work-item-kicker{display:block;margin-top:10px;color:#1d4ed8!important;font-size:13px;font-weight:900}.package-complexity{display:inline-flex;width:max-content;max-width:100%;border-radius:999px;padding:3px 9px;background:#eef2ff;color:#334155;font-style:normal;font-size:12px;font-weight:900}.package-complexity.hard,.sow-work-group.hard summary i,.sow-work-group.hard .sow-work-head i{background:#fef2f2;color:#b91c1c}.package-complexity.medium,.sow-work-group.medium summary i,.sow-work-group.medium .sow-work-head i{background:#fff7ed;color:#b45309}.package-complexity.easy,.sow-work-group.easy summary i,.sow-work-group.easy .sow-work-head i{background:#ecfdf5;color:#047857}.delivery-work-section .work-package-breakdown{grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px!important}.delivery-work-section .sow-work-group{border-color:rgba(15,23,42,.08)!important;background:#f8fafc!important}.delivery-work-section .sow-work-group summary{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#eef2ff!important;color:#172033!important;border-bottom:1px solid rgba(15,23,42,.06)}.delivery-work-section .sow-work-group summary b{margin:0!important;color:inherit!important}.delivery-work-section .sow-work-group summary i{font-style:normal;border-radius:999px;padding:2px 7px;font-size:11px;font-weight:900;white-space:nowrap}.delivery-work-section .sow-work-group ul{font-size:13px!important;line-height:1.68!important;color:#243244!important}.delivery-work-section .sow-note{border-left:3px solid #2563eb;border-radius:10px;background:#f8fafc;padding:9px 11px;color:#334155!important;line-height:1.62!important}.delivery-work-section .sow-table{display:grid;gap:0;border:1px solid rgba(15,23,42,.10);border-radius:22px;background:#fff;box-shadow:0 14px 34px rgba(15,23,42,.07);overflow:hidden}.delivery-work-section .sow-table-head,.delivery-work-section .sow-table-row{display:grid;grid-template-columns:minmax(220px,.9fr) minmax(130px,.35fr) minmax(0,1.7fr)}.delivery-work-section .sow-table-head{background:#0f172a;color:#fff;font-size:12px;font-weight:900}.delivery-work-section .sow-table-head span{padding:10px 12px}.delivery-work-section .sow-table-row{border-top:1px solid rgba(15,23,42,.08)}.delivery-work-section .sow-table-row>div{padding:13px 14px}.delivery-work-section .sow-package-title span{display:inline-flex;border-radius:999px;background:linear-gradient(135deg,#2563eb,#7c3aed);color:white;font-size:12px;font-weight:900;padding:2px 8px}.delivery-work-section .sow-package-title h3{margin:8px 0 6px!important;color:#0f172a!important;font-size:16px!important;line-height:1.45!important}.delivery-work-section .sow-package-title p,.delivery-work-section .sow-complexity-cell small{display:block;margin:0!important;color:#64748b!important;font-size:12px!important;line-height:1.6!important}.delivery-work-section .sow-complexity-cell{border-left:1px solid rgba(15,23,42,.08);border-right:1px solid rgba(15,23,42,.08)}.delivery-work-section .sow-complexity-cell small{margin-top:8px!important}.delivery-work-section .work-package-breakdown{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px!important;margin:0!important}.delivery-work-section .sow-work-group{padding:0;overflow:hidden}.delivery-work-section .sow-work-head{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#f1f5f9;border-bottom:1px solid rgba(15,23,42,.06);padding:8px 9px}.delivery-work-section .sow-work-head b{color:#172033!important;font-size:13px!important;line-height:1.45!important}.delivery-work-section .sow-work-head i{font-style:normal;border-radius:999px;padding:2px 7px;font-size:11px;font-weight:900;white-space:nowrap;background:#e2e8f0;color:#475569}.delivery-work-section .sow-work-group ul{padding:8px 12px 10px 26px!important;margin:0!important}.delivery-section .delivery-risk-table{margin-top:10px}.delivery-section .delivery-risk-row p{font-size:13px!important;line-height:1.68!important}
@media(max-width:850px){.hero.battle-cover{padding:20px!important}.battle-cover h1{font-size:22px!important;line-height:1.38!important}.battle-cover p{font-size:13px!important;line-height:1.75!important}.cover-actions{grid-template-columns:1fr!important}.cover-actions span{padding:12px 13px!important;font-size:13px!important;line-height:1.72!important}.argument-tree,.question-grid{grid-template-columns:1fr!important;gap:10px!important}.argument-node summary{padding:15px!important}.argument-node-body{padding:13px 15px 16px!important}.argument-node-body ul{font-size:14px!important;line-height:1.72!important}.argument-node .evidence-links a,.argument-node .evidence-links .evidence-item{width:100%!important;max-width:100%!important}.argument-field-grid,.argument-field-grid.solution-fields,.argument-field-grid.pain-fields,.argument-field-grid.finance-kpi-board,.argument-field-grid.risk-response-fields,.argument-field-grid.questionnaire-fields,.argument-field-grid.attention-fields,.argument-field-grid.dependency-fields{grid-template-columns:1fr!important}.argument-field-grid.solution-fields .argument-field,.argument-field-grid.risk-response-fields .argument-field,.argument-field-grid.questionnaire-fields .argument-field,.argument-field-grid.attention-fields .argument-field,.argument-field-grid.dependency-fields .argument-field{grid-column:auto!important}.delivery-work-section .work-package-grid article{grid-template-columns:1fr!important}.delivery-work-section .work-package-grid article>.work-package-breakdown{grid-column:1;grid-row:auto;margin-top:8px!important}.delivery-work-section .work-package-breakdown{grid-template-columns:1fr!important}.delivery-work-section .sow-table-head{display:none}.delivery-work-section .sow-table-row{grid-template-columns:1fr;border-top:12px solid #f1f5f9}.delivery-work-section .sow-table-row:first-of-type{border-top:0}.delivery-work-section .sow-table-row>div{padding:12px}.delivery-work-section .sow-complexity-cell{border-left:0;border-right:0;border-top:1px solid rgba(15,23,42,.08);border-bottom:1px solid rgba(15,23,42,.08)}}
.cover-rating-popover{background:#fff!important;color:#0f172a!important;border-color:rgba(15,23,42,.12)!important}.cover-rating-popover strong{color:#0f172a!important}.cover-rating-model{margin:10px 0;border:1px solid rgba(37,99,235,.16);border-radius:14px;background:#eff6ff;padding:10px 11px}.cover-rating-model b{display:block;color:#1d4ed8!important;margin-bottom:4px;font-size:12px}.cover-rating-model p{margin:0;color:#1e293b!important;font-size:12px;line-height:1.58}.cover-rating-dims article{background:#f8fafc!important;border:1px solid rgba(15,23,42,.08)!important}.cover-rating-dims p,.cover-rating-dims small{color:#334155!important}.argument-node.invalid,.argument-node.strong.invalid,.argument-node.watch.invalid,.argument-node.risk.invalid{border:1px dashed #cbd5e1!important;border-left:1px dashed #cbd5e1!important;background:#f8fafc!important;box-shadow:none!important}.argument-node.invalid summary{padding:15px 16px!important}.argument-node.invalid summary span,.argument-branch.invalid span{background:#e5e7eb!important;color:#475569!important}.argument-node.invalid summary b,.argument-branch.invalid b{color:#475569!important}.argument-node.invalid .argument-node-body{border-top:1px dashed #cbd5e1!important}.argument-branch.invalid{background:#f8fafc!important;border:1px dashed #cbd5e1!important;box-shadow:none!important}.argument-branch.invalid b,.argument-branch.invalid .argument-field p{color:#475569!important}.delivery-work-section .sow-table-head,.delivery-work-section .sow-table-row{grid-template-columns:minmax(240px,.85fr) minmax(0,1.75fr)!important}.delivery-work-section .sow-complexity-cell{display:none!important}.decision-chain-compact{width:min(calc(100% - 20px),1120px);margin:10px auto 0;padding:0}.decision-chain-head{border-radius:22px;background:#fff;box-shadow:var(--ios-shadow);padding:16px 18px}.decision-chain-head.invalid{border:1px dashed #cbd5e1;background:#f8fafc;box-shadow:none}.decision-chain-head span{display:inline-flex;border-radius:999px;background:rgba(0,122,255,.12);color:var(--ios-blue);font-size:12px;font-weight:900;padding:3px 9px;margin-bottom:8px}.decision-chain-head b{display:block;color:#0f172a;font-size:16px;line-height:1.55}.decision-chain-empty{margin:8px 0 0;color:#475569;font-size:14px;line-height:1.65}.decision-chain-evidence{display:grid;gap:8px;margin-top:12px}.decision-chain-evidence article{border:1px solid rgba(15,23,42,.08);border-radius:14px;background:#f8fafc;padding:10px 11px}.decision-chain-evidence em{display:inline-flex;margin-bottom:5px;border-radius:999px;background:#eef2ff;color:#334155;font-style:normal;font-size:11px;font-weight:900;padding:2px 8px}.decision-chain-evidence p{margin:0;color:#172033;font-size:13px;line-height:1.68}.sow-task-list{display:grid;gap:6px;padding:8px 10px 10px!important;margin:0!important;list-style:none!important}.sow-task-list li{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:8px;margin:0!important;padding:7px 8px;border-radius:11px;background:#fff;border:1px solid rgba(15,23,42,.06)}.sow-task-list span{color:#172033;font-size:13px;line-height:1.55}.sow-task-complexity{display:inline-flex;align-items:center;justify-content:center;min-width:28px;border-radius:999px;padding:2px 7px;font-style:normal;font-size:11px;font-weight:900}.sow-task-complexity.hard{background:#fef2f2;color:#b91c1c}.sow-task-complexity.medium{background:#fff7ed;color:#b45309}.sow-task-complexity.easy{background:#ecfdf5;color:#047857}@media(max-width:850px){.decision-chain-compact{width:calc(100% - 18px)}.delivery-work-section .sow-table-row{grid-template-columns:1fr!important}.sow-task-list li{grid-template-columns:minmax(0,1fr) auto}}
/* OAC desktop readability and table-density override */
body{font-size:16px!important;line-height:1.62!important;background:linear-gradient(180deg,#07111f 0%,#101b2f 300px,#eef3f8 300px,#f6f8fb 100%)!important}
.page{width:min(1180px,calc(100% - 32px))!important;max-width:1180px!important;margin:0 auto!important;border-left:1px solid #dbe5f0!important;border-right:1px solid #dbe5f0!important;box-shadow:0 18px 50px rgba(23,33,43,.12)!important}
.hero.battle-cover{padding:38px 44px 34px!important}
.report-perspective-shell,.round-history-section,.decision-chain-compact{width:min(calc(100% - 40px),1120px)!important}
.argument-node summary b{font-size:17px!important;line-height:1.58!important}.argument-branch b{font-size:15px!important;line-height:1.58!important}.argument-field p{font-size:14px!important;line-height:1.62!important}
.argument-field-grid.solution-fields,.argument-field-grid.pain-fields{grid-template-columns:repeat(2,minmax(0,1fr))!important}.argument-field-grid.solution-fields .argument-field,.argument-field-grid.pain-fields .argument-field{grid-column:auto!important}
.argument-field-grid.questionnaire-compact-fields{grid-template-columns:minmax(110px,.35fr) minmax(0,1.45fr) minmax(220px,.75fr)!important}
.argument-field-grid.attention-compact-fields{grid-template-columns:minmax(140px,.45fr) minmax(0,1.15fr) minmax(240px,.85fr)!important}
.action-argument-section .argument-field-grid.attention-compact-fields .argument-field p{font-size:14px!important;line-height:1.62!important}
.argument-field-grid.sow-row-fields{grid-template-columns:minmax(260px,.8fr) minmax(0,1.55fr) minmax(84px,.25fr)!important;align-items:stretch}
.argument-field-grid.sow-row-fields .argument-field{border-radius:10px!important;padding:9px 10px!important}.argument-field-grid.sow-row-fields .argument-field:nth-child(3) p{font-weight:900;color:#b91c1c!important}.argument-field-grid.sow-row-fields:not(.hard-row) .argument-field:nth-child(3) p{color:#64748b!important}
.argument-branch{padding:0!important;overflow:hidden}.argument-branch>summary{display:grid!important;grid-template-columns:auto minmax(0,1fr);gap:8px;align-items:start;cursor:pointer;list-style:none;padding:11px 12px}.argument-branch>summary::-webkit-details-marker{display:none}.argument-branch>summary::after{content:"展开";grid-column:1/-1;justify-self:start;border-radius:999px;background:#eef2ff;color:#334155;font-size:11px;font-weight:900;padding:2px 8px}.argument-branch[open]>summary::after{content:"收起"}.argument-branch-body{border-top:1px solid rgba(15,23,42,.08);padding:0 11px 11px}.argument-branch:not([open]){background:#fff!important}.argument-branch:not([open])>summary b{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.sow-module-rows{display:grid;margin:0 -11px -11px;border-top:1px solid rgba(15,23,42,.08);background:#fff}.sow-module-row{display:grid;grid-template-columns:minmax(0,1fr) 84px;gap:10px;align-items:center;padding:8px 12px;border-bottom:1px solid rgba(15,23,42,.07);color:#172033;font-size:14px;line-height:1.5}.sow-module-row:last-child{border-bottom:0}.sow-module-row.head{background:#f8fafc;color:#64748b;font-size:12px;font-weight:900}.sow-module-row.hard span:last-child{display:inline-flex;width:max-content;align-items:center;border-radius:999px;background:#fef2f2;color:#b91c1c;font-size:12px;font-weight:900;padding:2px 8px}.sow-module-row span:last-child{justify-self:start;color:#94a3b8}.argument-branch.sow-module-fields>summary{grid-template-columns:minmax(0,1fr)}.argument-branch.sow-module-fields>summary span{white-space:normal}.argument-branch.questionnaire-row-list>summary{grid-template-columns:auto!important}.argument-branch.questionnaire-row-list>summary b{display:none!important}.argument-branch.questionnaire-row-list>summary::after{content:"展开问题"}.argument-branch.questionnaire-row-list[open]>summary::after{content:"收起问题"}.sow-module-rows.questionnaire-row-list{background:#fff}.sow-module-rows.questionnaire-row-list .sow-module-row{grid-template-columns:minmax(0,1fr);padding:8px 12px}.sow-module-rows.questionnaire-row-list .sow-module-row.head{display:none}.sow-module-rows.questionnaire-row-list .sow-module-row span:last-child{display:none}
.argument-branch.pain-fields>summary,.argument-branch.solution-fields>summary{grid-template-columns:minmax(0,1fr)!important;gap:7px!important}.argument-branch.pain-fields>summary span,.argument-branch.solution-fields>summary span{width:max-content;max-width:100%;margin:0!important}.argument-branch.pain-fields>summary b,.argument-branch.solution-fields>summary b{font-size:16px!important;line-height:1.58!important}.sow-module-rows.sow-module-fields .sow-module-row{grid-template-columns:minmax(0,1fr) auto;padding:10px 14px}.sow-module-rows.sow-module-fields .sow-module-row span:first-child{display:block!important;margin:0!important;padding:0!important;border-radius:0!important;background:transparent!important;color:#172033!important;font-size:15px!important;font-weight:500!important;line-height:1.55!important}.sow-module-rows.sow-module-fields .sow-row-main em{display:block!important;margin:0!important;color:#172033!important;font-style:normal!important;font-size:15px!important;font-weight:500!important;line-height:1.45!important}.sow-module-rows.sow-module-fields .sow-row-main small{display:block!important;margin:3px 0 0!important;color:#64748b!important;font-size:13px!important;font-weight:500!important;line-height:1.45!important}.sow-module-rows.sow-module-fields .sow-module-row span:last-child{margin:0!important}
.argument-branch.sow-module-fields .argument-branch-body{padding:0!important}.argument-branch.sow-module-fields .evidence-links{display:block;margin:0!important;padding:9px 14px 12px!important;border-top:1px solid rgba(15,23,42,.07);background:#f8fafc}.argument-branch.sow-module-fields .evidence-links>summary{margin:0!important}
.argument-branch.questionnaire-row-list>summary{min-height:0!important;padding:8px 12px!important;align-items:center!important}.argument-branch.questionnaire-row-list>summary span{margin:0!important;padding:2px 8px!important;font-size:13px!important;line-height:1.35!important}.sow-module-rows.questionnaire-row-list .sow-module-row{padding:7px 12px!important;min-height:0!important}.sow-module-rows.questionnaire-row-list .sow-module-row span:first-child{display:block!important;margin:0!important;padding:0!important;border-radius:0!important;background:transparent!important;color:#334155!important;font-size:13px!important;font-weight:650!important;line-height:1.48!important}.action-argument-section .sow-module-rows.questionnaire-row-list .sow-module-row{font-size:13px!important;line-height:1.48!important}
.argument-branch>summary::after,.argument-branch[open]>summary::after,.argument-branch.questionnaire-row-list>summary::after,.argument-branch.questionnaire-row-list[open]>summary::after{content:none!important;display:none!important}
.delivery-work-section .sow-table-head,.delivery-work-section .sow-table-row{grid-template-columns:minmax(260px,.85fr) minmax(0,1.6fr) minmax(86px,.25fr)!important}.delivery-work-section .sow-table-head span{font-size:13px!important}.delivery-work-section .sow-table-row>div{padding:11px 13px!important}.delivery-work-section .sow-primary-cell span{display:inline-flex;border-radius:999px;background:#2563eb;color:#fff;font-size:12px;font-weight:900;padding:2px 8px}.delivery-work-section .sow-primary-cell b{display:block;margin-top:6px;color:#0f172a;font-size:15px;line-height:1.45}.delivery-work-section .sow-primary-cell small{display:block;margin-top:3px;color:#64748b;font-size:13px;line-height:1.45}.delivery-work-section .sow-task-cell b{display:block;color:#172033;font-size:14px;line-height:1.55}.delivery-work-section .sow-difficulty-cell{display:flex!important;align-items:center!important;justify-content:flex-start}.delivery-work-section .sow-empty{color:#94a3b8;font-weight:900}.delivery-work-section .sow-complexity-cell{display:none!important}
.action-argument-section .argument-node:not([open]) summary{border-bottom:0!important}.action-argument-section .argument-node:not([open]){min-height:auto!important}
@media(max-width:850px){body{font-size:16px!important}.page{width:100%!important;max-width:none!important;border:0!important;box-shadow:none!important}.report-perspective-shell,.round-history-section,.decision-chain-compact{width:calc(100% - 18px)!important}.argument-field-grid,.argument-field-grid.solution-fields,.argument-field-grid.pain-fields,.argument-field-grid.questionnaire-compact-fields,.argument-field-grid.attention-compact-fields,.argument-field-grid.sow-row-fields{grid-template-columns:1fr!important}.delivery-work-section .sow-table-head{display:none!important}.delivery-work-section .sow-table-row{grid-template-columns:1fr!important}.hero.battle-cover{padding:22px 18px!important}}
</style>
</head>
<body>
<main class="page">
  <header class="hero battle-cover">
    ${ratingBadge(report)}
    <div class="cover-meta">
      <span class="kicker">商机参谋团 OAC</span>
      <span>${e(report.sellerProfileName || report.sellerProfileSnapshot?.companyName || "未绑定我的企业")} → ${e(report.standardName)}</span>
    </div>
    <h1>${e(cleanBusinessText(cover.oneLine, 180))}</h1>
    <p>${e(report.standardName)}｜${e(cleanBusinessText(coverNext, 150))}</p>
    <div class="cover-actions">
      <span>优先切入：${e(cleanBusinessText(cover.entry, 96))}</span>
      ${coverRisk ? `<span class="risk">风险：${e(coverRisk)}</span>` : ""}
    </div>
  </header>
  ${isDiagnostic ? renderDiagnosticSections(report) : renderNormalSections(report)}
  ${evidenceBackstageSection(report)}
  <div class="footer">生成时间：${e(generated)}｜生成耗时：${e(duration)}｜质量：${e(displayQualityLabel(report))}｜来源：${e(sourceDisplay(report))}</div>
</main>
<script>
document.querySelectorAll(".round-tabs button").forEach(function(button){
  button.addEventListener("click", function(){
    var target = button.getAttribute("data-round-target");
    document.querySelectorAll(".round-tabs button").forEach(function(item){ item.classList.toggle("active", item === button); });
    document.querySelectorAll(".round-panel").forEach(function(panel){ panel.classList.toggle("active", panel.getAttribute("data-round-panel") === target); });
  });
});
document.querySelectorAll(".report-view-tabs label").forEach(function(label){
  label.addEventListener("click", function(){
    var input = document.getElementById(label.getAttribute("for"));
    if (input) input.checked = true;
  });
});
var requestedView = new URLSearchParams(window.location.search).get("view");
if (requestedView) {
  var requestedInput = document.getElementById("view-" + requestedView);
  if (requestedInput) requestedInput.checked = true;
}
if (new URLSearchParams(window.location.search).get("open") === "all") {
  document.querySelectorAll("details.argument-node, details.argument-branch").forEach(function(details){
    details.open = true;
  });
}
</script>
</body>
</html>`;
}
