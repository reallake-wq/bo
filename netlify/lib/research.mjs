import { callModel, extractJson } from "./ai.mjs";
import { clip, env, uniqBy } from "./util.mjs";
import { evaluateSourceQuality, TOPIC_NAMES } from "./report-quality.mjs?v=oac-insight-20260531a";
import { DEEPSEEK_FLASH_MODEL, DEEPSEEK_PRO_MODEL } from "./ai.mjs";
import { collectTianyanchaEvidence, hasTianyanchaKey, resolveTianyanchaCandidateDetailed } from "./tianyancha.mjs";
import { sourceFamilyOf } from "./source-audit.mjs?v=oac-insight-20260531a";

const SEARCH_RESULT_LIMIT = 10;
const TOPIC_READ_LIMIT = 36;
const RESCUE_READ_LIMIT = 48;
const SOURCE_POOL_TARGET = 60;
const SEARCH_TIMEOUT_MS = 12000;
const MODEL_PLANNING_TIMEOUT_MS = 60000;
const STRONG_SOURCE_POOL_TARGET = 72;

const RESEARCH_MODEL_ROUTES = [
  { model: DEEPSEEK_FLASH_MODEL },
  { model: DEEPSEEK_PRO_MODEL }
];

const SEARCH_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.8"
};

const [
  TOPIC_SUBJECT = "企业主体与本地信息",
  TOPIC_FINANCE = "经营规模与财务",
  TOPIC_MARKET = "产品客户与市场压力",
  TOPIC_DIGITAL = "数字化与AI线索",
  TOPIC_PAIN = "痛点证据与方案机会"
] = TOPIC_NAMES;

function arr(value) {
  return Array.isArray(value) ? value : [];
}

export function extractStockCode(...values) {
  const text = values.map((item) => String(item || "")).join(" ");
  return Array.from(new Set(text.match(/(?<!\d)(?:60|68|00|30|83|87|43|92)\d{4}(?!\d)/g) || []))[0] || "";
}

function stockExchange(code = "") {
  if (/^(60|68)/.test(code)) return { market: "上交所", secid: `1.${code}`, prefix: "SH" };
  if (/^(00|30)/.test(code)) return { market: "深交所", secid: `0.${code}`, prefix: "SZ" };
  if (/^(83|87|43|92)/.test(code)) return { market: "北交所", secid: `0.${code}`, prefix: "BJ" };
  return { market: "", secid: code, prefix: "" };
}

function companyStockInfo(company = {}) {
  const code = company.stockCode || extractStockCode(company.standardName, company.name, company.query, company.region, company.industry, company.aiNeeds, company.userContext?.aiNeeds);
  return code ? { code, ...stockExchange(code) } : null;
}

function jinaHeaders(accept = "text/plain") {
  const headers = { accept, "user-agent": SEARCH_HEADERS["user-agent"] };
  if (env("JINA_API_KEY")) headers.authorization = `Bearer ${env("JINA_API_KEY")}`;
  return headers;
}

async function fetchText(url, timeoutMs = 30000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        ...SEARCH_HEADERS,
        ...(options.jina ? jinaHeaders(options.accept || "text/plain") : {}),
        ...(options.headers || {})
      }
    });
    if (!response.ok) return "";
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "";
    const head = buffer.slice(0, 2048).toString("latin1");
    const charset = (contentType.match(/charset=([^;\s]+)/i)?.[1] || head.match(/charset=["']?([^"'\s/>]+)/i)?.[1] || "").toLowerCase();
    if (/gb|big5|shift_jis/.test(charset)) {
      try {
        return new TextDecoder(charset === "gb2312" || charset === "gbk" ? "gb18030" : charset).decode(buffer);
      } catch {
        return new TextDecoder("gb18030").decode(buffer);
      }
    }
    return new TextDecoder("utf-8").decode(buffer);
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function decodeBingTarget(value) {
  try {
    const parsed = new URL(value);
    if (!parsed.hostname.toLowerCase().endsWith("bing.com") || !parsed.pathname.startsWith("/ck/")) return value;
    const raw = parsed.searchParams.get("u");
    if (!raw) return "";
    if (raw.startsWith("http")) return raw;
    const payload = raw.startsWith("a1") ? raw.slice(2) : raw;
    const decoded = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return decoded.startsWith("http") ? decoded : "";
  } catch {
    return value;
  }
}

function normalizeUrl(value) {
  let url = decodeHtml(value).trim().replace(/[),.;，。]+$/g, "");
  if (url.startsWith("//")) url = `https:${url}`;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("duckduckgo.com") && parsed.pathname.startsWith("/l/")) {
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) url = decodeURIComponent(uddg);
    }
    url = decodeBingTarget(url);
  } catch {
    return "";
  }
  return url;
}

