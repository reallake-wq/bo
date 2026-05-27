import { callModel, extractJson } from "./ai.mjs";
import { ChevronDown, CircleAlert, Trophy } from "lucide";
import { clip } from "./util.mjs";
import { buildOpportunityRating } from "./opportunity-rating.mjs";
import { TOPIC_NAMES, buildEvidencePool, cleanUrl, formatQualityWarnings, isHttpUrl, normalizeReportSources } from "./report-quality.mjs";

function e(value) {
  return String(value ?? "")
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
  const values = arr(items);
  return values.length ? `<ul>${values.map((item) => `<li>${e(item)}</li>`).join("")}</ul>` : `<p class="muted">待确认</p>`;
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
          const excerpt = source.evidenceExcerpt || source.text || source.snippet || "";
          return `<a href="${e(url)}" target="_blank" rel="noreferrer"><b>${e(id)}.</b> ${e(source.title || source.domain || "资料来源")}${meta ? `<small>${e(meta)}</small>` : ""}${support ? `<small>支撑：${e(support)}</small>` : ""}${excerpt ? `<em>${e(clip(excerpt, 180))}</em>` : ""}</a>`;
        })
        .join("")}
    </div>
  </details>`;
}

function cardGrid(items, className = "card", sources = []) {
  return (
    arr(items)
      .map((item) => `<article class="${className}"><h3>${e(item.title)}</h3>${evidenceLinks(item, sources)}<p>${e(item.body || item.summary || item.insight)}</p></article>`)
      .join("") || `<article class="${className}"><h3>待补充</h3><p>当前来源不足，需补充客户信息后再判断。</p></article>`
  );
}

function evidenceCards(items, sources = []) {
  return (
    arr(items)
      .map(
        (item) => `<article class="profile-card"><h3>${e(item.title)}</h3>${evidenceLinks(item, sources)}
          <div class="label">依据</div>${list(item.facts)}
          <div class="label">判断</div><p>${e(item.insight)}</p>
          ${arr(item.toConfirm).length ? `<div class="label">待确认</div>${list(item.toConfirm)}` : ""}
        </article>`
      )
      .join("") || `<article class="profile-card"><h3>待确认</h3><p>当前来源不足以形成稳定判断。</p></article>`
  );
}

function metricCards(items, sources = []) {
  return (
    arr(items)
      .map((item) => `<div class="metric"><b>${e(item.label)}</b><strong>${e(formatMetricValue(item.value, item.label))}</strong>${evidenceLinks(item, sources)}<span>${e(item.note)}</span></div>`)
      .join("") || `<div class="metric"><b>指标</b><strong>待确认</strong><span>公开来源不足。</span></div>`
  );
}

function painCards(items, sources = []) {
  return (
    arr(items)
      .map(
        (item) => `<article class="pain-card"><h3>${e(item.title)}</h3>${evidenceLinks(item, sources)}
          <div class="label">依据</div><p>${e(item.sourceBasis)}</p>
          <div class="label">判断</div><p>${e(item.reasoning)}</p>
          <div class="label">待确认</div>${list(item.validationSignals)}
          <div class="entry">${e(item.aiEntry)}</div>
        </article>`
      )
      .join("") || `<article class="pain-card"><h3>暂不生成痛点判断</h3><p>来源不足时不输出经营痛点，避免把行业常识写成客户事实。</p></article>`
  );
}

function solutionCards(items, sources = []) {
  return (
    arr(items)
      .map(
        (item) => `<article class="solution-card"><span class="tag">${e(item.priority)}</span><h3>${e(item.title)}</h3>${evidenceLinks(item, sources)}
          <div class="label">依据</div><p>${e(item.why)}</p>
          <div class="label">做法</div><small>${e(item.how)}</small>
        </article>`
      )
      .join("") || `<article class="solution-card"><span class="tag">待定</span><h3>不建议直接承诺方案</h3><p>需先补齐客户场景与数据边界。</p></article>`
  );
}

function sourceRows(items) {
  const rows = arr(items)
    .filter((item) => isHttpUrl(item.url))
    .map((item, index) => {
      const url = cleanUrl(item.url);
      const meta = [item.sourceType, item.domain, item.relevanceReason].filter(Boolean).join("｜");
      return `<tr><td><b>${e(sourceId(item, index))}.</b> ${e(item.title)}${meta ? `<br><small>${e(meta)}</small>` : ""}</td><td>${e(item.usedFor || item.query || item.topic || "")}</td><td>${e(item.confidence || "")}</td><td><a href="${e(url)}" target="_blank" rel="noreferrer">${e(item.domain || "来源链接")}</a></td></tr>`;
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
    relevanceReason: source.relevanceReason,
    domain: source.domain,
    text: clip(source.text, textLimit)
  }));
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

function extractedFinancialMetrics(financeSources) {
  const text = financeSources.map((source) => source.text || "").join("\n");
  return [
    financeMetricFromText(text, "营业收入", [/营业收入[：:]\s*([^；。\n]+)/]),
    financeMetricFromText(text, "归母净利润", [/归母净利润[：:]\s*([^；。\n]+)/]),
    financeMetricFromText(text, "扣非净利润", [/扣非净利润[：:]\s*([^；。\n]+)/]),
    financeMetricFromText(text, "毛利率", [/毛利率[：:]\s*([^；。\n]+)/]),
    financeMetricFromText(text, "经营现金流", [/经营现金流净额[：:]\s*([^；。\n]+)/, /经营现金流[：:]\s*([^；。\n]+)/]),
    financeMetricFromText(text, "资产负债率", [/资产负债率[：:]\s*([^；。\n]+)/]),
    financeMetricFromText(text, "总资产/总负债", [/总资产[：:]\s*([^；。\n]+；总负债[：:]\s*[^；。\n]+)/]),
    financeMetricFromText(text, "研发投入", [/研发投入[：:]\s*([^；。\n]+)/]),
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
  const financeSources = normalizeReportSources(sources, 80).filter((source) => source.topic === TOPIC_NAMES[1] || source.sourceType === "财务硬来源");
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
  const note = hasAnnual
    ? "已接入用户上传年报；该指标未被自动抽取，建议按年报页码或财务表人工核对。"
    : financeSources.length
    ? `已采集财务硬来源${sourceNames.length ? `：${sourceNames.join("、")}` : ""}；当前模型未自动抽取该指标，需打开财务来源核验具体数值。`
    : `已尝试按${stockCode ? `股票代码 ${stockCode}、` : ""}年报/公告/F10 财务来源检索，但未获得可读财务硬来源，需人工补充年报或财报链接。`;
  return removeAnnualReportDownloadPrompts({
    ...report,
    customerInsights: {
      ...(report.customerInsights || {}),
      metrics: [
        ...mergedExisting,
        ...missing.map((label) => ({
          label,
          value: hasAnnual ? "上传年报中待人工核对" : financeSources.length ? "已采集来源，待核验数值" : "未取得可读财务硬来源",
          note
        }))
      ]
    },
    financialSourceStatus: {
      stockCode,
      attempted: true,
      hardSourceCount: financeSources.length,
      hardSources: financeSources.slice(0, 8).map((source) => ({ title: source.title, url: source.url, domain: source.domain || "" })),
      missingMetrics: missing
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
  if (!["verified", "multi_source", "conflict"].includes(category.status)) return false;
  return /信用|法律|诉讼|失信|被执行|股权|控制权|财务|经营指标|融资|重大项目|补贴|客户名单/.test(
    `${category.label || ""} ${category.summary || ""} ${category.disposition || ""}`
  );
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
  if (weak > high + medium && weak >= 8) {
    return `公开证据以弱线索为主，高置信来源不足，主要风险是误判预算、真实痛点或决策链。`;
  }
  const missing = arr(report.missingTopics || report.qualityWarnings)
    .join("、")
    .replace(/\s+/g, " ");
  if (/经营规模|财务|营业收入|利润|现金流/.test(missing)) {
    return "预算能力和付款质量缺少财务硬指标支撑，需把营收、利润、现金流或采购预算作为会前核验重点。";
  }
  if (/数字化|AI|ERP|MES|PLM|QMS|APS/.test(missing)) {
    return "未看到足够数字化投入或既有系统线索，风险是客户已有供应商/集团IT边界导致切入空间被压缩。";
  }
  if (/痛点/.test(missing)) {
    return "痛点证据仍偏少，风险是交流停留在泛AI认知，难以形成明确预算、责任部门和试点场景。";
  }
  const ratingRisks = arr(report.opportunityRating?.riskFlags).filter(Boolean);
  if (ratingRisks.length) return ratingRisks.slice(0, 2).join("；");
  return "当前主要商机风险在于预算归属、决策链可达性、既有系统/供应商边界和付款质量尚未被公开信息充分证明。";
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
    : "公开财务数据仍需结合年报、工商和客户访谈继续核对。";
  const fallback = {
    "客户是谁": {
      title: "客户是谁",
      body: firstUseful(report.customerInsights?.localCards, `${report.standardName || report.companyName || "目标客户"}，需先确认本次拜访主体、工厂与集团关系。`),
      insight: "关键信息：先确认主体、区域、参会角色和是否为真实采购/试点对象。"
    },
    "客户卖什么": {
      title: "客户卖什么",
      body: firstUseful(report.customerInsights?.groupCards, "公开来源尚不足以稳定判断产品线，需要结合官网、展会、招聘和现场沟通补齐。"),
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
  const warnings = arr(report.qualityWarnings).slice(0, 2).join("；");
  const fallback = {
    "一句话判断": textFromCard(firstConclusion) || `${report.standardName || report.companyName || "该客户"}具备会前研究价值，但仍需把公开信息与现场输入分开。`,
    "优先切入": firstSolution.title ? `${firstSolution.title}：${firstSolution.why || firstSolution.how || "建议围绕客户可提供样例的场景推进。"}` : firstPain.aiEntry || "优先从公开证据最充分、与我方能力最匹配、现场最容易验证的场景切入。",
    "核心依据": firstUseful(report.customerInsights?.localCards) || firstUseful(report.customerInsights?.groupCards) || "当前依据来自已审计公开来源、用户上传年报和客户补充线索。",
    "主要风险": deriveOpportunityRisk(report),
    "下一步建议": arr(report.requirements?.onSite)[0] || arr(report.requirements?.preMeeting)[0] || "下一步先确认参会角色、业务线、TOP痛点、系统现状和可用样例。"
  };
  return CONCLUSION_TITLES.map((title) => {
    const source = byTitle.get(title);
    return {
      title,
      body: deriveConclusionBody(title, source ? textFromCard(source) : "", fallback[title]),
      sourceIds: source?.sourceIds || source?.sources || source?.evidenceSourceIds || firstConclusion.sourceIds || []
    };
  });
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
    match = compact.match(/归属于上市公司股东的净利润([-\d,，]+(?:\.\d{2})?)/) || compact.match(/归母净利润([-\d,，]+(?:\.\d{2})?)/);
    if (match?.[1]) return cny(match[1]);
  }
  if (/扣非|非经常性损益/.test(metricLabel)) {
    match = compact.match(/扣除非经常性损益的净利润([-\d,，]+(?:\.\d{2})?)/) || compact.match(/扣非净利润([-\d,，]+(?:\.\d{2})?)/);
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
    match = compact.match(new RegExp(`${escaped}[^\\d-]{0,20}([-\\d.]+%)`));
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
      note: fallbackTitle || item.title || item.label || "用户上传年报"
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

function derivedAnnualMetricMap(report = {}) {
  const contexts = annualContexts(report);
  const labels = ["营业收入", "归母净利润", "扣非净利润", "毛利率", "经营现金流", "研发投入", "员工数量"];
  const map = new Map();
  for (const label of labels) {
    for (const context of contexts) {
      const value = annualMetricValueFromContext(label, context.context);
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
  if (/归母|归属.*净利润/.test(label) && /比例|现金红利|派发|分红/.test(String(item.context || item.evidenceExcerpt || ""))) {
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
  return clip(String(value || "").replace(/\s+/g, " ").trim(), max);
}

function stripFieldPrefix(value, labels = []) {
  let text = compactText(value, 260);
  for (let i = 0; i < 2; i += 1) {
    const labelPattern = labels.length ? labels.join("|") : "风险|主要风险|优先切入|下一步动作|核心依据|一句话判断";
    text = text.replace(new RegExp(`^\\s*(?:${labelPattern})\\s*[：:：]\\s*`, "i"), "").trim();
  }
  return text;
}

function meaningful(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^(待确认|暂无|无|未获取|未取得|未在已读取公开来源中取得|公开来源不足|当前来源不足)/.test(text)) return false;
  if (/^(已采集来源，待核验数值|上传年报中待人工核对|未取得可读财务硬来源)$/.test(text)) return false;
  if (/信息置信度不足|企业信息不足|无法分析|隐藏低相关|重复或错误来源|资料有限|证据不足/.test(text)) return false;
  return true;
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
  return compactText(
    item.prerequisite ||
      item.assumption ||
      arr(item.validationSignals)[0] ||
      "需确认业务负责人、样例数据、现有系统边界和下一步动作。",
    150
  );
}

function buildQuestionnaire(report = {}) {
  const questions = [...arr(report.requirements?.onSite), ...arr(report.requirements?.preMeeting)]
    .map((item) => compactText(item, 170))
    .filter(meaningful);
  const buckets = [
    { title: "业务问题", match: /痛点|业务|目标|效率|成本|质量|交付|研发|工艺|销售|客户/ },
    { title: "IT与数据", match: /系统|数据|ERP|MES|PLM|QMS|接口|权限|部署|安全|样例/ },
    { title: "预算与决策", match: /预算|报价|付款|决策|采购|负责人|角色|下一步|POC|立项/ },
    { title: "风险与边界", match: /风险|边界|合规|不能|限制|信用|法务|集团|承诺|周期/ }
  ];
  return buckets
    .map((bucket) => ({
      title: bucket.title,
      questions: questions.filter((item) => bucket.match.test(item)).slice(0, 4)
    }))
    .filter((bucket) => bucket.questions.length);
}

function buildBattleRound(report = {}, type = "pre_visit", inputText = "", previousRating = null) {
  const rating = ratingOf(report);
  const conclusions = normalizeConclusions(report);
  const fit = report.opportunityFit || {};
  const pains = usefulItems(report.pains).slice(0, 6);
  const solutions = usefulItems(report.solutions).slice(0, 6);
  const customerSections = [
    { key: "local", title: "主体与股权/区域", items: usefulItems(report.customerInsights?.localCards) },
    { key: "market", title: "产品与客户", items: usefulItems(report.customerInsights?.groupCards) },
    { key: "finance", title: "财务与规模", items: usefulItems(report.customerInsights?.metrics) },
    { key: "digital", title: "数字化与AI线索", items: usefulItems(report.customerInsights?.digitalCards) },
    { key: "risk", title: "风险线索", items: usefulItems(report.sensitiveVerification?.categories).filter((item) => /verified|multi_source|conflict|unverified/.test(String(item.status || ""))) }
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
      ? arr(report.changeSummary)
      : ["已完成会前研判，建议带着方案假设和问题清单进入首次拜访。"];
  const changeSummary =
    type === "post_visit"
      ? Array.from(
          new Set(
            [
              ...roundChanges,
              previousRating && rating?.grade && previousRating.grade !== rating.grade ? `商机评级由 ${previousRating.grade} 调整为 ${rating.grade}。` : ""
            ].filter(Boolean)
          )
        ).slice(0, 8)
      : roundChanges;
  return {
    roundNo: 1,
    type,
    inputText: type === "post_visit" ? inputText : "",
    inputSummary: type === "post_visit" ? compactText(inputText, 260) : "首轮会前公开信息研判。",
    generatedAt: report.updatedAt || report.generatedAt || new Date().toISOString(),
    opportunityRating: rating,
    conclusions,
    customerInfo: customerSections,
    painsAndOpportunities: pains.map((item) => ({
      title: item.title || "痛点机会",
      customerSignal: item.sourceBasis || arr(item.facts)[0] || item.reasoning || "",
      pain: item.reasoning || item.body || item.insight || "",
      opportunity: item.aiEntry || item.opportunity || arr(fit.entryScenarios)[0] || "",
      toConfirm: arr(item.validationSignals || item.toConfirm),
      sourceIds: normalizeSourceIdList(item)
    })),
    solutionCards: solutions.map((item) => ({
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
    questionnaire: buildQuestionnaire(report),
    internalNotes: [
      ...arr(fit.noCommitments).map((item) => `不建议承诺：${item}`),
      ...arr(rating?.riskFlags).map((item) => `风险关注：${item}`)
    ].filter(isActionableInternalNote).slice(0, 10),
    sourceIds,
    changeSummary,
    roundDelta: type === "post_visit" ? report.roundDelta || null : null
  };
}

function isActionableInternalNote(value) {
  const text = cleanInternalNote(value);
  if (!meaningful(text)) return false;
  if (/信息缺口|信息不足|置信度|无法分析|来源不足|待确认|隐藏低相关|重复|错误来源/.test(text)) return false;
  return /不建议承诺|风险关注|付款|信用|法务|诉讼|被执行|回款|预算|决策|采购|集团|IT|数据|合规|边界|周期|免费|POC|供应商|既有系统/.test(text);
}

function cleanInternalNote(value) {
  return compactText(value, 240)
    .replace(/^(不建议承诺|风险关注|主要风险)[：:]\s*(?:\1[：:]?\s*)+/, "$1：")
    .replace(/^风险[：:]\s*风险[：:]\s*/, "风险：")
    .trim();
}

function normalizeExistingRound(report, round = {}, index = 0) {
  const feedback = round.type === "post_visit" ? feedbackSignalPack(round.inputText || round.inputSummary) : { hasActionable: false };
  const sourceFallback = feedback.hasActionable
    ? mergeByTitle(
        feedback.pains.map((item) => ({
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
    : arr(round.painsAndOpportunities);
  const rawSolutions = feedback.hasActionable ? mergeByTitle(feedback.solutions, round.solutionCards, 8) : arr(round.solutionCards);
  const solutionCards = rawSolutions.map((item, solutionIndex) => {
    const sourcePain = sourceFallback[solutionIndex] || {};
    const customerPain = compactText(item.customerPain || item.pain || item.sourceBasis || sourcePain.pain || item.why, 260);
    const introduction = solutionIntro(item);
    let value = compactText(item.value || item.solutionValue || item.why || item.how || item.body, 240);
    const expectedImpact = compactText(item.expectedImpact || item.impact || item.outcome, 220);
    if (sameText(value, customerPain)) value = compactText(item.body || item.how || item.expectedImpact, 220);
    return {
      ...item,
      priority: item.priority || `P${Math.min(solutionIndex + 1, 2)}`,
      customerPain,
      introduction,
      value,
      expectedImpact,
      prerequisite: solutionPrerequisite(item),
      sourceIds: normalizeSourceIdList(item)
    };
  });
  return {
    ...round,
    roundNo: Number(round.roundNo || index + 1),
    generatedAt: round.generatedAt || report.updatedAt || report.generatedAt || new Date().toISOString(),
    conclusions: (feedback.hasActionable ? mergeByTitle(feedback.conclusions, round.conclusions, 8) : arr(round.conclusions)).map((item) => ({
      ...item,
      body: stripFieldPrefix(item.body || item.summary || item.insight, [item.title, "风险", "主要风险", "优先切入", "下一步动作", "核心依据"]).trim()
    })),
    customerInfo: arr(round.customerInfo)
      .map((section) => ({
        ...section,
        items: usefulItems(section.items)
      }))
      .filter((section) => arr(section.items).length),
    painsAndOpportunities: usefulItems(sourceFallback),
    solutionCards: usefulItems(solutionCards),
    questionnaire: arr(round.questionnaire)
      .map((group) => ({ ...group, questions: arr(group.questions).map((item) => compactText(item, 180)).filter(meaningful) }))
      .filter((group) => arr(group.questions).length),
    internalNotes: (feedback.hasActionable ? mergeByTitle(feedback.internalNotes, round.internalNotes, 8) : arr(round.internalNotes))
      .map(cleanInternalNote)
      .filter(isActionableInternalNote)
      .slice(0, 8),
    sourceIds: Array.from(new Set(arr(round.sourceIds).map((item) => Number(item)).filter(Number.isFinite))).slice(0, 12),
    changeSummary: feedback.hasActionable ? mergeByTitle(feedback.changeSummary, round.changeSummary, 8) : arr(round.changeSummary),
    roundDelta: round.roundDelta || (feedback.hasActionable ? feedback : null)
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
  const normalized = sanitizeRequirements(report);
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
  const shaped = {
    ...fixedNormalized,
    annualReportEvidence,
    quickCards: normalizeQuickCards(fixedNormalized),
    conclusions: normalizeConclusions(fixedNormalized),
    customerInsights: {
      ...(fixedNormalized.customerInsights || {}),
      localCards: arr(fixedNormalized.customerInsights?.localCards),
      groupCards: arr(fixedNormalized.customerInsights?.groupCards),
      metrics: arr(fixedNormalized.customerInsights?.metrics),
      digitalCards: arr(fixedNormalized.customerInsights?.digitalCards)
    }
  };
  return ensureReportRounds(shaped);
}

async function analyzeTopic(company, topic, sources, onModelAttempt = async () => {}) {
  const topicSources = sources.filter((source) => source.topic === topic || source.query?.includes(topic));
  const pack = buildSourcePack(topicSources.length ? topicSources : sources, 12, 3200);
  if (!pack.length) {
    return { topic, facts: [], metrics: [], implications: [], painSignals: [], uncertainties: ["未读取到可校验来源，需重新检索或人工补充。"], sourceIds: [] };
  }
  const financeInstruction =
    topic === TOPIC_NAMES[1]
      ? `经营规模与财务主题强制要求：metrics 必须优先提取营业收入/净销售额、净利润或归母净利润、毛利率或经营利润率、经营现金流、资产负债率或总资产负债、研发投入、员工规模、客户集中度。若来源没有对应财务数据，保留该指标并写“未在已读取公开来源中取得”。`
      : "";
  const messages = [
    {
      role: "system",
      content: "你是售前客户研究分析师。只返回严格 JSON，不要 Markdown。所有判断必须基于给定来源；无法确认就写“系统未能公开证实，建议会前核对”。"
    },
    {
      role: "user",
      content: `请针对主题“${topic}”提取可用于商机判断的证据，写给一线会前准备使用，避免空话。${financeInstruction}
