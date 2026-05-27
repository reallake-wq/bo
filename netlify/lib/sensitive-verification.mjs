import { searchWeb, readSource } from "./research.mjs";
import { canonicalSourceUrl, sourceDomain } from "./source-audit.mjs";
import { clip, normalizeText, uniqBy } from "./util.mjs";

const CATEGORIES = [
  {
    key: "legalRisk",
    label: "信用/法律风险",
    terms: ["限制高消费", "限制消费", "失信", "被执行", "执行案件", "终本", "诉讼", "开庭公告", "裁判文书", "合同纠纷", "未履行", "债务", "欠款", "回款困难"],
    trusted: /court|zxgk|creditchina|gov\.cn|aiqicha|qcc|tianyancha|qixin|shuidi|gsxt|wenshu/i,
    queries: (ctx) => [
      `${ctx.name} 限制高消费 限制消费`,
      `${ctx.name} 失信 被执行人 执行案件`,
      `${ctx.name} 诉讼 合同纠纷 开庭公告 裁判文书`,
      `${ctx.name} 未履行 债务 欠款 回款`,
      `${ctx.name} 爱企查 企查查 天眼查 水滴信用 风险`
    ]
  },
  {
    key: "equityControl",
    label: "股权/控制权",
    terms: ["股权变更", "股东", "实际控制人", "控股", "母公司", "子公司", "二股东", "持股", "股权转让"],
    trusted: /gov\.cn|cninfo|sse|szse|aiqicha|qcc|tianyancha|qixin|shuidi|gsxt|36kr|pitchhub/i,
    queries: (ctx) => [
      `${ctx.name} 股东 股权 实际控制人`,
      `${ctx.name} 股权变更 股权转让 持股`,
      `${ctx.name} 母公司 子公司 控股 二股东`,
      `${ctx.name} 爱企查 企查查 天眼查 股东`,
      ...ctx.relatedCompanies.slice(0, 3).map((item) => `${ctx.name} ${item} 股东 持股`)
    ]
  },
  {
    key: "financeMetric",
    label: "财务/经营指标",
    terms: ["营收", "营业收入", "净利润", "利润", "现金流", "研发费用", "员工数量", "资产负债", "毛利率"],
    trusted: /cninfo|sse|szse|eastmoney|10jqka|finance\.sina|qcc|aiqicha|tianyancha|qixin|shuidi|gov\.cn/i,
    queries: (ctx) => [
      `${ctx.stockCode || ctx.name} 营业收入 净利润 现金流 研发费用 员工数量`,
      `${ctx.name} 年报 财报 营收 利润 员工`,
      `${ctx.name} 东方财富 同花顺 新浪财经 财务指标`,
      `${ctx.name} 企查查 爱企查 参保人数 融资`,
      ctx.stockCode ? `${ctx.stockCode} 年报 营业收入 归母净利润 研发投入` : ""
    ]
  },
  {
    key: "fundingProject",
    label: "融资/重大项目/补贴",
    terms: ["融资", "Pre-A", "A轮", "投资", "重大项目", "政府补贴", "中标", "招投标", "客户名单"],
    trusted: /gov\.cn|cninfo|36kr|pitchhub|itjuzi|qcc|aiqicha|tianyancha|qixin|shuidi|chinabidding|cebpubservice/i,
    queries: (ctx) => [
      `${ctx.name} 融资 投资 A轮 Pre-A`,
      `${ctx.name} 重大项目 政府补贴 公示`,
      `${ctx.name} 中标 招投标 采购 客户`,
      `${ctx.name} 36氪 创投 项目信息 融资`,
      `${ctx.name} 政府 项目 公示 科技型中小企业 专精特新`
    ]
  }
];

