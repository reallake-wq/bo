import { fail, json, readBody } from "../lib/http.mjs";
import { removeProfile } from "../lib/profiles.mjs";

export default async function handler(request) {
  try {
    const body = await readBody(request);
    const result = await removeProfile(String(body.profileId || "").trim());
    return json({ ok: true, ...result });
  } catch (error) {
    return fail(error?.message || "删除我的企业失败", 500);
  }
}
