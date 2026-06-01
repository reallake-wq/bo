import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.resolve(root, "..");
const staticRoot = path.resolve(process.env.OAC_DIST_DIR || path.join(root, "..", "oac-local-dist"));
const baseUrl = (process.env.OAC_LOCAL_PAIR_BASE_URL || "http://127.0.0.1:8888").replace(/\/+$/, "");

const scenarios = {
  "zhiyong-hollykube": {
    slug: "zhiyong-hollykube",
    tenantId: "oac-local-pair-zhiyong-hollykube",
    tenantName: "\u667a\u7528\u5f00\u7269\u672c\u5730\u9a8c\u8bc1",
    seller: {
      profileId: "profile_zhiyong_kaiwu",
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
      keywords: [
        "\u4f01\u4e1a\u667a\u80fd\u4f53",
        "Agentic AI",
        "\u667a\u80fd\u4f53\u5e73\u53f0",
        "\u77e5\u8bc6\u5e93",
        "\u6570\u636e\u95ee\u7b54",
        "\u5e94\u7528\u5b9a\u5236"
      ]
    },
    company: {
      name: "\u548c\u5229\u65f6\u5361\u4f18\u500d\u79d1\u6280\u6709\u9650\u516c\u53f8",
      standardName: "\u548c\u5229\u65f6\u5361\u4f18\u500d\u79d1\u6280\u6709\u9650\u516c\u53f8",
      region: "\u5b81\u6ce2",
      industry: "\u5de5\u4e1a\u8f6f\u4ef6\uff0f\u667a\u80fd\u5236\u9020",
      confidence: 99,
      reason: "\u573a\u666f\u9a8c\u8bc1\u6307\u5b9a\u7684\u76ee\u6807\u5ba2\u6237\u3002",
      aiNeeds:
        "\u4ece\u5e7f\u5dde\u667a\u7528\u5f00\u7269\u7684\u4e1a\u52a1\u89c6\u89d2\uff0c\u5224\u65ad\u548c\u5229\u65f6\u5361\u4f18\u500d\u5bf9\u4f01\u4e1a\u667a\u80fd\u4f53\u57fa\u7840\u5e73\u53f0\u3001\u4e0a\u5c42\u5e94\u7528\u5b9a\u5236\u3001\u77e5\u8bc6\u5e93\u4e0e\u6570\u636e\u95ee\u7b54\u7684\u5546\u673a\uff1b\u4e0d\u8981\u5c06\u6211\u65b9\u6392\u4ea7\u80fd\u529b\u5f3a\u884c\u5957\u5230\u5ba2\u6237\u8eab\u4e0a\u3002"
    }
  },
  "hollykube-mengniu": {
    slug: "hollykube-mengniu",
    tenantId: "oac-local-pair-hollykube-mengniu",
    tenantName: "\u548c\u5229\u65f6\u5361\u4f18\u500d\u672c\u5730\u9a8c\u8bc1",
    seller: {
      profileId: "profile_hollykube",
      companyName: "\u548c\u5229\u65f6\u5361\u4f18\u500d\u79d1\u6280\u6709\u9650\u516c\u53f8",
      mainBusiness:
        "\u9762\u5411\u5236\u9020\u4e1a\u548c\u5de5\u4e1a\u4f01\u4e1a\u63d0\u4f9bHolliCube\u5de5\u4e1a\u4e92\u8054\u7f51\u5e73\u53f0\u3001\u5de5\u4e1a\u8f6f\u4ef6\u548c\u6570\u5b57\u5316\u5de5\u5382\u89e3\u51b3\u65b9\u6848\uff0c\u652f\u6301\u5de5\u4e1a\u6570\u636e\u91c7\u96c6\u3001\u5b9e\u65f6\u76d1\u63a7\u3001\u7cfb\u7edf\u96c6\u6210\u548c\u9879\u76ee\u4ea4\u4ed8\u3002",
      summary:
        "\u9762\u5411\u5236\u9020\u4e1a\u548c\u5de5\u4e1a\u4f01\u4e1a\u63d0\u4f9bHolliCube\u5de5\u4e1a\u4e92\u8054\u7f51\u5e73\u53f0\u3001\u5de5\u4e1a\u8f6f\u4ef6\u548c\u6570\u5b57\u5316\u5de5\u5382\u89e3\u51b3\u65b9\u6848\u3002",
      coreProducts: [
        "HolliCube\u5de5\u4e1a\u4e92\u8054\u7f51\u5e73\u53f0",
        "MES\u5236\u9020\u6267\u884c\u7cfb\u7edf",
        "APS\u9ad8\u7ea7\u8ba1\u5212\u4e0e\u6392\u4ea7",
        "\u5de5\u4e1a\u6570\u636e\u5e73\u53f0\u4e0e\u5b9e\u65f6\u76d1\u63a7",
        "\u6570\u5b57\u5316\u5de5\u5382\u89e3\u51b3\u65b9\u6848"
      ],
      keywords: [
        "HolliCube",
        "MES",
        "APS",
        "\u5de5\u4e1a\u4e92\u8054\u7f51",
        "\u6570\u5b57\u5316\u5de5\u5382",
        "\u5de5\u4e1a\u6570\u636e",
        "\u5b9e\u65f6\u76d1\u63a7",
        "\u7cfb\u7edf\u96c6\u6210"
      ]
    },
    company: {
      name: "\u4e2d\u56fd\u8499\u725b\u4e73\u4e1a\u6709\u9650\u516c\u53f8",
      standardName: "\u4e2d\u56fd\u8499\u725b\u4e73\u4e1a\u6709\u9650\u516c\u53f8",
      region: "\u547c\u548c\u6d69\u7279\uff0f\u9999\u6e2f",
      industry: "\u4e73\u5236\u54c1\uff0f\u98df\u54c1\u996e\u6599",
      confidence: 99,
      reason: "\u573a\u666f\u9a8c\u8bc1\u6307\u5b9a\u7684\u76ee\u6807\u5ba2\u6237\u3002",
      aiNeeds:
        "\u4ece\u548c\u5229\u65f6\u5361\u4f18\u500d\u7684\u4e1a\u52a1\u89c6\u89d2\uff0c\u5224\u65ad\u4e2d\u56fd\u8499\u725b\u4e73\u4e1a\u662f\u5426\u5b58\u5728HolliCube\u3001MES\u3001APS\u3001\u5de5\u4e1a\u4e92\u8054\u7f51\u5e73\u53f0\u3001\u5de5\u4e1a\u6570\u636e\u5e73\u53f0\u4e0e\u5b9e\u65f6\u76d1\u63a7\u7b49\u76f8\u5173\u5546\u673a\uff1b\u91cd\u70b9\u6838\u9a8c\u8499\u725b\u7684\u91c7\u8d2d\u8bb0\u5f55\u3001\u5df2\u6709\u4f9b\u5e94\u5546\u6216\u5ba2\u6237\u7ebf\u7d22\u3001\u8d22\u52a1\u80fd\u529b\u3001\u98ce\u9669\u548c\u51b3\u7b56\u94fe\uff0c\u4e0d\u8981\u628a\u548c\u5229\u65f6\u5361\u4f18\u500d\u7684\u5bf9\u5916\u4ea4\u4ed8\u6848\u4f8b\u5f53\u6210\u8499\u725b\u7684\u91c7\u8d2d\u8bc1\u636e\u3002"
    }
  }
};

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

