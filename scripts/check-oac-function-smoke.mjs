import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oac-function-smoke-"));
process.chdir(tempRoot);
process.env.OAC_SESSION_SECRET = "oac-function-smoke-session-secret";
process.env.OAC_HASH_SECRET = "oac-function-smoke-hash-secret";
process.env.ADMIN_SECRET = "oac-function-smoke-admin-secret";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function functionUrl(name) {
  return `http://127.0.0.1/.netlify/functions/${name}`;
}

function request(name, init = {}) {
  return new Request(functionUrl(name), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers || {})
    }
  });
}

async function parse(response) {
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: { raw: text } };
  }
}

const adminLicenses = (await import(pathToFileURL(path.join(projectRoot, "netlify", "functions", "admin-licenses.mjs")).href + `?v=${Date.now()}`)).default;
const authLogin = (await import(pathToFileURL(path.join(projectRoot, "netlify", "functions", "auth-license-login.mjs")).href + `?v=${Date.now()}`)).default;
const authMe = (await import(pathToFileURL(path.join(projectRoot, "netlify", "functions", "auth-me.mjs")).href + `?v=${Date.now()}`)).default;
const authRefresh = (await import(pathToFileURL(path.join(projectRoot, "netlify", "functions", "auth-refresh.mjs")).href + `?v=${Date.now()}`)).default;
const createProfile = (await import(pathToFileURL(path.join(projectRoot, "netlify", "functions", "create-profile.mjs")).href + `?v=${Date.now()}`)).default;

const denied = await parse(await adminLicenses(request("admin-licenses", { method: "GET" })));
assert(denied.status === 401, "Admin endpoint should reject missing admin secret.");
assert(!JSON.stringify(denied.body).includes(process.env.ADMIN_SECRET), "Admin failure must not echo admin secret.");

const created = await parse(await adminLicenses(request("admin-licenses", {
  method: "POST",
  headers: { "x-admin-secret": process.env.ADMIN_SECRET },
  body: JSON.stringify({
    tenantName: "函数冒烟租户",
    quotaTotal: 3,
    maxDevices: 2,
    createMasterKey: true
  })
})));
assert(created.status === 200 && created.body.ok, "Admin should create license.");
assert(/^OAC-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(created.body.licenseKey), "Created license should be a short friendly key.");
assert(created.body.license.remainingUses === 3, "Created license should expose remaining quota.");

const listed = await parse(await adminLicenses(request("admin-licenses", {
  method: "GET",
  headers: { "x-admin-secret": process.env.ADMIN_SECRET }
})));
assert(listed.status === 200 && listed.body.licenses.length === 1, "Admin should list created license.");
assert(!JSON.stringify(listed.body).includes(created.body.licenseKey), "Admin list should not expose raw license key.");

const login = await parse(await authLogin(request("auth-license-login", {
  method: "POST",
  body: JSON.stringify({
    licenseKey: created.body.licenseKey,
    userId: "sales-a",
    deviceId: "phone-a",
    deviceName: "iPhone"
  })
})));
assert(login.status === 200 && login.body.ok, "License login should succeed.");
assert(login.body.accessToken && login.body.refreshToken, "Login should return access and refresh tokens.");
assert(login.body.me.tenantName === "函数冒烟租户", "Login should return tenant information.");
assert(login.body.me.license.remainingUses === 3, "Login should show remaining quota.");

const me = await parse(await authMe(request("auth-me", {
  method: "GET",
  headers: { authorization: `Bearer ${login.body.accessToken}` }
})));
assert(me.status === 200 && me.body.ok, "auth-me should accept access token.");
assert(me.body.me.tenantId === login.body.me.tenantId, "auth-me should preserve tenant identity.");

const refreshed = await parse(await authRefresh(request("auth-refresh", {
  method: "POST",
  body: JSON.stringify({ refreshToken: login.body.refreshToken })
})));
assert(refreshed.status === 200 && refreshed.body.ok, "refresh should issue a new access token.");
assert(refreshed.body.me.tenantId === login.body.me.tenantId, "refresh should preserve tenant identity.");

const profileCreated = await parse(await createProfile(request("create-profile", {
  method: "POST",
  headers: { authorization: `Bearer ${login.body.accessToken}` },
  body: JSON.stringify({
    companyName: "广州智用开物",
    candidate: {
      name: "广州智用开物",
      standardName: "广州智用开物",
      region: "广州",
      industry: "企业智能体平台",
      confidence: 99
    }
  })
})));
assert(profileCreated.status === 200 && profileCreated.body.profile?.companyName === "广州智用开物", "Tenant should create a bound company profile.");

const listedWithProfile = await parse(await adminLicenses(request("admin-licenses", {
  method: "GET",
  headers: { "x-admin-secret": process.env.ADMIN_SECRET }
})));
const adminLicense = listedWithProfile.body.licenses?.find((item) => item.licenseId === created.body.license.licenseId);
assert(adminLicense?.boundProfiles?.some((profile) => profile.companyName === "广州智用开物"), "Admin list should show company profiles bound under the license tenant.");

const badLogin = await parse(await authLogin(request("auth-license-login", {
  method: "POST",
  body: JSON.stringify({ licenseKey: "OAC-XXXX-XXXX", deviceId: "bad-device" })
})));
assert(badLogin.status === 401, "Invalid license should be rejected.");
assert(!JSON.stringify(badLogin.body).includes(created.body.licenseKey), "Invalid login response must not leak valid key.");

const removed = await parse(await adminLicenses(request("admin-licenses", {
  method: "DELETE",
  headers: { "x-admin-secret": process.env.ADMIN_SECRET },
  body: JSON.stringify({ licenseId: created.body.license.licenseId })
})));
assert(removed.status === 200 && removed.body.ok, "Admin should delete a license.");
assert(removed.body.deleted?.sessions >= 1, "Deleting a license should clear related sessions.");

const loginAfterDelete = await parse(await authLogin(request("auth-license-login", {
  method: "POST",
  body: JSON.stringify({ licenseKey: created.body.licenseKey, userId: "sales-a", deviceId: "phone-a" })
})));
assert(loginAfterDelete.status === 401, "Deleted license key should no longer log in.");

const output = {
  ok: true,
  tempRoot,
  tenantId: login.body.me.tenantId,
  licenseId: login.body.me.license.licenseId,
  checks: [
    "admin rejects missing secret",
    "admin creates license",
    "admin list hides raw key",
    "license login",
    "auth me",
    "refresh session",
    "admin sees bound company profile",
    "admin deletes license",
    "invalid license rejection"
  ]
};
fs.writeFileSync(path.resolve(projectRoot, "..", "oac-function-smoke-summary.json"), JSON.stringify(output, null, 2), "utf8");
console.log(JSON.stringify(output, null, 2));