function domainOf(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isBadSourceUrl(url = "") {
  const value = String(url).toLowerCase();
  return /kanji|jiten|zidian|cidian|hanyu|zdic|dictionary|wiktionary|youdao|iciba|bing\.com\/search|google\.com\/search|baidu\.com\/s\?|news\.so\.com\/ns|image\.so\.com\/i|so\.com\/(?:link|s\?|help)|info\.so\.com|map\.360\.cn|hao\.360\.com|e\.360\.cn|bbs\.360\.cn|zhanzhang\.so\.com|sogou\.com\/web|duckduckgo\.com\/html|shuidi\.cn\/(?:owner_resume|person)/.test(value);
}

function validUrl(value) {
  if (!/^https?:\/\//i.test(value)) return false;
  const lower = value.toLowerCase();
  if (lower.includes("jina.ai")) return false;
  if (lower.includes("javascript:")) return false;
  if (lower.includes("duckduckgo.com/l/")) return false;
  if (lower.includes("bing.com/ck/")) return false;
  if (lower.includes("bing.com/search")) return false;
  if (lower.includes("baidu.com/s?")) return false;
  if (isBadSourceUrl(value)) return false;
  try {
    const host = new URL(value).hostname;
    if (!host.includes(".") && host !== "localhost") return false;
  } catch {
    return false;
  }
  return true;
}

function cleanTitle(value, fallback = "资料来源") {
  let raw = decodeHtml(value || fallback);
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // Keep original text when it is not URI encoded.
  }
  return raw
    .replace(/<!--red_(?:beg|end)-->/g, "")
    .replace(/[]/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function htmlToText(value) {
  return decodeHtml(
    String(value || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function searchTerms(query) {
  return String(query || "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !/^(官网|工商|公司简介|新闻|案例|报告|官方|AI|ERP|MES|PLM|QMS|APS)$/i.test(item));
}

function relevanceScore(item, query) {
  const haystack = `${item.title || ""} ${item.snippet || ""} ${item.url || ""}`.toLowerCase();
  let score = 0;
  for (const term of searchTerms(query)) {
    const normalized = term.toLowerCase();
    if (haystack.includes(normalized)) {
      score += normalized.length >= 6 ? 3 : 2;
      continue;
    }
    const grams = normalized.match(/[\u4e00-\u9fa5]{2}/g) || [];
    const gramHits = grams.filter((gram) => haystack.includes(gram)).length;
    if (gramHits >= 2) score += 1;
  }
  return score;
}

function parseSearchPayload(raw, query, topic, provider) {
  if (!raw) return [];
  let payload = raw;
  if (typeof raw === "string") {
    try {
      payload = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const rows = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload)
          ? payload
          : [];
  return rows
    .map((row) => {
      const url = normalizeUrl(row.url || row.link || row.href || row.source);
      return {
        title: cleanTitle(row.title || row.name || url),
        url,
        snippet: clip(row.content || row.description || row.snippet || "", 700),
        query,
        topic,
        provider
      };
    })
    .filter((item) => validUrl(item.url));
}

function parseJinaSearchText(text, query, topic, provider) {
  const results = [];
  const value = String(text || "");
  const linkRe = /\[([^\]]{2,180})\]\((https?:\/\/[^)\s]+)\)/g;
  for (const match of value.matchAll(linkRe)) {
    const url = normalizeUrl(match[2]);
    if (validUrl(url)) results.push({ title: cleanTitle(match[1], url), url, query, topic, provider });
  }
  const blockRe = /(?:^|\n)Title:\s*([^\n]+)\n(?:URL Source|URL|Source):\s*(https?:\/\/[^\s]+)/gi;
  for (const match of value.matchAll(blockRe)) {
    const url = normalizeUrl(match[2]);
    if (validUrl(url)) results.push({ title: cleanTitle(match[1], url), url, query, topic, provider });
  }
  return uniqBy(results, (item) => item.url);
}

async function searchJina(query, limit, topic, timeoutMs = SEARCH_TIMEOUT_MS) {
  const urls = [`https://s.jina.ai/?q=${encodeURIComponent(query)}`, `https://s.jina.ai/${encodeURIComponent(query)}`];
  const results = [];
  for (const url of urls) {
    const jsonText = await fetchText(url, timeoutMs, { accept: "application/json", jina: true });
    results.push(...parseSearchPayload(jsonText, query, topic, "jina"));
    if (results.length >= limit) break;
    const text = await fetchText(url, timeoutMs, { accept: "text/plain", jina: true });
    results.push(...parseJinaSearchText(text, query, topic, "jina"));
    if (results.length >= limit) break;
  }
  return uniqBy(results, (item) => item.url);
}

function parseSogou(text, query, topic) {
  const results = [];
  const value = String(text || "");
  const cardRe = /<div[^>]+class="[^"]*(?:result|vrwrap|rb)[^"]*"[\s\S]*?(?=<div[^>]+class="[^"]*(?:result|vrwrap|rb)|<\/body>)/gi;
  for (const blockMatch of value.matchAll(cardRe)) {
    const block = blockMatch[0];
    const dataUrl = block.match(/\sdata-url="([^"]+)"/i)?.[1];
    const dataTitle = block.match(/\sdata-title="([^"]+)"/i)?.[1];
    const citeUrl = block.match(/<a[^>]+class="[^"]*citeLinkClass[^"]*"[^>]+href="([^"]+)"/i)?.[1];
    const titleMatch =
      block.match(/<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/i) ||
      block.match(/<a[^>]+class="[^"]*(?:pt|title|result-title)[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = block.match(/<div[^>]+class="[^"]*(?:fz-mid|str_info|text-layout|ft)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const rawUrl = dataUrl || citeUrl || "";
    const url = normalizeUrl(rawUrl.startsWith("/") ? `https://www.sogou.com${rawUrl}` : rawUrl);
    if (validUrl(url)) {
      results.push({
        title: cleanTitle(titleMatch?.[1] || dataTitle || url, url),
        url,
        snippet: clip(cleanTitle(snippetMatch?.[1] || "", ""), 700),
        query,
        topic,
        provider: "sogou"
      });
    }
  }
  const dataRe = /\sdata-url="(https?:\/\/[^"]+)"[^>]*\sdata-title="([^"]*)"/gi;
  for (const match of value.matchAll(dataRe)) {
    const url = normalizeUrl(match[1]);
    if (validUrl(url)) results.push({ title: cleanTitle(match[2] || url, url), url, query, topic, provider: "sogou" });
  }
  return uniqBy(results, (item) => item.url);
}

async function searchSogou(query, limit, topic, timeoutMs = SEARCH_TIMEOUT_MS) {
  const text = await fetchText(`https://www.sogou.com/web?query=${encodeURIComponent(query)}`, timeoutMs);
  return parseSogou(text, query, topic).slice(0, limit);
}

function parseSo360(text, query, topic) {
  const results = [];
  const value = String(text || "");
  const blockRe = /<li[^>]+class=["'][^"']*res-list[^"']*["'][\s\S]*?(?=<li[^>]+class=["'][^"']*res-list|<\/ol>|<\/body>)/gi;
  for (const blockMatch of value.matchAll(blockRe)) {
    const block = blockMatch[0];
    const snippet =
      block.match(/<p[^>]+class=["'][^"']*(?:res-desc|mh-content|g-linkinfo)[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ||
      block.match(/<div[^>]+class=["'][^"']*(?:res-desc|mh-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
      "";
    const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    for (const anchor of block.matchAll(anchorRe)) {
      const attrs = anchor[1] || "";
      const rawUrl =
        attrs.match(/\sdata-mdurl=["']([^"']+)["']/i)?.[1] ||
        attrs.match(/\shref=["']([^"']+)["']/i)?.[1] ||
        "";
      const url = normalizeUrl(rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl);
      if (!validUrl(url)) continue;
      results.push({
        title: cleanTitle(anchor[2] || url, url),
        url,
        snippet: clip(cleanTitle(snippet || "", ""), 700),
        query,
        topic,
        provider: "so360"
      });
    }
  }
  const mdUrlRe = /data-mdurl=["'](https?:\/\/[^"']+)["'][\s\S]{0,260}?>([\s\S]{0,180}?)<\/a>/gi;
  for (const match of value.matchAll(mdUrlRe)) {
    const url = normalizeUrl(match[1]);
    if (validUrl(url)) results.push({ title: cleanTitle(match[2] || url, url), url, query, topic, provider: "so360" });
  }
  return uniqBy(results, (item) => item.url);
}

export async function searchSo360(query, limit, topic, timeoutMs = SEARCH_TIMEOUT_MS) {
  const text = await fetchText(`https://www.so.com/s?q=${encodeURIComponent(query)}`, timeoutMs);
  return parseSo360(text, query, topic).slice(0, limit);
}

function parseDuckDuckGo(text, query, topic, provider) {
  const results = [];
  const value = String(text || "");
  const anchorRe = /<a[^>]+class=['"][^'"]*result-link[^'"]*['"][^>]+href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of value.matchAll(anchorRe)) {
    const url = normalizeUrl(match[1]);
    if (validUrl(url)) results.push({ title: cleanTitle(match[2], url), url, query, topic, provider });
  }
  const uddgRe = /href=['"]([^'"]*duckduckgo\.com\/l\/\?uddg=[^'"]+)['"][^>]*>([\s\S]{0,260}?)<\/a>/gi;
  for (const match of value.matchAll(uddgRe)) {
    const url = normalizeUrl(match[1]);
    if (validUrl(url)) results.push({ title: cleanTitle(match[2], url), url, query, topic, provider });
  }
  return uniqBy(results, (item) => item.url);
}

async function searchDuckDuckGo(query, limit, topic, timeoutMs = SEARCH_TIMEOUT_MS) {
  const urls = [
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  ];
  const results = [];
  for (const url of urls) {
    const text = await fetchText(url, timeoutMs);
    results.push(...parseDuckDuckGo(text, query, topic, url.includes("lite") ? "duckduckgo-lite" : "duckduckgo-html"));
    if (results.length >= limit) break;
  }
  return uniqBy(results, (item) => item.url).slice(0, limit);
}

function parseBing(text, query, topic) {
  const results = [];
  const value = String(text || "");
  const blockRe = /<li class="b_algo"[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of value.matchAll(blockRe)) {
    const url = normalizeUrl(match[1]);
    if (validUrl(url)) results.push({ title: cleanTitle(match[2], url), url, query, topic, provider: "bing" });
  }
  return uniqBy(results, (item) => item.url);
}

async function searchBing(query, limit, topic, timeoutMs = SEARCH_TIMEOUT_MS) {
  const text = await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, timeoutMs);
  return parseBing(text, query, topic).slice(0, limit);
}

function parseBochaPayload(payload, query, topic) {
  const rows =
    payload?.data?.webPages?.value ||
    payload?.webPages?.value ||
    payload?.data?.webPages ||
    payload?.data?.results ||
    payload?.results ||
    payload?.items ||
    [];
  return arr(rows)
    .map((row) => {
      const url = normalizeUrl(row.url || row.link || row.href || row.site || row.source);
      return {
        title: cleanTitle(row.name || row.title || row.siteName || row.url || "博查搜索结果"),
        url,
        snippet: clip(row.snippet || row.summary || row.content || row.description || "", 900),
        query,
        topic,
        provider: "bocha",
        bochaScore: row.score || row.rank || ""
      };
    })
    .filter((item) => validUrl(item.url));
}

function parseTavilyPayload(payload, query, topic) {
  const rows = payload?.results || payload?.data?.results || payload?.items || [];
  return arr(rows)
    .map((row) => {
      const url = normalizeUrl(row.url || row.link || row.href || row.source);
      return {
        title: cleanTitle(row.title || row.name || url || "Tavily搜索结果"),
        url,
        snippet: clip(row.content || row.snippet || row.summary || row.description || "", 900),
        query,
        topic,
        provider: "tavily",
        tavilyScore: row.score || row.rank || ""
      };
    })
    .filter((item) => validUrl(item.url));
}

function withSearchDiagnostics(results = [], diagnostics = []) {
  const rows = Array.isArray(results) ? results : arr(results);
  const cleanDiagnostics = arr(diagnostics).filter(Boolean);
  const descriptor = Object.getOwnPropertyDescriptor(rows, "searchDiagnostics");
  const target = descriptor && !descriptor.configurable ? [...rows] : rows;
  Object.defineProperty(target, "searchDiagnostics", {
    value: cleanDiagnostics,
    enumerable: false,
    configurable: true
  });
  return target;
}

async function searchBocha(query, limit, topic, timeoutMs = SEARCH_TIMEOUT_MS) {
  const apiKey = env("BOCHA_API_KEY");
  if (!apiKey) {
    return withSearchDiagnostics([], [{ provider: "bocha", ok: false, status: "missing_key", count: 0, message: "未配置 BOCHA_API_KEY" }]);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://api.bochaai.com/v1/web-search", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        query,
        freshness: "noLimit",
        summary: true,
        count: Math.max(5, Math.min(20, Number(limit || SEARCH_RESULT_LIMIT)))
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      let message = response.statusText || "请求失败";
      try {
        const payload = await response.json();
        message = payload?.message || payload?.error || message;
      } catch {
        // Keep status text.
      }
      return withSearchDiagnostics([], [{ provider: "bocha", ok: false, status: response.status, count: 0, message }]);
    }
    const payload = await response.json();
    const rows = parseBochaPayload(payload, query, topic);
  return withSearchDiagnostics(rows, [{ provider: "bocha", ok: true, status: response.status, count: rows.length, message: rows.length ? "博查已返回候选来源" : "博查返回为空" }]);
  } catch (error) {
    return withSearchDiagnostics([], [{ provider: "bocha", ok: false, status: "error", count: 0, message: error?.name === "AbortError" ? "请求超时" : error?.message || "请求异常" }]);
  } finally {
    clearTimeout(timer);
  }
}

async function searchTavily(query, limit, topic, timeoutMs = SEARCH_TIMEOUT_MS) {
  const apiKey = env("TAVILY_API_KEY");
  if (!apiKey) {
    return withSearchDiagnostics([], [{ provider: "tavily", ok: false, status: "missing_key", count: 0, message: "未配置 TAVILY_API_KEY" }]);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        query,
        search_depth: env("TAVILY_SEARCH_DEPTH") || "basic",
        max_results: Math.max(5, Math.min(20, Number(limit || SEARCH_RESULT_LIMIT))),
        include_answer: false,
        include_raw_content: false,
        include_images: false
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      let message = response.statusText || "请求失败";
      try {
        const payload = await response.json();
        message = payload?.message || payload?.error || payload?.detail || message;
      } catch {
        // Keep status text.
      }
      return withSearchDiagnostics([], [{ provider: "tavily", ok: false, status: response.status, count: 0, message }]);
    }
    const payload = await response.json();
    const rows = parseTavilyPayload(payload, query, topic);
    return withSearchDiagnostics(rows, [{ provider: "tavily", ok: true, status: response.status, count: rows.length, message: rows.length ? "Tavily已返回候选来源" : "Tavily返回为空" }]);
  } catch (error) {
    return withSearchDiagnostics([], [{ provider: "tavily", ok: false, status: "error", count: 0, message: error?.name === "AbortError" ? "请求超时" : error?.message || "请求异常" }]);
  } finally {
    clearTimeout(timer);
  }
}

const tavilyKeyCooldown = new Map();
let tavilyKeyCursor = 0;

function tavilyKeys() {
  const values = [
    env("TAVILY_API_KEYS"),
    env("TAVILY_API_KEY"),
    env("TAVILY_API_KEY_1"),
    env("TAVILY_API_KEY_2"),
    env("TAVILY_API_KEY_3"),
    env("TAVILY_API_KEY_4"),
    env("TAVILY_API_KEY_5")
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/[,;\s]+/))
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set(values));
}

function tavilyKeyLabel(apiKey = "") {
  const key = String(apiKey || "");
  return key ? `...${key.slice(-6)}` : "none";
}

function markTavilyKeyFailure(apiKey, status, message = "") {
  if (!apiKey) return;
  const text = `${status} ${message}`.toLowerCase();
  let cooldownMs = 2 * 60 * 1000;
  if (status === 401 || status === 403 || /unauthorized|invalid|forbidden/.test(text)) cooldownMs = 24 * 60 * 60 * 1000;
  if (status === 402 || status === 429 || /quota|credit|limit|exceed|usage|rate/.test(text)) cooldownMs = 12 * 60 * 60 * 1000;
  tavilyKeyCooldown.set(apiKey, { until: Date.now() + cooldownMs, status, message });
}

function tavilyKeyOrder() {
  const now = Date.now();
  const keys = tavilyKeys();
  const active = keys.filter((key) => Number(tavilyKeyCooldown.get(key)?.until || 0) <= now);
  const usable = active.length ? active : keys;
  if (!usable.length) return [];
  const start = tavilyKeyCursor % usable.length;
  tavilyKeyCursor = (tavilyKeyCursor + 1) % usable.length;
  return [...usable.slice(start), ...usable.slice(0, start)];
}

async function searchTavilyByKey(query, limit, topic, apiKey, timeoutMs = SEARCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        query,
        search_depth: env("TAVILY_SEARCH_DEPTH") || "basic",
        max_results: Math.max(5, Math.min(20, Number(limit || SEARCH_RESULT_LIMIT))),
        include_answer: false,
        include_raw_content: false,
        include_images: false
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      let message = response.statusText || "request failed";
      try {
        const payload = await response.json();
        message = payload?.message || payload?.error || payload?.detail || message;
      } catch {
        // Keep status text.
      }
      markTavilyKeyFailure(apiKey, response.status, message);
      return withSearchDiagnostics([], [{ provider: "tavily", ok: false, status: response.status, count: 0, message, key: tavilyKeyLabel(apiKey) }]);
    }
    const payload = await response.json();
    const rows = parseTavilyPayload(payload, query, topic);
    return withSearchDiagnostics(rows, [{ provider: "tavily", ok: true, status: response.status, count: rows.length, message: rows.length ? "Tavily returned candidates" : "Tavily returned empty", key: tavilyKeyLabel(apiKey) }]);
  } catch (error) {
    const message = error?.name === "AbortError" ? "request timeout" : error?.message || "request error";
    markTavilyKeyFailure(apiKey, "error", message);
    return withSearchDiagnostics([], [{ provider: "tavily", ok: false, status: "error", count: 0, message, key: tavilyKeyLabel(apiKey) }]);
  } finally {
    clearTimeout(timer);
  }
}

async function searchTavilyPooled(query, limit, topic, timeoutMs = SEARCH_TIMEOUT_MS) {
  const keys = tavilyKeyOrder();
  if (!keys.length) {
    return withSearchDiagnostics([], [{ provider: "tavily", ok: false, status: "missing_key", count: 0, message: "missing TAVILY_API_KEY/TAVILY_API_KEYS" }]);
  }
  const diagnostics = [];
  for (const apiKey of keys) {
    const result = await searchTavilyByKey(query, limit, topic, apiKey, timeoutMs);
    diagnostics.push(...arr(result?.searchDiagnostics));
    if (result.length) return withSearchDiagnostics(result, diagnostics);
    const latest = arr(result?.searchDiagnostics).at(-1);
    if (latest?.ok) return withSearchDiagnostics(result, diagnostics);
  }
  return withSearchDiagnostics([], diagnostics);
}

