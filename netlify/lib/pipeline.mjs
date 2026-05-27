import { collectSources } from "./research.mjs";
import { appendPostVisitRound, generateStructuredReport, improveStructuredReport, normalizeReportShape, renderReportHtml } from "./report.mjs";
import { getIndex, readJson, saveIndex, writeJson, writeText } from "./store.mjs";
import { id, normalizeText, nowIso, slugify, scoreMatch } from "./util.mjs";
import { ratingIndex } from "./opportunity-rating.mjs";
import { resolveOpportunityRating } from "./rating-resolver.mjs";
import { JobCancelledError, decorateJob, normalizePhase } from "./job-progress.mjs";
import { auditReport, auditSources } from "./source-audit.mjs";
import { readAnnualReportEvidence } from "./annual-report.mjs";
import { getProfile, profileSnapshot } from "./profiles.mjs";
import {
  applySensitiveVerification,
  mergeSensitiveVerifications,
  verifySensitiveInformation
} from "./sensitive-verification.mjs";
import {
  RECENT_REPORT_DAYS,
  buildDiagnosticReport,
  buildEvidencePool,
  companyKey,
  evaluateSourceQuality,
  formatQualityWarnings,
  primaryCompanyName,
  withinDays
} from "./report-quality.mjs";

function sameSellerProfile(report, company = {}) {
  const profileId = company.sellerProfileId || company.profileId || "";
  if (!profileId) return !report.sellerProfileId;
  return report.sellerProfileId === profileId;
}

function sameCompany(report, company) {
  const key = companyKey(company);
  if (report.companyKey && key) return report.companyKey === key;
  const name = primaryCompanyName(company);
  if (!name) return false;
  return scoreMatch(report, name) >= 100;
}

function recentReportsForCompany(index, company, days = RECENT_REPORT_DAYS) {
  return (index.reports || [])
    .filter((report) => sameCompany(report, company) && sameSellerProfile(report, company))
    .filter((report) => withinDays(report.generatedAt, days))
    .sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)));
}

function mergeIndexReports(existingReports, entry) {
  return [
    entry,
    ...(existingReports || []).filter((report) => {
      if (!withinDays(report.generatedAt, RECENT_REPORT_DAYS)) return true;
      if (sameCompany(report, entry) && sameSellerProfile(report, entry)) return false;
      return normalizeText(report.reportId) !== normalizeText(entry.reportId);
    })
  ];
}

function buildOpportunityFit(report = {}, profile = null) {
  if (!profile) {
    return {
      status: "missing_profile",
      summary: "本报告未绑定我的企业，仅保留目标客户研究结果。",
      fitPoints: [],
      entryScenarios: [],
      noCommitments: [],
      validationQuestions: ["生成新报告前先选择我的企业。"]
    };
  }
  const offerings = profile.coreOfferings || [];
  const scenarios = profile.typicalScenarios || [];
  const boundaries = profile.noCommitments || profile.deliveryBoundaries || [];
  const solutions = (report.solutions || []).map((item) => item.title || item.why || "").filter(Boolean);
  return {
    status: "profile_bound",
    summary: `本报告按“${profile.companyName}”的企业信息生成，切入建议优先围绕${offerings.slice(0, 3).join("、") || "已保存能力"}展开。`,
    fitPoints: [
      ...offerings.slice(0, 4).map((item) => `我方能力：${item}`),
      ...solutions.slice(0, 2).map((item) => `报告建议：${item}`)
    ].slice(0, 6),
    entryScenarios: scenarios.slice(0, 6),
    noCommitments: boundaries.slice(0, 6),
    validationQuestions: [
      "客户当前最优先的业务问题是否落在我的企业能力覆盖范围内？",
      "客户是否具备可用于验证的流程、文档、样例数据或业务负责人？",
      "本次交流后能否形成下一步动作，而不是停留在泛认知交流？"
    ]
  };
}

