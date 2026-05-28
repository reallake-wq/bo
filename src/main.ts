// @ts-nocheck
import "./styles.css";
import { createIcons, icons } from "lucide";

const app = document.querySelector<HTMLDivElement>("#app")!;
const LS_STARTED = "nbBoV2Started";
const LS_TAB = "nbBoV2Tab";
const LS_PROFILE = "nbBoSelectedProfileId";
const LS_JOBS = "nbBoActiveJobIds";
const LS_DISMISSED = "nbBoDismissedJobIds";
const LS_JOB_SNAPSHOTS = "nbBoJobSnapshots";
const PAGE_SIZE = 12;
const PRODUCT_NAME_CN = "商机参谋团";
const PRODUCT_NAME_EN = "Opportunity Advisory Crew";
const PRODUCT_ACRONYM = "OAC";
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
let reportHtml = "";

function icon(name: string) {
  return `<i data-lucide="${escapeHtml(name)}" aria-hidden="true"></i>`;
}

function refreshIcons() {
  createIcons({ icons });
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
  const res = await fetch(withMode(url), {
    ...options,
    headers: options.body instanceof FormData ? options.headers : { "content-type": "application/json", ...(options.headers || {}) }
  });
  const payload = await res.json();
  if (!res.ok || payload.ok === false) throw new Error(payload.error || `请求失败：${res.status}`);
  return payload;
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

function saveJobSnapshot(jobId: string, job: any) {
  if (!jobId || !job) return;
  const snapshots = jobSnapshots();
  snapshots[jobId] = {
    ...(snapshots[jobId] || {}),
    jobId,
    jobIdentity: job.jobIdentity || snapshots[jobId]?.jobIdentity || null,
    company: job.company || snapshots[jobId]?.company || null,
    targetCompanyName: job.targetCompanyName || snapshots[jobId]?.targetCompanyName || "",
    standardName: job.standardName || snapshots[jobId]?.standardName || "",
    companyName: job.companyName || snapshots[jobId]?.companyName || "",
    sellerProfileId: job.sellerProfileId || snapshots[jobId]?.sellerProfileId || "",
    sellerProfileName: job.sellerProfileName || snapshots[jobId]?.sellerProfileName || "",
    sellerProfileSnapshot: job.sellerProfileSnapshot || snapshots[jobId]?.sellerProfileSnapshot || null,
    reportId: job.reportId || snapshots[jobId]?.reportId || "",
    status: job.status || snapshots[jobId]?.status || "",
    stage: job.stage || snapshots[jobId]?.stage || "",
    detail: job.detail || snapshots[jobId]?.detail || "",
    progress: job.progress ?? snapshots[jobId]?.progress ?? 0,
    phaseKey: job.phaseKey || snapshots[jobId]?.phaseKey || "",
    updatedAt: job.updatedAt || snapshots[jobId]?.updatedAt || ""
  };
  localStorage.setItem(LS_JOB_SNAPSHOTS, JSON.stringify(snapshots));
}

function firstText(...values: any[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function mergeJobSnapshot(previous: any = {}, incoming: any = {}, jobId = "") {
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
        <h2>会前 10 分钟，拿到一份能指导拜访的商机简报。</h2>
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
        <b>参谋分工</b>
        <span>不是一段泛泛总结，而是多人协作式的拜访准备。</span>
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
  const res = await fetch("/.netlify/functions/upload-annual-report", { method: "POST", body: form });
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
    renderCandidates(arr(data.candidates), arr(data.cached));
    setCreateStatus("");
  } catch (error: any) {
    setCreateStatus(`核对失败：${error.message}`, "error");
  }
}

function renderCandidates(candidates: any[], cached: any[]) {
  const root = document.querySelector("#candidateArea");
  if (!root) return;
  root.innerHTML = `
    <section class="candidate-panel ios-list-panel">
      <div class="list-section-title"><span>3</span><b>确认目标客户</b></div>
      ${cached.length ? `<div class="notice">已发现历史报告。若重新生成，将按“当前我方企业 + 目标客户”组合覆盖最新入口。</div>` : ""}
      <div class="candidate-grid compact-candidate-list">
        ${candidates.map((candidate, index) => `
          <article class="candidate-card">
            <div class="candidate-main">
              <b>${escapeHtml(candidate.standardName || candidate.name)}</b>
              <span>${escapeHtml([candidate.region, candidate.industry].filter(Boolean).join("｜") || "地区/行业待确认")}</span>
              <p>${escapeHtml(candidate.reason || "候选企业主体")}</p>
            </div>
            <div class="candidate-side">
              <small>${escapeHtml(candidate.confidence || "-")}分</small>
              <button data-candidate="${index}" class="primary mini" type="button">${icon("Sparkles")}生成</button>
            </div>
          </article>`).join("")}
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
    setTab("tasks");
    startPolling();
  } catch (error: any) {
    setCreateStatus(`任务创建失败：${error.message}`, "error");
  }
}

function jobStats(jobs: any[]) {
  return {
    running: jobs.filter((job) => ["queued", "running", "needs_resume"].includes(String(job.status || ""))).length,
    done: jobs.filter((job) => job.status === "done").length,
    error: jobs.filter((job) => ["error", "cancelled"].includes(String(job.status || ""))).length,
    total: jobs.length
  };
}

function renderTaskCenter() {
  const root = document.querySelector("#tasksTab");
  if (!root) return;
  const ids = activeJobIds();
  const jobs = ids.map((id) => activeJobs[id] || loadJobSnapshot(id) || { jobId: id, status: "queued", stage: "等待同步", progress: 0 });
  const stats = jobStats(jobs);
  root.innerHTML = `
    <section class="workspace-section">
      <div class="section-title compact-title">
        <h2>任务中心</h2>
        <p>参谋成员协同处理；任务中断会优先从断点自动续跑，完成后可打开报告或手动清除。</p>
      </div>
      <div class="task-summary-bar">
        <span>${icon("LoaderCircle")}处理 <b>${stats.running}</b></span>
        <span>${icon("CircleCheck")}完成 <b>${stats.done}</b></span>
        <span>${icon("TriangleAlert")}异常 <b>${stats.error}</b></span>
        <span>${icon("Layers3")}全部 <b>${stats.total}</b></span>
      </div>
      <div class="task-list">
        ${jobs.length ? jobs.map(taskCard).join("") : `<div class="empty-state compact-empty">暂无任务。创建后，参谋团会在这里显示每位成员正在做什么。</div>`}
      </div>
    </section>`;
  root.querySelectorAll("[data-open-report]").forEach((button) => {
    button.addEventListener("click", () => openReport((button as HTMLElement).dataset.openReport || ""));
  });
  root.querySelectorAll("[data-complete-task]").forEach((button) => {
    button.addEventListener("click", () => dismissJob((button as HTMLElement).dataset.completeTask || ""));
  });
  root.querySelectorAll("[data-cancel-task]").forEach((button) => {
    button.addEventListener("click", () => cancelJob((button as HTMLElement).dataset.cancelTask || ""));
  });
  refreshIcons();
}

function taskCard(job: any) {
  const running = ["queued", "running", "needs_resume"].includes(String(job.status || ""));
  const done = job.status === "done" && job.reportId;
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
      <div class="worker-line">
        <span class="worker-avatar">${escapeHtml(worker.name.slice(0, 1))}</span>
        <div><b>${escapeHtml(worker.name)} · ${escapeHtml(worker.role)}</b><small>${escapeHtml(workerVerb)}</small></div>
      </div>
      <div class="task-meta">
        <span>${icon("Layers3")}${escapeHtml(job.stage || "等待同步")}</span>
        <span>${icon("Timer")}已运行 ${fmtDuration(job.elapsedMs)}</span>
        <span>${icon("Link")}来源 ${escapeHtml(job.sourceCount ?? "-")}</span>
      </div>
      <p>${escapeHtml(job.detail || job.error || "任务正在后台处理。")}</p>
      ${searchQuotaWarning ? `<div class="task-warning">${icon("TriangleAlert")}Tavily 搜索额度可能已用完，请补充 Key 或等待额度恢复。</div>` : ""}
      <div class="actions">
        ${done ? `<button class="primary" data-open-report="${escapeHtml(job.reportId)}" type="button">${icon("FileText")}打开报告</button><button data-complete-task="${escapeHtml(job.jobId)}" type="button">${icon("CircleCheck")}确认清除</button>` : ""}
        ${running ? `<button class="danger ghost" data-cancel-task="${escapeHtml(job.jobId)}" type="button">${icon("OctagonX")}停止</button>` : ""}
        ${!running && !done ? `<button data-complete-task="${escapeHtml(job.jobId)}" type="button">${icon("CircleCheck")}清除</button>` : ""}
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
  try {
    const remote = await api("/.netlify/functions/list-report-jobs");
    const blocked = dismissedJobIdSet();
    const remoteJobs = Array.isArray(remote.jobs) ? remote.jobs : [];
    for (const job of remoteJobs) {
      if (!job?.jobId || blocked.has(job.jobId)) continue;
      activeJobs[job.jobId] = mergeJobSnapshot(activeJobs[job.jobId] || loadJobSnapshot(job.jobId), job, job.jobId);
      saveJobSnapshot(job.jobId, activeJobs[job.jobId]);
    }
    if (remoteJobs.length) saveActiveJobIds([...remoteJobs.map((job: any) => job.jobId), ...activeJobIds()]);
  } catch {
    // Keep local polling working if the cloud task list is temporarily unavailable.
  }

  const ids = activeJobIds();
  if (!ids.length) {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = undefined;
    renderTaskCenter();
    return;
  }
  await Promise.all(ids.map(async (jobId) => {
    try {
      const data = await api(`/.netlify/functions/get-report-job?jobId=${encodeURIComponent(jobId)}`);
      activeJobs[jobId] = mergeJobSnapshot(activeJobs[jobId] || loadJobSnapshot(jobId), data.job, jobId);
      saveJobSnapshot(jobId, activeJobs[jobId]);
    } catch (error: any) {
      if (/任务不存在/.test(String(error.message || ""))) {
        forgetMissingJob(jobId);
        return;
      }
      activeJobs[jobId] = { ...(activeJobs[jobId] || loadJobSnapshot(jobId) || {}), jobId, status: "running", stage: "状态同步失败", detail: error.message };
      saveJobSnapshot(jobId, activeJobs[jobId]);
    }
  }));
  renderTaskCenter();
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
          <div class="add-profile">
            <input id="newProfileName" placeholder="输入我方企业名，例如：智用开物" />
            <button id="createProfileButton" class="primary" type="button">${icon("SearchCheck")}核对企业</button>
          </div>
          ${profileStatus ? `<div class="notice">${escapeHtml(profileStatus)}</div>` : ""}
          ${profileCandidates.length ? `<div class="profile-candidates">
            <b>请选择我的企业主体</b>
            ${profileCandidates.map((candidate, index) => `<button type="button" data-profile-candidate="${index}">
              <span>${escapeHtml(candidate.standardName || candidate.name)}</span>
              <small>${escapeHtml([candidate.region, candidate.industry, candidate.confidence ? `${candidate.confidence}分` : "", candidate.sourcesMerged ? `${candidate.sourcesMerged}个来源合并` : ""].filter(Boolean).join("｜") || "候选主体")}</small>
            </button>`).join("")}
          </div>` : ""}
          ${profiles.length ? profiles.map((item) => `<button class="profile-tab ${item.profileId === selectedProfileId ? "active" : ""}" data-profile="${escapeHtml(item.profileId)}" type="button"><b>${escapeHtml(item.companyName)}</b><span>${escapeHtml(item.mainBusiness || item.summary || "点击编辑我的企业")}</span>${profileReady(item) ? "" : `<small>待补：主营业务 / 核心产品</small>`}</button>`).join("") : `<div class="empty">暂无我的企业。请先新增。</div>`}
        </aside>
        <section class="profile-editor">${profile ? profileEditor(profile) : `<div class="empty">请选择或新增一个我的企业。</div>`}</section>
      </div>
    </section>`;
  root.querySelector("#createProfileButton")?.addEventListener("click", createProfile);
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
    const data = await api("/.netlify/functions/resolve-company", {
      method: "POST",
      body: JSON.stringify({ query: name, region: "", industry: "", aiNeeds: "用于创建我的企业资料，请优先识别企业主体、主营业务和核心产品。" })
    });
    profileCandidates = dedupeCompanyCandidates(data.candidates).slice(0, 5);
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
  root.querySelector("#addRoundButton")?.addEventListener("click", () => addReportRound(reportId));
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
  try {
    await loadProfiles();
  } catch {
    profiles = [];
  }
  renderApp();
}

bootstrap();
