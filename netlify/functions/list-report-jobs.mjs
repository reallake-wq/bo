import { fail, json } from "../lib/http.mjs";
import { listJson } from "../lib/store.mjs";
import { decorateJob } from "../lib/job-progress.mjs";
import { withOacRequestContext } from "../lib/auth.mjs";

const RECENT_JOB_DAYS = 7;

function isRecentOrActive(job) {
  if (["queued", "running", "needs_resume"].includes(String(job?.status || ""))) return true;
  const value = Date.parse(job?.updatedAt || job?.createdAt || "");
  if (!Number.isFinite(value)) return false;
  return Date.now() - value <= RECENT_JOB_DAYS * 24 * 60 * 60 * 1000;
}

function publicJob(job = {}) {
  const decorated = decorateJob(job);
  delete decorated.inputText;
  delete decorated.checkpoint;
  delete decorated.sourceAudit;
  delete decorated.sources;
  delete decorated.sourceBriefs;
  delete decorated.report;
  delete decorated.html;
  delete decorated.sensitiveVerification;
  delete decorated.annualReportEvidence;
  delete decorated.quality;
  delete decorated.phaseTree;
  if (decorated.jobIdentity?.sellerProfileSnapshot) {
    const snapshot = decorated.jobIdentity.sellerProfileSnapshot;
    decorated.jobIdentity.sellerProfileSnapshot = {
      profileId: snapshot.profileId || "",
      companyName: snapshot.companyName || ""
    };
  }
  if (decorated.company) {
    const { annualReportEvidence, sellerProfileSnapshot, runtimeMode, sourceUrls, scoreBreakdown, ...company } = decorated.company;
    decorated.company = company;
  }
  delete decorated.steps;
  return decorated;
}

export default async function handler(request) {
  try {
    return await withOacRequestContext(request, async () => {
    const rows = await listJson("jobs");
    const jobs = rows
      .map((row) => ({ ...(row.value || {}), jobId: (row.value && row.value.jobId) || String(row.key || "").replace(/\.json$/, "") }))
      .filter((job) => job.jobId && !job.dismissedAt && isRecentOrActive(job))
      .map((job) => publicJob(job))
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || "") - Date.parse(a.updatedAt || a.createdAt || ""))
      .slice(0, 60);
    return json({ ok: true, jobs });
    });
  } catch (error) {
    return fail(error?.message || "读取任务列表失败", error?.status || 500);
  }
}
