import { createJob } from "../lib/pipeline.mjs";
import { fail, json, readBody } from "../lib/http.mjs";
import { getProfile, profileSnapshot } from "../lib/profiles.mjs";
import { createJobRoute, withOacApiContext } from "../lib/auth.mjs";

export default async function handler(request) {
  try {
    return await withOacApiContext(
      request,
      async (oacContext) => {
        if (request.method !== "POST") return fail("Method not allowed", 405);
        const body = await readBody(request);
        const company = body.company || {};
        const profileId = String(body.profileId || company.sellerProfileId || "").trim();
        const name = company.standardName || company.name || company.query;
        if (!name) return fail("缺少目标企业名称", 400);
        if (!profileId) return fail("缺少我的企业 profileId", 400);
        const sellerProfile = await getProfile(profileId);
        if (!sellerProfile) return fail("我的企业不存在", 404);
        const enrichedCompany = {
          ...company,
          sellerProfileId: profileId,
          sellerProfileName: sellerProfile.companyName,
          sellerProfileSnapshot: profileSnapshot(sellerProfile),
          tenantId: oacContext.tenantId,
          tenantName: oacContext.tenantName,
          licenseId: oacContext.licenseId,
          userId: oacContext.userId
        };
        const jobId = await createJob(enrichedCompany, body.force ? "refresh" : "generate", body.runtimeMode || null, sellerProfile);
        await createJobRoute(jobId, oacContext);
        return json({ ok: true, jobId });
      },
      { requireCreate: true }
    );
  } catch (error) {
    return fail(error?.message || "API 创建任务失败", error?.status || 500);
  }
}

export const config = {
  path: "/api/v1/report-jobs"
};
