import { fail, json, readBody } from "../lib/http.mjs";
import { refreshSession } from "../lib/auth.mjs";

export default async function handler(request) {
  try {
    if (request.method !== "POST") return fail("仅支持 POST", 405);
    const body = await readBody(request);
    const refreshToken = String(body.refreshToken || "").trim();
    if (!refreshToken) return fail("会话已失效，请重新输入授权码", 401);
    const session = await refreshSession(refreshToken);
    return json({ ok: true, ...session });
  } catch (error) {
    return fail(error?.message || "会话续期失败", error?.status || 500);
  }
}
