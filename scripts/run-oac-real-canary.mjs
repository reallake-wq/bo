import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8").replace(/^\uFEFF/, ""));
}

function usage() {
  return [
    "Protected real OAC canary. This WILL create a real task and may spend search/model quota.",
    "",
    "No-cost preflight:",
    "  npm run canary:oac-check",
    "  or OAC_CANARY_CONFIRM=CHECK npm run canary:oac-real",
    "",
    "Required:",
    "  OAC_CANARY_CONFIRM=RUN",
    "  OAC_CANARY_BASE_URL=http://localhost:8888",
    "  OAC_CANARY_LICENSE=<license key> or OAC_CANARY_ACCESS_TOKEN=<token>",
    "  OAC_CANARY_COMPANY_FILE=<utf8 json file>",
    "",
    "Optional:",
    "  OAC_CANARY_PROFILE_ID=<profile id>",
    "  OAC_CANARY_TIMEOUT_MINUTES=45",
    "",
    "Company file example:",
    '  {"name":"target company","standardName":"target company","region":"","industry":"","aiNeeds":""}'
  ].join("\n");
}

function walkStrings(value, visitor, pathParts = []) {
  if (typeof value === "string") {
    visitor(value, pathParts);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, visitor, pathParts.concat(String(index))));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      walkStrings(item, visitor, pathParts.concat(key));
    }
  }
}

function validateCompany(company) {
  const errors = [];
  const warnings = [];
  if (!company || typeof company !== "object" || Array.isArray(company)) {
    errors.push("Company file must be a JSON object.");
    return { errors, warnings };
  }
  const name = String(company.standardName || company.name || "").trim();
  if (!name) errors.push("Company file must include standardName or name.");
  for (const key of ["name", "standardName", "region", "industry", "aiNeeds"]) {
    if (company[key] != null && typeof company[key] !== "string") {
      warnings.push(`${key} should be a string.`);
    }
  }
  walkStrings(company, (text, pathParts) => {
    if (text.includes("\uFFFD") || /\?{3,}/.test(text)) {
      errors.push(`Possible encoding damage at ${pathParts.join(".") || "<root>"}.`);
    }
  });
  return { errors, warnings };
}

