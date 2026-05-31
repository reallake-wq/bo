import { fail, json } from "../lib/http.mjs";
import { publicLicense, requireOacContext } from "../lib/auth.mjs";

export default async function handler(request) {
  try {
    const context = await requireOacContext(request);
    return json({
      ok: true,
      me: {
        tenantId: context.tenantId,
        tenantName: context.tenantName,
        userId: context.userId,
        licenseId: context.licenseId,
        mode: context.mode,
        license: publicLicense(context.license),
        canCreate: context.canCreate,
        blockReason: context.licenseState?.reason || ""
      }
    });
  } catch (error) {
    return fail(error?.message || "未授权", error?.status || 401);
  }
}
