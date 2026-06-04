import { fail, json } from "../lib/http.mjs";
import { getIndex, readJson, readText, saveIndex, writeJson, writeText } from "../lib/store.mjs";
import { ratingIndex } from "../lib/opportunity-rating.mjs";
import { ratingChanged, resolveOpportunityRating } from "../lib/rating-resolver.mjs";
import { normalizeReportShape, renderReportHtml } from "../lib/report.mjs?v=oac-insight-20260604a";
import { auditReport } from "../lib/source-audit.mjs?v=oac-insight-20260604a";
import { applySensitiveVerification } from "../lib/sensitive-verification.mjs";
import { applyFreshnessGuardrails } from "../lib/evidence-freshness.mjs";
import { withOacRequestContext } from "../lib/auth.mjs";

function indexEntryFromReport(report = {}, existing = {}) {
  return {
    ...existing,
    reportId: report.reportId,
    companyName: report.companyName,
    standardName: report.standardName,
    targetCompanyName: report.targetCompanyName || report.standardName || report.companyName,
    companyKey: report.companyKey,
    sellerProfileId: report.sellerProfileId || "",
    sellerProfileName: report.sellerProfileName || existing.sellerProfileName || "未绑定我的企业",
    sellerProfileSnapshot: report.sellerProfileSnapshot || existing.sellerProfileSnapshot || null,
    opportunityFit: report.opportunityFit || existing.opportunityFit,
    reportMode: report.reportMode,
    activeRoundNo: report.activeRoundNo,
    roundCount: (report.rounds || []).length,
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
    opportunityRating: ratingIndex(report.opportunityRating),
    durationMs: report.durationMs,
    generatedAt: report.generatedAt || existing.generatedAt,
    updatedAt: report.updatedAt || existing.updatedAt || report.generatedAt,
    modelName: report.modelName,
    modelChannel: report.modelChannel,
    modelDisplay: report.modelDisplay,
    usedModels: report.usedModels || []
  };
}

export default async function handler(request) {
  try {
    return await withOacRequestContext(request, async () => {
  const url = new URL(request.url);
  const reportId = url.searchParams.get("reportId");
  if (!reportId) return fail("缺少reportId", 400);

  const savedReport = await readJson("reports", `${reportId}.json`, null);
  const checkedReport = savedReport?.sensitiveVerification
    ? applySensitiveVerification(savedReport, savedReport.sensitiveVerification)
    : savedReport;
  const audited = checkedReport ? applyFreshnessGuardrails(auditReport(checkedReport), { company: checkedReport }) : null;
  const report = audited
    ? normalizeReportShape({
        ...audited,
        opportunityRating: resolveOpportunityRating(audited)
      })
    : null;

  if (!report) return fail("报告不存在", 404);

  const html = renderReportHtml(report) || (await readText("reports", `${reportId}.html`, ""));
  const ratingWasChanged = ratingChanged(savedReport?.opportunityRating, report.opportunityRating);
  const shapeWasChanged =
    JSON.stringify(savedReport || {}) !== JSON.stringify(report || {}) ||
    Number(savedReport?.activeRoundNo || 0) !== Number(report.activeRoundNo || 0) ||
    Number((savedReport?.rounds || []).length || 0) !== Number((report.rounds || []).length || 0) ||
    JSON.stringify(savedReport?.rounds || []) !== JSON.stringify(report.rounds || []) ||
    savedReport?.qualityLevel !== report.qualityLevel ||
    savedReport?.qualityLabel !== report.qualityLabel;

  if (ratingWasChanged || shapeWasChanged) {
    await writeJson("reports", `${reportId}.json`, report);
    await writeText("reports", `${reportId}.html`, html);
    const index = await getIndex();
    const reports = index.reports || [];
    const found = reports.some((entry) => entry.reportId === reportId);
    const nextReports = found
      ? reports.map((entry) => (entry.reportId === reportId ? indexEntryFromReport(report, entry) : entry))
      : [indexEntryFromReport(report), ...reports];
    await saveIndex({ reports: nextReports });
  }

  return json({ ok: true, report, html });
    });
  } catch (error) {
    return fail(error?.message || "打开报告失败", error?.status || 500);
  }
}