async function withSearchDeadline(promise, timeoutMs = 12000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve([]), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function rankedSearchResults(results = [], query = "", limit = SEARCH_RESULT_LIMIT) {
  return uniqBy(
    results
      .map((item) => ({ ...item, searchRelevanceScore: relevanceScore(item, query) }))
      .sort((a, b) => b.searchRelevanceScore - a.searchRelevanceScore),
    (item) => item.url
  ).slice(0, Math.max(limit, Math.min(30, limit * 2)));
}

function shouldUseBocha(results = [], limit = SEARCH_RESULT_LIMIT, topic = "", query = "") {
  const mode = String(env("BOCHA_MODE") || env("SEARCH_PRIMARY") || "bocha").toLowerCase();
  if (mode === "off" || mode === "false" || mode === "0") return false;
  if (!env("BOCHA_API_KEY")) return false;
  if (mode === "always") return true;
  if (mode === "bocha" || mode === "auto") return true;
  if (!mode.includes("bocha")) return false;
  const text = `${topic} ${query}`;
  const important = /核验|风险|法律|信用|股权|财务|重大项目|招投标|限制高消费|失信|被执行|诉讼|年报|公告|融资|补贴/.test(text);
  const usefulCount = results.filter((item) => Number(item.searchRelevanceScore || 0) > 0).length;
  return important || usefulCount < Math.min(Math.max(6, Math.floor(limit * 0.7)), 10);
}

function shouldUseTavily(results = [], limit = SEARCH_RESULT_LIMIT, topic = "", query = "") {
  if (!tavilyKeys().length) return false;
  const mode = String(env("TAVILY_MODE") || env("SEARCH_PRIMARY") || env("SEARCH_SECONDARY") || "tavily").toLowerCase();
  if (mode === "off" || mode === "false" || mode === "0") return false;
  if (mode === "tavily" || mode === "always" || mode === "hybrid") return true;
  if (!mode.includes("tavily") && String(env("SEARCH_PRIMARY") || "").toLowerCase() !== "tavily") return false;
  const text = `${topic} ${query}`;
  const important = /营收|营业收入|利润|净利润|母公司|财务|年报|公告|融资|招投标|信用|法律|股权|重大项目|数字化|AI|智能制造/.test(text);
  const usefulCount = results.filter((item) => Number(item.searchRelevanceScore || 0) > 0).length;
  return important || usefulCount < Math.min(Math.max(8, Math.floor(limit * 0.9)), 12);
}

function isTavilyQuotaDiagnostic(item = {}) {
  if (item.provider !== "tavily") return false;
  const status = Number(item.status);
  const text = `${item.status || ""} ${item.message || ""}`.toLowerCase();
  return status === 402 || status === 429 || /quota|credit|limit|exceed|usage|rate/.test(text);
}

function tavilyQuotaWarning(diagnostics = []) {
  const keyCount = tavilyKeys().length;
  if (!keyCount) return "";
  const failedKeys = new Set(
    arr(diagnostics)
      .filter(isTavilyQuotaDiagnostic)
      .map((item) => item.key || "unknown")
  );
  if (failedKeys.size >= keyCount) {
    return `Tavily搜索额度可能已用完：${failedKeys.size}/${keyCount}个key被限额，请补充Key或等待额度恢复。`;
  }
  if (failedKeys.size > 0) {
    return `Tavily部分key被限额：${failedKeys.size}/${keyCount}，系统已自动切换备用key。`;
  }
  return "";
}

function searchDiagnosticText(results = []) {
  const diagnostics = arr(results?.searchDiagnostics).filter((item) => item.provider === "bocha" || item.provider === "tavily");
  if (!diagnostics.length) return "";
  const quotaWarning = tavilyQuotaWarning(diagnostics);
  if (quotaWarning) return quotaWarning;
  const latest = diagnostics[diagnostics.length - 1];
  const label = latest.provider === "tavily" ? "Tavily" : "博查";
  if (latest.ok) return `${label}返回 ${latest.count || 0} 条`;
  return `${label}未返回：${latest.status}${latest.message ? `，${clip(latest.message, 50)}` : ""}`;
}

export async function searchWeb(query, limit = SEARCH_RESULT_LIMIT, topic = "通用检索", timeoutMs = SEARCH_TIMEOUT_MS) {
  const fastTimeout = Math.min(4000, timeoutMs);
  const backupTimeout = Math.min(6000, timeoutMs);
  const wholeSearchTimeout = Math.min(14000, Math.max(8000, timeoutMs));
  const searchPrimary = String(env("SEARCH_PRIMARY") || "tavily").toLowerCase();
  const freeProviders = [
    () => searchSogou(query, limit, topic, fastTimeout),
    () => searchSo360(query, limit, topic, backupTimeout),
    () => searchJina(query, limit, topic, backupTimeout),
    () => searchDuckDuckGo(query, limit, topic, backupTimeout),
    () => searchBing(query, limit, topic, backupTimeout)
  ];
  const tavilyFirst = shouldUseTavily([], limit, topic, query) && searchPrimary.includes("tavily")
    ? [() => searchTavilyPooled(query, Math.max(limit, 12), topic, Math.min(10000, timeoutMs))]
    : [];
  const bochaFirst = shouldUseBocha([], limit, topic, query)
    ? [() => searchBocha(query, Math.max(limit, 12), topic, Math.min(10000, timeoutMs))]
    : [];
  const settled = await Promise.allSettled([...tavilyFirst, ...bochaFirst, ...freeProviders].map((provider) => withSearchDeadline(provider(), wholeSearchTimeout)));
  const diagnostics = [];
  const freeResults = settled.flatMap((item) => {
    if (item.status !== "fulfilled") return [];
    diagnostics.push(...arr(item.value?.searchDiagnostics));
    return item.value || [];
  });
  let ranked = rankedSearchResults(freeResults, query, limit);
  if (shouldUseTavily(ranked, limit, topic, query) && !ranked.some((item) => item.provider === "tavily")) {
    const tavilyRows = await withSearchDeadline(
      searchTavilyPooled(query, Math.max(limit, 12), topic, Math.min(10000, timeoutMs)),
      Math.min(11000, Math.max(7000, timeoutMs))
    );
    diagnostics.push(...arr(tavilyRows?.searchDiagnostics));
    ranked = rankedSearchResults([...ranked, ...tavilyRows], query, limit);
  }
  if (shouldUseBocha(ranked, limit, topic, query) && !ranked.some((item) => item.provider === "bocha")) {
    const bochaRows = await withSearchDeadline(
      searchBocha(query, Math.max(limit, 12), topic, Math.min(10000, timeoutMs)),
      Math.min(11000, Math.max(7000, timeoutMs))
    );
    diagnostics.push(...arr(bochaRows?.searchDiagnostics));
    ranked = rankedSearchResults([...ranked, ...bochaRows], query, limit);
  }
  return withSearchDiagnostics(ranked, diagnostics);
}

export async function readSource(url) {
  const safeUrl = normalizeUrl(url);
  if (!validUrl(safeUrl)) return "";
  if (safeUrl.includes("emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew")) {
    const financeText = await readEastmoneyFinanceApi(safeUrl);
    if (financeText) return clip(financeText, 9000);
  }
  let text = "";
  if (!/\.pdf(?:$|\?)/i.test(safeUrl)) text = htmlToText(await fetchText(safeUrl, 8000));
  if (!text || text.length < 200) text = await fetchText(`https://r.jina.ai/${safeUrl}`, 8000, { accept: "text/plain", jina: true });
  if (!text || text.length < 200) {
    text = await fetchText("https://r.jina.ai/", 8000, {
      method: "POST",
      accept: "text/plain",
      jina: true,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `url=${encodeURIComponent(safeUrl)}`
    });
  }
  return clip(text, 9000);
}

async function readSourceWithDeadline(url, timeoutMs = 18000) {
  return Promise.race([
    readSource(url),
    new Promise((resolve) => setTimeout(() => resolve(""), timeoutMs))
  ]);
}

function formatCny(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "未在已读取公开来源中取得";
  if (Math.abs(num) >= 100000000) return `${(num / 100000000).toFixed(2)}亿元`;
  if (Math.abs(num) >= 10000) return `${(num / 10000).toFixed(2)}万元`;
  return `${num.toFixed(2)}元`;
}

function formatPercent(value) {
  const num = Number(value);
  return Number.isFinite(num) ? `${num.toFixed(2)}%` : "未在已读取公开来源中取得";
}

function reportLabel(row = {}) {
  return row.REPORT_DATE_NAME || String(row.REPORT_DATE || "").slice(0, 10) || "最新报告期";
}

function annualRow(rows = []) {
  return rows.find((row) => String(row.REPORT_TYPE || row.REPORT_DATE_NAME || "").includes("年报")) || rows[0] || {};
}

function samePeriodRow(rows = [], period = "") {
  const date = String(period || "").slice(0, 10);
  return rows.find((row) => String(row.REPORT_DATE || "").startsWith(date)) || annualRow(rows);
}

async function fetchEastmoneyDataset(reportName, code) {
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?sortColumns=REPORT_DATE&sortTypes=-1&pageSize=8&pageNumber=1&reportName=${reportName}&columns=ALL&filter=(SECURITY_CODE%3D%22${code}%22)`;
  const text = await fetchText(url, 10000, {
    headers: {
      referer: "https://quote.eastmoney.com/"
    }
  });
  try {
    return JSON.parse(text)?.result?.data || [];
  } catch {
    return [];
  }
}

async function readEastmoneyFinanceApi(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  const codeParam = parsed.searchParams.get("code") || "";
  const code = codeParam.match(/\d{6}/)?.[0];
  if (!code) return "";

  const text = await fetchText(url, 10000, {
    headers: {
      referer: "https://quote.eastmoney.com/"
    }
  });
  let mainRows = [];
  try {
    mainRows = JSON.parse(text)?.data || [];
  } catch {
    mainRows = [];
  }

  const [incomeRows, balanceRows, cashRows] = await Promise.all([
    fetchEastmoneyDataset("RPT_DMSK_FN_INCOME", code),
    fetchEastmoneyDataset("RPT_DMSK_FN_BALANCE", code),
    fetchEastmoneyDataset("RPT_DMSK_FN_CASHFLOW", code)
  ]);

  const annual = annualRow(mainRows.length ? mainRows : incomeRows);
  const period = annual.REPORT_DATE;
  const income = samePeriodRow(incomeRows, period);
  const balance = samePeriodRow(balanceRows, period);
  const cash = samePeriodRow(cashRows, period);
  const latest = mainRows[0] || incomeRows[0] || {};

  if (!annual.REPORT_DATE && !income.REPORT_DATE && !balance.REPORT_DATE && !cash.REPORT_DATE) return "";
  const reportName = reportLabel(annual);
  const latestName = reportLabel(latest);
  const totalAssets = Number(balance.TOTAL_ASSETS);
  const totalLiabilities = Number(balance.TOTAL_LIABILITIES ?? annual.LIABILITY);
  const debtRatio = Number.isFinite(Number(balance.DEBT_ASSET_RATIO))
    ? formatPercent(balance.DEBT_ASSET_RATIO)
    : Number.isFinite(totalAssets) && totalAssets
      ? formatPercent((totalLiabilities / totalAssets) * 100)
      : "未在已读取公开来源中取得";

  return [
    `东方财富F10结构化财务数据。股票代码：${code}。证券简称：${annual.SECURITY_NAME_ABBR || latest.SECURITY_NAME_ABBR || ""}。行业：${annual.INDUSTRY_NAME || latest.INDUSTRY_NAME || ""}。`,
    `最新年度：${reportName}，公告日：${String(annual.NOTICE_DATE || income.NOTICE_DATE || "").slice(0, 10) || "未取得"}。`,
    `营业收入：${formatCny(income.TOTAL_OPERATE_INCOME ?? annual.TOTALOPERATEREVE)}；同比：${formatPercent(income.TOI_RATIO ?? annual.TOTALOPERATEREVETZ)}。`,
    `归母净利润：${formatCny(income.PARENT_NETPROFIT ?? annual.PARENTNETPROFIT)}；同比：${formatPercent(income.PARENT_NETPROFIT_RATIO ?? annual.PARENTNETPROFITTZ)}。`,
    `扣非净利润：${formatCny(income.DEDUCT_PARENT_NETPROFIT)}。`,
    `毛利率：${formatPercent(annual.XSMLL)}。`,
    `经营现金流净额：${formatCny(cash.NETCASH_OPERATE)}。`,
    `总资产：${formatCny(balance.TOTAL_ASSETS)}；总负债：${formatCny(totalLiabilities)}；资产负债率：${debtRatio}。`,
    `研发投入：未在东方财富已读取接口中取得，需进一步查阅年报“研发投入”章节。`,
    `员工数量：未在东方财富已读取接口中取得，需进一步查阅年报“员工情况”章节。`,
    `前五大客户/客户集中度：未在东方财富已读取接口中取得，需进一步查阅年报“主要销售客户”章节。`,
    latest.REPORT_DATE && latest.REPORT_DATE !== annual.REPORT_DATE
      ? `最新一期：${latestName}，营业收入 ${formatCny(latest.TOTALOPERATEREVE)}，归母净利润 ${formatCny(latest.PARENTNETPROFIT)}。`
      : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function websiteDomain(company) {
  try {
    const website = company.website || arr(company.sourceUrls)[0] || "";
    if (!website) return "";
    return new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function modelResearchModels(runtimeMode) {
  const configured = String(env("DEEPSEEK_RESEARCH_MODELS") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowed = new Set([DEEPSEEK_FLASH_MODEL, DEEPSEEK_PRO_MODEL]);
  const models = configured.filter((model) => allowed.has(model));
  return (models.length ? models : RESEARCH_MODEL_ROUTES.map((route) => route.model)).map((model) => ({ model }));
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function ensureNotCancelled(options = {}) {
  if (typeof options.shouldCancel === "function" && (await options.shouldCancel())) {
    const error = new Error("任务已停止");
    error.name = "JobCancelledError";
    throw error;
  }
}

function financialHardSources(company = {}) {
  const stock = companyStockInfo(company);
  if (!stock) return [];
  const name = company.standardName || company.name || company.query || "";
  const marketCode = `${stock.prefix}${stock.code}`;
  return [
    {
      title: `${name} 东方财富F10结构化财务指标`,
      url: `https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew?type=0&code=${marketCode}`,
      query: `${stock.code} 东方财富F10 主要财务指标 营业收入 净利润 现金流 资产负债率`,
      topic: TOPIC_FINANCE,
      provider: "finance-eastmoney-api",
      sourceType: "财务硬来源"
    },
    {
      title: `${name} 巨潮资讯公告检索`,
      url: `https://www.cninfo.com.cn/new/disclosure/stock?stockCode=${stock.code}`,
      query: `股票代码 ${stock.code} 年报 公告 财务数据`,
      topic: TOPIC_FINANCE,
      provider: "finance-seed",
      sourceType: "财务硬来源"
    },
    {
      title: `${name} ${stock.market}公司信息`,
      url: stock.market === "上交所" ? `https://www.sse.com.cn/assortment/stock/list/info/company/index.shtml?COMPANY_CODE=${stock.code}` : `https://www.szse.cn/certificate/individual/index.html?code=${stock.code}`,
      query: `${stock.market} ${stock.code} 公司公告 年报`,
      topic: TOPIC_FINANCE,
      provider: "finance-seed",
      sourceType: "财务硬来源"
    },
    {
      title: `${name} 新浪财经财务摘要`,
      url: `https://vip.stock.finance.sina.com.cn/corp/go.php/vFD_FinanceSummary/stockid/${stock.code}.phtml`,
      query: `${stock.code} 财务摘要 营业收入 净利润 资产负债`,
      topic: TOPIC_FINANCE,
      provider: "finance-seed",
      sourceType: "财务硬来源"
    },
    {
      title: `${name} 同花顺财务概况`,
      url: `https://basic.10jqka.com.cn/${stock.code}/finance.html`,
      query: `${stock.code} 同花顺 F10 财务概况 营业收入 净利润`,
      topic: TOPIC_FINANCE,
      provider: "finance-seed",
      sourceType: "财务硬来源"
    },
    {
      title: `${name} 东方财富行情与F10`,
      url: `https://quote.eastmoney.com/${stock.prefix.toLowerCase()}${stock.code}.html`,
      query: `${stock.code} 东方财富 F10 财务指标`,
      topic: TOPIC_FINANCE,
      provider: "finance-seed",
      sourceType: "财务硬来源"
    }
  ].filter((item) => validUrl(item.url));
}

