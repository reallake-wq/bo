export const DEEPSEEK_CHANNELS = ["deepseek-official"];
export const INTL_RESEARCH_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"];
export const CN_RESEARCH_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"];

function cleanHost(hostname = "") {
  return String(hostname || "")
    .split(",")[0]
    .trim()
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .split(":")[0]
    .toLowerCase();
}

function modeFromPath(pathname = "") {
  const first = String(pathname || "")
    .split("/")
    .filter(Boolean)[0]
    ?.toLowerCase();
  if (/^(cn|china|domestic)$/.test(first || "")) return "deepseek";
  if (/^(intl|international)$/.test(first || "")) return "deepseek";
  return "";
}

export function runtimeModeFromHostname(hostname = "") {
  return {
    mode: "deepseek",
    label: "DeepSeek官方",
    hostname: cleanHost(hostname),
    channelOrder: [...DEEPSEEK_CHANNELS],
    researchModels: ["deepseek-v4-flash", "deepseek-v4-pro"]
  };
}

export function runtimeModeFromRequest(request) {
  let parsedUrl = null;
  try {
    parsedUrl = new URL(request.url);
  } catch {
    parsedUrl = null;
  }
  const pathMode = modeFromPath(parsedUrl?.pathname || "");
  if (pathMode) return runtimeModeFromHostname(parsedUrl?.host || "");
  const forwardedHost =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    request.headers.get("x-original-host") ||
    parsedUrl?.host ||
    "";
  return runtimeModeFromHostname(forwardedHost);
}

export function normalizeRuntimeMode(value) {
  if (value && typeof value === "object" && Array.isArray(value.channelOrder)) return value;
  return runtimeModeFromHostname(typeof value === "string" ? value : "");
}
