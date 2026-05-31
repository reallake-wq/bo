import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.resolve(root, "..");
const baseUrl = (process.env.OAC_SCENARIO_BASE_URL || "http://127.0.0.1:8888").replace(/\/+$/, "");
const scenarioName = "oac-scenario-zhiyong-hollykube";

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

function adminHeaders() {
  const secret = process.env.ADMIN_SECRET || "";
  if (!secret) throw new Error("ADMIN_SECRET is not configured.");
  return { "x-admin-secret": secret };
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

function writeArtifact(name, value) {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2), "utf8");
  return file;
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
  const timeoutMs = Number(process.env.OAC_SCENARIO_TIMEOUT_MINUTES || "50") * 60 * 1000;
  const deadline = Date.now() + timeoutMs;
  let lastLine = "";
  let finalJob = null;
  while (Date.now() < deadline) {
    const payload = await api(`/.netlify/functions/get-report-job?jobId=${encodeURIComponent(jobId)}`, {
      headers: authHeaders(token)
    });
    const job = payload.job || {};
    const line = `${job.status || ""}|${job.progress || 0}|${job.stage || ""}|${job.detail || ""}`.slice(0, 260);
    if (line !== lastLine) {
      console.log(JSON.stringify({
        event: "progress",
        status: job.status,
        progress: job.progress,
        stage: job.stage,
        sourceCount: job.sourceCount,
        qualityLevel: job.qualityLevel,
        reportId: job.reportId || ""
      }));
      lastLine = line;
    }
    if (job.status === "done" && job.reportId) {
      finalJob = job;
      break;
    }
    if (["error", "cancelled"].includes(String(job.status || ""))) {
      throw new Error(`Report job failed: ${job.error || job.detail || job.status}`);
    }
    if (job.status === "needs_resume") await triggerRun(jobId);
    await new Promise((resolve) => setTimeout(resolve, 8000));
  }
  if (!finalJob) throw new Error("Report job timed out.");
  return finalJob;
}

function exactProfilePayload(profile = {}) {
  return {
    ...profile,
    companyName: "\u5e7f\u5dde\u667a\u7528\u5f00\u7269",
    mainBusiness:
      "\u9762\u5411\u4f01\u4e1a\u5ba2\u6237\u63d0\u4f9b\u4f01\u4e1a\u667a\u80fd\u4f53\u5e73\u53f0\uff0c\u5305\u62ec\u667a\u80fd\u4f53\u57fa\u7840\u5e73\u53f0\u548c\u4e0a\u5c42\u5e94\u7528\u5b9a\u5236\u3002",
    summary:
      "\u9762\u5411\u4f01\u4e1a\u5ba2\u6237\u63d0\u4f9b\u4f01\u4e1a\u667a\u80fd\u4f53\u5e73\u53f0\uff0c\u5305\u62ec\u667a\u80fd\u4f53\u57fa\u7840\u5e73\u53f0\u548c\u4e0a\u5c42\u5e94\u7528\u5b9a\u5236\u3002",
    coreProducts: [
      "\u4f01\u4e1a\u667a\u80fd\u4f53\u57fa\u7840\u5e73\u53f0",
      "\u4f01\u4e1a\u667a\u80fd\u4f53\u4e0a\u5c42\u5e94\u7528\u5b9a\u5236",
      "\u4f01\u4e1a\u77e5\u8bc6\u5e93\u4e0e\u6570\u636e\u95ee\u7b54",
      "\u4e1a\u52a1\u6d41\u7a0b\u667a\u80fd\u5316\u6539\u9020"
    ],
    coreOfferings: [
      "\u4f01\u4e1a\u667a\u80fd\u4f53\u57fa\u7840\u5e73\u53f0",
      "\u4f01\u4e1a\u667a\u80fd\u4f53\u4e0a\u5c42\u5e94\u7528\u5b9a\u5236",
      "\u4f01\u4e1a\u77e5\u8bc6\u5e93\u4e0e\u6570\u636e\u95ee\u7b54",
      "\u4e1a\u52a1\u6d41\u7a0b\u667a\u80fd\u5316\u6539\u9020"
    ],
    keywords: [
      "\u4f01\u4e1a\u667a\u80fd\u4f53",
      "Agentic AI",
      "\u667a\u80fd\u4f53\u5e73\u53f0",
      "\u77e5\u8bc6\u5e93",
      "\u6570\u636e\u95ee\u7b54",
      "\u5e94\u7528\u5b9a\u5236"
    ]
  };
}

