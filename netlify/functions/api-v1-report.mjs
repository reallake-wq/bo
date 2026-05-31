import { fail, json } from "../lib/http.mjs";
import { readJson } from "../lib/store.mjs";
import { withOacApiContext } from "../lib/auth.mjs";

function pathId(request, context) {
  return context?.params?.id || new URL(request.url).pathname.split("/").filter(Boolean).pop() || "";
}

export default async function handler(request, context) {
  try {
    return await withOacApiContext(request, async () => {
      const reportId = pathId(request, context);
      if (!reportId) return fail("缺少 reportId", 400);
      const report = await readJson("reports", `${reportId}.json`, null);
      if (!report) return fail("报告不存在", 404);
      return json({ ok: true, report });
    });
  } catch (error) {
    return fail(error?.message || "API 读取报告失败", error?.status || 500);
  }
}

export const config = {
  path: "/api/v1/reports/:id"
};
