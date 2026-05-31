import { fail, json, readBody } from "../lib/http.mjs";
import { exchangeSsoCode, publicLicense, getLicense, licenseUsableState } from "../lib/auth.mjs";

export default async function handler(request) {
  try {
    if (request.method !== "POST") return fail("仅支持 POST", 405);
    const body = await readBody(request);
    const code = String(body.code || "").trim();
    if (!code) return fail("缺少 SSO code", 400);
    const session = await exchangeSsoCode(code);
    const license = await getLicense(session.session.licenseId);
    const state = licenseUsableState(license);
    return json({
      ok: true,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresIn: session.expiresIn,
      me: {
        tenantId: session.session.tenantId,
        tenantName: session.session.tenantName,
        userId: session.session.userId,
        license: publicLicense(license),
        canCreate: state.canCreate,
        blockReason: state.reason
      }
    });
  } catch (error) {
    return fail(error?.message || "SSO 登录失败", error?.status || 500);
  }
}