const LEGAL_RISK_RE = /限制高消费|限制消费|失信|被执行|执行案件|终本|诉讼|开庭公告|裁判文书|合同纠纷|未履行|债务|欠款|回款困难|付款风险|信用风险/;
const NO_LEGAL_RISK_RE = /未被列为失信|未被列入失信|不存在失信|无失信|未发现失信|未被执行|无被执行|不存在被执行|无重大诉讼|不存在重大诉讼|限制高消费\s*0|限制消费\s*0|失信(?:信息|被执行人)?\s*0|被执行人\s*0|历史被执行人\s*0|终本案件\s*0|法律文书\s*0|开庭公告\s*0|诉讼\s*0|自身风险\s*0|关联风险\s*0|风险概览\s*0/;
const POSITIVE_LEGAL_RISK_RE = /被列为失信|被列入失信|被限制(?:高)?消费|限制高消费\s*[1-9]\d*|限制消费\s*[1-9]\d*|失信(?:信息|被执行人)?\s*[1-9]\d*|被执行人\s*[1-9]\d*|历史被执行人\s*[1-9]\d*|终本案件\s*[1-9]\d*|法律文书\s*[1-9]\d*|开庭公告\s*[1-9]\d*|诉讼\s*[1-9]\d*|执行标的|未履行金额|案号|立案时间|执行法院|裁判文书\s*[1-9]\d*|合同纠纷\s*[1-9]\d*|自身风险\s*[1-9]\d*|关联风险\s*[1-9]\d*/;
const LEGAL_DIRECT_DOMAINS = /court|zxgk|creditchina|gov\.cn|gsxt|wenshu/i;
const SEARCH_PAGE_DOMAINS = /(^|\.)((news|image|www|m)\.)?so\.com$|(^|\.)sogou\.com$|(^|\.)bing\.com$|(^|\.)baidu\.com$|(^|\.)duckduckgo\.com$|(^|\.)google\.com$/i;

function arr(value) {
  return Array.isArray(value) ? value : [];
}

async function mapLimit(items = [], limit = 3, handler = async () => null) {
  const list = arr(items);
  const results = new Array(list.length);
  let cursor = 0;
  async function worker() {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await handler(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, list.length || 1)) }, worker));
  return results;
}

function companyName(company = {}) {
  return company.standardName || company.companyName || company.name || company.query || "";
}

function coreName(name = "") {
  return String(name)
    .replace(/(股份有限公司|有限责任公司|集团有限公司|有限公司|公司)$/g, "")
    .replace(/[（）()·\-\s]/g, "");
}

function stockCodeOf(company = {}, text = "") {
  return (
    company.stockCode ||
    String([company.stockCode, company.ticker, company.industry, company.aiNeeds, text].filter(Boolean).join(" ")).match(/(?<!\d)(?:60|68|00|30|83|87|43|92)\d{4}(?!\d)/)?.[0] ||
    ""
  );
}

function relatedCompaniesFrom(text = "", mainName = "") {
  const matches = String(text).match(/[\u4e00-\u9fa5A-Za-z0-9（）()·-]{2,40}(?:股份有限公司|有限责任公司|集团有限公司|有限公司)/g) || [];
  const normalizedMain = normalizeText(mainName);
  return Array.from(new Set(matches.map((item) => item.trim()).filter((item) => normalizeText(item) !== normalizedMain))).slice(0, 8);
}

function buildContext(company = {}, text = "") {
  const name = companyName(company);
  return {
    name,
    core: coreName(name),
    stockCode: stockCodeOf(company, text),
    relatedCompanies: relatedCompaniesFrom(text, name)
  };
}

function textOfSource(source = {}) {
  return [source.title, source.snippet, source.text, source.url, source.query, source.usedFor].filter(Boolean).join(" ");
}

function detectCategories(text = "") {
  return CATEGORIES.filter((category) => category.terms.some((term) => String(text).includes(term)));
}

function directCompanyHit(text = "", ctx = {}) {
  const normalized = normalizeText(text);
  return Boolean(
    (ctx.name && normalized.includes(normalizeText(ctx.name))) ||
      (ctx.core && ctx.core.length >= 4 && normalized.includes(normalizeText(ctx.core))) ||
      (ctx.stockCode && normalized.includes(normalizeText(ctx.stockCode)))
  );
}