function qualityWithAnnualEvidence(quality, annualReportEvidence) {
  if (!annualReportEvidence) return quality;
  const metricCount = Array.isArray(annualReportEvidence.metrics) ? annualReportEvidence.metrics.length : 0;
  const sectionCount = Array.isArray(annualReportEvidence.sections) ? annualReportEvidence.sections.length : 0;
  const textLength = Number(annualReportEvidence.textLength || 0);
  const strongAnnual = textLength >= 10000 || (textLength >= 2500 && (metricCount >= 2 || sectionCount >= 2));
  if (!strongAnnual) {
    return {
      ...quality,
      qualityWarnings: [
        ...quality.qualityWarnings,
        "已上传年报，但自动提取出的指标或章节偏少；报告仍需谨慎使用。"
      ]
    };
  }
  const coveredTopics = Array.from(new Set([...(quality.coveredTopics || []), "经营规模与财务", "企业主体与本地信息"]));
  const missingTopics = (quality.missingTopics || []).filter((topic) => !coveredTopics.includes(topic));
  const topicCoverageCount = Math.max(quality.topicCoverageCount, coveredTopics.length);
  const canBeFormal = textLength >= 10000 || metricCount >= 4 || sectionCount >= 4;
  return {
    ...quality,
    qualityLevel: canBeFormal ? "formal" : "brief",
    qualityLabel: canBeFormal ? "年报增强正式报告" : "年报增强简版报告",
    topicCoverageCount,
    coveredTopics,
    missingTopics,
    qualityWarnings: [
      ...quality.qualityWarnings.filter((item) => !/来源|可校验|可读|主题覆盖|缺少主题/.test(item)),
      `已接入用户上传年报《${annualReportEvidence.fileName || "年报 PDF"}》，作为财务与经营强证据。外部公开链接数量不虚增，仍按审计结果展示。`
    ],
    canGenerateReport: true,
    annualReportEvidenceCount: 1
  };
}

const WORKER_BUDGET_MS = 9 * 60 * 1000;
const WORKER_GRACE_MS = 75 * 1000;

function shouldYieldWorker(startedAt) {
  return Date.now() - startedAt > WORKER_BUDGET_MS - WORKER_GRACE_MS;
}

class JobNeedsResumeError extends Error {
  constructor(message = "Job checkpoint saved; resume is required.") {
    super(message);
    this.name = "JobNeedsResumeError";
  }
}

async function saveCheckpoint(jobId, patch = {}) {
  const current = await readJson("jobs", `${jobId}.json`, {});
  const checkpoint = {
    ...(current.checkpoint || {}),
    ...patch,
    lastCheckpointAt: nowIso()
  };
  await updateJob(jobId, { checkpoint });
  return checkpoint;
}

