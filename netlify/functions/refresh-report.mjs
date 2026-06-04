import { createJob } from "../lib/pipeline.mjs?v=oac-insight-20260604a";
import { fail, json, readBody } from "../lib/http.mjs";
import { createJobRoute, withOacRequestContext } from "../lib/auth.mjs";

export default async function handler(request) {
  try {
    return await withOacRequestContext(
      request,
      async (oacContext) => {
        const body = await readBody(request);
        const company = body.company || {};
        const name = company.standardName || company.name || company.query;
        if (!name) return fail("缺少企业主体信息", 400);

        const jobId = await createJob(
          {
            ...company,
            tenantId: oacContext.tenantId,
            tenantName: oacContext.tenantName,
            licenseId: oacContext.licenseId,
            userId: oacContext.userId
          },
          "refresh"
        );
        await createJobRoute(jobId, oacContext);
        return json({ ok: true, jobId });
      },
      { requireCreate: true }
    );
  } catch (error) {
    return fail(error?.message || "刷新任务创建失败", error?.status || 500);
  }
}
