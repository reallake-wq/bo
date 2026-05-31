import { fail, json, readBody } from "../lib/http.mjs";
import { createLicenseRecord, deleteLicenseRecord, listLicenses, publicLicense, rotateLicenseKey, updateLicenseRecord, verifyAdmin } from "../lib/auth.mjs";
import { listJson, withTenantContext } from "../lib/store.mjs";

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function publicBoundProfile(profile = {}) {
  return {
    profileId: profile.profileId || "",
    companyName: profile.companyName || profile.name || "",
    mainBusiness: profile.mainBusiness || profile.summary || "",
    coreProducts: arr(profile.coreProducts || profile.coreOfferings).slice(0, 5),
    updatedAt: profile.updatedAt || "",
    sourceName: profile.sourceCandidate?.standardName || profile.sourceCandidate?.name || ""
  };
}

async function adminLicenseView(license = {}) {
  const boundProfiles = license.tenantId
    ? await withTenantContext({ tenantId: license.tenantId }, async () =>
        (await listJson("profiles"))
          .map((row) => publicBoundProfile(row.value))
          .filter((profile) => profile.profileId && profile.companyName)
      )
    : [];
  return {
    ...publicLicense(license),
    boundProfiles
  };
}

export default async function handler(request) {
  try {
    await verifyAdmin(request);
    if (request.method === "GET") {
      const licenses = await Promise.all((await listLicenses()).map(adminLicenseView));
      return json({ ok: true, licenses });
    }
    if (request.method === "POST") {
      const body = await readBody(request);
      const result = await createLicenseRecord(body);
      return json({ ok: true, ...result });
    }
    if (request.method === "PATCH") {
      const body = await readBody(request);
      const licenseId = String(body.licenseId || "").trim();
      if (!licenseId) return fail("缺少 licenseId", 400);
      if (body.action === "rotateKey" || body.resetKey) {
        const result = await rotateLicenseKey(licenseId);
        return json({ ok: true, ...result });
      }
      const license = await updateLicenseRecord(licenseId, body.patch || body);
      return json({ ok: true, license });
    }
    if (request.method === "DELETE") {
      const body = await readBody(request);
      const licenseId = String(body.licenseId || "").trim();
      if (!licenseId) return fail("缺少 licenseId", 400);
      const result = await deleteLicenseRecord(licenseId);
      return json({ ok: true, ...result });
    }
    return fail("Method not allowed", 405);
  } catch (error) {
    return fail(error?.message || "License 管理失败", error?.status || 500);
  }
}
