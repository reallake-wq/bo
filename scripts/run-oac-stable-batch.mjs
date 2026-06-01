import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.resolve(root, "..");
const baseUrl = (process.env.OAC_BATCH_BASE_URL || "https://oac.muyang.chat").replace(/\/+$/, "");
const tenantId = process.env.OAC_BATCH_TENANT_ID || "oac-scenario-zhiyong-hollykube";
const tenantName = process.env.OAC_BATCH_TENANT_NAME || "智用企业端";
const deviceId = process.env.OAC_BATCH_DEVICE_ID || "stable-batch-device";
const userId = process.env.OAC_BATCH_USER_ID || "stable-batch-user";

const sellerProfileSeed = {
  companyName: "广州智用开物",
  mainBusiness: "面向企业客户提供企业智能体平台，包括智能体基础平台和上层应用定制。",
  summary: "面向企业客户提供企业智能体平台，包括智能体基础平台和上层应用定制。",
  coreProducts: [
    "企业智能体基础平台",
    "企业智能体上层应用定制",
    "企业知识库与数据问答",
    "业务流程智能化改造"
  ],
  coreOfferings: [
    "企业智能体基础平台",
    "企业智能体上层应用定制",
    "企业知识库与数据问答",
    "业务流程智能化改造"
  ],
  keywords: ["企业智能体", "Agentic AI", "智能体平台", "知识库", "数据问答", "应用定制"]
};

const targets = [
  {
    slug: "jinghua",
    query: "宁波精华电子科技股份有限公司",
    expectedNameKey: "精华电子",
    region: "宁波",
    industry: "汽车电子零部件",
    stockCode: "833707",
    sourceUrls: [
      "https://www.jinghuacn.net/",
      "https://www.jinghuacn.net/ScheduleReports",
      "https://stock.finance.sina.com.cn/thirdmarket/view/OTC_gsjs.php?symbol=833707"
    ],
    aiNeeds:
      "从广州智用开物的业务视角，判断该客户对企业智能体基础平台、知识库与数据问答、质量/研发/供应链流程智能化应用定制的机会。已确认新三板挂牌/定期报告线索：证券代码833707，官网投资者关系披露2025年年度报告。若采购、预算、竞品没有硬证据，必须写无有效判断；可用财务与荣誉作推测信息，但必须标注。"
  },
  {
    slug: "cbnb",
    query: "中基宁波集团股份有限公司",
    expectedNameKey: "中基宁波",
    region: "宁波",
    industry: "供应链服务与外贸综合服务",
    stockCode: "",
    sourceUrls: [
      "https://www.cbnb.com.cn/cn/about",
      "https://www.cbnb.com.cn/cn/gqhg"
    ],
    aiNeeds:
      "从广州智用开物的业务视角，判断该客户在大宗商品产业链运营、外贸综合服务、跨境服务、汽车销售及后市场场景下，对企业智能体平台、知识库问答、流程自动化与经营数据助手的机会。该主体未确认常规A股/港股上市年报；已掌握官网披露的2025年营收、进出口规模和荣誉，应作为经营能力线索，不得伪造上市公司口径。"
  },
  {
    slug: "borgwarner",
    query: "宁波博格华纳",
    standardName: "博格华纳汽车零部件（宁波）有限公司",
    expectedNameKey: "博格华纳",
    region: "宁波",
    industry: "汽车零部件制造与研发",
    stockCode: "",
    sourceUrls: [
      "https://www.borgwarner.com/newsroom/press-releases/2018/03/15/borgwarner-celebrates-opening-of-new-emissions-thermal-systems-state-of-the-art-design-and-manufacturing-facility-in-ningbo",
      "https://www.borgwarner.com/newsroom/press-releases/2026/02/11/borgwarner-reports-2025-results-and-provides-2026-guidance--returned-approximately--630-million-to-shareholders-in-2025--strategically-enters-data-center-market-with-turbine-generator-system-award",
      "https://www.borgwarner.com/docs/default-source/press-release-downloads/%E5%8D%9A%E6%A0%BC%E5%8D%8E%E7%BA%B3%E5%AE%81%E6%B3%A2%E5%9B%AD%E5%8C%BA%E6%88%90%E7%AB%8B%E4%BA%8C%E5%8D%81%E5%91%A8%E5%B9%B4-%E6%B7%B1%E8%80%95%E5%8A%A8%E5%8A%9B%E6%8A%80%E6%9C%AF-%E9%A9%B1%E5%8A%A8%E5%88%9B%E6%96%B0%E6%9C%AA%E6%9D%A5.pdf?sfvrsn=d2dba03d_1"
    ],
    aiNeeds:
      "从广州智用开物的业务视角，判断博格华纳宁波园区在涡轮增压、链传动、热管理、工程中心、质量与供应链协同场景下，对企业智能体平台、知识库问答、工程/制造/质量流程助手的机会。该宁波主体本身未确认独立上市年报；母公司BorgWarner Inc.为NYSE:BWA上市公司并披露2025业绩，引用时必须区分母公司财务与宁波园区经营事实。"
  }
];

function loadEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function mask(value = "") {
  const text = String(value || "");
  if (text.length <= 8) return "***";
  return `${text.slice(0, 4)}***${text.slice(-4)}`;
}

function adminHeaders() {
  const secret = process.env.ADMIN_SECRET || "";
  if (!secret) throw new Error("ADMIN_SECRET is not configured.");
  return { "x-admin-secret": secret };
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

async function api(pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Non-JSON response from ${pathName}: ${text.slice(0, 220)}`);
  }
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || body?.message || `${pathName} failed with ${response.status}`);
  }
  return body;
}

function writeArtifact(name, value) {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2), "utf8");
  return file;
}

function exactProfilePayload(profile = {}) {
  return {
    ...profile,
    ...sellerProfileSeed,
    sourceCandidate: {
      ...(profile.sourceCandidate || {}),
      name: sellerProfileSeed.companyName,
      standardName: sellerProfileSeed.companyName,
      region: "广州",
      industry: "企业智能体平台"
    }
  };
}

async function ensureLicense() {
  const listed = await api("/.netlify/functions/admin-licenses", {
    method: "GET",
    headers: adminHeaders()
  });
  const existing = (listed.licenses || []).find((license) => license.tenantId === tenantId || license.tenantName === tenantName);
  if (!existing) {
    const created = await api("/.netlify/functions/admin-licenses", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        tenantName,
        tenantId,
        quotaTotal: Math.max(8, targets.length + 2),
        maxDevices: 3,
        createMasterKey: false
      })
    });
    return {
      license: created.license,
      licenseKey: created.licenseKey,
      action: "created"
    };
  }

  const quotaTotal = Number(existing.quotaTotal ?? 0);
  const quotaUsed = Number(existing.quotaUsed ?? 0);
  if (quotaTotal >= 0 && quotaTotal - quotaUsed < targets.length) {
    await api("/.netlify/functions/admin-licenses", {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({
        licenseId: existing.licenseId,
        patch: { quotaTotal: quotaUsed + targets.length + 2, status: "active", maxDevices: 3 }
      })
    });
  }

  const rotated = await api("/.netlify/functions/admin-licenses", {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ licenseId: existing.licenseId, action: "rotateKey" })
  });
  return {
    license: rotated.license,
    licenseKey: rotated.licenseKey,
    action: "rotated"
  };
}

async function loginWithLicense(licenseKey) {
  const login = await api("/.netlify/functions/auth-license-login", {
    method: "POST",
    body: JSON.stringify({
      licenseKey,
      userId,
      deviceId,
      deviceName: "OAC stable batch runner"
    })
  });
  if (!login.accessToken) throw new Error("Login did not return accessToken.");
  return login;
}

async function ensureProfile(token) {
  const listed = await api("/.netlify/functions/list-profiles", {
    headers: authHeaders(token)
  });
  let profile = (listed.profiles || []).find((item) => item.companyName === sellerProfileSeed.companyName);
  if (!profile) {
    const draft = await api("/.netlify/functions/create-profile", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        companyName: sellerProfileSeed.companyName,
        candidate: {
          name: sellerProfileSeed.companyName,
          standardName: sellerProfileSeed.companyName,
          region: "广州",
          industry: "企业智能体平台",
          confidence: 99,
          reason: "稳定批量验证指定的我方企业。"
        }
      })
    });
    profile = draft.profile;
  }
  const saved = await api("/.netlify/functions/update-profile", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ profile: exactProfilePayload(profile) })
  });
  return saved.profile;
}

async function triggerRun(jobId) {
  await api("/.netlify/functions/run-report-job-background", {
    method: "POST",
    body: JSON.stringify({ jobId })
  }).catch((error) => {
    const message = String(error?.message || "");
    if (!/Non-JSON response|Unexpected end/i.test(message)) throw error;
  });
}

async function pollJob(jobId, token) {
  const timeoutMs = Number(process.env.OAC_BATCH_TIMEOUT_MINUTES || "60") * 60 * 1000;
  const deadline = Date.now() + timeoutMs;
  let lastLine = "";
  while (Date.now() < deadline) {
    const payload = await api(`/.netlify/functions/get-report-job?jobId=${encodeURIComponent(jobId)}`, {
      headers: authHeaders(token)
    });
    const job = payload.job || {};
    const line = `${job.status || ""}|${job.progress || 0}|${job.stage || ""}|${job.detail || ""}`.slice(0, 260);
    if (line !== lastLine) {
      console.log(JSON.stringify({
        event: "progress",
        company: job.companyName || job.standardName || "",
        status: job.status,
        progress: job.progress,
        stage: job.stage,
        sourceCount: job.sourceCount,
        qualityLevel: job.qualityLevel,
        reportId: job.reportId || ""
      }));
      lastLine = line;
    }
    if (job.status === "done" && job.reportId) return job;
    if (["error", "cancelled"].includes(String(job.status || ""))) {
      throw new Error(`Report job failed: ${job.error || job.detail || job.status}`);
    }
    if (job.status === "needs_resume") await triggerRun(jobId);
    await new Promise((resolve) => setTimeout(resolve, 8000));
  }
  throw new Error(`Report job timed out: ${jobId}`);
}

function fallbackCandidate(target) {
  return {
    name: target.standardName || target.query,
    standardName: target.standardName || target.query,
    region: target.region,
    industry: target.industry,
    stockCode: target.stockCode,
    website: target.sourceUrls[0] || "",
    confidence: target.stockCode ? 92 : 80,
    reason: "按用户指定主体和事前核验来源建立候选主体。",
    sourceUrls: target.sourceUrls
  };
}

function resolvedCandidateLooksValid(candidate, target) {
  const name = String(candidate?.standardName || candidate?.name || "");
  return name && name.includes(target.expectedNameKey) && !/^(?:而|并|坐落|位于|注册地址|地址)/.test(name);
}

async function createReportForTarget(target, profile, token) {
  const resolved = await api("/.netlify/functions/resolve-company", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      query: target.standardName || target.query,
      region: target.region,
      industry: target.industry,
      aiNeeds: `${target.aiNeeds} ${target.stockCode ? `证券代码 ${target.stockCode}` : ""}`
    })
  });
  const candidate = (resolved.candidates || []).find((item) => resolvedCandidateLooksValid(item, target)) || fallbackCandidate(target);
  const company = {
    ...candidate,
    standardName: target.standardName || candidate.standardName || candidate.name || target.query,
    name: target.standardName || candidate.name || target.query,
    query: target.query,
    region: target.region,
    industry: target.industry,
    stockCode: target.stockCode || candidate.stockCode || "",
    website: candidate.website || target.sourceUrls[0] || "",
    sourceUrls: Array.from(new Set([...(candidate.sourceUrls || []), ...target.sourceUrls])),
    aiNeeds: target.aiNeeds,
    sellerProfileId: profile.profileId,
    sellerProfileName: profile.companyName,
    sellerProfileSnapshot: profile
  };

  const createdJob = await api("/.netlify/functions/create-report-job", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      profileId: profile.profileId,
      force: true,
      company
    })
  });
  if (!createdJob.jobId) throw new Error(`create-report-job did not return jobId for ${target.slug}`);
  console.log(JSON.stringify({
    event: "created",
    slug: target.slug,
    targetName: company.standardName || company.name,
    tianyanchaStatus: resolved.tianyanchaDiagnostic?.status || "",
    jobId: createdJob.jobId
  }));

  await triggerRun(createdJob.jobId);
  const finalJob = await pollJob(createdJob.jobId, token);
  const reportPayload = await api(`/.netlify/functions/get-report?reportId=${encodeURIComponent(finalJob.reportId)}`, {
    headers: authHeaders(token)
  });

  const report = reportPayload.report || {};
  const html = reportPayload.html || "";
  const reportFile = writeArtifact(`oac-stable-${target.slug}-report.json`, report);
  const previewFile = writeArtifact(`oac-stable-${target.slug}-preview.html`, html);
  const validation = validateReportHtml(html, report);
  return {
    slug: target.slug,
    targetName: report.targetCompanyName || report.standardName || company.standardName,
    reportId: finalJob.reportId,
    jobId: createdJob.jobId,
    reportUrl: `${baseUrl}/?reportId=${encodeURIComponent(finalJob.reportId)}`,
    qualityLevel: report.qualityLevel,
    qualityLabel: report.qualityLabel,
    verifiedSourceCount: report.verifiedSourceCount,
    readableSourceCount: report.readableSourceCount,
    sourceCount: report.sourceCount,
    reportFile,
    previewFile,
    validation,
    sourceInputs: target.sourceUrls
  };
}

function includesAny(text, values) {
  return values.some((value) => text.includes(value));
}

function countIncludes(text, value) {
  return text.split(value).length - 1;
}

function validateReportHtml(html, report) {
  const checks = {
    hasFiveTabs: ["企业画像", "商务分析", "方案分析", "交付分析", "行动指南"].every((item) => html.includes(item)),
    hasFinanceKpiBoard: html.includes("finance-kpi-board"),
    deliveryOnlyExpected: html.includes("SOW分解") && html.includes("风险与应对") && html.includes("前置依赖"),
    actionOnlyExpected: html.includes("现场问卷") && html.includes("重点关注事项"),
    hasRiskResponseGrid: html.includes("risk-response-fields"),
    hasDependencyGrid: html.includes("dependency-fields"),
    hasQuestionnaireGrid: html.includes("questionnaire-fields"),
    hasAttentionGrid: html.includes("attention-fields"),
    noOldActionScaffold: !includesAny(html, ["开场切入", "会后更新", "下一步动作", "推进节奏"]),
    noOldSowLabel: !html.includes("SOW工作拆分"),
    noGenericHeaderRisk: !includesAny(html, ["商机风险优先看财务/经营指标", "系统已通过官方/法院/信用平台"]),
    noDeliveryInstructionLeak: !includesAny(html, ["推进前要锁定", "IT接口人", "客户责任人", "现场联系人"]),
    noWeakWindowClaim: !(/(?:存在可跟进窗口|预算窗口来自)[^<\n]{0,180}(?:未明确|未确认|未证实|最佳切入点|融资服务)/.test(html)),
    noRatingLeftRule: html.includes("border-left:0!important"),
    enoughSources: Number(report.verifiedSourceCount || report.sourceCount || 0) >= 8,
    noDuplicateDeliverySections: countIncludes(html, "交付分析") <= 3,
    noDuplicateActionSections: countIncludes(html, "行动指南") <= 3
  };
  return {
    ...checks,
    ok: Object.values(checks).every(Boolean)
  };
}

async function main() {
  loadEnv();
  const health = await api("/.netlify/functions/health");
  const licenseResult = await ensureLicense();
  const login = await loginWithLicense(licenseResult.licenseKey);
  const profile = await ensureProfile(login.accessToken);
  const results = [];

  console.log(JSON.stringify({
    event: "ready",
    baseUrl,
    health: health.ok,
    licenseAction: licenseResult.action,
    licenseId: licenseResult.license?.licenseId,
    licenseKey: mask(licenseResult.licenseKey),
    tenantId: login.me?.tenantId,
    tenantName: login.me?.tenantName,
    profileId: profile.profileId,
    profileName: profile.companyName
  }));

  for (const target of targets) {
    results.push(await createReportForTarget(target, profile, login.accessToken));
  }

  const adminView = await api("/.netlify/functions/admin-licenses", {
    method: "GET",
    headers: adminHeaders()
  });
  const summary = {
    ok: results.every((item) => item.validation?.ok),
    baseUrl,
    generatedAt: new Date().toISOString(),
    tenantId: login.me?.tenantId,
    tenantName: login.me?.tenantName,
    licenseId: licenseResult.license?.licenseId,
    profileId: profile.profileId,
    profileName: profile.companyName,
    adminBoundProfiles: (adminView.licenses || [])
      .filter((license) => license.tenantId === tenantId)
      .flatMap((license) => license.boundProfiles || [])
      .map((item) => ({
        profileId: item.profileId,
        companyName: item.companyName,
        mainBusiness: item.mainBusiness,
        coreProducts: item.coreProducts
      })),
    results
  };
  const summaryFile = writeArtifact("oac-stable-batch-summary.json", summary);
  console.log(JSON.stringify({ ok: summary.ok, summaryFile, reports: results.map((item) => item.reportUrl) }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