function buildResearchPlan(company) {
  const name = company.standardName || company.name || company.query;
  const region = company.region || "";
  const industry = company.industry || "";
  const aiNeeds = String(company.aiNeeds || company.userContext?.aiNeeds || "").trim();
  const stock = companyStockInfo(company);
  const domain = websiteDomain(company);
  const site = domain ? `site:${domain}` : name;
  const year = new Date().getFullYear();
  const lastYear = year - 1;
  const local = [name, region, "工厂 园区 产能 产品 客户 研发 测试"].filter(Boolean).join(" ");
  const subject = [name, region, "工商 注册资本 参保人数 专利 软件著作权"].filter(Boolean).join(" ");

  return [
    { topic: TOPIC_FINANCE, query: `${name} ${year} ${lastYear} 最新 财务 营收 净利润 现金流 融资 IPO 辅导 扩产 投资 招聘`, limit: 12 },
    { topic: TOPIC_FINANCE, query: `${name} ${year} ${lastYear} 年报 半年报 三季报 一季报 业绩 经营情况 研发投入 员工`, limit: 12 },
    { topic: TOPIC_SUBJECT, query: `${name} ${year} ${lastYear} 融资 增资 扩产 项目 投产 招聘 订单 客户`, limit: 12 },
    stock ? { topic: TOPIC_FINANCE, query: `${stock.code} ${name} 年报 营业收入 归母净利润 研发投入 现金流`, limit: 12 } : null,
    stock ? { topic: TOPIC_FINANCE, query: `${stock.code} ${name} 巨潮资讯 ${stock.market} 年度报告 半年度报告`, limit: 12 } : null,
    stock ? { topic: TOPIC_FINANCE, query: `${stock.code} ${name} 东方财富 同花顺 新浪财经 F10 财务指标`, limit: 12 } : null,
    { topic: TOPIC_SUBJECT, query: `${name} 官网 公司简介 产品 客户 业务`, limit: 8 },
    { topic: TOPIC_SUBJECT, query: local, limit: 8 },
    { topic: TOPIC_SUBJECT, query: subject, limit: 8 },
    { topic: TOPIC_SUBJECT, query: `${name} 爱企查 企查查 天眼查 水滴信用 股权 注册资本 参保人数`, limit: 10 },
    { topic: TOPIC_SUBJECT, query: `${name} 政府公示 园区 项目 招投标 中标 供应商`, limit: 10 },
    { topic: TOPIC_SUBJECT, query: `"${name}"`, limit: 10 },
    { topic: TOPIC_SUBJECT, query: `${site} ${region} news press release plant factory`, limit: 8 },
    { topic: TOPIC_FINANCE, query: `${name} 年报 财报 营收 利润 现金流 客户集中度`, limit: 8 },
    { topic: TOPIC_FINANCE, query: `${name} 年度报告 半年度报告 股票代码 招股说明书 营业收入 净利润 毛利率`, limit: 10 },
    { topic: TOPIC_FINANCE, query: `${name} 巨潮资讯 上交所 深交所 年报 营业收入 净利润 研发投入`, limit: 10 },
    { topic: TOPIC_FINANCE, query: `${name} 东方财富 同花顺 财务指标 营业总收入 归母净利润 资产负债率`, limit: 8 },
    { topic: TOPIC_FINANCE, query: `${name} annual report revenue margin cash flow customers China`, limit: 8 },
    { topic: TOPIC_FINANCE, query: `${site} annual report results guidance investor relations`, limit: 8 },
    { topic: TOPIC_MARKET, query: `${name} 产品线 主机厂 客户 供应商 项目 量产`, limit: 8 },
    { topic: TOPIC_MARKET, query: `${name} 客户 供应链 供应商 采购 中标 招标 合作`, limit: 10 },
    { topic: TOPIC_MARKET, query: `${name} 招标人 采购人 采购单位 采购公告 采购意向 中标公告 成交供应商 政府采购`, limit: 12 },
    { topic: TOPIC_MARKET, query: `${name} 作为采购人 招标公告 采购公告 供应商 成交 中标单位 项目预算`, limit: 12 },
    { topic: TOPIC_MARKET, query: `${name} site:ccgp.gov.cn OR site:cebpubservice.com OR site:chinabidding.com.cn OR site:bidcenter.com.cn 采购 招标 中标`, limit: 10 },
    { topic: TOPIC_MARKET, query: `${name} 微信 公众号 新闻 产品 客户 交付`, limit: 10 },
    { topic: TOPIC_MARKET, query: `${name} 客户案例 项目案例 标杆案例 交付 实施 上线 解决方案`, limit: 12 },
    { topic: TOPIC_MARKET, query: `${name} 生态伙伴 渠道伙伴 能力中心 平台 交付 运维 投标 售前`, limit: 12 },
    { topic: TOPIC_MARKET, query: `${name} 生态 合作伙伴 伙伴网络 联合方案 工业软件 平台集成`, limit: 12 },
    { topic: TOPIC_MARKET, query: `${name} 交付 实施 服务 运维 客户成功 项目管理 上线`, limit: 12 },
    { topic: TOPIC_MARKET, query: `${name} 能力中心 生态伙伴 工业互联网 宁波 项目交付`, limit: 12 },
    { topic: TOPIC_MARKET, query: `${name} 产品手册 服务商 产品名称 价格区间 部署周期`, limit: 12 },
    { topic: TOPIC_MARKET, query: `${name} new energy electric drive inverter thermal turbo customer project`, limit: 8 },
    { topic: TOPIC_MARKET, query: `${industry} 行业报告 市场 压力 质量 交付 成本`, limit: 8 },
    { topic: TOPIC_DIGITAL, query: `${name} 数字化 AI 智能制造 MES ERP PLM QMS APS`, limit: 8 },
    { topic: TOPIC_DIGITAL, query: `${name} MES APS ERP SAP WMS LIMS SCADA 数据采集 工业互联网`, limit: 12 },
    { topic: TOPIC_DIGITAL, query: `${name} HolliCube 工业互联网 平台 实时数据 AIOps 可观测性`, limit: 12 },
    { topic: TOPIC_DIGITAL, query: `${name} AIOps 运维 可观测 工业数据 实时数据库 数据治理`, limit: 12 },
    { topic: TOPIC_DIGITAL, query: `${name} ERP SAP WMS LIMS 集成 对接 MES APS 生产执行`, limit: 12 },
    { topic: TOPIC_DIGITAL, query: `${name} HolliMES HolliEMS QMS WMS EAM 产品手册 部署周期`, limit: 12 },
    { topic: TOPIC_DIGITAL, query: `${name} 蒙牛 乳业 MES 数字化工厂 客户案例`, limit: 10 },
    { topic: TOPIC_DIGITAL, query: `${name} digital transformation AI agent copilot MES ERP PLM QMS case`, limit: 8 },
    { topic: TOPIC_DIGITAL, query: `${name} SAP DELMIA Apriso Andonix Microsoft Copilot 制造`, limit: 8 },
    { topic: TOPIC_DIGITAL, query: `${name} 招聘 IT 数据 工业互联网 质量 工艺 设备`, limit: 8 },
    { topic: TOPIC_DIGITAL, query: `${name} 招聘 信息化 数字化 软件工程师 数据工程师 IT经理 MES ERP`, limit: 10 },
    { topic: TOPIC_DIGITAL, query: `${name} 专利 软件著作权 智能制造 工业互联网 自动化`, limit: 10 },
    aiNeeds ? { topic: TOPIC_DIGITAL, query: `${name} ${aiNeeds} AI 智能体 解决方案 案例 需求 场景`, limit: 10 } : null,
    { topic: TOPIC_PAIN, query: `${name} 质量追溯 设备故障 工艺知识 排产 交付 返工`, limit: 8 },
    { topic: TOPIC_PAIN, query: `${name} IATF 16949 audit traceability quality supplier delivery`, limit: 8 },
    { topic: TOPIC_PAIN, query: `${name} ESG 网络安全 数据安全 AI 风险 供应链 风险`, limit: 8 }
  ].filter((item) => item?.query?.trim().length > 4);
}

export function buildQueries(company) {
  return buildResearchPlan(company).map((item) => item.query);
}

function seedSources(company) {
  const seeds = [...financialHardSources(company)];
  if (company.website) {
    seeds.push({
      title: `${company.standardName || company.name || "企业"}官网`,
      url: company.website,
      query: "候选主体官网",
      topic: TOPIC_SUBJECT,
      provider: "seed"
    });
  }
  for (const url of arr(company.sourceUrls)) {
    seeds.push({ title: "主体核对来源", url, query: "候选主体核对来源", topic: TOPIC_SUBJECT, provider: "seed" });
  }
  return seeds.map((item) => ({ ...item, url: normalizeUrl(item.url) })).filter((item) => validUrl(item.url));
}

function buildRescuePlan(company, missingTopics = []) {
  const name = company.standardName || company.name || company.query;
  const region = company.region || "";
  const industry = company.industry || "";
  const aiNeeds = String(company.aiNeeds || company.userContext?.aiNeeds || "").trim();
  const year = new Date().getFullYear();
  const lastYear = year - 1;
  const topics = missingTopics.length ? missingTopics : TOPIC_NAMES;
  return topics.flatMap((topic) =>
    [
      { topic, query: `${name} ${year} ${lastYear} 最新 经营 财务 业绩 融资 IPO 扩产 招聘 数字化`, limit: 12 },
      { topic, query: `${name} ${region} ${topic} 官方 新闻 年报 案例 报告`, limit: 10 },
      { topic, query: `${name} ${industry} ${topic} digital AI annual report press release case`, limit: 10 },
      { topic, query: `${name} ${region} 政府 公示 项目 招投标 专利 商标 招聘 公众号`, limit: 10 },
      { topic, query: `${name} site:aiqicha.baidu.com OR site:qcc.com OR site:tianyancha.com OR site:shuidi.cn`, limit: 10 },
      { topic, query: `${name} 招聘 IT MES ERP PLM 研发 工艺 质量 设备`, limit: 10 },
      { topic, query: `${name} 专利 商标 软件著作权 研发 技术`, limit: 10 },
      { topic, query: `${name} 招标人 采购人 采购单位 采购公告 采购意向 中标公告 成交供应商 政府采购`, limit: 12 },
      { topic, query: `${name} 作为采购人 招标公告 采购公告 供应商 成交 中标单位 项目预算`, limit: 12 },
      { topic, query: `${name} 客户案例 标杆案例 项目交付 解决方案 实施 上线`, limit: 12 },
      { topic, query: `${name} 生态 合作伙伴 联合方案 平台集成 渠道伙伴`, limit: 12 },
      { topic, query: `${name} AIOps 可观测 运维 工业数据 MES APS ERP SAP WMS LIMS`, limit: 12 },
      { topic, query: `${name} 产品手册 服务商 HolliMES HolliEMS QMS WMS EAM 价格区间 部署周期`, limit: 12 },
      aiNeeds ? { topic, query: `${name} ${aiNeeds} ${topic} AI 智能体 数字化 需求 场景`, limit: 10 } : null
    ].filter(Boolean)
  );
}

function trustedDomainScore(url = "") {
  const value = String(url).toLowerCase();
  if (/\.gov\.cn|sse\.com\.cn|szse\.cn|cninfo\.com\.cn|qcc\.com|aiqicha\.baidu\.com|shuidi\.cn|tianyancha\.com|qixin\.com|qichamao\.com|gsxt\.gov\.cn/.test(value)) return 26;
  if (/10jqka|eastmoney|stockstar|cfi\.cn|sina\.com\.cn|cnstock\.com/.test(value)) return 18;
  if (/liepin|zhipin|51job|zhaopin|kanzhun|jobui|goodjobs|job\.|jobs\.|\/job|teachin|career|campus/.test(value)) return -16;
  if (/1688|11467|huangye|yellowurl/.test(value)) return -8;
  if (/www\./.test(value)) return 10;
  return 0;
}

function trustedWeakSourceUrl(url = "") {
  return /qcc\.com|aiqicha\.baidu\.com|shuidi\.cn|tianyancha\.com|qixin\.com|qichamao\.com|gsxt\.gov\.cn|zhipin\.com|liepin\.com|51job\.com|zhaopin\.com|kanzhun\.com|jobui\.com|ciboconn\.com|cibocablingsystem\.com|weixin\.qq\.com|mp\.weixin\.qq\.com|patent|cnipa|ccsa|cdc-expo/i.test(String(url || ""));
}

