import { readBody } from "../lib/http.mjs";
import { runReportJob, updateJob } from "../lib/pipeline.mjs?v=oac-insight-20260531a";
import { JobCancelledError } from "../lib/job-progress.mjs";
import { getJobRoute, withJobTenantContext } from "../lib/auth.mjs";
import { readJson } from "../lib/store.mjs";

async function loadJobForRoute(jobId) {
  const route = await getJobRoute(jobId);
  if (route?.tenantId) {
    const job = await withJobTenantContext(route, () => readJson("jobs", `${jobId}.json`, null));
    return { route, job };
  }
  const job = await readJson("jobs", `${jobId}.json`, null);
  return { route: job || { tenantId: "internal-demo" }, job };
}

export default async function handler(request) {
  const body = await readBody(request);
  const jobId = body.jobId;
  if (!jobId) {
    console.error("Missing jobId");
    return;
  }

  const { route, job } = await loadJobForRoute(jobId);
  try {
    if (!job && route?.tenantId) throw new Error(`Job route exists but job is missing: ${jobId}`);
    await withJobTenantContext(job || route || { tenantId: "internal-demo" }, () => runReportJob(jobId));
  } catch (error) {
    const patch =
      error instanceof JobCancelledError || error?.name === "JobCancelledError"
        ? {
            status: "cancelled",
            stage: "任务已停止",
            detail: error.message || "用户已停止本次生成。"
          }
        : {
            status: "error",
            progress: 100,
            stage: "生成失败",
            error: error?.message || String(error)
          };
    await withJobTenantContext(route || job || { tenantId: "internal-demo" }, () => updateJob(jobId, patch)).catch((updateError) => {
      console.error(`Failed to update job ${jobId}:`, updateError);
    });
  }
}
