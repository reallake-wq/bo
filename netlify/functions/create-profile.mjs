import { fail, json, readBody } from "../lib/http.mjs";
import { createProfile } from "../lib/profiles.mjs";

export default async function handler(request) {
  try {
    const body = await readBody(request);
    const profile = await createProfile(body.companyName || body.name, body.candidate || null);
    return json({ ok: true, profile });
  } catch (error) {
    return fail(error?.message || "创建我的企业失败", 500);
  }
}