function priorityScore(item) {
  const text = `${item.title || ""} ${item.url || ""} ${item.query || ""} ${item.topic || ""}`.toLowerCase();
  let score = trustedDomainScore(item.url);
  const family = sourceFamilyOf(item, item.url, item.sourceType);
  score += Math.round(Math.min(1, Math.max(0, Number(item.tavilyScore || 0))) * 30);
  if (/official_product|customer_case|digital_capability|tender_project|patent_ip/.test(family)) score += 28;
  if (/hiring_org|industry_context/.test(family)) score += 13;
  if (/hollicube|holli|holly|hollimes|holliems|aiops|数字工业操作系统|工业操作系统|客户案例|项目案例|标杆案例|蒙牛|乳业数字化工厂|生态伙伴|合作伙伴|伙伴网络|能力中心|联合方案|产品手册|服务商|部署周期|价格区间|解决方案/.test(text)) score += 45;
  if (/erp|sap|wms|lims|mes|aps|集成|对接|实施|上线|交付|运维|客户成功|可观测|实时数据库|工业数据/.test(text)) score += 24;
  if (text.includes("official") || text.includes("官网") || text.includes("newsroom") || text.includes("press")) score += 30;
  if (text.includes("annual") || text.includes("report") || text.includes("年报") || text.includes("investor")) score += 28;
  if (text.includes("工商") || text.includes("专利") || text.includes("软件著作权") || text.includes("supplier")) score += 18;
  if (text.includes("digital") || text.includes("ai") || text.includes("mes") || text.includes("erp") || text.includes("plm") || text.includes("qms")) score += 15;
  if (text.includes("factory") || text.includes("plant") || text.includes("工厂") || text.includes("园区")) score += 14;
  if (text.includes(".pdf")) score += 6;
  return score;
}

function isBusinessInsightCandidate(item = {}) {
  const text = `${item.title || ""} ${item.snippet || ""} ${item.url || ""} ${item.query || ""} ${item.topic || ""}`.toLowerCase();
  return /hollicube|holli|holly|hollimes|holliems|aiops|mes|aps|erp|sap|wms|lims|eam|qms|scada|客户案例|项目案例|标杆案例|蒙牛|乳业|工业互联网|工业软件|数字化工厂|智能工厂|解决方案|售前|投标|交付|实施|上线|运维|客户成功|生态伙伴|合作伙伴|伙伴网络|能力中心|联合方案|集成|对接|可观测|实时数据库|工业数据|产品手册|服务商|价格区间|部署周期|产品介绍|成功案例|customer case|case study|implementation|solution|platform|ecosystem|partner|integration/.test(text);
}

function confidenceForUrl(url) {
  const value = String(url).toLowerCase();
  if (value.includes(".gov") || value.includes("sse.com") || value.includes("szse.cn") || value.includes("cninfo.com.cn")) return "高";
  if (value.includes("annual") || value.includes("report") || value.includes("ir.") || value.includes("investor")) return "高";
  if (value.includes("qcc.com") || value.includes("aiqicha") || value.includes("tianyancha") || value.includes("shuidi")) return "中高";
  if (value.includes("newsroom") || value.includes("press") || value.includes("official") || value.includes("www.")) return "中高";
  return "中";
}

function classifySource(item = {}) {
  const url = String(item.url || "").toLowerCase();
  const text = `${item.title || ""} ${item.snippet || ""} ${item.url || ""}`.toLowerCase();
  if (item.sourceType === "财务硬来源" || /cninfo|sse\.com\.cn|szse\.cn|eastmoney|10jqka|finance\.sina|stockstar|cnstock|cfi\.cn/.test(url)) return "财务硬来源";
  if (/招投标|招标|投标|中标|采购|供应商|政府采购|bid|tender|procurement/.test(text)) return "企业公开来源";
  if (/专利|软著|软件著作权|商标|知识产权|patent|trademark|copyright/.test(text)) return "企业公开来源";
  if (/案例|客户案例|项目案例|标杆|交付|实施|上线|解决方案|mes|erp|aps|wms|lims|scada|工业互联网|holl(?:i|y)cube/.test(text)) return "企业公开来源";
  if (/行业报告|行业|market|research|report/.test(text) && !/公司简介|官网/.test(text)) return "行业背景来源";
  if (/qcc|aiqicha|shuidi|tianyancha|qixin|qichamao|gov\.cn/.test(url)) return "主体核对来源";
  return "企业公开来源";
}

function sourceRelevance(item, company = {}, text = "") {
  const stock = companyStockInfo(company);
  const name = company.standardName || company.name || company.query || "";
  const core = coreName(name);
  const industry = String(company.industry || "");
  const region = String(company.region || "");
  const sourceType = classifySource(item);
  // Query terms include the company name by construction, so they cannot be
  // used as evidence that a returned page is relevant.
  const haystack = `${item.title || ""} ${item.snippet || ""} ${item.url || ""} ${clip(text, 4500)}`;
  const normalized = haystack.toLowerCase();
  const exactNameHit = name && haystack.includes(name);
  const coreHit = core && core.length >= 4 && haystack.includes(core);
  const shortCore = core && core.length >= 4 ? core.slice(0, 3) : "";
  const brandContextHit = Boolean(shortCore && haystack.includes(shortCore) && /holli|holly|hollicube|mes|aps|erp|wms|lims|aiops|工业互联网|工业软件|数字化工厂|客户案例|解决方案|智能制造|数字工业操作系统/i.test(haystack));
  const stockHit = stock?.code && normalized.includes(stock.code);
  const industryHit = industry && haystack.includes(industry);
  const regionHit = region && haystack.includes(region);
  const financeHard = sourceType === "财务硬来源";
  const badTitle = /汉字|字典|词典|拼音|笔顺|康熙|说文解字|意思|读音/.test(`${item.title || ""} ${item.url || ""}`);
  const companySpecific = Boolean(exactNameHit || coreHit || brandContextHit || stockHit || (financeHard && stock?.code && String(item.url || "").includes(stock.code)));
  const queryText = `${item.query || ""}`;
  const queryCompanyHit = Boolean((name && queryText.includes(name)) || (core && core.length >= 4 && queryText.includes(core)));
  const weakSourceHit = Boolean(!companySpecific && trustedWeakSourceUrl(item.url) && (industryHit || regionHit));
  const genericWeakHit = Boolean(
    !companySpecific &&
      (industryHit || regionHit) &&
      !badTitle &&
      !isBadSourceUrl(item.url) &&
      (item.provider === "bocha" || trustedDomainScore(item.url) >= -8 || /news|gov|patent|job|career|b2b|expo|fair|supplier|product|company|corp|官网|新闻|招聘|专利|展会|供应商|产品/i.test(`${item.title || ""} ${item.url || ""}`))
  );
  let score = 0;
  if (exactNameHit) score += 55;
  if (coreHit) score += 35;
  if (brandContextHit) score += 28;
  if (stockHit) score += 45;
  if (financeHard && (exactNameHit || coreHit || stockHit)) score += 28;
  if (industryHit) score += 12;
  if (regionHit) score += 8;
  if (trustedDomainScore(item.url) > 0) score += Math.min(18, trustedDomainScore(item.url));
  if (badTitle || isBadSourceUrl(item.url)) score -= 80;
  const isIndustryBackground = !companySpecific && sourceType === "行业背景来源" && industryHit;
  const relevant = score >= 18 || isIndustryBackground || weakSourceHit || genericWeakHit;
  const reason = companySpecific
    ? `命中${[exactNameHit || coreHit ? "企业名称" : "", brandContextHit ? "集团/品牌业务线索" : "", stockHit ? `股票代码${stock.code}` : "", financeHard ? "财务硬来源" : ""].filter(Boolean).join("、")}`
    : isIndustryBackground
      ? `行业背景来源，命中行业关键词“${industry}”`
      : weakSourceHit || genericWeakHit
        ? "弱线索来源：搜索词命中企业，来源域名可作为主体、招聘、官网或产业线索，正式结论需进一步核对"
        : "未命中企业名称、股票代码、官网域名或核心行业词";
  return {
    relevant,
    relevanceScore: score,
    relevanceReason: reason,
    sourceType: weakSourceHit || genericWeakHit ? "线索来源" : sourceType,
    sourceFamily: sourceFamilyOf({ ...item, text }, item.url, weakSourceHit || genericWeakHit ? "线索来源" : sourceType),
    confidence: weakSourceHit || genericWeakHit ? "低" : "",
    domain: domainOf(item.url),
    isCompanySpecific: companySpecific,
    weakEvidence: weakSourceHit
  };
}

function planningSegments(company = {}, options = {}) {
  const missing = new Set(options.missingTopics || []);
  const base = [
    { key: "subject", title: "主体信息", topic: TOPIC_SUBJECT, goal: "官网、集团/子公司关系、工商主体、注册地址、股权、本地园区、政府公示、企业信用平台" },
    { key: "local", title: "工商本地", topic: TOPIC_SUBJECT, goal: "本地政府、园区、招投标、项目公示、专利商标、软件著作权、公众号/媒体线索" },
    { key: "finance", title: "经营财务", topic: TOPIC_FINANCE, goal: "年报、财报、营收、利润、员工、融资、招股书、上市公司公告、F10 财务页" },
    { key: "market", title: "产品客户", topic: TOPIC_MARKET, goal: "产品线、客户、供应商、主机厂、行业位置、市场压力、交付质量要求" },
    { key: "digital", title: "数字化AI招聘", topic: TOPIC_DIGITAL, goal: "数字化、AI、智能制造、MES、ERP、PLM、QMS、APS、IT/数据招聘岗位、实施商案例" },
    { key: "pain", title: "痛点机会", topic: TOPIC_PAIN, goal: "质量追溯、设备故障、工艺知识、研发DFM、排产交付、供应链、成本、合规数据安全" }
  ];
  if (!missing.size) return base;
  return base.filter((item) => missing.has(item.topic) || options.aggressive);
}

async function callPlanningModel(messages, modelRoutes, company, options = {}) {
  const errors = [];
  const deadline = Date.now() + (options.segmentBudgetMs || 90000);
  for (const route of modelRoutes) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    const model = typeof route === "string" ? route : route.model;
    const channelNames = typeof route === "string" ? undefined : route.channelNames;
    try {
      await options.onAttempt?.({ status: "start", model, channel: arr(channelNames).join("/") || "auto", remainingMs });
      const answer = await callModel(messages, {
        model,
        channelNames,
        runtimeMode: company.runtimeMode || options.runtimeMode,
        temperature: 0.1,
        maxTokens: 3500,
        timeoutMs: Math.min(options.timeoutPerModelMs || 45000, remainingMs),
        totalTimeoutMs: Math.max(3000, remainingMs),
        onAttempt: options.onAttempt
      });
      await options.onAttempt?.({ status: "success", model: answer.model, channel: answer.channel });
      return { model: answer.model, channel: answer.channel, parsed: extractJson(answer.content) };
    } catch (error) {
      errors.push(`${model}: ${error?.message || String(error)}`);
      await options.onAttempt?.({ status: "error", model, channel: arr(channelNames).join("/") || "auto", error: error?.message || String(error) });
    }
  }
  const err = new Error(errors.join("\n") || "所有检索规划模型均调用失败");
  err.name = "PlanningModelError";
  throw err;
}

