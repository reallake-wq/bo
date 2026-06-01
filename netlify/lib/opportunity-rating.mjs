import { BRIEF_SOURCE_MIN } from "./report-quality.mjs";

export const OPPORTUNITY_RATING_VERSION = "presales-v5";

const MODEL_BASIS =
  "OAC 初访优先级模型参考 BANT（预算/权限/需求/时机）、MEDDICC（指标/经济买方/决策标准/痛点）和售前交付可行性评估，重心是判断初次拜访前是否值得投入售前资源。";
const SCORING_METHOD =
  "评分采用“加权评分 + BANT/MEDDICC关键项闸门 + 关键短板封顶 + 风险闸门 + 置信度分离”。总分不是简单平均，也不是直接取最低分；预算/付款、权限/经济买方、真实需求/痛点、时机、指标价值和决策风险会限制最高等级。公开资料不足的维度标记为“未知”，不按低分处理，只降低置信度并进入拜访问卷。";

const DIMENSIONS = [
  { key: "budgetAbility", title: "预算与付款能力", weight: 20 },
  { key: "triggerStrength", title: "真实需求强度", weight: 18 },
  { key: "roiPotential", title: "投入产出价值", weight: 18 },
  { key: "capabilityFit", title: "我方能力匹配", weight: 16 },
  { key: "implementationReadiness", title: "落地成熟度", weight: 14 },
  { key: "decisionRiskControl", title: "决策与风险可控", weight: 14 }
];

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
}

function textOf(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  if (typeof value === "object") return Object.values(value).map(textOf).join(" ");
  return "";
}

function countTerms(text, terms) {
  return terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0);
}

function countMatches(text, patterns) {
  return patterns.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
}

function hasDecisionConcentration(text) {
  return /决策链条相对集中|决策相对集中|所有权与经营权于一身|创始人.{0,20}(经营权|控制权|实际控制)|实际控制人|法定代表人/.test(text);
}

function decisionUnknownSignals(text) {
  let score = countMatches(text, [
    /决策链.{0,16}(不清|不明确|未知|待确认|仍需确认)/,
    /拍板人.{0,16}(不清|不明确|未知|待确认|仍需确认)/,
    /预算归属.{0,16}(不清|不明确|未知|待确认|仍需确认)/,
    /采购权|立项权|谁说了算/,
    /总部决策|集团决策|母公司决策|集团.{0,12}审批|总部.{0,12}审批/
  ]);
  if (hasDecisionConcentration(text) && score <= 1) score = 0;
  return score;
}

function systemBoundarySignals(text) {
  return countMatches(text, [
    /数据安全|安全审批|数据边界|数据出境|客户数据|脱敏/,
    /系统接入|接口|权限|审计|日志/,
    /合规|法务|信息安全|等保/
  ]);
}

function metricValue(report, patterns) {
  const metrics = arr(report.customerInsights?.metrics);
  const item = metrics.find((metric) => patterns.some((pattern) => pattern.test(`${metric.label || ""} ${metric.title || ""}`)));
  return item ? `${item.value || ""} ${item.body || ""} ${item.note || ""} ${item.insight || ""}` : "";
}

function amountYi(value) {
  const text = String(value || "").replace(/[,，]/g, "");
  if (!text) return null;
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*(万亿|亿元|亿|万元|万|元)/);
  if (!match) return null;
  const num = Number(match[1]);
  if (!Number.isFinite(num)) return null;
  const unit = match[2];
  if (unit === "万亿") return num * 10000;
  if (unit === "亿元" || unit === "亿") return num;
  if (unit === "万元" || unit === "万") return num / 10000;
  if (unit === "元") return num / 100000000;
  return null;
}

function percentageValue(value) {
  const match = String(value || "").match(/(-?\d+(?:\.\d+)?)\s*%/);
  return match ? Number(match[1]) : null;
}

function financialSignals(report) {
  const revenueYi = amountYi(metricValue(report, [/营收|营业收入|净销售额|收入/]));
  const profitYi = amountYi(metricValue(report, [/归母净利润|净利润|扣非净利润|利润/]));
  const cashflowYi = amountYi(metricValue(report, [/现金流|经营现金/]));
  const rdYi = amountYi(metricValue(report, [/研发/]));
  const margin = percentageValue(metricValue(report, [/毛利率|经营利润率|净利率/]));
  const assetDebt = percentageValue(metricValue(report, [/资产负债率|负债率/]));
  return { revenueYi, profitYi, cashflowYi, rdYi, margin, assetDebt };
}

function moneyText(yi) {
  if (yi == null || !Number.isFinite(yi)) return "";
  if (Math.abs(yi) >= 1) return `${Number(yi.toFixed(2))}亿元`;
  return `${Number((yi * 10000).toFixed(0))}万元`;
}

