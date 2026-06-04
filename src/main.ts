// @ts-nocheck
import "./styles.css";
import {
  BadgeCheck,
  BadgePlus,
  Ban,
  BatteryMedium,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock3,
  Copy,
  Download,
  FileText,
  Gauge,
  KeyRound,
  Layers3,
  Link,
  ListChecks,
  LoaderCircle,
  LogIn,
  LogOut,
  MessageSquarePlus,
  MonitorSmartphone,
  Network,
  OctagonX,
  PanelTop,
  Paperclip,
  PauseCircle,
  PlayCircle,
  PlugZap,
  Plus,
  PlusCircle,
  Presentation,
  RefreshCw,
  Search,
  SearchCheck,
  ServerCog,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Timer,
  Trash2,
  TriangleAlert,
  UsersRound,
  X,
  createIcons
} from "lucide";

const app = document.querySelector<HTMLDivElement>("#app")!;
const LS_STARTED = "nbBoV2Started";
const LS_TAB = "nbBoV2Tab";
const LS_PROFILE = "nbBoSelectedProfileId";
const LS_JOBS = "nbBoActiveJobIds";
const LS_DISMISSED = "nbBoDismissedJobIds";
const LS_JOB_SNAPSHOTS = "nbBoJobSnapshots";
const LS_OAC_ACCESS = "oacAccessToken";
const LS_OAC_REFRESH = "oacRefreshToken";
const LS_OAC_ME = "oacMe";
const LS_OAC_DEVICE = "oacDeviceId";
const PAGE_SIZE = 12;
const PRODUCT_NAME_CN = "商机参谋团";
const PRODUCT_NAME_EN = "Opportunity Advisory Crew";
const PRODUCT_ACRONYM = "OAC";
const RECENT_TASK_DAYS = 7;
const APP_VERSION = "2.4.1";
const APP_UPDATED_AT = "2026-06-04";
const APP_RELEASE_TITLE = "任务进度可视化与动态证据修复";
const APP_RELEASE_NOTES = [
  "任务中心默认展示运行中和异常任务，已完成任务改到“已完成”标签页查看。",
  "任务卡增加阶段进度条、当前阶段、耗时和失败处理建议，让用户知道跑到哪一步和下一步怎么做。",
  "招投标/中标线索改为证据评分，区分甲方采购记录和客户自身售前交付压力。",
  "修复旧模板自我引用问题，避免存量报告把上一版结论当成新证据继续展示。",
  "方案分析和行动指南只在证据能支撑时展示投标、标书、资质材料等相关判断。"
];
const APP_RELEASE_HISTORY = [
  {
    version: APP_VERSION,
    date: APP_UPDATED_AT,
    title: APP_RELEASE_TITLE,
    notes: APP_RELEASE_NOTES
  },
  {
    version: "2.4.0",
    date: "2026-06-04",
    title: "报告证据链与动态判断修复",
    notes: [
      "强化报告结论必须由客户证据和我的企业能力共同支撑，减少固定模板带来的错配。",
      "修复招投标、标书、供应链、平台能力等线索被机械带入方案的问题。",
      "优化任务完成态和异常态，避免已完成任务继续显示旧错误。"
    ]
  },
  {
    version: "2.3.0",
    date: "2026-06-02",
    title: "生产存储与天眼查链路稳定性",
    notes: [
      "调整线上 Blob 存储和备用环境变量，提升报告、任务和租户数据读取稳定性。",
      "增加天眼查代理密钥配置，降低企业查询链路受网络环境影响的概率。"
    ]
  },
  {
    version: "2.2.0",
    date: "2026-06-01",
    title: "租户 License 与报告质量升级",
    notes: [
      "上线租户隔离、License 管理、我的企业和报告质量规则。",
      "报告页按企业画像、商务分析、方案分析、交付分析和行动指南组织。",
      "加强销售、售前、交付三类视角的证据和结论约束。"
    ]
  }
];
const WORKERS: Record<string, any> = {
  resolve: { name: "澄镜", role: "客户核对参谋", verb: "正在核对企业主体" },
  cache: { name: "归档", role: "报告管理参谋", verb: "正在检查历史报告" },
  plan: { name: "远眺", role: "检索规划参谋", verb: "正在规划检索路径" },
  finance: { name: "账衡", role: "财务研究参谋", verb: "正在采集财务线索" },
  search: { name: "猎源", role: "公开情报参谋", verb: "正在扩展公开来源" },
  read: { name: "阅川", role: "资料阅读参谋", verb: "正在读取网页内容" },
  quality: { name: "砺石", role: "证据核验参谋", verb: "正在核验证据质量" },
  analysis: { name: "织策", role: "方案策略参谋", verb: "正在形成商机判断" },
  report: { name: "成章", role: "简报撰写参谋", verb: "正在生成作战简报" }
};

const appIconSet = {
  BadgeCheck,
  BadgePlus,
  Ban,
  BatteryMedium,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock3,
  Copy,
  Download,
  FileText,
  Gauge,
  KeyRound,
  Layers3,
  Link,
  ListChecks,
  LoaderCircle,
  LogIn,
  LogOut,
  MessageSquarePlus,
  MonitorSmartphone,
  Network,
  OctagonX,
  PanelTop,
  Paperclip,
  PauseCircle,
  PlayCircle,
  PlugZap,
  Plus,
  PlusCircle,
  Presentation,
  RefreshCw,
  Search,
  SearchCheck,
  ServerCog,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Timer,
  Trash2,
  TriangleAlert,
  UsersRound,
  X
};

let profiles: any[] = [];
let selectedProfileId = localStorage.getItem(LS_PROFILE) || "";
let activeJobs: Record<string, any> = {};
let reportRows: any[] = [];
let candidateCompany: any = null;
let candidateAiNeeds = "";
let annualReportSummary: any = null;
let profileCandidates: any[] = [];
let profileStatus = "";
let pollTimer: number | undefined;
let pollingJobs = false;
let pollAgainAfterCurrent = false;
let taskSyncWarning = "";
let taskCenterView = "running";
let reportHtml = "";
let authMe: any = null;
let authError = "";

function icon(name: string) {
  return `<i data-lucide="${escapeHtml(name)}" aria-hidden="true"></i>`;
}

function refreshIcons() {
  createIcons({ icons: appIconSet });
}

function escapeHtml(value: any) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function arr(value: any) {
  return Array.isArray(value) ? value : [];
}

function normalizeKey(value: any) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（）()【】\[\]《》“”"']/g, "")
    .replace(/(股份有限公司|有限责任公司|集团有限公司|有限公司|公司)$/g, "");
}

function dedupeCompanyCandidates(candidates: any[]) {
  const seen = new Map<string, any>();
  for (const candidate of arr(candidates)) {
    const name = candidate?.standardName || candidate?.name || "";
    const key = `${normalizeKey(name)}|${normalizeKey(candidate?.region)}|${normalizeKey(candidate?.industry)}`;
    if (!key.trim() || seen.has(key)) {
      const existing = seen.get(key);
      if (existing) {
        existing.sourceUrls = Array.from(new Set([...arr(existing.sourceUrls), ...arr(candidate.sourceUrls)]));
        existing.sourcesMerged = Math.max(Number(existing.sourcesMerged || 1), arr(existing.sourceUrls).length || 1);
        existing.confidence = Math.max(Number(existing.confidence || 0), Number(candidate.confidence || 0));
      }
      continue;
    }
    seen.set(key, {
      ...candidate,
      sourcesMerged: Math.max(1, arr(candidate.sourceUrls).length || 1)
    });
  }
  return Array.from(seen.values()).sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
}