企业信息：${JSON.stringify(company, null, 2)}
敏感信息核验结果：${JSON.stringify(company.sensitiveVerification || {}, null, 2)}
来源：${JSON.stringify(pack, null, 2)}
敏感信息规则：涉及限制高消费、失信、被执行、诉讼、合同纠纷、回款困难、股权控制、融资、财务指标等内容时，只能使用敏感信息核验结果和直接来源。未证实线索只能写入 uncertainties，不能写成事实或风险结论。
返回 JSON：
{
  "topic": "${topic}",
  "facts": [{"claim":"可核验事实或第三方线索","sourceIds":[1,2],"confidence":"公开信息/第三方线索/合理推断/待确认"}],
  "metrics": [{"label":"指标","value":"数值或区间","sourceIds":[1],"note":"说明"}],
  "implications": [{"title":"关键信息","body":"这说明客户可能处于什么经营压力或机会中","sourceIds":[1]}],
  "painSignals": [{"title":"潜在痛点","basis":"依据","validationSignals":["现场可确认的指标口径"],"aiEntry":"AI切入方向","sourceIds":[1]}],
  "uncertainties": ["必须现场确认或会前补齐的信息"],
  "sourceIds": [1,2,3]
}`
    }
  ];
  try {
    const answer = await callModel(messages, {
      runtimeMode: company.runtimeMode,
      temperature: 0.1,
      maxTokens: 5000,
      timeoutMs: 240000,
      totalTimeoutMs: 260000,
      headerTimeoutMs: 30000,
      firstTokenTimeoutMs: 90000,
      streamIdleTimeoutMs: 45000,
      streamMaxMs: 240000,
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
  const qualityInstruction =
    quality.qualityLevel === "limited"
      ? "本次来源较少，仅生成有限资料版。所有结论必须写成会前参考或待确认判断；不得输出强结论。"
      : quality.qualityLevel === "brief"
        ? "本次来源达到简版报告门槛但不足正式报告门槛。所有未被来源支撑的内容放入待确认，不得写成确定事实。"
        : "本次来源达到正式报告门槛。仍需标注公开信息、第三方线索、合理推断与待确认边界。";

  return `请基于“我的企业信息”“分主题证据摘要”和“可校验来源清单”生成深度商机挖掘报告 JSON。报告给一线会前准备使用，核心是讲清楚：客户是谁、本地主体信息、经营压力、数字化/AI基础、潜在痛点、我方机会与前置要求。
