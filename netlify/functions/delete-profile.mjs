import { fail, json, readBody } from "../lib/http.mjs";
import { removeProfile } from "../lib/profiles.mjs";
import { withOacRequestContext } from "../lib/auth.mjs";

export default async function handler(request) {
  try {
    return await withOacRequestContext(request, async () => {
      const body = await readBody(request);
      const result = await removeProfile(String(body.profileId || "").trim());
      return json({ ok: true, ...result });
    });
  } catch (error) {
    return fail(error?.message || "删除我的企业失败", error?.status || 500);
  }
}
