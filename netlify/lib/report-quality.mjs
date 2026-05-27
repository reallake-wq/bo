import { normalizeText, clip, uniqBy } from "./util.mjs";
import { canonicalSourceUrl } from "./source-audit.mjs";

export const RECENT_REPORT_DAYS = 7;
export const FORMAL_SOURCE_MIN = 15;
export const BRIEF_SOURCE_MIN = 10;
export const LIMITED_SOURCE_MIN = 0;
export const MIN_TOPIC_COVERAGE = 3;
export const MIN_TOPIC_COVERAGE_FOR_LIMITED = 1;
export const MIN_READABLE_FOR_FORMAL = 10;
export const MIN_READABLE_FOR_LIMITED = 3;

export const TOPIC_NAMES = [
  "企业主体与本地信息",
  "经营规模与财务",
  "产品客户与市场压力",
  "数字化与AI线索",
  "痛点证据与方案机会"
];

export function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

export function cleanUrl(value) {
  return canonicalSourceUrl(value) || String(value || "").trim().replace(/[),.;，。]+$/g, "");
}

export function primaryCompanyName(value = {}) {
  return value.standardName || value.companyName || value.name || value.query || "";
}

export function companyKey(value = {}) {
  const name = primaryCompanyName(value);
  const region = value.region || "";
  return normalizeText(`${name}|${region}`);
}

export function withinDays(dateValue, days = RECENT_REPORT_DAYS) {
  const time = Date.parse(dateValue || "");
  if (!Number.isFinite(time)) return false;
  return Date.now() - time <= days * 24 * 60 * 60 * 1000;
}

export function normalizeReportSources(sources = [], max = 32) {
  return uniqBy(
    sources
      .map((source) => ({
        title: String(source.title || source.url || "资料来源").replace(/\s+/g, " ").trim().slice(0, 140),
        url: cleanUrl(source.url),
        confidence: source.confidence || "中",
        usedFor: source.usedFor || source.topic || source.query || "公开信息核验",
        query: source.query || "",
        topic: source.topic || "",
        sourceType: source.sourceType || "",
        domain: source.domain || "",
        relevanceReason: source.relevanceReason || "",
        relevanceScore: source.relevanceScore ?? "",
        isCompanySpecific: Boolean(source.isCompanySpecific),
        readable: Boolean(source.readable || String(source.text || "").length > 200),
        evidenceTier: source.evidenceTier || evidenceTierOf(source),
        text: source.text || ""
      }))
      .filter((source) => isHttpUrl(source.url)),
    (source) => source.url
  ).slice(0, max);
}

export function evidenceTierOf(source = {}) {
  const confidence = String(source.confidence || "");
  const sourceType = String(source.sourceType || "");
  if (/弱|线索|行业背景/.test(sourceType) || confidence === "低") return "weak";
  if (confidence === "高" || /财务硬来源|主体核对来源/.test(sourceType)) return "high";
  return "medium";
}

export function buildEvidencePool(sources = []) {
  const normalized = normalizeReportSources(sources, 200);
  const high = normalized.filter((source) => evidenceTierOf(source) === "high");
  const medium = normalized.filter((source) => evidenceTierOf(source) === "medium");
  const weak = normalized.filter((source) => evidenceTierOf(source) === "weak");
  return {
    highConfidenceCount: high.length,
    mediumConfidenceCount: medium.length,
    weakClueCount: weak.length,
    totalEvidenceCount: normalized.length,
    label: `高置信 ${high.length} 条｜中置信 ${medium.length} 条｜弱线索 ${weak.length} 条`,
    highConfidenceSourceIds: high.map((source, index) => source.sourceId || index + 1).slice(0, 20),
    mediumConfidenceSourceIds: medium.map((source, index) => source.sourceId || index + 1).slice(0, 20),
    weakClueSourceIds: weak.map((source, index) => source.sourceId || index + 1).slice(0, 20)
  };
}

function hasPainEvidenceSignal(source = {}) {
  const text = [
    source.topic,
    source.usedFor,
    source.query,
    source.title,
    source.snippet,
    source.relevanceReason,
    source.text
  ].join(" ");
  return /痛点|质量|追溯|返工|故障|设备|工艺|排产|交付|供应链|成本|合规|数据安全|研发|DFM|可制造性|缺陷|异常|停线|缺料|换线|库存|良率|OEE|IATF|召回|售后|投诉|traceability|quality|delivery|maintenance|downtime|defect|manufacturability|schedule|planning|risk|cost/i.test(text);
}

