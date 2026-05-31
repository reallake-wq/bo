import { listJson, readJson } from "../lib/store.mjs";
import { updateJob } from "../lib/pipeline.mjs";
import { withJobTenantContext } from "../lib/auth.mjs";

const RESUME_INTERVAL_MS = 5 * 60 * 1000;
const MAX_RESUMES_PER_TICK = 3;

function shouldResume(job = {}) {
  if (job.status !== "needs_resume") return false;
  if (!job.checkpoint && !job.checkpointRef) return false;
  const last = Date.parse(job.resumeRequestedAt || "");
  return !Number.isFinite(last) || Date.now() - last > RESUME_INTERVAL_MS;
}

async function triggerResume(origin, jobId) {
  const response = await fetch(`${origin}/.netlify/functions/run-report-job-background`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId, resume: true })
  });
  return response.ok || response.status === 202;
}

async function loadRoutableJobs() {
  const routes = await listJson("job-routes");
  const jobs = [];
  for (const routeRow of routes) {
    const route = routeRow.value || {};
    if (!route.jobId || !route.tenantId) continue;
    const job = await withJobTenantContext(route, () => readJson("jobs", `${route.jobId}.json`, null));
    if (job) jobs.push({ ...job, jobId: job.jobId || route.jobId, route });
  }
  return jobs;
}

export default async function handler(request) {
  const origin = new URL(request.url).origin;
  const jobs = (await loadRoutableJobs())
    .filter((job) => job.jobId && shouldResume(job))
    .sort((a, b) => Date.parse(a.updatedAt || a.createdAt || "") - Date.parse(b.updatedAt || b.createdAt || ""))
    .slice(0, MAX_RESUMES_PER_TICK);

  const resumed = [];
  const failed = [];
  for (const job of jobs) {
    try {
      await withJobTenantContext(job.route || job, () =>
        updateJob(job.jobId, {
          status: "needs_resume",
          stage: "自动续跑唤醒",
          detail: "系统检测到已保存断点，正在自动唤醒后台函数继续生成。",
          resumeRequestedAt: new Date().toISOString()
        })
      );
      const ok = await triggerResume(origin, job.jobId);
      if (ok) resumed.push(job.jobId);
      else failed.push(job.jobId);
    } catch {
      failed.push(job.jobId);
    }
  }

  return new Response(JSON.stringify({ ok: true, resumed, failed }), {
    headers: { "content-type": "application/json" }
  });
}

export const config = {
  schedule: "*/10 * * * *"
};
