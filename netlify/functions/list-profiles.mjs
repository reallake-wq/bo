import { fail, json } from "../lib/http.mjs";
import { listProfiles } from "../lib/profiles.mjs";
import { withOacRequestContext } from "../lib/auth.mjs";

export default async function handler(request) {
  try {
    return await withOacRequestContext(request, async () => {
      const profiles = await listProfiles();
      return json({ ok: true, profiles });
    });
  } catch (error) {
    return fail(error?.message || "未授权", error?.status || 401);
  }
}
