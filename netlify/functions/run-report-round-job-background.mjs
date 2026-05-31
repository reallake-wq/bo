import { readBody } from "../lib/http.mjs";
import { decorateJob } from "../lib/job-progress.mjs";
import { improveReport, updateJob } from "../lib/pipeline.mjs?v=oac-insight-20260531a";
import { readJson } from "../lib/store.mjs";
import { contextFromJob, getJobRoute, recordSuccessfulUsage, withJobTenantContext } from "../lib/auth.mjs";

async function loadJob(jobId) {
  const route = await getJobRoute(jobId);
  if (route?.tenantId) {
    const job = await withJobTenantContext(route, () => readJson("jobs", `${jobId}.json`, null));
    return { route, job };
  }
  return { route: null, job: await readJson("jobs", `${jobId}.json`, null) };
}

export default async function handler(request) {
  const body = await readBody(request);
  const jobId = String(body.jobId || "").trim();
  if (!jobId) {
    console.error("Missing round jobId");
    return;
  }

  const { route, job } = await loadJob(jobId);
  if (!job) {
    console.error(`Round job not found: ${jobId}`);
    return;
  }

  const runner = async () => {
    try {
      await updateJob(jobId, {
        status: "running",
        progress: 35,
        phaseKey: "analysis",
        stage: `第 ${job.roundNo || ""} 轮反馈分析中`,
        detail: "正在把拜访信息映射到评级、痛点、方案和下一步动作。"
      });

      const result = await improveReport(job.reportId, job.inputText);
      const report = result.report || {};
      if (!job.usageCharged) {
        await recordSuccessfulUsage(contextFromJob(job), {
          type: "post_visit_round",
          jobId,
          reportId: job.reportId
        }).catch(() => null);
      }

      await updateJob(jobId, {
        status: "done",
        progress: 100,
        phaseKey: "report",
        stage: "下一轮判断已生成",
        detail: "报告已更新，可打开查看最新轮次。",
        reportId: job.reportId,
        usageCharged: true,
        report: {
          reportId: job.reportId,
          targetCompanyName: report.targetCompanyName || report.standardName || job.targetCompanyName,
          sellerProfileName: report.sellerProfileName || job.sellerProfileName,
          opportunityRating: report.opportunityRating,
          activeRoundNo: report.activeRoundNo
        },
        sourceCount: report.sources?.length || job.sourceCount || 0
      });
    } catch (error) {
      await updateJob(jobId, {
        status: "error",
        progress: 100,
        phaseKey: "analysis",
        stage: "下一轮判断生成失败",
        detail: error?.message || String(error),
        error: error?.message || String(error)
      }).catch(async () => {
        const fallback = decorateJob({
          ...job,
          status: "error",
          progress: 100,
          phaseKey: "analysis",
          stage: "下一轮判断生成失败",
          detail: error?.message || String(error),
          error: error?.message || String(error)
        });
        console.error("Failed to update round job", fallback);
      });
    }
  };

  await withJobTenantContext(route || job || { tenantId: "internal-demo" }, runner);
}