function parseList(value: string) {
  return String(value || "")
    .split(/[、,，;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinList(value: any) {
  return arr(value).join("\n");
}

function firstValue(...values: any[]) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function tycBase(candidate: any) {
  const registration = candidate?.tianyanchaRegistration || candidate?.tianyanchaSource?.rawData || {};
  const base = registration?._base || registration?.base || registration?.data?.base || {};
  return { ...registration, ...base };
}

function candidateVerification(candidate: any) {
  const base = tycBase(candidate);
  const verified = Boolean(candidate?.scoreBreakdown?.tianyanchaApi || candidate?.tianyanchaSource || base?.creditCode || base?.name);
  const fields = [
    ["登记状态", firstValue(base.regStatus, base.status)],
    ["法定代表人", firstValue(base.legalPersonName, base.legalPerson, base.legalPersonNameAlias)],
    ["注册资本", firstValue(base.regCapital, base.registeredCapital)],
    ["成立时间", firstValue(base.estiblishTime, base.establishTime, base.fromTime)],
    ["所属行业", firstValue(base.industry, base.industryAll?.categoryMiddle, base.industryAll?.categoryBig)],
    ["人员规模", firstValue(base.staffNumRange, base.socialStaffNum ? `${base.socialStaffNum}人` : "")],
    ["官网", firstValue(base.websiteList, candidate.website)]
  ].filter(([, value]) => value);
  return {
    verified,
    creditCode: firstValue(base.creditCode, base.creditNo, base.taxNumber),
    address: firstValue(base.regLocation, base.regLocationHalfWidth),
    fields: fields.slice(0, 6)
  };
}

function tianyanchaDiagnosticNotice(diagnostic: any) {
  if (!diagnostic || String(diagnostic.status || "").startsWith("verified")) return "";
  const copy: Record<string, string> = {
    missing_key: "天眼查核验暂未启用，当前候选来自公开网页搜索。",
    api_failed: "天眼查核验暂时不可用，当前候选来自公开网页搜索。",
    empty: "天眼查未返回可用登记信息，当前候选来自公开网页搜索。",
    mismatch: "天眼查返回主体与输入名称不一致，当前候选来自公开网页搜索。"
  };
  return copy[diagnostic.status] || "天眼查核验未完成，当前候选来自公开网页搜索。";
}

function fmtTime(value: any) {
  if (!value) return "-";
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? "-" : time.toLocaleString("zh-CN");
}

function fmtDuration(ms: any) {
  const value = Number(ms || 0);
  if (!Number.isFinite(value) || value <= 0) return "-";
  const sec = Math.round(value / 1000);
  const min = Math.floor(sec / 60);
  const rest = sec % 60;
  if (min >= 60) {
    const hour = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${hour}小时${m}分钟` : `${hour}小时`;
  }
  return min ? `${min}分${rest}秒` : `${rest}秒`;
}

function modePrefix() {
  const first = (window.location.pathname.split("/").filter(Boolean)[0] || "").toLowerCase();
  if (first === "cn" || first === "china") return "china";
  if (first === "intl" || first === "international") return "international";
  return "";
}

function withMode(url: string) {
  const mode = modePrefix();
  if (!mode) return url;
  return `${url}${url.includes("?") ? "&" : "?"}mode=${mode}`;
}

async function api(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem(LS_OAC_ACCESS) || sessionStorage.getItem(LS_OAC_ACCESS) || "";
  const headers: Record<string, string> = options.body instanceof FormData ? { ...((options.headers as any) || {}) } : { "content-type": "application/json", ...((options.headers as any) || {}) };
  if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(withMode(url), {
    ...options,
    headers
  });
  const raw = await res.text();
  let payload: any = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    const preview = raw.replace(/\s+/g, " ").slice(0, 160);
    throw new Error(`服务返回了非 JSON 响应，通常是后台函数超时、路由异常或部署错误。响应片段：${preview}`);
  }
  if (!res.ok || payload.ok === false) throw new Error(payload.error || `请求失败：${res.status}`);
  return payload;
}

function saveAuth(payload: any, persist = true) {
  const storage = persist ? localStorage : sessionStorage;
  if (payload.accessToken) storage.setItem(LS_OAC_ACCESS, payload.accessToken);
  if (payload.refreshToken) storage.setItem(LS_OAC_REFRESH, payload.refreshToken);
  if (payload.me) {
    authMe = payload.me;
    localStorage.setItem(LS_OAC_ME, JSON.stringify(payload.me));
  }
}

function clearAuth() {
  authMe = null;
  for (const store of [localStorage, sessionStorage]) {
    store.removeItem(LS_OAC_ACCESS);
    store.removeItem(LS_OAC_REFRESH);
  }
  localStorage.removeItem(LS_OAC_ME);
}

function authToken() {
  return localStorage.getItem(LS_OAC_ACCESS) || sessionStorage.getItem(LS_OAC_ACCESS) || "";
}

function refreshToken() {
  return localStorage.getItem(LS_OAC_REFRESH) || sessionStorage.getItem(LS_OAC_REFRESH) || "";
}

async function refreshAuthFromStored() {
  const token = refreshToken();
  if (!token) return false;
  const persist = Boolean(localStorage.getItem(LS_OAC_REFRESH));
  try {
    const payload = await api("/.netlify/functions/auth-refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken: token })
    });
    saveAuth(payload, persist);
    return true;
  } catch {
    clearAuth();
    return false;
  }
}

function oacDeviceId() {
  let deviceId = localStorage.getItem(LS_OAC_DEVICE) || "";
  if (!deviceId) {
    const random = globalThis.crypto?.getRandomValues ? Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), (n) => n.toString(16).padStart(2, "0")).join("") : `${Date.now()}${Math.random()}`;
    deviceId = `dev_${random}`;
    localStorage.setItem(LS_OAC_DEVICE, deviceId);
  }
  return deviceId;
}

function oacDeviceName() {
  const platform = navigator.platform || "Browser";
  const touch = navigator.maxTouchPoints ? "移动设备" : "电脑";
  return `${touch}｜${platform}`;
}

async function loadAuth() {
  const params = new URLSearchParams(window.location.search);
  const sso = params.get("sso");
  if (sso) {
    const payload = await api("/.netlify/functions/auth-sso-exchange", {
      method: "POST",
      body: JSON.stringify({ code: sso })
    });
    saveAuth(payload, false);
    params.delete("sso");
    window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    return true;
  }
  if (!authToken()) {
    if (await refreshAuthFromStored()) return true;
    try {
      authMe = JSON.parse(localStorage.getItem(LS_OAC_ME) || "null");
    } catch {
      authMe = null;
    }
    return false;
  }
  try {
    const payload = await api("/.netlify/functions/auth-me");
    authMe = payload.me;
    localStorage.setItem(LS_OAC_ME, JSON.stringify(authMe));
    return true;
  } catch (error) {
    if (await refreshAuthFromStored()) return true;
    throw error;
  }
}

function licenseStatusText() {
  const license = authMe?.license || {};
  const remain = Number(license.remainingUses ?? 0);
  const remaining = remain < 0 ? "不限次数" : `剩余 ${remain} 次`;
  return `${authMe?.tenantName || "未授权"}｜${remaining}`;
}

function licenseQuotaDetails() {
  const license = authMe?.license || {};
  const quotaTotal = Number(license.quotaTotal ?? 0);
  const quotaUsed = Number(license.quotaUsed ?? 0);
  const remainingUses = Number(license.remainingUses ?? 0);
  const maxDevices = Number(license.maxDevices ?? 3);
  const devices = arr(license.activatedUsers);
  return {
    tenantName: authMe?.tenantName || license.tenantName || "当前授权",
    status: String(license.status || "active"),
    totalText: quotaTotal < 0 ? "不限次数" : `${quotaTotal} 次`,
    usedText: `${quotaUsed} 次`,
    remainingText: remainingUses < 0 ? "不限次数" : `${remainingUses} 次`,
    deviceText: `${devices.length}/${maxDevices < 0 ? "不限" : maxDevices}`,
    expiresText: license.expiresAt ? String(license.expiresAt) : "未设置到期时间",
    licenseId: String(license.licenseId || "")
  };
}

function licenseUsagePanelHtml() {
  const detail = licenseQuotaDetails();
  const statusMap: Record<string, string> = {
    active: "正常",
    paused: "已暂停",
    revoked: "已吊销",
    expired: "已过期"
  };
  return `
    <div class="license-usage-head">
      <div>
        <b>我的授权</b>
        <span>${escapeHtml(detail.tenantName)}</span>
      </div>
      <button id="closeLicensePanel" class="icon-only" type="button" aria-label="关闭">${icon("X")}</button>
    </div>
    <div class="license-usage-grid">
      <article><small>剩余次数</small><strong>${escapeHtml(detail.remainingText)}</strong></article>
      <article><small>已用 / 总量</small><strong>${escapeHtml(detail.usedText)} / ${escapeHtml(detail.totalText)}</strong></article>
      <article><small>设备绑定</small><strong>${escapeHtml(detail.deviceText)}</strong></article>
      <article><small>授权状态</small><strong>${escapeHtml(statusMap[detail.status] || detail.status)}</strong></article>
    </div>
    <p class="license-usage-note">到期：${escapeHtml(detail.expiresText)}。生成首轮报告或新增一轮拜访分析成功后，会扣减 1 次；查看历史报告不扣次数。</p>
    <button id="refreshLicensePanel" type="button">${icon("RefreshCw")}刷新授权状态</button>`;
}

async function refreshAuthMeQuiet() {
  try {
    const payload = await api("/.netlify/functions/auth-me");
    authMe = payload.me;
    localStorage.setItem(LS_OAC_ME, JSON.stringify(authMe));
    return true;
  } catch {
    return false;
  }
}

async function openLicenseUsagePanel() {
  await refreshAuthMeQuiet();
  const panel = document.querySelector<HTMLElement>("#licenseUsagePanel");
  const stripText = document.querySelector<HTMLElement>("#licenseStripText");
  if (stripText) stripText.innerHTML = `${icon("ShieldCheck")}${escapeHtml(licenseStatusText())}`;
  if (!panel) return;
  panel.innerHTML = licenseUsagePanelHtml();
  panel.hidden = false;
  panel.querySelector("#closeLicensePanel")?.addEventListener("click", () => {
    panel.hidden = true;
  });
  panel.querySelector("#refreshLicensePanel")?.addEventListener("click", openLicenseUsagePanel);
  refreshIcons();
}

function activeJobIds() {
  let ids: string[] = [];
  try {
    ids = JSON.parse(localStorage.getItem(LS_JOBS) || "[]");
  } catch {
    ids = [];
  }
  const blocked = dismissedJobIdSet();
  return Array.from(new Set(ids.filter(Boolean))).filter((id) => !blocked.has(id));
}

function dismissedJobIdSet() {
  let dismissed: string[] = [];
  try {
    dismissed = JSON.parse(localStorage.getItem(LS_DISMISSED) || "[]");
  } catch {
    dismissed = [];
  }
  return new Set(dismissed);
}

function saveActiveJobIds(ids: string[]) {
  localStorage.setItem(LS_JOBS, JSON.stringify(Array.from(new Set(ids.filter(Boolean))).slice(0, 50)));
}

function rememberJob(jobId: string) {
  saveActiveJobIds([jobId, ...activeJobIds()]);
}

function jobSnapshots() {
  try {
    return JSON.parse(localStorage.getItem(LS_JOB_SNAPSHOTS) || "{}") || {};
  } catch {
    return {};
  }
}

function loadJobSnapshot(jobId: string) {
  return jobSnapshots()[jobId] || null;
}

function compactProfileSnapshot(profile: any = null) {
  if (!profile) return null;
  return {
    profileId: profile.profileId || "",
    companyName: profile.companyName || "",
    mainBusiness: profile.mainBusiness || profile.summary || "",
    coreProducts: arr(profile.coreProducts || profile.coreOfferings).slice(0, 8)
  };
}

function compactCompanySnapshot(company: any = null) {
  if (!company) return null;
  return {
    name: company.name || "",
    standardName: company.standardName || "",
    companyName: company.companyName || "",
    query: company.query || "",
    region: company.region || "",
    industry: company.industry || "",
    stockCode: company.stockCode || "",
    sellerProfileId: company.sellerProfileId || "",
    sellerProfileName: company.sellerProfileName || "",
    sellerProfileSnapshot: compactProfileSnapshot(company.sellerProfileSnapshot)
  };
}

function compactJobIdentity(identity: any = null) {
  if (!identity) return null;
  return {
    jobId: identity.jobId || "",
    targetCompanyName: identity.targetCompanyName || "",
    standardName: identity.standardName || "",
    companyName: identity.companyName || "",
    sellerProfileId: identity.sellerProfileId || "",
    sellerProfileName: identity.sellerProfileName || "",
    sellerProfileSnapshot: compactProfileSnapshot(identity.sellerProfileSnapshot),
    region: identity.region || "",
    industry: identity.industry || ""
  };
}

function saveJobSnapshot(jobId: string, job: any) {
  if (!jobId || !job) return;
  const snapshots = jobSnapshots();
  snapshots[jobId] = {
    ...(snapshots[jobId] || {}),
    jobId,
    jobIdentity: compactJobIdentity(job.jobIdentity || snapshots[jobId]?.jobIdentity),
    company: compactCompanySnapshot(job.company || snapshots[jobId]?.company),
    targetCompanyName: job.targetCompanyName || snapshots[jobId]?.targetCompanyName || "",
    standardName: job.standardName || snapshots[jobId]?.standardName || "",
    companyName: job.companyName || snapshots[jobId]?.companyName || "",
    sellerProfileId: job.sellerProfileId || snapshots[jobId]?.sellerProfileId || "",
    sellerProfileName: job.sellerProfileName || snapshots[jobId]?.sellerProfileName || "",
    sellerProfileSnapshot: compactProfileSnapshot(job.sellerProfileSnapshot || snapshots[jobId]?.sellerProfileSnapshot),
    reportId: job.reportId || snapshots[jobId]?.reportId || "",
    status: job.status || snapshots[jobId]?.status || "",
    stage: job.stage || snapshots[jobId]?.stage || "",
    detail: job.detail || snapshots[jobId]?.detail || "",
    progress: job.progress ?? snapshots[jobId]?.progress ?? 0,
    phaseKey: job.phaseKey || snapshots[jobId]?.phaseKey || "",
    currentPhaseKey: job.currentPhaseKey || snapshots[jobId]?.currentPhaseKey || "",
    currentPhaseLabel: job.currentPhaseLabel || snapshots[jobId]?.currentPhaseLabel || "",
    phaseTree: Array.isArray(job.phaseTree) ? job.phaseTree : snapshots[jobId]?.phaseTree || [],
    updatedAt: job.updatedAt || snapshots[jobId]?.updatedAt || ""
  };
  try {
    localStorage.setItem(LS_JOB_SNAPSHOTS, JSON.stringify(snapshots));
  } catch {
    localStorage.setItem(LS_JOB_SNAPSHOTS, JSON.stringify({ [jobId]: snapshots[jobId] }));
  }
}

function firstText(...values: any[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function mergeJobSnapshot(previous: any = {}, incoming: any = {}, jobId = "") {
  previous = previous || {};
  incoming = incoming || {};
  const savedIdentity = incoming.jobIdentity || previous.jobIdentity || {};
  const company = { ...(previous.company || {}), ...(incoming.company || {}) };
  const report = { ...(previous.report || {}), ...(incoming.report || {}) };
  const sellerSnapshot = incoming.sellerProfileSnapshot || previous.sellerProfileSnapshot || savedIdentity.sellerProfileSnapshot || company.sellerProfileSnapshot || report.sellerProfileSnapshot || null;
  const targetCompanyName = firstText(
    savedIdentity.targetCompanyName,
    report.targetCompanyName,
    report.standardName,
    incoming.targetCompanyName,
    incoming.standardName,
    incoming.companyName,
    company.standardName,
    company.name,
    company.companyName,
    company.query,
    previous.targetCompanyName,
    previous.standardName,
    previous.companyName
  );
  const sellerProfileName = firstText(
    savedIdentity.sellerProfileName,
    report.sellerProfileName,
    incoming.sellerProfileName,
    sellerSnapshot?.companyName,
    company.sellerProfileName,
    previous.sellerProfileName
  );
  return {
    ...previous,
    ...incoming,
    jobId,
    jobIdentity: incoming.jobIdentity || previous.jobIdentity || {
      jobId,
      targetCompanyName,
      standardName: targetCompanyName,
      companyName: targetCompanyName,
      sellerProfileId: firstText(incoming.sellerProfileId, previous.sellerProfileId, sellerSnapshot?.profileId, company.sellerProfileId),
      sellerProfileName,
      sellerProfileSnapshot: sellerSnapshot
    },
    report,
    company,
    targetCompanyName,
    standardName: firstText(incoming.standardName, previous.standardName, targetCompanyName),
    companyName: firstText(incoming.companyName, previous.companyName, targetCompanyName),
    sellerProfileName,
    sellerProfileId: firstText(incoming.sellerProfileId, previous.sellerProfileId, sellerSnapshot?.profileId, company.sellerProfileId),
    sellerProfileSnapshot: sellerSnapshot
  };
}

async function dismissJob(jobId: string) {
  const dismissed = new Set(JSON.parse(localStorage.getItem(LS_DISMISSED) || "[]"));
  dismissed.add(jobId);
  localStorage.setItem(LS_DISMISSED, JSON.stringify(Array.from(dismissed).slice(0, 100)));
  saveActiveJobIds(activeJobIds().filter((id) => id !== jobId));
  const snapshots = jobSnapshots();
  delete snapshots[jobId];
  localStorage.setItem(LS_JOB_SNAPSHOTS, JSON.stringify(snapshots));
  delete activeJobs[jobId];
  renderTaskCenter();
  try {
    await api("/.netlify/functions/dismiss-report-job", { method: "POST", body: JSON.stringify({ jobId }) });
  } catch {
    // The local clear should still feel immediate. A later successful clear will hide it globally.
  }
}

function forgetMissingJob(jobId: string) {
  saveActiveJobIds(activeJobIds().filter((id) => id !== jobId));
  const snapshots = jobSnapshots();
  delete snapshots[jobId];
  localStorage.setItem(LS_JOB_SNAPSHOTS, JSON.stringify(snapshots));
  delete activeJobs[jobId];
}

function selectedProfile() {
  return profiles.find((profile) => profile.profileId === selectedProfileId) || null;
}

function profileReady(profile: any) {
  return Boolean(profile?.companyName && String(profile.mainBusiness || profile.summary || "").trim() && arr(profile.coreProducts || profile.coreOfferings).length);
}

function profileOptions(includeAll = false) {
  return `${includeAll ? `<option value="all">全部我的企业</option><option value="unbound">未绑定我的企业</option>` : `<option value="">请选择我的企业</option>`}${profiles
    .map((profile) => `<option value="${escapeHtml(profile.profileId)}" ${!includeAll && profile.profileId === selectedProfileId ? "selected" : ""}>${escapeHtml(profile.companyName)}</option>`)
    .join("")}${!includeAll ? `<option value="__new__">+ 新增我的企业</option>` : ""}`;
}

function workerForJob(job: any) {
  const key = job.phaseKey || job.currentPhaseKey || "analysis";
  return WORKERS[key] || WORKERS.analysis;
}

function bottomTabNav(active = "") {
  const tabs = [
    ["home", "Home", "首页"],
    ["create", "PlusCircle", "创建"],
    ["tasks", "Timer", "任务"],
    ["reports", "FileText", "报告"],
    ["profiles", "Building2", "我的企业"]
  ];
  return `<nav class="workbench-tabs" aria-label="主要功能">
    ${tabs
      .map(
        ([tab, iconName, label]) =>
          `<button class="tab-button ${active === tab ? "active" : ""}" data-tab="${tab}" type="button">${icon(iconName)}<span>${label}</span></button>`
      )
      .join("")}
  </nav>`;
}

function landingPage() {
  return `
    <main class="landing-shell">
      <section class="landing-hero">
        <div class="landing-copy">
          <div class="kicker">${icon("UsersRound")} ${PRODUCT_NAME_CN} · ${PRODUCT_ACRONYM}</div>
          <h1>把客户名，变成一份能直接拿去拜访的作战简报。</h1>
          <p>${PRODUCT_NAME_EN} 会按参谋分工完成主体核对、公开资料检索、风险核验、方案判断和行动建议，帮助销售与售前少踩坑、快判断、好推进。</p>
          <div class="hero-actions">
            <button id="startApp" class="primary xl" type="button">${icon("Sparkles")}开始使用</button>
            <button id="openReportsQuick" type="button">${icon("FileText")}查看报告</button>
          </div>
        </div>
        <div class="landing-preview">
          <div class="preview-input">
            <span>输入</span>
            <b>我方：智用开物</b>
            <b>客户：博格华纳宁波</b>
            <small>客户提出：质量追溯、知识库、现场智能体</small>
          </div>
          <div class="preview-output">
            <span>输出</span>
            <div><b>A级｜建议优先推进</b><small>优先切入：质量追溯 + 工艺知识助手</small></div>
            <div><b>证据池</b><small>高置信 / 中置信 / 弱线索分层展示</small></div>
            <div><b>会前动作</b><small>确认参会角色、数据边界、样例和预算窗口</small></div>
          </div>
        </div>
      </section>
      <section class="landing-flow">
        ${[
          ["选我的企业", "告诉参谋团你卖什么、核心产品是什么。"],
          ["查目标客户", "参谋成员分工检索、读取、核验证据。"],
          ["出作战简报", "给出值不值得跟、怎么切、问什么、避开什么。"]
        ].map(([title, body]) => `<article><b>${title}</b><p>${body}</p></article>`).join("")}
      </section>
    </main>`;
}

function homeTabHtml() {
  return `
    <section class="home-tab-shell ios-home">
      <div class="ios-home-hero">
        <div class="hero-brand-row">
          <div class="app-mark"><strong>${PRODUCT_ACRONYM}</strong></div>
          <div>
            <p class="eyebrow">${PRODUCT_NAME_CN}</p>
            <span>${PRODUCT_NAME_EN}</span>
          </div>
        </div>
        <h2>约 30 分钟，拿到一份能指导拜访的商机简报。</h2>
        <p class="hero-sub">先判断值不值得跟，再把客户信息、痛点机会、行动指南、解决方案和现场问题整理成手机可读的作战卡片。</p>
        <div class="ios-home-actions">
          <button id="homeCreateTask" class="primary" type="button">${icon("PlusCircle")}创建任务</button>
          <button id="homeOpenReports" class="ghost" type="button">${icon("FileText")}看报告</button>
        </div>
      </div>

      <div class="ios-preview-card">
        <div class="preview-row input-row">
          <span>输入</span>
          <b>我的企业：智用开物｜目标客户：宁波精华电子科技股份有限公司</b>
        </div>
        <div class="preview-divider"></div>
        <div class="preview-result">
          <div><small>跟进判断</small><strong>A级｜86分</strong></div>
          <div><small>优先切入</small><strong>质量追溯与工艺知识</strong></div>
          <div><small>下一步</small><strong>带问题清单拜访</strong></div>
        </div>
      </div>

      <div class="ios-section-title">
        <b>谁会直接受益</b>
        <span>从“临时查资料”变成“可复制的客户作战能力”。</span>
      </div>
      <div class="ios-value-grid">
        ${[
          ["老板", "看清商机质量", "减少盲目投入，把销售、售前和交付的判断沉淀成团队能力。"],
          ["销售", "知道值不值得跟", "先判断预算、决策链、风险和推进打法，不再靠感觉跑客户。"],
          ["售前", "拿到方案切入点", "围绕客户现状和痛点组织方案，不再只拿标准产品去硬推。"],
          ["交付", "提前看到落地风险", "粗看架构、数据、系统接入和验收口径，避免后期失控。"]
        ].map(([role, title, body]) => `<article><span>${role}</span><b>${title}</b><p>${body}</p></article>`).join("")}
      </div>

      <div class="ios-section-title">
        <b>为什么值得买</b>
        <span>不是多一个生成器，而是把客户拜访前的判断能力产品化。</span>
      </div>
      <div class="ios-roi-grid">
        ${[
          ["少浪费售前", "先筛掉低价值、预算不清或决策链不明的线索，把方案资源用在更可能成交的客户上。"],
          ["提高命中率", "把客户业务、痛点假设、切入话题和必问问题整理成作战卡，第一次见面就不显外行。"],
          ["沉淀团队打法", "每轮拜访反馈都会刷新判断、方案和问题清单，把个人经验变成可复用的组织资产。"]
        ].map(([title, body]) => `<article><b>${title}</b><p>${body}</p></article>`).join("")}
      </div>

      <div class="ios-section-title">
        <b>管理层为什么会买单</b>
        <span>买的不是一份报告，而是销售、售前、交付的判断标准。</span>
      </div>
      <div class="ios-outcome-grid">
        ${[
          ["线索分级", "把“想跟就跟”变成有预算、决策链、痛点和风险依据的优先级判断。"],
          ["投入管控", "让售前资源先投向高价值客户，低确定性机会先做轻量验证。"],
          ["打法复制", "优秀客户经理的会前准备方式沉淀成团队统一作战流程。"],
          ["复盘闭环", "会后纪要会刷新评级、方案和下一步动作，避免拜访信息散落在聊天记录里。"]
        ].map(([title, body]) => `<article><b>${title}</b><p>${body}</p></article>`).join("")}
      </div>

      <div class="ios-section-title">
        <b>参谋分工</b>
        <span>不是一段普通摘要，而是多人协作式的拜访准备。</span>
      </div>
      <div class="ios-worker-list">
        ${[
          ["核", "澄镜", "客户核对参谋", "核对客户主体，避免找错公司"],
          ["搜", "猎源", "公开情报参谋", "扩展公开资料，建立证据池"],
          ["验", "砺石", "证据核验参谋", "核验风险、财务、股权和敏感线索"],
          ["判", "织策", "方案策略参谋", "判断痛点、机会和跟进优先级"],
          ["写", "成章", "简报撰写参谋", "生成手机可读的拜访作战简报"]
        ].map(([avatar, name, role, body]) => `<article><i>${avatar}</i><div><b>${name}<em>${role}</em></b><span>${body}</span></div></article>`).join("")}
      </div>

      <div class="ios-section-title">
        <b>三步开始</b>
        <span>按顺序点，不需要懂 IT。</span>
      </div>
      <div class="ios-step-list">
        ${[
          ["1", "选择我的企业", "告诉系统你卖什么、核心产品是什么。"],
          ["2", "输入目标客户", "只填准确企业名，需要时再补需求或年报。"],
          ["3", "查看作战简报", "拿到结论、方案、问题清单和内部注意事项。"]
        ].map(([no, title, body]) => `<article><i>${no}</i><div><b>${title}</b><span>${body}</span></div>${icon("ChevronRight")}</article>`).join("")}
      </div>
    </section>`;
}

function workbenchPage() {
  return `
    <main class="app-shell">
      ${bottomTabNav()}
      <section id="homeTab" class="tab-pane"></section>
      <section id="createTab" class="tab-pane"></section>
      <section id="tasksTab" class="tab-pane"></section>
      <section id="reportsTab" class="tab-pane"></section>
      <section id="profilesTab" class="tab-pane"></section>
    </main>`;
}

function isAdminRoute() {
  return window.location.pathname.split("/").filter(Boolean)[0]?.toLowerCase() === "admin";
}

function renderLoginOnlyGate(message = authError) {
  renderLoginOnlyGateClean(message);
}

function integrationGuideHtml() {
  return `
    <div class="integration-head">
      <span>${icon("PlugZap")}</span>
      <div>
        <b>OAC 服务能力开放</b>
        <p>企业开通 License 后，可以直接使用 OAC 网页，也可以把“免登录进入、任务生成、进度查询、报告读取”能力接入原有 CRM、数字劳动力平台、OA 或销售工作台。</p>
      </div>
    </div>

    <div class="integration-grid">
      <article>
        <b>${icon("PanelTop")}方式一：嵌入企业平台</b>
        <p>适合企业已有统一入口，希望销售/售前无需再次输入授权码。</p>
        <ol>
          <li>OAC 为企业开通租户 License，并发放企业后端专用 Master API Key。</li>
          <li>企业后端携带 Master API Key 和员工 userId 向 OAC 换取一次性登录 code。</li>
          <li>企业前端使用返回的 url，拼到 OAC 站点域名后，用 iframe 或新页面打开。</li>
        </ol>
        <div class="integration-code">
          <div class="integration-code-head">
            <span>换取一次性登录 code</span>
            <button type="button" data-copy-target="enterpriseSsoRequest" data-copy-label="复制">${icon("Copy")}复制</button>
          </div>
          <pre id="enterpriseSsoRequest">POST /.netlify/functions/auth-enterprise-session
Headers:
  content-type: application/json
  x-oac-master-key: oac_master_xxx
Body:
{
  "tenantId": "企业租户ID，可选",
  "licenseId": "lic_xxx，可选",
  "userId": "zhangsan",
  "userName": "张三"
}</pre>
        </div>
        <div class="integration-code">
          <div class="integration-code-head">
            <span>返回示例</span>
            <button type="button" data-copy-target="enterpriseSsoResponse" data-copy-label="复制">${icon("Copy")}复制</button>
          </div>
          <pre id="enterpriseSsoResponse">{
  "ok": true,
  "code": "oac_sso_xxx",
  "url": "?sso=oac_sso_xxx"
}</pre>
        </div>
        <div class="integration-code">
          <div class="integration-code-head">
            <span>企业前端打开地址</span>
            <button type="button" data-copy-target="enterpriseSsoUrl" data-copy-label="复制">${icon("Copy")}复制</button>
          </div>
          <pre id="enterpriseSsoUrl">https://oac.muyang.chat/?sso=oac_sso_xxx</pre>
        </div>
        <p class="integration-hint">SSO code 有效期 5 分钟且只能使用一次；Master API Key 只允许放在企业后端。</p>
      </article>

      <article>
        <b>${icon("ServerCog")}方式二：后端 API 调用</b>
        <p>适合企业希望把 OAC 当成后台服务，由自己的系统发起任务、查询进度、读取报告。</p>
        <div class="integration-code">
          <div class="integration-code-head">
            <span>创建报告任务</span>
            <button type="button" data-copy-target="enterpriseApiCreateJob" data-copy-label="复制">${icon("Copy")}复制</button>
          </div>
          <pre id="enterpriseApiCreateJob">POST /api/v1/report-jobs
Headers:
  content-type: application/json
  x-oac-license-key: OAC-xxxx-xxxx
  x-oac-user-id: zhangsan
Body:
{
  "profileId": "profile_xxx",
  "company": {
    "name": "目标客户名称",
    "region": "城市或区域，可选",
    "industry": "行业，可选",
    "aiNeeds": "已掌握的客户需求，可选"
  },
  "force": false
}</pre>
        </div>
        <div class="integration-code">
          <div class="integration-code-head">
            <span>查询进度和读取报告</span>
            <button type="button" data-copy-target="enterpriseApiRead" data-copy-label="复制">${icon("Copy")}复制</button>
          </div>
          <pre id="enterpriseApiRead">GET /api/v1/report-jobs/{jobId}
Headers:
  x-oac-license-key: OAC-xxxx-xxxx
  x-oac-user-id: zhangsan

GET /api/v1/reports/{reportId}
Headers:
  x-oac-license-key: OAC-xxxx-xxxx
  x-oac-user-id: zhangsan</pre>
        </div>
      </article>
    </div>

    <div class="integration-notes">
      <b>${icon("ShieldCheck")}安全与隔离</b>
      <span>每个 License 对应独立租户数据；企业只能访问自己租户下的任务、我的企业和报告。</span>
      <span>Master API Key 只放企业后端，不进入浏览器前端。</span>
      <span>任务成功生成报告后才扣次数；失败、取消、只查看报告不扣次数。</span>
    </div>
  `;
}

function wireIntegrationGuide(root: ParentNode = document) {
  root.querySelectorAll("[data-copy-target]").forEach((button) => {
    button.removeEventListener("click", copyIntegrationSnippet);
    button.addEventListener("click", copyIntegrationSnippet);
  });
}

async function copyIntegrationSnippet(event: Event) {
  const button = event.currentTarget as HTMLElement;
  const targetId = button.dataset.copyTarget || "";
  const target = targetId ? document.getElementById(targetId) : null;
  const text = target?.textContent || "";
  if (!text) return;
  const label = button.dataset.copyLabel || "复制";
  try {
    if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(text);
    button.innerHTML = `${icon("Check")}已复制`;
    refreshIcons();
    window.setTimeout(() => {
      button.innerHTML = `${icon("Copy")}${escapeHtml(label)}`;
      refreshIcons();
    }, 1400);
  } catch {
    window.prompt("复制下面内容", text);
  }
}

function renderAdminPage(message = "") {
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-card admin-license-card">
        <div class="app-mark"><strong>${PRODUCT_ACRONYM}</strong></div>
        <p class="eyebrow">License 管理后台</p>
        <h1>授权管理</h1>
        <p>管理员在这里开通、暂停、启用或吊销授权。出于安全原因，已创建的授权码不保存明文；如果客户遗失授权码，请重置并发放新的 License Key。</p>
        ${message ? `<div class="notice error">${escapeHtml(message)}</div>` : ""}
        <div class="auth-form">
          <input id="adminSecretInput" placeholder="请输入管理员密钥" type="password" />
          <div class="admin-actions">
            <button id="loadLicensesButton" type="button">${icon("ListChecks")}查看已开通</button>
            <button id="backToLoginButton" type="button">${icon("LogIn")}返回登录</button>
          </div>
        </div>

        <div class="admin-divider"></div>

        <div class="auth-form">
          <b class="admin-subtitle">开通新 License</b>
          <input id="tenantNameInput" placeholder="租户 / 企业名称" />
          <input id="tenantIdInput" placeholder="租户ID，可选；演示旧数据可填 internal-demo" />
          <input id="quotaTotalInput" type="number" placeholder="留空表示不限次数；也可填 30、100" />
          <input id="expiresAtInput" placeholder="到期日，可选：2026-12-31" />
          <label class="inline-check"><input id="createMasterKeyInput" type="checkbox" /> 同时生成企业对接 Master Key</label>
          <button id="createLicenseButton" type="button">${icon("BadgePlus")}创建授权</button>
          <pre id="createdLicenseOutput"></pre>
          <div id="createdLicenseActions" class="license-share-actions"></div>
          <div id="adminLicenseList" class="license-admin-list"></div>
        </div>
      </section>
    </main>`;
  document.querySelector("#createLicenseButton")?.addEventListener("click", createLicenseFromAdminPageClean);
  document.querySelector("#loadLicensesButton")?.addEventListener("click", () => loadLicensesFromAdminPageClean(true));
  document.querySelector("#backToLoginButton")?.addEventListener("click", () => {
    window.history.pushState({}, "", "/");
    clearAuth();
    renderAuthGate();
  });
  refreshIcons();
}

function renderAuthGate(message = authError) {
  renderLoginOnlyGateClean(message);
}

function renderLoginOnlyGateClean(message = authError) {
  const presetLicense = new URLSearchParams(window.location.search).get("license") || "";
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-card">
        <div class="app-mark"><strong>${PRODUCT_ACRONYM}</strong></div>
        <p class="eyebrow">${PRODUCT_NAME_CN}｜${PRODUCT_NAME_EN}</p>
        <h1>输入授权码</h1>
        <p>请输入已开通的 OAC 授权码。系统会为当前团队保留独立的我的企业、任务和作战简报。</p>
        <form id="licenseLoginForm" class="auth-form">
          <input id="licenseKeyInput" placeholder="例如 OAC-ABCD-2345" autocomplete="one-time-code" value="${escapeHtml(presetLicense)}" />
          <input id="licenseUserInput" placeholder="使用者名称，可选" autocomplete="name" />
          <button class="primary" type="submit">${icon("ShieldCheck")}进入系统</button>
        </form>
        ${message ? `<div class="notice error">${escapeHtml(message)}</div>` : ""}
        <section class="auth-value-strip" aria-label="OAC 价值说明">
          <article>
            <span>${icon("Clock3")}</span>
            <b>会前少熬夜</b>
            <p>把客户、行业、预算、决策链和风险压缩成可行动简报。</p>
          </article>
          <article>
            <span>${icon("Presentation")}</span>
            <b>售前不再只推产品</b>
            <p>从客户现状和痛点出发，生成可交流的方案路径。</p>
          </article>
          <article>
            <span>${icon("ShieldCheck")}</span>
            <b>结论有证据</b>
            <p>天眼查、搜索、年报和网页证据分层，减少拍脑袋。</p>
          </article>
        </section>
        <button id="integrationGuideButton" class="auth-secondary-action" type="button">${icon("Network")}查看企业系统对接方式</button>
        <section id="integrationGuidePanel" class="integration-guide" hidden>
          ${integrationGuideHtml()}
        </section>
      </section>
    </main>`;
  document.querySelector("#licenseLoginForm")?.addEventListener("submit", loginWithLicenseV2);
  wireIntegrationGuide();
  document.querySelector("#integrationGuideButton")?.addEventListener("click", () => {
    const panel = document.querySelector<HTMLElement>("#integrationGuidePanel");
    if (!panel) return;
    panel.hidden = !panel.hidden;
    panel.closest(".auth-card")?.classList.toggle("integration-open", !panel.hidden);
    refreshIcons();
  });
  refreshIcons();
}

function renderLoginOnlyGateV2(message = authError) {
  renderLoginOnlyGateClean(message);
}

async function loginWithLicense(event: Event) {
  event.preventDefault();
  const licenseKey = (document.querySelector<HTMLInputElement>("#licenseKeyInput")?.value || "").trim();
  const userId = (document.querySelector<HTMLInputElement>("#licenseUserInput")?.value || "").trim() || "web-user";
  if (!licenseKey) {
    renderAuthGate("请输入授权码");
    return;
  }
  try {
    const payload = await api("/.netlify/functions/auth-license-login", {
      method: "POST",
      body: JSON.stringify({ licenseKey, userId, deviceId: oacDeviceId(), deviceName: oacDeviceName() })
    });
    saveAuth(payload, true);
    const params = new URLSearchParams(window.location.search);
    if (params.has("license")) {
      params.delete("license");
      window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`);
    }
    authError = "";
    await bootstrap();
  } catch (error: any) {
    authError = error.message || "授权失败";
    renderAuthGate(authError);
  }
}

async function createLicenseFromGate() {
  const adminSecret = (document.querySelector<HTMLInputElement>("#adminSecretInput")?.value || "").trim();
  const tenantName = (document.querySelector<HTMLInputElement>("#tenantNameInput")?.value || "").trim();
  const tenantId = (document.querySelector<HTMLInputElement>("#tenantIdInput")?.value || "").trim();
  const quotaTotal = Number((document.querySelector<HTMLInputElement>("#quotaTotalInput")?.value || "100").trim() || 100);
  const expiresAt = (document.querySelector<HTMLInputElement>("#expiresAtInput")?.value || "").trim();
  const createMasterKey = Boolean((document.querySelector<HTMLInputElement>("#createMasterKeyInput") as any)?.checked);
  const output = document.querySelector("#createdLicenseOutput");
  if (!adminSecret || !tenantName) {
    if (output) output.textContent = "请填写管理员密钥和租户名称。";
    return;
  }
  try {
    const payload = await api("/.netlify/functions/admin-licenses", {
      method: "POST",
      headers: { "x-admin-secret": adminSecret },
      body: JSON.stringify({ tenantName, tenantId, quotaTotal, expiresAt, createMasterKey })
    });
    if (output) {
      output.textContent = [
        `License Key（只显示一次）：${payload.licenseKey}`,
        payload.masterKey ? `Master Key（只显示一次）：${payload.masterKey}` : "",
        `租户：${payload.license?.tenantName}`,
        `次数：${payload.license?.quotaTotal}`
      ].filter(Boolean).join("\n");
    }
  } catch (error: any) {
    if (output) output.textContent = `创建失败：${error.message}`;
  }
}

function renderAuthGateAdmin(message = authError) {
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-card">
        <div class="app-mark"><strong>${PRODUCT_ACRONYM}</strong></div>
        <p class="eyebrow">${PRODUCT_NAME_CN}｜${PRODUCT_NAME_EN}</p>
        <h1>请输入授权码</h1>
        <p>OAC 已启用租户隔离。授权成功后，只能看到当前租户下的我的企业、任务和报告。</p>
        <form id="licenseLoginForm" class="auth-form">
          <input id="licenseKeyInput" placeholder="OAC License Key" autocomplete="off" />
          <input id="licenseUserInput" placeholder="使用者名称，可选" autocomplete="name" />
          <button class="primary" type="submit">${icon("ShieldCheck")}进入系统</button>
        </form>
        ${message ? `<div class="notice error">${escapeHtml(message)}</div>` : ""}
        <details class="admin-box" open>
          <summary>${icon("KeyRound")}管理员开通与管理 License</summary>
          <div class="auth-form">
            <input id="adminSecretInput" placeholder="请输入管理员密钥" type="password" />
            <input id="tenantNameInput" placeholder="租户 / 企业名称" />
            <input id="tenantIdInput" placeholder="租户ID，可选；演示旧数据可填 internal-demo" />
            <input id="quotaTotalInput" type="number" placeholder="留空表示不限次数；也可填 30、100" />
            <input id="expiresAtInput" placeholder="到期日，可选：2026-12-31" />
            <label class="inline-check"><input id="createMasterKeyInput" type="checkbox" /> 同时生成企业对接 Master Key</label>
            <div class="admin-actions">
              <button id="createLicenseButton" type="button">${icon("BadgePlus")}创建授权</button>
              <button id="loadLicensesButton" type="button">${icon("ListChecks")}查看已开通</button>
            </div>
            <pre id="createdLicenseOutput"></pre>
            <div id="adminLicenseList" class="license-admin-list"></div>
          </div>
        </details>
      </section>
    </main>`;
  document.querySelector("#licenseLoginForm")?.addEventListener("submit", loginWithLicenseV2);
  document.querySelector("#createLicenseButton")?.addEventListener("click", createLicenseFromGateV2);
  document.querySelector("#loadLicensesButton")?.addEventListener("click", () => loadLicensesFromGateV2(true));
  refreshIcons();
}

function renderAdminPageV2(message = "") {
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-card admin-license-card">
        <div class="app-mark"><strong>${PRODUCT_ACRONYM}</strong></div>
        <p class="eyebrow">License 管理后台</p>
        <h1>授权管理</h1>
        <p>在这里为客户或演示团队开通授权、查看设备绑定、暂停或吊销 License。授权码明文只显示一次，遗失后请重置。</p>
        ${message ? `<div class="notice error">${escapeHtml(message)}</div>` : ""}
        <div class="auth-form">
          <label class="form-field">
            <span>管理员密钥</span>
            <input id="adminSecretInput" name="oac-admin-secret-${Date.now()}" placeholder="请输入管理员密钥" type="password" autocomplete="new-password" data-lpignore="true" data-1p-ignore="true" spellcheck="false" />
          </label>
          <div class="admin-actions">
            <button id="loadLicensesButton" type="button">${icon("ListChecks")}查看已开通</button>
            <button id="backToLoginButton" type="button">${icon("LogIn")}返回登录</button>
          </div>
        </div>

        <div class="admin-divider"></div>

        <div class="auth-form">
          <b class="admin-subtitle">开通新 License</b>
          <label class="form-field">
            <span>租户 / 企业名称</span>
            <input id="tenantNameInput" placeholder="例如：某某集团华东销售团队" autocomplete="off" />
          </label>
          <label class="form-field">
            <span>可使用次数</span>
            <input id="quotaTotalInput" type="number" placeholder="留空表示不限次数；也可填 30、100" />
            <small>成功生成首轮报告或新增一轮拜访分析才扣 1 次；失败、取消、只查看报告不扣次数。</small>
          </label>
          <label class="form-field">
            <span>最多绑定设备数</span>
            <input id="maxDevicesInput" type="number" value="3" placeholder="例如 3" />
            <small>同一个授权码可绑定几台浏览器设备，适合现场给领导或团队发放。</small>
          </label>
          <label class="form-field">
            <span>到期日，可选</span>
            <input id="expiresAtInput" placeholder="例如：2026-12-31" autocomplete="off" />
          </label>
          <details class="admin-advanced">
            <summary>${icon("Settings2")}高级对接设置</summary>
            <label class="form-field">
              <span>租户ID，可选</span>
              <input id="tenantIdInput" placeholder="一般留空；演示旧数据可填 internal-demo" autocomplete="off" />
            </label>
            <label class="inline-check"><input id="createMasterKeyInput" type="checkbox" /> 同时生成企业后端对接 Master Key</label>
          </details>
          <button id="createLicenseButton" type="button">${icon("BadgePlus")}创建授权</button>
          <pre id="createdLicenseOutput"></pre>
          <div id="adminLicenseList" class="license-admin-list"></div>
        </div>
      </section>
    </main>`;
  document.querySelector("#createLicenseButton")?.addEventListener("click", createLicenseFromAdminPage);
  document.querySelector("#loadLicensesButton")?.addEventListener("click", () => loadLicensesFromAdminPage(true));
  document.querySelector("#backToLoginButton")?.addEventListener("click", () => {
    window.history.pushState({}, "", "/");
    clearAuth();
    renderAuthGate();
  });
  refreshIcons();
}

function renderAdminPageClean(message = "") {
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-card admin-license-card">
        <div class="app-mark"><strong>${PRODUCT_ACRONYM}</strong></div>
        <p class="eyebrow">License 管理后台</p>
        <h1>授权管理</h1>
        <p>这里用于开通、暂停、启用、吊销和查看授权使用情况。管理员密钥只在本次请求中使用，不会保存在页面里。</p>
        ${message ? `<div class="notice error">${escapeHtml(message)}</div>` : ""}
        <div class="auth-form">
          <label class="form-field">
            <span>管理员密钥</span>
            <input data-admin-secret-input class="secret-input" type="password" placeholder="请输入管理员密钥" autocomplete="new-password" autocapitalize="off" data-lpignore="true" data-1p-ignore="true" spellcheck="false" readonly />
            <small>密钥不会在页面中展示，也不会写入浏览器本地存储。</small>
          </label>
          <div class="admin-actions">
            <button id="loadLicensesButton" type="button">${icon("ListChecks")}查看已开通</button>
            <button id="deleteAllLicensesButton" class="danger" type="button">${icon("Trash2")}删除全部 License</button>
            <button id="backToLoginButton" type="button">${icon("LogIn")}返回授权登录</button>
          </div>
        </div>

        <div class="admin-divider"></div>

        <div class="auth-form">
          <b class="admin-subtitle">开通新 License</b>
          <label class="form-field">
            <span>租户 / 企业名称</span>
            <input id="tenantNameInput" placeholder="例如：某某集团华东销售团队" autocomplete="off" />
          </label>
          <label class="inline-check quota-toggle">
            <input id="quotaUnlimitedInput" type="checkbox" checked />
            <span>不限制使用次数</span>
          </label>
          <label class="form-field" id="quotaLimitField" hidden>
            <span>限制次数</span>
            <input id="quotaLimitInput" type="number" min="1" placeholder="例如 30、100" autocomplete="off" />
            <small>成功完成首轮报告或新增一轮拜访分析才扣 1 次；失败、取消、只查看报告不扣次数。</small>
          </label>
          <label class="form-field">
            <span>最多绑定设备数</span>
            <input id="maxDevicesInput" type="number" value="3" min="1" placeholder="例如 3" autocomplete="off" />
            <small>同一个授权码最多可绑定几台浏览器设备，适合现场给团队或领导演示。</small>
          </label>
          <label class="form-field">
            <span>到期日，可选</span>
            <input id="expiresAtInput" placeholder="例如：2026-12-31" autocomplete="off" />
          </label>
          <details class="admin-advanced">
            <summary>${icon("Settings2")}高级对接设置</summary>
            <label class="form-field">
              <span>租户 ID，可选</span>
              <input id="tenantIdInput" placeholder="一般留空；需要指定历史演示租户时再填写" autocomplete="off" />
            </label>
            <label class="inline-check"><input id="createMasterKeyInput" type="checkbox" /> 同时生成企业后端对接 Master Key</label>
          </details>
          <button id="createLicenseButton" type="button">${icon("BadgePlus")}创建授权</button>
          <pre id="createdLicenseOutput"></pre>
          <div id="adminLicenseList" class="license-admin-list"></div>
        </div>
      </section>
    </main>`;
  const secretInput = document.querySelector<HTMLInputElement>("[data-admin-secret-input]");
  if (secretInput) {
    secretInput.value = "";
    const unlockSecretInput = () => secretInput.removeAttribute("readonly");
    ["focus", "pointerdown", "click", "keydown"].forEach((eventName) => {
      secretInput.addEventListener(eventName, unlockSecretInput, { once: true });
    });
    if (document.activeElement === secretInput) unlockSecretInput();
    setTimeout(() => { secretInput.value = ""; }, 60);
  }
  wireAdminQuotaToggle();
  document.querySelector("#createLicenseButton")?.addEventListener("click", createLicenseFromAdminPage);
  document.querySelector("#loadLicensesButton")?.addEventListener("click", () => loadLicensesFromAdminPage(true));
  document.querySelector("#deleteAllLicensesButton")?.addEventListener("click", deleteAllLicensesFromAdminPage);
  document.querySelector("#backToLoginButton")?.addEventListener("click", () => {
    window.history.pushState({}, "", "/");
    clearAuth();
    renderAuthGate();
  });
  refreshIcons();
}

function wireAdminQuotaToggle() {
  const unlimitedInput = document.querySelector<HTMLInputElement>("#quotaUnlimitedInput");
  const limitField = document.querySelector<HTMLElement>("#quotaLimitField");
  const limitInput = document.querySelector<HTMLInputElement>("#quotaLimitInput");
  const sync = () => {
    const unlimited = Boolean(unlimitedInput?.checked);
    if (limitField) {
      limitField.hidden = unlimited;
      limitField.style.display = unlimited ? "none" : "grid";
    }
    if (limitInput) {
      limitInput.disabled = unlimited;
      if (unlimited) limitInput.value = "";
    }
  };
  unlimitedInput?.addEventListener("change", sync);
  sync();
}

function quotaLabelClean(value: any) {
  const total = Number(value);
  return Number.isFinite(total) && total < 0 ? "不限次数" : `${Number.isFinite(total) ? total : 0} 次`;
}

function statusLabelClean(status: any) {
  const value = String(status || "active");
  if (value === "paused") return "已暂停";
  if (value === "revoked") return "已吊销";
  if (value === "expired") return "已过期";
  return "正常";
}

async function createLicenseFromAdminPageClean() {
  const adminSecret = adminSecretValue();
  const tenantName = (document.querySelector<HTMLInputElement>("#tenantNameInput")?.value || "").trim();
  const tenantId = (document.querySelector<HTMLInputElement>("#tenantIdInput")?.value || "").trim();
  const quotaTotal = Number((document.querySelector<HTMLInputElement>("#quotaTotalInput")?.value || "-1").trim() || -1);
  const maxDevices = Number((document.querySelector<HTMLInputElement>("#maxDevicesInput")?.value || "3").trim() || 3);
  const expiresAt = (document.querySelector<HTMLInputElement>("#expiresAtInput")?.value || "").trim();
  const createMasterKey = Boolean((document.querySelector<HTMLInputElement>("#createMasterKeyInput") as any)?.checked);
  const output = document.querySelector("#createdLicenseOutput");
  if (!adminSecret || !tenantName) {
    if (output) output.textContent = "请填写管理员密钥和租户名称。";
    return;
  }
  if (!Number.isFinite(quotaTotal) || !Number.isFinite(maxDevices)) {
    if (output) output.textContent = "可使用次数和设备数都必须是数字；-1 表示不限制。";
    return;
  }
  try {
    const payload = await api("/.netlify/functions/admin-licenses", {
      method: "POST",
      headers: { "x-admin-secret": adminSecret },
      body: JSON.stringify({ tenantName, tenantId, quotaTotal, maxDevices, expiresAt, createMasterKey })
    });
    if (output) {
      output.textContent = [
        `License Key（只显示一次）：${payload.licenseKey}`,
        payload.masterKey ? `Master Key（只显示一次）：${payload.masterKey}` : "",
        `租户：${payload.license?.tenantName || tenantName}`,
        `可使用次数：${quotaLabelClean(payload.license?.quotaTotal)}`,
        `设备数：最多 ${Number(payload.license?.maxDevices ?? maxDevices) < 0 ? "不限" : payload.license?.maxDevices ?? maxDevices} 台`
      ].filter(Boolean).join("\n");
    }
    await loadLicensesFromAdminPageClean(false);
  } catch (error: any) {
    if (output) output.textContent = `创建失败：${error.message}`;
  }
}

async function loadLicensesFromAdminPageClean(showMessage = true) {
  const adminSecret = adminSecretValue();
  const list = document.querySelector("#adminLicenseList");
  const output = document.querySelector("#createdLicenseOutput");
  if (!adminSecret) {
    if (output) output.textContent = "请先输入管理员密钥。";
    return;
  }
  try {
    const payload = await api("/.netlify/functions/admin-licenses", {
      method: "GET",
      headers: { "x-admin-secret": adminSecret }
    });
    renderLicenseAdminListClean(payload.licenses || []);
    if (showMessage && output) output.textContent = `已加载 ${payload.licenses?.length || 0} 个授权。`;
  } catch (error: any) {
    if (list) list.innerHTML = `<div class="notice error">读取失败：${escapeHtml(error.message || "未知错误")}</div>`;
  }
}

function renderLicenseAdminListClean(licenses: any[]) {
  const list = document.querySelector("#adminLicenseList");
  if (!list) return;
  if (!licenses.length) {
    list.innerHTML = `<div class="license-empty">还没有开通任何 License。</div>`;
    return;
  }
  list.innerHTML = licenses.map((license) => {
    const status = String(license.status || "active");
    const remaining = Number(license.remainingUses);
    const devices = arr(license.activatedUsers);
    const maxDevices = Number(license.maxDevices ?? 3);
    const pauseOrActive = status === "paused"
      ? `<button type="button" data-admin-clean-action="active" data-license-id="${escapeHtml(license.licenseId)}">${icon("PlayCircle")}启用</button>`
      : `<button type="button" data-admin-clean-action="paused" data-license-id="${escapeHtml(license.licenseId)}">${icon("PauseCircle")}暂停</button>`;
    const rotate = status === "revoked" ? "" : `<button type="button" data-admin-clean-rotate="${escapeHtml(license.licenseId)}">${icon("RefreshCw")}重置授权码</button>`;
    const revoke = status === "revoked" ? "" : `<button class="danger" type="button" data-admin-clean-action="revoked" data-license-id="${escapeHtml(license.licenseId)}">${icon("Ban")}吊销</button>`;
    const remove = `<button class="danger" type="button" data-admin-clean-delete="${escapeHtml(license.licenseId)}">${icon("Trash2")}删除</button>`;
    return `
      <article class="license-admin-row">
        <div>
          <b>${escapeHtml(license.tenantName || license.tenantId || "未命名租户")}</b>
          <span>${escapeHtml(license.licenseId || "")}</span>
          <small>状态：${statusLabelClean(status)}｜已用 ${Number(license.quotaUsed || 0)}｜剩余 ${remaining < 0 ? "不限" : remaining}｜总量 ${quotaLabelClean(license.quotaTotal)}｜设备 ${devices.length}/${maxDevices < 0 ? "不限" : maxDevices}${license.expiresAt ? `｜到期 ${escapeHtml(license.expiresAt)}` : ""}</small>
          <small>授权码：已加密保存，不能反查明文；如需重新发放，请点“重置授权码”。</small>
          ${licenseBoundProfilesHtml(license)}
          ${devices.length ? `<div class="bound-devices">${devices.map((device: any) => `<span>${icon("MonitorSmartphone")}${escapeHtml(device.deviceName || "浏览器设备")}｜${escapeHtml(device.userId || "用户")}｜${escapeHtml(fmtTime(device.lastSeenAt))}</span>`).join("")}</div>` : `<div class="bound-devices empty">还没有设备使用此授权码登录。</div>`}
        </div>
        <div class="license-row-actions">${pauseOrActive}${rotate}${revoke}${remove}</div>
      </article>`;
  }).join("");
  list.querySelectorAll("[data-admin-clean-action]").forEach((button) => button.addEventListener("click", updateLicenseStatusFromAdminPageClean));
  list.querySelectorAll("[data-admin-clean-rotate]").forEach((button) => button.addEventListener("click", rotateLicenseKeyFromAdminPageClean));
  list.querySelectorAll("[data-admin-clean-delete]").forEach((button) => button.addEventListener("click", deleteLicenseFromAdminPageClean));
  refreshIcons();
}

async function updateLicenseStatusFromAdminPageClean(event: Event) {
  const button = event.currentTarget as HTMLElement;
  const licenseId = button.dataset.licenseId || "";
  const status = button.dataset.adminCleanAction || "";
  const adminSecret = adminSecretValue();
  if (!licenseId || !status || !adminSecret) return;
  if (status === "revoked" && !confirm("吊销后该 License 将不能继续使用，确认吊销？")) return;
  await api("/.netlify/functions/admin-licenses", {
    method: "PATCH",
    headers: { "x-admin-secret": adminSecret },
    body: JSON.stringify({ licenseId, patch: { status } })
  });
  await loadLicensesFromAdminPageClean(false);
}

async function rotateLicenseKeyFromAdminPageClean(event: Event) {
  const button = event.currentTarget as HTMLElement;
  const licenseId = button.dataset.adminCleanRotate || "";
  const adminSecret = adminSecretValue();
  const output = document.querySelector("#createdLicenseOutput");
  if (!licenseId || !adminSecret) return;
  if (!confirm("重置后旧授权码会立刻失效，新授权码只显示一次，确认继续？")) return;
  const payload = await api("/.netlify/functions/admin-licenses", {
    method: "PATCH",
    headers: { "x-admin-secret": adminSecret },
    body: JSON.stringify({ licenseId, action: "rotateKey" })
  });
  if (output) output.textContent = `新的 License Key（只显示一次）：${payload.licenseKey}\n请立即发给客户或妥善保存；刷新后无法再次查看明文。`;
  await loadLicensesFromAdminPageClean(false);
}

async function deleteLicenseFromAdminPageClean(event: Event) {
  const button = event.currentTarget as HTMLElement;
  const licenseId = button.dataset.adminCleanDelete || "";
  const adminSecret = adminSecretValue();
  const output = document.querySelector("#createdLicenseOutput");
  if (!licenseId || !adminSecret) return;
  if (!confirm("删除后该 License、授权索引和相关登录会话都会被清除，确认删除？")) return;
  try {
    await api("/.netlify/functions/admin-licenses", {
      method: "DELETE",
      headers: { "x-admin-secret": adminSecret },
      body: JSON.stringify({ licenseId })
    });
    if (output) output.textContent = "已删除 License。";
    await loadLicensesFromAdminPageClean(false);
  } catch (error: any) {
    if (output) output.textContent = `删除失败：${error.message}`;
  }
}

async function loginWithLicenseV2(event: Event) {
  event.preventDefault();
  const licenseKey = (document.querySelector<HTMLInputElement>("#licenseKeyInput")?.value || "").trim();
  const userId = (document.querySelector<HTMLInputElement>("#licenseUserInput")?.value || "").trim() || "web-user";
  if (!licenseKey) {
    renderLoginOnlyGateClean("请输入授权码");
    return;
  }
  try {
    const payload = await api("/.netlify/functions/auth-license-login", {
      method: "POST",
      body: JSON.stringify({ licenseKey, userId, deviceId: oacDeviceId(), deviceName: oacDeviceName() })
    });
    saveAuth(payload, true);
    authError = "";
    await bootstrap();
  } catch (error: any) {
    authError = error.message || "授权失败";
    renderLoginOnlyGateClean(authError);
  }
}

function adminSecretValueV2() {
  return (document.querySelector<HTMLInputElement>("#adminSecretInput")?.value || "").trim();
}

function quotaLabelV2(value: any) {
  const total = Number(value);
  return Number.isFinite(total) && total < 0 ? "不限次数" : `${Number.isFinite(total) ? total : 0} 次`;
}

function statusLabelV2(status: any) {
  const value = String(status || "active");
  if (value === "paused") return "已暂停";
  if (value === "revoked") return "已吊销";
  if (value === "expired") return "已过期";
  return "正常";
}

function adminSecretValue() {
  return (
    document.querySelector<HTMLInputElement>("[data-admin-secret-input]")?.value ||
    document.querySelector<HTMLInputElement>("#adminSecretInput")?.value ||
    ""
  ).trim();
}

function quotaLabel(value: any) {
  const total = Number(value);
  return Number.isFinite(total) && total < 0 ? "不限次数" : `${Number.isFinite(total) ? total : 0} 次`;
}

function statusLabel(status: any) {
  const value = String(status || "active");
  if (value === "paused") return "已暂停";
  if (value === "revoked") return "已吊销";
  if (value === "expired") return "已过期";
  return "正常";
}

function licenseBoundProfilesHtml(license: any) {
  const profiles = arr(license.boundProfiles);
  if (!profiles.length) return `<div class="bound-profiles empty">${icon("UsersRound")}暂未创建绑定的企业资料。</div>`;
  return `<div class="bound-profiles">
    ${profiles.map((profile: any) => {
      const products = arr(profile.coreProducts).slice(0, 3).join("、");
      return `<article class="bound-profile-card">
        <b>${icon("UsersRound")}${escapeHtml(profile.companyName || "未命名企业")}</b>
        <small>${escapeHtml(profile.mainBusiness || "主营业务待补充")}</small>
        ${products ? `<span>${escapeHtml(products)}</span>` : ""}
        ${profile.updatedAt ? `<em>更新：${escapeHtml(fmtTime(profile.updatedAt))}</em>` : ""}
      </article>`;
    }).join("")}
  </div>`;
}

async function createLicenseFromAdminPage() {
  const adminSecret = adminSecretValue();
  const tenantName = (document.querySelector<HTMLInputElement>("#tenantNameInput")?.value || "").trim();
  const tenantId = (document.querySelector<HTMLInputElement>("#tenantIdInput")?.value || "").trim();
  const unlimitedQuota = Boolean((document.querySelector<HTMLInputElement>("#quotaUnlimitedInput") as any)?.checked);
  const quotaRaw = (document.querySelector<HTMLInputElement>("#quotaLimitInput")?.value || "").trim();
  const quotaTotal = unlimitedQuota ? -1 : Number(quotaRaw);
  const maxDevicesRaw = (document.querySelector<HTMLInputElement>("#maxDevicesInput")?.value || "").trim();
  const maxDevices = maxDevicesRaw === "" ? 3 : Number(maxDevicesRaw);
  const expiresAt = (document.querySelector<HTMLInputElement>("#expiresAtInput")?.value || "").trim();
  const createMasterKey = Boolean((document.querySelector<HTMLInputElement>("#createMasterKeyInput") as any)?.checked);
  const output = document.querySelector("#createdLicenseOutput");
  const actions = document.querySelector("#createdLicenseActions");
  if (actions) actions.innerHTML = "";
  if (!adminSecret || !tenantName) {
    if (output) output.textContent = "请填写管理员密钥和租户名称。";
    return;
  }
  if (!unlimitedQuota && !quotaRaw) {
    if (output) output.textContent = "请选择“不限制使用次数”，或填写一个可使用次数。";
    return;
  }
  if (!Number.isFinite(quotaTotal)) {
    if (output) output.textContent = "可使用次数请填写数字。";
    return;
  }
  if (!Number.isFinite(maxDevices)) {
    if (output) output.textContent = "最多绑定设备数请填写数字。";
    return;
  }
  try {
    const payload = await api("/.netlify/functions/admin-licenses", {
      method: "POST",
      headers: { "x-admin-secret": adminSecret },
      body: JSON.stringify({ tenantName, tenantId, quotaTotal, maxDevices, expiresAt, createMasterKey })
    });
    const licenseKey = payload.licenseKey || "";
    const loginUrl = licenseLoginUrl(licenseKey);
    if (output) {
      output.textContent = [
        `授权码（只显示一次）：${licenseKey}`,
        `登录链接：${loginUrl}`,
        payload.masterKey ? `Master Key（只显示一次）：${payload.masterKey}` : "",
        `租户：${payload.license?.tenantName}`,
        `次数：${quotaLabel(payload.license?.quotaTotal)}`,
        `设备：最多 ${Number(payload.license?.maxDevices ?? 3) < 0 ? "不限" : payload.license?.maxDevices} 台`
      ].filter(Boolean).join("\n");
    }
    if (actions && licenseKey) {
      renderLicenseShareActions(actions, licenseKey, loginUrl);
    }
    await loadLicensesFromAdminPage(false);
  } catch (error: any) {
    if (output) output.textContent = `创建失败：${error.message}`;
  }
}

function licenseLoginUrl(licenseKey: string) {
  return `${window.location.origin}/?license=${encodeURIComponent(licenseKey || "")}`;
}

function renderLicenseShareActions(container: Element | null, licenseKey: string, loginUrl = licenseLoginUrl(licenseKey)) {
  if (!container || !licenseKey) return;
  container.innerHTML = `
    <button type="button" data-copy-text="${escapeHtml(licenseKey)}">${icon("Copy")}复制授权码</button>
    <button type="button" data-copy-text="${escapeHtml(loginUrl)}">${icon("Link")}复制登录链接</button>
  `;
  container.querySelectorAll("[data-copy-text]").forEach((button) => {
    button.addEventListener("click", copyAdminShareText);
  });
  refreshIcons();
}

async function copyAdminShareText(event: Event) {
  const button = event.currentTarget as HTMLElement;
  const text = button.dataset.copyText || "";
  const output = document.querySelector("#createdLicenseOutput");
  if (!text) return;
  try {
    await navigator.clipboard?.writeText(text);
    if (output) output.textContent = `${output.textContent || ""}\n\n已复制。`;
  } catch {
    window.prompt("复制下面内容", text);
  }
}

async function loadLicensesFromAdminPage(showMessage = true) {
  const adminSecret = adminSecretValue();
  const list = document.querySelector("#adminLicenseList");
  const output = document.querySelector("#createdLicenseOutput");
  if (!adminSecret) {
    if (output) output.textContent = "请先输入管理员密钥。";
    return;
  }
  try {
    const payload = await api("/.netlify/functions/admin-licenses", {
      method: "GET",
      headers: { "x-admin-secret": adminSecret }
    });
    renderLicenseAdminList(payload.licenses || []);
    if (showMessage && output) output.textContent = `已加载 ${payload.licenses?.length || 0} 个授权。`;
  } catch (error: any) {
    if (list) list.innerHTML = `<div class="notice error">读取失败：${escapeHtml(error.message || "未知错误")}</div>`;
  }
}

function renderLicenseAdminList(licenses: any[]) {
  const list = document.querySelector("#adminLicenseList");
  if (!list) return;
  if (!licenses.length) {
    list.innerHTML = `<div class="license-empty">还没有开通任何 License。</div>`;
    return;
  }
  list.innerHTML = licenses.map((license) => {
    const remaining = Number(license.remainingUses);
    const remainingText = remaining < 0 ? "不限" : `${remaining}`;
    const status = String(license.status || "active");
    const quotaText = quotaLabel(license.quotaTotal);
    const deviceCount = arr(license.activatedUsers).length;
    const maxDevices = Number(license.maxDevices ?? 3);
    const maxDeviceText = maxDevices < 0 ? "不限" : `${maxDevices}`;
    const pauseOrActive = status === "paused"
      ? `<button type="button" data-admin-license-action="active" data-license-id="${escapeHtml(license.licenseId)}">${icon("PlayCircle")}启用</button>`
      : `<button type="button" data-admin-license-action="paused" data-license-id="${escapeHtml(license.licenseId)}">${icon("PauseCircle")}暂停</button>`;
    const rotate = status === "revoked"
      ? ""
      : `<button type="button" data-admin-license-rotate="${escapeHtml(license.licenseId)}">${icon("RefreshCw")}生成新分享链接</button>`;
    const revoke = status === "revoked"
      ? ""
      : `<button class="danger" type="button" data-admin-license-action="revoked" data-license-id="${escapeHtml(license.licenseId)}">${icon("Ban")}吊销</button>`;
    const remove = `<button class="danger" type="button" data-admin-license-delete="${escapeHtml(license.licenseId)}">${icon("Trash2")}删除</button>`;
    return `
      <article class="license-admin-row">
        <div class="license-admin-main">
          <b>${escapeHtml(license.tenantName || license.tenantId || "未命名租户")}</b>
          <span>${escapeHtml(license.licenseId || "")}</span>
          <div class="license-admin-meta">
            <em>${icon("ShieldCheck")}${statusLabel(status)}</em>
            <em>${icon("Gauge")}已用 ${Number(license.quotaUsed || 0)} / ${quotaText}</em>
            <em>${icon("BatteryMedium")}剩余 ${remainingText}</em>
            <em>${icon("MonitorSmartphone")}设备 ${deviceCount}/${maxDeviceText}</em>
            <em>${icon("UsersRound")}企业资料 ${arr(license.boundProfiles).length}</em>
            ${license.expiresAt ? `<em>${icon("CalendarClock")}到期 ${escapeHtml(license.expiresAt)}</em>` : ""}
          </div>
          <small class="license-key-note">授权码已加密保存，不能反查旧码。需要发给别人时，点“生成新分享链接”，系统会生成新码和可复制登录链接。</small>
          ${licenseBoundProfilesHtml(license)}
        </div>
        <div class="license-row-actions">
          ${pauseOrActive}
          ${rotate}
          ${revoke}
          ${remove}
        </div>
      </article>`;
  }).join("");
  list.querySelectorAll("[data-admin-license-action]").forEach((button) => {
    button.addEventListener("click", updateLicenseStatusFromAdminPage);
  });
  list.querySelectorAll("[data-admin-license-rotate]").forEach((button) => {
    button.addEventListener("click", rotateLicenseKeyFromAdminPage);
  });
  list.querySelectorAll("[data-admin-license-delete]").forEach((button) => {
    button.addEventListener("click", deleteLicenseFromAdminPage);
  });
  refreshIcons();
}

async function updateLicenseStatusFromAdminPage(event: Event) {
  const button = event.currentTarget as HTMLElement;
  const licenseId = button.dataset.licenseId || "";
  const status = button.dataset.adminLicenseAction || "";
  const adminSecret = adminSecretValue();
  if (!licenseId || !status || !adminSecret) return;
  if (status === "revoked" && !confirm("吊销后该 License 将不能继续使用，确认吊销？")) return;
  try {
    await api("/.netlify/functions/admin-licenses", {
      method: "PATCH",
      headers: { "x-admin-secret": adminSecret },
      body: JSON.stringify({ licenseId, patch: { status } })
    });
    await loadLicensesFromAdminPage(false);
  } catch (error: any) {
    const output = document.querySelector("#createdLicenseOutput");
    if (output) output.textContent = `更新失败：${error.message}`;
  }
}

async function rotateLicenseKeyFromAdminPage(event: Event) {
  const button = event.currentTarget as HTMLElement;
  const licenseId = button.dataset.adminLicenseRotate || "";
  const adminSecret = adminSecretValue();
  const output = document.querySelector("#createdLicenseOutput");
  const actions = document.querySelector("#createdLicenseActions");
  if (actions) actions.innerHTML = "";
  if (!licenseId || !adminSecret) return;
  if (!confirm("重新生成后旧授权码会立刻失效，新授权码和登录链接只显示一次。确认继续？")) return;
  try {
    const payload = await api("/.netlify/functions/admin-licenses", {
      method: "PATCH",
      headers: { "x-admin-secret": adminSecret },
      body: JSON.stringify({ licenseId, action: "rotateKey" })
    });
    const licenseKey = payload.licenseKey || "";
    const loginUrl = licenseLoginUrl(licenseKey);
    if (output) {
      output.textContent = [
        `新的授权码（只显示一次）：${licenseKey}`,
        `新的登录链接：${loginUrl}`,
        `租户：${payload.license?.tenantName || ""}`,
        "请立即发给客户或妥善保存；刷新后无法再次查看明文。"
      ].join("\n");
    }
    renderLicenseShareActions(actions, licenseKey, loginUrl);
    await loadLicensesFromAdminPage(false);
  } catch (error: any) {
    if (output) output.textContent = `重置失败：${error.message}`;
  }
}

async function deleteLicenseFromAdminPage(event: Event) {
  const button = event.currentTarget as HTMLElement;
  const licenseId = button.dataset.adminLicenseDelete || "";
  const adminSecret = adminSecretValue();
  const output = document.querySelector("#createdLicenseOutput");
  const actions = document.querySelector("#createdLicenseActions");
  if (actions) actions.innerHTML = "";
  if (!licenseId || !adminSecret) return;
  if (!confirm("删除后该 License、授权索引和相关登录会话都会被清除，确认删除？")) return;
  try {
    await api("/.netlify/functions/admin-licenses", {
      method: "DELETE",
      headers: { "x-admin-secret": adminSecret },
      body: JSON.stringify({ licenseId })
    });
    if (output) output.textContent = "已删除 License。";
    await loadLicensesFromAdminPage(false);
  } catch (error: any) {
    if (output) output.textContent = `删除失败：${error.message}`;
  }
}

async function deleteAllLicensesFromAdminPage() {
  const adminSecret = adminSecretValue();
  const output = document.querySelector("#createdLicenseOutput");
  const actions = document.querySelector("#createdLicenseActions");
  if (actions) actions.innerHTML = "";
  if (!adminSecret) {
    if (output) output.textContent = "请先输入管理员密钥。";
    return;
  }
  if (!confirm("确认删除后台全部 License？会一并清除授权索引和相关登录会话，删除后需要重新新建授权。")) return;
  try {
    const payload = await api("/.netlify/functions/admin-licenses", {
      method: "DELETE",
      headers: { "x-admin-secret": adminSecret },
      body: JSON.stringify({ all: true })
    });
    if (output) output.textContent = `已删除 ${Number(payload.deletedCount || 0)} 个 License。`;
    await loadLicensesFromAdminPage(false);
  } catch (error: any) {
    if (output) output.textContent = `删除失败：${error.message}`;
  }
}

async function createLicenseFromGateV2() {
  const adminSecret = adminSecretValueV2();
  const tenantName = (document.querySelector<HTMLInputElement>("#tenantNameInput")?.value || "").trim();
  const tenantId = (document.querySelector<HTMLInputElement>("#tenantIdInput")?.value || "").trim();
  const quotaRaw = (document.querySelector<HTMLInputElement>("#quotaTotalInput")?.value || "").trim();
  const quotaTotal = quotaRaw === "" ? -1 : Number(quotaRaw);
  const expiresAt = (document.querySelector<HTMLInputElement>("#expiresAtInput")?.value || "").trim();
  const createMasterKey = Boolean((document.querySelector<HTMLInputElement>("#createMasterKeyInput") as any)?.checked);
  const output = document.querySelector("#createdLicenseOutput");
  if (!adminSecret || !tenantName) {
    if (output) output.textContent = "请填写管理员密钥和租户名称。";
    return;
  }
  if (!Number.isFinite(quotaTotal)) {
    if (output) output.textContent = "授权次数请填写数字；-1 表示不限次数。";
    return;
  }
  try {
    const payload = await api("/.netlify/functions/admin-licenses", {
      method: "POST",
      headers: { "x-admin-secret": adminSecret },
      body: JSON.stringify({ tenantName, tenantId, quotaTotal, expiresAt, createMasterKey })
    });
    if (output) {
      output.textContent = [
        `License Key（只显示一次）：${payload.licenseKey}`,
        payload.masterKey ? `Master Key（只显示一次）：${payload.masterKey}` : "",
        `租户：${payload.license?.tenantName}`,
        `次数：${quotaLabelV2(payload.license?.quotaTotal)}`
      ].filter(Boolean).join("\n");
    }
    await loadLicensesFromGateV2(false);
  } catch (error: any) {
    if (output) output.textContent = `创建失败：${error.message}`;
  }
}

async function loadLicensesFromGateV2(showMessage = true) {
  const adminSecret = adminSecretValueV2();
  const list = document.querySelector("#adminLicenseList");
  const output = document.querySelector("#createdLicenseOutput");
  if (!adminSecret) {
    if (output) output.textContent = "请先输入管理员密钥。";
    return;
  }
  try {
    const payload = await api("/.netlify/functions/admin-licenses", {
      method: "GET",
      headers: { "x-admin-secret": adminSecret }
    });
    renderLicenseAdminListV2(payload.licenses || []);
    if (showMessage && output) output.textContent = `已加载 ${payload.licenses?.length || 0} 个授权。`;
  } catch (error: any) {
    if (list) list.innerHTML = `<div class="notice error">读取失败：${escapeHtml(error.message || "未知错误")}</div>`;
  }
}

function renderLicenseAdminListV2(licenses: any[]) {
  const list = document.querySelector("#adminLicenseList");
  if (!list) return;
  if (!licenses.length) {
    list.innerHTML = `<div class="license-empty">还没有开通任何 License。</div>`;
    return;
  }
  list.innerHTML = licenses.map((license) => {
    const remaining = Number(license.remainingUses);
    const remainingText = remaining < 0 ? "不限" : `${remaining}`;
    const status = String(license.status || "active");
    const pauseOrActive = status === "paused"
      ? `<button type="button" data-license-action="active" data-license-id="${escapeHtml(license.licenseId)}">${icon("PlayCircle")}启用</button>`
      : `<button type="button" data-license-action="paused" data-license-id="${escapeHtml(license.licenseId)}">${icon("PauseCircle")}暂停</button>`;
    const revoke = status === "revoked"
      ? ""
      : `<button class="danger" type="button" data-license-action="revoked" data-license-id="${escapeHtml(license.licenseId)}">${icon("Ban")}吊销</button>`;
    return `
      <article class="license-admin-row">
        <div>
          <b>${escapeHtml(license.tenantName || license.tenantId || "未命名租户")}</b>
          <span>${escapeHtml(license.licenseId || "")}</span>
          <small>状态：${statusLabelV2(status)}｜已用 ${Number(license.quotaUsed || 0)}｜剩余 ${remainingText}｜总量 ${quotaLabelV2(license.quotaTotal)}${license.expiresAt ? `｜到期 ${escapeHtml(license.expiresAt)}` : ""}</small>
        </div>
        <div class="license-row-actions">
          ${pauseOrActive}
          ${revoke}
        </div>
      </article>`;
  }).join("");
  list.querySelectorAll("[data-license-action]").forEach((button) => {
    button.addEventListener("click", updateLicenseStatusFromGateV2);
  });
  refreshIcons();
}

async function updateLicenseStatusFromGateV2(event: Event) {
  const button = event.currentTarget as HTMLElement;
  const licenseId = button.dataset.licenseId || "";
  const status = button.dataset.licenseAction || "";
  const adminSecret = adminSecretValueV2();
  if (!licenseId || !status || !adminSecret) return;
  if (status === "revoked" && !confirm("吊销后该 License 将不能继续使用，确认吊销？")) return;
  try {
    await api("/.netlify/functions/admin-licenses", {
      method: "PATCH",
      headers: { "x-admin-secret": adminSecret },
      body: JSON.stringify({ licenseId, patch: { status } })
    });
    await loadLicensesFromGateV2(false);
  } catch (error: any) {
    const output = document.querySelector("#createdLicenseOutput");
    if (output) output.textContent = `更新失败：${error.message}`;
  }
}

function renderApp() {
  const reportId = new URLSearchParams(window.location.search).get("reportId");
  if (reportId) {
    renderReportView(reportId);
    return;
  }
  if (localStorage.getItem(LS_STARTED) !== "1") {
    localStorage.setItem(LS_STARTED, "1");
    localStorage.setItem(LS_TAB, "home");
  }
  app.innerHTML = workbenchPage();
  bindShell(true);
  refreshIcons();
}

function bindShell(started: boolean) {
  if (!started) {
    document.querySelector("#startApp")?.addEventListener("click", () => {
      localStorage.setItem(LS_STARTED, "1");
      localStorage.setItem(LS_TAB, "create");
      renderApp();
    });
    document.querySelector("#openReportsQuick")?.addEventListener("click", () => {
      localStorage.setItem(LS_STARTED, "1");
      localStorage.setItem(LS_TAB, "reports");
      renderApp();
    });
    return;
  }
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => setTab((button as HTMLElement).dataset.tab || "create"));
  });
  renderHomeTab();
  renderCreateTask();
  renderTaskCenter();
  renderReports();
  renderProfiles();
  setTab(localStorage.getItem(LS_TAB) || "create", false);
  startPolling();
}

function setTab(tab: string, save = true) {
  const value = ["home", "create", "tasks", "reports", "profiles"].includes(tab) ? tab : "create";
  if (save) localStorage.setItem(LS_TAB, value);
  document.querySelector(".app-shell")?.classList.toggle("home-tab-active", value === "home");
  document.querySelectorAll(".tab-pane").forEach((pane) => {
    (pane as HTMLElement).hidden = pane.id !== `${value}Tab`;
  });
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.classList.toggle("active", (button as HTMLElement).dataset.tab === value);
  });
  if (value === "tasks") startPolling();
  refreshIcons();
}

function renderHomeTab() {
  const root = document.querySelector("#homeTab");
  if (!root) return;
  root.innerHTML = homeTabHtml();
  root.querySelector("#homeCreateTask")?.addEventListener("click", () => setTab("create"));
  root.querySelector("#homeOpenReports")?.addEventListener("click", () => setTab("reports"));
  refreshIcons();
}

async function detectRuntime() {
  const badge = document.querySelector("#runtimeModeBadge");
  if (!badge) return;
  try {
    const data = await api("/.netlify/functions/health");
    const count = arr(data.channels).filter((channel) => channel.configured).length;
    badge.textContent = `${data.runtimeMode?.label || "通道"}｜可用通道 ${count}`;
  } catch {
    badge.textContent = "通道未确认";
  }
}

async function loadProfiles() {
  const data = await api("/.netlify/functions/list-profiles");
  profiles = arr(data.profiles);
  if (selectedProfileId && !profiles.some((profile) => profile.profileId === selectedProfileId)) selectedProfileId = "";
  if (!selectedProfileId && profiles.length) {
    const saved = localStorage.getItem(LS_PROFILE) || "";
    selectedProfileId = profiles.some((profile) => profile.profileId === saved) ? saved : profiles[0].profileId;
    localStorage.setItem(LS_PROFILE, selectedProfileId);
  }
}

function createTaskHtml() {
  const profile = selectedProfile();
  return `
    <section class="workspace-section">
      <div class="section-title compact-title">
        <h2>创建任务</h2>
        <p>先选我的企业，再输入目标客户。</p>
      </div>
      <div class="mission-grid">
        <article class="step-card seller-step">
          <div class="step-title-row compact-step-head">
            <span>1</span>
            <h3>我的企业</h3>
          </div>
          <div class="seller-select-row">
            <select id="sellerProfileSelect">${profileOptions(false)}</select>
            <button id="quickAddProfile" class="ghost square-button" aria-label="新增我的企业" type="button">${icon("Plus")}</button>
          </div>
          ${profile ? `<p class="micro-copy">${escapeHtml(profile.mainBusiness || profile.summary || "已选择我的企业。")}</p>${profileReady(profile) ? "" : `<div class="notice error">请先补齐主营业务和核心产品/服务，再生成商机报告。</div>`}` : `<p class="muted">先选择或新增我的企业。</p>`}
        </article>
        <article class="step-card target-step">
          <div class="step-title-row compact-step-head">
            <span>2</span>
            <h3>目标客户</h3>
          </div>
          <form id="companyForm" class="v2-form">
            <label class="target-name inline-field"><b>企业名称</b><input id="companyInput" placeholder="输入准确企业名，例如：宁波精华电子科技股份有限公司" required /></label>
            <details class="optional-intel full">
              <summary>${icon("SlidersHorizontal")}可选补充</summary>
              <div class="optional-grid">
                <label><b>地区线索</b><input id="regionInput" placeholder="例如：宁波 / 上海 / 中国" /></label>
                <label><b>行业线索</b><input id="industryInput" placeholder="例如：汽车零部件 / 制造业" /></label>
                <label class="full"><b>已掌握的客户需求</b><textarea id="aiNeedInput" rows="3" placeholder="例如：客户提出研发需要 DFM 能力；希望做知识库、质量追溯、数据问答或智能体平台。"></textarea></label>
                <label class="full"><b>上传年报 PDF</b><input id="annualReportInput" type="file" accept="application/pdf,.pdf" /><small id="annualReportHint">仅支持可复制文字 PDF。上传后优先作为财务与经营证据。</small></label>
              </div>
            </details>
            <button class="primary full-action" type="submit">${icon("SearchCheck")}核对并生成</button>
          </form>
        </article>
      </div>
      <div id="candidateArea" class="candidate-area"></div>
      <div id="createStatus" class="inline-status"></div>
    </section>`;
}

function renderCreateTask() {
  const root = document.querySelector("#createTab");
  if (!root) return;
  root.innerHTML = createTaskHtml();
  const select = document.querySelector<HTMLSelectElement>("#sellerProfileSelect");
  select?.addEventListener("change", () => {
    if (select.value === "__new__") {
      setTab("profiles");
      return;
    }
    selectedProfileId = select.value;
    localStorage.setItem(LS_PROFILE, selectedProfileId);
    renderCreateTask();
    renderReports();
  });
  document.querySelector("#quickAddProfile")?.addEventListener("click", () => setTab("profiles"));
  document.querySelector("#companyForm")?.addEventListener("submit", resolveCompany);
  refreshIcons();
}

function setCreateStatus(message = "", kind = "") {
  const el = document.querySelector("#createStatus");
  if (el) el.innerHTML = message ? `<div class="notice ${kind}">${message}</div>` : "";
}

async function uploadAnnualReportIfNeeded(companyName: string) {
  const file = (document.querySelector<HTMLInputElement>("#annualReportInput")?.files || [])[0];
  if (!file) return null;
  setCreateStatus("正在解析年报 PDF，提取指标和页码证据。");
  const form = new FormData();
  form.append("file", file);
  form.append("companyName", companyName);
  const token = authToken();
  const res = await fetch("/.netlify/functions/upload-annual-report", {
    method: "POST",
    body: form,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });
  const payload = await res.json();
  if (!res.ok || payload.ok === false) throw new Error(payload.error || "年报解析失败");
  const hint = document.querySelector("#annualReportHint");
  if (hint) hint.textContent = `已解析《${payload.annualReport?.fileName || file.name}》：提取 ${arr(payload.annualReport?.metrics).length} 个指标。`;
  return payload.annualReport;
}

async function resolveCompany(event: Event) {
  event.preventDefault();
  if (!selectedProfile()) {
    setCreateStatus("请先选择或新增我的企业。", "error");
    return;
  }
  if (!profileReady(selectedProfile())) {
    setCreateStatus("请先在“我的企业”里补齐主营业务和核心产品/服务。", "error");
    return;
  }
  const name = (document.querySelector<HTMLInputElement>("#companyInput")?.value || "").trim();
  const region = (document.querySelector<HTMLInputElement>("#regionInput")?.value || "").trim();
  const industry = (document.querySelector<HTMLInputElement>("#industryInput")?.value || "").trim();
  const aiNeeds = (document.querySelector<HTMLTextAreaElement>("#aiNeedInput")?.value || "").trim();
  if (!name) return;
  try {
    candidateAiNeeds = aiNeeds;
    annualReportSummary = await uploadAnnualReportIfNeeded(name);
    setCreateStatus("正在核对目标客户主体和历史报告。");
    const data = await api("/.netlify/functions/resolve-company", {
      method: "POST",
      body: JSON.stringify({ query: name, region, industry, aiNeeds, annualReportSummary })
    });
    renderCandidates(arr(data.candidates), arr(data.cached), data.tianyanchaDiagnostic);
    setCreateStatus("");
  } catch (error: any) {
    setCreateStatus(`核对失败：${error.message}`, "error");
  }
}

function renderCandidates(candidates: any[], cached: any[], tianyanchaDiagnostic: any = null) {
  const root = document.querySelector("#candidateArea");
  if (!root) return;
  const tycNotice = tianyanchaDiagnosticNotice(tianyanchaDiagnostic);
  const sourceLabel = (candidate: any) => {
    if (candidate?.scoreBreakdown?.tianyanchaApi || candidate?.tianyanchaSource || /tianyancha/i.test(String(candidate?.channel || ""))) {
      return "已通过天眼查核验";
    }
    if (candidate?.scoreBreakdown?.annualReport || candidate?.annualReportId) return "年报强证据";
    return "网页搜索候选";
  };
  root.innerHTML = `
    <section class="candidate-panel ios-list-panel">
      <div class="list-section-title"><span>3</span><b>确认目标客户</b></div>
      ${tycNotice ? `<div class="notice soft-warning">${escapeHtml(tycNotice)}</div>` : ""}
      ${cached.length ? `<div class="notice">已发现历史报告。若重新生成，将按“当前我方企业 + 目标客户”组合覆盖最新入口。</div>` : ""}
      <div class="candidate-grid compact-candidate-list">
        ${candidates.map((candidate, index) => {
          const verification = candidateVerification(candidate);
          return `<article class="candidate-card ${verification.verified ? "candidate-card-verified" : ""}">
            <div class="candidate-main">
              <div class="candidate-title-row">
                <b>${escapeHtml(candidate.standardName || candidate.name)}</b>
                <em class="candidate-source">${verification.verified ? icon("ShieldCheck") : ""}${escapeHtml(sourceLabel(candidate))}</em>
              </div>
              ${verification.verified ? `<div class="candidate-verified-line">${icon("BadgeCheck")}企业主体已核验${verification.creditCode ? `｜统一社会信用代码 ${escapeHtml(verification.creditCode)}` : ""}</div>` : `<span>${escapeHtml([candidate.region, candidate.industry].filter(Boolean).join("｜") || "地区/行业待确认")}</span>`}
              ${verification.fields.length ? `<div class="candidate-facts">${verification.fields.map(([label, value]) => `<span><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></span>`).join("")}</div>` : ""}
              ${verification.address ? `<p class="candidate-address">注册地址：${escapeHtml(verification.address)}</p>` : (!verification.verified ? `<p>${escapeHtml(candidate.reason || "候选企业主体")}</p>` : "")}
            </div>
            <div class="candidate-side">
              <small>${escapeHtml(candidate.confidence || "-")}分</small>
              <button data-candidate="${index}" class="primary mini" type="button">${icon("Sparkles")}生成</button>
            </div>
          </article>`;
        }).join("")}
      </div>
    </section>`;
  root.querySelectorAll("[data-candidate]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number((button as HTMLElement).dataset.candidate);
      candidateCompany = {
        ...candidates[index],
        aiNeeds: candidateAiNeeds,
        annualReportId: annualReportSummary?.annualReportId,
        annualReportSummary: annualReportSummary
          ? {
              annualReportId: annualReportSummary.annualReportId,
              fileName: annualReportSummary.fileName,
              pageCount: annualReportSummary.pageCount,
              metrics: annualReportSummary.metrics,
              sections: annualReportSummary.sections,
              warnings: annualReportSummary.warnings
            }
          : undefined
      };
      createReportJob();
    });
  });
  refreshIcons();
}

async function createReportJob() {
  const profile = selectedProfile();
  if (!profile || !candidateCompany) return;
  try {
    setCreateStatus("正在创建后台任务。创建成功后可关闭页面，稍后在任务中心查看。");
    const companyPayload = {
      ...candidateCompany,
      sellerProfileId: profile.profileId,
      sellerProfileName: profile.companyName,
      sellerProfileSnapshot: profile
    };
    const data = await api("/.netlify/functions/create-report-job", {
      method: "POST",
      body: JSON.stringify({ company: companyPayload, profileId: profile.profileId, force: true, runtimeMode: modePrefix() })
    });
    if (data.cached && data.reportId) {
      setCreateStatus("已命中历史报告，正在打开。");
      openReport(data.reportId);
      return;
    }
    activeJobs[data.jobId] = mergeJobSnapshot(
      activeJobs[data.jobId],
      data.job || {
        company: candidateCompany,
        targetCompanyName: candidateCompany.standardName || candidateCompany.name,
        standardName: candidateCompany.standardName || candidateCompany.name,
        companyName: candidateCompany.standardName || candidateCompany.name,
        sellerProfileId: profile.profileId,
        sellerProfileName: profile.companyName,
        sellerProfileSnapshot: profile,
        status: "queued",
        progress: 10,
        phaseKey: "resolve",
        stage: "企业核对完成",
        detail: "已选择企业主体，等待启动深度检索。"
      },
      data.jobId
    );
    saveJobSnapshot(data.jobId, activeJobs[data.jobId]);
    rememberJob(data.jobId);
    await fetch("/.netlify/functions/run-report-job-background", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: data.jobId })
    });
    setCreateStatus(`任务已创建：${escapeHtml(profile.companyName)} → ${escapeHtml(candidateCompany.standardName || candidateCompany.name)}。你可以关闭页面，后台会继续运行。`, "success");
    taskCenterView = "running";
    setTab("tasks");
    startPolling();
  } catch (error: any) {
    setCreateStatus(`任务创建失败：${error.message}`, "error");
  }
}

function jobStats(jobs: any[]) {
  const running = jobs.filter((job) => isLiveJob(job)).length;
  const done = jobs.filter((job) => isDoneJob(job)).length;
  const error = jobs.filter((job) => isErrorJob(job)).length;
  return {
    running,
    done,
    error,
    active: running + error,
    total: jobs.length
  };
}

function isLiveJob(job: any) {
  return ["queued", "running", "needs_resume"].includes(String(job?.status || ""));
}

function isDoneJob(job: any) {
  return String(job?.status || "") === "done";
}

function isErrorJob(job: any) {
  return ["error", "cancelled"].includes(String(job?.status || ""));
}

function taskViewJobs(jobs: any[]) {
  if (taskCenterView === "done") return jobs.filter((job) => isDoneJob(job));
  if (taskCenterView === "error") return jobs.filter((job) => isErrorJob(job));
  if (taskCenterView === "all") return jobs;
  return jobs.filter((job) => isLiveJob(job));
}

function taskViewEmptyText() {
  if (taskCenterView === "done") return "暂无已完成任务。完成后的任务会在这里集中查看。";
  if (taskCenterView === "error") return "暂无异常任务。任务失败后会在这里显示处理建议。";
  if (taskCenterView === "all") return "暂无任务。创建后，参谋团会在这里显示每位成员正在做什么。";
  return "暂无运行中任务。已完成任务请点“已完成”查看。";
}

function taskFilterBar(stats: any) {
  const tabs = [
    ["running", "LoaderCircle", "运行中", stats.running],
    ["done", "CircleCheck", "已完成", stats.done],
    ["error", "TriangleAlert", "异常", stats.error],
    ["all", "Layers3", "全部", stats.total]
  ];
  return `<div class="task-summary-bar" role="tablist" aria-label="任务状态">
    ${tabs
      .map(
        ([value, iconName, label, count]) =>
          `<button class="${taskCenterView === value ? "active" : ""}" data-task-view="${escapeHtml(String(value))}" type="button" role="tab" aria-selected="${taskCenterView === value ? "true" : "false"}">${icon(String(iconName))}<span>${escapeHtml(String(label))}</span><b>${escapeHtml(count)}</b></button>`
      )
      .join("")}
  </div>`;
}

function renderTaskCenter() {
  const root = document.querySelector("#tasksTab");
  if (!root) return;
  const ids = activeJobIds();
  const allJobs = ids.map((id) => activeJobs[id] || loadJobSnapshot(id) || { jobId: id, status: "queued", stage: "等待同步", progress: 0 });
  const stats = jobStats(allJobs);
  const jobs = taskViewJobs(allJobs);
  root.innerHTML = `
    <section class="workspace-section">
      <div class="section-title compact-title">
        <h2>任务中心</h2>
        <p>默认只看运行中任务；已完成和异常任务可点上方状态切换。</p>
      </div>
      ${taskFilterBar(stats)}
      ${taskSyncWarning ? `<div class="task-warning">${icon("TriangleAlert")}任务中心刚才有一次同步失败，已保留当前任务状态并自动重试：${escapeHtml(taskSyncWarning)}</div>` : ""}
      <div class="task-list">
        ${jobs.length ? jobs.map(taskCard).join("") : `<div class="empty-state compact-empty">${escapeHtml(taskViewEmptyText())}</div>`}
      </div>
    </section>`;
  root.querySelectorAll("[data-task-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = (button as HTMLElement).dataset.taskView || "active";
      taskCenterView = ["running", "done", "error", "all"].includes(value) ? value : "running";
      renderTaskCenter();
    });
  });
  root.querySelectorAll("[data-open-report]").forEach((button) => {
    button.addEventListener("click", () => openReport((button as HTMLElement).dataset.openReport || ""));
  });
  root.querySelectorAll("[data-complete-task]").forEach((button) => {
    button.addEventListener("click", () => dismissJob((button as HTMLElement).dataset.completeTask || ""));
  });
  root.querySelectorAll("[data-cancel-task]").forEach((button) => {
    button.addEventListener("click", () => cancelJob((button as HTMLElement).dataset.cancelTask || ""));
  });
  root.querySelectorAll("[data-refresh-task]").forEach((button) => {
    button.addEventListener("click", () => pollJobs());
  });
  refreshIcons();
}

function taskPhaseRail(job: any) {
  const phases = Array.isArray(job.phaseTree) ? job.phaseTree : [];
  if (!phases.length) return "";
  const doneCount = phases.filter((phase: any) => phase.status === "done").length;
  const current = phases.find((phase: any) => ["running", "error", "cancelled"].includes(String(phase.status || ""))) || phases[doneCount] || phases[phases.length - 1];
  const status = String(current?.status || "pending");
  const labelMap: Record<string, string> = {
    done: "已完成",
    running: "当前",
    error: "失败",
    cancelled: "已停止",
    pending: "等待"
  };
  return `<div class="task-phase-panel ${escapeHtml(status)}">
    <div class="task-phase-summary">
      <div>
        <span>${escapeHtml(labelMap[status] || "当前")}</span>
        <b>${escapeHtml(current?.label || current?.key || job.currentPhaseLabel || "任务处理中")}</b>
        ${current?.currentStep ? `<small>${escapeHtml(current.currentStep)}</small>` : ""}
      </div>
      <strong>${escapeHtml(doneCount)}/${escapeHtml(phases.length)}</strong>
    </div>
    <div class="task-phase-grid" aria-label="任务阶段">
      ${phases
        .map((phase: any) => {
          const phaseStatus = String(phase.status || "pending");
          return `<span class="task-phase-chip ${escapeHtml(phaseStatus)}"><i></i><b>${escapeHtml(phase.label || phase.key || "")}</b><em>${escapeHtml(labelMap[phaseStatus] || phaseStatus)}</em></span>`;
        })
        .join("")}
    </div>
  </div>`;
}

function taskNextAction(job: any) {
  const status = String(job.status || "");
  const text = `${job.stage || ""} ${job.detail || ""} ${job.error || ""}`;
  if (status === "needs_resume") return "系统已保存断点，会自动从上次卡点继续；请先保留任务，不要重复新建。";
  if (isLiveJob(job) && Number(job.updatedAgoMs || 0) > 8 * 60 * 1000) return "任务较长时间未更新时，系统会尝试断点续跑；已采集证据会优先复用。";
  if (status === "cancelled") return "任务已停止，不会生成正式报告；需要报告时请重新创建。";
  return "";
}

function taskFailureGuidance(job: any) {
  if (!isErrorJob(job)) return null;
  const status = String(job.status || "");
  const text = `${job.stage || ""} ${job.detail || ""} ${job.error || ""}`.trim();
  if (job.errorCause || job.nextAction || job.errorType) {
    return {
      cause: job.errorCause || `后台已识别异常类型：${job.errorType || "unknown_error"}。`,
      action: job.nextAction || "请先刷新状态；如果仍失败，请联系管理员，并保留任务 ID、目标客户和失败时间方便排查。",
      admin: job.contactAdmin !== false,
      type: job.errorType || "",
      provider: job.errorProvider || "",
      recoverable: job.recoverable,
      resumeStrategy: job.resumeStrategy || ""
    };
  }
  if (status === "cancelled") {
    return {
      cause: "任务被手动停止，不会继续生成正式报告。",
      action: "如仍需要报告，请确认输入信息后重新创建任务。",
      admin: false
    };
  }
  if (/token|tokens|insufficient_quota|billing|balance|余额不足|模型余额|账户余额|扣费|欠费|payment/i.test(text)) {
    return {
      cause: "模型调用额度或 token 余额不足，最终分析/整合无法继续。",
      action: "请管理员检查模型服务余额、Netlify AI Gateway 或相关模型 Key 的计费状态；余额恢复后优先从断点继续或只重跑失败步骤。",
      admin: true
    };
  }
  if (/rate limit|429|too many requests|并发|限流|请求过多/i.test(text)) {
    return {
      cause: "上游接口或模型服务触发限流，通常是短时间请求过多。",
      action: "请等待 5-15 分钟后刷新状态或从断点继续；如频繁出现，请管理员降低并发或检查供应商限流策略。",
      admin: true
    };
  }
  if (/天眼查|Tavily|search|搜索|积分|quota|credit|limit|402|额度|次数不足|credits/i.test(text)) {
    return {
      cause: "数据源额度不足或接口暂时不可用，证据采集可能未完成。",
      action: "请等待额度恢复，或由管理员补充/更换数据源 Key；如果已有足够证据，可先生成临时报告并标注缺失来源。",
      admin: true
    };
  }
  if (/timeout|超时|整合模型|最终整合|function timeout|execution timed out|运行预算/i.test(text)) {
    return {
      cause: "任务运行时间过长或最终整合模型超时，可能已完成部分证据采集。",
      action: "请先点“刷新状态”。若仍失败，优先从断点继续或只重跑最终整合，避免重新消耗检索额度。",
      admin: false
    };
  }
  if (/checkpoint missing|断点缺失|没有可恢复断点/i.test(text)) {
    return {
      cause: "系统没有找到可恢复断点，无法确认从哪一步继续。",
      action: "请重新创建任务；为避免重复消耗额度，重新创建前先确认目标客户、我的企业和补充信息是否正确。",
      admin: false
    };
  }
  if (/身份|绑定|identity|license|授权|会话|tenant|租户|权限/i.test(text)) {
    return {
      cause: "任务缺少租户、授权、目标客户或我的企业绑定信息。",
      action: "请确认授权登录状态、我的企业绑定和目标客户信息；仍无法恢复时联系管理员处理。",
      admin: true
    };
  }
  if (/network|fetch|ECONN|ENOTFOUND|连接|网络|接口|service unavailable|5\\d\\d/i.test(text)) {
    return {
      cause: "网络或上游服务临时异常，任务未能完成当前步骤。",
      action: "请刷新状态后重试；如果连续失败，请联系管理员检查服务日志和上游接口状态。",
      admin: true
    };
  }
  return {
    cause: text ? "系统记录到失败信息，但无法自动归类具体原因。" : "系统未返回明确失败原因。",
    action: "请先刷新状态；如果仍失败，请联系管理员，并保留任务 ID、目标客户和失败时间方便排查。",
    admin: true
  };
}

function taskFailureGuidanceHtml(job: any) {
  const guidance = taskFailureGuidance(job);
  if (!guidance) return "";
  return `<div class="task-failure-guidance">
    ${guidance.type ? `<div class="task-error-tags"><span>${escapeHtml(guidance.type)}</span>${guidance.provider ? `<span>${escapeHtml(guidance.provider)}</span>` : ""}${guidance.recoverable !== undefined ? `<span>${guidance.recoverable ? "可恢复" : "需重建/人工处理"}</span>` : ""}</div>` : ""}
    <b>${icon("TriangleAlert")}失败原因</b>
    <p>${escapeHtml(guidance.cause)}</p>
    <b>${icon("ListChecks")}解决办法</b>
    <p>${escapeHtml(guidance.action)}</p>
    ${guidance.resumeStrategy ? `<small>${icon("RefreshCw")}恢复策略：${escapeHtml(guidance.resumeStrategy)}</small>` : ""}
    ${guidance.admin ? `<small>${icon("ShieldCheck")}如果你无法处理，请联系管理员并保留任务 ID：${escapeHtml(job.jobId || "-")}</small>` : ""}
  </div>`;
}

function taskCard(job: any) {
  const running = isLiveJob(job);
  const done = isDoneJob(job) && job.reportId;
  const report = job.report || {};
  const identity = job.jobIdentity || {};
  const target =
    identity.targetCompanyName ||
    report.targetCompanyName ||
    report.standardName ||
    job.targetCompanyName ||
    job.standardName ||
    job.companyName ||
    job.company?.standardName ||
    job.company?.name ||
    "目标客户处理中";
  const seller =
    identity.sellerProfileName ||
    report.sellerProfileName ||
    job.sellerProfileName ||
    identity.sellerProfileSnapshot?.companyName ||
    job.sellerProfileSnapshot?.companyName ||
    job.company?.sellerProfileName ||
    job.company?.sellerProfileSnapshot?.companyName ||
    "未绑定我的企业";
  const worker = workerForJob(job);
  const detailText = job.detail || job.error || "Task is running in the background.";
  const searchQuotaWarning = /Tavily.*(额度|限额|quota|credit|limit|429|402|exceed|usage|棰濆害|闄愰)/i.test(detailText);
  const workerVerb = done ? "已完成作战简报，可打开查看" : worker.verb;
  const nextAction = taskNextAction(job);
  const failureGuidance = taskFailureGuidanceHtml(job);
  return `
    <article class="task-card ${done ? "done" : running ? "running" : "error"}">
      <div class="task-head">
        <div class="task-title-block">
          <b>${escapeHtml(target)}</b>
          <span>${escapeHtml(seller)}</span>
        </div>
        <strong class="task-percent">${Math.round(Number(job.progress || 0))}%</strong>
      </div>
      <div class="progress-track"><div style="width:${Math.max(0, Math.min(Number(job.progress || 0), 100))}%"></div></div>
      ${taskPhaseRail(job)}
      <div class="worker-line">
        <span class="worker-avatar">${escapeHtml(worker.name.slice(0, 1))}</span>
        <div><b>${escapeHtml(worker.name)} · ${escapeHtml(worker.role)}</b><small>${escapeHtml(workerVerb)}</small></div>
      </div>
      <div class="task-meta">
        <span>${icon("Layers3")}${escapeHtml(job.stage || "等待同步")}</span>
        <span>${icon("Timer")}已运行 ${fmtDuration(job.elapsedMs)}</span>
        ${running ? `<span>${icon("Timer")}预计剩余 ${escapeHtml(job.estimatedRemainingText || "约 30 分钟内")}</span>` : ""}
        <span>${icon("Link")}来源 ${escapeHtml(job.sourceCount ?? "-")}</span>
      </div>
      <p>${escapeHtml(job.detail || job.error || "任务正在后台处理。")}</p>
      ${failureGuidance}
      ${nextAction ? `<div class="task-next-action">${icon(isErrorJob(job) ? "TriangleAlert" : "ListChecks")}<span>${escapeHtml(nextAction)}</span></div>` : ""}
      ${searchQuotaWarning ? `<div class="task-warning">${icon("TriangleAlert")}Tavily 搜索额度可能已用完，请补充 Key 或等待额度恢复。</div>` : ""}
      <div class="actions">
        ${done ? `<button class="primary" data-open-report="${escapeHtml(job.reportId)}" type="button">${icon("FileText")}打开报告</button><button data-complete-task="${escapeHtml(job.jobId)}" type="button">${icon("CircleCheck")}确认清除</button>` : ""}
        ${running ? `<button class="danger ghost" data-cancel-task="${escapeHtml(job.jobId)}" type="button">${icon("OctagonX")}停止</button>` : ""}
        ${!running && !done ? `<button data-refresh-task="${escapeHtml(job.jobId)}" type="button">${icon("RefreshCw")}刷新状态</button><button data-complete-task="${escapeHtml(job.jobId)}" type="button">${icon("CircleCheck")}清除</button>` : ""}
      </div>
    </article>`;
}

async function cancelJob(jobId: string) {
  if (!jobId || !window.confirm("确认停止本次生成吗？停止后不会生成正式报告。")) return;
  const data = await api("/.netlify/functions/cancel-report-job", { method: "POST", body: JSON.stringify({ jobId }) });
  activeJobs[jobId] = data.job || activeJobs[jobId];
  renderTaskCenter();
}

async function pollJobs() {
  if (pollingJobs) {
    pollAgainAfterCurrent = true;
    return;
  }
  pollingJobs = true;
  const isLiveTask = (job: any) => isLiveJob(job);
  const isRecentFinishedTask = (job: any) => {
    if (!["done", "error", "cancelled"].includes(String(job?.status || ""))) return false;
    const ts = Date.parse(job.completedAt || job.finishedAt || job.updatedAt || "");
    return Number.isFinite(ts) && Date.now() - ts < RECENT_TASK_DAYS * 24 * 60 * 60 * 1000;
  };
  try {
    const remote = await api("/.netlify/functions/list-report-jobs");
    taskSyncWarning = "";
    const blocked = dismissedJobIdSet();
    const remoteJobs = Array.isArray(remote.jobs) ? remote.jobs : [];
    const visibleRemoteJobs = remoteJobs
      .filter((job: any) => isLiveTask(job) || isRecentFinishedTask(job))
      .slice(0, 50);
    for (const job of visibleRemoteJobs) {
      if (!job?.jobId || blocked.has(job.jobId)) continue;
      activeJobs[job.jobId] = mergeJobSnapshot(activeJobs[job.jobId] || loadJobSnapshot(job.jobId), job, job.jobId);
      saveJobSnapshot(job.jobId, activeJobs[job.jobId]);
    }
    if (visibleRemoteJobs.length) {
      saveActiveJobIds([...visibleRemoteJobs.map((job: any) => job?.jobId).filter(Boolean), ...activeJobIds()].filter((id) => id !== "__task_sync_error"));
    }
  } catch (error: any) {
    taskSyncWarning = error?.message || "任务列表暂时无法读取，系统会自动重试。";
    delete activeJobs.__task_sync_error;
    saveActiveJobIds(activeJobIds().filter((id) => id !== "__task_sync_error"));
  }

  const ids = activeJobIds()
    .filter((jobId) => {
      const job = activeJobs[jobId] || loadJobSnapshot(jobId);
      return !job || isLiveTask(job) || isRecentFinishedTask(job);
    })
    .slice(0, 50);
  if (!ids.length) {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = undefined;
    renderTaskCenter();
    pollingJobs = false;
    if (pollAgainAfterCurrent) {
      pollAgainAfterCurrent = false;
      window.setTimeout(pollJobs, 80);
    }
    return;
  }
  await Promise.all(ids.map(async (jobId) => {
    try {
      const data = await api(`/.netlify/functions/get-report-job?jobId=${encodeURIComponent(jobId)}`);
      activeJobs[jobId] = mergeJobSnapshot(activeJobs[jobId] || loadJobSnapshot(jobId), data.job, jobId);
      saveJobSnapshot(jobId, activeJobs[jobId]);
    } catch (error: any) {
      const message = String(error?.message || "");
      if (/任务不存在|not found|404/i.test(message)) {
        forgetMissingJob(jobId);
        return;
      }
      const previous = activeJobs[jobId] || loadJobSnapshot(jobId) || {};
      activeJobs[jobId] = { ...previous, jobId, syncWarning: message || "任务状态暂时无法同步，系统会自动重试。", syncWarningAt: new Date().toISOString() };
      saveJobSnapshot(jobId, activeJobs[jobId]);
      return;
    }
  }));
  renderTaskCenter();
  pollingJobs = false;
  if (pollAgainAfterCurrent) {
    pollAgainAfterCurrent = false;
    window.setTimeout(pollJobs, 80);
  }
}

function startPolling() {
  pollJobs();
  if (!pollTimer) pollTimer = window.setInterval(pollJobs, 3500);
}

function reportFiltersHtml() {
  return `
    <section class="workspace-section">
      <div class="section-title compact-title">
        <h2>报告</h2>
        <p>按目标客户和我的企业保存，打开后可继续追加拜访反馈。</p>
      </div>
      <div class="report-filter-bar">
        <div class="history-search primary-search">
          <input id="historyInput" placeholder="搜索客户、我方企业、行业、地区或关键词" />
          <button id="historyButton" class="square-button" aria-label="搜索" type="button">${icon("Search")}</button>
        </div>
        <div class="history-search compact-filters">
          <select id="historyProfile">${profileOptions(true)}</select>
          <select id="historyPeriod"><option value="7d">近7天</option><option value="30d" selected>近30天</option><option value="90d">近90天</option><option value="all">全部</option></select>
          <select id="historyRating"><option value="all">全部评级</option><option value="A">A 级</option><option value="B">B 级</option><option value="C">C 级</option><option value="D">D 级</option><option value="not_rated">暂不评级</option></select>
        </div>
      </div>
      <div id="historyArea" class="history-area"></div>
    </section>`;
}

function renderReports() {
  const root = document.querySelector("#reportsTab");
  if (!root) return;
  root.innerHTML = reportFiltersHtml();
  document.querySelector("#historyButton")?.addEventListener("click", loadReports);
  document.querySelector("#historyPeriod")?.addEventListener("change", loadReports);
  document.querySelector("#historyRating")?.addEventListener("change", loadReports);
  document.querySelector("#historyProfile")?.addEventListener("change", loadReports);
  document.querySelector("#historyInput")?.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter") loadReports();
  });
  loadReports();
  refreshIcons();
}

async function loadReports() {
  const q = (document.querySelector<HTMLInputElement>("#historyInput")?.value || "").trim();
  const period = (document.querySelector<HTMLSelectElement>("#historyPeriod")?.value || "30d").trim();
  const rating = (document.querySelector<HTMLSelectElement>("#historyRating")?.value || "all").trim();
  const profileId = (document.querySelector<HTMLSelectElement>("#historyProfile")?.value || "all").trim();
  const data = await api(`/.netlify/functions/search-reports?q=${encodeURIComponent(q)}&period=${encodeURIComponent(period)}&rating=${encodeURIComponent(rating)}&profileId=${encodeURIComponent(profileId)}`);
  reportRows = arr(data.reports);
  renderReportRows();
}

function renderReportRows() {
  const root = document.querySelector("#historyArea");
  if (!root) return;
  if (!reportRows.length) {
    root.innerHTML = `<div class="empty">当前条件下暂无报告。</div>`;
    return;
  }
  root.innerHTML = `<div class="report-list">${reportRows.slice(0, PAGE_SIZE * 4).map(reportCard).join("")}</div>`;
  root.querySelectorAll("[data-report]").forEach((button) => {
    button.addEventListener("click", () => openReport((button as HTMLElement).dataset.report || ""));
  });
  root.querySelectorAll("[data-delete-report]").forEach((button) => {
    button.addEventListener("click", () => deleteReport((button as HTMLElement).dataset.deleteReport || "", (button as HTMLElement).dataset.deleteName || "这份报告"));
  });
  refreshIcons();
}

function ratingText(report: any) {
  const rating = report.opportunityRating || {};
  return rating.status === "rated" ? `${rating.grade || "-"}级｜${rating.priorityLevel || rating.label || "待判断"}｜${rating.score || "-"}分` : "暂不评级";
}

function reportCard(report: any) {
  const rating = ratingText(report);
  const gradeClass = String(report.opportunityRating?.grade || "not-rated").toLowerCase().replace(/[^a-z0-9]/g, "") || "not-rated";
  return `
    <article class="history-card">
      <em class="rating-corner rating-${gradeClass}">${escapeHtml(rating)}</em>
      <div class="history-main">
        <b>${escapeHtml(report.targetCompanyName || report.standardName || report.companyName)}</b>
        <span>${escapeHtml(report.sellerProfileName || "未绑定我的企业")}</span>
        <p>${escapeHtml(report.qualityLabel || report.qualityText || "报告")}｜来源 ${escapeHtml(report.verifiedSourceCount ?? report.sourceCount ?? "-")} 条｜第 ${escapeHtml(report.activeRoundNo || report.roundCount || 1)} 轮</p>
      </div>
      <div class="history-side">
        <small>${escapeHtml(fmtTime(report.generatedAt))}</small>
        <div class="row-actions">
          <button data-report="${escapeHtml(report.reportId)}" class="mini" type="button">${icon("FileText")}打开</button>
          <button class="danger ghost mini icon-only" data-delete-report="${escapeHtml(report.reportId)}" data-delete-name="${escapeHtml(report.standardName || report.companyName || "这份报告")}" aria-label="删除报告" type="button">${icon("Trash2")}</button>
        </div>
      </div>
    </article>`;
}

async function deleteReport(reportId: string, name: string) {
  if (!reportId || !window.confirm(`确认删除“${name}”吗？`)) return;
  await api("/.netlify/functions/delete-report", { method: "POST", body: JSON.stringify({ reportId }) });
  await loadReports();
}

function renderProfiles() {
  const root = document.querySelector("#profilesTab");
  if (!root) return;
  const profile = selectedProfile();
  root.innerHTML = `
    <section class="workspace-section">
      <div class="section-title">
        <h2>我的企业</h2>
        <p>先核对企业主体，再生成主营业务和核心产品初稿。</p>
      </div>
      <div class="profile-manager">
        <aside class="profile-list">
          <section class="profile-auth-card">
            <div class="profile-auth-head">
              <div>
                <b>我的授权</b>
                <span>${escapeHtml(licenseStatusText())}</span>
              </div>
              <button id="refreshLicensePanel" class="ghost" type="button">${icon("RefreshCw")}刷新</button>
            </div>
            ${licenseUsageCompactHtml()}
            <button id="logoutButton" class="logout-inline" type="button">${icon("LogOut")}退出登录</button>
          </section>
          ${aboutOacHtml()}
          <div class="add-profile">
            <input id="newProfileName" placeholder="输入我方企业名，例如：智用开物" />
            <button id="createProfileButton" class="primary" type="button">${icon("SearchCheck")}核对企业</button>
          </div>
          ${profileStatus ? `<div class="notice">${escapeHtml(profileStatus)}</div>` : ""}
          ${profileCandidates.length ? `<div class="profile-candidates">
            <b>请选择我的企业主体</b>
            ${profileCandidates.map((candidate, index) => {
              const verification = candidateVerification(candidate);
              const baseInfo = [
                verification.verified ? "天眼查核验" : "网页候选",
                verification.creditCode ? `统一社会信用代码 ${verification.creditCode}` : "",
                candidate.confidence ? `${candidate.confidence}分` : "",
                candidate.sourcesMerged ? `${candidate.sourcesMerged}个来源合并` : ""
              ].filter(Boolean).join("｜");
              return `<button type="button" data-profile-candidate="${index}" class="${verification.verified ? "verified-profile-candidate" : ""}">
                <span>${verification.verified ? icon("ShieldCheck") : ""}${escapeHtml(candidate.standardName || candidate.name)}</span>
                <small>${escapeHtml(baseInfo || "候选主体")}</small>
              </button>`;
            }).join("")}
          </div>` : ""}
          ${profiles.length ? profiles.map((item) => `<button class="profile-tab ${item.profileId === selectedProfileId ? "active" : ""}" data-profile="${escapeHtml(item.profileId)}" type="button"><b>${escapeHtml(item.companyName)}</b><span>${escapeHtml(item.mainBusiness || item.summary || "点击编辑我的企业")}</span>${profileReady(item) ? "" : `<small>待补：主营业务 / 核心产品</small>`}</button>`).join("") : `<div class="empty">暂无我的企业。请先新增。</div>`}
        </aside>
        <section class="profile-editor">${profile ? profileEditor(profile) : `<div class="empty">请选择或新增一个我的企业。</div>`}</section>
      </div>
    </section>`;
  root.querySelector("#createProfileButton")?.addEventListener("click", createProfile);
  root.querySelector("#newProfileName")?.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Enter") {
      event.preventDefault();
      createProfile();
    }
  });
  root.querySelector("#refreshLicensePanel")?.addEventListener("click", async () => {
    await refreshAuthMeQuiet();
    renderProfiles();
  });
  root.querySelector("#logoutButton")?.addEventListener("click", () => {
    clearAuth();
    renderAuthGate("已退出，请重新输入授权码。");
  });
  root.querySelectorAll("[data-profile-candidate]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number((button as HTMLElement).dataset.profileCandidate);
      const candidate = profileCandidates[index];
      createProfileFromCandidate(candidate);
    });
  });
  root.querySelectorAll("[data-profile]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedProfileId = (button as HTMLElement).dataset.profile || "";
      localStorage.setItem(LS_PROFILE, selectedProfileId);
      renderProfiles();
      renderCreateTask();
    });
  });
  root.querySelector("#saveProfile")?.addEventListener("click", saveProfile);
  root.querySelector("#deleteProfile")?.addEventListener("click", deleteProfile);
  refreshIcons();
}

function licenseUsageCompactHtml() {
  const detail = licenseQuotaDetails();
  return `
    <div class="profile-auth-grid">
      <span><small>剩余</small><b>${escapeHtml(detail.remainingText)}</b></span>
      <span><small>已用/总量</small><b>${escapeHtml(detail.usedText)} / ${escapeHtml(detail.totalText)}</b></span>
      <span><small>设备</small><b>${escapeHtml(detail.deviceText)}</b></span>
      <span><small>到期</small><b>${escapeHtml(detail.expiresText)}</b></span>
    </div>
    <p>生成首轮报告或新增一轮拜访分析成功后扣 1 次；查看历史报告不扣次数。</p>`;
}

function aboutOacHtml() {
  const history = APP_RELEASE_HISTORY.slice(1);
  return `
    <section class="profile-version-card" aria-label="关于 OAC">
      <div class="profile-version-head">
        <span>${icon("Sparkles")}</span>
        <div>
          <b>关于 ${PRODUCT_ACRONYM}</b>
          <small>版本 ${escapeHtml(APP_VERSION)}｜更新 ${escapeHtml(APP_UPDATED_AT)}</small>
        </div>
      </div>
      <p>${escapeHtml(APP_RELEASE_TITLE)}</p>
      <details open>
        <summary>${icon("ListChecks")}本版修复</summary>
        <ul>
          ${APP_RELEASE_NOTES.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </details>
      ${
        history.length
          ? `<details class="profile-version-history">
              <summary>${icon("Clock3")}查看更多更新历史</summary>
              <div class="profile-version-history-list">
                ${history
                  .map(
                    (release) => `<article>
                      <div>
                        <b>${escapeHtml(release.version)}</b>
                        <small>${escapeHtml(release.date)}</small>
                      </div>
                      <strong>${escapeHtml(release.title)}</strong>
                      <ul>
                        ${(release.notes || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
                      </ul>
                    </article>`
                  )
                  .join("")}
              </div>
            </details>`
          : ""
      }
    </section>`;
}

function profileEditor(profile: any) {
  return `
    <div class="editor-grid">
      <label><b>我方企业名称</b><input id="profileCompanyName" value="${escapeHtml(profile.companyName)}" /></label>
      <label class="full"><b>主营业务</b><textarea id="profileMainBusiness" rows="2" placeholder="一句话说明公司主要做什么">${escapeHtml(profile.mainBusiness || profile.summary)}</textarea></label>
      <label class="full"><b>核心产品/服务</b><textarea id="profileCoreProducts" placeholder="每行一个。例：AI智能体平台、知识库、智能排产">${escapeHtml(joinList(profile.coreProducts || profile.coreOfferings))}</textarea></label>
      <details class="profile-keywords full"><summary>可选关键词</summary><textarea id="profileKeywords" rows="2" placeholder="用于匹配客户需求，可不填；系统会先按主营业务和核心产品判断">${escapeHtml(joinList(profile.keywords))}</textarea></details>
    </div>
    <div class="actions">
      <button id="saveProfile" class="primary" type="button">${icon("CircleCheck")}保存我的企业</button>
      <button id="deleteProfile" class="danger ghost" type="button">${icon("Trash2")}删除</button>
    </div>`;
}

async function createProfile() {
  const input = document.querySelector<HTMLInputElement>("#newProfileName");
  const name = (input?.value || "").trim();
  if (!name) return window.alert("请输入我方企业名称");
  const button = document.querySelector<HTMLButtonElement>("#createProfileButton");
  if (button) button.disabled = true;
  try {
    profileStatus = "正在核对企业主体，请选择最准确的一项。";
    renderProfiles();
    const data = await api("/.netlify/functions/resolve-company", {
      method: "POST",
      body: JSON.stringify({ query: name, region: "", industry: "", aiNeeds: "用于创建我的企业资料，请优先识别企业主体、主营业务和核心产品。" })
    });
    profileCandidates = dedupeCompanyCandidates(data.candidates).slice(0, 5);
    profileStatus = tianyanchaDiagnosticNotice(data.tianyanchaDiagnostic) || "企业主体已核对，请选择最准确的一项。";
    if (!profileCandidates.length) {
      await createProfileFromCandidate({ name, standardName: name });
      return;
    }
    renderProfiles();
  } catch (error: any) {
    window.alert(`核对失败：${error.message}`);
  } finally {
    if (button) button.disabled = false;
  }
}

async function createProfileFromCandidate(candidate: any) {
  const value = String(candidate?.standardName || candidate?.name || "").trim();
  if (!value) return;
  const button = document.querySelector<HTMLButtonElement>("#createProfileButton");
  if (button) button.disabled = true;
  profileStatus = "正在生成我的企业初稿。";
  renderProfiles();
  try {
    const data = await api("/.netlify/functions/create-profile", { method: "POST", body: JSON.stringify({ companyName: value, candidate }) });
    profiles = [data.profile, ...profiles.filter((item) => item.profileId !== data.profile.profileId)];
    selectedProfileId = data.profile.profileId;
    profileCandidates = [];
    profileStatus = `已保存我的企业：${data.profile.companyName}。请核对主营业务和核心产品。`;
    localStorage.setItem(LS_PROFILE, selectedProfileId);
    renderProfiles();
    renderCreateTask();
    renderReports();
  } catch (error: any) {
    profileStatus = "";
    window.alert(`创建失败：${error.message}`);
    renderProfiles();
  } finally {
    if (button) button.disabled = false;
  }
}

function readProfileForm(profile: any) {
  return {
    profileId: profile.profileId,
    companyName: (document.querySelector<HTMLInputElement>("#profileCompanyName")?.value || "").trim(),
    mainBusiness: (document.querySelector<HTMLTextAreaElement>("#profileMainBusiness")?.value || "").trim(),
    summary: (document.querySelector<HTMLTextAreaElement>("#profileMainBusiness")?.value || "").trim(),
    coreProducts: parseList((document.querySelector<HTMLTextAreaElement>("#profileCoreProducts")?.value || "")),
    coreOfferings: parseList((document.querySelector<HTMLTextAreaElement>("#profileCoreProducts")?.value || "")),
    targetCustomers: [],
    typicalScenarios: [],
    strengths: [],
    deliveryBoundaries: [],
    noCommitments: [],
    keywords: parseList((document.querySelector<HTMLTextAreaElement>("#profileKeywords")?.value || ""))
  };
}

async function saveProfile() {
  const profile = selectedProfile();
  if (!profile) return;
  const data = await api("/.netlify/functions/update-profile", { method: "POST", body: JSON.stringify({ profile: readProfileForm(profile) }) });
  profiles = profiles.map((item) => (item.profileId === data.profile.profileId ? data.profile : item));
  profileStatus = `已保存我的企业：${data.profile.companyName}`;
  renderProfiles();
  renderCreateTask();
  renderReports();
}

async function deleteProfile() {
  const profile = selectedProfile();
  if (!profile || !window.confirm(`确认删除“${profile.companyName}”吗？已生成报告会保留当时企业信息快照。`)) return;
  await api("/.netlify/functions/delete-profile", { method: "POST", body: JSON.stringify({ profileId: profile.profileId }) });
  profiles = profiles.filter((item) => item.profileId !== profile.profileId);
  selectedProfileId = "";
  localStorage.removeItem(LS_PROFILE);
  renderProfiles();
  renderCreateTask();
  renderReports();
}

function reportUrl(reportId: string) {
  const mode = modePrefix();
  const prefix = mode === "china" ? "/cn" : mode === "international" ? "/intl" : "";
  return `${window.location.origin}${prefix}/?reportId=${encodeURIComponent(reportId)}`;
}

function openReport(reportId: string) {
  if (!reportId) return;
  window.history.pushState({}, "", reportUrl(reportId));
  renderReportView(reportId);
}

function closeReportView(targetTab = "reports") {
  const mode = modePrefix();
  const prefix = mode === "china" ? "/cn/" : mode === "international" ? "/intl/" : "/";
  window.history.pushState({}, "", prefix);
  localStorage.setItem(LS_STARTED, "1");
  localStorage.setItem(LS_TAB, targetTab);
  renderApp();
}

async function renderReportView(reportId: string) {
  app.innerHTML = `
    <main class="app-shell report-view-shell">
      <section class="report-topbar">
        <div class="report-nav">
          <button id="closeReport" class="back-link" type="button">${icon("ChevronLeft")}报告</button>
          <span id="reportSubtitle">正在读取报告...</span>
        </div>
        <div class="actions">
          <button id="refreshReport" class="ghost" type="button">${icon("RefreshCw")}刷新</button>
          <button id="downloadHtml" class="ghost" type="button">${icon("Download")}下载</button>
        </div>
      </section>
      <section id="reportFrameArea" class="report-frame-area"><div class="empty">报告加载中...</div></section>
      <section id="roundArea" class="workspace-section round-input-panel"></section>
      ${bottomTabNav("reports")}
    </main>`;
  refreshIcons();
  document.querySelector("#closeReport")?.addEventListener("click", () => closeReportView("reports"));
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => closeReportView((button as HTMLElement).dataset.tab || "reports"));
  });
  try {
    const data = await api(`/.netlify/functions/get-report?reportId=${encodeURIComponent(reportId)}`);
    const report = data.report || {};
    reportHtml = data.html || "";
    const subtitle = document.querySelector("#reportSubtitle");
    if (subtitle) subtitle.textContent = `${report.targetCompanyName || report.standardName}｜${report.sellerProfileName || "未绑定我的企业"}｜${ratingText(report)}`;
    mountReportFrame(reportHtml);
    renderRoundInput(reportId, report);
    document.querySelector("#downloadHtml")?.addEventListener("click", () => {
      const blob = new Blob([reportHtml], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${report.standardName || "商机报告"}.html`;
      a.click();
      URL.revokeObjectURL(url);
    });
    document.querySelector("#refreshReport")?.addEventListener("click", () => refreshReport(report));
  } catch (error: any) {
    const frameArea = document.querySelector("#reportFrameArea");
    if (frameArea) frameArea.innerHTML = `<div class="empty">报告打开失败：${escapeHtml(error.message)}</div>`;
  }
  refreshIcons();
}

async function refreshReport(report: any) {
  const targetName = report.targetCompanyName || report.standardName || report.companyName || "";
  const profileId = report.sellerProfileId || selectedProfileId || "";
  const profileName = report.sellerProfileName || selectedProfile()?.companyName || "";
  if (!targetName) {
    window.alert("当前报告缺少目标客户信息，无法刷新。");
    return;
  }
  if (!profileId) {
    window.alert("当前报告未绑定我的企业。请先选择我的企业后重新创建任务。");
    return;
  }
  if (!window.confirm(`确认刷新“${targetName}”吗？系统会重新检索并生成新报告，可能消耗搜索和模型额度。`)) return;
  const button = document.querySelector<HTMLButtonElement>("#refreshReport");
  if (button) {
    button.disabled = true;
    button.innerHTML = `${icon("RefreshCw")}创建中`;
    refreshIcons();
  }
  try {
    const company = {
      standardName: targetName,
      name: targetName,
      query: targetName,
      region: report.region || "",
      industry: report.industry || "",
      aiNeeds: report.aiNeeds || report.userContext?.aiNeeds || "",
      sellerProfileId: profileId,
      sellerProfileName: profileName,
      sellerProfileSnapshot: report.sellerProfileSnapshot || selectedProfile()
    };
    const data = await api("/.netlify/functions/create-report-job", {
      method: "POST",
      body: JSON.stringify({ company, profileId, force: true, runtimeMode: modePrefix() })
    });
    activeJobs[data.jobId] = mergeJobSnapshot(
      activeJobs[data.jobId],
      data.job || {
        company,
        targetCompanyName: targetName,
        standardName: targetName,
        companyName: targetName,
        sellerProfileId: profileId,
        sellerProfileName: profileName,
        sellerProfileSnapshot: report.sellerProfileSnapshot || selectedProfile(),
        status: "queued",
        progress: 10,
        phaseKey: "resolve",
        stage: "企业核对完成",
        detail: "已选择企业主体，等待启动深度检索。"
      },
      data.jobId
    );
    saveJobSnapshot(data.jobId, activeJobs[data.jobId]);
    rememberJob(data.jobId);
    await fetch("/.netlify/functions/run-report-job-background", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: data.jobId })
    });
    taskCenterView = "running";
    closeReportView("tasks");
    startPolling();
  } catch (error: any) {
    window.alert(`刷新失败：${error.message}`);
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = `${icon("RefreshCw")}刷新`;
      refreshIcons();
    }
  }
}

