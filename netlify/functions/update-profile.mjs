import { fail, json, readBody } from "../lib/http.mjs";
import { saveProfile } from "../lib/profiles.mjs";

export default async function handler(request) {
  try {
    const body = await readBody(request);
    const profile = await saveProfile(body.profile || body);
    return json({ ok: true, profile });
  } catch (error) {
    return fail(error?.message || "保存我的企业失败", 500);
  }
}
