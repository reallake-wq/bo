import { clip, env, uniqBy } from "./util.mjs";

const DEFAULT_TYC_ENDPOINT = "https://mcp.tianyancha.com/v1";
const TYC_PROTOCOL_VERSION = "2024-11-05";
const TYC_TIMEOUT_MS = 14000;
const sessionCache = new Map();

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（）()【】\[\]《》“”"'·\-.]/g, "")
    .replace(/(股份有限公司|有限责任公司|集团有限公司|有限公司|公司)$/g, "");
}

function sameCompanyName(a, b) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  let hit = 0;
  for (const char of new Set([...left])) {
    if (right.includes(char)) hit += 1;
  }
  return hit / Math.max(left.length, right.length) >= 0.72;
}

function tycKey() {
  return env("TIANYANCHA_API_KEY") || env("TYC_AUTHORIZATION") || "";
}

function tycEndpoint() {
  return env("TYC_MCP_ENDPOINT") || DEFAULT_TYC_ENDPOINT;
}

function tycOpenApiBase() {
  return env("TYC_OPEN_API_BASE") || "http://open.api.tianyancha.com";
}

export function hasTianyanchaKey() {
  return Boolean(tycKey());
}

async function postJson(body, headers = {}, timeoutMs = TYC_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(tycEndpoint(), {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream, */*",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        "cache-control": "no-cache",
        "content-type": "application/json",
        "mcp-protocol-version": TYC_PROTOCOL_VERSION,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) OAC/1.0",
        ...headers
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

async function callTianyanchaOpenApi(path, params = {}, timeoutMs = TYC_TIMEOUT_MS) {
  if (!hasTianyanchaKey()) return { ok: false, tool: path, skipped: true, error: "missing_key" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = new URL(path, tycOpenApiBase());
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null && String(value).trim()) url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: tycKey(),
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) OAC/1.0"
      },
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) return { ok: false, tool: path, status: response.status, error: clip(text, 260) };
    const payload = JSON.parse(text);
    if (payload.error_code && Number(payload.error_code) !== 0) {
      return { ok: false, tool: path, status: payload.error_code, error: payload.reason || payload.message || "openapi_error" };
    }
    return { ok: true, tool: path, data: payload.result || payload.data || payload, rawResult: payload };
  } catch (error) {
    return { ok: false, tool: path, error: error?.message || "openapi_error" };
  } finally {
    clearTimeout(timer);
  }
}

async function callTianyanchaOpenBaseInfo(query, timeoutMs = TYC_TIMEOUT_MS) {
  return callTianyanchaOpenApi("/services/open/ic/baseinfoV2/2.0", { keyword: query }, timeoutMs);
}

async function initializeSession(timeoutMs = TYC_TIMEOUT_MS) {
  const authorization = tycKey();
  if (!authorization) throw new Error("missing TIANYANCHA_API_KEY");
  const endpoint = tycEndpoint();
  const cached = sessionCache.get(endpoint);
  if (cached && Date.now() - cached.createdAt < 23 * 60 * 60 * 1000) return cached.sessionId;
  const { response, text } = await postJson(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: TYC_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "oac-advisory-crew", version: "1.0.0" }
      }
    },
    { authorization },
    timeoutMs
  );
  if (!response.ok) throw new Error(`tianyancha initialize http ${response.status}: ${clip(text, 180)}`);
  const sessionId = response.headers.get("Mcp-Session-Id") || response.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("tianyancha initialize missing session id");
  try {
    const payload = JSON.parse(text);
    if (payload.error) throw new Error(payload.error.message || "tianyancha initialize rpc error");
  } catch (error) {
    if (!String(text || "").trim().startsWith("{")) throw error;
  }
  sessionCache.set(endpoint, { sessionId, createdAt: Date.now() });
  return sessionId;
}

function parseToolResult(result) {
  const content = arr(result?.content);
  const text = content
    .map((item) => item?.text || item?.content || "")
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function sessionInvalid(status, text = "") {
  const lower = String(text || "").toLowerCase();
  return status === 404 || status === 410 || lower.includes("session not found") || lower.includes("invalid session");
}

export async function callTianyanchaTool(name, args = {}, options = {}) {
  if (!hasTianyanchaKey()) {
    return { ok: false, tool: name, skipped: true, error: "missing_key" };
  }
  try {
    const authorization = tycKey();
    const timeoutMs = options.timeoutMs || TYC_TIMEOUT_MS;
    let sessionId = await initializeSession(timeoutMs);
    const doCall = async () =>
      postJson(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name, arguments: args }
        },
        { authorization, "Mcp-Session-Id": sessionId },
        timeoutMs
      );
    let { response, text } = await doCall();
    if (sessionInvalid(response.status, text)) {
      sessionCache.delete(tycEndpoint());
      sessionId = await initializeSession(timeoutMs);
      ({ response, text } = await doCall());
    }
    if (!response.ok) return { ok: false, tool: name, status: response.status, error: clip(text, 260) };
    const payload = JSON.parse(text);
    if (payload.error) return { ok: false, tool: name, error: payload.error.message || "rpc_error" };
    return { ok: true, tool: name, data: parseToolResult(payload.result), rawResult: payload.result };
  } catch (error) {
    return { ok: false, tool: name, error: error?.message || "parse_error" };
  }
}

function stringifyData(value, max = 8000) {
  if (value == null) return "";
  if (typeof value === "string") return clip(value, max);
  try {
    return clip(JSON.stringify(value, null, 2), max);
  } catch {
    return clip(String(value), max);
  }
}

function dataHasUsefulPayload(data) {
  if (!data) return false;
  const text = stringifyData(data, 1200);
  if (!text || text.length < 20) return false;
  if (/"_empty"\s*:\s*true/.test(text)) return false;
  if (/经查无结果|暂无数据|无相关信息/.test(text) && text.length < 400) return false;
  return true;
}

function titleOf(tool) {
  return {
      get_company_registration_info: "工商登记",
      get_company_registration_info_openapi: "工商登记",
    get_actual_controller: "实际控制人",
    get_beneficial_owners: "受益所有人",
    get_key_personnel: "主要人员",
    get_equity_tree: "股权图谱",
    get_group_info: "集团信息",
    get_financial_data: "财务数据",
    get_annual_reports: "企业年报",
    get_risk_overview: "综合风险",
    get_dishonest_info: "失信被执行",
    get_judgment_debtor_info: "被执行人",
    get_high_consumption_restriction: "限制高消费",
    get_bidding_info: "招投标",
    get_qualifications: "资质证书",
    get_administrative_license: "行政许可",
    get_recruitment_info: "招聘线索",
    get_patent_info: "专利信息",
    get_software_copyright_info: "软件著作权"
  }[tool] || tool;
}

function topicOf(tool, topics = {}) {
  if (/financial|annual/.test(tool)) return topics.finance;
  if (/risk|dishonest|debtor|restriction/.test(tool)) return topics.pain;
  if (/bidding|license|qualifications|patent|copyright|recruitment/.test(tool)) return topics.market;
  return topics.subject;
}

function sourceTypeOf(tool = "") {
  if (/financial|annual/.test(tool)) return "财务硬来源";
  if (/risk|dishonest|debtor|restriction/.test(tool)) return "风险合规来源";
  if (/bidding|license|qualifications|patent|copyright|recruitment/.test(tool)) return "企业公开来源";
  return "主体核对来源";
}

function tianyanchaSearchUrl(companyName, tool = "") {
  const suffix = tool ? `&oac_source=${encodeURIComponent(tool)}` : "";
  return `https://www.tianyancha.com/search?key=${encodeURIComponent(companyName || "")}${suffix}`;
}

export function tianyanchaResultToSource(result, companyName, topics = {}) {
  const title = titleOf(result.tool);
  const dataText = stringifyData(result.data, 9000);
  return {
    title: `天眼查 API｜${title}｜${companyName}`,
    url: tianyanchaSearchUrl(companyName, result.tool),
    snippet: clip(result.data?._summary || dataText, 900),
    text: dataText,
    query: `${companyName} ${title}`,
    topic: topicOf(result.tool, topics),
    provider: "tianyancha-api",
    sourceType: sourceTypeOf(result.tool),
    readable: true,
    confidence: "高",
    isCompanySpecific: true,
    relevanceScore: 80,
    isStructuredEvidence: true,
    structuredProvider: "tianyancha",
    structuredTool: result.tool,
    usedFor: `天眼查结构化数据：${title}`,
    relevanceReason: "天眼查 API 直接按企业名称/统一社会信用代码返回结构化数据"
  };
}

const CORE_TOOLS = [
  "get_company_registration_info",
  "get_actual_controller",
  "get_beneficial_owners",
  "get_key_personnel",
  "get_equity_tree",
  "get_group_info",
  "get_financial_data",
  "get_annual_reports",
  "get_risk_overview",
  "get_dishonest_info",
  "get_judgment_debtor_info",
  "get_high_consumption_restriction",
  "get_bidding_info",
  "get_qualifications",
  "get_administrative_license",
  "get_recruitment_info",
  "get_patent_info",
  "get_software_copyright_info"
];

function configuredExtraTools() {
  return String(env("TIANYANCHA_EXTRA_TOOLS") || env("TYC_EXTRA_TOOLS") || "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveToolList(tools) {
  return uniqBy([...(tools || CORE_TOOLS), ...configuredExtraTools()], (item) => item);
}

async function mapLimit(items, limit, fn) {
  const result = [];
  let index = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (index < items.length) {
      const currentIndex = index++;
      result[currentIndex] = await fn(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return result;
}

export async function collectTianyanchaEvidence(company = {}, options = {}) {
  const name = company.standardName || company.companyName || company.name || company.query || "";
  if (!name || !hasTianyanchaKey()) {
    return { ok: false, missingKey: !hasTianyanchaKey(), evidence: [], diagnostics: [] };
  }
  const tools = resolveToolList(options.tools);
  const diagnostics = [];
  const results = await mapLimit(tools, options.concurrency || 3, async (tool) => {
    const args = { searchKey: name };
    if (/beneficial|key_personnel|dishonest|debtor|restriction|bidding|qualifications|license|recruitment|patent|copyright/.test(tool)) {
      args.pageNum = 1;
      args.pageSize = options.pageSize || 20;
    }
    const result = await callTianyanchaTool(tool, args, { timeoutMs: options.timeoutMs || TYC_TIMEOUT_MS });
    diagnostics.push({ tool, ok: result.ok, skipped: result.skipped, status: result.status || "", error: result.error || "" });
    return result;
  });
  const evidence = results
    .filter((result) => result?.ok && dataHasUsefulPayload(result.data))
    .filter((result) => {
      const returnedName = extractCompanyNameFromRegistration(result.data, "");
      return !returnedName || sameCompanyName(returnedName, name);
    })
    .map((result) => tianyanchaResultToSource(result, name, options.topics || {}));
  if (!evidence.length) {
    const openResult = await callTianyanchaOpenBaseInfo(name, options.timeoutMs || TYC_TIMEOUT_MS);
    diagnostics.push({
      tool: "get_company_registration_info_openapi",
      ok: openResult.ok,
      skipped: openResult.skipped,
      status: openResult.status || "",
      error: openResult.error || ""
    });
    if (openResult.ok && dataHasUsefulPayload(openResult.data)) {
      const returnedName = extractCompanyNameFromRegistration(openResult.data, "");
      if (!returnedName || sameCompanyName(returnedName, name)) {
        evidence.push(tianyanchaResultToSource({
          ok: true,
          tool: "get_company_registration_info_openapi",
          data: openResult.data
        }, returnedName || name, options.topics || {}));
      }
    }
  }
  return {
    ok: true,
    evidence: uniqBy(evidence, (item) => `${item.provider}|${item.title}`),
    diagnostics
  };
}

function extractCompanyNameFromRegistration(data, fallback) {
  const directName = data?._base?.name || data?.base?.name || data?.data?.base?.name || data?.name || data?.companyName || data?.entName;
  if (directName) return directName;
  const text = stringifyData(data, 5000);
  const values = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string" && /name|company|企业名称|公司名称|机构名称|企名/i.test(key) && /公司|集团|厂|院|局/.test(value)) values.push(value);
      if (value && typeof value === "object") visit(value);
    }
  };
  visit(data);
  const match = text.match(/[\u4e00-\u9fa5A-Za-z0-9][\u4e00-\u9fa5A-Za-z0-9（）()·\-]{2,60}?(?:股份有限公司|有限责任公司|集团有限公司|有限公司)/);
  if (match) values.unshift(match[0]);
  return values.find(Boolean) || fallback;
}

function buildResolveDiagnostic(status, extra = {}) {
  return {
    provider: "tianyancha",
    status,
    configured: hasTianyanchaKey(),
    message: {
      verified: "已通过天眼查工商登记核验",
      verified_openapi: "已通过天眼查工商登记核验",
      missing_key: "生产环境尚未配置天眼查核验",
      api_failed: "天眼查核验接口暂时不可用",
      empty: "天眼查未返回可用登记信息",
      mismatch: "天眼查返回主体与输入名称不一致"
    }[status] || "天眼查核验未完成",
    ...extra
  };
}

function buildTianyanchaCandidate(query, region, industry, result) {
  const standardName = extractCompanyNameFromRegistration(result.data, query);
  const source = tianyanchaResultToSource(result, standardName, {});
  return {
    name: standardName,
    standardName,
    region,
    industry,
    website: tianyanchaSearchUrl(standardName),
    confidence: standardName === query ? 98 : 92,
    reason: "企业主体已通过天眼查工商登记核验。",
    scoreBreakdown: {
      nameMatch: standardName.includes(query) || query.includes(standardName),
      trustedSources: 1,
      tianyanchaApi: true
    },
    sourceUrls: [source.url],
    tianyanchaSource: source,
    tianyanchaRegistration: result.data
  };
}

export async function resolveTianyanchaCandidateDetailed(query, region = "", industry = "") {
  if (!query) return { candidate: null, diagnostic: buildResolveDiagnostic("empty", { reason: "empty_query" }) };
  if (!hasTianyanchaKey()) return { candidate: null, diagnostic: buildResolveDiagnostic("missing_key") };
  const result = await callTianyanchaTool("get_company_registration_info", { searchKey: query }, { timeoutMs: 12000 });
  if (!result.ok) {
    const openResult = await callTianyanchaOpenBaseInfo(query, 12000);
    if (openResult.ok && dataHasUsefulPayload(openResult.data)) {
      const standardName = extractCompanyNameFromRegistration(openResult.data, query);
      if (sameCompanyName(standardName, query)) {
        return {
          candidate: buildTianyanchaCandidate(query, region, industry, {
            ok: true,
            tool: "get_company_registration_info_openapi",
            data: openResult.data
          }),
          diagnostic: buildResolveDiagnostic("verified_openapi", {
            returnedName: standardName || "",
            fallback: "openapi",
            mcpError: result.error || ""
          })
        };
      }
    }
    return {
      candidate: null,
      diagnostic: buildResolveDiagnostic("api_failed", {
        statusCode: result.status || "",
        error: result.error || "",
        openApiError: openResult.error || ""
      })
    };
  }
  if (!dataHasUsefulPayload(result.data)) {
    const openResult = await callTianyanchaOpenBaseInfo(query, 12000);
    if (openResult.ok && dataHasUsefulPayload(openResult.data)) {
      const standardName = extractCompanyNameFromRegistration(openResult.data, query);
      if (sameCompanyName(standardName, query)) {
        return {
          candidate: buildTianyanchaCandidate(query, region, industry, {
            ok: true,
            tool: "get_company_registration_info_openapi",
            data: openResult.data
          }),
          diagnostic: buildResolveDiagnostic("verified_openapi", { returnedName: standardName || "", fallback: "openapi" })
        };
      }
    }
    return { candidate: null, diagnostic: buildResolveDiagnostic("empty", { openApiError: openResult.error || "" }) };
  }
  const standardName = extractCompanyNameFromRegistration(result.data, query);
  if (!sameCompanyName(standardName, query)) {
    const openResult = await callTianyanchaOpenBaseInfo(query, 12000);
    if (openResult.ok && dataHasUsefulPayload(openResult.data)) {
      const openName = extractCompanyNameFromRegistration(openResult.data, query);
      if (sameCompanyName(openName, query)) {
        return {
          candidate: buildTianyanchaCandidate(query, region, industry, {
            ok: true,
            tool: "get_company_registration_info_openapi",
            data: openResult.data
          }),
          diagnostic: buildResolveDiagnostic("verified_openapi", {
            returnedName: openName || "",
            fallback: "openapi",
            mcpReturnedName: standardName || ""
          })
        };
      }
    }
    return {
      candidate: null,
      diagnostic: buildResolveDiagnostic("mismatch", { returnedName: standardName || "", openApiError: openResult.error || "" })
    };
  }
  return {
    candidate: buildTianyanchaCandidate(query, region, industry, result),
    diagnostic: buildResolveDiagnostic("verified", { returnedName: standardName || "" })
  };
}

export async function resolveTianyanchaCandidate(query, region = "", industry = "") {
  const detailed = await resolveTianyanchaCandidateDetailed(query, region, industry);
  return detailed.candidate;
}