function hasConcreteBudgetEvidence(text = "") {
  const value = String(text || "");
  return (
    /(?:中标|合同|采购|招标|预算|融资|投资|补助|研发投入|注册资本|实缴资本).{0,32}(?:-?\d+(?:\.\d+)?\s*(?:万|万元|亿|亿元|人民币|元)|[A-D]轮|Pre-A|IPO|上市)/i.test(value) ||
    /(?:-?\d+(?:\.\d+)?\s*(?:万元|亿元|人民币|元)).{0,32}(?:中标|合同|采购|预算|融资|投资|补助|研发投入|注册资本|实缴资本)/i.test(value)
  );
}

function timingSignalCount(text = "") {
  return countMatches(String(text || ""), [
    /采购意向|采购预算|预算金额|采购公告|招标公告|招标计划|政府采购|项目编号|合同公告/,
    /项目金额|合同金额|中标金额|投资额/,
    /新建|新设|扩产|投产|新基地|技改|改造|产能/,
    /融资|募资|IPO|上市|募投|并购|专项资金|政府补助|补贴|重点研发/,
    /组织调整|高管变更/
  ]);
}

function dimension(key, score, evidence = [], deductions = [], questions = []) {
  const base = DIMENSIONS.find((item) => item.key === key) || { title: key, weight: 0 };
  return {
    key,
    title: base.title,
    weight: base.weight,
    score: clamp(score),
    evidence: evidence.filter(Boolean).slice(0, 4),
    deductions: deductions.filter(Boolean).slice(0, 4),
    questions: questions.filter(Boolean).slice(0, 4)
  };
}

function markUnknownDimension(item, reason) {
  item.status = "unknown";
  item.displayScore = "未知";
  item.conclusion = "当前不把这一项作为投入判断依据。";
  item.unknownReason = reason;
  item.evidence = [];
  item.deductions = [];
  return item;
}

function markAssessedDimension(item) {
  if (item.status === "unknown") return item;
  item.status = "assessed";
  item.displayScore = `${item.score}分`;
  if (item.key === "budgetAbility") {
    if (item.score >= 72) item.conclusion = "预算与付款能力有一定支撑，可以推进中小规模验证，并把专项预算和付款主体作为首轮商务核对重点。";
    else if (item.score >= 58) item.conclusion = "预算能力不能直接判定为强，适合先做低成本场景核验，再谈定制投入。";
    else item.conclusion = "预算或付款能力是主要短板，当前只适合轻量触达和资格筛选。";
  } else if (item.key === "triggerStrength") {
    if (item.score >= 72) item.conclusion = "客户存在较明确业务触发，适合围绕具体问题推进。";
    else if (item.score >= 58) item.conclusion = "已有问题线索，首轮应把问题强度、损失口径和责任人问实。";
    else item.conclusion = "真实需求触发偏弱，容易停留在泛泛交流。";
  } else if (item.key === "roiPotential") {
    if (item.score >= 72) item.conclusion = "问题解决后具备较清晰的降本、提效或质量价值。";
    else if (item.score >= 58) item.conclusion = "存在价值方向，但需要把收益口径量化后才能支撑预算。";
    else item.conclusion = "投入产出逻辑不够清楚，短期难以推动客户付费。";
  } else if (item.key === "capabilityFit") {
    if (item.score >= 72) item.conclusion = "客户问题与我方能力匹配度较高，可准备对应解决方案。";
    else if (item.score >= 58) item.conclusion = "能力方向有交集，但需要确认具体场景后再定方案。";
    else item.conclusion = "当前线索与我方能力交集不足，不宜强推方案。";
  } else if (item.key === "implementationReadiness") {
    if (item.score >= 72) item.conclusion = "客户具备一定系统、数据或流程基础，适合讨论轻量试点。";
    else if (item.score >= 58) item.conclusion = "落地基础只适合先从系统、数据和业务样例做小场景验证。";
    else item.conclusion = "落地前置条件较多，可能需要先补数据治理或流程梳理。";
  } else if (item.key === "decisionRiskControl") {
    const text = textOf(item);
    if (item.score >= 72) item.conclusion = "公开风险较可控，首轮重点锁定能推动立项和采购的项目负责人。";
    else if (/经营\/控制角色相对集中/.test(text)) item.conclusion = "经营层线索相对清楚，但仍不能替代项目级预算归属、需求发起人和最终拍板路径。";
    else if (/项目级采购权|预算归属|最终拍板人/.test(text)) item.conclusion = "项目级决策人和预算归属尚未确认，适合先找到业务推进人。";
    else if (/数据安全|系统接入|合规审批/.test(text)) item.conclusion = "组织风险不在信用层面，主要是数据、系统接入和审批边界需要核实。";
    else item.conclusion = "决策或落地边界会限制推进效率，拿到拍板路径前只做轻量推进。";
  } else if (item.score >= 72) item.conclusion = "当前证据支撑较好，可作为优先判断依据。";
  else if (item.score >= 58) item.conclusion = "当前证据支持轻量推进，但需要现场补强。";
  else item.conclusion = "当前存在明显短板，会限制商机优先级。";
  return item;
}

function effectiveDimensionScore(item) {
  return item.status === "unknown" ? 55 : item.score;
}

function gradeOf(score) {
  if (score >= 86) return "A";
  if (score >= 72) return "B";
  if (score >= 58) return "C";
  return "D";
}

