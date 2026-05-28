import { readBody } from "../lib/http.mjs";
import { decorateJob } from "../lib/job-progress.mjs";
import { improveReport, updateJob } from "../lib/pipeline.mjs";
import { readJson } from "../lib/store.mjs";

export default async function handler(request) {
  const body = await readBody(request);
  const jobId = String(body.jobId || "").trim();
  if (!jobId) {
    console.error("Missing round jobId");
    return;
  }

  const job = await readJson("jobs", `${jobId}.json`, null);
  if (!job) {
    console.error(`Round job not found: ${jobId}`);
    return;
  }

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

    await updateJob(jobId, {
      status: "done",
      progress: 100,
      phaseKey: "report",
      stage: "下一轮判断已生成",
      detail: "报告已更新，可打开查看最新轮次。",
      reportId: job.reportId,
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
}