async function main() {
  loadEnv();
  const health = await api("/__health");
  fs.rmSync(path.join(root, "local-data", "tenant-data", scenarioName), { recursive: true, force: true });

  const existing = await api("/.netlify/functions/admin-licenses", {
    method: "GET",
    headers: adminHeaders()
  });
  for (const license of existing.licenses || []) {
    if (license.tenantName === "\u5e7f\u5dde\u667a\u7528\u5f00\u7269" || license.tenantId === scenarioName) {
      await api("/.netlify/functions/admin-licenses", {
        method: "DELETE",
        headers: adminHeaders(),
        body: JSON.stringify({ licenseId: license.licenseId })
      });
    }
  }

  const createdLicense = await api("/.netlify/functions/admin-licenses", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      tenantName: "\u5e7f\u5dde\u667a\u7528\u5f00\u7269",
      tenantId: scenarioName,
      quotaTotal: 5,
      maxDevices: 3,
      createMasterKey: false
    })
  });

  const login = await api("/.netlify/functions/auth-license-login", {
    method: "POST",
    body: JSON.stringify({
      licenseKey: createdLicense.licenseKey,
      userId: "scenario-sales",
      deviceId: "scenario-device",
      deviceName: "OAC scenario browser"
    })
  });
  const token = login.accessToken;
  if (!token) throw new Error("Login did not return an access token.");

  const profileDraft = await api("/.netlify/functions/create-profile", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      companyName: "\u5e7f\u5dde\u667a\u7528\u5f00\u7269",
      candidate: {
        name: "\u5e7f\u5dde\u667a\u7528\u5f00\u7269",
        standardName: "\u5e7f\u5dde\u667a\u7528\u5f00\u7269",
        region: "\u5e7f\u5dde",
        industry: "\u4f01\u4e1a\u667a\u80fd\u4f53\u5e73\u53f0",
        confidence: 99,
        reason: "\u573a\u666f\u9a8c\u8bc1\u6307\u5b9a\u7684\u6211\u65b9\u4f01\u4e1a\u3002"
      }
    })
  });
  const profile = await api("/.netlify/functions/update-profile", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ profile: exactProfilePayload(profileDraft.profile || {}) })
  });

  const resolvedTarget = await api("/.netlify/functions/resolve-company", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      query: "\u548c\u5229\u65f6\u5361\u4f18\u500d",
      region: "\u5b81\u6ce2",
      industry: "\u5de5\u4e1a\u8f6f\u4ef6\uff0f\u667a\u80fd\u5236\u9020",
      aiNeeds:
        "\u667a\u7528\u5f00\u7269\u5e0c\u671b\u5224\u65ad\u8be5\u5ba2\u6237\u662f\u5426\u5b58\u5728\u4f01\u4e1a\u667a\u80fd\u4f53\u5e73\u53f0\u3001\u77e5\u8bc6\u5e93\u3001\u6570\u636e\u95ee\u7b54\u6216\u4e0a\u5c42\u5e94\u7528\u5b9a\u5236\u7684\u5207\u5165\u673a\u4f1a\u3002"
    })
  });
  const target = (resolvedTarget.candidates || [])[0] || {
    name: "\u548c\u5229\u65f6\u5361\u4f18\u500d\u79d1\u6280\u6709\u9650\u516c\u53f8",
    standardName: "\u548c\u5229\u65f6\u5361\u4f18\u500d\u79d1\u6280\u6709\u9650\u516c\u53f8",
    region: "\u5b81\u6ce2",
    industry: "\u5de5\u4e1a\u8f6f\u4ef6\uff0f\u667a\u80fd\u5236\u9020",
    confidence: 80,
    reason: "\u573a\u666f\u6307\u5b9a\u7684\u76ee\u6807\u5ba2\u6237\u3002"
  };
  const resolvedTargetName = String(target.standardName || target.name || "");
  if (
    !resolvedTargetName.includes("\u548c\u5229\u65f6\u5361\u4f18\u500d") ||
    /^(?:\u800c|\u5e76|\u5750\u843d|\u4f4d\u4e8e|\u6ce8\u518c\u5730|\u5730\u5740)/.test(resolvedTargetName)
  ) {
    throw new Error(`Target resolve returned an invalid company name: ${resolvedTargetName}`);
  }
  const company = {
    ...target,
    aiNeeds:
      "\u4ece\u5e7f\u5dde\u667a\u7528\u5f00\u7269\u7684\u4e1a\u52a1\u89c6\u89d2\uff0c\u5224\u65ad\u548c\u5229\u65f6\u5361\u4f18\u500d\u5bf9\u4f01\u4e1a\u667a\u80fd\u4f53\u57fa\u7840\u5e73\u53f0\u3001\u4e0a\u5c42\u5e94\u7528\u5b9a\u5236\u3001\u77e5\u8bc6\u5e93\u4e0e\u6570\u636e\u95ee\u7b54\u7684\u5546\u673a\uff1b\u4e0d\u8981\u5c06\u6211\u65b9\u6392\u4ea7\u80fd\u529b\u5f3a\u884c\u5957\u5230\u5ba2\u6237\u8eab\u4e0a\u3002",
    sellerProfileId: profile.profile.profileId,
    sellerProfileName: profile.profile.companyName,
    sellerProfileSnapshot: profile.profile
  };

  const createdJob = await api("/.netlify/functions/create-report-job", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      profileId: profile.profile.profileId,
      force: true,
      company,
      runtimeMode: "scenario"
    })
  });
  if (!createdJob.jobId) throw new Error("create-report-job did not return jobId.");
  console.log(JSON.stringify({
    event: "created",
    health: health.ok,
    licenseId: createdLicense.license.licenseId,
    licenseKey: mask(createdLicense.licenseKey),
    tenantId: login.me?.tenantId,
    profileId: profile.profile.profileId,
    targetName: target.standardName || target.name,
    tianyanchaStatus: resolvedTarget.tianyanchaDiagnostic?.status || "",
    jobId: createdJob.jobId
  }));

  await triggerRun(createdJob.jobId);
  const finalJob = await pollJob(createdJob.jobId, token);
  const reportPayload = await api(`/.netlify/functions/get-report?reportId=${encodeURIComponent(finalJob.reportId)}`, {
    headers: authHeaders(token)
  });

  const reportFile = writeArtifact("oac-scenario-zhiyong-hollykube-report.json", reportPayload.report || {});
  const previewFile = writeArtifact("oac-scenario-zhiyong-hollykube-preview.html", reportPayload.html || "");
  const summaryFile = writeArtifact("oac-scenario-zhiyong-hollykube-summary.json", {
    ok: true,
    baseUrl,
    licenseId: createdLicense.license.licenseId,
    tenantId: login.me?.tenantId,
    profileId: profile.profile.profileId,
    jobId: createdJob.jobId,
    reportId: finalJob.reportId,
    reportFile,
    previewFile,
    targetName: reportPayload.report?.targetCompanyName || reportPayload.report?.standardName,
    sellerProfileName: reportPayload.report?.sellerProfileName,
    qualityLevel: reportPayload.report?.qualityLevel,
    qualityLabel: reportPayload.report?.qualityLabel,
    verifiedSourceCount: reportPayload.report?.verifiedSourceCount,
    readableSourceCount: reportPayload.report?.readableSourceCount,
    topicCoverageCount: reportPayload.report?.topicCoverageCount,
    tianyanchaStatus: resolvedTarget.tianyanchaDiagnostic?.status || "",
    licenseKeyMasked: mask(createdLicense.licenseKey)
  });
  console.log(JSON.stringify({ ok: true, reportId: finalJob.reportId, reportFile, previewFile, summaryFile }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