function levelOf(grade, confidenceScore) {
  if (confidenceScore < 40 && grade !== "A") return "待确认跟进";
  if (grade === "A") return "优先推进";
  if (grade === "B") return "重点跟进";
  if (grade === "C") return "轻量跟进";
  return "暂缓投入";
}

function nextActionOf(level, confidenceScore) {
  if (level === "优先推进") return confidenceScore < 55 ? "优先跟进，先补决策链和场景证据" : "优先安排会前输入和场景验证";
  if (level === "重点跟进") return "锁定痛点、角色和预算窗口";
  if (level === "轻量验证") return "先核验信用/法律、付款条件和项目预算，再判断是否升级投入";
  if (level === "轻量跟进") return "标准交流为主，少量验证客户真实需求";
  if (level === "待确认跟进") return "先做资格筛选";
  return "暂缓深度方案投入";
}

function confidenceLabel(score) {
  if (score >= 75) return "高";
  if (score >= 55) return "中";
  if (score >= 40) return "偏低";
  return "低";
}

function summaryOf(level, confidence, riskFlags) {
  if (level === "优先推进") return `建议优先推进：公开证据已支持投入售前准备，下一步要锁定业务场景、决策人和可验证样例；置信度${confidence}。`;
  if (level === "重点跟进") {
    const blocker = riskFlags[0];
    return blocker
      ? `建议重点但轻量推进：先拿到真实痛点、预算归属和决策人，再升级定制方案投入；当前最大变量是${blocker}，置信度${confidence}。`
      : `建议重点但轻量推进：公开资料支持继续接触，下一步重点问实真实痛点、项目级推进人和预算窗口；置信度${confidence}。`;
  }
  const blocker = riskFlags[0] || "关键商务输入";
  if (level === "轻量验证") return `建议先做资格核验：该线索有跟进价值，但${blocker}决定是否升级方案投入；置信度${confidence}。`;
  if (level === "轻量跟进") return `建议低成本保持触达：先用标准材料和问题清单验证客户是否有明确业务触发，不建议提前重投入；置信度${confidence}。`;
  if (level === "待确认跟进") return `建议低成本资格筛选：只投入客户画像、标准案例和问题清单，现场拿到真实需求、决策人和预算来源后再升级；置信度${confidence}。`;
  return riskFlags.length ? `建议暂缓深度投入：${riskFlags.slice(0, 2).join("、")}会显著影响投入产出。` : "建议暂缓深度方案资源，等待客户给出明确需求或预算线索。";
}

function presalesAdviceOf(level, confidenceScore) {
  if (level === "优先推进") {
    return confidenceScore < 55
      ? "按高潜商机处理，但先让一线补齐参会角色、业务场景和预算/立项线索，再投入定制方案。"
      : "可以优先投入售前准备，重点准备场景假设、客户问题清单和轻量验证方案。";
  }
  if (level === "重点跟进") return "建议进入培育和场景确认，不急于重方案；拿到明确痛点和推进人后再升级投入。";
  if (level === "轻量验证") return "建议先做低成本核验：确认信用/法律风险、付款条件、预算窗口和客户真实需求；核验通过后再进入方案投入。";
  if (level === "轻量跟进") return "建议保持轻量触达，以标准材料、行业案例和问题清单为主，避免过早进入定制交付。";
  if (level === "待确认跟进") return "先做资格筛选：客户是谁、谁参会、要解决什么问题、是否有下一步动作。拿到有效输入后再重新评级。";
  return "暂缓深度售前投入，只保留低成本线索维护或等待客户明确需求。";
}

function qualificationConditions(dimensions) {
  const byKey = Object.fromEntries(dimensions.map((item) => [item.key, item]));
  const items = [
    "本次沟通能明确一个具体业务场景，而不是泛泛讨论 AI。",
    "参会人覆盖业务负责人或 IT/质量/研发/设备/供应链等关键角色。",
    "客户愿意确认现有流程、数据边界和可接受的验证方式。",
    "下一步能形成明确动作：补资料、安排业务访谈、确认样例或讨论预算窗口。"
  ];
  if ((byKey.budgetAbility?.score || 0) < 62) items.push("补充利润、现金流、研发投入、年度预算或已立项项目证据。");
  if ((byKey.roiPotential?.score || 0) < 62) items.push("确认该问题解决后能带来降本、提效、质量改善或收入增长的量化价值。");
  if ((byKey.decisionRiskControl?.score || 0) < 62) items.push("确认本地主体与集团/总部之间的立项、采购和技术决策关系。");
  if ((byKey.triggerStrength?.score || 0) < 62) items.push("确认客户是否有质量、研发、设备、交付、知识沉淀等真实业务触发。");
  if ((byKey.implementationReadiness?.score || 0) < 62) items.push("提前确认数据基础、系统接口、业务样例和最小可行试点范围。");
  return Array.from(new Set(items)).slice(0, 7);
}

