import { clip, normalizeText, uniqBy } from "./util.mjs";

const TRACKING_PARAMS = /^(utm_|spm|from|fr|source|ref|refer|wfr|share|share_token|isappinstalled|nsukey|fbclid|gclid|msclkid|bd_vid|tn|ch|from_source|pa_pids|keyword_360|trace_id|hit_type|click_position|pa_from|src)$/i;
const FINANCE_HARD_DOMAINS = [
  "cninfo.com.cn",
  "sse.com.cn",
  "szse.cn",
  "eastmoney.com",
  "10jqka.com.cn",
  "finance.sina.com.cn",
  "stock.finance.sina.com.cn",
  "cnstock.com",
  "static.sse.com.cn",
  "pdf.dfcfw.com"
];
const ALWAYS_BAD_DOMAINS = [
  "map.360.cn",
  "news.so.com",
  "image.so.com",
  "m.image.so.com",
  "so.com",
  "sogou.com",
  "amap.com",
  "baike.baidu.com",
  "11467.com",
  "huangye",
  "yellowurl",
  "mingluji.com",
  "bianmachaxun.com"
];
const LOW_VALUE_DOMAINS = [
  "support.mozilla.org",
  "mozilla.org",
  "azquotes.com",
  "apple.com",
  "zhihu.com",
  "microsoft.com",
  "stackoverflow.com",
  "github.com",
  "baike.baidu.com",
  "map.360.cn",
  "amap.com",
  "baidu.com",
  "11467.com",
  "huangye",
  "yellowurl",
  "liepin.com",
  "zhipin.com",
  "51job.com",
  "zhaopin.com",
  "kanzhun.com",
  "jobui.com"
];

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function decodeBingTarget(value) {
  try {
    const parsed = new URL(value);
    if (!parsed.hostname.toLowerCase().endsWith("bing.com") || !parsed.pathname.startsWith("/ck/")) return value;
    const raw = parsed.searchParams.get("u");
    if (!raw) return "";
    if (raw.startsWith("http")) return raw;
    const payload = raw.startsWith("a1") ? raw.slice(2) : raw;
    const decoded = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return decoded.startsWith("http") ? decoded : "";
  } catch {
    return value;
  }
}

function dropTrackingParams(parsed) {
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (TRACKING_PARAMS.test(key)) parsed.searchParams.delete(key);
  }
  parsed.hash = "";
  return parsed;
}

export function canonicalSourceUrl(value = "") {
  let url = decodeHtml(value).trim().replace(/[),.;，。]+$/g, "");
  if (url.startsWith("//")) url = `https:${url}`;
  try {
    let parsed = new URL(url);
    if (parsed.hostname.includes("duckduckgo.com") && parsed.pathname.startsWith("/l/")) {
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) parsed = new URL(decodeURIComponent(uddg));
    }
    const decoded = decodeBingTarget(parsed.toString());
    if (decoded && decoded !== parsed.toString()) parsed = new URL(decoded);
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (parsed.protocol === "http:" && !/static\.sse\.com\.cn|sse\.com\.cn/.test(parsed.hostname)) parsed.protocol = "https:";
    parsed.pathname = decodeURIComponent(parsed.pathname).replace(/\/{2,}/g, "/");
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) parsed.pathname = parsed.pathname.slice(0, -1);
    dropTrackingParams(parsed);
    return parsed.toString();
  } catch {
    return "";
  }
}

