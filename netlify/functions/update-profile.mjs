import { fail, json, readBody } from "../lib/http.mjs";
import { saveProfile } from "../lib/profiles.mjs";
import { withOacRequestContext } from "../lib/auth.mjs";

export default async function handler(request) {
  try {
    return await withOacRequestContext(request, async () => {
      const body = await readBody(request);
      const profile = await saveProfile(body.profile || body);
      return json({ ok: true, profile });
    });
  } catch (error) {
    return fail(error?.message || "保存我的企业失败", error?.status || 500);
  }
}