function restoreSourcesFromCheckpoint(checkpoint = {}) {
  const sources = Array.isArray(checkpoint.sources) ? checkpoint.sources : null;
  if (!sources) return null;
  Object.defineProperty(sources, "usedModels", {
    value: checkpoint.usedModels || [],
    enumerable: false
  });
  return sources;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function jobIdentityFrom(...sources) {
  const identity = {};
  for (const source of sources.filter(Boolean)) {
    const savedIdentity = source.jobIdentity || {};
    const company = source.company || {};
    const sellerSnapshot = source.sellerProfileSnapshot || savedIdentity.sellerProfileSnapshot || company.sellerProfileSnapshot || null;
    identity.jobId = firstNonEmpty(identity.jobId, savedIdentity.jobId, source.jobId);
    identity.company = identity.company || source.company || savedIdentity.company || null;
    identity.targetCompanyName = firstNonEmpty(
      identity.targetCompanyName,
      savedIdentity.targetCompanyName,
      source.targetCompanyName,
      source.standardName,
      source.companyName,
      company.standardName,
      company.name,
      company.companyName,
      company.query
    );
    identity.standardName = firstNonEmpty(identity.standardName, savedIdentity.standardName, source.standardName, identity.targetCompanyName);
    identity.companyName = firstNonEmpty(identity.companyName, savedIdentity.companyName, source.companyName, identity.targetCompanyName);
    identity.sellerProfileId = firstNonEmpty(identity.sellerProfileId, savedIdentity.sellerProfileId, source.sellerProfileId, sellerSnapshot?.profileId, company.sellerProfileId, company.profileId);
    identity.sellerProfileName = firstNonEmpty(identity.sellerProfileName, savedIdentity.sellerProfileName, source.sellerProfileName, sellerSnapshot?.companyName, company.sellerProfileName);
    identity.sellerProfileSnapshot = identity.sellerProfileSnapshot || sellerSnapshot || null;
    identity.companyKey = firstNonEmpty(identity.companyKey, source.companyKey);
    identity.region = firstNonEmpty(identity.region, source.region, company.region);
    identity.industry = firstNonEmpty(identity.industry, source.industry, company.industry);
  }
  return identity;
}

function hasRunnableJobIdentity(job = {}) {
  const identity = jobIdentityFrom(job);
  return Boolean(identity.jobId && identity.company && identity.targetCompanyName && identity.sellerProfileId && identity.sellerProfileName);
}

const jobUpdateQueues = new Map();

export async function updateJob(jobId, patch) {
  const previous = jobUpdateQueues.get(jobId) || Promise.resolve();
  const task = previous.catch(() => {}).then(() => updateJobNow(jobId, patch));
  const queued = task.finally(() => {
    if (jobUpdateQueues.get(jobId) === queued) jobUpdateQueues.delete(jobId);
  });
  jobUpdateQueues.set(jobId, queued);
  return task;
}

async function updateJobNow(jobId, patch) {
  const current = await readJson("jobs", `${jobId}.json`, null);
  if (!current) throw new Error(`任务不存在：${jobId}`);
  const currentHasIdentity = hasRunnableJobIdentity({ ...current, jobId: current.jobId || jobId });
  const terminalPatchStatus = ["done", "error", "cancelled"].includes(String(patch.status || ""));
  if (!currentHasIdentity && !terminalPatchStatus) {
    throw new Error(`任务身份信息缺失：${jobId}`);
  }
  const identity = jobIdentityFrom({ ...current, jobId: current.jobId || jobId }, { ...patch, jobId });
  const phase = normalizePhase({ ...current, ...patch });
  const createdAt = current.createdAt || patch.createdAt || current.steps?.[0]?.at || nowIso();
  const updatedAt = nowIso();
  const terminalStatus = ["done", "error", "cancelled"].includes(String(patch.status || ""));
  const terminalPatch =
    terminalStatus && !current.finishedAt
      ? {
          finishedAt: updatedAt,
          ...(patch.status === "done" ? { completedAt: updatedAt } : {}),
          ...(patch.status === "cancelled" ? { cancelledAt: updatedAt } : {}),
          ...(patch.status === "error" ? { errorAt: updatedAt } : {})
        }
      : {};
  const step = patch.stage
    ? {
        at: nowIso(),
        phaseKey: patch.phaseKey || phase.key,
        phaseLabel: patch.phaseLabel || phase.label,
        stage: patch.stage,
        progress: patch.progress ?? current.progress ?? 0,
        detail: patch.detail || "",
        completed: patch.completed,
        total: patch.total,
        foundCount: patch.foundCount,
        sourceCount: patch.sourceCount,
        currentModel: patch.currentModel,
        qualityLevel: patch.qualityLevel
      }
    : null;

  const next = decorateJob({
    ...current,
    ...patch,
    jobId,
    jobIdentity: current.jobIdentity || identity,
    company: identity.company || current.company || patch.company,
    targetCompanyName: identity.targetCompanyName,
    standardName: identity.standardName,
    companyName: identity.companyName,
    sellerProfileId: identity.sellerProfileId,
    sellerProfileName: identity.sellerProfileName,
    sellerProfileSnapshot: identity.sellerProfileSnapshot,
    companyKey: identity.companyKey || current.companyKey || patch.companyKey,
    region: identity.region,
    industry: identity.industry,
    ...terminalPatch,
    createdAt,
    phaseKey: patch.phaseKey || phase.key,
    phaseLabel: patch.phaseLabel || phase.label,
    steps: step ? [...(current.steps || []), step].slice(-80) : current.steps || [],
    updatedAt
  });
  await writeJson("jobs", `${jobId}.json`, next);
  return next;
}

async function assertJobNotCancelled(jobId) {
  const current = await readJson("jobs", `${jobId}.json`, null);
  if (current?.cancelRequested || current?.status === "cancelled") {
    throw new JobCancelledError("任务已停止，未生成正式报告。");
  }
}

export async function createJob(company, reason = "generate", runtimeMode = null, sellerProfile = null) {
  const jobId = id("job", primaryCompanyName(company));
  const now = nowIso();
  const sellerSnapshot = sellerProfile ? profileSnapshot(sellerProfile) : company.sellerProfileSnapshot || null;
  const jobCompany = {
    ...company,
    sellerProfileId: sellerSnapshot?.profileId || company.sellerProfileId || company.profileId || "",
    sellerProfileName: sellerSnapshot?.companyName || company.sellerProfileName || "",
    sellerProfileSnapshot: sellerSnapshot,
    runtimeMode
  };
  const targetCompanyName = jobCompany.standardName || jobCompany.name || jobCompany.companyName || jobCompany.query || "";
  const jobIdentity = {
    jobId,
    targetCompanyName,
    standardName: targetCompanyName,
    companyName: targetCompanyName,
    sellerProfileId: jobCompany.sellerProfileId,
    sellerProfileName: jobCompany.sellerProfileName,
    sellerProfileSnapshot: sellerSnapshot
  };
  const detail =
    reason === "refresh"
      ? `已确认重新生成，完成后会覆盖近 ${RECENT_REPORT_DAYS} 天内同企业报告入口。`
      : "已选择企业主体，等待启动深度检索。";
  await writeJson(
    "jobs",
    `${jobId}.json`,
    decorateJob({
      jobId,
      jobIdentity,
      company: jobCompany,
      companyName: targetCompanyName,
      standardName: targetCompanyName,
      targetCompanyName,
      region: jobCompany.region || "",
      industry: jobCompany.industry || "",
      reason,
      status: "queued",
      progress: 10,
      runtimeMode,
      phaseKey: "resolve",
      phaseLabel: "主体核对",
      stage: "企业核对完成",
      detail,
      steps: [
        {
          at: now,
          phaseKey: "resolve",
          phaseLabel: "主体核对",
          stage: "企业核对完成",
          progress: 10,
          detail
        }
      ],
      companyKey: companyKey(jobCompany),
      sellerProfileId: jobCompany.sellerProfileId,
      sellerProfileName: jobCompany.sellerProfileName,
      sellerProfileSnapshot: sellerSnapshot,
      createdAt: now,
      updatedAt: now
    })
  );
  return jobId;
}

export async function findLatestReport(company, days = RECENT_REPORT_DAYS) {
  const index = await getIndex();
  return recentReportsForCompany(index, typeof company === "string" ? { standardName: company } : company, days)[0] || null;
}

export async function runReportJob(jobId) {
  const workerStartedAt = Date.now();
  const job = await readJson("jobs", `${jobId}.json`, null);
  if (!job) throw new Error(`任务不存在：${jobId}`);
  if (!hasRunnableJobIdentity({ ...job, jobId: job.jobId || jobId })) {
    await updateJob(jobId, {
      status: "error",
      progress: Math.max(Number(job.progress || 0), 100),
      phaseKey: job.phaseKey || "resolve",
      stage: "任务身份信息缺失",
      detail: "任务缺少目标客户或我的企业绑定信息，已停止生成，请重新创建任务。",
      error: "job identity missing"
    });
    return null;
  }
  const runtimeMode = job.runtimeMode || job.company?.runtimeMode || null;
  const annualReportEvidence = await readAnnualReportEvidence(job.company?.annualReportId);
  const checkpoint = job.checkpoint || {};
  const sellerProfile = job.sellerProfileSnapshot || job.company?.sellerProfileSnapshot || (job.sellerProfileId ? await getProfile(job.sellerProfileId) : null);
  const company = annualReportEvidence
    ? {
        ...job.company,
        sellerProfileId: sellerProfile?.profileId || job.sellerProfileId || "",
        sellerProfileName: sellerProfile?.companyName || job.sellerProfileName || "",
        sellerProfileSnapshot: sellerProfile ? profileSnapshot(sellerProfile) : null,
        runtimeMode,
        annualReportEvidence,
        annualReportSummary: {
          annualReportId: annualReportEvidence.annualReportId,
          fileName: annualReportEvidence.fileName,
          pageCount: annualReportEvidence.pageCount,
          metrics: annualReportEvidence.metrics,
          sections: annualReportEvidence.sections,
          warnings: annualReportEvidence.warnings
        }
      }
    : {
        ...job.company,
        sellerProfileId: sellerProfile?.profileId || job.sellerProfileId || "",
        sellerProfileName: sellerProfile?.companyName || job.sellerProfileName || "",
        sellerProfileSnapshot: sellerProfile ? profileSnapshot(sellerProfile) : null,
        runtimeMode
      };

  await updateJob(jobId, {
    status: "running",
    progress: 15,
    phaseKey: "cache",
    stage: "缓存检查",
    detail: annualReportEvidence
      ? `已接入用户上传年报《${annualReportEvidence.fileName}》，将优先用于财务与经营证据。`
      : "未命中可直接复用的近 7 天报告，开始公开信息检索。"
  });

  await assertJobNotCancelled(jobId);
  let collectedSources = restoreSourcesFromCheckpoint(checkpoint);
  let sourceAudit = checkpoint.sourceAudit || null;
  let sources = collectedSources;
  let quality = checkpoint.quality || null;
  let sensitiveVerification = checkpoint.sensitiveVerification || null;

  if (!sources || !sourceAudit || !quality) {
    collectedSources = await collectSources(
    company,
    async (progress, stage, meta = {}) => {
      await updateJob(jobId, { status: "running", progress, stage, ...meta });
      await assertJobNotCancelled(jobId);
    },
    {
      runtimeMode,
      shouldCancel: async () => {
        const current = await readJson("jobs", `${jobId}.json`, {});
        return Boolean(current?.cancelRequested || current?.status === "cancelled");
      }
    }
  );
    sourceAudit = auditSources(collectedSources, { company, max: 200, min: 15 });
    sources = sourceAudit.sources;
  Object.defineProperty(sources, "usedModels", {
    value: collectedSources.usedModels || [],
    enumerable: false
  });

  await assertJobNotCancelled(jobId);
    quality = qualityWithAnnualEvidence(evaluateSourceQuality(sources), annualReportEvidence);
    sensitiveVerification = await verifySensitiveInformation(
      company,
      sources,
      null,
      async (progress, stage, meta = {}) => {
        await updateJob(jobId, { status: "running", progress, stage, ...meta });
        await assertJobNotCancelled(jobId);
      }
    );
    if (sensitiveVerification.supplementalSources?.length) {
      sourceAudit = auditSources([...sources, ...sensitiveVerification.supplementalSources], { company, max: 200, min: 15 });
      sources = sourceAudit.sources;
      Object.defineProperty(sources, "usedModels", {
        value: collectedSources.usedModels || [],
        enumerable: false
      });
      quality = qualityWithAnnualEvidence(evaluateSourceQuality(sources), annualReportEvidence);
    }
    await saveCheckpoint(jobId, {
      stage: "sources",
      sources,
      sourceAudit,
      quality,
      sensitiveVerification,
      usedModels: collectedSources.usedModels || []
    });
  } else {
    await updateJob(jobId, {
      status: "running",
      progress: 78,
      phaseKey: "quality",
      stage: "从断点恢复",
      foundCount: sources.length,
      sourceCount: quality.verifiedSourceCount,
      qualityLevel: quality.qualityLevel,
      detail: "已恢复上次保存的来源、证据审计和质量评估，将继续模型分析。"
    });
  }
  await updateJob(jobId, {
    status: "running",
    progress: 79,
    phaseKey: "quality",
    stage: "证据质检",
    foundCount: collectedSources.length,
    sourceCount: quality.verifiedSourceCount,
    qualityLevel: quality.qualityLevel,
    quality,
    detail:
      sourceAudit.removedCount > 0
        ? `来源审计已隐藏/合并 ${sourceAudit.removedCount} 条低相关、重复或错误来源；${quality.qualityLabel}：可校验来源 ${quality.verifiedSourceCount} 条，可读来源 ${quality.readableSourceCount} 条，覆盖 ${quality.topicCoverageCount} 类主题。`
        : quality.qualityLevel === "diagnostic"
          ? `来源未达最低门槛：${formatQualityWarnings(quality.qualityWarnings).join("；")}`
          : `${quality.qualityLabel}：可校验来源 ${quality.verifiedSourceCount} 条，可读来源 ${quality.readableSourceCount} 条，覆盖 ${quality.topicCoverageCount} 类主题。`
  });

  let structured;
  if (quality.qualityLevel === "diagnostic") {
    structured = {
      ...buildDiagnosticReport(company, sources, quality),
      modelName: "source-gate",
      modelChannel: "no-model",
      usedModels: sources.usedModels || []
    };
  } else {
    await assertJobNotCancelled(jobId);
    try {
      structured = await generateStructuredReport(
        { ...company, sensitiveVerification },
        sources,
        quality,
        async (progress, stage, meta = {}) => {
          await updateJob(jobId, { status: "running", progress, stage, ...meta });
          await assertJobNotCancelled(jobId);
        },
        {
          checkpoint,
          shouldYield: () => shouldYieldWorker(workerStartedAt),
          onCheckpoint: async (patch) => {
            await saveCheckpoint(jobId, {
              sources,
              sourceAudit,
              quality,
              sensitiveVerification,
              usedModels: patch.usedModels || checkpoint.usedModels || sources.usedModels || [],
              ...patch
            });
          },
          onYield: async () => {
            await updateJob(jobId, {
              status: "needs_resume",
              phaseKey: "analysis",
              progress: 91,
              stage: "等待续跑",
              detail: "已保存模型分析进度，后台函数接近本次运行预算，将从断点继续。"
            });
            throw new JobNeedsResumeError();
          }
        }
      );
    } catch (error) {
      if (error?.name === "JobNeedsResumeError") return null;
      throw error;
    }
  }

  await assertJobNotCancelled(jobId);
  const postSensitiveVerification = await verifySensitiveInformation(
    company,
    sources,
    structured,
    async (progress, stage, meta = {}) => {
      await updateJob(jobId, {
        status: "running",
        progress: Math.max(79, Math.min(95, progress)),
        stage,
        ...meta
      });
      await assertJobNotCancelled(jobId);
    }
  );
  sensitiveVerification = mergeSensitiveVerifications(sensitiveVerification, postSensitiveVerification);
  const now = nowIso();
  const jobStartedAt = job.createdAt || job.steps?.[0]?.at || now;
  const durationMs = Math.max(0, Date.parse(now) - Date.parse(jobStartedAt));
  const standardName = structured.standardName || primaryCompanyName(company);
  const reportId = `${slugify(standardName)}-${Date.now()}`;
  const baseReport = {
    ...structured,
    reportId,
    companyName: company.name || company.query || standardName,
    standardName,
    targetCompanyName: standardName,
    companyKey: companyKey({ ...company, standardName }),
    sellerProfileId: company.sellerProfileId || "",
    sellerProfileName: company.sellerProfileName || "",
    sellerProfileSnapshot: company.sellerProfileSnapshot || null,
    aiNeeds: company.aiNeeds || "",
    runtimeMode,
    userContext: {
      ...(structured.userContext || {}),
      aiNeeds: company.aiNeeds || ""
    },
    generatedAt: now,
    updatedAt: now,
    durationMs,
    sourceCount: quality.verifiedSourceCount,
    rawSourceCount: sources.length,
    verifiedSourceCount: quality.verifiedSourceCount,
    readableSourceCount: quality.readableSourceCount,
    topicCoverageCount: quality.topicCoverageCount,
    evidencePool: buildEvidencePool(sources),
    coveredTopics: quality.coveredTopics,
    missingTopics: quality.missingTopics,
    qualityLevel: quality.qualityLevel,
    qualityLabel: quality.qualityLabel,
    qualityWarnings: [...quality.qualityWarnings, ...sourceAudit.warnings],
    sourceAudit: {
      removedCount: sourceAudit.removedCount,
      removed: sourceAudit.removed.slice(0, 20),
      warnings: sourceAudit.warnings
    },
    usedModels: structured.usedModels || sources.usedModels || [],
    modelDisplay: structured.modelDisplay || structured.modelName
  };
  const fallbackFit = buildOpportunityFit(baseReport, company.sellerProfileSnapshot);
  const modelFit = baseReport.opportunityFit || {};
  baseReport.opportunityFit = {
    ...fallbackFit,
    ...modelFit,
    fitPoints: (modelFit.fitPoints || []).length ? modelFit.fitPoints : fallbackFit.fitPoints,
    entryScenarios: (modelFit.entryScenarios || []).length ? modelFit.entryScenarios : fallbackFit.entryScenarios,
    noCommitments: (modelFit.noCommitments || []).length ? modelFit.noCommitments : fallbackFit.noCommitments,
    validationQuestions: (modelFit.validationQuestions || []).length ? modelFit.validationQuestions : fallbackFit.validationQuestions
  };
  if (annualReportEvidence) {
    baseReport.annualReportEvidence = annualReportEvidence;
    baseReport.qualityWarnings = [...baseReport.qualityWarnings, ...(annualReportEvidence.warnings || [])];
  }
  baseReport.sensitiveVerification = sensitiveVerification;
  let verifiedBaseReport = applySensitiveVerification(baseReport, sensitiveVerification);
  const auditedBaseReport = auditReport(verifiedBaseReport);
  const report = normalizeReportShape({
    ...auditedBaseReport,
    opportunityRating: resolveOpportunityRating(auditedBaseReport)
  });
  const html = renderReportHtml(report);

  await writeJson("reports", `${reportId}.json`, report);
  await writeText("reports", `${reportId}.html`, html);

  const index = await getIndex();
  const entry = {
    reportId,
    companyName: report.companyName,
    standardName: report.standardName,
    targetCompanyName: report.targetCompanyName || report.standardName,
    companyKey: report.companyKey,
    sellerProfileId: report.sellerProfileId || "",
    sellerProfileName: report.sellerProfileName || "未绑定我的企业",
    sellerProfileSnapshot: report.sellerProfileSnapshot || null,
    opportunityFit: report.opportunityFit,
    reportMode: report.reportMode,
    activeRoundNo: report.activeRoundNo,
    roundCount: (report.rounds || []).length,
    aliases: report.aliases || [],
    region: report.region || company.region || "",
    industry: report.industry || company.industry || "",
    keywords: report.keywords || [],
    sourceCount: report.sourceCount,
    verifiedSourceCount: report.verifiedSourceCount,
    readableSourceCount: report.readableSourceCount,
    topicCoverageCount: report.topicCoverageCount,
    qualityLevel: report.qualityLevel,
    qualityLabel: report.qualityLabel,
    opportunityRating: ratingIndex(report.opportunityRating),
    durationMs: report.durationMs,
    generatedAt: now,
    updatedAt: now,
    modelName: report.modelName,
    modelChannel: report.modelChannel,
    modelDisplay: report.modelDisplay,
    usedModels: report.usedModels || []
  };
  await saveIndex({
    reports: mergeIndexReports(index.reports || [], entry)
  });

  await updateJob(jobId, {
    status: "done",
    progress: 100,
    phaseKey: "report",
    stage: report.qualityLevel === "diagnostic" ? "检索诊断生成" : "报告生成",
    detail:
      report.qualityLevel === "diagnostic"
        ? `证据不足，已生成检索诊断。可校验来源 ${report.sourceCount} 条。`
        : `${report.qualityLabel}已生成，可校验来源 ${report.sourceCount} 条。`,
    reportId,
    report,
    foundCount: sources.length,
    sourceCount: report.sourceCount,
    qualityLevel: report.qualityLevel
  });
  return report;
}

export async function cancelJob(jobId) {
  const current = await readJson("jobs", `${jobId}.json`, null);
  if (!current) throw new Error(`任务不存在：${jobId}`);
  if (["done", "error", "cancelled"].includes(current.status)) return decorateJob(current);
  await updateJob(jobId, {
    cancelRequested: true,
    status: "cancelled",
    progress: current.progress || 100,
    phaseKey: current.phaseKey || normalizePhase(current).key,
    stage: "任务已停止",
    detail: "用户已确认停止本次生成。系统不会生成正式报告，也不会写入历史报告。"
  });
  return readJson("jobs", `${jobId}.json`, null);
}

export async function improveReport(reportId, userInput) {
  const input = String(userInput || "").trim();
  if (!reportId) throw new Error("缺少报告ID");
  if (!input) throw new Error("缺少补充信息");

  const current = await readJson("reports", `${reportId}.json`, null);
  if (!current) throw new Error(`报告不存在：${reportId}`);

  const improved = await improveStructuredReport(current, input);
  const sensitiveVerification = mergeSensitiveVerifications(
    current.sensitiveVerification,
    await verifySensitiveInformation(current, current.sources || [], improved)
  );
  const verifiedImproved = applySensitiveVerification(
    { ...improved, sensitiveVerification },
    sensitiveVerification
  );
  const auditedImproved = auditReport(verifiedImproved);
  const report = appendPostVisitRound(current, {
    ...auditedImproved,
    opportunityRating: resolveOpportunityRating(auditedImproved)
  }, input);
  const html = renderReportHtml(report);

  await writeJson("reports", `${reportId}.json`, report);
  await writeText("reports", `${reportId}.html`, html);

  const index = await getIndex();
  await saveIndex({
    reports: (index.reports || []).map((entry) =>
      entry.reportId === reportId
        ? {
            ...entry,
            standardName: report.standardName,
            targetCompanyName: report.targetCompanyName || report.standardName,
            sellerProfileId: report.sellerProfileId || "",
            sellerProfileName: report.sellerProfileName || "未绑定我的企业",
            sellerProfileSnapshot: report.sellerProfileSnapshot || null,
            opportunityFit: report.opportunityFit,
            reportMode: report.reportMode,
            activeRoundNo: report.activeRoundNo,
            roundCount: (report.rounds || []).length,
            aliases: report.aliases || [],
            region: report.region || "",
            industry: report.industry || "",
            keywords: report.keywords || [],
            sourceCount: report.sourceCount,
            verifiedSourceCount: report.verifiedSourceCount,
            readableSourceCount: report.readableSourceCount,
            topicCoverageCount: report.topicCoverageCount,
            qualityLevel: report.qualityLevel,
            qualityLabel: report.qualityLabel,
            opportunityRating: ratingIndex(report.opportunityRating),
            durationMs: report.durationMs,
            updatedAt: report.updatedAt,
            modelName: report.modelName,
            modelChannel: report.modelChannel,
            modelDisplay: report.modelDisplay,
            usedModels: report.usedModels || []
          }
        : entry
    )
  });

  return {
    report,
    html,
    changeSummary: report.changeSummary || [],
    updatedSections: report.updatedSections || []
  };
}