function directCompanyHitByName(text = "", name = "") {
  const normalized = normalizeText(text);
  const core = coreName(name);
  return Boolean(
    (name && normalized.includes(normalizeText(name))) ||
      (core && core.length >= 4 && normalized.includes(normalizeText(core)))
  );
}

function targetNameFromQueries(queries = []) {
  const first = arr(queries)[0] || "";
  return String(first)
    .replace(/限制高消费|限制消费|失信|被执行人|被执行|执行案件|诉讼|合同纠纷|开庭公告|裁判文书|未履行|债务|欠款|回款|股东|股权|实际控制人|股权变更|股权转让|持股|母公司|子公司|控股|二股东|营业收入|净利润|现金流|研发费用|员工数量|年报|财报|营收|利润|东方财富|同花顺|新浪财经|财务指标|企查查|爱企查|天眼查|水滴信用|风险|融资|投资|重大项目|政府补贴|公示|中标|招投标|采购|客户|36氪|创投|项目信息|科技型中小企业|专精特新/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function supportExcerpt(text = "", category) {
  const value = String(text || "").replace(/\s+/g, " ");
  const index = category.terms.map((term) => value.indexOf(term)).filter((item) => item >= 0).sort((a, b) => a - b)[0] ?? 0;
  return clip(value.slice(Math.max(0, index - 160), index + 520), 520);
}

function isSearchPage(url = "", domain = "") {
  const value = String(url || "").toLowerCase();
  return SEARCH_PAGE_DOMAINS.test(domain) || /\/search\?|\/s\?|\/web\?|\/ns\?|\/i\?/.test(value);
}

function officialTrusted(category, domain = "") {
  if (category.key === "legalRisk") return LEGAL_DIRECT_DOMAINS.test(domain);
  return category.trusted.test(domain);
}

function thirdPartyTrusted(category, domain = "") {
  return category.trusted.test(domain);
}

function legalCategoryHit(haystack = "", rawCategoryHit = false, noRiskHit = false, directTrusted = false) {
  if (!rawCategoryHit || noRiskHit) return false;
  if (directTrusted) return true;
  return POSITIVE_LEGAL_RISK_RE.test(haystack);
}

function classifyEvidence(source = {}, text = "", category, ctx = {}) {
  const url = canonicalSourceUrl(source.url);
  const domain = sourceDomain(url);
  if (!url || isSearchPage(url, domain)) return null;
  const haystack = [source.title, source.snippet, source.url, text].filter(Boolean).join(" ");
  const direct = directCompanyHit(haystack, ctx);
  const noRiskHit = category.key === "legalRisk" && NO_LEGAL_RISK_RE.test(haystack);
  const rawCategoryHit = category.terms.some((term) => haystack.includes(term));
  const directTrusted = officialTrusted(category, domain);
  const categoryHit = category.key === "legalRisk"
    ? legalCategoryHit(haystack, rawCategoryHit, noRiskHit, directTrusted)
    : rawCategoryHit && !noRiskHit;
  const trusted = thirdPartyTrusted(category, domain);
  if (!direct || (!categoryHit && !noRiskHit)) return null;
  if (!trusted && !directTrusted) return null;
  return {
    title: clip(String(source.title || url).replace(/\s+/g, " "), 140),
    url,
    domain,
    category: category.key,
    categoryLabel: category.label,
    supportLevel: directTrusted && (categoryHit || noRiskHit) ? "direct" : "third_party",
    confidence: directTrusted ? "高" : "中",
    directCompanyHit: direct,
    categoryHit,
    noRiskHit,
    excerpt: supportExcerpt(haystack, category),
    sourceType: category.key === "legalRisk" ? "敏感核验来源" : "专项核验来源",
    usedFor: `${category.label}核验`
  };
}

function statusFor(category, evidence = []) {
  const risk = evidence.filter((item) => item.categoryHit && !item.noRiskHit);
  const noRisk = evidence.filter((item) => item.noRiskHit);
  const directRisk = risk.filter((item) => item.supportLevel === "direct");
  const directNoRisk = noRisk.filter((item) => item.supportLevel === "direct");
  const riskDomains = new Set(risk.map((item) => item.domain));
  if (directRisk.length && directNoRisk.length) return "conflict";
  if (directRisk.length) return "verified";
  if (riskDomains.size >= 2) return "multi_source";
  if (risk.length) return "unverified";
  if (directNoRisk.length) return "not_found";
  return "not_found";
}

function dispositionFor(category, status) {
  if (status === "verified") return `${category.label}可进入风险结论，并触发评级风险闸门。`;
  if (status === "multi_source") return `${category.label}可作为第三方线索进入画像/风险提示，正式表述仍需会前核对。`;
  if (status === "conflict") return `${category.label}存在公开信息冲突，只进入信息冲突提醒，不自行裁决。`;
  if (status === "unverified") return `${category.label}只能进入未证实线索/会前核验清单，不进入确定结论。`;
  return `${category.label}未被公开证实；报告不输出相关确定风险结论。`;
}

function summaryFor(category, status, evidence = []) {
  if (status === "verified") return `系统已通过官方/法院/信用平台等直接来源核验到${category.label}线索。`;
  if (status === "multi_source") return `系统找到多个第三方来源支持${category.label}线索，仍建议会前核对口径。`;
  if (status === "conflict") return `公开来源对${category.label}存在冲突，报告不得自行裁决。`;
  if (status === "unverified") return `系统发现${category.label}线索，但未取得直接强证据。`;
  return evidence.some((item) => item.noRiskHit)
    ? `系统检索到公开来源显示暂未发现相关${category.label}。`
    : `系统已检索相关渠道，未公开证实${category.label}线索。`;
}

function statusLabelFor(status) {
  return status === "verified"
    ? "已证实"
    : status === "multi_source"
      ? "多源支持"
      : status === "conflict"
        ? "信息冲突"
        : status === "unverified"
          ? "未证实线索"
          : "未公开证实";
}

function normalizeEvidenceItem(item = {}, category, targetName = "") {
  const url = canonicalSourceUrl(item.url);
  const domain = sourceDomain(url);
  if (!url || isSearchPage(url, domain)) return null;
  const text = [item.title, item.excerpt, item.snippet, item.text, item.url].filter(Boolean).join(" ");
  if (targetName && !directCompanyHitByName([item.title, item.excerpt, item.snippet, item.text].filter(Boolean).join(" "), targetName)) return null;
  const noRiskHit = category.key === "legalRisk" && NO_LEGAL_RISK_RE.test(text);
  const rawCategoryHit = category.terms.some((term) => text.includes(term));
  const directTrusted = officialTrusted(category, domain);
  const categoryHit = category.key === "legalRisk"
    ? legalCategoryHit(text, rawCategoryHit, noRiskHit, directTrusted)
    : rawCategoryHit && !noRiskHit;
  const trusted = thirdPartyTrusted(category, domain);
  if (!trusted && !directTrusted) return null;
  if (!categoryHit && !noRiskHit) return null;
  return {
    ...item,
    url,
    domain,
    category: category.key,
    categoryLabel: category.label,
    categoryHit,
    noRiskHit,
    supportLevel: directTrusted ? "direct" : "third_party",
    confidence: directTrusted ? "高" : "中"
  };
}

function normalizeSensitiveCategory(categoryLike = {}) {
  const category = CATEGORIES.find((item) => item.key === categoryLike.key) || categoryLike;
  const targetName = targetNameFromQueries(categoryLike.searchedQueries);
  const evidence = uniqBy(
    arr(categoryLike.evidence)
      .map((item) => normalizeEvidenceItem(item, category, targetName))
      .filter(Boolean),
    (item) => item.url
  );
  const status = statusFor(category, evidence);
  return {
    ...categoryLike,
    label: categoryLike.label || category.label,
    status,
    statusLabel: statusLabelFor(status),
    summary: summaryFor(category, status, evidence),
    disposition: dispositionFor(category, status),
    evidence
  };
}

export function normalizeSensitiveVerification(verification = null) {
  if (!verification || verification.status === "none") return verification;
  const categories = arr(verification.categories).map(normalizeSensitiveCategory).filter(Boolean);
  return {
    ...verification,
    status: categories.length ? "checked" : "none",
    categories,
    warnings: categories.map((item) => `${item.label}：${item.summary}`)
  };
}

export function detectSensitiveInformation(sources = [], reportLike = null) {
  const text = [
    ...arr(sources).map(textOfSource),
    reportLike ? JSON.stringify(reportLike) : ""
  ].join("\n");
  return detectCategories(text).map((category) => category.key);
}

export async function verifySensitiveInformation(company = {}, sources = [], reportLike = null, onProgress = async () => {}) {
  const triggerText = [
    ...arr(sources).map(textOfSource),
    reportLike ? JSON.stringify(reportLike) : ""
  ].join("\n");
  const categories = detectCategories(triggerText);
  const ctx = buildContext(company, triggerText);
  if (!ctx.name || !categories.length) {
    return {
      status: "none",
      categories: [],
      supplementalSources: [],
      searchedChannels: [],
      warnings: []
    };
  }

  const categoryResults = await mapLimit(categories, 3, async (category, index) => {
    const queries = Array.from(new Set(category.queries(ctx).filter(Boolean))).slice(0, 8);
    await onProgress(76 + index, `资料核验：${category.label}`, {
      phaseKey: "quality",
      detail: `正在核对${category.label}相关公开资料。只有已证实或需要关注的结果会进入报告。`,
      completed: index,
      total: categories.length
    });
    const searchRows = await mapLimit(queries, 3, (query) => searchWeb(query, 8, `${category.label}核验`, 12000));
    const found = searchRows.flat();
    const candidates = uniqBy(found, (item) => canonicalSourceUrl(item.url)).slice(0, 18);
    const rows = await mapLimit(candidates, 4, async (candidate) => {
      const text = await readSource(candidate.url);
      const item = classifyEvidence(candidate, text, category, ctx);
      if (!item) return null;
      return {
        evidence: item,
        source: {
          ...candidate,
          url: item.url,
          title: item.title,
          text: clip(text, 7000),
          topic: category.key === "financeMetric" ? "经营规模与财务" : "企业主体与本地信息",
          sourceType: item.sourceType,
          confidence: item.confidence,
          relevanceReason: `${category.label}二次核验：${item.supportLevel === "direct" ? "直接命中目标企业" : "第三方线索"}`,
          readable: Boolean(text && text.length > 200),
          isCompanySpecific: true,
          usedFor: item.usedFor
        }
      };
    });
    const accepted = rows.filter(Boolean);
    const evidence = accepted.map((row) => row.evidence);
    const status = statusFor(category, evidence);
    return {
      result: {
        key: category.key,
        label: category.label,
        status,
        statusLabel: statusLabelFor(status),
        matchedTerms: category.terms.filter((term) => triggerText.includes(term)),
        searchedQueries: queries,
        summary: summaryFor(category, status, evidence),
        disposition: dispositionFor(category, status),
        evidence: evidence.slice(0, 8)
      },
      supplementalSources: accepted.map((row) => row.source)
    };
  });
  const results = categoryResults.map((item) => item.result);
  const supplementalSources = categoryResults.flatMap((item) => item.supplementalSources);
  return {
    status: "checked",
    categories: results,
    supplementalSources: uniqBy(supplementalSources, (item) => item.url),
    searchedChannels: Array.from(new Set(results.flatMap((item) => item.searchedQueries))),
    warnings: results.map((item) => `${item.label}：${item.summary}`)
  };
}

export function mergeSensitiveVerifications(...items) {
  const categories = [];
  for (const item of items.filter(Boolean)) {
    for (const category of arr(item.categories)) {
      const existing = categories.find((entry) => entry.key === category.key);
      if (!existing) categories.push({ ...category });
      else {
        existing.evidence = uniqBy([...(existing.evidence || []), ...(category.evidence || [])], (source) => source.url);
        existing.searchedQueries = Array.from(new Set([...(existing.searchedQueries || []), ...(category.searchedQueries || [])]));
        const statuses = [existing.status, category.status];
        existing.status = statuses.includes("conflict")
          ? "conflict"
          : statuses.includes("verified")
            ? "verified"
            : statuses.includes("multi_source")
              ? "multi_source"
              : statuses.includes("unverified")
                ? "unverified"
                : "not_found";
        const categoryDef = CATEGORIES.find((entry) => entry.key === existing.key) || existing;
        Object.assign(existing, normalizeSensitiveCategory({
          ...existing,
          label: existing.label || categoryDef.label
        }));
      }
    }
  }
  return normalizeSensitiveVerification({
    status: categories.length ? "checked" : "none",
    categories,
    supplementalSources: uniqBy(items.flatMap((item) => arr(item?.supplementalSources)), (source) => source.url),
    searchedChannels: Array.from(new Set(items.flatMap((item) => arr(item?.searchedChannels)))),
    warnings: categories.map((item) => `${item.label}：${item.summary}`)
  });
}

function categoryStatus(verification, key) {
  return arr(verification?.categories).find((item) => item.key === key)?.status || "";
}

function replaceUnsupportedSensitiveText(value, verification) {
  if (typeof value !== "string" || !LEGAL_RISK_RE.test(value)) return value;
  const legalStatus = categoryStatus(verification, "legalRisk");
  const confirmed = ["verified", "multi_source"].includes(legalStatus);
  if (confirmed) return value;
  if (/限制高消费|限制消费|失信|被执行|合同纠纷|债务|欠款|回款困难|付款风险|信用风险|未履行/.test(value)) {
    return "系统未能通过公开来源证实信用/法律风险，建议会前核对企业信用记录、付款条件和项目预算。";
  }
  return value;
}

function walk(value, verification) {
  if (typeof value === "string") return replaceUnsupportedSensitiveText(value, verification);
  if (Array.isArray(value)) return value.map((item) => walk(item, verification));
  if (value && typeof value === "object") {
    let sensitiveTextWasRewritten = false;
    const mapped = Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const next = walk(item, verification);
        if (typeof item === "string" && next !== item && LEGAL_RISK_RE.test(item)) sensitiveTextWasRewritten = true;
        return [key, next];
      })
    );
    if (sensitiveTextWasRewritten) {
      delete mapped.sourceIds;
      delete mapped.sources;
      delete mapped.evidenceSourceIds;
      delete mapped.annualPage;
      delete mapped.annualReportPage;
    }
    return mapped;
  }
  return value;
}

export function applySensitiveVerification(report = {}, verification = null) {
  if (!verification || verification.status === "none") return report;
  const normalizedVerification = normalizeSensitiveVerification(verification);
  const next = walk(report, normalizedVerification);
  const legal = arr(normalizedVerification.categories).find((item) => item.key === "legalRisk");
  const legalDirectNoRisk = arr(legal?.evidence).some((item) => item.noRiskHit && item.supportLevel === "direct");
  const warnings = arr(next.qualityWarnings).filter((item) => !String(item || "").startsWith("敏感信息核验："));
  for (const category of arr(normalizedVerification.categories)) {
    warnings.push(`敏感信息核验：${category.summary}`);
  }
  const preMeeting = arr(next.requirements?.preMeeting);
  if (legal && !["verified", "multi_source"].includes(legal.status) && !legalDirectNoRisk) {
    preMeeting.push("系统未能公开证实信用/法律风险线索，建议会前核对企业信用记录、付款条件和项目预算。");
  }
  return {
    ...next,
    sensitiveVerification: normalizedVerification,
    qualityWarnings: Array.from(new Set(warnings)),
    requirements: {
      ...(next.requirements || {}),
      preMeeting: Array.from(new Set(preMeeting))
    }
  };
}
