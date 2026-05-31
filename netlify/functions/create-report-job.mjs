import { createJob, findLatestReport } from "../lib/pipeline.mjs?v=oac-insight-20260531a";
import { fail, json, readBody } from "../lib/http.mjs";
import { runtimeModeFromRequest } from "../lib/runtime-mode.mjs";
import { getProfile, profileSnapshot } from "../lib/profiles.mjs";
import { createJobRoute, withOacRequestContext } from "../lib/auth.mjs";

export default async function handler(request) {
  try {
    return await withOacRequestContext(
      request,
      async (oacContext) => {
        const body = await readBody(request);
        const company = body.company || {};
        const profileId = String(body.profileId || company.sellerProfileId || company.profileId || "").trim();
        const force = Boolean(body.force);
        const name = company.standardName || company.name || company.query;
        const hasCustomContext = Boolean(String(company.aiNeeds || "").trim() || company.annualReportId);
        if (!name) return fail("缺少企业主体信息", 400);
        if (!profileId) return fail("请先选择我的企业", 400);

        const sellerProfile = await getProfile(profileId);
        if (!sellerProfile) return fail("我的企业不存在，请重新选择或新增", 404);
        if (!String(sellerProfile.mainBusiness || sellerProfile.summary || "").trim() || !(sellerProfile.coreProducts || sellerProfile.coreOfferings || []).length) {
          return fail("请先补齐我的企业的主营业务和核心产品/服务", 400);
        }

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

        if (!force && !hasCustomContext) {
          const cached = await findLatestReport(enrichedCompany);
          if (cached) {
            return json({ ok: true, cached: true, reportId: cached.reportId, reportMeta: cached });
          }
        }

        const runtimeMode = runtimeModeFromRequest(request);
        const jobId = await createJob(enrichedCompany, force ? "refresh" : "generate", runtimeMode, sellerProfile);
        await createJobRoute(jobId, oacContext);
        const targetCompanyName = enrichedCompany.standardName || enrichedCompany.name || enrichedCompany.companyName || enrichedCompany.query || name;
        return json({
          ok: true,
          cached: false,
          jobId,
          runtimeMode,
          job: {
            jobId,
            tenantId: oacContext.tenantId,
            tenantName: oacContext.tenantName,
            company: enrichedCompany,
            companyName: targetCompanyName,
            standardName: targetCompanyName,
            targetCompanyName,
            sellerProfileId: profileId,
            sellerProfileName: sellerProfile.companyName,
            sellerProfileSnapshot: profileSnapshot(sellerProfile),
            status: "queued",
            progress: 10,
            phaseKey: "resolve",
            stage: "企业核对完成",
            detail: "已选择企业主体，等待启动深度检索。"
          }
        });
      },
      { requireCreate: true }
    );
  } catch (error) {
    return fail(error?.message || "创建任务失败", error?.status || 500);
  }
}