function log(event, data = {}) {
  console.log(JSON.stringify({ event, ts: new Date().toISOString(), ...data }));
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
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const file = path.join(outDir, name);
  fs.writeFileSync(file, text, "utf8");
  return file;
}

function writeStatic(name, value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  fs.mkdirSync(staticRoot, { recursive: true });
  const file = path.join(staticRoot, name);
  fs.writeFileSync(file, text, "utf8");
  return file;
}

async function resetTenant(scenario) {
  fs.rmSync(path.join(root, "local-data", "tenant-data", scenario.tenantId), { recursive: true, force: true });
  const existing = await api("/.netlify/functions/admin-licenses", {
    method: "GET",
    headers: adminHeaders()
  });
  for (const license of existing.licenses || []) {
    if (license.tenantId === scenario.tenantId || license.tenantName === scenario.tenantName) {
      await api("/.netlify/functions/admin-licenses", {
        method: "DELETE",
        headers: adminHeaders(),
        body: JSON.stringify({ licenseId: license.licenseId })
      });
    }
  }
}

async function createSession(scenario) {
  const createdLicense = await api("/.netlify/functions/admin-licenses", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      tenantName: scenario.tenantName,
      tenantId: scenario.tenantId,
      quotaTotal: 3,
      maxDevices: 2,
      createMasterKey: false
    })
  });
  const login = await api("/.netlify/functions/auth-license-login", {
    method: "POST",
    body: JSON.stringify({
      licenseKey: createdLicense.licenseKey,
      userId: `local-${scenario.slug}`,
      deviceId: `local-${scenario.slug}-device`,
      deviceName: `OAC local ${scenario.slug}`
    })
  });
  if (!login.accessToken) throw new Error("License login did not return access token.");
  return {
    license: createdLicense.license,
    licenseKeyMasked: mask(createdLicense.licenseKey),
    token: login.accessToken
  };
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

async function pollJob(scenario, jobId, token) {
  const timeoutMs = Number(process.env.OAC_LOCAL_PAIR_TIMEOUT_MINUTES || "55") * 60 * 1000;
  const deadline = Date.now() + timeoutMs;
  let lastLine = "";
  while (Date.now() < deadline) {
    const payload = await api(`/.netlify/functions/get-report-job?jobId=${encodeURIComponent(jobId)}`, {
      headers: authHeaders(token)
    });
    const job = payload.job || {};
    const line = `${job.status || ""}|${job.progress || 0}|${job.stage || ""}|${job.detail || ""}`.slice(0, 260);
    if (line !== lastLine) {
      log("progress", {
        slug: scenario.slug,
        status: job.status,
        progress: job.progress,
        stage: job.stage,
        sourceCount: job.sourceCount,
        qualityLevel: job.qualityLevel,
        reportId: job.reportId || ""
      });
      lastLine = line;
    }
    if (job.status === "done" && job.reportId) return job;
    if (["error", "cancelled"].includes(String(job.status || ""))) {
      throw new Error(`Report job failed for ${scenario.slug}: ${job.error || job.detail || job.status}`);
    }
    if (job.status === "needs_resume") await triggerRun(jobId);
    await new Promise((resolve) => setTimeout(resolve, 8000));
  }
  throw new Error(`Report job timed out for ${scenario.slug}.`);
}

