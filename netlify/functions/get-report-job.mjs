import { fail, json } from "../lib/http.mjs";
import { readJson } from "../lib/store.mjs";
import { updateJob } from "../lib/pipeline.mjs";
import { decorateJob } from "../lib/job-progress.mjs";

function isStale(job) {
  if (!["queued", "running", "needs_resume"].includes(job?.status)) return false;
  const updated = Date.parse(job.updatedAt || job.createdAt || "");
  if (!Number.isFinite(updated)) return false;
  return Date.now() - updated > 6 * 60 * 1000;
}

function canAutoResume(job) {
  if (["done", "cancelled"].includes(String(job?.status || ""))) return false;
  if (!job?.checkpoint) return false;
  const last = Date.parse(job.resumeRequestedAt || "");
  return !Number.isFinite(last) || Date.now() - last > 45 * 1000;
}

function hasJobIdentity(job = {}, jobId = "") {
  const company = job.company || {};
  const identity = job.jobIdentity || {};
  const sellerSnapshot = job.sellerProfileSnapshot || identity.sellerProfileSnapshot || company.sellerProfileSnapshot || null;
  const target = job.targetCompanyName || job.standardName || job.companyName || identity.targetCompanyName || company.standardName || company.name || company.companyName || company.query || "";
  const seller = job.sellerProfileName || identity.sellerProfileName || sellerSnapshot?.companyName || company.sellerProfileName || "";
  const sellerId = job.sellerProfileId || identity.sellerProfileId || sellerSnapshot?.profileId || company.sellerProfileId || "";
  return Boolean((job.jobId || jobId) && target && seller && sellerId);
}

async function triggerResume(request, jobId) {
  const origin = new URL(request.url).origin;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    await fetch(`${origin}/.netlify/functions/run-report-job-background`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId, resume: true }),
      signal: controller.signal
    });
  } catch {
    // The next poll can try again. The checkpoint remains saved.
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(request) {
  try {
    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");
    if (!jobId) return fail("缺少 jobId", 400);

    let job = await readJson("jobs", `${jobId}.json`, null);
    if (!job) return fail("任务不存在", 404);
    if (!hasJobIdentity(job, jobId)) {
      return json({
        ok: true,
        job: decorateJob({
          ...job,
          jobId,
          status: "error",
          progress: Math.max(Number(job.progress || 0), 100),
          phaseKey: job.phaseKey || "resolve",
          stage: "任务身份信息缺失",
          detail: "该任务缺少目标客户或我的企业绑定信息，已停止续跑。请清除后重新创建任务。",
          error: job.error || "job identity missing"
        })
      });
    }

    const retryableError = job.status === "error" && job.checkpoint && !job.reportId;
    if ((isStale(job) || job.status === "needs_resume" || retryableError) && canAutoResume(job)) {
      await updateJob(jobId, {
        status: "running",
        progress: Math.max(Number(job.progress || 0), 80),
        phaseKey: job.phaseKey || "analysis",
        stage: "断点续跑",
        detail: "检测到任务长时间未更新，已保留 checkpoint，正在从上次卡点继续。",
        error: "",
        resumeRequestedAt: new Date().toISOString()
      });
      await triggerResume(request, jobId);
      job = await readJson("jobs", `${jobId}.json`, job);
    }

    return json({ ok: true, job: decorateJob(job) });
  } catch (error) {
    return fail(error?.message || "读取任务状态失败", 500);
  }
}
