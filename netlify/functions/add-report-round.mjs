import { fail, json, readBody } from "../lib/http.mjs";
import { improveReport } from "../lib/pipeline.mjs";

export default async function handler(request) {
  try {
    const body = await readBody(request);
    const reportId = String(body.reportId || "").trim();
    const inputText = String(body.inputText || body.instruction || "").trim();
    if (!reportId) return fail("缺少报告ID", 400);
    if (!inputText) return fail("请粘贴会议纪要、录音转文字或拜访反馈", 400);

    const result = await improveReport(reportId, inputText);
    const rounds = result.report?.rounds || [];
    return json({
      ok: true,
      ...result,
      round: rounds[rounds.length - 1] || null
    });
  } catch (error) {
    return fail(error?.message || "新增拜访轮次失败", 500);
  }
}