function renderRoundInput(reportId: string, report: any) {
  const root = document.querySelector("#roundArea");
  if (!root) return;
  const roundCount = arr(report.rounds).length || 1;
  root.innerHTML = `
    <details class="round-followup-card">
      <summary>${icon("MessageSquarePlus")}拜访后继续分析</summary>
      <div class="section-title">
        <div><h2>生成第 ${roundCount + 1} 轮判断</h2><p>拜访后再用：粘贴会议纪要、录音转文字或聊天记录，系统会更新评级、方案、问题清单和内部注意事项。</p></div>
      </div>
      <div class="round-input-grid">
        <textarea id="roundInputText" rows="5" placeholder="粘贴会议纪要、客户反馈、录音转文字或新的线索。"></textarea>
        <div class="round-actions">
          <label class="file-chip">${icon("Paperclip")}上传文字附件<input id="roundInputFile" type="file" accept=".txt,.md,.csv,.log,text/*" /></label>
          <button id="addRoundButton" class="primary" type="button">${icon("RefreshCw")}生成下一轮分析</button>
          <small id="roundInputStatus">支持 txt/md/csv 等文字附件；不会重新全网检索，只基于原报告摘要、证据和新增反馈做下一轮判断。</small>
        </div>
      </div>
    </details>`;
  root.querySelector("#addRoundButton")?.addEventListener("click", () => queueReportRoundJob(reportId));
  refreshIcons();
}

