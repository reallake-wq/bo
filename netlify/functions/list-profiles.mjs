import { json } from "../lib/http.mjs";
import { listProfiles } from "../lib/profiles.mjs";

export default async function handler() {
  const profiles = await listProfiles();
  return json({ ok: true, profiles });
}
