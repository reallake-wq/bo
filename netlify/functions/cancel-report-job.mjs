import { fail, json, readBody } from "../lib/http.mjs";
import { cancelJob } from "../lib/pipeline.mjs";
import { withOacRequestContext } from "../lib/auth.mjs";

export default async function handler(request) {
  try {
    return await withOacRequestContext(request, async () => {
      const body = await readBody(request);
      const jobId = String(body.jobId || "").trim();
      if (!jobId) return fail("缺少 jobId", 400);
      const job = await cancelJob(jobId);
      return json({ ok: true, job });
    });
  } catch (error) {
    return fail(error?.message || "停止任务失败", error?.status || 500);
  }
}