function disqualificationSignals(dimensions) {
  const byKey = Object.fromEntries(dimensions.map((item) => [item.key, item]));
  const items = [
    "客户只想泛泛了解 AI，没有具体业务场景或下一步安排。",
    "参会人无法触达业务、IT或预算相关角色。",
    "客户不愿提供流程、文档、样例数据或现有系统边界。",
    "要求免费重度定制、无明确范围的 POC 或过早投入承诺。"
  ];
  if ((byKey.budgetAbility?.score || 0) < 58) items.push("公开财务与经营线索显示预算能力偏弱，必须先锁定专项预算和强ROI场景。");
  if ((byKey.roiPotential?.score || 0) < 58) items.push("当前问题即使解决，也看不到足够明确的降本、提效、质量或收入价值。");
  if ((byKey.capabilityFit?.score || 0) < 58) items.push("客户问题主要不在知识、流程、数据、质量、研发或现场协同范围内。");
  return Array.from(new Set(items)).slice(0, 6);
}

function sensitiveCategory(report, key) {
  return arr(report.sensitiveVerification?.categories).find((item) => item.key === key) || null;
}

function hasDirectNoRiskEvidence(category) {
  return arr(category?.evidence).some((item) => item.noRiskHit && item.supportLevel === "direct");
}

function riskGateFromSensitive(category) {
  if (!category) return null;
  if (category.status === "verified") {
    return {
      status: "active",
      maxLevel: "轻量验证",
      summary: "系统已通过直接来源证实重大信用/法律风险线索，售前投入需先过风险闸门。",
      reasons: [category.summary]
    };
  }
  if (category.status === "multi_source") {
    return {
      status: "active",
      maxLevel: "轻量验证",
      summary: "系统找到多个第三方来源支持信用/法律风险线索，建议先核验付款与项目预算。",
      reasons: [category.summary]
    };
  }
  if (category.status === "conflict") {
    return {
      status: "conflict",
      maxLevel: "待确认跟进",
      summary: "公开来源存在信用/法律风险冲突，不宜自行判断风险结论。",
      reasons: [category.summary]
    };
  }
  if (category.status === "unverified") {
    return {
      status: "watch",
      maxLevel: "",
      summary: "存在未证实信用/法律风险线索，不直接降级商机，但会降低信息置信度。",
      reasons: [category.summary]
    };
  }
  return null;
}

