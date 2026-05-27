import { json } from "../lib/http.mjs";
import { getIndex, listJson, readJson, saveIndex } from "../lib/store.mjs";
import { normalizeText, scoreMatch } from "../lib/util.mjs";
import { qualityStatusText, withinDays } from "../lib/report-quality.mjs";
import { ratingIndex } from "../lib/opportunity-rating.mjs";
import { resolveRatingIndex } from "../lib/rating-resolver.mjs";
import { auditReport } from "../lib/source-audit.mjs";
import { applySensitiveVerification } from "../lib/sensitive-verification.mjs";

function periodDays(period) {
  if (period === "7d") return 7;
  if (period === "90d") return 90;
  if (period === "all") return null;
  return 30;
}

function dedupeLatestByCompany(reports) {
  const seen = new Set();
  const out = [];
  for (const report of reports) {
    const companyKey =
      report.companyKey ||
      normalizeText(`${report.standardName || report.companyName || ""}|${report.region || ""}`);
    const key = `${report.sellerProfileId || "unbound"}|${companyKey}`;
    if (!key) {
      out.push(report);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(report);
  }
  return out;
}

export default async function handler(request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const period = url.searchParams.get("period") || "30d";
  const rating = url.searchParams.get("rating") || "all";
  const profileId = url.searchParams.get("profileId") || "all";
  const profileName = url.searchParams.get("profileName") || "";
  const days = periodDays(period);
  const normalizedQuery = normalizeText(query);
  const matchThreshold = normalizedQuery ? Math.max(4, Math.ceil(normalizedQuery.length * 0.9)) : 0;
  let index = await getIndex();
  if (!(index.reports || []).length) {
    const restored = (await listJson("reports"))
      .map((item) => item.value)
      .filter((report) => report?.reportId)
      .map((report) => ({
        reportId: report.reportId,
        companyName: report.companyName,
        standardName: report.standardName,
        targetCompanyName: report.targetCompanyName || report.standardName || report.companyName,
        companyKey: report.companyKey,
        sellerProfileId: report.sellerProfileId || "",
        sellerProfileName: report.sellerProfileName || "未绑定我的企业",
        sellerProfileSnapshot: report.sellerProfileSnapshot || null,
        opportunityFit: report.opportunityFit,
        reportMode: report.reportMode,
        activeRoundNo: report.activeRoundNo,
        roundCount: report.roundCount || (report.rounds || []).length,
        aliases: report.aliases || [],
        region: report.region || "",
        industry: report.industry || "",
        keywords: report.keywords || [],
        sourceCount: report.sourceCount,
        verifiedSourceCount: report.verifiedSourceCount,
        readableSourceCount: report.readableSourceCount,
        topicCoverageCount: report.topicCoverageCount,
        qualityLevel: report.qualityLevel,
        qualityLabel: report.qualityLabel,
        opportunityRating: report.opportunityRating ? ratingIndex(report.opportunityRating) : undefined,
        durationMs: report.durationMs,
        generatedAt: report.generatedAt,
        updatedAt: report.updatedAt,
        modelName: report.modelName,
        modelChannel: report.modelChannel,
        modelDisplay: report.modelDisplay,
        usedModels: report.usedModels || []
      }))
      .sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)));
    if (restored.length) {
      index = { reports: restored };
      await saveIndex(index);
    }
  }
  let indexNeedsSave = false;
  const enrichedReports = await Promise.all(
    (index.reports || []).map(async (report) => {
      const full = await readJson("reports", `${report.reportId}.json`, null);
      if (!full) return null;
      const checked = full.sensitiveVerification ? applySensitiveVerification(full, full.sensitiveVerification) : full;
      const audited = auditReport(checked);
      const ratingValue = resolveRatingIndex(audited);
      if (JSON.stringify(report.opportunityRating || {}) !== JSON.stringify(ratingValue || {})) {
        indexNeedsSave = true;
      }
      if (
        Number(report.activeRoundNo || 0) !== Number(audited.activeRoundNo || 0) ||
        Number(report.roundCount || 0) !== Number((audited.rounds || []).length || 0)
      ) {
        indexNeedsSave = true;
      }
      const next = {
        ...report,
        sourceCount: audited.sourceCount,
        verifiedSourceCount: audited.verifiedSourceCount,
        readableSourceCount: audited.readableSourceCount,
        topicCoverageCount: audited.topicCoverageCount,
        qualityLevel: audited.qualityLevel,
        qualityLabel: audited.qualityLabel,
        sourceAudit: audited.sourceAudit,
        sellerProfileId: audited.sellerProfileId || report.sellerProfileId || "",
        sellerProfileName: audited.sellerProfileName || report.sellerProfileName || "未绑定我的企业",
        targetCompanyName: audited.targetCompanyName || audited.standardName || report.targetCompanyName,
        opportunityFit: audited.opportunityFit || report.opportunityFit,
        reportMode: audited.reportMode || report.reportMode,
        activeRoundNo: audited.activeRoundNo || report.activeRoundNo,
        roundCount: (audited.rounds || []).length || report.roundCount,
        opportunityRating: ratingValue
      };
      return next;
    })
  );
  const existingReports = enrichedReports.filter(Boolean);
  if (indexNeedsSave || existingReports.length !== (index.reports || []).length) {
    await saveIndex({ reports: existingReports });
  }
  const reports = dedupeLatestByCompany(
    existingReports
      .filter((report) => (days ? withinDays(report.generatedAt, days) : true))
      .map((report) => ({
        ...report,
        opportunityRating: report.opportunityRating || { status: "not_rated", label: "鏆備笉璇勭骇" },
        qualityText: qualityStatusText(report),
        matchScore: query ? scoreMatch(report, query) : 1
      }))
      .filter((report) => {
        if (rating === "all") return true;
        if (rating === "not_rated") return report.opportunityRating?.status !== "rated";
        return report.opportunityRating?.grade === rating;
      })
      .filter((report) => profileId === "all" || (profileId === "unbound" ? !report.sellerProfileId : report.sellerProfileId === profileId))
      .filter((report) => {
        if (!profileName) return true;
        return normalizeText(report.sellerProfileName || "").includes(normalizeText(profileName));
      })
      .filter((report) => report.matchScore >= matchThreshold)
      .sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)))
      .sort((a, b) => b.matchScore - a.matchScore)
  ).slice(0, 200);
  return json({ ok: true, period, rating, profileId, reports });
}