质量约束：${qualityInstruction}
我的企业信息：${JSON.stringify(sellerProfile || {}, null, 2)}
敏感信息核验结果：${JSON.stringify(company.sensitiveVerification || {}, null, 2)}
硬性要求：
1. 语言直接、专业、可外发；不要出现内部保护、责任归因、渠道身份标签或先免费验证等不适合外发的表达。
2. 不把推断写成事实；使用“公开信息、第三方线索、合理推断、待确认”表达置信边界。
3. 经营痛点必须写依据来源，不能只写行业常识。
3a. sourceType 为“线索来源/弱线索来源/行业背景来源”或 confidence 为“低”的资料，只能用于线索提示和待确认问题；不得单独支撑确定性结论。
3b. 限制高消费、失信、被执行、诉讼、合同纠纷、回款困难、股权控制、融资、营收、利润、客户名单、重大项目、政府补贴等敏感/重要信息，必须以“敏感信息核验结果”为准。未证实或冲突的信息不得进入研究结论，只能写成“系统未能公开证实，建议会前核对”。
4. 研究结论必须是多卡片，不要大段文字。
5. 客户画像必须分成多框：主体与股权/区域、产品与客户、经营规模与财务、数字化与AI、组织与决策、潜在采购约束。
6. 不要生成 sources 字段。来源由系统用真实 URL 补入；但所有关键结论、画像卡片、财务指标、痛点和方案必须尽量带 sourceIds，用于在正文旁展示证据链接。
7. 用户输入的 AI 需求属于“用户提供线索”，优先用于调整切入方向和现场确认问题，但不得写成公开事实。
7a. 所有“切入点、方案建议、是否值得跟进”必须结合我的企业信息。不得默认我方一定是智用开物，也不得提出我方能力之外的重交付承诺。
7b. solutions 必须写成面向客户交流的完整方案包，不能直接复制 pains 的标题。只输出由实际证据、用户线索或我方能力匹配支撑的方案，通常 2-5 个；每个方案都要包含客户痛点、方案介绍、我方价值、预期成效和适用前提。
8. customerInsights.metrics 必须先呈现财务硬指标：营业收入/净销售额、净利润或归母净利润、毛利率或经营利润率、经营现金流、资产负债率或总资产负债、研发投入、员工规模、客户集中度。若来源没有对应数据，value 写“未在已读取公开来源中取得”。
9. 若企业信息包含 stockCode 或来源包含“财务硬来源”，必须优先使用财务硬来源抽取指标；不得笼统写“公开来源未采集到财务数据”，必须说明已查来源与缺失原因。
10. 若企业信息包含 annualReportEvidence，必须把它作为用户上传年报证据使用，优先级高于第三方网页；引用时写“用户上传年报”并保留页码或章节。
11. 若已包含 annualReportEvidence，requirements 里不得再写“下载/补充/获取最新年报”；只能写“核对年报第几页指标口径”或“确认业务口径”。
12. requirements 里不要要求一线“通过公开渠道查询 ERP/MES/PLM 供应商、工商、招聘、官网、B2B 平台”等本系统应检索的事项；如果公开检索没有结果，写成“现场确认”问题。
13. quickCards 必须严格返回 4 个对象，标题分别为：客户是谁、客户卖什么、有没有钱、先切哪里。
14. conclusions 必须严格返回 5 个对象，标题分别为：一句话判断、优先切入、核心依据、主要风险、下一步建议。
15. “主要风险”必须写商机风险：预算/付款/决策链/既有供应商/合规信用/集团IT边界/证据缺口/需求成熟度等；不要写“需求未确认、系统边界不清、数据授权不明确”这类通用句。
16. opportunityFit 必须返回“我方能力匹配”模块：能力契合点、可切入场景、不建议承诺事项、会前验证问题。若我的企业信息为空或过少，必须提示“我的企业信息不足”。

