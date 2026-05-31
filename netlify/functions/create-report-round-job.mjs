import { fail, json, readBody } from "../lib/http.mjs";
import { decorateJob } from "../lib/job-progress.mjs";
import { readJson, writeJson } from "../lib/store.mjs";
import { id, nowIso } from "../lib/util.mjs";
import { createJobRoute, withOacRequestContext } from "../lib/auth.mjs";

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function compactReportIdentity(report, reportId) {
  const targetCompanyName = firstText(report.targetCompanyName, report.standardName, report.companyName, report.company?.standardName, reportId);
  const sellerProfileSnapshot = report.sellerProfileSnapshot || null;
  const sellerProfileId = firstText(report.sellerProfileId, sellerProfileSnapshot?.profileId, report.company?.sellerProfileId, "unbound");
  const sellerProfileName = firstText(report.sellerProfileName, sellerProfileSnapshot?.companyName, report.company?.sellerProfileName, "未绑定我的企业");
  const company = {
    ...(report.company || {}),
    standardName: targetCompanyName,
    companyName: targetCompanyName,
    sellerProfileId,
    sellerProfileName,
    sellerProfileSnapshot
  };
  return {
    targetCompanyName,
    sellerProfileId,
    sellerProfileName,
    sellerProfileSnapshot,
    company,
    jobIdentity: {
      targetCompanyName,
      standardName: targetCompanyName,
      companyName: targetCompanyName,
      sellerProfileId,
      sellerProfileName,
      sellerProfileSnapshot
    }
  };
}

export default async function handler(request) {
  try {
    return await withOacRequestContext(
      request,
      async (oacContext) => {
        const body = await readBody(request);
        const reportId = String(body.reportId || "").trim();
        const inputText = String(body.inputText || body.instruction || "").trim();
        if (!reportId) return fail("缺少报告ID", 400);
        if (!inputText) return fail("请粘贴会议纪要、录音转文字或拜访反馈", 400);

        const report = await readJson("reports", `${reportId}.json`, null);
        if (!report) return fail(`报告不存在：${reportId}`, 404);

        const roundNo = Math.max(2, Number(report.activeRoundNo || report.rounds?.length || 1) + 1);
        const jobId = id("round", `${reportId}:${roundNo}`);
        const now = nowIso();
        const identity = compactReportIdentity(report, reportId);
        const job = decorateJob({
          jobId,
          jobType: "round",
          reportId,
          inputText,
          roundNo,
          ...identity,
          tenantId: oacContext.tenantId,
          tenantName: oacContext.tenantName,
          userId: oacContext.userId,
          licenseId: oacContext.licenseId,
          oacContext: {
            tenantId: oacContext.tenantId,
            tenantName: oacContext.tenantName,
            userId: oacContext.userId,
            licenseId: oacContext.licenseId,
            mode: oacContext.mode || "web"
          },
          jobIdentity: { ...identity.jobIdentity, jobId },
          status: "queued",
          progress: 10,
          phaseKey: "analysis",
          phaseLabel: "模型分析",
          stage: `第 ${roundNo} 轮反馈已接收`,
          detail: "参谋团将在后台更新评级、结论、痛点、方案、问卷和内部注意事项。",
          createdAt: now,
          updatedAt: now,
          steps: [
            {
              at: now,
              phaseKey: "analysis",
              phaseLabel: "模型分析",
              stage: `第 ${roundNo} 轮反馈已接收`,
              progress: 10,
              detail: "可关闭页面，任务完成后回到任务中心打开报告。"
            }
          ]
        });

        await writeJson("jobs", `${jobId}.json`, job);
        await createJobRoute(jobId, oacContext);
        const publicJob = { ...job };
        delete publicJob.inputText;
        return json({ ok: true, jobId, job: publicJob });
      },
      { requireCreate: true }
    );
  } catch (error) {
    return fail(error?.message || "创建下一轮判断任务失败", error?.status || 500);
  }
}
