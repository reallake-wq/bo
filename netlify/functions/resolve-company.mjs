import { fail, json, readBody, requireText } from "../lib/http.mjs";
import { getIndex } from "../lib/store.mjs";
import { normalizeText, scoreMatch } from "../lib/util.mjs";
import { qualityStatusText } from "../lib/report-quality.mjs";
import { resolveCandidates } from "../lib/research.mjs";
import { hasTianyanchaKey } from "../lib/tianyancha.mjs";
import { withOacRequestContext } from "../lib/auth.mjs";

function normalizeCandidateName(value = "") {
  return normalizeText(String(value || "").replace(/(股份有限公司|有限责任公司|集团有限公司|有限公司|公司)$/g, ""));
}

function extractStockCode(...values) {
  return values.map((item) => String(item || "")).join(" ").match(/(?<!\d)(?:60|68|00|30|83|87|43|92)\d{4}(?!\d)/)?.[0] || "";
}

function boostWithAnnualReport(candidates, query, region, industry, annualReportSummary) {
  if (!annualReportSummary?.annualReportId) return candidates;
  const queryKey = normalizeCandidateName(query);
  const boosted = candidates.map((candidate) => {
    const candidateKey = normalizeCandidateName(candidate.standardName || candidate.name);
    const nameMatch = candidateKey && queryKey && (candidateKey.includes(queryKey) || queryKey.includes(candidateKey));
    if (!nameMatch) return candidate;
    return {
      ...candidate,
      confidence: Math.max(Number(candidate.confidence || 0), 96),
      reason: `${candidate.reason || "候选企业主体"} 已接入用户上传年报《${annualReportSummary.fileName || "年报 PDF"}》，主体可信度提升。`,
      scoreBreakdown: {
        ...(candidate.scoreBreakdown || {}),
        annualReportMatch: true
      }
    };
  });
  const inputCandidate = {
    name: query,
    standardName: query,
    region,
    industry,
    stockCode: extractStockCode(query, region, industry),
    website: "",
    confidence: 97,
    reason: `已按输入企业名称建立候选，并接入用户上传年报《${annualReportSummary.fileName || "年报 PDF"}》作为强证据。`,
    sourceUrls: [],
    scoreBreakdown: {
      nameMatch: true,
      stockCodeMatch: Boolean(extractStockCode(query, region, industry)),
      regionMatch: Boolean(region),
      industryMatch: Boolean(industry),
      annualReportMatch: true,
      trustedSources: 1,
      negativeSources: 0
    }
  };
  return [inputCandidate, ...boosted.filter((candidate) => normalizeCandidateName(candidate.standardName || candidate.name) !== queryKey)]
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))
    .slice(0, 5);
}

function dedupeCandidates(candidates = []) {
  const seen = new Map();
  for (const candidate of candidates || []) {
    const name = candidate.standardName || candidate.name || "";
    const key = [
      normalizeCandidateName(name),
      normalizeText(candidate.region || ""),
      normalizeText(candidate.industry || "")
    ].join("|");
    if (!key.replace(/\|/g, "")) continue;
    const existing = seen.get(key);
    if (existing) {
      existing.sourceUrls = Array.from(new Set([...(existing.sourceUrls || []), ...(candidate.sourceUrls || [])]));
      existing.confidence = Math.max(Number(existing.confidence || 0), Number(candidate.confidence || 0));
      existing.reason = existing.reason || candidate.reason || "";
      existing.sourcesMerged = Math.max(Number(existing.sourcesMerged || 1), existing.sourceUrls.length || 1);
      continue;
    }
    seen.set(key, {
      ...candidate,
      sourcesMerged: Math.max(1, (candidate.sourceUrls || []).length || 1)
    });
  }
  return Array.from(seen.values()).sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
}

function dedupeLatest(reports) {
  const seen = new Set();
  const out = [];
  for (const report of reports) {
    const key =
      report.companyKey ||
      normalizeText(`${report.standardName || report.companyName || ""}|${report.region || ""}`);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(report);
  }
  return out;
}

