import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { deleteObject, listJson, readJson, writeJson, withTenantContext } from "./store.mjs";
import { id, nowIso } from "./util.mjs";

const ACCESS_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SSO_CODE_TTL_MS = 5 * 60 * 1000;

function env(name, fallback = "") {
  try {
    const netlifyValue = globalThis.Netlify?.env?.get?.(name);
    if (netlifyValue) return netlifyValue;
  } catch {
    // Ignore non-Netlify runtime.
  }
  return process.env[name] || fallback;
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function unbase64url(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function stableTenantId(value) {
  const text = String(value || "tenant").trim() || "tenant";
  const slug = text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "tenant"}-${createHash("sha1").update(text).digest("hex").slice(0, 8)}`;
}

function sessionSecret() {
  return env("OAC_SESSION_SECRET") || env("ADMIN_SECRET") || "oac-local-development-secret";
}

function hashSalt() {
  return env("OAC_HASH_SECRET") || sessionSecret();
}

function signPayload(payload) {
  const body = base64url(JSON.stringify(payload));
  const sig = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifySignedToken(token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) throw new Error("会话无效，请重新输入授权码");
  const expected = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("会话无效，请重新输入授权码");
  const payload = JSON.parse(unbase64url(body));
  if (Date.now() > Number(payload.exp || 0)) throw new Error("会话已过期，请重新登录");
  return payload;
}

export function hashSecret(secret) {
  return createHash("sha256").update(`${hashSalt()}:${String(secret || "").trim()}`).digest("hex");
}

export function newSecret(prefix = "oac") {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

function friendlyLicenseKey() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `OAC-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

function parseQuotaTotal(input = {}) {
  const raw = input.quotaTotal ?? input.totalUses;
  if (raw === undefined || raw === null || String(raw).trim() === "") return -1;
  const value = Number(raw);
  return Number.isFinite(value) ? value : -1;
}

export function publicLicense(license = {}) {
  const quotaTotal = Number(license.quotaTotal ?? license.totalUses ?? 0);
  const quotaUsed = Number(license.quotaUsed ?? license.usedUses ?? 0);
  const unlimited = quotaTotal < 0;
  return {
    licenseId: license.licenseId,
    tenantId: license.tenantId,
    tenantName: license.tenantName,
    status: license.status || "active",
    quotaTotal,
    quotaUsed,
    remainingUses: unlimited ? -1 : Math.max(0, quotaTotal - quotaUsed),
    maxDevices: Number(license.maxDevices ?? 3),
    expiresAt: license.expiresAt || "",
    allowedModes: license.allowedModes || ["web"],
    activatedUsers: license.activatedUsers || [],
    recentUsage: license.recentUsage || [],
    createdAt: license.createdAt,
    updatedAt: license.updatedAt
  };
}

export function licenseUsableState(license = {}) {
  if (!license) return { ok: false, canCreate: false, reason: "license_not_found" };
  const status = String(license.status || "active");
  if (status === "revoked") return { ok: false, canCreate: false, reason: "revoked" };
  if (status === "paused") return { ok: true, canCreate: false, reason: "paused" };
  if (status === "expired") return { ok: true, canCreate: false, reason: "expired" };
  if (license.expiresAt && Date.parse(license.expiresAt) < Date.now()) {
    return { ok: true, canCreate: false, reason: "expired" };
  }
  const quotaTotal = Number(license.quotaTotal ?? 0);
  const quotaUsed = Number(license.quotaUsed ?? 0);
  if (quotaTotal >= 0 && quotaUsed >= quotaTotal) return { ok: true, canCreate: false, reason: "quota_exhausted" };
  return { ok: true, canCreate: true, reason: "" };
}

export async function listLicenses() {
  const rows = await listJson("licenses");
  return rows
    .map((row) => row.value)
    .filter((item) => item?.licenseId)
    .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

export async function getLicense(licenseId) {
  if (!licenseId) return null;
  return readJson("licenses", `${licenseId}.json`, null);
}

export async function findLicenseByKey(rawKey) {
  const secretHash = hashSecret(rawKey);
  const indexed = await readJson("license-keys", `${secretHash}.json`, null);
  if (indexed?.licenseId) {
    const license = await getLicense(indexed.licenseId);
    if (license?.licenseHash === secretHash) return license;
  }
  return (await listLicenses()).find((license) => license.licenseHash === secretHash) || null;
}

export async function createLicenseRecord(input = {}) {
  const tenantName = String(input.tenantName || input.companyName || "未命名租户").trim();
  const tenantId = String(input.tenantId || stableTenantId(tenantName)).trim();
  const licenseId = id("lic", tenantName);
  const licenseKey = String(input.licenseKey || "").trim() || friendlyLicenseKey();
  const now = nowIso();
  const license = {
    licenseId,
    tenantId,
    tenantName,
    licenseHash: hashSecret(licenseKey),
    status: input.status || "active",
    quotaTotal: parseQuotaTotal(input),
    quotaUsed: 0,
    maxDevices: Number(input.maxDevices ?? 3),
    expiresAt: input.expiresAt || "",
    allowedModes: input.allowedModes || ["web", "sso", "api"],
    activatedUsers: [],
    recentUsage: [],
    createdAt: now,
    updatedAt: now
  };
  await writeJson("licenses", `${licenseId}.json`, license);
  await writeJson("license-keys", `${license.licenseHash}.json`, {
    licenseId,
    tenantId,
    tenantName,
    createdAt: now,
    updatedAt: now
  });

  let masterKey = "";
  if (input.createMasterKey) {
    masterKey = newSecret("oac_master");
    await writeJson("integrations", `${tenantId}.json`, {
      tenantId,
      tenantName,
      licenseId,
      masterKeyHash: hashSecret(masterKey),
      status: "active",
      createdAt: now,
      updatedAt: now
    });
  }

  return { license: publicLicense(license), licenseKey, masterKey };
}

export async function updateLicenseRecord(licenseId, patch = {}) {
  const current = await getLicense(licenseId);
  if (!current) throw new Error("License 不存在");
  const next = {
    ...current,
    ...Object.fromEntries(Object.entries(patch).filter(([key]) => !["licenseHash", "licenseKey", "quotaUsed"].includes(key))),
    quotaTotal: patch.quotaTotal !== undefined ? Number(patch.quotaTotal) : current.quotaTotal,
    updatedAt: nowIso()
  };
  await writeJson("licenses", `${licenseId}.json`, next);
  return publicLicense(next);
}

export async function rotateLicenseKey(licenseId) {
  const current = await getLicense(licenseId);
  if (!current) throw new Error("License 不存在");
  const licenseKey = friendlyLicenseKey();
  const oldHash = current.licenseHash;
  const next = {
    ...current,
    licenseHash: hashSecret(licenseKey),
    activatedUsers: [],
    updatedAt: nowIso()
  };
  await writeJson("licenses", `${licenseId}.json`, next);
  if (oldHash) await deleteObject("license-keys", `${oldHash}.json`).catch(() => {});
  await writeJson("license-keys", `${next.licenseHash}.json`, {
    licenseId,
    tenantId: next.tenantId,
    tenantName: next.tenantName,
    createdAt: next.createdAt,
    updatedAt: next.updatedAt
  });
  return { license: publicLicense(next), licenseKey };
}

export async function deleteLicenseRecord(licenseId) {
  const current = await getLicense(licenseId);
  if (!current) throw new Error("License 不存在");
  const deleted = { sessions: 0, integration: false };

  if (current.licenseHash) {
    await deleteObject("license-keys", `${current.licenseHash}.json`).catch(() => {});
  }

  const sessions = await listJson("sessions");
  await Promise.all(
    sessions
      .filter((row) => row.value?.licenseId === licenseId)
      .map(async (row) => {
        await deleteObject("sessions", row.key).catch(() => {});
        deleted.sessions += 1;
      })
  );

  if (current.tenantId) {
    const integration = await readJson("integrations", `${current.tenantId}.json`, null);
    if (integration?.licenseId === licenseId) {
      await deleteObject("integrations", `${current.tenantId}.json`).catch(() => {});
      deleted.integration = true;
    }
  }

  await deleteObject("licenses", `${licenseId}.json`);
  return { license: publicLicense(current), deleted };
}

export async function registerLicenseDevice(licenseId, input = {}) {
  const current = await getLicense(licenseId);
  if (!current) throw new Error("License 不存在");
  const deviceId = String(input.deviceId || "").trim() || `unknown-${hashSecret(input.userId || "web-user").slice(0, 12)}`;
  const userId = String(input.userId || "web-user").trim() || "web-user";
  const deviceName = String(input.deviceName || "浏览器设备").trim();
  const maxDevices = Number(current.maxDevices ?? 3);
  const activatedUsers = Array.isArray(current.activatedUsers) ? current.activatedUsers : [];
  const existingIndex = activatedUsers.findIndex((item) => String(item.deviceId || "") === deviceId);
  if (maxDevices >= 0 && existingIndex < 0 && activatedUsers.length >= maxDevices) {
    throw Object.assign(new Error(`该授权最多绑定 ${maxDevices} 台设备，已达到上限`), { status: 403 });
  }
  const now = nowIso();
  const nextDevice = {
    ...(existingIndex >= 0 ? activatedUsers[existingIndex] : {}),
    deviceId,
    userId,
    deviceName,
    firstSeenAt: existingIndex >= 0 ? activatedUsers[existingIndex].firstSeenAt : now,
    lastSeenAt: now
  };
  const nextUsers = existingIndex >= 0
    ? activatedUsers.map((item, index) => (index === existingIndex ? nextDevice : item))
    : [nextDevice, ...activatedUsers];
  const next = { ...current, activatedUsers: nextUsers, updatedAt: now };
  await writeJson("licenses", `${licenseId}.json`, next);
  return next;
}

async function saveSession(session) {
  await writeJson("sessions", `${session.sessionId}.json`, session);
}

export async function issueSession({ tenantId, tenantName, licenseId, userId, mode = "web" }) {
  const now = Date.now();
  const sessionId = id("sess", `${tenantId}:${userId}:${now}`);
  const refreshToken = newSecret("oac_refresh");
  const session = {
    sessionId,
    tenantId,
    tenantName,
    licenseId,
    userId: String(userId || "web-user"),
    mode,
    refreshHash: hashSecret(refreshToken),
    createdAt: nowIso(),
    expiresAt: new Date(now + REFRESH_TOKEN_TTL_MS).toISOString(),
    lastSeenAt: nowIso()
  };
  await saveSession(session);
  const accessToken = signPayload({
    typ: "oac-access",
    sessionId,
    tenantId,
    licenseId,
    userId: session.userId,
    mode,
    exp: now + ACCESS_TOKEN_TTL_MS
  });
  return { accessToken, refreshToken, expiresIn: Math.round(ACCESS_TOKEN_TTL_MS / 1000), session };
}

export async function refreshSession(refreshToken) {
  const tokenHash = hashSecret(refreshToken);
  const rows = await listJson("sessions");
  const session = rows.map((row) => row.value).find((item) => item?.refreshHash === tokenHash);
  if (!session) throw Object.assign(new Error("会话已失效，请重新输入授权码"), { status: 401 });
  if (Date.parse(session.expiresAt || "") < Date.now()) {
    throw Object.assign(new Error("会话已过期，请重新输入授权码"), { status: 401 });
  }
  const license = await getLicense(session.licenseId);
  if (!license) throw Object.assign(new Error("授权不存在或已被删除"), { status: 401 });
  const state = licenseUsableState(license);
  if (!state.ok) throw Object.assign(new Error("授权已失效，请联系管理员"), { status: 403 });
  session.lastSeenAt = nowIso();
  await saveSession(session);
  const now = Date.now();
  const accessToken = signPayload({
    typ: "oac-access",
    sessionId: session.sessionId,
    tenantId: session.tenantId,
    licenseId: session.licenseId,
    userId: session.userId,
    mode: session.mode || "web",
    exp: now + ACCESS_TOKEN_TTL_MS
  });
  return {
    accessToken,
    refreshToken,
    expiresIn: Math.round(ACCESS_TOKEN_TTL_MS / 1000),
    me: {
      tenantId: session.tenantId,
      tenantName: session.tenantName || license.tenantName,
      userId: session.userId,
      license: publicLicense(license),
      canCreate: state.canCreate,
      blockReason: state.reason
    }
  };
}

async function contextFromSessionPayload(payload) {
  const session = await readJson("sessions", `${payload.sessionId}.json`, null);
  if (!session) throw new Error("会话不存在，请重新登录");
  if (Date.parse(session.expiresAt || "") < Date.now()) throw new Error("会话已过期，请重新登录");
  const license = await getLicense(session.licenseId);
  if (!license) throw new Error("授权不存在或已被删除");
  const state = licenseUsableState(license);
  if (!state.ok) throw new Error("授权已失效，请联系管理员");
  session.lastSeenAt = nowIso();
  await saveSession(session).catch(() => {});
  return {
    tenantId: session.tenantId,
    tenantName: session.tenantName || license.tenantName,
    userId: session.userId,
    licenseId: session.licenseId,
    mode: session.mode || payload.mode || "web",
    license,
    licenseState: state,
    canCreate: state.canCreate
  };
}

export async function requireOacContext(request, options = {}) {
  if (env("OAC_AUTH_DISABLED") === "true") {
    const license = {
      licenseId: "local-dev",
      tenantId: "internal-demo",
      tenantName: "Internal Demo",
      status: "active",
      quotaTotal: -1,
      quotaUsed: 0
    };
    return {
      tenantId: "internal-demo",
      tenantName: "Internal Demo",
      userId: "local-dev",
      licenseId: "local-dev",
      mode: "local-dev",
      license,
      licenseState: licenseUsableState(license),
      canCreate: true
    };
  }
  const auth = request.headers.get("authorization") || "";
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1] || request.headers.get("x-oac-token") || "";
  if (!token) throw Object.assign(new Error("请先输入授权码"), { status: 401 });
  const payload = verifySignedToken(token);
  const context = await contextFromSessionPayload(payload);
  if (options.requireCreate && !context.canCreate) {
    throw Object.assign(new Error(licenseBlockMessage(context.licenseState.reason)), { status: 402 });
  }
  return context;
}

export async function withOacRequestContext(request, fn, options = {}) {
  const context = await requireOacContext(request, options);
  return withTenantContext(context, () => fn(context));
}

export async function requireOacApiContext(request, options = {}) {
  const licenseKey = request.headers.get("x-oac-license-key") || request.headers.get("x-api-key") || "";
  if (licenseKey) {
    const license = await findLicenseByKey(licenseKey);
    if (!license) throw Object.assign(new Error("API license 无效"), { status: 401 });
    const state = licenseUsableState(license);
    if (!state.ok) throw Object.assign(new Error("授权已失效"), { status: 403 });
    if (options.requireCreate && !state.canCreate) {
      throw Object.assign(new Error(licenseBlockMessage(state.reason)), { status: 402 });
    }
    return {
      tenantId: license.tenantId,
      tenantName: license.tenantName,
      userId: request.headers.get("x-oac-user-id") || "api-user",
      licenseId: license.licenseId,
      mode: "api",
      license,
      licenseState: state,
      canCreate: state.canCreate
    };
  }
  return requireOacContext(request, options);
}

export async function withOacApiContext(request, fn, options = {}) {
  const context = await requireOacApiContext(request, options);
  return withTenantContext(context, () => fn(context));
}

export function contextFromJob(job = {}) {
  const tenantId = job.tenantId || job.oacContext?.tenantId || job.company?.tenantId || "internal-demo";
  const licenseId = job.licenseId || job.oacContext?.licenseId || "";
  return {
    tenantId,
    tenantName: job.tenantName || job.oacContext?.tenantName || "",
    userId: job.userId || job.oacContext?.userId || "background",
    licenseId,
    mode: job.oacContext?.mode || "background"
  };
}

export async function withJobTenantContext(job, fn) {
  return withTenantContext(contextFromJob(job), fn);
}

export function attachContextToJobPatch(context, patch = {}) {
  if (!context) return patch;
  return {
    ...patch,
    tenantId: context.tenantId,
    tenantName: context.tenantName,
    userId: context.userId,
    licenseId: context.licenseId,
    oacContext: {
      tenantId: context.tenantId,
      tenantName: context.tenantName,
      userId: context.userId,
      licenseId: context.licenseId,
      mode: context.mode || "web"
    }
  };
}

export async function createJobRoute(jobId, context) {
  if (!jobId || !context?.tenantId) return;
  await writeJson("job-routes", `${jobId}.json`, {
    jobId,
    tenantId: context.tenantId,
    tenantName: context.tenantName,
    licenseId: context.licenseId,
    userId: context.userId,
    createdAt: nowIso()
  });
}

export async function getJobRoute(jobId) {
  return readJson("job-routes", `${jobId}.json`, null);
}

export async function recordSuccessfulUsage(context, input = {}) {
  if (!context?.licenseId || context.licenseId === "local-dev") return null;
  const license = await getLicense(context.licenseId);
  if (!license) return null;
  const usageId = id("usage", `${context.tenantId}:${input.type || "usage"}:${input.jobId || input.reportId || ""}:${Date.now()}`);
  const now = nowIso();
  const month = now.slice(0, 7);
  const usage = {
    usageId,
    tenantId: context.tenantId,
    tenantName: context.tenantName || license.tenantName,
    licenseId: context.licenseId,
    userId: context.userId || "unknown",
    type: input.type || "report",
    jobId: input.jobId || "",
    reportId: input.reportId || "",
    createdAt: now
  };
  await writeJson("usage", `${context.tenantId}/${month}/${usageId}.json`, usage);
  const next = {
    ...license,
    quotaUsed: Number(license.quotaUsed || 0) + 1,
    recentUsage: [usage, ...(license.recentUsage || [])].slice(0, 20),
    updatedAt: now
  };
  await writeJson("licenses", `${license.licenseId}.json`, next);
  return usage;
}

export function licenseBlockMessage(reason) {
  if (reason === "paused") return "当前授权已暂停，可以查看历史报告，暂不能创建新任务";
  if (reason === "expired") return "当前授权已到期，可以查看历史报告，暂不能创建新任务";
  if (reason === "quota_exhausted") return "当前授权次数已用完，可以查看历史报告，暂不能创建新任务";
  if (reason === "revoked") return "当前授权已吊销";
  return "当前授权不可创建新任务";
}

export async function verifyAdmin(request) {
  const configured = env("ADMIN_SECRET");
  const provided =
    request.headers.get("x-admin-secret") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  if (!configured || provided !== configured) {
    throw Object.assign(new Error("管理员密钥无效"), { status: 401 });
  }
  return true;
}

export async function createSsoCode({ tenantId, tenantName, licenseId, userId, mode = "sso" }) {
  const code = newSecret("oac_sso");
  const now = nowIso();
  await writeJson("sso-codes", `${hashSecret(code)}.json`, {
    codeHash: hashSecret(code),
    tenantId,
    tenantName,
    licenseId,
    userId: String(userId || "enterprise-user"),
    mode,
    usedAt: "",
    expiresAt: new Date(Date.now() + SSO_CODE_TTL_MS).toISOString(),
    createdAt: now
  });
  return code;
}

export async function exchangeSsoCode(code) {
  const key = `${hashSecret(code)}.json`;
  const saved = await readJson("sso-codes", key, null);
  if (!saved || saved.usedAt) throw new Error("SSO code 无效或已使用");
  if (Date.parse(saved.expiresAt || "") < Date.now()) throw new Error("SSO code 已过期");
  const license = await getLicense(saved.licenseId);
  const state = licenseUsableState(license);
  if (!license || !state.ok) throw new Error("授权已失效");
  saved.usedAt = nowIso();
  await writeJson("sso-codes", key, saved);
  return issueSession({
    tenantId: saved.tenantId,
    tenantName: saved.tenantName,
    licenseId: saved.licenseId,
    userId: saved.userId,
    mode: saved.mode || "sso"
  });
}

export async function findIntegrationByMasterKey(masterKey, tenantId = "") {
  const targetHash = hashSecret(masterKey);
  if (tenantId) {
    const integration = await readJson("integrations", `${tenantId}.json`, null);
    return integration?.masterKeyHash === targetHash ? integration : null;
  }
  const rows = await listJson("integrations");
  return rows.map((row) => row.value).find((item) => item?.masterKeyHash === targetHash) || null;
}
