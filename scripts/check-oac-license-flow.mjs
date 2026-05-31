import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oac-license-flow-"));
process.chdir(tempRoot);
process.env.OAC_SESSION_SECRET = "oac-license-flow-session-secret";
process.env.OAC_HASH_SECRET = "oac-license-flow-hash-secret";
process.env.ADMIN_SECRET = "oac-license-flow-admin-secret";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readAllText(dir) {
  let out = "";
  function walk(current) {
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out += `\n--- ${full}\n${fs.readFileSync(full, "utf8")}`;
    }
  }
  walk(dir);
  return out;
}

async function expectReject(fn, includes) {
  try {
    await fn();
  } catch (error) {
    const message = error?.message || String(error);
    assert(message.includes(includes), `Expected rejection containing ${includes}, got ${message}`);
    return message;
  }
  throw new Error(`Expected rejection containing ${includes}`);
}

const auth = await import(pathToFileURL(path.join(projectRoot, "netlify", "lib", "auth.mjs")).href + `?v=${Date.now()}`);
const store = await import(pathToFileURL(path.join(projectRoot, "netlify", "lib", "store.mjs")).href + `?v=${Date.now()}`);

const created = await auth.createLicenseRecord({
  tenantName: "演示客户",
  quotaTotal: 2,
  maxDevices: 2,
  createMasterKey: true
});
const licenseKey = created.licenseKey;
assert(/^OAC-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(licenseKey), "License key should be short and shareable.");
assert(created.masterKey.startsWith("oac_master_"), "Master key should be returned once when requested.");
assert(!JSON.stringify(created.license).includes("licenseHash"), "Public license must not expose license hash.");
assert(created.license.remainingUses === 2, "Initial remaining quota should be 2.");

const rawStore = readAllText(path.join(tempRoot, "local-data"));
assert(!rawStore.includes(licenseKey), "Raw license key must not be stored in local data.");
assert(!rawStore.includes(created.masterKey), "Raw master key must not be stored in local data.");

const found = await auth.findLicenseByKey(licenseKey);
assert(found?.licenseId === created.license.licenseId, "License key lookup should find the created license.");
assert((await auth.findLicenseByKey("OAC-XXXX-XXXX")) === null, "Invalid license should not resolve.");

await auth.registerLicenseDevice(created.license.licenseId, {
  deviceId: "device-a",
  deviceName: "iPhone",
  userId: "user-a"
});
await auth.registerLicenseDevice(created.license.licenseId, {
  deviceId: "device-b",
  deviceName: "PC",
  userId: "user-b"
});
await expectReject(
  () => auth.registerLicenseDevice(created.license.licenseId, { deviceId: "device-c", userId: "user-c" }),
  "最多绑定"
);

const session = await auth.issueSession({
  tenantId: found.tenantId,
  tenantName: found.tenantName,
  licenseId: found.licenseId,
  userId: "user-a",
  mode: "web"
});
assert(session.accessToken && session.refreshToken, "Session should include access and refresh tokens.");
const refreshed = await auth.refreshSession(session.refreshToken);
assert(refreshed.me.tenantId === found.tenantId, "Refresh should preserve tenant identity.");

await store.withTenantContext({ tenantId: found.tenantId }, async () => {
  await store.writeJson("profiles", "mine.json", { profileId: "mine", tenantId: found.tenantId });
});
const tenantAProfile = await store.withTenantContext({ tenantId: found.tenantId }, () =>
  store.readJson("profiles", "mine.json", null)
);
const tenantBProfile = await store.withTenantContext({ tenantId: "another-tenant" }, () =>
  store.readJson("profiles", "mine.json", null)
);
assert(tenantAProfile?.profileId === "mine", "Tenant A should read its profile.");
assert(tenantBProfile === null, "Tenant B should not read Tenant A profile.");

await auth.recordSuccessfulUsage({
  tenantId: found.tenantId,
  tenantName: found.tenantName,
  licenseId: found.licenseId,
  userId: "user-a"
}, { type: "report", jobId: "job-a", reportId: "report-a" });
await auth.recordSuccessfulUsage({
  tenantId: found.tenantId,
  tenantName: found.tenantName,
  licenseId: found.licenseId,
  userId: "user-a"
}, { type: "round", jobId: "job-b", reportId: "report-a" });
const depleted = await auth.getLicense(found.licenseId);
assert(depleted.quotaUsed === 2, "Successful usage should increment quota.");
assert(auth.licenseUsableState(depleted).canCreate === false, "Depleted license should block new creation.");

const ssoCode = await auth.createSsoCode({
  tenantId: found.tenantId,
  tenantName: found.tenantName,
  licenseId: found.licenseId,
  userId: "enterprise-user"
});
const ssoSession = await auth.exchangeSsoCode(ssoCode);
assert(ssoSession.accessToken, "SSO code should exchange into a session.");
await expectReject(() => auth.exchangeSsoCode(ssoCode), "SSO code 无效");

const output = {
  ok: true,
  tempRoot,
  licenseId: found.licenseId,
  tenantId: found.tenantId,
  remainingUses: auth.publicLicense(depleted).remainingUses,
  activatedUsers: auth.publicLicense(depleted).activatedUsers.length,
  checks: [
    "short license key",
    "secret hash storage",
    "device binding limit",
    "session refresh",
    "tenant isolation",
    "usage deduction",
    "one-time SSO"
  ]
};
fs.writeFileSync(path.resolve(projectRoot, "..", "oac-license-flow-summary.json"), JSON.stringify(output, null, 2), "utf8");
console.log(JSON.stringify(output, null, 2));
