import { fail, json, readBody } from "../lib/http.mjs";
import { updateJob } from "../lib/pipeline.mjs";

export default async function handler(request) {
  try {
    const body = await readBody(request);
    const jobId = String(body.jobId || "").trim();
    if (!jobId) return fail("缺少 jobId", 400);
    const job = await updateJob(jobId, {
      dismissedAt: new Date().toISOString(),
      stage: "任务已清除",
      detail: "该任务已从任务中心隐藏。"
    });
    return json({ ok: true, job });
  } catch (error) {
    return fail(error?.message || "清除任务失败", 500);
  }
}