export function sourceDomain(url = "") {
  try {
    return new URL(canonicalSourceUrl(url) || url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function coreName(name) {
  return normalizeText(name).replace(/(股份有限公司|有限责任公司|集团有限公司|有限公司|公司)$/g, "");
}

function extractStockCode(...values) {
  const text = values.map((item) => String(item || "")).join(" ");
  return Array.from(new Set(text.match(/(?<!\d)(?:60|68|00|30|83|87|43|92)\d{4}(?!\d)/g) || []))[0] || "";
}

function isFinanceHardDomain(domain = "") {
  return FINANCE_HARD_DOMAINS.some((item) => domain.endsWith(item) || domain.includes(item));
}

function isFinanceEvidence(source = {}, url = "") {
  return /investors?|annual|report|proxy|ir\.|投资者|年度报告|年报|财报|业绩公告|定期报告/i.test(`${source.title || ""} ${source.snippet || ""} ${url}`);
}

export function sourceFamilyOf(source = {}, urlValue = "", sourceTypeValue = "") {
  const url = String(urlValue || source.url || "").toLowerCase();
  const sourceType = String(sourceTypeValue || source.sourceType || "");
  const titleSnippet = `${source.title || ""} ${source.snippet || ""}`.toLowerCase();
  const pageText = `${titleSnippet} ${source.text || ""}`.toLowerCase();
  const registryDomain = /qcc\.com|aiqicha|tianyancha|qixin|qichamao|shuidi|gsxt/.test(sourceDomain(url));
  const tool = String(source.structuredTool || "").toLowerCase();
  if (source.provider === "tianyancha-api" || source.structuredProvider === "tianyancha") {
    if (/financial|annual|income_statement|balance_sheet|cash_flow|listing|stock/.test(tool)) return "finance_budget";
    if (/risk|dishonest|debtor|restriction/.test(tool)) return "risk_legal";
    if (/bidding|bid|supplier|customer|license|qualification/.test(tool)) return "tender_project";
    if (/patent|copyright/.test(tool)) return "patent_ip";
    if (/recruitment/.test(tool)) return "hiring_org";
    return "subject_registry";
  }
  if (/法院|裁判|失信|被执行|限制消费|诉讼|信用中国|creditchina|wenshu|zxgk/.test(`${url} ${titleSnippet} ${sourceType}`)) return "risk_legal";
  if (/招投标|招标|投标|中标|采购|供应商|政府采购|cebpubservice|chinabidding|bid|tender|procurement/.test(`${url} ${titleSnippet} ${sourceType}`)) return "tender_project";
  if (/专利|软著|软件著作权|商标|知识产权|cnipa|patent|trademark|copyright/.test(`${url} ${titleSnippet} ${sourceType}`)) return "patent_ip";
  if (/招聘|岗位|职位|薪资|任职|社招|校招|猎聘|直聘|前程无忧|智联招聘|软件工程师|数据工程师|zhipin|liepin|51job|zhaopin|kanzhun|jobui|career|jobs?/.test(`${url} ${titleSnippet} ${sourceType}`)) return "hiring_org";
  if (registryDomain || /工商|股权|注册资本|法定代表人|董监高|参保人数/.test(pageText)) return "subject_registry";
  if (/案例|客户案例|项目案例|标杆|交付|实施|上线|解决方案|生态伙伴|合作伙伴|伙伴网络|能力中心|联合方案|平台集成|系统集成|集成|对接|产品手册|服务商|价格区间|部署周期|数字化工厂|智能工厂|mes|erp|sap|aps|wms|lims|eam|qms|scada|工业互联网|holl(?:i|y)cube|hollimes|holliems|customer case|case study|implementation|integration|ecosystem|partner/.test(`${url} ${pageText}`)) return "customer_case";
  if (/官网|产品|平台|系统|解决方案|业务介绍|公司简介|newsroom|press|product|platform|solution|official/.test(`${url} ${pageText}`)) return "official_product";
  if (/财务硬来源/.test(sourceType) || /cninfo\.com\.cn|sse\.com\.cn|szse\.cn|eastmoney\.com|10jqka\.com\.cn|pdf\.dfcfw\.com/.test(sourceDomain(url)) || /年报|财报|营收|营业收入|净利润|现金流|研发投入|资产负债|f10|investor|annual report|financial/.test(titleSnippet)) return "finance_budget";
  if (/数字化|ai|人工智能|智能制造|数据中台|知识库|copilot|agent|aigc|aiops|可观测|运维|实时数据库|工业数据|industrial internet|digital transformation/.test(pageText)) return "digital_capability";
  if (/行业|协会|标准|白皮书|报告|政策|市场|趋势|research|market|standard|policy/.test(pageText)) return "industry_context";
  return "general_web";
}

function isLowValueDomain(domain = "") {
  return LOW_VALUE_DOMAINS.some((item) => domain.includes(item));
}

function isAlwaysBadDomain(domain = "") {
  return ALWAYS_BAD_DOMAINS.some((item) => domain.includes(item));
}

function isBadUrl(url = "") {
  const value = String(url).toLowerCase();
  return /javascript:|jina\.ai|bing\.com\/search|google\.com\/search|baidu\.com\/s\?|news\.so\.com\/ns|image\.so\.com\/i|so\.com\/(?:link|s\?|help)|info\.so\.com|map\.360\.cn|hao\.360\.com|e\.360\.cn|bbs\.360\.cn|zhanzhang\.so\.com|sogou\.com\/web|duckduckgo\.com\/html|shuidi\.cn\/(?:owner_resume|person)|kanji|jiten|zidian|cidian|hanyu|zdic|dictionary|wiktionary|youdao|iciba/.test(value);
}

function titleKey(title = "") {
  return normalizeText(title)
    .replace(/(官网|首页|公司介绍|公司简介|来源链接|主体核对来源|新闻中心|中文|英文|有限公司|股份有限公司)/g, "")
    .slice(0, 80);
}

function sourceScore(source) {
  let score = 0;
  if (source.isCompanySpecific) score += 50;
  if (source.sourceType === "财务硬来源") score += 35;
  if (source.sourceType === "主体核对来源") score += 14;
  if (source.sourceType === "企业公开来源") score += 20;
  if (source.sourceType === "行业背景来源") score += 8;
  if (source.readable) score += 8;
  if (/official_product|customer_case|digital_capability|tender_project|patent_ip/.test(source.sourceFamily || "")) score += 22;
  if (/hiring_org|industry_context/.test(source.sourceFamily || "")) score += 10;
  score += Math.min(25, Number(source.relevanceScore || 0));
  if (source.confidence === "高") score += 10;
  if (source.confidence === "中高") score += 5;
  return score;
}

function dedupeSimilarSources(sources) {
  const byUrl = uniqBy(
    [...sources].sort((a, b) => sourceScore(b) - sourceScore(a)),
    (source) => source.url
  );
  const out = [];
  const seenTitleDomain = new Set();
  for (const source of byUrl) {
    const key = `${source.domain}|${titleKey(source.title)}`;
    if (titleKey(source.title).length > 8 && seenTitleDomain.has(key)) continue;
    if (titleKey(source.title).length > 8) seenTitleDomain.add(key);
    out.push(source);
  }
  return out;
}

function diversifySources(sources = [], max = 80) {
  const sorted = [...sources]
    .map((source) => ({ ...source, sourceFamily: source.sourceFamily || sourceFamilyOf(source, source.url, source.sourceType) }))
    .sort((a, b) => sourceScore(b) - sourceScore(a));
  const families = [
    "finance_budget",
    "official_product",
    "customer_case",
    "digital_capability",
    "tender_project",
    "patent_ip",
    "hiring_org",
    "industry_context",
    "risk_legal",
    "subject_registry",
    "general_web"
  ];
  const chosen = [];
  const used = new Set();
  const registryCap = Math.max(4, Math.ceil(max * 0.4));
  const nonRegistryTotal = sorted.filter((source) => source.sourceFamily !== "subject_registry").length;

  const take = (family, count) => {
    for (const source of sorted) {
      if (chosen.length >= max) return;
      if (source.sourceFamily !== family || used.has(source.url)) continue;
      if (family === "subject_registry" && nonRegistryTotal > 0 && chosen.filter((item) => item.sourceFamily === "subject_registry").length >= registryCap) continue;
      chosen.push(source);
      used.add(source.url);
      if (chosen.filter((item) => item.sourceFamily === family).length >= count) return;
    }
  };

  for (const family of families.filter((family) => family !== "subject_registry" && family !== "general_web")) take(family, 6);
  take("subject_registry", registryCap);
  take("general_web", 6);

  for (const source of sorted) {
    if (chosen.length >= max) break;
    if (used.has(source.url)) continue;
    if (source.sourceFamily === "subject_registry" && nonRegistryTotal > 0 && chosen.filter((item) => item.sourceFamily === "subject_registry").length >= registryCap) continue;
    chosen.push(source);
    used.add(source.url);
  }
  for (const source of sorted) {
    if (chosen.length >= max) break;
    if (used.has(source.url)) continue;
    chosen.push(source);
    used.add(source.url);
  }
  return chosen;
}

function auditOneSource(source = {}, context = {}) {
  const company = context.company || {};
  const url = canonicalSourceUrl(source.url);
  const domain = sourceDomain(url);
  const name = company.standardName || company.companyName || company.name || company.query || "";
  const aliases = [
    ...(Array.isArray(company.aliases) ? company.aliases : []),
    ...(Array.isArray(company.keywords) ? company.keywords.filter((item) => /[A-Za-z]/.test(String(item)) && normalizeText(item).length >= 6) : [])
  ];
  const core = coreName(name);
  const stock = company.stockCode || extractStockCode(company.stockCode, company.industry, company.aiNeeds, company.ticker);
  // Do not use the original search query as evidence. Search terms often contain
  // the company name and would make unrelated result pages look relevant.
  const haystack = normalizeText([
    source.title,
    source.snippet,
    source.text,
    url
  ].join(" "));
  const exactNameHit = name && haystack.includes(normalizeText(name));
  const aliasHit = aliases.some((alias) => {
    const normalizedAlias = normalizeText(alias);
    return normalizedAlias.length >= 6 && haystack.includes(normalizedAlias);
  });
  const coreHit = core && core.length >= 4 && haystack.includes(core);
  const shortCore = core && core.length >= 4 ? core.slice(0, 3) : "";
  const brandContextHit = Boolean(shortCore && haystack.includes(shortCore) && /holli|holly|hollicube|mes|aps|erp|wms|lims|aiops|工业互联网|工业软件|数字化工厂|客户案例|解决方案|智能制造|数字工业操作系统/i.test(haystack));
  const stockHit = stock && haystack.includes(normalizeText(stock));
  const industryHit = company.industry && haystack.includes(normalizeText(company.industry));
  const strongCompanyHit = Boolean(exactNameHit || aliasHit || coreHit || brandContextHit || stockHit);
  let sourceType = source.sourceType || "";
  let confidence = source.confidence || "";
  const reasons = [];

  if (!url || !/^https?:\/\//i.test(url)) return { keep: false, reason: "无效链接", source: null };
  if (isBadUrl(url)) return { keep: false, reason: "搜索/字典/无效页面", source: null };
  if (!domain) return { keep: false, reason: "无法识别域名", source: null };
  if (isAlwaysBadDomain(domain)) return { keep: false, reason: `低质量目录/地图/百科来源：${domain}`, source: null };
  const financeEvidence = isFinanceEvidence(source, url);
  if (sourceType === "财务硬来源" && !isFinanceHardDomain(domain) && !financeEvidence) {
    sourceType = "企业公开来源";
    if (confidence === "高") confidence = strongCompanyHit ? "中高" : "低";
    reasons.push("原财务硬来源域名不合规，已降级");
  }
  if (sourceType === "财务硬来源" && !stockHit) {
    sourceType = strongCompanyHit ? "企业公开来源" : "线索来源";
    if (confidence === "高" || !confidence) confidence = strongCompanyHit ? "中" : "低";
    reasons.push("财务域名未命中目标股票代码，已降级");
  }
  if (isLowValueDomain(domain) && !strongCompanyHit) {
    return { keep: false, reason: `低相关域名且未命中企业：${domain}`, source: null };
  }
  if (!strongCompanyHit && !industryHit && sourceType !== "行业背景来源") {
    return { keep: false, reason: "未命中企业名称、股票代码或行业关键词", source: null };
  }
  if (!sourceType) {
    sourceType = isFinanceHardDomain(domain) && stockHit
      ? "财务硬来源"
      : financeEvidence && stockHit
        ? "财务硬来源"
      : (isFinanceHardDomain(domain) || financeEvidence) && strongCompanyHit
        ? "企业公开来源"
      : /qcc|aiqicha|tianyancha|shuidi|gov\.cn/.test(domain)
        ? "主体核对来源"
        : industryHit && !strongCompanyHit
          ? "行业背景来源"
          : "企业公开来源";
  }
  if (sourceType === "财务硬来源" && (!stockHit || (!isFinanceHardDomain(domain) && !financeEvidence))) {
    sourceType = strongCompanyHit ? "企业公开来源" : "线索来源";
    if (confidence === "高" || !confidence) confidence = strongCompanyHit ? "中" : "低";
  }
  if (strongCompanyHit) reasons.push(`命中${[exactNameHit || coreHit ? "企业名称" : "", aliasHit ? "别名" : "", brandContextHit ? "集团/品牌业务线索" : "", stockHit ? "股票代码" : ""].filter(Boolean).join("、")}`);
  else if (industryHit) reasons.push("命中行业关键词");

  const next = {
    ...source,
    url,
    domain,
    sourceType,
    sourceFamily: sourceFamilyOf(source, url, sourceType),
    confidence,
    relevanceReason: reasons.join("；") || source.relevanceReason || "通过来源审计",
    relevanceScore: Number(source.relevanceScore || 0) + (strongCompanyHit ? 40 : industryHit ? 10 : 0),
    isCompanySpecific: Boolean(strongCompanyHit),
    title: clip(String(source.title || url).replace(/\s+/g, " "), 140)
  };
  if (source.provider === "tianyancha-api" || source.structuredProvider === "tianyancha") {
    next.confidence = "高";
    next.isCompanySpecific = true;
    next.relevanceScore = Math.max(Number(next.relevanceScore || 0), 80);
    if (/financial|annual|income_statement|balance_sheet|cash_flow|listing|stock/.test(source.structuredTool || "")) next.sourceType = "财务硬来源";
    else if (/risk|dishonest|debtor|restriction/.test(source.structuredTool || "")) next.sourceType = "风险合规来源";
    else if (/bidding|bid|supplier|customer|license|qualification|patent|copyright|recruitment/.test(source.structuredTool || "")) next.sourceType = "企业公开来源";
    else if (!next.sourceType || next.sourceType === "线索来源") next.sourceType = "主体核对来源";
    next.sourceFamily = sourceFamilyOf({ ...next, sourceFamily: "" }, url, next.sourceType);
    next.relevanceReason = source.relevanceReason || "天眼查 MCP 结构化数据直接命中目标企业";
  }
  return { keep: true, reason: "", source: next };
}

function weakAuditOneSource(source = {}, context = {}, existingUrls = new Set()) {
  const company = context.company || {};
  const url = canonicalSourceUrl(source.url);
  const domain = sourceDomain(url);
  const name = company.standardName || company.companyName || company.name || company.query || "";
  const core = coreName(name);
  const haystack = normalizeText([source.title, source.snippet, source.text, url].join(" "));
  const industry = normalizeText(company.industry || "");
  const directHit = Boolean((name && haystack.includes(normalizeText(name))) || (core && core.length >= 4 && haystack.includes(core)));
  const industryHit = Boolean(industry && haystack.includes(industry));
  const industryBackground = source.sourceType === "行业背景来源" || /协会|标准|行业|展会|报告|政策|工信部|通信|汽车|数据中心/.test(`${source.title || ""} ${source.snippet || ""}`);

  if (!url || !/^https?:\/\//i.test(url) || existingUrls.has(url)) return null;
  if (isBadUrl(url) || !domain || isAlwaysBadDomain(domain)) return null;
  if (!directHit && !(industryBackground && industryHit)) return null;

  return {
    ...source,
    url,
    domain,
    sourceType: source.sourceType || (industryBackground && !directHit ? "行业背景来源" : "弱线索来源"),
    sourceFamily: sourceFamilyOf(source, url, source.sourceType || (industryBackground && !directHit ? "行业背景来源" : "弱线索来源")),
    confidence: source.confidence || (directHit ? "中" : "低"),
    readable: Boolean(source.readable || String(source.text || "").length > 120),
    isCompanySpecific: Boolean(directHit),
    relevanceReason: directHit
      ? "弱证据保留：命中企业名称"
      : "弱证据保留：行业/标准/展会背景线索",
    title: clip(String(source.title || url).replace(/\s+/g, " "), 140)
  };
}

export function auditSources(sources = [], context = {}) {
  const removed = [];
  const cleaned = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    const result = auditOneSource(source, context);
    if (result.keep) cleaned.push(result.source);
    else removed.push({ ...source, title: source?.title || source?.url || "未知来源", url: source?.url || "", reason: result.reason });
  }
  let deduped = diversifySources(dedupeSimilarSources(cleaned), context.max || 80);
  const minSources = Number(context.min || 0);
  if (deduped.length < minSources) {
    const existingUrls = new Set(deduped.map((source) => source.url));
    const weak = [];
    for (const source of removed) {
      const kept = weakAuditOneSource(source, context, existingUrls);
      if (!kept) continue;
      existingUrls.add(kept.url);
      weak.push(kept);
      if (deduped.length + weak.length >= minSources) break;
    }
    if (weak.length) deduped = diversifySources(dedupeSimilarSources([...deduped, ...weak]), context.max || 80);
  }
  const warnings = [];
  if (removed.length) warnings.push(`已隐藏 ${removed.length} 条低相关、重复或错误来源。`);
  if (deduped.length < cleaned.length) warnings.push(`已合并 ${cleaned.length - deduped.length} 条重复来源。`);
  return {
    sources: deduped,
    removed,
    warnings,
    removedCount: removed.length + Math.max(0, cleaned.length - deduped.length)
  };
}

function evidenceTierOf(source = {}) {
  const confidence = String(source.confidence || "");
  const sourceType = String(source.sourceType || "");
  if (/弱|线索|行业背景/.test(sourceType) || confidence === "低") return "weak";
  if (confidence === "高" || /财务硬来源|主体核对来源/.test(sourceType)) return "high";
  return "medium";
}

function buildEvidencePool(sources = []) {
  const high = sources.filter((source) => evidenceTierOf(source) === "high");
  const medium = sources.filter((source) => evidenceTierOf(source) === "medium");
  const weak = sources.filter((source) => evidenceTierOf(source) === "weak");
  const familyCounts = sources.reduce((acc, source) => {
    const family = source.sourceFamily || sourceFamilyOf(source, source.url, source.sourceType);
    acc[family] = (acc[family] || 0) + 1;
    return acc;
  }, {});
  return {
    highConfidenceCount: high.length,
    mediumConfidenceCount: medium.length,
    weakClueCount: weak.length,
    totalEvidenceCount: sources.length,
    label: `高置信 ${high.length} 条｜中置信 ${medium.length} 条｜弱线索 ${weak.length} 条`,
    familyCounts
  };
}

export function auditReport(report = {}) {
  const audit = auditSources(report.sources || [], { company: report, max: 80, min: 15 });
  const nextWarnings = [...(Array.isArray(report.qualityWarnings) ? report.qualityWarnings : []), ...audit.warnings];
  const count = audit.sources.length;
  const hasAnnualEvidence = Boolean(report.annualReportEvidence);
  const annualMetricCount = Array.isArray(report.annualReportEvidence?.metrics) ? report.annualReportEvidence.metrics.length : 0;
  const annualSectionCount = Array.isArray(report.annualReportEvidence?.sections) ? report.annualReportEvidence.sections.length : 0;
  const annualTextLength = Number(report.annualReportEvidence?.textLength || 0);
  const annualIsStrong = hasAnnualEvidence && (annualTextLength >= 10000 || annualMetricCount >= 2 || annualSectionCount >= 2);
  let qualityLevel = report.qualityLevel || "formal";
  let qualityLabel = report.qualityLabel || "正式报告";
  if (annualIsStrong) {
    qualityLevel = annualTextLength >= 10000 || annualMetricCount >= 4 || annualSectionCount >= 4 ? "formal" : "brief";
    qualityLabel = qualityLevel === "formal" ? "年报增强正式报告" : "年报增强简版报告";
  } else if (hasAnnualEvidence && /年报增强/.test(qualityLabel)) {
    qualityLevel = report.qualityLevel || "brief";
    qualityLabel = report.qualityLabel || "年报增强简版报告";
  } else if (count < 10) {
    qualityLevel = "limited";
    qualityLabel = "证据不足版";
  } else if (count < 15 && qualityLevel === "formal") {
    qualityLevel = "brief";
    qualityLabel = "简版报告";
  }
  return {
    ...report,
    sources: audit.sources,
    sourceAudit: {
      ...(report.sourceAudit || {}),
      removedCount: audit.removedCount,
      removed: audit.removed.slice(0, 20),
      warnings: audit.warnings
    },
    verifiedSourceCount: audit.sources.length,
    sourceCount: audit.sources.length,
    evidencePool: buildEvidencePool(audit.sources),
    qualityLevel,
    qualityLabel,
    qualityWarnings: Array.from(new Set(nextWarnings))
  };
}