企业信息：${JSON.stringify(company, null, 2)}
用户已掌握的 AI 需求线索：${aiNeeds || "无"}
分主题证据摘要：${JSON.stringify(topicBriefs, null, 2)}
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
    "localCards": [{"title":"主体与股权/区域","facts":["依据"],"insight":"判断","toConfirm":["待确认"],"sourceIds":[1]}],
    "groupCards": [{"title":"产品与客户/集团与行业背景","facts":["依据"],"insight":"判断","toConfirm":["待确认"],"sourceIds":[2]}],
    "metrics": [{"label":"指标","value":"数值","note":"说明和来源口径","sourceIds":[3]}],
    "digitalCards": [{"title":"数字化与AI/组织与决策/潜在采购约束","facts":["依据"],"insight":"判断","toConfirm":["待确认"],"sourceIds":[4]}]
  },
  "opportunityFit": {"summary":"基于我的企业信息的匹配判断","fitPoints":["能力契合点"],"entryScenarios":["可切入场景"],"noCommitments":["不建议承诺事项"],"validationQuestions":["会前验证问题"]},
  "pains": [{"title":"经营痛点","sourceBasis":"具体来源和依据","reasoning":"痛点推导","validationSignals":["现场可确认的指标口径"],"aiEntry":"AI切入方向","sourceIds":[1,2]}],
  "solutions": [{"priority":"P1/P2/P0","title":"方案","customerPain":"客户痛点","introduction":"方案介绍","value":"方案价值","expectedImpact":"预期成效","prerequisite":"适用前提","why":"优先级理由","how":"做法","sourceIds":[1,2]}],
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
    : REQUIRED_FINANCIAL_METRICS.slice(0, 6).map((label) => ({ label, value: "待确认", note: "模型整合超时，需以已读取来源或现场信息核对。" }));
  const fallbackWarning = `报告整合模型未在时间预算内完成，系统已用分主题证据生成保底版：${error?.message || String(error)}`;
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
      localCards: [{ title: "主体与本地信息", facts: firstTexts(subject.facts), insight: "以已读来源为准，未证实内容进入待确认。", toConfirm: arr(subject.uncertainties), sourceIds: arr(subject.sourceIds).slice(0, 3) }],
      groupCards: [{ title: "产品与客户/市场", facts: firstTexts(market.facts), insight: firstTexts(market.implications, "body", 1)[0] || "市场和客户压力需继续核对。", toConfirm: arr(market.uncertainties), sourceIds: arr(market.sourceIds).slice(0, 3) }],
      metrics,
      digitalCards: [{ title: "数字化与AI", facts: firstTexts(digital.facts), insight: firstTexts(digital.implications, "body", 1)[0] || "数字化现状需现场确认。", toConfirm: arr(digital.uncertainties), sourceIds: arr(digital.sourceIds).slice(0, 3) }]
    },
    pains: arr(pain.painSignals).slice(0, 4).map((item) => ({
      title: item.title || "潜在痛点",
      sourceBasis: item.basis || "来自分主题证据整理。",
      reasoning: item.body || item.title || "需现场确认痛点强度。",
      validationSignals: item.validationSignals || ["确认业务场景、指标口径和数据可用性。"],
      aiEntry: item.aiEntry || "AI 切入方向待确认。",
      sourceIds: item.sourceIds || arr(pain.sourceIds).slice(0, 2)
    })),
    solutions: [
      { priority: "P1", title: "先做轻量场景确认", customerPain: "当前已形成线索但最终整合未完成，需避免直接重投入。", introduction: "以证据池和用户线索锁定一个可验证小场景。", value: "把交流从泛泛介绍收敛到可确认的客户问题和成功指标。", expectedImpact: "形成下一步是否进入方案、报价或POC的判断依据。", prerequisite: "确认业务目标、系统边界、数据样例和客户责任人。", why: "最终整合模型超时，先以证据池和用户线索锁定小场景。", how: "确认业务目标、系统边界、数据样例和成功指标后再进入方案。", sourceIds: sourcePack.slice(0, 2).map((item) => item.id) }
    ],
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
  const sourcePack = buildSourcePack(sources, 36, 2600);
  const topicBriefs = arr(options.checkpoint?.topicBriefs).slice(0, TOPIC_NAMES.length);
  const usedModels = uniqModelUsage([...(sources.usedModels || []), ...arr(options.checkpoint?.usedModels)]);
  const analysisLabels = ["企业画像", "财务指标", "市场与客户", "数字化与AI", "痛点机会"];
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
        maxTokens: 14000,
        timeoutMs: 300000,
        totalTimeoutMs: 330000,
        headerTimeoutMs: 30000,
        firstTokenTimeoutMs: 90000,
        streamIdleTimeoutMs: 45000,
        streamMaxMs: 300000,
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
      sources: normalizeReportSources(sources, 32).map(({ text, readable, ...source }, index) => ({
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
    sources: normalizeReportSources(sources, 32).map(({ text, readable, ...source }, index) => ({
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
    insight: "该信息来自会前补充，不作为公开事实；可用于调整现场探问重点和方案优先级。",
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

function feedbackSignalPack(input = "") {
  const text = String(input || "").trim();
  const signals = [];
  const hasCrossSystem = /多系统|跨系统|导入|导出|查数|改表|核对|录入|流转|ERP|财务结算|订单系统|制造管理|供应商管理|K3|捷客云|写客云/.test(text);
  const hasReconciliation = /对账|开票|供应商|发票|结算|付款|应付|财务/.test(text);
  const hasPlanning = /排产员|订购员|排产|订购|订单|计划|生产计划|插单|缺料|换线/.test(text);
  const hasLowValueWork = /低增值|重复操作|人工|办公室人员|来回|大量|工作量|效率/.test(text);

  if (hasCrossSystem) signals.push("跨系统数据采集、核对与流转");
  if (hasReconciliation) signals.push("供应商自动对账与开票");
  if (hasPlanning) signals.push("排产/订购/计划类岗位重复操作");
  if (hasLowValueWork) signals.push("办公室低增值重复操作减负");

  if (!signals.length) {
    return {
      hasActionable: false,
      summary: compactText(text, 220),
      changeSummary: ["已记录拜访反馈，但本轮信息尚不足以改变评级、方案或痛点优先级。"],
      updatedSections: ["拜访反馈"]
    };
  }

  const sourceBasis = `用户提供线索：${signals.join("、")}。该信息来自拜访反馈，需现场核对系统名称、数据口径、责任岗位和当前处理量。`;
  const conclusions = [
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
      body: `拜访反馈明确出现${signals.join("、")}，说明客户已有可验证的岗位级流程痛点。`,
      sourceIds: []
    }
  ];

  const pains = [
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
          aiEntry: "供应商对账智能体：自动读取对账单与系统数据，生成差异解释、待确认清单和开票辅助材料。"
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

  const solutions = [
    hasReconciliation
      ? {
          priority: "P1",
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
          priority: hasReconciliation ? "P2" : "P1",
          title: "跨系统数据核对与流转智能体",
          customerPain: "订单、制造、供应商、ERP/财务等系统之间存在大量查数、导数、改表、核对和录入工作。",
          introduction: "把一个岗位的固定流程拆成输入、规则、判断、输出四段，用智能体辅助完成数据读取、规则判断和结果生成。",
          value: "把低增值重复操作转为可审计的半自动流程，释放岗位时间，并降低人工错漏。",
          expectedImpact: "先以一个高频流程验证：人工耗时下降、异常处理更清楚、输出物更规范。",
          prerequisite: "需确认系统导出权限、数据字段、流程规则、异常边界和人工确认点。"
        }
      : null,
    hasPlanning
      ? {
          priority: "P3",
          title: "计划与订购辅助决策助手",
          customerPain: "排产员、订购员需要反复查订单、库存、供应商与生产信息，规则判断依赖经验。",
          introduction: "先不做完整排产系统，先做缺料、插单、交付影响和订购建议的辅助分析。",
          value: "降低计划岗位的查数和初判负担，让异常影响更快暴露。",
          expectedImpact: "缩短计划准备时间，提高异常响应速度，保留人工最终决策权。",
          prerequisite: "需确认订单、库存、BOM、供应商交期和生产约束是否可导出。"
        }
      : null
  ].filter(Boolean);

  const requirements = {
    preMeeting: [
      "请客户提供一个最典型的跨系统流程样例：涉及哪些系统、谁操作、输入是什么、输出是什么。",
      "请客户列出当前人工核对规则：哪些字段必须一致，哪些差异允许人工判断。",
      hasReconciliation ? "供应商对账场景需提供脱敏对账单、系统导出字段、开票前复核流程和异常处理样例。" : "",
      hasPlanning ? "计划/订购场景需提供订单、库存、供应商交期、生产约束和人工调整规则样例。" : ""
    ].filter(Boolean),
    onSite: [
      "这个流程现在每周/每月处理多少单，涉及几个人，每次平均耗时多久？",
      "异常差异通常有哪些类型，最终由谁确认、谁承担责任？",
      "哪些系统允许导出数据，哪些系统只能人工查询，是否允许脱敏样例验证？",
      "客户希望先减少人工耗时、降低错漏、提升复核透明度，还是支撑后续系统集成？"
    ]
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
      "不建议承诺直接替代人工审批或财务最终判断，应定位为辅助核对、异常解释和复核留痕。",
      "不建议一开始承诺打通所有系统，先从可导出的样例数据和单一流程验证。",
      "涉及财务、供应商和开票数据时，需先明确数据脱敏、权限、日志留痕和责任边界。"
    ],
    keywords: ["跨系统流程", "数据核对", "供应商对账", "开票辅助", "流程智能体", "异常解释", "人工复核"],
    changeSummary: [
      `本轮新增强线索：${signals.join("、")}。`,
      "已将优先切入从泛AI/知识库调整为流程智能体与数据核对自动化。",
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
      content: "你是售前客户研究与解决方案顾问。只返回严格 JSON，不要 Markdown。用户补充内容必须标为“用户提供线索”或“待确认”，不得伪装成公开事实。"
    },
    {
      role: "user",
      content: `请基于当前商机报告和用户补充信息，完善报告结构。用于一线会前准备，语言直接、专业、可外发。
硬性要求：
1. 不要新增或编造来源，不要生成 sources 字段。
2. 必须返回 changeSummary、updatedSections、userSupplementInsights。
3. 用户补充信息必须影响至少一个结论、一个痛点/方案或一个前置问题。
4. 如果补充信息涉及 DFM/可制造性/研发/工艺评审，必须新增或强化“研发 DFM 知识助手/可制造性评审/工艺知识复用”相关内容。
5. 保持原有 JSON 字段结构。
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
  return report.opportunityRating || buildOpportunityRating(report);
}

function ratingClass(rating) {
  if (rating.status !== "rated") return "rating-not-rated";
  return `rating-${String(rating.grade || "D").toLowerCase()}`;
}

function ratingTitle(rating) {
  if (rating.status !== "rated") return "暂不评级";
  return `${rating.grade || "-"}级｜${rating.priorityLevel || rating.label}｜${rating.score}分｜置信度${rating.confidenceLabel || "-"}(${rating.confidenceScore ?? "-"}分)`;
}

function usefulRatingEvidence(items = []) {
  return arr(items)
    .map((item) => compactText(item, 180))
    .filter(meaningful)
    .filter((item) => !/资料中出现|可读来源|主题覆盖|初访判断门槛|系统已检索信用\/法律风险方向|报告已识别可能相关|资料显示客户具备一定信息化|已绑定我的企业|目标客户线索与我的企业存在关键词重合|报告形成了\s*\d+\s*个|来源质量提醒/.test(item))
    .slice(0, 3);
}

function ratingPanel(report) {
  const rating = ratingOf(report);
  const basis = rating.modelBasis || "OAC 初访优先级模型参考 BANT、MEDDICC 和售前交付可行性评估，用于判断初次拜访前是否值得投入售前资源。";
  const method = rating.scoringMethod || "评分采用加权评分、关键短板封顶、风险闸门和置信度分离；待确认信息主要降低置信度并进入拜访问卷。";
  const minimum = rating.minimumDimension?.title ? `${rating.minimumDimension.title} ${rating.minimumDimension.score}分` : "";
  const unknownNote = Number(rating.unknownDimensionCount || 0) > 0 ? ` 另有 ${Number(rating.unknownDimensionCount)} 项因公开资料不足标记为未知，不按低分处理。` : "";
  const modelNote =
    rating.status === "rated"
      ? `<div class="rating-model-note">
          <article><b>模型依据</b><p>${e(basis)}</p></article>
          <article><b>计分方式</b><p>${e(method)}${minimum ? ` 当前短板：${e(minimum)}。` : ""}${e(unknownNote)}</p></article>
        </div>`
      : "";
  const riskGate = rating.riskGate
    ? `<div class="risk-gate">
        <b>风险闸门</b>
        <p>${e(rating.riskGate.summary || "存在需要优先核验的风险线索。")}</p>
        ${arr(rating.riskGate.reasons).length ? `<ul>${arr(rating.riskGate.reasons).map((item) => `<li>${e(item)}</li>`).join("")}</ul>` : ""}
      </div>`
    : "";
  const guidance =
    rating.status === "rated"
      ? `<div class="rating-guidance">
          <article>
            <b>售前投入建议</b>
            <p>${e(rating.presalesAdvice || rating.nextAction || "先确认客户真实需求和下一步动作。")}</p>
          </article>
          <article>
            <b>下一步成立条件</b>
            <ul>${arr(rating.qualificationConditions).map((item) => `<li>${e(item)}</li>`).join("") || "<li>确认客户主体、参会角色、业务场景和数据边界。</li>"}</ul>
          </article>
          <article>
            <b>暂缓/降级信号</b>
            <ul>${arr(rating.disqualificationSignals).map((item) => `<li>${e(item)}</li>`).join("") || "<li>没有明确业务场景、推进人或下一步动作。</li>"}</ul>
          </article>
          <article>
            <b>资源边界</b>
            <p>${e(rating.resourceBoundary || "定制方案、报价和POC范围需在关键输入确认后再进入。")}</p>
          </article>
        </div>`
      : "";
  const details =
    rating.status === "rated"
      ? `<div class="rating-detail">
          ${modelNote}
          <div class="rating-dim-grid">
            ${arr(rating.dimensions)
              .map((item) => {
                const evidence = usefulRatingEvidence(item.evidence);
                const deductions = usefulRatingEvidence(item.deductions);
                return `<article class="rating-dim ${item.status === "unknown" ? "rating-dim-unknown" : ""}">
                  <div class="rating-dim-head"><b>${e(item.title)}</b><strong>${e(item.displayScore || `${item.score}分`)}</strong></div>
                  ${item.status === "unknown" ? "" : `<div class="rating-bar"><i style="width:${Math.max(0, Math.min(Number(item.score) || 0, 100))}%"></i></div>`}
                  <p><b>结论</b>${e(item.conclusion || "当前证据不足，需结合拜访信息复核。")}</p>
                  ${item.status === "unknown" ? `<p><b>未知原因</b>${e(item.unknownReason || "公开资料不足，初访前不作好坏判断。")}</p>` : ""}
                  ${evidence.length ? `<p><b>论据</b>${e(evidence.join("；"))}</p>` : ""}
                  ${deductions.length ? `<p><b>关键短板</b>${e(deductions.join("；"))}</p>` : ""}
                </article>`;
              })
              .join("")}
          </div>
          ${arr(rating.riskFlags).length ? `<div class="risk-tags">${arr(rating.riskFlags).map((item) => `<span>${e(item)}</span>`).join("")}</div>` : ""}
          ${riskGate}
          ${guidance}
        </div>`
      : `<div class="rating-detail"><p>${e(rating.notRatedReason || "公开信息不足，暂不评级。")}</p></div>`;
  return `<section class="rating-section"><details class="rating-card ${e(ratingClass(rating))}">
    <summary>
      <div class="rating-score">
        ${icon(rating.status === "rated" ? "Trophy" : "CircleAlert")}
        <b>${e(ratingTitle(rating))}</b>
        <span>${e(rating.summary || rating.notRatedReason || "公开信息不足")}</span>
      </div>
      <div class="rating-toggle">${icon("ChevronDown")}查看评估理由</div>
    </summary>
    ${details}
  </details></section>`;
}

function qualityBanner(report) {
  const warnings = formatQualityWarnings(report.qualityWarnings || []);
  const title =
    report.qualityLevel === "diagnostic"
      ? "证据不足，仅生成检索诊断"
      : report.qualityLevel === "limited"
        ? "资料有限，仅供会前参考"
        : report.qualityLevel === "brief"
          ? "来源偏少，建议谨慎使用"
          : "来源达到正式报告门槛";
  return `<div class="quality-banner quality-${e(report.qualityLevel || "formal")}">
    <b>${e(title)}</b>
    <span>质量：${e(report.qualityLabel || "正式报告")}｜来源 ${e(sourceDisplay(report))}｜可读来源 ${e(report.readableSourceCount ?? 0)} 条｜主题覆盖 ${e(report.topicCoverageCount ?? 0)} 类</span>
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
      insight: "用于把交流从泛泛介绍收敛到可验证场景。"
    },
    {
      title: "不建议承诺",
      facts: arr(fit.noCommitments).length ? fit.noCommitments : arr(profile.noCommitments),
      insight: "避免在需求、数据和交付边界不清时过度承诺。"
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
  const first = cards.find((item) => meaningful(item.body || item.summary || item.insight));
  return compactText(first?.body || first?.summary || first?.insight || fallback, 180);
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
  const risk = stripFieldPrefix(conclusionByTitle(round, [/风险|注意/], deriveOpportunityRisk(report)), ["风险", "主要风险", "商机风险"]);
  const next = stripFieldPrefix(conclusionByTitle(round, [/下一步|动作|建议/], rating.nextAction || rating.presalesAdvice || "先确认参会角色、真实痛点、预算归属和可验证样例。"), ["下一步", "下一步动作", "建议"]);
  const reason = stripFieldPrefix(conclusionByTitle(round, [/依据|理由|核心/], arr(round.painsAndOpportunities)[0]?.pain || "基于公开证据、客户画像和我方能力匹配度形成初步判断。"), ["核心依据", "依据", "理由"]);
  return { oneLine, entry, risk, next, reason, rating: shortRatingText(report) };
}

function executiveBriefSection(report, round, sources) {
  const brief = buildExecutiveBrief(report, round);
  const rating = ratingOf(report);
  const sourceIds = Array.from(new Set(arr(round.sourceIds))).slice(0, 5);
  return `<section class="executive-brief">
    <div class="brief-main">
      <span class="brief-label">核心依据</span>
      <h2>${e(brief.reason)}</h2>
      <p>下面内容按“客户信息 → 痛点机会 → 我方方案 → 拜访问卷 → 内部注意事项”展开。</p>
      ${sourceIds.length ? evidenceLinks({ sourceIds }, sources) : ""}
    </div>
    <div class="brief-side">
      <article><span>商机优先级</span><b>${e(brief.rating)}</b><small>${e(rating.summary || rating.nextAction || "用于判断售前资源投入强度。")}</small></article>
      <article><span>优先切入</span><b>${e(brief.entry)}</b></article>
      <article class="risk"><span>主要商机风险</span><b>${e(brief.risk)}</b></article>
      <article class="next"><span>下一步动作</span><b>${e(brief.next)}</b></article>
    </div>
  </section>`;
}

function roundTabs(report) {
  const rounds = arr(report.rounds);
  if (rounds.length <= 1) return "";
  return `<section class="round-switch"><details><summary>历史轮次与拜访反馈</summary><div class="round-tabs" role="tablist">${rounds
    .map((round) => `<button class="${Number(round.roundNo) === Number(report.activeRoundNo) ? "active" : ""}" type="button" data-round-target="round-${e(round.roundNo)}">第 ${e(round.roundNo)} 轮｜${round.type === "post_visit" ? "拜访反馈" : "会前研判"}</button>`)
    .join("")}</div><div class="round-history-list">${rounds.map((round) => roundFeedbackInline(round)).join("")}</div></details></section>`;
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
  const summary = meaningful(round.inputSummary) ? round.inputSummary : "";
  const changes = arr(round.changeSummary).filter(meaningful).slice(0, 3);
  if (!summary && !changes.length) return "";
  return `<section class="round-feedback-inline">
    <div>
      <span>本轮拜访反馈</span>
      ${summary ? `<p>${e(summary)}</p>` : ""}
      ${changes.length ? `<small>${e(changes.join("；"))}</small>` : ""}
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
  return /决策|采购|预算|立项|招标|中标|合同|法定代表人|董事长|总经理|实际控制人|负责人|股东|控股|集团|总部|IT负责人|信息化|数字化负责人/.test(
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
  return /法定代表人|董事长|总经理|实际控制人|执行董事|董事|监事|经理|负责人|股东|控股|母公司|子公司|总部|采购|招标|中标|合同|立项|预算|投资|付款|回款/.test(
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
    const previous = people.get(key) || { name, role, sourceIds: [], insight: "" };
    previous.sourceIds = Array.from(new Set([...previous.sourceIds, sid])).slice(0, 4);
    const around = compactText(text, 180);
    if (!previous.insight && /履历|曾任|毕业|采访|表示|认为|提出|强调|致辞|公开/.test(around)) {
      previous.insight = around;
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

function usefulDecisionPeople(people = []) {
  return arr(people)
    .filter((person) => {
      const role = String(person.role || "");
      const insight = String(person.insight || "");
      const sourceCount = arr(person.sourceIds).length;
      if (/法定代表人|董事长|总经理|实际控制人|执行董事|负责人|信息化|数字化|IT|采购|财务/.test(role)) return true;
      if (/公开表态|采访|表示|提出|强调|履历|曾任|负责|分管|主导|牵头/.test(insight)) return true;
      return sourceCount >= 2 && !/高管|股东|监事/.test(role);
    })
    .slice(0, 5);
}

function decisionSurfaceSection(report, round, sources = []) {
  const people = usefulDecisionPeople(extractDecisionPeople(sources));
  const sourceSignals = arr(sources)
    .map((source, index) => ({ source, index, text: sourceText(source) }))
    .filter((row) => isConcreteDecisionSignal(row.text))
    .slice(0, 8);
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
  const budgetHints = sourceSignals
    .filter((row) => /预算|采购|招标|中标|合同|立项|项目|付款|回款|投资/.test(row.text))
    .map((row) => compactText(row.text, 150))
    .filter((item) => meaningful(item) && isConcreteBudgetSignal(item))
    .slice(0, 3);
  if (!people.length) return "";
  return `<section class="battle-section decision-section">
    <h2>客户决策链</h2>
    <div class="decision-grid">
      ${people.length ? `<article class="decision-card"><h3>可查到的人与角色</h3>${people
        .map((person) => `<div class="decision-person"><b>${e(person.name)}</b><span>${e(person.role)}</span>${evidenceLinks({ sourceIds: person.sourceIds }, sources)}${person.insight ? `<p>${e(person.insight)}</p>` : ""}</div>`)
        .join("")}<small>仅展示公开来源可见角色；是否参与本次项目仍需会前确认。</small></article>` : ""}
      ${budgetHints.length ? `<article class="decision-card"><h3>预算能力/采购线索</h3>${list(budgetHints)}<small>这里判断预算能力或采购路径，不等同于已确认项目预算或预算归属。</small></article>` : ""}
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
          : arr(section.items)
    }))
    .filter((section) => arr(section.items).length);
  if (!sections.length) return "";
  return `<section class="battle-section">
    <h2>客户信息</h2>
    <div class="info-section-grid">
      ${sections
        .map((section) => `<article class="info-block"><h3>${e(section.title)}</h3>${arr(section.items)
          .slice(0, section.key === "finance" ? 8 : 4)
          .map((item) => {
            if (section.key === "finance") {
              return `<div class="info-metric"><b>${e(item.label || item.title || "指标")}</b><strong>${e(displayMetricValue(item))}</strong>${evidenceLinks(item, sources)}${meaningful(item.note) ? `<span>${e(item.note)}</span>` : ""}</div>`;
            }
            return `<div class="info-line"><b>${e(item.title || item.label || "信息")}</b>${evidenceLinks(item, sources)}<p>${e(compactText(item.body || item.insight || arr(item.facts)[0] || item.summary, 220))}</p></div>`;
          })
          .join("")}</article>`)
        .join("")}
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

function actionGuideSection(report, round) {
  const brief = buildExecutiveBrief(report, round);
  const questions = arr(round.questionnaire).flatMap((group) => arr(group.questions)).slice(0, 4);
  const notes = arr(round.internalNotes).filter(meaningful).slice(0, 3);
  const solutions = arr(round.solutionCards);
  const actions = [
    {
      title: "先把话题带到这里",
      body: brief.entry || solutions[0]?.title || "先从最容易验证价值的小场景切入。",
      tone: "focus"
    },
    {
      title: "现场必须问清",
      body: questions.length ? questions.join("；") : "确认参会角色、当前痛点、预算归属、数据边界和下一步决策机制。",
      tone: "ask"
    },
    {
      title: "暂时不要承诺",
      body: notes.length ? notes.join("；") : brief.risk || "需求、数据和交付边界未清楚前，不承诺重交付范围、周期和免费验证。",
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
        const prerequisite = field(item, ["prerequisite", "precondition", "condition"], "需在现场确认业务场景、数据边界、责任人和预算窗口。");
        return `<article class="battle-solution"><div class="solution-head"><span class="tag">${e(item.priority || `S${index + 1}`)}</span><h3>${e(item.title)}</h3></div>${evidenceLinks(item, sources)}
          <div class="label">客户痛点</div><p>${e(customerPain || "本轮资料未形成足够明确的痛点，建议现场先验证。")}</p>
          <div class="label">方案介绍</div><p>${e(intro || "围绕已识别问题设计轻量验证场景。")}</p>
          <div class="label">方案价值</div><p>${e(value || "把交流从泛泛介绍收敛到可验证的业务价值。")}</p>
          <div class="label">预期成效</div><p>${e(impact || "成效需结合客户现场指标、样例数据和推进目标进一步量化。")}</p>
          <div class="label">适用前提</div><p>${e(prerequisite)}</p>
          ${meaningful(body) ? `<small>${e(body)}</small>` : ""}
        </article>`;
      }).join("")}
      </div>
    </details>
  </section>`;
}

function questionnaireSection(round) {
  const groups = arr(round.questionnaire).filter((group) => arr(group.questions).length);
  if (!groups.length) return "";
  return `<section class="battle-section">
    <h2>拜访问卷</h2>
    <div class="question-grid">${groups.map((group) => `<article class="question-card"><h3>${e(group.title)}</h3>${list(group.questions)}</article>`).join("")}</div>
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
    ${ratingPanel(report)}
    ${rounds.map((round) => `<div class="round-panel ${Number(round.roundNo) === activeNo ? "active" : ""}" data-round-panel="round-${e(round.roundNo)}">
      ${customerInfoSections(round, sources)}
      ${decisionSurfaceSection(report, round, sources)}
      ${painsAndOpportunitySection(round, sources)}
      ${actionGuideSection(report, round)}
      ${solutionBattleSection(round, sources)}
      ${questionnaireSection(round)}
      ${internalNotesSection(round)}
    </div>`).join("")}
    ${roundTabs(report)}`;
}

function evidenceBackstageSection(report) {
  const pool = report.evidencePool || buildEvidencePool(report.sources || []);
  const high = Number(pool.highConfidenceCount || 0);
  const medium = Number(pool.mediumConfidenceCount || 0);
  const weak = Number(pool.weakClueCount || 0);
  return `<section class="backstage-section">
    <details>
      <summary>资料来源</summary>
      <div class="backstage-stack">
        <div class="source-summary-card">
          <b>本报告引用 ${e(sourceDisplay(report))}</b>
          <span>高置信 ${e(high)} 条｜中置信 ${e(medium)} 条｜弱线索 ${e(weak)} 条。正文结论优先使用高/中置信来源，弱线索只用于待核验问题。</span>
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
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(report.standardName)}｜商机参谋团 OAC 作战简报</title>
<style>
:root{--ink:#17212b;--muted:#5e6975;--line:#d8e0e7;--paper:#f6f8fa;--teal:#007c82;--blue:#215f9c;--green:#5f7f35;--warn:#9a5b00;--danger:#b63f35}
*{box-sizing:border-box}body{margin:0;background:#eef3f6;color:var(--ink);font-family:"Microsoft YaHei","Alibaba PuHuiTi","Noto Sans SC",Arial,sans-serif;font-size:15px;line-height:1.66}
a{color:var(--blue);text-decoration:none;border-bottom:1px solid rgba(33,95,156,.25)}.icon{width:18px;height:18px;vertical-align:-3px}.page{max-width:1120px;margin:0 auto;background:#fff;box-shadow:0 18px 50px rgba(23,33,43,.12)}
.hero{padding:42px 48px 34px;color:#fff;background:linear-gradient(135deg,#17212b 0%,#214653 62%,#f5f7fa 62%)}.kicker{display:inline-flex;padding:6px 12px;border:1px solid rgba(255,255,255,.35);border-radius:999px;color:#dfecef;font-size:13px;font-weight:700}
h1{max-width:820px;margin:22px 0 12px;font-size:35px;line-height:1.18}.hero>p{max-width:760px;margin:0;color:#e6eef1;font-size:16px}.quick{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:28px}.quick div{min-height:132px;padding:14px;border-radius:8px;background:rgba(255,255,255,.94);color:var(--ink)}.quick b{display:block;margin-bottom:6px;color:var(--teal);font-size:16px}.quick span{display:block;color:var(--muted);font-size:13px;line-height:1.45;margin-top:6px}
section{padding:30px 48px 10px}h2{margin:0 0 14px;padding-bottom:8px;border-bottom:2px solid var(--line);font-size:23px;line-height:1.25}h3{margin:0 0 8px;color:var(--blue);font-size:16px}.page>section>h3{margin:30px 0 12px}.page>section>h2+h3{margin-top:6px}.lead,.muted{margin:0 0 16px;color:var(--muted)}
.quality-banner{margin:22px 48px 0;border:1px solid var(--line);border-radius:8px;padding:13px 16px;background:#fbfcfd}.quality-banner b{display:block;margin-bottom:3px}.quality-banner span{display:block;color:var(--muted);font-size:13px}.quality-banner ul{margin-top:8px}.quality-formal{border-left:5px solid var(--teal)}.quality-brief{border-left:5px solid var(--warn);background:#fff9ef}.quality-limited{border-left:5px solid #c76b19;background:#fff7ed}.quality-diagnostic{border-left:5px solid var(--danger);background:#fff4f2}
.annual-panel{margin:22px 48px 0;border:1px solid var(--line);border-radius:10px;padding:0 18px 8px;background:linear-gradient(180deg,#fbfdfd 0%,#fff 100%)}.annual-panel summary{display:flex;justify-content:space-between;gap:16px;align-items:center;cursor:pointer;padding:16px 0 12px}.annual-panel summary h2{margin:0}.annual-panel summary span{color:var(--muted);font-size:13px}.annual-summary{display:flex;justify-content:space-between;gap:18px;align-items:start;margin-bottom:12px}.annual-summary b{display:block;color:var(--teal);font-size:16px}.annual-summary span,.annual-summary p,.annual-panel small{color:var(--muted);font-size:13px}.annual-summary p{margin:0;max-width:380px}
.rating-section{padding-top:10px}.rating-card{width:100%;margin:0;border:1px solid var(--line);border-radius:10px;background:#fbfcfd;overflow:hidden}.rating-card summary{display:flex;justify-content:space-between;gap:16px;align-items:center;cursor:pointer;list-style:none;padding:16px 18px}.rating-card summary::-webkit-details-marker{display:none}.rating-score{display:grid;grid-template-columns:22px auto;gap:2px 10px;align-items:center}.rating-score .icon{grid-row:1 / span 2;color:var(--teal);margin-top:2px}.rating-score b{font-size:18px}.rating-score span{grid-column:2;color:var(--muted);font-size:13px}.rating-toggle{display:inline-flex;align-items:center;gap:6px;color:var(--muted);font-size:13px;font-weight:800;white-space:nowrap}.rating-card[open] .rating-toggle .icon{transform:rotate(180deg)}.rating-detail{border-top:1px solid var(--line);padding:16px 18px 18px}.rating-model-note{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:12px}.rating-model-note article{border:1px solid var(--line);border-radius:8px;background:#fff;padding:12px}.rating-model-note b{display:block;color:var(--blue);margin-bottom:5px}.rating-model-note p{margin:0;color:var(--muted);font-size:13px;line-height:1.55}.rating-dim-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.rating-dim{border:1px solid var(--line);border-radius:8px;background:#fff;padding:12px}.rating-dim-head{display:flex;justify-content:space-between;gap:12px}.rating-dim-head strong{color:var(--teal)}.rating-bar{height:6px;margin:8px 0 10px;border-radius:999px;background:#e5ecef;overflow:hidden}.rating-bar i{display:block;height:100%;border-radius:999px;background:var(--teal)}.rating-dim p{margin:7px 0 0;color:var(--muted);font-size:12px;line-height:1.5}.rating-dim p b{display:inline-block;color:var(--ink);margin-right:6px}.rating-dim-unknown{background:#f8fafc!important}.rating-dim-unknown .rating-dim-head strong{color:#8a96a3!important}.risk-tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.risk-tags span{border-radius:999px;padding:4px 9px;background:#fff4f2;color:var(--danger);font-size:12px;font-weight:800}.risk-gate{margin-top:12px;border:1px solid #f0c8c3;border-radius:8px;background:#fff7f5;padding:12px}.risk-gate b{display:block;color:var(--danger);margin-bottom:4px}.risk-gate p{margin:0;color:var(--ink);font-size:13px}.risk-gate ul{margin-top:6px}.rating-guidance{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:14px}.rating-guidance article{border:1px solid var(--line);border-radius:8px;background:#fff;padding:12px}.rating-guidance b{display:block;color:var(--teal);margin-bottom:6px}.rating-guidance p,.rating-guidance ul{margin:0;color:var(--ink);font-size:13px;line-height:1.55}.rating-guidance ul{padding-left:18px}.rating-guidance li+li{margin-top:4px}.rating-a{border-left:5px solid #16885f}.rating-b{border-left:5px solid #216fa2}.rating-c{border-left:5px solid #b36b00;background:#fff9ef}.rating-d,.rating-not-rated{border-left:5px solid #8a96a3;background:#f7f9fb}
.verification-card{border:1px solid var(--line);border-radius:8px;background:#fbfcfd;padding:15px 16px}.verification-head{display:flex;justify-content:space-between;gap:12px;align-items:start}.verification-head span{border-radius:999px;padding:3px 9px;background:#eef7f7;color:var(--teal);font-size:12px;font-weight:800;white-space:nowrap}.verification-verified .verification-head span{background:#e9f7ef;color:#16885f}.verification-multi_source .verification-head span{background:#eef5fb;color:var(--blue)}.verification-conflict .verification-head span,.verification-unverified .verification-head span{background:#fff4f2;color:var(--danger)}.verification-card p{margin:0 0 10px}.verification-evidence{display:grid;gap:7px}.verification-evidence a{display:block;border:1px solid var(--line);border-radius:7px;background:#fff;padding:8px 10px}.verification-evidence small,.verification-evidence em{display:block;color:var(--muted);font-size:12px}.verification-evidence em{margin-top:4px;font-style:normal}.verification-queries{margin-top:10px}.verification-queries summary{cursor:pointer;color:var(--blue);font-weight:800}.verification-details{margin-top:12px;border:1px solid var(--line);border-radius:8px;background:#fbfcfd;padding:12px 14px}.verification-details summary{cursor:pointer;color:var(--blue);font-weight:800}.verification-details .grid{margin-top:12px}.risk-card{border-left:5px solid var(--warn);background:#fffdf7}.risk-card small{display:block;margin-top:8px;color:var(--muted);line-height:1.45}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.grid.two{grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}.grid.two>*:only-child{grid-column:1/-1}.battle-cover{padding:40px 48px 34px;background:linear-gradient(135deg,#0f1c26 0%,#183946 58%,#eaf7f7 58%)}.cover-meta{display:flex;gap:10px;align-items:center;flex-wrap:wrap;color:#dfecef;font-size:13px}.battle-cover h1{max-width:880px;margin:18px 0 12px;font-size:34px;line-height:1.18}.battle-cover p{max-width:860px;color:#e9f2f3}.cover-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}.cover-actions span{max-width:430px;border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:7px 12px;background:rgba(255,255,255,.12);color:#fff;font-weight:800}.cover-actions .risk{background:rgba(154,91,0,.18);border-color:rgba(255,218,150,.38)}.executive-brief{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(320px,.75fr);gap:18px;padding-top:26px}.brief-main{border:1px solid #b7dddd;border-radius:12px;background:linear-gradient(180deg,#f0fbfa 0%,#fff 100%);padding:22px}.brief-label{display:inline-flex;border-radius:999px;background:#dff4f1;color:var(--teal);padding:4px 10px;font-size:12px;font-weight:900}.brief-main h2{border:0;padding:0;margin:12px 0 8px;font-size:28px;color:#0f2f35}.brief-main p{margin:0;color:#334150}.brief-side{display:grid;grid-template-columns:1fr;gap:10px}.brief-side article{border:1px solid var(--line);border-radius:10px;background:#fff;padding:13px 14px}.brief-side span{display:block;color:var(--muted);font-size:12px;font-weight:900;margin-bottom:4px}.brief-side b{display:block;color:#132231;line-height:1.45}.brief-side small{display:block;color:var(--muted);margin-top:5px;line-height:1.45}.brief-side .risk{border-color:#ead7aa;background:#fffaf2}.brief-side .next{border-color:#b7dddd;background:#f3fbfa}.battle-hero-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}.battle-card,.card,.profile-card,.pain-card,.solution-card,.info-block,.question-card,.battle-solution{border:1px solid var(--line);border-radius:8px;background:#fbfcfd;padding:15px 16px}.battle-card:first-child{grid-column:span 2;background:#eef8f7;border-color:#b7dddd}.battle-card p,.card p,.profile-card p,.pain-card p,.solution-card p,.battle-solution p,.info-line p{margin:0}.change-strip{margin-top:12px;border:1px solid #d7e8e7;border-left:5px solid var(--teal);border-radius:8px;background:#f3fbfa;padding:12px 14px}.change-strip b{display:block;color:var(--teal);margin-bottom:6px}.round-switch{padding-top:8px}.round-switch details,.backstage-section>details{border:1px solid var(--line);border-radius:10px;background:#fbfcfd;padding:13px 15px}.round-switch summary,.backstage-section>details>summary{cursor:pointer;font-weight:900;color:var(--blue)}.round-tabs{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0}.round-tabs button{border:0;border-radius:999px;padding:6px 12px;background:#eef5fb;color:var(--blue);font-size:12px;font-weight:800;cursor:pointer}.round-tabs button.active{background:var(--teal);color:#fff}.round-panel{display:none}.round-panel.active{display:block}.info-section-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.info-block h3{border-bottom:1px solid var(--line);padding-bottom:7px;margin-bottom:10px}.info-line,.info-metric{border-top:1px solid #e9eef2;padding-top:9px;margin-top:9px}.info-line:first-of-type,.info-metric:first-of-type{border-top:0;padding-top:0;margin-top:0}.info-line b,.info-metric b{display:block;color:#334150;margin-bottom:4px}.info-metric strong{display:block;color:var(--teal);font-size:21px;overflow-wrap:anywhere}.info-metric span,.battle-solution small{display:block;color:var(--muted);font-size:13px;line-height:1.5}.battle-solution-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.question-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.internal-section .card{background:#fffaf2;border-color:#ead7aa}.backstage-section{padding-top:16px}.backstage-stack{display:grid;gap:12px;margin-top:14px}.backstage-section .quality-banner,.backstage-section .rating-card,.backstage-section .annual-panel{margin:0}.backstage-section section{padding:0}.label{color:var(--teal);font-weight:800;font-size:13px;margin:9px 0 5px}ul{margin:0;padding-left:18px}li{margin:3px 0}.evidence-links{margin:0 0 9px}.evidence-links summary{display:inline-flex;align-items:center;gap:4px;width:max-content;max-width:100%;padding:2px 8px;border-radius:999px;background:#eaf7f7;color:var(--teal);font-size:12px;font-weight:800;cursor:pointer;list-style:none}.evidence-badge{color:var(--teal);font-weight:900}.evidence-badge.annual{color:#8a5a00}.evidence-links summary::-webkit-details-marker{display:none}.evidence-links div{display:grid;gap:6px;margin-top:7px}.evidence-links a,.evidence-links .evidence-item{display:block;border:1px solid var(--line);border-radius:7px;background:#fff;padding:7px 9px;color:var(--ink);font-size:12px;line-height:1.45}.evidence-links .evidence-item{border-color:#ead7aa;background:#fff8e8}.evidence-links small{display:block;color:var(--muted);margin-top:2px}.evidence-links em{display:block;margin-top:4px;color:#526070;font-style:normal}.metric-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:12px 0 16px}.metric{border:1px solid var(--line);border-radius:8px;background:#fff;padding:14px;min-height:128px;overflow:visible}.metric b{display:block;color:var(--muted);font-size:13px}.metric strong{display:block;color:var(--teal);font-size:22px;margin:4px 0;overflow-wrap:anywhere}.metric span,.solution-card small{display:block;color:var(--muted);font-size:13px;line-height:1.5}.pain-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.pain-card .entry{margin-top:10px;padding:9px 10px;border-radius:6px;background:#eef7f7;color:var(--teal);font-weight:800}.solution-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.tag{display:inline-block;padding:2px 8px;border-radius:999px;background:var(--teal);color:#fff;font-weight:800;font-size:12px;margin-bottom:8px}.require-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.source-overview{border:1px solid var(--line);border-radius:8px;background:#fbfcfd;padding:12px 14px}.source-overview summary{cursor:pointer;font-weight:800;color:var(--blue)}table{width:100%;border-collapse:collapse;table-layout:fixed;margin:12px 0 18px;font-size:14px}th{background:var(--ink);color:#fff;text-align:left;padding:10px 11px;font-weight:700}td{border:1px solid var(--line);padding:10px 11px;vertical-align:top;overflow-wrap:anywhere}tr:nth-child(even) td{background:#f8fafc}.footer{padding:18px 48px 34px;color:var(--muted);font-size:13px}
@media(max-width:850px){.hero,section,.footer{padding-left:22px;padding-right:22px}.battle-cover{padding-top:30px;padding-bottom:28px;background:linear-gradient(145deg,#0f1c26 0%,#183946 100%)}.battle-cover h1{font-size:28px}.cover-actions span{border-radius:10px}.quality-banner,.annual-panel{margin-left:22px;margin-right:22px}.quick,.grid,.grid.two,.executive-brief,.battle-hero-grid,.info-section-grid,.battle-solution-grid,.question-grid,.metric-grid,.pain-grid,.solution-grid,.require-grid,.rating-model-note,.rating-dim-grid,.rating-guidance{grid-template-columns:1fr}.brief-main h2{font-size:24px}.battle-card:first-child{grid-column:auto}.rating-card summary,.annual-summary{display:block}.rating-toggle{margin-top:8px}h1{font-size:29px}}
body{background:linear-gradient(180deg,#07111f 0%,#101b2f 28%,#eef3f8 28%,#f6f8fb 100%)}.page{background:#fff;border-left:1px solid #dbe5f0;border-right:1px solid #dbe5f0}.battle-cover{background:linear-gradient(135deg,#07111f 0%,#14243a 58%,#243b65 100%);border-bottom:1px solid rgba(255,255,255,.12)}.battle-cover h1{color:#f8fafc}.battle-cover p{color:#cbd5e1}.cover-actions span{border-color:rgba(147,197,253,.28);background:rgba(37,99,235,.18);color:#e0f2fe}.cover-actions .risk{background:#fff7ed;color:#7c2d12;border-color:#fed7aa}.kicker{background:rgba(15,23,42,.42);border-color:rgba(147,197,253,.38);color:#bfdbfe}.executive-brief{gap:16px}.brief-main{border-color:#bfd0ff;background:linear-gradient(180deg,#eef4ff 0%,#fff 100%);box-shadow:0 18px 40px rgba(15,23,42,.08)}.brief-label{background:#dbeafe;color:#1d4ed8}.brief-main h2{color:#172554}.brief-side article,.battle-card,.info-block,.pain-card,.battle-solution,.question-card,.card{border-color:#d8e2ef;border-radius:14px;background:linear-gradient(180deg,#fff 0%,#f8fbff 100%);box-shadow:0 10px 26px rgba(15,23,42,.06)}.brief-side article:nth-child(1){border-left:5px solid #2563eb}.brief-side article:nth-child(2){border-left:5px solid #7c3aed}.brief-side .risk{border-left:5px solid #f59e0b;background:#fff7ed;color:#7c2d12}.brief-side .risk b,.brief-side .risk span,.brief-side .risk small{color:#7c2d12}.brief-side .next{border-left:5px solid #0891b2;background:#ecfeff}.battle-section h2{color:#111827;border-bottom-color:#dbe5f0}.battle-hero-grid{grid-template-columns:repeat(5,minmax(0,1fr))}.battle-card:first-child{background:#eef4ff;border-color:#bfccff}.info-block h3,.question-card h3,.pain-card h3,.battle-solution h3{color:#1d4ed8}.info-metric strong{color:#1d4ed8}.label{color:#7c3aed}.pain-card .entry{background:#eef2ff;color:#3730a3}.action-guide-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.action-card{border:1px solid #d8e2ef;border-radius:16px;padding:15px;background:#fff;box-shadow:0 10px 26px rgba(15,23,42,.06)}.action-card span{display:block;margin-bottom:7px;color:#64748b;font-size:12px;font-weight:900}.action-card b{display:block;color:#0f172a;line-height:1.55}.action-card.focus{border-left:5px solid #2563eb}.action-card.ask{border-left:5px solid #0891b2}.action-card.risk{border-left:5px solid #f59e0b;background:#fff7ed;color:#7c2d12}.action-card.risk b,.action-card.risk span{color:#7c2d12}.risk-gate,.risk-card{background:#fff7ed!important;color:#7c2d12!important;border-color:#fed7aa!important}.risk-gate b,.risk-card h3,.risk-card small{color:#7c2d12!important}.battle-solution summary{cursor:pointer;display:flex;align-items:center;gap:10px;list-style:none}.battle-solution summary::-webkit-details-marker{display:none}.battle-solution[open]{background:linear-gradient(180deg,#fff 0%,#f8fbff 100%)}.tag{background:linear-gradient(135deg,#2563eb,#7c3aed)}.evidence-links summary{background:#e0f2fe;color:#0369a1}.backstage-section>details{background:#f8fafc}.footer{background:#f8fafc;color:#64748b}.page{width:100%;max-width:none;border-left:0;border-right:0;box-shadow:none}.battle-cover{margin:0}.hero.battle-cover{padding-left:max(22px,calc((100vw - 1120px)/2 + 48px));padding-right:max(22px,calc((100vw - 1120px)/2 + 48px))}@media(max-width:850px){body{background:#07111f}.battle-cover{padding:24px 18px}.battle-cover h1{font-size:25px}.cover-actions span{width:100%;max-width:none}.action-guide-grid,.battle-hero-grid,.info-section-grid,.battle-solution-grid,.question-grid{grid-template-columns:1fr}.brief-main{padding:18px}.brief-side article{padding:12px}.battle-section{padding-top:22px}.page{border:0}.hero.battle-cover{padding-left:18px;padding-right:18px}}
/* iOS report brief override */
:root{--ios-bg:#f2f2f7;--ios-card:#fff;--ios-card-2:#f9f9fb;--ios-text:#111827;--ios-secondary:#6b7280;--ios-separator:rgba(60,60,67,.18);--ios-blue:#007aff;--ios-green:#34c759;--ios-orange:#ff9500;--ios-red:#ff3b30;--ios-shadow:0 10px 30px rgba(15,23,42,.08);--ink:var(--ios-text);--muted:var(--ios-secondary);--line:var(--ios-separator);--teal:var(--ios-blue);--blue:var(--ios-blue)}
body{background:var(--ios-bg)!important;color:var(--ios-text);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI","Microsoft YaHei","Alibaba PuHuiTi",sans-serif;font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}.page{background:var(--ios-bg);box-shadow:none}.hero.battle-cover{margin:10px auto 0;width:min(100% - 20px,1120px);border-radius:28px;padding:22px;background:radial-gradient(circle at 88% 8%,rgba(255,214,10,.32),transparent 26%),linear-gradient(145deg,#07111f 0%,#182642 62%,#2a4778 100%)}.cover-meta{font-size:12px}.battle-cover h1{margin:14px 0 8px;font-size:clamp(25px,5.4vw,38px);font-weight:850;letter-spacing:0}.battle-cover p{font-size:13px;line-height:1.55}.cover-actions{gap:8px;margin-top:14px}.cover-actions span{max-width:none;border:0;border-radius:16px;padding:9px 11px;background:rgba(255,255,255,.13);font-size:13px}.cover-actions .risk{background:rgba(255,149,0,.16);color:#ffe1b0;border:0}
section{width:min(100% - 20px,1120px);margin:10px auto 0;padding:0}.battle-section h2,section>h2{border:0;margin:0 0 10px;padding:0;color:var(--ios-text);font-size:20px;font-weight:850}.executive-brief{grid-template-columns:minmax(0,1fr) minmax(280px,.72fr);gap:10px;padding-top:10px}.brief-main,.brief-side article,.battle-card,.info-block,.pain-card,.battle-solution,.question-card,.card,.action-card,.source-overview,.verification-card,.rating-card,.quality-banner,.annual-panel{border:0!important;border-radius:22px!important;background:var(--ios-card)!important;box-shadow:var(--ios-shadow)!important}.brief-main{padding:18px}.brief-label,.tag,.evidence-links summary{border-radius:999px;background:rgba(0,122,255,.12)!important;color:var(--ios-blue)!important}.brief-main h2{font-size:23px;color:var(--ios-text);line-height:1.18}.brief-main p,.brief-side small,.info-metric span,.battle-solution small,.metric span,.lead,.muted{color:var(--ios-secondary)}.brief-side{gap:8px}.brief-side article{padding:13px}.brief-side span,.action-card span{color:var(--ios-secondary);font-size:12px}.brief-side b,.action-card b{color:var(--ios-text)}.brief-side .risk,.action-card.risk,.risk-card,.risk-gate{background:rgba(255,149,0,.12)!important;color:#7a3d00!important}.brief-side .next{background:rgba(52,199,89,.10)!important}.action-guide-grid,.info-section-grid,.pain-grid,.battle-solution-grid,.question-grid,.grid.two{gap:10px}.info-block,.pain-card,.battle-solution,.question-card,.card,.action-card{padding:14px}.info-block h3,.question-card h3,.pain-card h3,.battle-solution h3{color:var(--ios-text);font-size:16px}.info-line,.info-metric{border-top:1px solid var(--ios-separator)}.info-metric strong,.metric strong{color:var(--ios-blue);font-size:22px}.label{color:var(--ios-blue);font-size:12px}.pain-card .entry{border-radius:14px;background:rgba(0,122,255,.10);color:var(--ios-blue)}.battle-solution summary{min-height:42px}.backstage-section{padding-top:4px}.backstage-section>details,.round-switch details{border:0;border-radius:20px;background:rgba(118,118,128,.10);box-shadow:none;padding:13px}.backstage-section>details>summary,.round-switch summary{color:var(--ios-blue)}.footer{width:min(100% - 20px,1120px);margin:10px auto 20px;border-radius:20px;background:rgba(118,118,128,.10);padding:12px 14px;color:var(--ios-secondary)}
@media(max-width:850px){body{background:var(--ios-bg)!important}.hero.battle-cover{width:calc(100% - 18px);margin-top:8px;border-radius:26px;padding:18px}.battle-cover h1{font-size:25px}.cover-actions span{width:100%;border-radius:14px}section,.footer{width:calc(100% - 18px);padding-left:0!important;padding-right:0!important}.executive-brief,.action-guide-grid,.battle-hero-grid,.info-section-grid,.battle-solution-grid,.question-grid,.pain-grid,.metric-grid,.grid,.grid.two,.rating-guidance,.rating-model-note,.rating-dim-grid{grid-template-columns:1fr}.brief-main{padding:16px}.brief-side article,.action-card,.info-block,.pain-card,.battle-solution,.question-card,.card{padding:13px}.backstage-section{margin-bottom:4px}}
.round-feedback-inline{width:min(100% - 20px,1120px);margin:10px auto 0}.round-feedback-inline>div{border:0;border-radius:20px;background:rgba(52,199,89,.10);box-shadow:var(--ios-shadow);padding:12px 14px}.round-feedback-inline span{display:block;color:#1f7a3a;font-size:12px;font-weight:900;margin-bottom:4px}.round-feedback-inline p{margin:0;color:var(--ios-text);line-height:1.55}.round-feedback-inline small{display:block;margin-top:5px;color:var(--ios-secondary);line-height:1.45}.decision-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.decision-card{border:0;border-radius:22px;background:var(--ios-card);box-shadow:var(--ios-shadow);padding:14px}.decision-card h3{margin:0 0 9px;color:var(--ios-text);font-size:16px}.decision-card small{display:block;color:var(--ios-secondary);font-size:12px;line-height:1.45;margin-top:8px}.decision-person{border-top:1px solid var(--ios-separator);padding-top:8px;margin-top:8px}.decision-person:first-of-type{border-top:0;padding-top:0;margin-top:0}.decision-person b{display:inline-block;color:var(--ios-text);margin-right:8px}.decision-person span{display:inline-block;border-radius:999px;background:rgba(0,122,255,.10);color:var(--ios-blue);font-size:12px;font-weight:850;padding:2px 7px}.decision-person p{margin:5px 0 0;color:var(--ios-secondary);font-size:13px;line-height:1.5}
.source-summary-card{border:0;border-radius:20px;background:var(--ios-card);box-shadow:var(--ios-shadow);padding:14px}.source-summary-card b{display:block;color:var(--ios-text);margin-bottom:5px}.source-summary-card span{display:block;color:var(--ios-secondary);font-size:13px;line-height:1.5}.battle-solution-group{border:0;border-radius:22px;background:rgba(118,118,128,.10);padding:12px}.battle-solution-group>summary{cursor:pointer;color:var(--ios-blue);font-weight:850;list-style:none}.battle-solution-group>summary::-webkit-details-marker{display:none}.solution-head{display:flex;align-items:center;gap:9px;margin-bottom:6px}.solution-head h3{margin:0}.battle-solution-grid{margin-top:12px}
@media(max-width:850px){.decision-grid{grid-template-columns:1fr}.round-feedback-inline{width:calc(100% - 18px)}}
</style>
</head>
<body>
<main class="page">
  <header class="hero battle-cover">
    <div class="cover-meta">
      <span class="kicker">商机参谋团 OAC</span>
      <span>${e(report.sellerProfileName || report.sellerProfileSnapshot?.companyName || "未绑定我的企业")} → ${e(report.standardName)}</span>
    </div>
    <h1>${e(cover.oneLine)}</h1>
    <p>${e(report.standardName)}｜${e(cover.rating)}｜${e(cover.next)}</p>
    <div class="cover-actions">
      <span>优先切入：${e(cover.entry)}</span>
      <span class="risk">风险：${e(cover.risk)}</span>
    </div>
  </header>
  ${isDiagnostic ? renderDiagnosticSections(report) : renderNormalSections(report)}
  ${evidenceBackstageSection(report)}
  <div class="footer">生成时间：${e(generated)}｜生成耗时：${e(duration)}｜质量：${e(report.qualityLabel || "正式报告")}｜来源：${e(sourceDisplay(report))}</div>
</main>
<script>
document.querySelectorAll(".round-tabs button").forEach(function(button){
  button.addEventListener("click", function(){
    var target = button.getAttribute("data-round-target");
    document.querySelectorAll(".round-tabs button").forEach(function(item){ item.classList.toggle("active", item === button); });
    document.querySelectorAll(".round-panel").forEach(function(panel){ panel.classList.toggle("active", panel.getAttribute("data-round-panel") === target); });
  });
});
</script>
</body>
</html>`;
}
