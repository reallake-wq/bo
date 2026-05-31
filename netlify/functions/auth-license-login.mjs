import { fail, json, readBody } from "../lib/http.mjs";
import { findLicenseByKey, issueSession, licenseUsableState, publicLicense, registerLicenseDevice } from "../lib/auth.mjs";

export default async function handler(request) {
  try {
    if (request.method !== "POST") return fail("仅支持 POST", 405);
    const body = await readBody(request);
    const licenseKey = String(body.licenseKey || "").trim();
    const userId = String(body.userId || body.userName || "web-user").trim() || "web-user";
    const deviceId = String(body.deviceId || "").trim();
    const deviceName = String(body.deviceName || "").trim();
    if (!licenseKey) return fail("请输入授权码", 400);
    const license = await findLicenseByKey(licenseKey);
    if (!license) return fail("授权码无效", 401);
    const state = licenseUsableState(license);
    if (!state.ok) return fail("授权已失效，请联系管理员", 403);
    const updatedLicense = await registerLicenseDevice(license.licenseId, { deviceId, deviceName, userId });
    const session = await issueSession({
      tenantId: updatedLicense.tenantId,
      tenantName: updatedLicense.tenantName,
      licenseId: updatedLicense.licenseId,
      userId,
      mode: "web"
    });
    return json({
      ok: true,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresIn: session.expiresIn,
      me: {
        tenantId: updatedLicense.tenantId,
        tenantName: updatedLicense.tenantName,
        userId,
        license: publicLicense(updatedLicense),
        canCreate: state.canCreate,
        blockReason: state.reason
      }
    });
  } catch (error) {
    return fail(error?.message || "授权登录失败", error?.status || 500);
  }
}