async function expandPlanWithModels(company, existingSources = [], options = {}) {
  const name = company.standardName || company.name || company.query;
  const modelRoutes = await modelResearchModels(company.runtimeMode || options.runtimeMode);
  const segments = planningSegments(company, options);
  const outputs = [];
  const sourceGaps = options.sourceGaps || options.missingTopics || [];
  const existingBrief = existingSources.slice(0, 12).map((item) => ({
    title: item.title,
    url: item.url,
    topic: item.topic,
    sourceType: item.sourceType
  }));

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    await options.onProgress?.({
      completed: index,
      total: segments.length,
      currentSegment: segment.title,
      currentModel: modelRoutes[0]?.model || "等待调用模型"
    });
    const messages = [
      {
        role: "system",
        content: "你是企业公开资料检索规划助手。只返回严格 JSON。你只能规划搜索词和待验证 URL，不能编造事实。"
      },
      {
        role: "user",
        content: `请为企业“${name}”做“${segment.title}”检索规划。
目标：${segment.goal}
企业信息：${JSON.stringify({
  standardName: company.standardName || company.name || company.query,
  region: company.region || "",
  industry: company.industry || "",
  stockCode: company.stockCode || extractStockCode(company.standardName, company.name, company.industry, company.aiNeeds),
  aiNeeds: company.aiNeeds || company.userContext?.aiNeeds || "",
  website: company.website || ""
}, null, 2)}
当前缺口：${JSON.stringify(sourceGaps)}
已找到来源摘要：${JSON.stringify(existingBrief)}
返回 JSON：
{
  "queries": [{"topic":"${segment.topic}","query":"搜索词","reason":"为什么搜"}],
  "candidateUrls": [{"topic":"${segment.topic}","url":"https://...","title":"候选来源","reason":"为什么可能有用"}]
}
要求：queries 6-10 条，优先精确企业名、简称、地区、行业、股票代码、政府/工商/招聘/专利/招投标/官网/新闻/年报/F10/数字化关键词组合。candidateUrls 可为空，但不得编造明显不存在的 URL。`
      }
    ];
    const output = await callPlanningModel(messages, modelRoutes, company, {
      ...options,
      timeoutPerModelMs: options.timeoutPerModelMs || (options.aggressive ? 120000 : 90000),
      segmentBudgetMs: options.segmentBudgetMs || (options.aggressive ? 240000 : 180000),
      onAttempt: async (attempt) => {
        await options.onProgress?.({
          completed: index,
          total: segments.length,
          currentSegment: segment.title,
          currentModel: attempt.model ? `${attempt.model}（${attempt.channel || "auto"}）` : "",
          attemptStatus: attempt.status,
          attemptError: attempt.error
        });
      }
    });
    outputs.push({ ...output, segment: segment.title, topic: segment.topic });
    await options.onProgress?.({
      completed: index + 1,
      total: segments.length,
      currentSegment: segment.title,
      currentModel: `${output.model}（${output.channel}）`
    });
  }

  const queries = [];
  const candidateUrls = [];
  for (const output of outputs) {
    for (const item of arr(output.parsed?.queries)) {
      if (item?.query && item?.topic) queries.push({ topic: item.topic, query: item.query, limit: 8, provider: `model:${output.model}` });
    }
    for (const item of arr(output.parsed?.candidateUrls)) {
      const url = normalizeUrl(item?.url);
      if (validUrl(url)) {
        candidateUrls.push({
          title: cleanTitle(item.title || url),
          url,
          query: item.reason || "模型扩展候选 URL",
          topic: TOPIC_NAMES.includes(item.topic) ? item.topic : TOPIC_SUBJECT,
          provider: `model:${output.model}`
        });
      }
    }
  }

  return {
    queries: uniqBy(queries.filter((item) => TOPIC_NAMES.includes(item.topic)), (item) => `${item.topic}|${item.query}`).slice(0, options.aggressive ? 48 : 36),
    candidateUrls: uniqBy(candidateUrls, (item) => item.url).slice(0, options.aggressive ? 48 : 30),
    modelCount: outputs.length,
    models: outputs.map((output) => ({ model: output.model, channel: output.channel, purpose: `检索规划：${output.segment}` }))
  };
}

