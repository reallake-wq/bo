import { fail, json, readBody } from "../lib/http.mjs";
import { createProfile } from "../lib/profiles.mjs";
import { withOacRequestContext } from "../lib/auth.mjs";

export default async function handler(request) {
  try {
    return await withOacRequestContext(request, async () => {
      const body = await readBody(request);
      const profile = await createProfile(body.companyName || body.name, body.candidate || null);
      return json({ ok: true, profile });
    });
  } catch (error) {
    return fail(error?.message || "创建我的企业失败", error?.status || 500);
  }
}