function candidateFromReport(report) {
  const sourceCount = Number(report.verifiedSourceCount || report.sourceCount || 0);
  const isDiagnostic = report.qualityLevel === "diagnostic" || sourceCount <= 0;
  return {
    name: report.companyName || report.standardName,
    standardName: report.standardName || report.companyName,
    region: report.region || "",
    industry: report.industry || "",
    website: "",
    confidence: isDiagnostic ? 45 : Math.min(95, Math.max(70, Number(report.matchScore || 0))),
    reason: isDiagnostic
      ? "历史记录仅为来源不足诊断页，不作为企业主体确认依据。"
      : "已命中历史报告，可直接复用或重新生成。",
    sourceUrls: []
  };
}

function canUseAsResolvedSubject(report) {
  const sourceCount = Number(report.verifiedSourceCount || report.sourceCount || 0);
  return report.qualityLevel !== "diagnostic" && sourceCount > 0;
}

function isSameCompanyCacheHit(report, query) {
  const queryKey = normalizeText(query);
  const names = [
    report.standardName,
    report.companyName,
    ...(report.aliases || [])
  ].map((item) => normalizeText(item)).filter(Boolean);
  return names.some((name) => name === queryKey || name.includes(queryKey) || queryKey.includes(name));
}

export default async function handler(request) {
  try {
    return await withOacRequestContext(request, async () => {
    const body = await readBody(request);
    const query = requireText(body.query, "企业名称");
    const region = String(body.region || "").trim();
    const industry = String(body.industry || "").trim();
    const annualReportSummary = body.annualReportSummary || null;
    const queryKey = normalizeText(query);
    const fuzzyCacheThreshold = Math.max(8, Math.ceil(queryKey.length * 0.75));

    const index = await getIndex();
    const cached = dedupeLatest(
      (index.reports || [])
        .map((report) => ({
          ...report,
          opportunityRating: report.opportunityRating || { status: "not_rated", label: "暂不评级" },
          qualityText: qualityStatusText(report),
          matchScore: scoreMatch(report, query)
        }))
        .filter((report) => report.matchScore >= 100 || isSameCompanyCacheHit(report, query))
        .sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)))
        .sort((a, b) => b.matchScore - a.matchScore)
    ).slice(0, 8);

    const exactCached = cached.filter(
      (report) => Number(report.matchScore || 0) >= 100 && canUseAsResolvedSubject(report)
    );

    try {
      const resolved = await resolveCandidates(query, region, industry, body.aiNeeds || "");
      return json({
        ok: true,
        candidates: dedupeCandidates(boostWithAnnualReport(resolved.candidates || [], query, region, industry, annualReportSummary)),
        cached,
        model: resolved.model,
        channel: resolved.channel,
        tianyanchaDiagnostic: resolved.tianyanchaDiagnostic || null
      });
    } catch (error) {
      const tianyanchaConfigured = hasTianyanchaKey();
      return json({
        ok: true,
        candidates: dedupeCandidates(boostWithAnnualReport(
          exactCached.length
            ? exactCached.slice(0, 3).map(candidateFromReport)
            : [
                {
                  name: query,
                  standardName: query,
                  region,
                  industry,
                  website: "",
                  confidence: cached.length ? 75 : 65,
                  reason: cached.length
                    ? "未完全命中历史主体，先按输入名称作为候选；可结合下方历史报告判断是否复用。"
                    : "先按输入名称作为候选主体，深度生成阶段会继续检索公开信息并校验主体。",
                  sourceUrls: []
                }
              ],
          query,
          region,
          industry,
          annualReportSummary
        )),
        cached,
        model: "fast-resolve",
        channel: "fast-resolve",
        tianyanchaDiagnostic: {
          provider: "tianyancha",
          status: tianyanchaConfigured ? "api_failed" : "missing_key",
          configured: tianyanchaConfigured,
          message: tianyanchaConfigured ? "天眼查核验流程未完成，已回退到历史记录或输入名称" : "生产环境尚未配置天眼查核验",
          error: String(error?.message || "").slice(0, 220)
        }
      });
    }
    });
  } catch (error) {
    return fail(error?.message || "主体核对失败", error?.status || 500);
  }
}
