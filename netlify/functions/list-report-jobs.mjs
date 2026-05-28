import { fail, json } from "../lib/http.mjs";
import { listJson } from "../lib/store.mjs";
import { decorateJob } from "../lib/job-progress.mjs";

const RECENT_JOB_DAYS = 7;

function isRecentOrActive(job) {
  if (["queued", "running", "needs_resume"].includes(String(job?.status || ""))) return true;
  const value = Date.parse(job?.updatedAt || job?.createdAt || "");
  if (!Number.isFinite(value)) return false;
  return Date.now() - value <= RECENT_JOB_DAYS * 24 * 60 * 60 * 1000;
}

export default async function handler() {
  try {
    const rows = await listJson("jobs");
    const jobs = rows
      .map((row) => ({ ...(row.value || {}), jobId: (row.value && row.value.jobId) || String(row.key || "").replace(/\.json$/, "") }))
      .filter((job) => job.jobId && !job.dismissedAt && isRecentOrActive(job))
      .map((job) => decorateJob(job))
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || "") - Date.parse(a.updatedAt || a.createdAt || ""))
      .slice(0, 60);
    return json({ ok: true, jobs });
  } catch (error) {
    return fail(error?.message || "读取任务列表失败", 500);
  }
}