export function buildOpportunityRating(report = {}) {
  const sourceCount = Number(report.verifiedSourceCount ?? report.sourceCount ?? 0);
  const hasAnnualEvidence = Boolean(report.annualReportEvidence);
  const hasAnyCustomerClue = Boolean(report.aiNeeds || report.userContext?.aiNeeds) || arr(report.pains).length || arr(report.solutions).length || sourceCount > 0;
  if ((report.qualityLevel === "diagnostic" || sourceCount < BRIEF_SOURCE_MIN) && !hasAnnualEvidence && !hasAnyCustomerClue) {
    return {
      status: "not_rated",
      version: OPPORTUNITY_RATING_VERSION,
      label: "暂不评级",
      notRatedReason: `当前只适合做资格筛选。系统已取得 ${sourceCount} 条可校验来源，但还缺少能支撑投入判断的业务、预算或需求线索。`,
      nextAction: "先补充资料与客户线索"
    };
  }

  const fullText = textOf(report);
  const sellerProfile = report.sellerProfileSnapshot || {};
  const sellerProfileText = textOf(sellerProfile);
  const targetText = textOf({ ...report, sellerProfileSnapshot: null, sellerProfileName: "", opportunityFit: null });
  const sellerTerms = Array.from(new Set(String(sellerProfileText || "").split(/[、,，\s\n]+/).filter((item) => item.length >= 2))).slice(0, 30);
  const sellerOverlap = sellerTerms.filter((term) => targetText.includes(term)).length;
  const aiNeeds = String(report.aiNeeds || report.userContext?.aiNeeds || "").trim();
  const pains = arr(report.pains);
  const solutions = arr(report.solutions);
  const metrics = arr(report.customerInsights?.metrics);
  const requirements = arr(report.requirements?.preMeeting).concat(arr(report.requirements?.onSite));
  const warnings = arr(report.qualityWarnings);
  const missingTopics = arr(report.missingTopics);

  const finance = financialSignals(report);
  const scaleHits = countTerms(fullText, ["上市", "集团", "全球", "头部", "营收", "收入", "净销售额", "亿元", "亿美元", "注册资本", "员工", "工厂", "园区", "主机厂", "客户"]);
  const budgetHits = countTerms(fullText, ["预算", "投资", "采购", "立项", "ROI", "付费", "资金", "研发投入", "数字化", "数据资产"]);
  let budgetScore = 48 + Math.min(12, scaleHits * 2) + Math.min(10, budgetHits * 2);
  if (finance.revenueYi != null) budgetScore += finance.revenueYi >= 10 ? 16 : finance.revenueYi >= 1 ? 10 : 3;
  if (finance.profitYi != null) {
    budgetScore += finance.profitYi >= 1 ? 18 : finance.profitYi >= 0.2 ? 10 : finance.profitYi >= 0.1 ? 4 : -12;
  }
  if (finance.cashflowYi != null) budgetScore += finance.cashflowYi > 0 ? 6 : -8;
  if (finance.rdYi != null) budgetScore += finance.rdYi >= 0.1 ? 7 : 3;
  if (finance.assetDebt != null && finance.assetDebt > 70) budgetScore -= 8;
  if (finance.profitYi != null && finance.profitYi < 0.1) budgetScore = Math.min(budgetScore, budgetHits >= 4 ? 60 : 52);
  const budgetDimension = dimension(
    "budgetAbility",
    budgetScore,
    [
      finance.revenueYi != null ? `已识别收入规模约 ${moneyText(finance.revenueYi)}。` : "",
      finance.profitYi != null ? `已识别利润规模约 ${moneyText(finance.profitYi)}。` : "",
      finance.cashflowYi != null ? `经营现金流约 ${moneyText(finance.cashflowYi)}。` : "",
      finance.revenueYi == null && finance.profitYi == null && /融资|B轮|投资|注册资本|实缴资本|员工|高新技术|专精特新/.test(fullText)
        ? "公开资料存在融资、注册资本、人员规模或资质等间接经营实力线索。"
        : "",
      finance.revenueYi == null && finance.profitYi == null && budgetHits >= 2
        ? "当前主要是间接经营实力线索，预算判断按轻量验证处理。"
        : ""
    ],
    [
      finance.profitYi != null && finance.profitYi < 0.1 ? `利润约 ${moneyText(finance.profitYi)}，大额 AI 项目支付能力需谨慎评估。` : "",
      finance.cashflowYi != null && finance.cashflowYi <= 0 ? "经营现金流为负或偏弱，付款能力需要前置核验。" : "",
      finance.revenueYi == null && finance.profitYi == null ? "缺少可用营收/利润硬指标，大额项目投入需先核对预算窗口。" : "",
      finance.assetDebt != null && finance.assetDebt > 70 ? "资产负债率偏高，付款和预算稳定性需核验。" : ""
    ],
    ["客户本次是否存在明确项目预算、年度数字化预算、试点预算或专项资金来源？"]
  );

  const triggerHits = pains.length * 4 + countTerms(fullText, ["质量", "交付", "返工", "停线", "设备", "排产", "研发", "DFM", "工艺", "知识", "成本", "效率"]);
  const directNeedHits = aiNeeds ? 24 : 0;
  const triggerDimension = dimension(
    "triggerStrength",
    38 + Math.min(42, triggerHits * 3) + directNeedHits,
    [
      aiNeeds ? "用户已补充客户需求线索，可作为现场验证重点。" : "",
      pains.length ? `报告形成了 ${pains.length} 个可验证痛点方向。` : ""
    ],
    [!aiNeeds ? "客户尚未直接表达 AI 需求，当前仍以公开信息推导为主。" : ""],
    ["客户最想优先解决的一个业务问题是什么？", "本次交流目标是认知交流、场景确认、演示验证还是立项评估？"]
  );

  const roiHits = countTerms(fullText, ["降本", "提效", "减少", "节省", "良率", "直通率", "返工", "停线", "库存", "交付", "质量", "研发周期", "人效", "成本", "收入", "客户满意"]);
  const valuePainCount = pains.filter((item) => /降本|提效|质量|良率|返工|交付|停线|研发|成本|库存|收入|客户/.test(textOf(item))).length;
  const roiDimension = dimension(
    "roiPotential",
    42 + Math.min(30, roiHits * 3) + Math.min(18, valuePainCount * 5) + Math.min(8, solutions.length * 2) - (finance.profitYi != null && finance.profitYi < 0.1 ? 6 : 0),
    [
      valuePainCount ? `已有 ${valuePainCount} 个痛点与降本、提效、质量、交付或收入价值相关。` : "",
      roiHits >= 4 ? "公开资料或方案中出现可量化业务价值信号。" : ""
    ],
    [
      roiHits < 3 ? "目前 ROI 证据偏弱，难以证明客户愿意为该问题付费。" : "",
      finance.profitYi != null && finance.profitYi < 0.1 ? "客户利润薄，方案必须能快速说明回本逻辑。" : ""
    ],
    ["该场景若解决，能带来多少降本、提效、良率提升、少返工或收入增长？"]
  );

  const fitHits = countTerms(targetText, ["智能体", "Agent", "知识库", "数据问答", "质量追溯", "排程", "设备", "工艺", "研发", "DFM", "可制造性", "供应链", "自动化", "工作流", "AI"]);
  const p0p1 = solutions.filter((item) => /P0|P1/i.test(String(item.priority || ""))).length;
  const hasSellerProfile = Boolean(report.sellerProfileId || sellerProfile.companyName);
  const fitDimension = dimension(
    "capabilityFit",
    38 + Math.min(32, fitHits * 4) + Math.min(12, p0p1 * 4) + (hasSellerProfile ? Math.min(14, sellerOverlap * 2) : -8),
    [
      hasSellerProfile ? `已绑定我的企业：${sellerProfile.companyName || report.sellerProfileName}。` : "",
      sellerOverlap >= 3 ? "目标客户线索与我的企业存在关键词重合。" : "",
      fitHits >= 5 ? "痛点和方案中出现 AI Agent、知识库、数据问答、流程自动化或研发工艺相关切入点。" : "",
      p0p1 ? "报告存在 P0/P1 级方案建议。" : ""
    ],
    [
      !hasSellerProfile ? "报告未绑定我的企业，能力匹配只能按通用口径判断。" : "",
      fitHits < 3 && sellerOverlap < 2 ? "当前材料与我的企业的直接匹配证据还不充分。" : ""
    ],
    ["客户是否允许使用脱敏样例、业务文档或流程数据评估方案边界？"]
  );

  const effectiveSourceCount = hasAnnualEvidence ? Math.max(sourceCount, 15) : sourceCount;
  const effectiveReadableCount = hasAnnualEvidence ? Math.max(Number(report.readableSourceCount || 0), 10) : Number(report.readableSourceCount || 0);
  const effectiveTopicCoverage = hasAnnualEvidence ? Math.max(Number(report.topicCoverageCount || 0), 3) : Number(report.topicCoverageCount || 0);
  const coverageScore = Math.min(32, effectiveSourceCount * 2) + Math.min(20, effectiveReadableCount * 2) + Math.min(24, effectiveTopicCoverage * 6);
  const unknownPenalty = Math.min(22, countTerms(fullText, ["待确认", "未取得", "不清", "未知", "需要确认"]));
  const confidenceScore = clamp(34 + coverageScore - unknownPenalty - Math.min(10, missingTopics.length * 2));
  const implementationHits = countTerms(fullText, ["ERP", "MES", "PLM", "QMS", "SCADA", "APS", "数据平台", "信息化", "数字化", "系统", "接口", "数据资产", "知识库", "设备联网"]);
  const implementationDimension = dimension(
    "implementationReadiness",
    46 + Math.min(22, implementationHits * 3) + Math.min(18, coverageScore / 4) - Math.min(16, unknownPenalty / 2),
    [
      implementationHits >= 4 ? "资料显示客户具备一定信息化、系统或数据基础。" : "",
      hasAnnualEvidence ? "已接入年报或强材料，可辅助判断组织与数据基础。" : "",
      `可读来源 ${effectiveReadableCount} 条，主题覆盖 ${effectiveTopicCoverage} 类。`
    ],
    [
      implementationHits < 3 ? "未看到足够系统、数据平台或流程数字化证据，可能需要从数据治理/流程梳理开始。" : "",
      missingTopics.length ? `仍缺少 ${missingTopics.length} 类主题覆盖。` : ""
    ],
    ["客户现有 ERP/MES/PLM/QMS/数据平台是什么？是否能导出样例数据或开放接口？"]
  );

  const decisionPositive =
    countTerms(fullText, ["负责人", "高管", "IT", "质量", "设备", "工艺", "研发", "供应链", "业务线", "参会角色", "董事长", "总经理", "一把手"]) +
    (hasDecisionConcentration(fullText) ? 2 : 0);
  const decisionUnknown = decisionUnknownSignals(fullText);
  const systemBoundaryRisk = systemBoundarySignals(fullText);
  const timingHits = timingSignalCount(fullText);
  const decisionRiskDimension = dimension(
    "decisionRiskControl",
    64 + Math.min(18, decisionPositive * 3) - Math.min(14, decisionUnknown * 7) - Math.min(12, systemBoundaryRisk * 3) - Math.min(8, warnings.length * 2),
    [
      hasDecisionConcentration(fullText) ? "公开资料显示经营/控制角色相对集中，只能说明经营入口较清楚，不能替代项目级拍板路径。" : "",
      decisionPositive >= 3 ? "报告已识别经营管理层或相关职能线索。" : "",
      sourceCount >= BRIEF_SOURCE_MIN ? `可校验来源 ${sourceCount} 条，达到初访判断门槛。` : ""
    ],
    [
      decisionUnknown > 0 ? "项目级采购权、预算归属或最终拍板人未在公开资料中闭环，重方案投入前仍需确认。" : "",
      systemBoundaryRisk >= 2 ? "涉及数据安全、系统接入或合规审批时，落地节奏取决于客户IT、法务或信息化审批流程。" : ""
    ],
    ["本次参会人能否影响采购、立项或预算？", "数据边界、安全审批、系统接入和合同主体分别由哪一方负责？"]
  );

  const infoDimension = dimension(
    "informationConfidence",
    confidenceScore,
    [
      hasAnnualEvidence ? `已接入用户上传年报，并保留 ${sourceCount} 条外部可校验来源。` : `可校验来源 ${sourceCount} 条。`,
      `可读来源 ${effectiveReadableCount} 条，主题覆盖 ${effectiveTopicCoverage} 类。`
    ],
    [
      missingTopics.length ? `仍缺少 ${missingTopics.length} 类主题覆盖。` : "",
      warnings.length ? `来源质量提醒 ${warnings.length} 条。` : ""
    ],
    ["是否能补充客户官网、会议主题、参会角色、已知业务线或客户直接需求？"]
  );

  const legalVerification = sensitiveCategory(report, "legalRisk");
  const legalRiskGate = riskGateFromSensitive(legalVerification);
  if (legalVerification?.status === "verified" || legalVerification?.status === "multi_source") {
    decisionRiskDimension.score = Math.min(decisionRiskDimension.score, 42);
    decisionRiskDimension.deductions.push(`信用/法律风险已核验：${legalVerification.summary}`);
    decisionRiskDimension.questions.push("会前优先核对付款条件、合同主体、项目预算和是否需要法务/管理层介入。");
  } else if (legalVerification?.status === "conflict") {
    decisionRiskDimension.score = Math.min(decisionRiskDimension.score, 48);
    decisionRiskDimension.deductions.push(`信用/法律信息存在冲突：${legalVerification.summary}`);
    decisionRiskDimension.questions.push("会前优先核对企业信用记录、付款条件和项目预算，避免自行裁决冲突信息。");
  } else if (legalVerification?.status === "unverified") {
    decisionRiskDimension.score = Math.min(decisionRiskDimension.score, 66);
    infoDimension.score = Math.min(infoDimension.score, 68);
    decisionRiskDimension.questions.push("信用、付款条件和项目预算要作为首轮商务复核项。");
    infoDimension.deductions.push("存在未证实敏感线索，信息置信度降低。");
  } else if (legalVerification?.status === "not_found") {
    decisionRiskDimension.evidence.push(
      hasDirectNoRiskEvidence(legalVerification)
        ? "系统检索到直接来源显示未发现相关信用/法律风险。"
        : "系统已检索信用/法律风险方向，未公开证实相关线索。"
    );
  }

  const hasBudgetHardEvidence = finance.revenueYi != null || finance.profitYi != null || finance.cashflowYi != null || finance.rdYi != null;
  if (!hasBudgetHardEvidence && !hasConcreteBudgetEvidence(fullText)) {
    markUnknownDimension(budgetDimension, "缺少营收、利润、现金流或明确预算线索，这一项暂不参与强判断。");
  }
  if (!aiNeeds && !pains.length && triggerHits < 3) {
    markUnknownDimension(triggerDimension, "缺少客户直接需求、会议主题或足够痛点证据，这一项暂不参与强判断。");
  }
  if (roiHits < 3 && valuePainCount === 0) {
    markUnknownDimension(roiDimension, "缺少降本、提效、质量、交付或收入改善信号，这一项暂不参与强判断。");
  }
  if ((fitHits < 3 && sellerOverlap < 2) || (!solutions.length && !pains.length && !aiNeeds && fitHits < 5)) {
    markUnknownDimension(fitDimension, "公开资料与我的企业能力之间缺少明确交集，需通过拜访确认可切入场景。");
  }
  if (implementationHits < 3 && effectiveReadableCount < 5) {
    markUnknownDimension(implementationDimension, "缺少系统、数据平台、流程数字化或IT基础线索，这一项暂不参与强判断。");
  }
  if (decisionPositive < 2 && sourceCount < 10 && !legalVerification) {
    markUnknownDimension(decisionRiskDimension, "缺少参会角色、决策链、采购主体或风险边界线索，这一项暂不参与强判断。");
  }

  const dimensions = [budgetDimension, triggerDimension, roiDimension, fitDimension, implementationDimension, decisionRiskDimension].map(markAssessedDimension);
  const unknownCount = dimensions.filter((item) => item.status === "unknown").length;
  if (unknownCount) infoDimension.score = clamp(infoDimension.score - unknownCount * 6);
  const weighted = dimensions.reduce((sum, item) => sum + effectiveDimensionScore(item) * (item.weight / 100), 0);
  let score = clamp(weighted);
  const assessedDimensions = dimensions.filter((item) => item.status !== "unknown");
  const minimumDimension = assessedDimensions.length ? assessedDimensions.reduce((min, item) => (item.score < min.score ? item : min), assessedDimensions[0]) : null;
  const criticalLow = [budgetDimension, triggerDimension, roiDimension, decisionRiskDimension].filter((item) => item.status !== "unknown" && item.score < 50);
  if (minimumDimension?.score < 42) score = Math.min(score, 62);
  else if (minimumDimension?.score < 50) score = Math.min(score, 68);
  else if (minimumDimension?.score < 58) score = Math.min(score, 76);
  if (criticalLow.length) score = Math.min(score, criticalLow.length >= 2 ? 64 : 72);
  if (budgetDimension.status !== "unknown" && budgetDimension.score < 55) score = Math.min(score, 78);
  if (budgetDimension.status !== "unknown" && budgetDimension.score < 48) score = Math.min(score, 70);
  if (finance.profitYi != null && finance.profitYi < 0.1 && budgetHits < 4) score = Math.min(score, 76);
  const bantMeddiccGaps = [
    budgetDimension.status === "unknown" || budgetDimension.score < 68 ? "预算" : "",
    decisionRiskDimension.status === "unknown" || decisionRiskDimension.score < 62 || decisionUnknown > 0 ? "权限/经济买方" : "",
    triggerDimension.status === "unknown" || triggerDimension.score < 68 ? "需求/痛点" : "",
    timingHits < 1 && triggerDimension.score < 78 ? "时机" : "",
    roiDimension.status === "unknown" || roiDimension.score < 64 ? "指标/价值" : "",
    implementationDimension.status !== "unknown" && implementationDimension.score < 58 ? "决策标准/落地条件" : ""
  ].filter(Boolean);
  if (score >= 86 && bantMeddiccGaps.length) score = Math.min(score, 84);
  let grade = gradeOf(score);
  let level = levelOf(grade, infoDimension.score);
  const confidence = confidenceLabel(infoDimension.score);
  const riskFlags = [
    bantMeddiccGaps.length ? `BANT/MEDDICC关键项未闭环：${bantMeddiccGaps.slice(0, 3).join("、")}` : "",
    budgetDimension.score < 62 ? "预算/付款能力待确认" : "",
    roiDimension.score < 62 ? "ROI价值需要量化" : "",
    decisionRiskDimension.score < 62 && decisionUnknown > 0 ? "项目级决策人/预算归属待确认" : "",
    decisionRiskDimension.score < 62 && systemBoundaryRisk >= 2 ? "数据/系统审批边界待确认" : "",
    decisionRiskDimension.score < 62 && decisionUnknown === 0 && systemBoundaryRisk < 2 ? "项目推进边界待确认" : "",
    triggerDimension.score < 62 ? "需求触发不够清晰" : "",
    implementationDimension.score < 62 ? "落地基础需要核验" : "",
    legalVerification?.status === "verified" ? "信用/法律风险已证实" : "",
    legalVerification?.status === "multi_source" ? "信用/法律风险多源支持" : "",
    legalVerification?.status === "conflict" ? "信用/法律信息冲突" : "",
    legalVerification?.status === "unverified" ? "信用/法律风险未证实线索" : ""
  ].filter(Boolean);

  if (legalVerification?.status === "verified" || legalVerification?.status === "multi_source") {
    score = Math.min(score, 62);
    grade = gradeOf(score);
    level = "轻量验证";
  } else if (legalVerification?.status === "conflict") {
    score = Math.min(score, 58);
    grade = gradeOf(score);
    level = "待确认跟进";
  }

  return {
    status: "rated",
    version: OPPORTUNITY_RATING_VERSION,
    label: level,
    grade,
    score,
    priorityLevel: level,
    salesPriority: level,
    confidenceScore: infoDimension.score,
    confidenceLabel: confidence,
    summary: summaryOf(level, confidence, riskFlags),
    nextAction: nextActionOf(level, infoDimension.score),
    presalesAdvice: presalesAdviceOf(level, infoDimension.score),
    qualificationConditions: qualificationConditions(dimensions),
    disqualificationSignals: disqualificationSignals(dimensions),
    resourceBoundary: "初访前投入以客户画像、问题清单、标准案例和轻量场景验证为上限；定制方案、投入边界和POC范围必须等关键输入锁定后再进入。",
    modelBasis: MODEL_BASIS,
    scoringMethod: SCORING_METHOD,
    baseWeightedScore: clamp(weighted),
    minimumDimension: minimumDimension
      ? {
          key: minimumDimension.key,
          title: minimumDimension.title,
          score: minimumDimension.score
        }
      : null,
    unknownDimensionCount: unknownCount,
    dimensions,
    riskFlags,
    riskGate: legalRiskGate
  };
}

