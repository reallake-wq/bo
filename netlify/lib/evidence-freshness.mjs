function arr(value) {
  return Array.isArray(value) ? value : [];
}

function compact(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function uniq(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function monthDiff(from, to) {
  if (!(from instanceof Date) || Number.isNaN(from.getTime())) return null;
  if (!(to instanceof Date) || Number.isNaN(to.getTime())) return null;
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

function endOfPeriod(year, kind = "", month = 12) {
  const y = Number(year);
  if (!Number.isFinite(y)) return null;
  const labelKind = String(kind || "");
  let m = Number(month || 12);
  let d = 31;
  if (/一季|第一季|Q1/i.test(labelKind)) {
    m = 3;
    d = 31;
  } else if (/上半年|半年|Q2/i.test(labelKind)) {
    m = 6;
    d = 30;
  } else if (/前三季|三季|Q3/i.test(labelKind)) {
    m = 9;
    d = 30;
  } else if (/Q4/i.test(labelKind)) {
    m = 12;
    d = 31;
  } else if (m >= 1 && m <= 12) {
    d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  return new Date(Date.UTC(y, Math.max(1, Math.min(12, m)) - 1, d));
}

export function extractFactPeriods(value = "") {
  const text = String(value || "");
  const periods = [];
  const namedPeriod = /(20\d{2})\s*年\s*(前三季(?:度)?|三季(?:度|报)?|一季(?:度|报)?|第一季(?:度)?|上半年|半年(?:报)?|年报|年度|全年)/g;
  for (const match of text.matchAll(namedPeriod)) {
    periods.push({
      label: `${match[1]}年${match[2]}`,
      periodEnd: endOfPeriod(match[1], match[2]),
      source: "fact-period"
    });
  }
  const quarterPeriod = /(20\d{2})\s*(?:Q|q)([1-4])/g;
  for (const match of text.matchAll(quarterPeriod)) {
    periods.push({
      label: `${match[1]}Q${match[2]}`,
      periodEnd: endOfPeriod(match[1], `Q${match[2]}`),
      source: "fact-period"
    });
  }
  const monthPeriod = /截至\s*(20\d{2})\s*年\s*(\d{1,2})\s*月(?:末|底)?/g;
  for (const match of text.matchAll(monthPeriod)) {
    periods.push({
      label: `截至${match[1]}年${match[2]}月`,
      periodEnd: endOfPeriod(match[1], "", match[2]),
      source: "fact-period"
    });
  }
  return periods
    .filter((item) => item.periodEnd && !Number.isNaN(item.periodEnd.getTime()))
    .sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime());
}

function sourceDate(source = {}) {
  const text = [source.publishedAt, source.publishedTime, source.date, source.noticeDate, source.snippet, source.title]
    .map((item) => String(item || ""))
    .join(" ");
  const published = text.match(/Published Time:\s*(20\d{2})-(\d{1,2})-(\d{1,2})/i);
  if (published) return new Date(Date.UTC(Number(published[1]), Number(published[2]) - 1, Number(published[3])));
  const iso = text.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  return null;
}

function freshnessOf(periodEnd, now = new Date()) {
  const months = monthDiff(periodEnd, now);
  if (months == null) return { status: "unknown", months: null, label: "未识别数据期" };
  if (months <= 6) return { status: "current", months, label: "近期数据" };
  if (months <= 12) return { status: "usable", months, label: "可用数据" };
  if (months <= 18) return { status: "stale", months, label: "旧数据线索" };
  return { status: "historical", months, label: "历史线索" };
}

function currentRiskSignal(text = "") {
  const value = compact(text);
  return /(风险|预算|付款|回款|支付|利润|亏损|现金流|负债|债务|融资|授信|数字化预算|IT预算|采购预算|经营压力|资金压力|压缩|收紧|困难|不确定|谨慎|拖累|限制)/.test(value);
}

function directRiskPrediction(text = "") {
  const value = compact(text);
  return /(可能|或将|预计|大概率|会|将).{0,18}(收紧|压缩|限制|影响|拖累|削减).{0,18}(预算|付款|投入|IT预算|数字化预算|采购)|回款困难|付款困难|支付能力.{0,12}(弱|差|不足)|预算.{0,12}(收紧|压缩|不足)/.test(value);
}

function financeSignal(text = "") {
  return /(营收|营业收入|收入|销售额|净利润|归母净利润|扣非净利润|利润|亏损|现金流|负债|资产负债|毛利率|研发投入|财务|年报|季报|三季报|半年报)/.test(
    compact(text)
  );
}

function entityScope(text = "", company = {}) {
  const value = compact(text);
  const target = compact(company.standardName || company.targetCompanyName || company.name || company.query || "");
  if (/母公司|集团|控股集团|上级公司|股东|控股方|关联公司/.test(value)) return "parent_or_group";
  if (target && value.includes(target)) return "target";
  return "unknown";
}

function removeDirectCurrentRisk(text = "") {
  let value = compact(text)
    .replace(/^风险[:：]\s*/g, "")
    .replace(/^主要风险[:：]\s*/g, "");
  value = value.replace(/[，,；;]?\s*(可能|或将|预计|大概率|会|将).{0,30}(收紧|压缩|限制|影响|拖累|削减).{0,30}(预算|付款|投入|IT预算|数字化预算|采购)[^。；;]*/g, "");
  value = value.replace(/[，,；;]?\s*(可能|或将|预计|大概率|会|将).{0,28}(回款困难|付款困难|支付困难)[^。；;]*/g, "");
  value = value.replace(/[。；;]\s*$/g, "");
  return value || compact(text).replace(/^风险[:：]\s*/g, "");
}

function removeExistingFreshnessGuard(text = "") {
  let value = compact(text);
  value = value
    .replace(/^(?:历史集团线索\s*[：:]\s*)+/g, "")
    .replace(/^(?:历史财务线索\s*[：:]\s*)+/g, "")
    .replace(/^(?:历史集团财务线索\s*[：:]\s*)+/g, "");
  value = value.replace(/(?:该数据期为[^。；;]*(?:；建议核对最新财务、预算归属和项目资金来源)?。?)+/g, "");
  value = value.replace(/[。；;\s]+$/g, "").trim();
  return value || compact(text);
}

export function analyzeTextFreshness(value = "", context = {}) {
  const text = compact(value);
  const now = context.now instanceof Date ? context.now : new Date(context.now || Date.now());
  const periods = extractFactPeriods(text);
  const latestPeriod = periods[0] || null;
  const freshness = latestPeriod ? freshnessOf(latestPeriod.periodEnd, now) : { status: "unknown", months: null, label: "未识别数据期" };
  const scope = entityScope(text, context.company || {});
  const hasStalePeriod = ["stale", "historical"].includes(freshness.status);
  const isFinance = financeSignal(text);
  const isRisk = currentRiskSignal(text);
  return {
    text,
    periods,
    latestPeriod,
    freshness,
    scope,
    isFinance,
    isRisk,
    isDirectCurrentRisk: directRiskPrediction(text),
    shouldGuard: Boolean(latestPeriod && hasStalePeriod && isFinance && isRisk)
  };
}

function rewriteFreshnessGuardedText(value = "", analysis, context = {}) {
  if (!analysis?.shouldGuard) return value;
  const original = compact(value);
  const guardFreeOriginal = removeExistingFreshnessGuard(original);
  const periodLabel = analysis.latestPeriod?.label || "较早报告期";
  const monthsText = Number.isFinite(analysis.freshness?.months) ? `，距当前约${analysis.freshness.months}个月` : "";
  const scopeText =
    analysis.scope === "parent_or_group"
      ? "，且属于母公司/集团层面的间接线索"
      : analysis.scope === "unknown"
        ? "，且主体归属需核对"
        : "";
  const factText = removeDirectCurrentRisk(guardFreeOriginal);
  const guard = `该数据期为${periodLabel}${monthsText}${scopeText}，不能直接推断当前预算、付款或数字化投入状态`;
  if (analysis.isDirectCurrentRisk || /^风险[:：]/.test(original) || /^主要风险[:：]/.test(original)) {
    return `历史财务线索：${factText}。${guard}；建议核对最新财务、预算归属和项目资金来源。`;
  }
  if (analysis.scope === "parent_or_group") {
    return `历史集团线索：${factText}。${guard}。`;
  }
  return `历史财务线索：${factText}。${guard}。`;
}

function guardString(value, context, rewrites) {
  if (typeof value !== "string") return value;
  const analysis = analyzeTextFreshness(value, context);
  if (!analysis.shouldGuard) return value;
  const rewritten = rewriteFreshnessGuardedText(value, analysis, context);
  if (rewritten !== value) {
    rewrites.push({
      from: compact(value).slice(0, 180),
      to: compact(rewritten).slice(0, 220),
      period: analysis.latestPeriod?.label || "",
      freshness: analysis.freshness?.status || "unknown",
      scope: analysis.scope
    });
  }
  return rewritten;
}

function guardArray(values, context, rewrites) {
  return arr(values).map((item) => guardValue(item, context, rewrites));
}

function guardObject(object, context, rewrites) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return object;
  const next = { ...object };
  for (const key of Object.keys(next)) {
    if (
      [
        "body",
        "summary",
        "insight",
        "note",
        "sourceBasis",
        "reasoning",
        "customerPain",
        "value",
        "why",
        "claim",
        "basis",
        "aiEntry",
        "risk",
        "title"
      ].includes(key)
    ) {
      next[key] = guardValue(next[key], context, rewrites);
    } else if (["facts", "toConfirm", "validationSignals", "deductions", "evidence", "riskFlags", "uncertainties"].includes(key)) {
      next[key] = guardArray(next[key], context, rewrites);
    }
  }
  return next;
}

function guardValue(value, context, rewrites) {
  if (typeof value === "string") return guardString(value, context, rewrites);
  if (Array.isArray(value)) return guardArray(value, context, rewrites);
  if (value && typeof value === "object") return guardObject(value, context, rewrites);
  return value;
}

function guardCustomerInsights(insights, context, rewrites) {
  if (!insights || typeof insights !== "object") return insights;
  const next = { ...insights };
  for (const key of ["localCards", "groupCards", "metrics", "digitalCards", "decisionCards", "riskCards"]) {
    if (key in next) next[key] = guardArray(next[key], context, rewrites);
  }
  return next;
}

function guardRounds(rounds, context, rewrites) {
  return arr(rounds).map((round) => ({
    ...round,
    conclusions: guardArray(round.conclusions, context, rewrites),
    customerInfo: guardArray(round.customerInfo, context, rewrites),
    painsAndOpportunities: guardArray(round.painsAndOpportunities, context, rewrites),
    solutionCards: guardArray(round.solutionCards, context, rewrites),
    questionnaire: guardValue(round.questionnaire, context, rewrites),
    internalNotes: guardArray(round.internalNotes, context, rewrites)
  }));
}

export function annotateSourceFreshness(source = {}, context = {}) {
  const text = compact(`${source.title || ""} ${source.snippet || ""} ${source.text || ""}`);
  const analysis = analyzeTextFreshness(text, context);
  const published = sourceDate(source);
  return {
    ...source,
    factPeriod: analysis.latestPeriod?.label || source.factPeriod || "",
    factFreshness: analysis.latestPeriod ? analysis.freshness.status : source.factFreshness || "",
    sourcePublishedAt: published ? published.toISOString().slice(0, 10) : source.sourcePublishedAt || ""
  };
}

export function applyFreshnessGuardrails(report = {}, options = {}) {
  const company = {
    ...(options.company || {}),
    standardName: report.standardName || report.targetCompanyName || report.companyName || options.company?.standardName || "",
    targetCompanyName: report.targetCompanyName || report.standardName || options.company?.targetCompanyName || ""
  };
  const context = {
    company,
    now: options.now || report.generatedAt || report.updatedAt || new Date()
  };
  const rewrites = [];
  const next = {
    ...report,
    quickCards: guardArray(report.quickCards, context, rewrites),
    conclusions: guardArray(report.conclusions, context, rewrites),
    customerInsights: guardCustomerInsights(report.customerInsights, context, rewrites),
    pains: guardArray(report.pains, context, rewrites),
    solutions: guardArray(report.solutions, context, rewrites),
    requirements: guardValue(report.requirements, context, rewrites),
    internalNotes: guardArray(report.internalNotes, context, rewrites),
    sourceBriefs: guardArray(report.sourceBriefs, context, rewrites),
    rounds: guardRounds(report.rounds, context, rewrites),
    sources: arr(report.sources).map((source) => annotateSourceFreshness(source, context))
  };
  const prior = report.evidenceFreshness || {};
  const warnings = rewrites.length
    ? [
        `已对 ${rewrites.length} 条旧财务/预算线索做时间新鲜度审计：超过12个月或母公司层面的数据仅作为历史/间接线索，不直接写成当前预算风险。`
      ]
    : [];
  next.evidenceFreshness = {
    ...prior,
    checkedAt: new Date().toISOString(),
    staleRiskCount: rewrites.length,
    rewrites: rewrites.slice(0, 20)
  };
  next.qualityWarnings = uniq([...(report.qualityWarnings || []), ...warnings]);
  return next;
}