function preflight() {
  const baseUrl = env("OAC_CANARY_BASE_URL", "http://localhost:8888").replace(/\/+$/, "");
  const companyFile = env("OAC_CANARY_COMPANY_FILE", path.join(root, "scripts", "canary-company.example.json"));
  const resolvedCompanyFile = path.resolve(companyFile);
  const company = readJsonFile(resolvedCompanyFile);
  const validation = validateCompany(company);
  const hasAuth = Boolean(env("OAC_CANARY_ACCESS_TOKEN") || env("OAC_CANARY_LICENSE"));
  const result = {
    ok: validation.errors.length === 0,
    mode: "check",
    createsTask: false,
    spendsQuota: false,
    baseUrl,
    companyFile: resolvedCompanyFile,
    companyName: company.standardName || company.name || "",
    hasAuth,
    profileMode: env("OAC_CANARY_PROFILE_ID") ? "explicit" : "auto-pick-ready-profile",
    errors: validation.errors,
    warnings: validation.warnings
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

async function api(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Non-JSON response from ${pathName}: ${text.slice(0, 180)}`);
  }
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || payload?.message || `Request failed: ${response.status}`);
  }
  return payload;
}

async function login(baseUrl) {
  const accessToken = env("OAC_CANARY_ACCESS_TOKEN");
  if (accessToken) return accessToken;
  const licenseKey = env("OAC_CANARY_LICENSE");
  if (!licenseKey) throw new Error("Missing OAC_CANARY_LICENSE or OAC_CANARY_ACCESS_TOKEN.");
  const payload = await api(baseUrl, "/.netlify/functions/auth-license-login", {
    method: "POST",
    body: JSON.stringify({
      licenseKey,
      userId: "canary",
      deviceId: "oac-real-canary",
      deviceName: "OAC real canary"
    })
  });
  if (!payload.accessToken) throw new Error("Login succeeded but no access token was returned.");
  return payload.accessToken;
}

async function pickProfile(baseUrl, token) {
  const explicit = env("OAC_CANARY_PROFILE_ID");
  if (explicit) return explicit;
  const payload = await api(baseUrl, "/.netlify/functions/list-profiles", {
    headers: { Authorization: `Bearer ${token}` }
  });
  const profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
  const ready = profiles.find((profile) => {
    const products = profile.coreProducts || profile.coreOfferings || [];
    return profile.profileId && (profile.mainBusiness || profile.summary) && Array.isArray(products) && products.length;
  });
  if (!ready) throw new Error("No ready seller profile found. Set OAC_CANARY_PROFILE_ID or create a profile first.");
  return ready.profileId;
}

async function triggerRun(baseUrl, jobId) {
  await api(baseUrl, "/.netlify/functions/run-report-job-background", {
    method: "POST",
    body: JSON.stringify({ jobId })
  }).catch((error) => {
    const message = String(error?.message || "");
    if (!/Non-JSON response|Unexpected end/i.test(message)) throw error;
  });
}

function runQuality(reportPath) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, "scripts", "check-oac-report-quality.mjs"),
      "--report",
      reportPath,
      "--no-baseline",
      "--preview",
      path.resolve(root, "..", "oac-real-canary-preview.html"),
      "--summary",
      path.resolve(root, "..", "oac-real-canary-quality-summary.md")
    ],
    { cwd: root, encoding: "utf8" }
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error("Real canary report did not pass quality gate.");
}

async function main() {
  if (args.has("--check") || env("OAC_CANARY_CONFIRM") === "CHECK") {
    preflight();
    return;
  }
  if (env("OAC_CANARY_CONFIRM") !== "RUN") {
    console.log(usage());
    console.log("\nRefusing to run because OAC_CANARY_CONFIRM is not RUN.");
    return;
  }
  const baseUrl = env("OAC_CANARY_BASE_URL", "http://localhost:8888").replace(/\/+$/, "");
  const companyFile = env("OAC_CANARY_COMPANY_FILE");
  if (!companyFile) throw new Error("Missing OAC_CANARY_COMPANY_FILE. Use a UTF-8 JSON file to avoid shell encoding issues.");
  const company = readJsonFile(companyFile);
  const token = await login(baseUrl);
  const profileId = await pickProfile(baseUrl, token);
  const created = await api(baseUrl, "/.netlify/functions/create-report-job", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      profileId,
      force: true,
      company
    })
  });
  if (created.cached && created.reportId) {
    throw new Error(`Canary expected a fresh task but received cached report: ${created.reportId}`);
  }
  const jobId = created.jobId;
  if (!jobId) throw new Error("No jobId returned from create-report-job.");
  console.log(JSON.stringify({ event: "created", jobId, profileId }, null, 2));
  await triggerRun(baseUrl, jobId);

  const deadline = Date.now() + Number(env("OAC_CANARY_TIMEOUT_MINUTES", "45")) * 60 * 1000;
  let lastStage = "";
  let finalJob = null;
  while (Date.now() < deadline) {
    const payload = await api(baseUrl, `/.netlify/functions/get-report-job?jobId=${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const job = payload.job || {};
    const stage = `${job.status || ""}|${job.progress || 0}|${job.stage || ""}|${job.detail || ""}`.slice(0, 260);
    if (stage !== lastStage) {
      console.log(JSON.stringify({
        event: "progress",
        status: job.status,
        progress: job.progress,
        stage: job.stage,
        sourceCount: job.sourceCount,
        reportId: job.reportId || ""
      }, null, 2));
      lastStage = stage;
    }
    if (job.status === "done" && job.reportId) {
      finalJob = job;
      break;
    }
    if (["error", "cancelled"].includes(String(job.status || ""))) {
      throw new Error(`Canary job failed: ${job.error || job.detail || job.status}`);
    }
    if (job.status === "needs_resume") await triggerRun(baseUrl, jobId);
    await new Promise((resolve) => setTimeout(resolve, 8000));
  }
  if (!finalJob) throw new Error("Canary timed out before report completion.");
  const reportPayload = await api(baseUrl, `/.netlify/functions/get-report?reportId=${encodeURIComponent(finalJob.reportId)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const outFile = path.resolve(root, "..", "oac-real-canary-report.json");
  fs.writeFileSync(outFile, JSON.stringify(reportPayload.report, null, 2), "utf8");
  runQuality(outFile);
  console.log(JSON.stringify({
    ok: true,
    jobId,
    reportId: finalJob.reportId,
    reportFile: outFile,
    preview: path.resolve(root, "..", "oac-real-canary-preview.html")
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
