import { fail, json, readBody } from "../lib/http.mjs";
import { createSsoCode, findIntegrationByMasterKey, getLicense, licenseUsableState } from "../lib/auth.mjs";

export default async function handler(request) {
  try {
    if (request.method !== "POST") return fail("仅支持 POST", 405);
    const body = await readBody(request);
    const masterKey = request.headers.get("x-oac-master-key") || String(body.masterKey || "").trim();
    const tenantId = String(body.tenantId || "").trim();
    const userId = String(body.userId || body.userName || "enterprise-user").trim() || "enterprise-user";
    if (!masterKey) return fail("缺少 Master API Key", 401);
    const integration = await findIntegrationByMasterKey(masterKey, tenantId);
    if (!integration || integration.status === "revoked" || integration.status === "paused") return fail("Master API Key 无效", 401);
    const licenseId = String(body.licenseId || integration.licenseId || "").trim();
    const license = licenseId ? await getLicense(licenseId) : null;
    if (license) {
      const state = licenseUsableState(license);
      if (!state.ok) return fail("授权已失效", 403);
    }
    const code = await createSsoCode({
      tenantId: integration.tenantId,
      tenantName: integration.tenantName,
      licenseId: license?.licenseId || licenseId,
      userId,
      mode: "sso"
    });
    return json({ ok: true, code, url: `?sso=${encodeURIComponent(code)}` });
  } catch (error) {
    return fail(error?.message || "企业会话创建失败", error?.status || 500);
  }
}
