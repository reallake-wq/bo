import { callModel, extractJson, DEEPSEEK_PRO_MODEL } from "./ai.mjs";
import { deleteObject, listJson, readJson, writeJson } from "./store.mjs";
import { clip, id, nowIso, normalizeText } from "./util.mjs";

const PROFILE_NAMESPACE = "profiles";
const KNOWN_PROFILE_DRAFTS = [
  {
    match: /智用开物/,
    profile: {
      companyName: "智用开物",
      mainBusiness: "面向制造业和政企客户提供 AI 智能体、企业知识库、数据问答和智能排产等 Agentic AI 解决方案。",
      coreProducts: ["AI 智能体平台", "企业知识库与数据问答", "智能排产与生产协同", "质量追溯与工艺知识助手"],
      keywords: ["AI智能体", "Agentic AI", "知识库", "数据问答", "智能排产", "质量追溯", "工艺知识", "制造业数字化"]
    }
  }
];

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "")
    .split(/[、,，;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstText(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function registrationBase(candidate = {}) {
  const registration = candidate.tianyanchaRegistration || candidate.tianyanchaSource?.rawData || {};
  const base = registration._base || registration.base || registration.data?.base || {};
  return { ...registration, ...base };
}

function candidateContext(candidate = null) {
  if (!candidate) return {};
  const base = registrationBase(candidate);
  const fields = {
    standardName: candidate.standardName || candidate.name || "",
    verification: candidate.scoreBreakdown?.tianyanchaApi ? "天眼查工商登记核验" : candidate.reason || "",
    creditCode: firstText(base.creditCode, base.creditNo, base.taxNumber),
    status: firstText(base.regStatus, base.status),
    legalPerson: firstText(base.legalPersonName, base.legalPerson),
    registeredCapital: firstText(base.regCapital, base.registeredCapital),
    establishedAt: firstText(base.estiblishTime, base.establishTime, base.fromTime),
    industry: firstText(base.industry, base.industryAll?.categoryMiddle, base.industryAll?.categoryBig, candidate.industry),
    website: firstText(base.websiteList, candidate.website),
    businessScope: firstText(base.businessScope, base.scope),
    address: firstText(base.regLocation, base.regLocationHalfWidth),
    sourceReason: candidate.reason || ""
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => String(value || "").trim()));
}

export function normalizeProfile(input = {}) {
  const now = nowIso();
  const profileId = input.profileId || id("profile", input.companyName || input.name || "");
  const companyName = String(input.companyName || input.name || "").trim();
  const coreProducts = normalizeList(input.coreProducts?.length ? input.coreProducts : input.coreOfferings);
  const mainBusiness = firstText(input.mainBusiness, input.summary);
  const summary = firstText(input.summary, mainBusiness, [companyName, ...coreProducts].filter(Boolean).join("："));
  return {
    profileId,
    companyName,
    mainBusiness,
    coreProducts,
    summary,
    coreOfferings: coreProducts,
    targetCustomers: normalizeList(input.targetCustomers),
    typicalScenarios: normalizeList(input.typicalScenarios),
    strengths: normalizeList(input.strengths),
    deliveryBoundaries: normalizeList(input.deliveryBoundaries),
    noCommitments: normalizeList(input.noCommitments),
    keywords: normalizeList(input.keywords),
    sourceCandidate: input.sourceCandidate || null,
    sourceUrls: normalizeList(input.sourceUrls || input.sourceCandidate?.sourceUrls),
    createdAt: input.createdAt || now,
    updatedAt: now
  };
}

export function profileSnapshot(profile = {}) {
  const normalized = normalizeProfile(profile);
  return {
    profileId: normalized.profileId,
    companyName: normalized.companyName,
    mainBusiness: normalized.mainBusiness,
    coreProducts: normalized.coreProducts,
    summary: normalized.summary,
    coreOfferings: normalized.coreOfferings,
    keywords: normalized.keywords,
    sourceCandidate: normalized.sourceCandidate || null
  };
}

function fallbackProfile(companyName) {
  return normalizeProfile({
    companyName,
    mainBusiness: "",
    coreProducts: [],
    keywords: [companyName]
  });
}

function knownProfile(companyName) {
  const found = KNOWN_PROFILE_DRAFTS.find((item) => item.match.test(companyName));
  return found ? normalizeProfile({ ...found.profile, companyName }) : null;
}

async function draftWithModel(companyName, candidate = null) {
  const context = candidateContext(candidate);
  const messages = [
    {
      role: "system",
      content:
        "你是资深商业研究员和售前产品经理。请根据企业名称和已核验的工商登记信息，生成“我的企业”极简初稿，只返回严格 JSON。companyName 必须使用已核验主体名称。只允许填写主营业务、核心产品/服务、关键词；不要生成目标客户、典型场景、优势、交付约束、案例或具体客户。优先依据经营范围、行业、官网和企业名称保守归纳，无法确认时宁可留得宽一些，不要编造。"
    },
    {
      role: "user",
      content: `企业名称：${companyName}
已核验信息：
${clip(JSON.stringify(context, null, 2), 2800)}
返回 JSON：
{
  "companyName": "${context.standardName || companyName}",
  "mainBusiness": "主营业务，一句话；如果不确定，写成保守描述",
  "coreProducts": ["核心产品或服务"],
  "keywords": ["关键词"]
}`
    }
  ];
  const answer = await callModel(messages, {
    model: DEEPSEEK_PRO_MODEL,
    temperature: 0.12,
    maxTokens: 2200,
    timeoutMs: 90000,
    totalTimeoutMs: 120000,
    headerTimeoutMs: 30000,
    firstTokenTimeoutMs: 60000,
    streamMaxMs: 90000
  });
  return {
    ...extractJson(answer.content),
    modelName: answer.model,
    modelChannel: answer.channel
  };
}

export async function listProfiles() {
  const rows = await listJson(PROFILE_NAMESPACE);
  return rows
    .map((row) => normalizeProfile(row.value))
    .filter((profile) => profile.profileId && profile.companyName)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getProfile(profileId) {
  if (!profileId) return null;
  const profile = await readJson(PROFILE_NAMESPACE, `${profileId}.json`, null);
  return profile ? normalizeProfile(profile) : null;
}

export async function createProfile(companyName, candidate = null) {
  const name = String(candidate?.standardName || candidate?.name || companyName || "").trim();
  if (!name) throw new Error("请输入我方企业名称");
  const sameProfiles = (await listProfiles()).filter((profile) => normalizeText(profile.companyName) === normalizeText(name));
  let draft;
  try {
    draft = knownProfile(name) || (await draftWithModel(name, candidate));
  } catch (error) {
    draft = {
      ...fallbackProfile(name),
      draftWarning: `模型识别暂时失败，已生成可编辑的我的企业空白稿：${error.message}`
    };
  }
  const profile = normalizeProfile({
    profileId: sameProfiles[0]?.profileId,
    createdAt: sameProfiles[0]?.createdAt,
    companyName: name,
    mainBusiness: draft.mainBusiness,
    summary: draft.summary || draft.mainBusiness,
    coreProducts: draft.coreProducts || draft.coreOfferings,
    coreOfferings: draft.coreProducts || draft.coreOfferings,
    keywords: draft.keywords,
    sourceCandidate: candidate
      ? {
          name: candidate.name || name,
          standardName: candidate.standardName || name,
          region: candidate.region || "",
          industry: candidate.industry || "",
          confidence: candidate.confidence || "",
          reason: candidate.reason || "",
          sourceUrls: arr(candidate.sourceUrls).slice(0, 8),
          tianyanchaRegistration: candidate.tianyanchaRegistration || null,
          scoreBreakdown: candidate.scoreBreakdown || null
        }
      : null,
    sourceUrls: arr(candidate?.sourceUrls).slice(0, 8)
  });
  for (const duplicate of sameProfiles.slice(1)) {
    await deleteObject(PROFILE_NAMESPACE, `${duplicate.profileId}.json`);
  }
  await writeJson(PROFILE_NAMESPACE, `${profile.profileId}.json`, profile);
  return profile;
}

export async function saveProfile(input) {
  const existing = input.profileId ? await getProfile(input.profileId) : null;
  const profile = normalizeProfile({
    ...(existing || {}),
    ...input,
    createdAt: existing?.createdAt || input.createdAt
  });
  if (!profile.companyName) throw new Error("我方企业名称不能为空");
  await writeJson(PROFILE_NAMESPACE, `${profile.profileId}.json`, profile);
  return profile;
}

export async function removeProfile(profileId) {
  if (!profileId) throw new Error("缺少我的企业ID");
  await deleteObject(PROFILE_NAMESPACE, `${profileId}.json`);
  return { profileId };
}

export function profileMatches(profile = {}, keyword = "") {
  const q = normalizeText(keyword);
  if (!q) return true;
  const text = normalizeText(
    [
      profile.companyName,
      profile.mainBusiness,
      profile.summary,
      ...arr(profile.coreProducts || profile.coreOfferings),
      ...arr(profile.targetCustomers),
      ...arr(profile.typicalScenarios),
      ...arr(profile.keywords)
    ].join(" ")
  );
  return text.includes(q);
}