export function evaluateSourceQuality(sources = []) {
  const verifiedSources = normalizeReportSources(sources, 200);
  const readableSources = verifiedSources.filter((source) => source.readable);
  const evidencePool = buildEvidencePool(verifiedSources);
  const coveredTopicSet = new Set(verifiedSources.map((source) => source.topic).filter(Boolean));
  const painSignalCount = verifiedSources.filter(hasPainEvidenceSignal).length;
  if (painSignalCount > 0) coveredTopicSet.add(TOPIC_NAMES[4]);
  const coveredTopics = Array.from(coveredTopicSet);
  const missingTopics = TOPIC_NAMES.filter((topic) => !coveredTopics.includes(topic));
  const verifiedSourceCount = verifiedSources.length;
  const readableSourceCount = readableSources.length;
  const topicCoverageCount = coveredTopics.length;
  const qualityWarnings = [];

  if (verifiedSourceCount < FORMAL_SOURCE_MIN) {
    qualityWarnings.push(`可校验来源 ${verifiedSourceCount} 条，低于正式报告门槛 ${FORMAL_SOURCE_MIN} 条。`);
  }
  if (verifiedSourceCount === 0) {
    qualityWarnings.push("未取得可校验公开链接，将生成证据不足版；正文只保留待确认问题和用户提供线索，不输出无证据强结论。");
  } else if (verifiedSourceCount < BRIEF_SOURCE_MIN) {
    qualityWarnings.push(`可校验来源 ${verifiedSourceCount} 条，低于简版报告门槛 ${BRIEF_SOURCE_MIN} 条，将生成证据不足版，仅供会前参考。`);
  }
  if (readableSourceCount < MIN_READABLE_FOR_FORMAL) {
    qualityWarnings.push(`可读来源 ${readableSourceCount} 条，证据厚度不足。`);
  }
  if (topicCoverageCount < MIN_TOPIC_COVERAGE_FOR_LIMITED) {
    qualityWarnings.push(`来源只覆盖 ${topicCoverageCount} 类主题，低于有限资料版最低要求 ${MIN_TOPIC_COVERAGE_FOR_LIMITED} 类。`);
  } else if (topicCoverageCount < MIN_TOPIC_COVERAGE) {
    qualityWarnings.push(`来源只覆盖 ${topicCoverageCount} 类主题，低于正式/简版报告要求 ${MIN_TOPIC_COVERAGE} 类，将生成证据不足版。`);
  }
  if (missingTopics.length) {
    qualityWarnings.push(`缺少主题覆盖：${missingTopics.join("、")}。`);
  }

  let qualityLevel = "formal";
  let qualityLabel = "正式报告";
  if (verifiedSourceCount < BRIEF_SOURCE_MIN || topicCoverageCount < MIN_TOPIC_COVERAGE) {
    qualityLevel = "limited";
    qualityLabel = "证据不足版";
  } else if (verifiedSourceCount < FORMAL_SOURCE_MIN || readableSourceCount < MIN_READABLE_FOR_FORMAL) {
    qualityLevel = "brief";
    qualityLabel = "简版报告";
  }

  return {
    qualityLevel,
    qualityLabel,
    verifiedSourceCount,
    readableSourceCount,
    topicCoverageCount,
    coveredTopics,
    missingTopics,
    qualityWarnings,
    evidencePool,
    topicCoverageSignals: {
      painSignalCount
    },
    canGenerateReport: true
  };
}

export function buildDiagnosticReport(company, sources, quality) {
  const standardName = primaryCompanyName(company) || "未命名企业";
  const verifiedSources = normalizeReportSources(sources, 32).map(({ text, readable, ...source }) => source);
  return {
    standardName,
    aliases: company.aliases || [],
    region: company.region || "",
    industry: company.industry || "",
    quickCards: [
      {
        title: "资料不足",
        body: "本次只能形成证据不足版会前参考。",
        insight: `可校验来源 ${quality.verifiedSourceCount} 条，主题覆盖 ${quality.topicCoverageCount} 类。`
      },
      {
        title: "风险控制",
        body: "无证据内容只进入待确认，不写成客户事实。",
        insight: "避免模型基于行业常识补全客户事实。"
      }
    ],
    conclusions: [
      {
        title: "检索未达门槛",
        body: "公开来源不足以支撑客户认知、经营痛点和方案建议。建议补充官网、地区、行业或客户简称后重新生成。"
      }
    ],
    customerInsights: { localCards: [], groupCards: [], metrics: [], digitalCards: [] },
    pains: [],
    solutions: [],
    requirements: {
      preMeeting: [
        "补充客户官网或集团官网。",
        "补充客户所在地区、行业、工厂/子公司全称。",
        "补充已知产品线、会议主题或参会部门。"
      ],
      onSite: ["现场先确认客户主体、业务线、参会角色和本次交流目标。"]
    },
    diagnosis: {
      title: "检索诊断",
      summary: "来源不足，系统只生成证据不足版，并列明检索缺口。",
      warnings: quality.qualityWarnings,
      coveredTopics: quality.coveredTopics,
      missingTopics: quality.missingTopics,
      triedSourceCount: sources.length,
      verifiedSourceCount: quality.verifiedSourceCount,
      readableSourceCount: quality.readableSourceCount,
      topicCoverageCount: quality.topicCoverageCount
    },
    sources: verifiedSources,
    evidencePool: quality.evidencePool,
    keywords: [standardName, company.region, company.industry].filter(Boolean),
    qualityLevel: quality.qualityLevel,
    qualityLabel: quality.qualityLabel,
    qualityWarnings: quality.qualityWarnings,
    verifiedSourceCount: quality.verifiedSourceCount,
    readableSourceCount: quality.readableSourceCount,
    topicCoverageCount: quality.topicCoverageCount
  };
}

export function qualityStatusText(report) {
  if (report.qualityLevel === "diagnostic") return "诊断";
  if (report.qualityLevel === "limited") return "有限资料";
  if (report.qualityLevel === "brief") return "简版";
  return "正式";
}

export function formatQualityWarnings(warnings = []) {
  return warnings.map((item) => clip(item, 160));
}