async function runScenario(scenario) {
  log("scenario_start", { slug: scenario.slug, baseUrl });
  await resetTenant(scenario);
  const session = await createSession(scenario);
  const savedProfile = await api("/.netlify/functions/update-profile", {
    method: "POST",
    headers: authHeaders(session.token),
    body: JSON.stringify({
      profile: {
        ...scenario.seller,
        coreOfferings: scenario.seller.coreProducts
      }
    })
  });
  const profile = savedProfile.profile;
  const company = {
    ...scenario.company,
    sellerProfileId: profile.profileId,
    sellerProfileName: profile.companyName,
    sellerProfileSnapshot: profile
  };
  const createdJob = await api("/.netlify/functions/create-report-job", {
    method: "POST",
    headers: authHeaders(session.token),
    body: JSON.stringify({
      profileId: profile.profileId,
      force: true,
      company,
      runtimeMode: "scenario"
    })
  });
  if (!createdJob.jobId) throw new Error(`create-report-job did not return jobId for ${scenario.slug}.`);
  log("job_created", {
    slug: scenario.slug,
    tenantId: scenario.tenantId,
    licenseId: session.license?.licenseId,
    licenseKey: session.licenseKeyMasked,
    profileId: profile.profileId,
    targetName: scenario.company.standardName,
    jobId: createdJob.jobId
  });
  await triggerRun(createdJob.jobId);
  const finalJob = await pollJob(scenario, createdJob.jobId, session.token);
  const reportPayload = await api(`/.netlify/functions/get-report?reportId=${encodeURIComponent(finalJob.reportId)}`, {
    headers: authHeaders(session.token)
  });
  const report = reportPayload.report || {};
  const html = reportPayload.html || "";
  const reportFile = writeArtifact(`oac-${scenario.slug}-report.json`, report);
  const previewFile = writeArtifact(`oac-${scenario.slug}-preview.html`, html);
  const staticPreviewFile = writeStatic(`oac-${scenario.slug}-preview.html`, html);
  writeArtifact("oac-preview-latest.html", html);
  writeStatic("oac-preview-latest.html", html);
  const summary = {
    ok: true,
    baseUrl,
    slug: scenario.slug,
    tenantId: scenario.tenantId,
    licenseId: session.license?.licenseId,
    licenseKeyMasked: session.licenseKeyMasked,
    profileId: profile.profileId,
    sellerProfileName: report.sellerProfileName || profile.companyName,
    targetName: report.targetCompanyName || report.standardName || scenario.company.standardName,
    jobId: createdJob.jobId,
    reportId: finalJob.reportId,
    reportFile,
    previewFile,
    staticPreviewFile,
    previewUrl: `${baseUrl}/oac-${scenario.slug}-preview.html`,
    latestPreviewUrl: `${baseUrl}/oac-preview-latest.html`,
    qualityLevel: report.qualityLevel,
    qualityLabel: report.qualityLabel,
    verifiedSourceCount: report.verifiedSourceCount,
    readableSourceCount: report.readableSourceCount,
    topicCoverageCount: report.topicCoverageCount
  };
  const summaryFile = writeArtifact(`oac-${scenario.slug}-summary.json`, summary);
  log("scenario_done", { ...summary, summaryFile });
  return { ...summary, summaryFile };
}

async function main() {
  loadEnv();
  const requested = process.argv.slice(2).filter(Boolean);
  const names = requested.length ? requested : Object.keys(scenarios);
  const unknown = names.filter((name) => !scenarios[name]);
  if (unknown.length) {
    throw new Error(`Unknown scenario(s): ${unknown.join(", ")}. Known: ${Object.keys(scenarios).join(", ")}`);
  }
  await api("/__health").catch(() => api("/.netlify/functions/health"));
  const results = [];
  for (const name of names) {
    results.push(await runScenario(scenarios[name]));
  }
  const batch = {
    ok: true,
    generatedAt: new Date().toISOString(),
    results
  };
  const batchFile = writeArtifact("oac-local-pair-summary.json", batch);
  writeStatic("oac-local-pair-summary.json", batch);
  log("all_done", { batchFile, results: results.map((item) => ({ slug: item.slug, previewUrl: item.previewUrl, reportId: item.reportId })) });
}

main().catch((error) => {
  log("error", { message: error?.message || String(error), stack: error?.stack || "" });
  process.exitCode = 1;
});
