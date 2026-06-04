import { fail, json } from "../lib/http.mjs";
import { readJson } from "../lib/store.mjs";
import { updateJob } from "../lib/pipeline.mjs";
import { decorateJob } from "../lib/job-progress.mjs";
import { enrichJobErrorPatch } from "../lib/job-errors.mjs";
import { withOacRequestContext } from "../lib/auth.mjs";

function isStale(job) {
  if (!["queued", "running", "needs_resume"].includes(job?.status)) return false;
  const updated = Date.parse(job.updatedAt || job.createdAt || "");
  if (!Number.isFinite(updated)) return false;
  return Date.now() - updated > 6 * 60 * 1000;
}

function canAutoResume(job) {
  if (["done", "cancelled"].includes(String(job?.status || ""))) return false;
  if (!job?.checkpoint && !job?.checkpointRef) return false;
  const last = Date.parse(job.resumeRequestedAt || "");
  return !Number.isFinite(last) || Date.now() - last > 45 * 1000;
}

function publicJob(job = {}) {
  const out = decorateJob(enrichJobErrorPatch(job));
  delete out.inputText;
  delete out.checkpoint;
  delete out.sourceAudit;
  delete out.sources;
  delete out.sourceBriefs;
  delete out.report;
  delete out.html;
  delete out.sensitiveVerification;
  delete out.annualReportEvidence;
  if (out.company) {
    const { annualReportEvidence, ...company } = out.company;
    out.company = company;
  }
  if (Array.isArray(out.steps)) {
    out.steps = out.steps.slice(-40).map((step) => ({
      ...step,
      detail: String(step.detail || "").slice(0, 600)
    }));
  }
  return out;
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
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${origin}/.netlify/functions/run-report-job-background`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId, resume: true }),
      signal: controller.signal
    });
    return response.ok || response.status === 202;
  } catch {
    // The next poll can try again. The checkpoint remains saved.
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(request) {
  try {
    return await withOacRequestContext(request, async () => {
    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");
    if (!jobId) return fail("缺少 jobId", 400);

    let job = await readJson("jobs", `${jobId}.json`, null);
    if (!job) return fail("任务不存在", 404);
    if (!hasJobIdentity(job, jobId)) {
      return json({
        ok: true,
        job: publicJob({
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
      const currentProgress = Number(job.progress || 0);
      await updateJob(jobId, {
        status: "running",
        progress: Number.isFinite(currentProgress) ? Math.max(0, Math.min(99, currentProgress)) : 0,
        phaseKey: job.phaseKey || "analysis",
        stage: "断点续跑",
        detail: "检测到任务长时间未更新，已保留 checkpoint，正在从上次卡点继续。",
        error: "",
        resumeRequestedAt: new Date().toISOString()
      });
      const triggered = await triggerResume(request, jobId);
      if (!triggered) {
        await updateJob(jobId, {
          status: "needs_resume",
          phaseKey: job.phaseKey || "analysis",
          stage: "等待续跑唤醒",
          detail: "本次后台续跑请求未及时响应，系统会在下一轮轮询继续尝试。",
          resumeRequestedAt: ""
        });
      }
      job = await readJson("jobs", `${jobId}.json`, job);
    } else if (job.status === "needs_resume" && !job.checkpoint && !job.checkpointRef) {
      await updateJob(jobId, {
        status: "error",
        progress: 100,
        phaseKey: job.phaseKey || "analysis",
        stage: "断点缺失，需要重新生成",
        detail: "系统发现该任务没有可恢复断点。为避免浪费搜索额度和模型 token，已停止自动重跑；请确认后重新生成。",
        error: "checkpoint missing"
      });
      job = await readJson("jobs", `${jobId}.json`, job);
    }

    return json({ ok: true, job: publicJob(job) });
    });
  } catch (error) {
    return fail(error?.message || "读取任务状态失败", error?.status || 500);
  }
}