export function ratingIndex(rating = {}) {
  if (rating.status !== "rated") {
    return {
      status: "not_rated",
      version: rating.version || OPPORTUNITY_RATING_VERSION,
      label: rating.label || "暂不评级",
      notRatedReason: rating.notRatedReason || "当前只适合做资格筛选。"
    };
  }
  return {
    status: "rated",
    version: rating.version || OPPORTUNITY_RATING_VERSION,
    label: rating.label,
    grade: rating.grade,
    score: rating.score,
    priorityLevel: rating.priorityLevel,
    salesPriority: rating.salesPriority || rating.priorityLevel,
    confidenceScore: rating.confidenceScore,
    confidenceLabel: rating.confidenceLabel,
    summary: rating.summary,
    nextAction: rating.nextAction,
    presalesAdvice: rating.presalesAdvice,
    qualificationConditions: rating.qualificationConditions || [],
    disqualificationSignals: rating.disqualificationSignals || [],
    resourceBoundary: rating.resourceBoundary,
    modelBasis: rating.modelBasis,
    scoringMethod: rating.scoringMethod,
    baseWeightedScore: rating.baseWeightedScore,
    minimumDimension: rating.minimumDimension,
    unknownDimensionCount: rating.unknownDimensionCount,
    riskFlags: rating.riskFlags || [],
    riskGate: rating.riskGate || null
  };
}