export async function collectSources(company, onProgress = async () => {}, options = {}) {
  const checkpoint = options.checkpoint || {};
  const plan = buildResearchPlan(company);
  const seed = seedSources(company);
  const found = uniqBy([...seed, ...arr(checkpoint.candidateSources), ...arr(checkpoint.foundCandidates)], (source) => source.url);
  const sources = Array.isArray(checkpoint.sources) ? [...checkpoint.sources] : [];
  const readUrls = new Set([...sources.map((source) => source.url).filter(Boolean), ...arr(checkpoint.readUrls).filter(Boolean)]);
  const usedModels = [...arr(checkpoint.usedModels)];
  const completedSourceTopics = new Set(arr(checkpoint.completedSourceTopics));
  const completedRescueRounds = new Set(arr(checkpoint.completedRescueRounds).map(Number).filter(Number.isFinite));
  let expanded = checkpoint.expandedPlan || null;

  const checkpointSources = async (stage, extra = {}) => {
    const candidateSources = uniqBy(found, (source) => source.url).slice(0, 800);
    const quality = evaluateSourceQuality(sources);
    const patch = {
      stage,
      sources,
      candidateSources,
      foundCandidates: candidateSources,
      expandedPlan: expanded,
      readUrls: [...readUrls],
      completedSourceTopics: [...completedSourceTopics],
      completedRescueRounds: [...completedRescueRounds],
      usedModels,
      quality,
      ...extra
    };
    await options.onCheckpoint?.(patch);
    if (options.shouldYield?.()) await options.onYield?.(patch);
  };

  if (checkpoint.sourceCollectionDone && sources.length) {
    Object.defineProperty(sources, "usedModels", {
      value: uniqBy(usedModels.filter(Boolean), (item) => `${item.channel}|${item.model}|${item.purpose}`),
      enumerable: false
    });
    return sources;
  }

  if (!checkpoint.tianyanchaDone && hasTianyanchaKey()) {
    await ensureNotCancelled(options);
    await onProgress(14, "天眼查企业事实核验", {
      phaseKey: "resolve",
      detail: "正在读取天眼查结构化数据，补充工商、股权、董监高、风险、经营与知识产权线索。",
      foundCount: uniqBy(found, (source) => source.url).length,
      sourceCount: evaluateSourceQuality(sources).verifiedSourceCount
    });
    const tyc = await collectTianyanchaEvidence(company, {
      topics: {
        subject: TOPIC_SUBJECT,
        finance: TOPIC_FINANCE,
        market: TOPIC_MARKET,
        pain: TOPIC_PAIN
      }
    });
    for (const item of arr(tyc.evidence)) {
      if (readUrls.has(item.url)) continue;
      readUrls.add(item.url);
      found.push(item);
      sources.push(item);
    }
    const quality = evaluateSourceQuality(sources);
    await onProgress(15, "天眼查企业事实核验", {
      phaseKey: "resolve",
      detail: `天眼查已补充 ${arr(tyc.evidence).length} 条结构化企业证据；当前可校验证据 ${quality.verifiedSourceCount} 条。`,
      foundCount: uniqBy(found, (source) => source.url).length,
      sourceCount: quality.verifiedSourceCount,
      qualityLevel: quality.qualityLevel
    });
    await checkpointSources("tianyancha", {
      tianyanchaDone: true,
      tianyanchaDiagnostics: tyc.diagnostics || []
    });
  } else if (checkpoint.tianyanchaDone) {
    await onProgress(15, "天眼查企业事实核验", {
      phaseKey: "resolve",
      detail: "已从断点恢复天眼查结构化企业证据。",
      foundCount: uniqBy(found, (source) => source.url).length,
      sourceCount: evaluateSourceQuality(sources).verifiedSourceCount
    });
  }

  await ensureNotCancelled(options);
  await onProgress(16, "检索规划", {
    phaseKey: "plan",
    detail: "正在调用模型生成检索规划。该步骤不会跳过；若模型不可用会停止任务并展示原因。",
    foundCount: uniqBy(found, (source) => source.url).length
  });
  if (!expanded) {
    expanded = await expandPlanWithModels(company, seed, {
      runtimeMode: company.runtimeMode || options.runtimeMode,
      timeoutMs: MODEL_PLANNING_TIMEOUT_MS * 6,
      onProgress: async (state) => {
        await onProgress(16 + Math.round((Number(state.completed || 0) / Math.max(Number(state.total || 1), 1)) * 3), `检索规划：${state.currentSegment || ""}`, {
          phaseKey: "plan",
          detail: `正在规划 ${state.currentSegment || "检索主题"}，已完成 ${state.completed || 0}/${state.total || 0}。`,
          completed: state.completed,
          total: state.total,
          foundCount: uniqBy(found, (source) => source.url).length,
          currentModel: state.currentModel || ""
        });
      }
    });
    usedModels.push(...expanded.models);
    found.push(...expanded.candidateUrls);
    await checkpointSources("plan", {
      plan,
      expandedPlan: expanded,
      progressLabel: "检索规划已保存"
    });
  } else {
    await onProgress(19, "检索规划", {
      phaseKey: "plan",
      detail: "已从断点恢复检索规划，继续读取来源。",
      foundCount: uniqBy(found, (source) => source.url).length,
      currentModel: arr(expanded.models).map((item) => `${item.model}（${item.channel}）`).join(" / ")
      });
  }
  await ensureNotCancelled(options);
  await onProgress(19, "检索规划", {
    phaseKey: "plan",
    detail: `已用 ${expanded.modelCount || arr(expanded.models).length} 次模型规划扩展 ${arr(expanded.queries).length} 组检索词和 ${arr(expanded.candidateUrls).length} 个候选 URL。`,
    foundCount: uniqBy(found, (source) => source.url).length,
    currentModel: arr(expanded.models).map((item) => `${item.model}（${item.channel}）`).join(" / ")
  });

  const stock = companyStockInfo(company);
  if (stock && !checkpoint.financeDone) {
    const financeSeeds = financialHardSources(company);
    await onProgress(20, "上市公司财务采集", {
      phaseKey: "finance",
      detail: `已识别股票代码 ${stock.code}（${stock.market || "证券市场"}），优先读取年报/公告/F10 等财务硬来源。`,
      completed: 0,
      total: financeSeeds.length,
      foundCount: uniqBy([...found, ...financeSeeds], (source) => source.url).length,
      sourceCount: evaluateSourceQuality(sources).verifiedSourceCount
    });
    let financeRead = 0;
    await mapLimit(financeSeeds, 3, async (item) => {
      await ensureNotCancelled(options);
      if (readUrls.has(item.url)) return;
      readUrls.add(item.url);
      const text = await readSourceWithDeadline(item.url);
      const relevance = sourceRelevance(item, company, text);
      financeRead += 1;
      if (relevance.relevant) {
        sources.push({
          ...item,
          ...relevance,
          topic: TOPIC_FINANCE,
          text: clip(text, 9000),
          readable: Boolean(text && text.length > 200),
          confidence: "高",
          usedFor: `上市公司财务硬来源：${stock.code}`
        });
      }
      const quality = evaluateSourceQuality(sources);
      await onProgress(20 + Math.round((financeRead / Math.max(financeSeeds.length, 1)) * 8), "上市公司财务采集", {
        phaseKey: "finance",
        detail: `${relevance.relevant ? "已纳入" : "已跳过无关"} ${financeRead}/${financeSeeds.length}：${clip(item.title, 54)}；${relevance.relevanceReason}。`,
        completed: financeRead,
        total: financeSeeds.length,
        foundCount: uniqBy([...found, ...financeSeeds], (source) => source.url).length,
        sourceCount: quality.verifiedSourceCount,
        qualityLevel: quality.qualityLevel
      });
      if (financeRead % 3 === 0 || financeRead === financeSeeds.length) {
        await checkpointSources("finance", { financeRead, financeDone: financeRead === financeSeeds.length });
      }
    });
    await checkpointSources("finance", { financeDone: true });
  } else if (stock && checkpoint.financeDone) {
    await onProgress(28, "上市公司财务采集", {
      phaseKey: "finance",
      detail: "已从断点恢复上市公司财务来源读取结果，继续分主题检索。",
      sourceCount: evaluateSourceQuality(sources).verifiedSourceCount
    });
  }

  for (let topicIndex = 0; topicIndex < TOPIC_NAMES.length; topicIndex += 1) {
    await ensureNotCancelled(options);
    const topic = TOPIC_NAMES[topicIndex];
    const topicStart = 30 + topicIndex * 8;
    const topicEnd = topicStart + 7;
    if (completedSourceTopics.has(topic)) {
      await onProgress(topicEnd, `专题完成：${topic}`, {
        phaseKey: "read",
        detail: `已从断点恢复“${topic}”来源读取结果，跳过重复读取。`,
        foundCount: uniqBy(found, (source) => source.url).length,
        sourceCount: evaluateSourceQuality(sources).verifiedSourceCount
      });
      continue;
    }
    const topicFound = [...seed.filter((item) => item.topic === topic), ...arr(expanded.candidateUrls).filter((item) => item.topic === topic)];
    let topicPlan = [...plan.filter((item) => item.topic === topic), ...arr(expanded.queries).filter((item) => item.topic === topic)];
    if (topicPlan.length < 5) topicPlan.push(...buildRescuePlan(company, [topic]).slice(0, 5 - topicPlan.length));
    const startingQuality = evaluateSourceQuality(sources);
    const hasStrongPool =
      startingQuality.qualityLevel === "formal" &&
      startingQuality.verifiedSourceCount >= SOURCE_POOL_TARGET &&
      startingQuality.topicCoverageCount >= 4;
    const hasVeryStrongPool =
      startingQuality.qualityLevel === "formal" &&
      startingQuality.verifiedSourceCount >= STRONG_SOURCE_POOL_TARGET &&
      startingQuality.topicCoverageCount >= 5;
    const topicPlanLimit = hasVeryStrongPool ? 4 : hasStrongPool ? 6 : topicPlan.length;
    topicPlan = topicPlan.slice(0, topicPlanLimit);
    const topicReadTarget = hasVeryStrongPool ? 12 : hasStrongPool ? 18 : TOPIC_READ_LIMIT;

    await onProgress(topicStart, `分主题检索：${topic}`, {
      phaseKey: "search",
      detail: `开始专题检索，计划 ${topicPlan.length} 组搜索词，目标读取 ${topicReadTarget} 个高优先级来源。`,
      completed: 0,
      total: topicPlan.length,
      foundCount: uniqBy(found, (source) => source.url).length,
      sourceCount: evaluateSourceQuality(sources).verifiedSourceCount
    });

    let topicSearchDone = 0;
    const topicSearchResults = await mapLimit(topicPlan, 3, async (item) => {
      await ensureNotCancelled(options);
      const results = await searchWeb(item.query, item.limit, item.topic);
      const diagnosticText = searchDiagnosticText(results);
      topicSearchDone += 1;
      await onProgress(topicStart + Math.min(4, Math.round((topicSearchDone / Math.max(topicPlan.length, 1)) * 4)), `分主题检索：${topic}`, {
        phaseKey: "search",
        detail: `已完成 ${topicSearchDone}/${topicPlan.length} 组：${clip(item.query, 64)}；本专题新增候选 ${results.length} 个。${diagnosticText ? ` ${diagnosticText}。` : ""}`,
        completed: topicSearchDone,
        total: topicPlan.length,
        foundCount: uniqBy([...found, ...topicFound, ...results], (source) => source.url).length,
        sourceCount: evaluateSourceQuality(sources).verifiedSourceCount
      });
      return results;
    });
    for (const result of topicSearchResults.flat()) {
      topicFound.push(result);
      found.push(result);
    }

    const topicCandidates = uniqBy(topicFound, (item) => item.url)
      .filter((item) => !readUrls.has(item.url))
      .sort((a, b) => priorityScore(b) - priorityScore(a))
      .slice(0, topicReadTarget);

    let topicRead = 0;
    await mapLimit(topicCandidates, 4, async (item) => {
      await ensureNotCancelled(options);
      if (readUrls.has(item.url)) return;
      readUrls.add(item.url);
      const text = await readSourceWithDeadline(item.url);
      const relevance = sourceRelevance({ ...item, topic }, company, text);
      if (relevance.relevant) {
        sources.push({
          ...item,
          ...relevance,
          topic,
          text: clip(text, 7000),
          readable: Boolean(text && text.length > 200),
          confidence: relevance.confidence || (relevance.sourceType === "财务硬来源" ? "高" : confidenceForUrl(item.url)),
          usedFor: item.usedFor || `${relevance.sourceType}：${topic}`
        });
      }
      topicRead += 1;
      const quality = evaluateSourceQuality(sources);
      await onProgress(topicStart + 4 + Math.min(5, Math.round((topicRead / Math.max(topicCandidates.length, 1)) * 5)), `来源读取：${topic}`, {
        phaseKey: "read",
        detail: `第 ${topicRead}/${topicCandidates.length} 个：${clip(item.title, 54)}；${relevance.relevant ? "纳入" : "跳过"}：${relevance.relevanceReason}；当前可校验 ${quality.verifiedSourceCount} 条、可读 ${quality.readableSourceCount} 条。`,
        completed: topicRead,
        total: topicCandidates.length,
        foundCount: uniqBy(found, (source) => source.url).length,
        sourceCount: quality.verifiedSourceCount,
        qualityLevel: quality.qualityLevel
      });
      if (topicRead % 5 === 0 || topicRead === topicCandidates.length) {
        await checkpointSources(`topic:${topic}`, { currentTopic: topic, topicRead });
      }
    });

    const topicQuality = evaluateSourceQuality(sources);
    completedSourceTopics.add(topic);
    await checkpointSources(`topic:${topic}:done`, { currentTopic: topic });
    await onProgress(topicEnd, `专题完成：${topic}`, {
      phaseKey: "read",
      detail: `本专题完成；累计可校验 ${topicQuality.verifiedSourceCount} 条、可读 ${topicQuality.readableSourceCount} 条、覆盖 ${topicQuality.topicCoverageCount} 类主题。`,
      foundCount: uniqBy(found, (source) => source.url).length,
      sourceCount: topicQuality.verifiedSourceCount,
      qualityLevel: topicQuality.qualityLevel
    });
  }

  let quality = evaluateSourceQuality(sources);
  const financeMetricHitCount = () => {
    const financeCorpus = sources
      .filter((source) => source.topic === TOPIC_FINANCE || source.sourceType === "财务硬来源")
      .map((source) => source.text || "")
      .join(" ");
    return ["营业收入", "净利润", "现金流", "研发", "员工", "资产负债", "毛利"].filter((term) => financeCorpus.includes(term)).length;
  };
  const annualMetricHitCount = () => (Array.isArray(company.annualReportEvidence?.metrics) ? company.annualReportEvidence.metrics.length : 0);
  const businessSignalCount = () => sources.filter((source) =>
    /official_product|customer_case|digital_capability|tender_project|patent_ip|hiring_org/.test(sourceFamilyOf(source, source.url, source.sourceType))
  ).length;
  const businessCoverageCount = () => {
    const corpus = sources
      .filter((source) => /official_product|customer_case|digital_capability|tender_project|patent_ip|hiring_org|industry_context/.test(sourceFamilyOf(source, source.url, source.sourceType)))
      .map((source) => `${source.title || ""} ${source.snippet || ""} ${source.query || ""} ${source.text || ""}`)
      .join("\n")
      .toLowerCase();
    return [
      /产品|平台|系统|solution|platform|hollicube|holli|工业软件|工业互联网/.test(corpus),
      /客户案例|项目案例|标杆|蒙牛|案例|case study|customer case/.test(corpus),
      /交付|实施|上线|运维|客户成功|implementation|delivery/.test(corpus),
      /生态|合作伙伴|伙伴网络|联合方案|ecosystem|partner/.test(corpus),
      /mes|aps|erp|sap|wms|lims|scada|集成|对接|integration/.test(corpus),
      /aiops|可观测|实时数据库|工业数据|数据治理|智能问答|ai|人工智能/.test(corpus),
      /投标|招标|中标|采购|售前|tender|bid|procurement/.test(corpus),
      /招聘|岗位|组织|团队|工程师|career|job/.test(corpus),
      /专利|软著|软件著作权|知识产权|patent|copyright/.test(corpus)
    ].filter(Boolean).length;
  };
  const hasRequiredFinancialEvidence = () =>
    !stock || financeMetricHitCount() >= 3 || quality.verifiedSourceCount >= STRONG_SOURCE_POOL_TARGET;
  const hasRequiredAnnualEvidence = () =>
    !company.annualReportEvidence || annualMetricHitCount() >= 4 || quality.verifiedSourceCount >= STRONG_SOURCE_POOL_TARGET;
  const hasEnoughBusinessEvidence = () =>
    quality.qualityLevel === "formal" &&
    quality.verifiedSourceCount >= SOURCE_POOL_TARGET &&
    businessSignalCount() >= 16 &&
    businessCoverageCount() >= 5 &&
    hasRequiredFinancialEvidence() &&
    hasRequiredAnnualEvidence();
  const needsMoreEvidence = () => {
    if (hasEnoughBusinessEvidence()) return false;
    if (quality.qualityLevel === "formal" && quality.verifiedSourceCount >= STRONG_SOURCE_POOL_TARGET) return false;
    return (
      quality.verifiedSourceCount < SOURCE_POOL_TARGET ||
      businessSignalCount() < 20 ||
      businessCoverageCount() < 6 ||
      Boolean(stock && financeMetricHitCount() < 3) ||
      Boolean(company.annualReportEvidence && annualMetricHitCount() < 4)
    );
  };
  for (let round = 1; round <= 3 && needsMoreEvidence(); round += 1) {
    if (completedRescueRounds.has(round)) {
      await onProgress(78, `补充检索：第 ${round}/3 轮已恢复`, {
        phaseKey: "read",
        detail: "已从断点恢复本轮补充检索结果，跳过重复扩容与读取。",
        sourceCount: quality.verifiedSourceCount,
        foundCount: quality.verifiedSourceCount
      });
      continue;
    }
    const rescueFound = [];
    const scarceEvidence = quality.verifiedSourceCount < 8;
    const hasFinancialGap = Boolean(stock && financeMetricHitCount() < 3) || Boolean(company.annualReportEvidence && annualMetricHitCount() < 4);
    const rescuePlanLimit = scarceEvidence || hasFinancialGap ? 18 : 12;
    const rescuePlan = buildRescuePlan(company, quality.missingTopics).slice(0, rescuePlanLimit);
    await onProgress(68 + round, `第 ${round}/3 轮证据扩容`, {
      phaseKey: "search",
      detail: `当前可引用证据 ${quality.verifiedSourceCount} 条，最低门槛 15 条，证据池目标 ${SOURCE_POOL_TARGET} 条；开始围绕缺口主题扩展检索渠道。`,
      sourceCount: quality.verifiedSourceCount,
      foundCount: quality.verifiedSourceCount
    });
    const rescueExpanded = await expandPlanWithModels(
      { ...company, sourceGaps: quality.missingTopics, sourceQuality: quality.qualityLabel },
      sources,
      {
        aggressive: true,
        maxOutputs: 6,
        runtimeMode: company.runtimeMode || options.runtimeMode,
        timeoutMs: MODEL_PLANNING_TIMEOUT_MS * 6,
        sourceGaps: quality.missingTopics,
        missingTopics: quality.missingTopics,
        onProgress: async (state) => {
          await onProgress(70 + round, `第 ${round}/3 轮模型扩容：${state.currentSegment || ""}`, {
            phaseKey: "search",
            detail: `正在用模型扩展 ${state.currentSegment || "检索主题"}，已完成 ${state.completed || 0}/${state.total || 0}。`,
            completed: state.completed,
            total: state.total,
            sourceCount: quality.verifiedSourceCount,
            foundCount: quality.verifiedSourceCount,
            currentModel: state.currentModel || ""
          });
        }
      }
    );
    usedModels.push(...rescueExpanded.models.map((item) => ({ ...item, purpose: "补充检索规划" })));
    await checkpointSources(`rescue:${round}:plan`, { rescueRound: round });
    await onProgress(72, `第 ${round}/3 轮多模型补充检索规划`, {
      phaseKey: "search",
      detail: `已调用 ${rescueExpanded.modelCount} 次补充模型规划，扩展 ${rescueExpanded.queries.length} 组检索词和 ${rescueExpanded.candidateUrls.length} 个候选来源。`,
      sourceCount: quality.verifiedSourceCount,
      foundCount: quality.verifiedSourceCount,
      currentModel: rescueExpanded.models.map((item) => `${item.model}（${item.channel}）`).join(" / ")
    });
    rescueFound.push(...rescueExpanded.candidateUrls);

    let rescueDone = 0;
    const deterministicRescue = await mapLimit(rescuePlan, 3, async (item) => {
      await ensureNotCancelled(options);
      const results = await searchWeb(item.query, item.limit, item.topic);
      const diagnosticText = searchDiagnosticText(results);
      rescueDone += 1;
      await onProgress(71 + Math.round((rescueDone / Math.max(rescuePlan.length, 1)) * 2), `补充检索：${item.topic}`, {
        phaseKey: "search",
        detail: `已完成 ${rescueDone}/${rescuePlan.length} 组：${clip(item.query, 64)}${diagnosticText ? `；${diagnosticText}` : ""}`,
        completed: rescueDone,
        total: rescuePlan.length,
        foundCount: uniqBy([...found, ...rescueFound, ...results], (source) => source.url).length
      });
      return results;
    });
    rescueFound.push(...deterministicRescue.flat());

    const rescueQueries = rescueExpanded.queries.slice(0, scarceEvidence || hasFinancialGap ? 24 : 16);
    let modelRescueDone = 0;
    const modelRescue = await mapLimit(rescueQueries, 3, async (item) => {
      await ensureNotCancelled(options);
      const results = await searchWeb(item.query, item.limit, item.topic);
      const diagnosticText = searchDiagnosticText(results);
      modelRescueDone += 1;
      await onProgress(73 + Math.round((modelRescueDone / Math.max(rescueQueries.length, 1)) * 2), `多模型补充：${item.topic}`, {
        phaseKey: "search",
        detail: `已完成 ${modelRescueDone}/${rescueQueries.length} 组：${clip(item.query, 64)}${diagnosticText ? `；${diagnosticText}` : ""}`,
        completed: modelRescueDone,
        total: rescueQueries.length,
        foundCount: uniqBy([...found, ...rescueFound, ...results], (source) => source.url).length
      });
      return results;
    });
    rescueFound.push(...modelRescue.flat());
    found.push(...rescueFound);

    const seen = new Set(sources.map((source) => source.url));
    const businessBackfill = uniqBy(found, (item) => item.url)
      .filter((item) => !seen.has(item.url) && isBusinessInsightCandidate(item))
      .sort((a, b) => priorityScore(b) - priorityScore(a))
      .slice(0, 40);
    rescueFound.push(...businessBackfill);
    const rescueReadTarget =
      scarceEvidence || hasFinancialGap
        ? RESCUE_READ_LIMIT
        : Math.max(12, Math.min(RESCUE_READ_LIMIT, SOURCE_POOL_TARGET + 8 - quality.verifiedSourceCount));
    const rescueCandidates = uniqBy(rescueFound, (item) => item.url)
      .filter((item) => !seen.has(item.url) && !readUrls.has(item.url))
      .sort((a, b) => priorityScore(b) - priorityScore(a))
      .slice(0, rescueReadTarget);
    let rescueRead = 0;
    await mapLimit(rescueCandidates, 4, async (item) => {
      await ensureNotCancelled(options);
      const text = await readSourceWithDeadline(item.url);
      const relevance = sourceRelevance(item, company, text);
      if (relevance.relevant) {
        sources.push({
          ...item,
          ...relevance,
          text: clip(text, 7000),
          readable: Boolean(text && text.length > 200),
          confidence: relevance.confidence || (relevance.sourceType === "财务硬来源" ? "高" : confidenceForUrl(item.url)),
          usedFor: item.usedFor || `${relevance.sourceType}：${item.topic || "补充资料"}`
        });
      }
      rescueRead += 1;
      quality = evaluateSourceQuality(sources);
      await onProgress(75 + Math.round((rescueRead / Math.max(rescueCandidates.length, 1)) * 3), `补充读取：${item.topic || "资料来源"}`, {
        phaseKey: "read",
        detail: `第 ${rescueRead}/${rescueCandidates.length} 个：${clip(item.title, 54)}；${relevance.relevant ? "纳入" : "跳过"}：${relevance.relevanceReason}；可校验来源 ${quality.verifiedSourceCount} 个，可读来源 ${quality.readableSourceCount} 个。`,
        completed: rescueRead,
        total: rescueCandidates.length,
        foundCount: quality.verifiedSourceCount,
        sourceCount: quality.verifiedSourceCount
      });
      if (rescueRead % 5 === 0 || rescueRead === rescueCandidates.length) {
        await checkpointSources(`rescue:${round}:read`, { rescueRound: round, rescueRead });
      }
    });
    quality = evaluateSourceQuality(sources);
    completedRescueRounds.add(round);
    await checkpointSources(`rescue:${round}:done`, { rescueRound: round, completedRescueRounds: [...completedRescueRounds] });
  }

  const finalSources = uniqBy(sources, (source) => source.url);
  Object.defineProperty(finalSources, "usedModels", {
    value: uniqBy(usedModels.filter(Boolean), (item) => `${item.channel}|${item.model}|${item.purpose}`),
    enumerable: false
  });
  await checkpointSources("sources:done", { sources: finalSources, sourceCollectionDone: true });
  return finalSources;
}

