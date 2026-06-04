import { fail, json } from "../lib/http.mjs";
import { readJson } from "../lib/store.mjs";
import { decorateJob } from "../lib/job-progress.mjs";
import { enrichJobErrorPatch } from "../lib/job-errors.mjs";
import { withOacApiContext } from "../lib/auth.mjs";

function pathId(request, context) {
  return context?.params?.id || new URL(request.url).pathname.split("/").filter(Boolean).pop() || "";
}

export default async function handler(request, context) {
  try {
    return await withOacApiContext(request, async () => {
      const jobId = pathId(request, context);
      if (!jobId) return fail("缺少 jobId", 400);
      const job = await readJson("jobs", `${jobId}.json`, null);
      if (!job) return fail("任务不存在", 404);
      const out = decorateJob(enrichJobErrorPatch(job));
      delete out.inputText;
      delete out.checkpoint;
      return json({ ok: true, job: out });
    });
  } catch (error) {
    return fail(error?.message || "API 读取任务失败", error?.status || 500);
  }
}

export const config = {
  path: "/api/v1/report-jobs/:id"
};
