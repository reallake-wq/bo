import { nowIso } from "./util.mjs";

export const JOB_PHASES = [
  { key: "resolve", label: "主体核对", start: 0, end: 8 },
  { key: "cache", label: "缓存检查", start: 8, end: 12 },
  { key: "plan", label: "检索规划", start: 12, end: 20 },
  { key: "finance", label: "上市公司财务采集", start: 20, end: 30 },
  { key: "search", label: "分主题检索", start: 30, end: 62 },
  { key: "read", label: "来源读取", start: 62, end: 78 },
  { key: "quality", label: "证据质检", start: 78, end: 80 },
  { key: "analysis", label: "模型分析", start: 80, end: 96 },
  { key: "report", label: "报告生成", start: 96, end: 100 }
];

const PHASE_BY_KEY = new Map(JOB_PHASES.map((phase) => [phase.key, phase]));
const PHASE_ESTIMATE_MS = {
  resolve: 20 * 1000,
  cache: 15 * 1000,
  plan: 2 * 60 * 1000,
  finance: 2 * 60 * 1000,
  search: 5 * 60 * 1000,
  read: 4 * 60 * 1000,
  quality: 25 * 1000,
  analysis: 5 * 60 * 1000,
  report: 30 * 1000
};

export class JobCancelledError extends Error {
  constructor(message = "任务已停止") {
    super(message);
    this.name = "JobCancelledError";
  }
}

export function phaseForProgress(progress = 0) {
  const value = Number(progress || 0);
  return (
    JOB_PHASES.find((phase) => value >= phase.start && value <= phase.end) ||
    JOB_PHASES.find((phase) => value < phase.end) ||
    JOB_PHASES[JOB_PHASES.length - 1]
  );
}

export function normalizePhase(input = {}) {
  const key = input.phaseKey || phaseForProgress(input.progress).key;
  return PHASE_BY_KEY.get(key) || phaseForProgress(input.progress);
}

export function durationText(ms) {
  const value = Number(ms || 0);
  if (!Number.isFinite(value) || value <= 0) return "0秒";
  const totalSeconds = Math.max(1, Math.round(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours}小时${rest}分钟` : `${hours}小时`;
  }
  if (minutes > 0) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}

function estimateRemaining(job, elapsedMs) {
  const progress = Math.max(1, Math.min(99, Number(job.progress || 0)));
  if (!["queued", "running", "needs_resume"].includes(job.status)) return 0;
  const defaultTotal = 15 * 60 * 1000;
  const byProgress = progress >= 8 && elapsedMs >= 8000 ? (elapsedMs / progress) * 100 : defaultTotal;
  const totalEstimate = Math.max(defaultTotal * 0.55, Math.min(defaultTotal * 1.8, byProgress));
  return Math.max(0, Math.round(totalEstimate - elapsedMs));
}

export function decorateJob(job = {}) {
  const created = Date.parse(job.createdAt || job.updatedAt || nowIso());
  const updated = Date.parse(job.updatedAt || job.createdAt || nowIso());
  const isTerminal = ["done", "error", "cancelled"].includes(String(job.status || ""));
  const finished = Date.parse(job.finishedAt || job.completedAt || job.cancelledAt || job.errorAt || (isTerminal ? job.updatedAt : "") || "");
  const endTime = isTerminal && Number.isFinite(finished) ? finished : Date.now();
  const elapsedMs = Number.isFinite(created) ? Math.max(0, endTime - created) : 0;
  const currentPhase = normalizePhase(job);
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const now = endTime;
  const phaseTree = JOB_PHASES.map((phase) => {
    const phaseSteps = steps.filter((step) => (step.phaseKey || phaseForProgress(step.progress).key) === phase.key);
    const last = phaseSteps[phaseSteps.length - 1];
    let status = "pending";
    if (job.status === "done" && phase.key === "report") status = "done";
    else if (job.status === "cancelled" && phase.key === currentPhase.key) status = "cancelled";
    else if (job.status === "error" && phase.key === currentPhase.key) status = "error";
    else if (phase.end <= Number(job.progress || 0)) status = "done";
    else if (phase.key === currentPhase.key) status = "running";
    const firstAt = phaseSteps[0]?.at ? Date.parse(phaseSteps[0].at) : NaN;
    const lastAt = last?.at ? Date.parse(last.at) : NaN;
    const phaseElapsedMs = Number.isFinite(firstAt)
      ? Math.max(0, (status === "running" ? now : Number.isFinite(lastAt) ? lastAt : now) - firstAt)
      : 0;
    const phaseProgress =
      last?.completed != null && last?.total
        ? Math.max(0.05, Math.min(0.98, Number(last.completed) / Math.max(Number(last.total), 1)))
        : status === "done"
          ? 1
          : status === "running"
            ? Math.max(0.08, Math.min(0.95, (Number(job.progress || 0) - phase.start) / Math.max(phase.end - phase.start, 1)))
            : 0;
    const defaultEstimate = PHASE_ESTIMATE_MS[phase.key] || 90 * 1000;
    const projectedTotal = phaseProgress > 0.08 ? Math.max(defaultEstimate * 0.5, Math.min(defaultEstimate * 2.2, phaseElapsedMs / phaseProgress)) : defaultEstimate;
    const phaseEstimatedRemainingMs = status === "running" ? Math.max(0, Math.round(projectedTotal - phaseElapsedMs)) : 0;
    return {
      ...phase,
      status,
      currentStep: last?.detail || last?.stage || "",
      completed: last?.completed,
      total: last?.total,
      foundCount: last?.foundCount,
      sourceCount: last?.sourceCount,
      qualityLevel: last?.qualityLevel,
      phaseElapsedMs,
      phaseElapsedText: phaseElapsedMs ? durationText(phaseElapsedMs) : "",
      phaseEstimatedRemainingMs,
      phaseEstimatedRemainingText: status === "running" ? `约${durationText(phaseEstimatedRemainingMs)}` : ""
    };
  });
  const estimatedRemainingMs = estimateRemaining(job, elapsedMs);
  const estimateMinMs = estimatedRemainingMs > 0 ? Math.max(60 * 1000, Math.round(estimatedRemainingMs * 0.75)) : estimatedRemainingMs;
  const estimateMaxMs = estimatedRemainingMs > 0 ? Math.max(estimateMinMs, Math.round(estimatedRemainingMs * 1.35)) : estimatedRemainingMs;
  const estimatedText =
    estimatedRemainingMs <= 0
      ? "即将完成"
      : estimateMaxMs - estimateMinMs > 90 * 1000
        ? `约${durationText(estimateMinMs)}-${durationText(estimateMaxMs)}`
        : `约${durationText(estimatedRemainingMs)}`;
  return {
    ...job,
    elapsedMs,
    elapsedText: durationText(elapsedMs),
    updatedAgoMs: Number.isFinite(updated) ? Math.max(0, Date.now() - updated) : 0,
    updatedAgoText: Number.isFinite(updated) ? durationText(Math.max(0, Date.now() - updated)) : "",
    estimatedRemainingMs,
    etaRangeMs: [estimateMinMs, estimateMaxMs],
    estimatedRemainingText: estimatedText,
    currentPhaseKey: currentPhase.key,
    currentPhaseLabel: currentPhase.label,
    phaseTree
  };
}