function mountReportFrame(html: string) {
  const frameArea = document.querySelector("#reportFrameArea");
  if (!frameArea) return;
  frameArea.innerHTML = `<iframe class="report-frame" scrolling="no" srcdoc="${escapeHtml(html)}"></iframe>`;
  const frame = frameArea.querySelector<HTMLIFrameElement>("iframe.report-frame");
  let listenersBound = false;
  const resize = () => {
    try {
      const doc = frame?.contentDocument;
      const height = Math.max(
        doc?.documentElement?.scrollHeight || 0,
        doc?.body?.scrollHeight || 0,
        Math.floor(window.innerHeight * 0.9)
      );
      if (frame && height) frame.style.height = `${height + 6}px`;
      if (doc && !listenersBound) {
        listenersBound = true;
        const delayedResize = () => {
          window.setTimeout(resize, 80);
          window.setTimeout(resize, 260);
        };
        doc.addEventListener("toggle", delayedResize, true);
      }
    } catch {
      // If the browser blocks measurement, keep the CSS min-height fallback.
    }
  };
  frame?.addEventListener("load", resize);
  window.setTimeout(resize, 120);
  window.setTimeout(resize, 600);
}

async function queueReportRoundJob(reportId: string) {
  const input = (document.querySelector<HTMLTextAreaElement>("#roundInputText")?.value || "").trim();
  const status = document.querySelector("#roundInputStatus");
  const button = document.querySelector<HTMLButtonElement>("#addRoundButton");
  let attachmentText = "";
  const file = (document.querySelector<HTMLInputElement>("#roundInputFile")?.files || [])[0];
  if (file) {
    try {
      attachmentText = await file.text();
    } catch {
      attachmentText = "";
    }
  }
  const finalInput = [input, attachmentText ? `附件《${file?.name || "文字附件"}》内容：\n${attachmentText}` : ""].filter(Boolean).join("\n\n");
  if (!finalInput.trim()) {
    if (status) status.textContent = "请先粘贴会议纪要或客户反馈。";
    return;
  }
  if (button) button.disabled = true;
  if (status) status.textContent = "已提交下一轮判断，正在创建后台任务...";
  try {
    const data = await api("/.netlify/functions/create-report-round-job", {
      method: "POST",
      body: JSON.stringify({ reportId, inputText: finalInput })
    });
    activeJobs[data.jobId] = mergeJobSnapshot(activeJobs[data.jobId], data.job || {}, data.jobId);
    saveJobSnapshot(data.jobId, activeJobs[data.jobId]);
    rememberJob(data.jobId);
    await fetch("/.netlify/functions/run-report-round-job-background", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: data.jobId })
    });
    if (status) status.textContent = "下一轮判断已进入任务中心。你可以关闭页面，完成后再打开报告。";
    taskCenterView = "running";
    closeReportView("tasks");
    startPolling();
  } catch (error: any) {
    if (status) status.textContent = `生成失败：${error.message}`;
  } finally {
    if (button) button.disabled = false;
  }
}

