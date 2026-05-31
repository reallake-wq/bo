import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(root, "..");
const outPath = path.join(workspaceRoot, "oac-job-identity-summary.json");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeSummary(summary) {
  fs.writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

const tempRoot = await mkdtemp(path.join(tmpdir(), "oac-job-identity-"));
const originalCwd = process.cwd();

try {
  process.chdir(tempRoot);

  const store = await import(pathToFileURL(path.join(root, "netlify/lib/store.mjs")).href);
  const pipeline = await import(pathToFileURL(path.join(root, "netlify/lib/pipeline.mjs")).href);

  const sellerProfile = {
    profileId: "profile-zykw",
    companyName: "\u667a\u7528\u5f00\u7269",
    mainBusiness: "\u4f01\u4e1a AI \u667a\u80fd\u4f53\u4e0e\u77e5\u8bc6\u5e93",
    coreProducts: "\u5546\u673a\u53c2\u8c0b\u56e2 OAC\u3001\u6392\u4ea7\u667a\u80fd\u4f53\u3001\u77e5\u8bc6\u5e93"
  };
  const company = {
    standardName: "\u5b81\u6ce2\u7cbe\u534e\u7535\u5b50\u79d1\u6280\u80a1\u4efd\u6709\u9650\u516c\u53f8",
    name: "\u5b81\u6ce2\u7cbe\u534e\u7535\u5b50\u79d1\u6280\u80a1\u4efd\u6709\u9650\u516c\u53f8",
    region: "\u5b81\u6ce2",
    industry: "\u7535\u5b50\u5236\u9020",
    sellerProfileId: sellerProfile.profileId,
    sellerProfileName: sellerProfile.companyName,
    sellerProfileSnapshot: sellerProfile
  };

  const jobId = await pipeline.createJob(company, "generate", "intl", sellerProfile);
  let job = await store.readJson("jobs", `${jobId}.json`, null);
  assert(job, "created job should be persisted");
  assert(job.jobIdentity?.targetCompanyName === company.standardName, "created job should persist target company identity");
  assert(job.jobIdentity?.sellerProfileName === sellerProfile.companyName, "created job should persist seller identity");
  assert(job.targetCompanyName === company.standardName, "created job should expose target company name");
  assert(job.sellerProfileName === sellerProfile.companyName, "created job should expose seller profile name");
  assert(job.company?.sellerProfileSnapshot?.companyName === sellerProfile.companyName, "created job should keep seller snapshot");

  await pipeline.updateJob(jobId, {
    status: "running",
    progress: 52,
    phaseKey: "search",
    stage: "\u5206\u4e3b\u9898\u68c0\u7d22",
    detail: "\u6a21\u62df\u4e0d\u5e26\u8eab\u4efd\u5b57\u6bb5\u7684\u8fdb\u5ea6\u66f4\u65b0"
  });
  job = await store.readJson("jobs", `${jobId}.json`, null);
  assert(job.targetCompanyName === company.standardName, "identity should survive progress patch without company fields");
  assert(job.sellerProfileName === sellerProfile.companyName, "seller should survive progress patch without profile fields");

  await pipeline.updateJob(jobId, {
    status: "needs_resume",
    progress: 91,
    phaseKey: "analysis",
    stage: "\u7b49\u5f85\u7eed\u8dd1",
    detail: "\u6a21\u62df\u540e\u53f0\u51fd\u6570\u63a5\u8fd1\u8fd0\u884c\u9884\u7b97"
  });
  job = await store.readJson("jobs", `${jobId}.json`, null);
  assert(job.targetCompanyName === company.standardName, "identity should survive checkpoint resume state");
  assert(job.sellerProfileName === sellerProfile.companyName, "seller should survive checkpoint resume state");

  await pipeline.updateJob(jobId, {
    status: "done",
    progress: 100,
    phaseKey: "done",
    stage: "\u5b8c\u6210",
    detail: "\u6a21\u62df\u62a5\u544a\u751f\u6210\u5b8c\u6210",
    reportId: "report-demo",
    sourceCount: 22
  });
  job = await store.readJson("jobs", `${jobId}.json`, null);
  assert(job.status === "done", "job should become done");
  assert(job.finishedAt && job.completedAt, "done job should freeze finish timestamps");
  assert(job.targetCompanyName === company.standardName, "identity should survive terminal update");
  assert(job.sellerProfileName === sellerProfile.companyName, "seller should survive terminal update");

  await store.writeJson("jobs", "bad-job.json", {
    jobId: "bad-job",
    status: "queued",
    progress: 20,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  const bad = await pipeline.updateJob("bad-job", {
    status: "running",
    progress: 30,
    phaseKey: "search",
    stage: "\u6a21\u62df\u5f02\u5e38\u8fdb\u5ea6"
  });
  assert(bad.status === "error", "identity-less job should be stopped as diagnostic error");
  assert(bad.error === "job identity missing", "identity-less job should explain missing identity");

  writeSummary({
    ok: true,
    checkedAt: new Date().toISOString(),
    checks: [
      "created job identity persisted",
      "progress update preserves target company",
      "resume state preserves seller profile",
      "done state freezes finish timestamps",
      "identity-less job is stopped instead of becoming empty shell"
    ],
    sampleJobId: jobId,
    targetCompanyName: job.targetCompanyName,
    sellerProfileName: job.sellerProfileName
  });
} catch (error) {
  writeSummary({
    ok: false,
    checkedAt: new Date().toISOString(),
    error: error?.message || String(error)
  });
  throw error;
} finally {
  process.chdir(originalCwd);
  await rm(tempRoot, { recursive: true, force: true });
}
