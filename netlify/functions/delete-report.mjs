import { fail, json, readBody } from "../lib/http.mjs";
import { deleteObject, getIndex, readJson, saveIndex } from "../lib/store.mjs";
import { withOacRequestContext } from "../lib/auth.mjs";

export default async function handler(request) {
  try {
    return await withOacRequestContext(request, async () => {
      if (request.method && request.method !== "POST") return fail("仅支持 POST 删除", 405);
      const body = await readBody(request);
      const reportId = String(body.reportId || "").trim();
      if (!reportId) return fail("缺少 reportId", 400);

      const report = await readJson("reports", `${reportId}.json`, null);
      const index = await getIndex();
      const nextReports = (index.reports || []).filter((item) => item.reportId !== reportId);

      await deleteObject("reports", `${reportId}.json`);
      await deleteObject("reports", `${reportId}.html`);
      await saveIndex({ ...index, reports: nextReports });

      return json({
        ok: true,
        deleted: Boolean(report),
        reportId
      });
    });
  } catch (error) {
    return fail(error?.message || "删除报告失败", error?.status || 500);
  }
}