function coreName(name) {
  return String(name || "")
    .replace(/(股份有限公司|有限责任公司|集团有限公司|有限公司|公司)$/g, "")
    .replace(/[（）()·\-\s]/g, "");
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanCandidateName(value, query = "") {
  const legalSuffix = "(?:股份有限公司|有限责任公司|集团有限公司|有限公司)";
  const queryText = String(query || "").trim();
  const escapedQueryText = escapeRegExp(queryText);
  const queryCompanyMatch = queryText.match(new RegExp(`^[\\u4e00-\\u9fa5A-Za-z0-9（）()·-]{2,60}${legalSuffix}$`));
  let name = cleanTitle(value)
    .replace(/^(公司别称|公司名称|企业名称|企业简称|主体名称)[：:，,\s]*/g, "")
    .replace(/^(我们|我们-|我们－|我们—|这里是|这里有|本站为您提供|欢迎来到)[：:，,\s-]*/g, "")
    .replace(/^(猎聘为您提供\d{4}年?|猎聘|BOSS直聘|前程无忧|智联招聘|看准网|职友集|企查查|爱企查|水滴信用|天眼查)[：:，,\s]*/i, "")
    .replace(/^(更有|以及|还有|另有|包括|旗下|提供|有|和|与|关于|查询|查看|了解|进入|欢迎访问)[：:，,\s]*/g, "")
    .replace(/^(薪资待遇|工资待遇|招聘信息|招聘|岗位|职位|评价|怎么样|地址电话)[：:，,\s]*/g, "")
    .replace(/(招聘信息|招聘|工资待遇|薪资待遇|职位|岗位|怎么样|地址电话|电话|官网|简介).*$/g, "")
    .replace(/[《》【】[\]{}]/g, "")
    .trim();
  if (queryCompanyMatch && name.includes(queryText)) return queryText;
  const queryDerived = queryText && name.match(new RegExp(`${escapedQueryText}[\\u4e00-\\u9fa5A-Za-z0-9（）()·-]{0,24}?${legalSuffix}`))?.[0];
  if (queryDerived) return queryDerived;
  const match = name.match(new RegExp(`[\\u4e00-\\u9fa5A-Za-z0-9][\\u4e00-\\u9fa5A-Za-z0-9（）()·-]{2,60}?${legalSuffix}`));
  if (match) name = match[0];
  if (/薪资|待遇|招聘|职位|岗位|猎聘|为您提供|这里是|公司别称|注册成立|成立的|是一家|是\d{4}/.test(name)) return "";
  return name;
}

function candidateScore(name, query, region, industry, sources, stockCode = "") {
  const nameCore = coreName(name);
  const queryCore = coreName(query);
  const sourceText = sources.map((item) => `${item.title || ""} ${item.snippet || ""} ${item.url || ""}`).join(" ");
  const nameMatch = candidateNameMatchesQuery(name, query, stockCode, sources);
  let score = nameMatch ? 52 : 18;
  if (name.includes(query) || query.includes(nameCore) || nameCore.includes(queryCore) || queryCore.includes(nameCore)) score += 36;
  if (stockCode) score += sourceText.includes(stockCode) ? 28 : 18;
  if (region && (name.includes(region) || sourceText.includes(region))) score += 8;
  if (industry && sourceText.includes(industry)) score += 5;
  score += Math.min(28, sources.reduce((sum, item) => sum + Math.max(0, trustedDomainScore(item.url)), 0));
  score -= Math.min(20, sources.filter((item) => trustedDomainScore(item.url) < 0).length * 6);
  return score;
}

function candidateNameMatchesQuery(name, query, stockCode = "", sources = []) {
  const nameCore = coreName(name);
  const queryCore = coreName(query);
  const sourceText = sources.map((item) => `${item.title || ""} ${item.snippet || ""} ${item.url || ""}`).join(" ");
  if (!nameCore || !queryCore) return false;
  if (name.includes(query) || query.includes(nameCore) || nameCore.includes(queryCore) || queryCore.includes(nameCore)) return true;
  if (stockCode && sourceText.includes(stockCode)) return true;
  if (nameCore.length >= 4 && queryCore.length >= 4) {
    const shorter = nameCore.length < queryCore.length ? nameCore : queryCore;
    const longer = nameCore.length < queryCore.length ? queryCore : nameCore;
    if (shorter.length >= 4 && longer.includes(shorter)) return true;
  }
  return false;
}

async function resolveTianyanchaCandidateSafely(query, region, industry) {
  try {
    return await resolveTianyanchaCandidateDetailed(query, region, industry);
  } catch (error) {
    const configured = hasTianyanchaKey();
    return {
      candidate: null,
      diagnostic: {
        provider: "tianyancha",
        status: configured ? "api_failed" : "missing_key",
        configured,
        message: configured ? "天眼查核验接口暂时不可用" : "生产环境尚未配置天眼查核验",
        error: clip(error?.message || "tianyancha_resolve_failed", 220)
      }
    };
  }
}

export async function resolveCandidates(query, region = "", industry = "", aiNeeds = "") {
  const tycResolved = await resolveTianyanchaCandidateSafely(query, region, industry);
  const tycCandidate = tycResolved.candidate;
  const tianyanchaDiagnostic = tycResolved.diagnostic;
  const hasStrongTycCandidate = Boolean(tycCandidate && Number(tycCandidate.confidence || 0) >= 90);
  const stockCode = extractStockCode(query, region, industry, aiNeeds);
  const searchQuery = `${query} ${region} ${industry} ${stockCode} 官网 工商 公司简介 股票代码`;
  const results = await searchWeb(searchQuery, 12, TOPIC_SUBJECT, 7000);
  const nameMap = new Map();
  const companyRe = /[\u4e00-\u9fa5A-Za-z0-9][\u4e00-\u9fa5A-Za-z0-9（）()·-]{2,60}?(?:股份有限公司|有限责任公司|集团有限公司|有限公司)/g;
  for (const item of results) {
    const text = `${item.title || ""} ${item.snippet || ""}`;
    for (const match of text.matchAll(companyRe)) {
      const name = cleanCandidateName(match[0], query);
      if (!name || name.length < 6) continue;
      const key = coreName(name);
      if (!key || key.length < 3) continue;
      const current = nameMap.get(key) || { name, sources: [] };
      current.name = current.name.length >= name.length ? current.name : name;
      current.sources.push(item);
      nameMap.set(key, current);
    }
  }

  if (/集团$/.test(query)) {
    const derived = `${query}有限公司`;
    const key = coreName(derived);
    if (!nameMap.has(key)) {
      const related = results.filter((item) => `${item.title || ""} ${item.snippet || ""}`.includes(query)).slice(0, 5);
      nameMap.set(key, { name: derived, sources: related });
    }
  }

  if (stockCode) {
    const related = results.filter((item) => `${item.title || ""} ${item.snippet || ""} ${item.url || ""}`.includes(stockCode)).slice(0, 5);
    const key = coreName(query);
    if (key && !nameMap.has(key)) nameMap.set(key, { name: query, sources: related.length ? related : financialHardSources({ standardName: query, stockCode }) });
  }

  if (/(股份有限公司|有限责任公司|集团有限公司|有限公司)$/.test(query)) {
    const key = coreName(query);
    const related = results
      .filter((item) => {
        const text = `${item.title || ""} ${item.snippet || ""} ${item.url || ""}`;
        return text.includes(query) || (key && text.includes(key)) || (stockCode && text.includes(stockCode));
      })
      .slice(0, 6);
    if (key && (!nameMap.has(key) || related.length)) {
      const current = nameMap.get(key) || { name: query, sources: [] };
      nameMap.set(key, { name: query, sources: uniqBy([...related, ...current.sources], (source) => source.url) });
    }
  }

  const candidates = Array.from(nameMap.values())
    .filter((item) => candidateNameMatchesQuery(item.name, query, stockCode, item.sources))
    .map((item) => {
      const relatedSources = uniqBy(item.sources, (source) => source.url)
        .sort((a, b) => trustedDomainScore(b.url) - trustedDomainScore(a.url))
        .slice(0, 5);
      const score = candidateScore(item.name, query, region, industry, relatedSources, stockCode);
      const nonOfficialDirectory = /qcc\.com|aiqicha|tianyancha|shuidi|qixin|qichamao|zhipin|liepin|51job|zhaopin|kanzhun|jobui/i;
      const displayWebsite =
        relatedSources.find((source) => !/\.pdf(?:$|\?)/i.test(source.url) && !nonOfficialDirectory.test(source.url) && /(\u5b98\u7f51|official|www\.|\.com)/i.test(`${source.title} ${source.url}`))?.url ||
        relatedSources.find((source) => !/\.pdf(?:$|\?)/i.test(source.url) && trustedDomainScore(source.url) >= 18 && !nonOfficialDirectory.test(source.url))?.url ||
        "";
      const searchConfidence = Math.max(55, Math.min(hasStrongTycCandidate ? 88 : 95, score));
      return {
        name: item.name,
        standardName: item.name,
        region,
        industry,
        stockCode,
        listingMarket: stockCode ? stockExchange(stockCode).market : "",
        website: displayWebsite,
        confidence: searchConfidence,
        reason: `根据公开搜索结果抽取候选主体；匹配来源 ${relatedSources.length} 条。${stockCode ? `股票代码 ${stockCode} 已作为强匹配信号。` : ""}`,
        scoreBreakdown: {
          nameMatch: item.name.includes(query) || query.includes(coreName(item.name)),
          stockCodeMatch: Boolean(stockCode),
          regionMatch: Boolean(region && (item.name.includes(region) || relatedSources.some((source) => `${source.title || ""} ${source.snippet || ""}`.includes(region)))),
          industryMatch: Boolean(industry && relatedSources.some((source) => `${source.title || ""} ${source.snippet || ""}`.includes(industry))),
          trustedSources: relatedSources.filter((source) => trustedDomainScore(source.url) > 0).length,
          negativeSources: relatedSources.filter((source) => trustedDomainScore(source.url) < 0).length
        },
        sourceUrls: relatedSources.map((source) => source.url)
      };
    })
    .filter((candidate) => Number(candidate.confidence || 0) >= 60 || candidate.standardName === query || Boolean(stockCode))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);

  const mergedCandidates = hasStrongTycCandidate
    ? [
        {
          ...tycCandidate,
          confidence: Math.max(Number(tycCandidate.confidence || 0), 96),
          reason: "企业主体已通过天眼查工商登记核验。"
        }
      ]
    : uniqBy([tycCandidate, ...candidates].filter(Boolean), (item) => coreName(item.standardName || item.name))
        .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))
        .slice(0, 5);

  if (mergedCandidates.length) {
    return {
      candidates: mergedCandidates,
      model: hasStrongTycCandidate ? "tianyancha-primary-resolve" : tycCandidate ? "tianyancha-search-resolve" : "search-resolve",
      channel: hasStrongTycCandidate ? "tianyancha-mcp-primary+search-supplement" : tycCandidate ? "tianyancha-mcp+search" : "search",
      tianyanchaDiagnostic
    };
  }
  const fallbackWebsite = results.find((item) => trustedDomainScore(item.url) >= 0)?.url || "";
  return {
    candidates: [
      {
        name: query,
        standardName: query,
        region,
        industry,
        stockCode,
        listingMarket: stockCode ? stockExchange(stockCode).market : "",
        website: fallbackWebsite,
        confidence: stockCode ? 88 : results.length ? 70 : 55,
        reason: stockCode ? `已按输入主体和股票代码 ${stockCode} 建立上市公司候选，生成阶段会强制采集年报/财报来源。` : results.length ? "已根据公开搜索结果形成候选主体。" : "未能完成主体核对，先按输入名称作为候选主体。",
        sourceUrls: results.slice(0, 5).map((item) => item.url)
      }
    ],
    model: results.length ? "search-fallback" : "fallback",
    channel: results.length ? "search-fallback" : "fallback",
    tianyanchaDiagnostic
  };
}
