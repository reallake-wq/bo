import { buildOpportunityRating, ratingIndex } from "./opportunity-rating.mjs";

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function latestFeedbackText(report = {}) {
  const rounds = arr(report.rounds);
  if (!rounds.length) return "";
  const activeNo = Number(report.activeRoundNo || rounds[rounds.length - 1]?.roundNo || 0);
  const active = rounds.find((round) => Number(round.roundNo) === activeNo) || rounds[rounds.length - 1];
  if (active?.type !== "post_visit") return "";
  return String(active.inputText || active.inputSummary || "").trim();
}

export function resolveOpportunityRating(report = {}) {
  const feedback = latestFeedbackText(report);
  if (!feedback) return buildOpportunityRating(report || {});
  return buildOpportunityRating({
    ...report,
    aiNeeds: [report.aiNeeds, `用户拜访反馈：${feedback}`].filter(Boolean).join("；")
  });
}

export function resolveRatingIndex(report = {}) {
  return ratingIndex(resolveOpportunityRating(report));
}

export function ratingChanged(previous = {}, next = {}) {
  const keys = ["status", "version", "grade", "score", "priorityLevel", "label", "confidenceScore", "confidenceLabel"];
  return keys.some((key) => String(previous?.[key] ?? "") !== String(next?.[key] ?? ""));
}
