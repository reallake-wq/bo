import { fail, json, readBody } from "../lib/http.mjs";
import { improveReport } from "../lib/pipeline.mjs?v=oac-insight-20260531a";
import { recordSuccessfulUsage, withOacRequestContext } from "../lib/auth.mjs";

export default async function handler(request) {
  try {
    return await withOacRequestContext(
      request,
      async (oacContext) => {
        const body = await readBody(request);
        const reportId = String(body.reportId || "").trim();
        const instruction = String(body.instruction || body.inputText || "").trim();
        if (!reportId) return fail("缺少报告ID", 400);
        if (!instruction) return fail("缺少补充信息", 400);

        const result = await improveReport(reportId, instruction);
        await recordSuccessfulUsage(oacContext, { type: "post_visit_round", reportId }).catch(() => null);
        return json({ ok: true, ...result });
      },
      { requireCreate: true }
    );
  } catch (error) {
    return fail(error?.message || "完善报告失败", error?.status || 500);
  }
}