async function addReportRound(reportId: string) {
  const input = (document.querySelector<HTMLTextAreaElement>("#roundInputText")?.value || "").trim();
  const status = document.querySelector("#roundInputStatus");
  const button = document.querySelector<HTMLButtonElement>("#addRoundButton");
  let attachmentText = "";
  const file = (document.querySelector<HTMLInputElement>("#roundInputFile")?.files || [])[0];
  if (file) {
    try {
      attachmentText = await file.text();
    } catch {
      attachmentText = "";
    }
  }
  const finalInput = [input, attachmentText ? `附件《${file?.name || "文字附件"}》内容：\n${attachmentText}` : ""].filter(Boolean).join("\n\n");
  if (!finalInput.trim()) {
    if (status) status.textContent = "请先粘贴会议纪要或客户反馈。";
    return;
  }
  if (button) button.disabled = true;
  if (status) status.textContent = "正在生成下一轮判断...";
  try {
    const data = await api("/.netlify/functions/add-report-round", {
      method: "POST",
      body: JSON.stringify({ reportId, inputText: finalInput })
    });
    reportHtml = data.html || "";
    mountReportFrame(reportHtml);
    renderRoundInput(reportId, data.report);
    const subtitle = document.querySelector("#reportSubtitle");
    if (subtitle && data.report) subtitle.textContent = `${data.report.targetCompanyName || data.report.standardName}｜${data.report.sellerProfileName || "未绑定我的企业"}｜${ratingText(data.report)}`;
  } catch (error: any) {
    if (status) status.textContent = `生成失败：${error.message}`;
  } finally {
    if (button) button.disabled = false;
  }
}

async function bootstrap() {
  if (isAdminRoute()) {
    renderAdminPageClean();
    return;
  }
  try {
    const ok = await loadAuth();
    if (!ok) {
      renderAuthGate();
      return;
    }
  } catch (error: any) {
    clearAuth();
    authError = error.message || "授权已失效，请重新输入授权码";
    renderAuthGate(authError);
    return;
  }
  try {
    await loadProfiles();
  } catch {
    profiles = [];
  }
  renderApp();
}

bootstrap();
