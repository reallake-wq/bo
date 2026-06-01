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

function tycProxySecret() {
  return env("TYC_PROXY_SECRET") || env("TYC_MCP_PROXY_SECRET") || "";
}

function tycProxyHeaders() {
  const secret = tycProxySecret();
  return secret ? { "x-tyc-proxy-secret": secret } : {};
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
        ...tycProxyHeaders(),
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
  if (data?._empty === true && !hasNonEmptyArrayPayload(data) && !hasMeaningfulScalarPayload(data)) return false;
  if (/"_empty"\s*:\s*true/.test(text) && !hasNonEmptyArrayPayload(data) && !hasMeaningfulScalarPayload(data)) return false;
  if (/经查无结果|暂无数据|无相关信息/.test(text) && text.length < 400) return false;
  return true;
}

function hasNonEmptyArrayPayload(value, depth = 0) {
  if (depth > 5 || value == null) return false;
  if (Array.isArray(value)) {
    return value.some((item) => {
      if (item == null) return false;
      if (typeof item === "object") return Object.keys(item).length > 0 || hasNonEmptyArrayPayload(item, depth + 1);
      return String(item).trim().length > 0;
    });
  }
  if (typeof value !== "object") return false;
  return Object.values(value).some((item) => hasNonEmptyArrayPayload(item, depth + 1));
}

function hasMeaningfulScalarPayload(value, depth = 0) {
  if (depth > 5 || value == null || typeof value !== "object") return false;
  for (const [key, item] of Object.entries(value)) {
    if (/^_?(empty|summary|items|list|total)$/i.test(key)) continue;
    if (Array.isArray(item)) continue;
    if (item && typeof item === "object") {
      if (hasMeaningfulScalarPayload(item, depth + 1)) return true;
      continue;
    }
    const text = compactValue(item);
    if (text && text !== "0") return true;
  }
  return false;
}

function titleOf(tool) {
  return {
      get_company_registration_info: "工商登记",
      get_company_registration_info_openapi: "工商登记",
    get_actual_controller: "实际控制人",
    get_beneficial_owners: "受益所有人",
    get_key_personnel: "主要人员",
    get_shareholder_info: "股东信息",
    get_stock_shareholders: "上市公司股东",
    get_listing_info: "上市信息",
    get_company_scale: "企业规模",
    get_equity_tree: "股权图谱",
    get_group_info: "集团信息",
    get_financial_data: "财务数据",
    get_financial_summary: "财务简析",
    get_financial_main_indicators: "主要财务指标",
    get_income_statement: "利润表",
    get_balance_sheet: "资产负债表",
    get_cash_flow_statement: "现金流量表",
    get_annual_reports: "企业年报",
    get_risk_overview: "综合风险",
    get_risk_detail: "风险详情",
    get_dishonest_info: "失信被执行",
    get_judgment_debtor_info: "被执行人",
    get_high_consumption_restriction: "限制高消费",
    get_bidding_info: "招投标",
    search_bids: "招投标搜索",
    get_suppliers_and_customers: "供应商/客户",
    get_qualifications: "资质证书",
    get_administrative_license: "行政许可",
    get_recruitment_info: "招聘线索",
    get_patent_info: "专利信息",
    get_software_copyright_info: "软件著作权"
  }[tool] || tool;
}

function topicOf(tool, topics = {}) {
  if (/financial|annual|income_statement|balance_sheet|cash_flow|listing|stock/.test(tool)) return topics.finance;
  if (/risk|dishonest|debtor|restriction/.test(tool)) return topics.pain;
  if (/bidding|bid|supplier|customer|license|qualifications|patent|copyright|recruitment/.test(tool)) return topics.market;
  return topics.subject;
}

function sourceTypeOf(tool = "") {
  if (/financial|annual|income_statement|balance_sheet|cash_flow|listing|stock/.test(tool)) return "财务硬来源";
  if (/risk|dishonest|debtor|restriction/.test(tool)) return "风险合规来源";
  if (/bidding|bid|supplier|customer|license|qualifications|patent|copyright|recruitment/.test(tool)) return "企业公开来源";
  return "主体核对来源";
}

function tianyanchaSearchUrl(companyName, tool = "") {
  const suffix = tool ? `&oac_source=${encodeURIComponent(tool)}` : "";
  return `https://www.tianyancha.com/search?key=${encodeURIComponent(companyName || "")}${suffix}`;
}

export function tianyanchaResultToSource(result, companyName, topics = {}) {
  const title = titleOf(result.tool);
  const dataText = stringifyData(result.data, 9000);
  const summary = summarizeStructuredData(result.tool, result.data);
  return {
    title: `天眼查 API｜${title}｜${companyName}`,
    url: tianyanchaSearchUrl(companyName, result.tool),
    snippet: clip(summary || result.data?._summary || dataText, 900),
    evidenceExcerpt: clip(summary || result.data?._summary || dataText, 900),
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

function firstArray(...values) {
  return values.find((value) => Array.isArray(value) && value.length) || [];
}

function compactValue(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text || text === "null" || text === "undefined") return "";
  return text;
}

function moneyValue(value) {
  const text = compactValue(value);
  if (!text) return "";
  const num = Number(text);
  if (!Number.isFinite(num)) return text;
  const pretty = (n) => n.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  if (Math.abs(num) >= 100000000) return `${pretty(num / 100000000)}亿元`;
  if (Math.abs(num) >= 10000) return `${pretty(num / 10000)}万元`;
  return String(num);
}

function formatDateValue(value) {
  const raw = compactValue(value);
  if (!raw) return "";
  const num = Number(raw);
  if (Number.isFinite(num) && num > 100000000000) return new Date(num).toISOString().slice(0, 10);
  return raw.slice(0, 10);
}

function summarizeBidRows(rows = []) {
  return arr(rows)
    .slice(0, 5)
    .map((item) => {
      const title = compactValue(item.title || item.projectName || item.name);
      const purchaser = compactValue(item.purchaser || item.buyer || item.tenderer || item.bidInviter || item.enterpriseName);
      const winner = compactValue(item.bidWinner || item.winner || item.supplier || item.winBidder);
      const amount = moneyValue(item.bidAmount || item.amount || item.projectAmount || item.budget || item.price);
      const date = formatDateValue(item.publishTime || item.publishDate || item.date);
      const type = compactValue(item.type || item.stage || item.bidType);
      return [
        title,
        purchaser ? `采购人/招标人：${purchaser}` : "",
        winner ? `中标/成交方：${winner}` : "",
        amount ? `金额：${amount}` : "",
        date ? `日期：${date}` : "",
        type
      ]
        .filter(Boolean)
        .join("，");
    })
    .filter(Boolean);
}

function summarizeSupplierCustomerData(data = {}) {
  const suppliers = firstArray(data?._supply?.items, data?._supply?.pageBean?.result, data?.suppliers, data?.supplyList, data?.items?.suppliers);
  const customers = firstArray(data?._customer?.items, data?._customer?.pageBean?.result, data?.customers, data?.customerList, data?.items?.customers);
  const supplierLines = suppliers.slice(0, 5).map((item) => {
    const name = compactValue(item.supplier_name || item.supplierName || item.name || item.companyName);
    const ratio = compactValue(item.ratio || item.purchaseRatio || item.procurementRatio);
    const amount = moneyValue(item.amt || item.amount || item.purchaseAmount || item.procurementAmount);
    const period = compactValue(item.reportDate || item.reportPeriod || item.year || item.dataYear);
    return [name ? `供应商：${name}` : "", ratio ? `采购占比：${ratio}` : "", amount ? `采购金额：${amount}` : "", period ? `报告期：${period}` : ""].filter(Boolean).join("，");
  }).filter(Boolean);
  const customerLines = customers.slice(0, 5).map((item) => {
    const name = compactValue(item.customer_name || item.customerName || item.name || item.companyName);
    const ratio = compactValue(item.ratio || item.salesRatio || item.saleRatio);
    const amount = moneyValue(item.amt || item.amount || item.salesAmount || item.saleAmount);
    const period = compactValue(item.reportDate || item.reportPeriod || item.year || item.dataYear);
    return [name ? `客户：${name}` : "", ratio ? `销售占比：${ratio}` : "", amount ? `销售金额：${amount}` : "", period ? `报告期：${period}` : ""].filter(Boolean).join("，");
  }).filter(Boolean);
  return [...supplierLines, ...customerLines];
}

function summarizeFinanceData(tool = "", data = {}) {
  const rows = firstArray(data?.corpProfit, data?.corpBalanceSheet, data?.corpCashFlow, data?._annual?.items, data?._quarter?.items, data?.items, data?.list, data?.data);
  const row = rows[0] || data;
  const year = compactValue(row.showYear || row.reportDate || row.year || row.endDate);
  const pairs = [
    ["营业收入", row.total_revenue || row.revenue || row.operating_total_revenue_lrr_sq || row.totalOperateIncome],
    ["净利润", row.net_profit || row.netProfit],
    ["归母净利润", row.net_profit_atsopc || row.parentNetProfit || row.netProfitAtsopc],
    ["营业利润", row.op || row.operating_profit || row.operatingProfit],
    ["利润总额", row.profit_total_amt || row.totalProfit],
    ["毛利率", row.gross_selling_rate || row.grossMargin],
    ["资产负债率", row.asset_liab_ratio || row.assetLiabRatio],
    ["总资产", row.total_assets || row.total_asset || row.totalAssets],
    ["总负债", row.total_liab || row.total_liabilities || row.totalLiab],
    ["经营现金流", row.ncf_from_oa || row.net_operate_cash_flow || row.net_cash_flow_from_operating_activities || row.net_cash_flow_from_oa || row.cash_flow_from_operating || row.netCashFlowFromOperating],
    ["研发投入", row.rad_cost || row.research_expense || row.rdExpense]
  ]
    .map(([label, value]) => {
      const text = /率$/.test(label) ? compactValue(value) : moneyValue(value);
      return text ? `${label}：${text}${/率$/.test(label) && !/%$/.test(text) ? "%" : ""}` : "";
    })
    .filter(Boolean);
  if (!pairs.length) return "";
  return `${titleOf(tool)}${year ? `（${year}）` : ""}：${pairs.join("；")}。`;
}

function summarizeRiskData(tool = "", data = {}) {
  if (tool === "get_risk_detail") {
    const text = compactValue(data?.title || data?.typeName || data?.riskType || data?.event || data?.desc || data?.content || data?._summary);
    return text ? `风险详情：${clip(text, 520)}` : "";
  }
  const rows = arr(data?.riskList)
    .flatMap((group) => arr(group?.list).flatMap((item) => (arr(item?.list).length ? item.list : [item])))
    .slice(0, 5)
    .map((item) => {
      const title = compactValue(item.title || item.desc || item.name);
      const tag = compactValue(item.tag || item.riskLevel || item.typeName);
      return [tag, title].filter(Boolean).join("：");
    })
    .filter(Boolean);
  const level = compactValue(data?.riskLevel);
  if (!rows.length && !level) return "";
  return [`风险等级：${level}`, ...rows].filter(Boolean).join("；");
}

function summarizePeopleData(data = {}) {
  const rows = firstArray(data?.items, data?.list, data?.data);
  return rows
    .slice(0, 8)
    .map((item) => {
      const name = compactValue(item.name || item.humanName || item.staffName);
      const role = compactValue(item.position || item.staffTypeName || item.typeJoin || item.role || item.title);
      return name && role ? `${name}（${role}）` : [name, role].filter(Boolean).join("");
    })
    .filter(Boolean);
}

function summarizeRegistryData(tool = "", data = {}) {
  const base = data?._base || data?.base || data?.data?.base || data;
  if (/listing/.test(tool)) {
    return [
      compactValue(data?.sec_type || data?._sec?.sec_type) ? `上市板块：${compactValue(data?.sec_type || data?._sec?.sec_type)}` : "",
      compactValue(data?.stockCode || data?.ASTOCK_CODE || data?._sec?.ASTOCK_CODE) ? `股票代码：${compactValue(data?.stockCode || data?.ASTOCK_CODE || data?._sec?.ASTOCK_CODE)}` : "",
      compactValue(data?.accounting_firm_name || data?._sec?.accounting_firm_name) ? `审计机构：${compactValue(data?.accounting_firm_name || data?._sec?.accounting_firm_name)}` : ""
    ].filter(Boolean).join("；");
  }
  if (/shareholder|beneficial|actual_controller/.test(tool)) {
    const rows = firstArray(data?.items, data?._holder?.items, data?._list?.items, data?.list, data?.data);
    return rows.slice(0, 5).map((item) => {
      const name = compactValue(item.name || item.shareholderName || item.holderName || item.investorName || item.humanName || item.companyName);
      const ratio = compactValue(item.ratio || item.percent || item.holdingRatio || item.finalBenefitShare);
      const amount = moneyValue(item.amount || item.subscribedCapital || item.capital);
      return [name ? `股东/控制线索：${name}` : "", ratio ? `持股/受益比例：${ratio}` : "", amount ? `认缴/金额：${amount}` : ""].filter(Boolean).join("，");
    }).filter(Boolean).join("；");
  }
  return [
    compactValue(base.name || data.name || data.companyName) ? `企业名称：${compactValue(base.name || data.name || data.companyName)}` : "",
    compactValue(base.legalPersonName || data.legalPersonName) ? `法定代表人：${compactValue(base.legalPersonName || data.legalPersonName)}` : "",
    compactValue(base.regStatus || data.regStatus) ? `登记状态：${compactValue(base.regStatus || data.regStatus)}` : "",
    compactValue(base.companyOrgType || data.companyOrgType) ? `组织类型：${compactValue(base.companyOrgType || data.companyOrgType)}` : "",
    compactValue(base.bondName || data.bondName) || compactValue(base.bondNum || data.bondNum) ? `证券信息：${[compactValue(base.bondName || data.bondName), compactValue(base.bondNum || data.bondNum), compactValue(base.bondType || data.bondType)].filter(Boolean).join("/")}` : "",
    compactValue(base.regCapital || data.regCapital) ? `注册资本：${compactValue(base.regCapital || data.regCapital)}` : "",
    compactValue(base.regLocation || data.regLocation) ? `注册地址：${compactValue(base.regLocation || data.regLocation)}` : ""
  ].filter(Boolean).join("；");
}

function summarizeStructuredData(tool = "", data = {}) {
  if (/bidding|search_bids/.test(tool)) {
    const rows = summarizeBidRows(firstArray(data?.items, data?.list, data?.data));
    const count = data?._summary || data?.total ? `招投标记录：${data?._summary || `${data.total}条`}` : "";
    return [count, ...rows].filter(Boolean).join("；");
  }
  if (/suppliers_and_customers/.test(tool)) return summarizeSupplierCustomerData(data).join("；");
  if (/registration|actual_controller|beneficial|shareholder|listing|company_scale|equity_tree|group_info/.test(tool)) return summarizeRegistryData(tool, data);
  if (/financial|income_statement|balance_sheet|cash_flow|listing|stock/.test(tool)) return summarizeFinanceData(tool, data);
  if (/risk/.test(tool)) return summarizeRiskData(tool, data);
  if (/key_personnel/.test(tool)) {
    const rows = summarizePeopleData(data);
    return rows.length ? `主要人员：${rows.join("、")}` : "";
  }
  return compactValue(data?._summary);
}

const CORE_TOOLS = [
  "get_company_registration_info",
  "get_actual_controller",
  "get_beneficial_owners",
  "get_key_personnel",
  "get_equity_tree",
  "get_group_info",
  "get_financial_data",
  "get_financial_summary",
  "get_financial_main_indicators",
  "get_income_statement",
  "get_balance_sheet",
  "get_cash_flow_statement",
  "get_annual_reports",
  "get_risk_overview",
  "get_dishonest_info",
  "get_judgment_debtor_info",
  "get_high_consumption_restriction",
  "get_bidding_info",
  "search_bids",
  "get_suppliers_and_customers",
  "get_shareholder_info",
  "get_stock_shareholders",
  "get_listing_info",
  "get_company_scale",
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

function extractRiskIds(data = {}, max = 2) {
  const ids = [];
  const visit = (node) => {
    if (!node || typeof node !== "object" || ids.length >= max) return;
    if (node.id && /风险|risk|被执行|诉讼|清算|处罚|失信|限高/.test(`${node.title || ""} ${node.desc || ""} ${node.name || ""} ${node.tag || ""}`)) {
      ids.push(String(node.id));
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
      if (ids.length >= max) break;
    }
  };
  visit(data);
  return Array.from(new Set(ids)).slice(0, max);
}

function requiresReturnedNameMatch(tool = "") {
  return /registration|actual_controller|beneficial|key_personnel|equity_tree|group_info|shareholder|stock_shareholders|listing|company_scale/.test(tool);
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
    if (tool === "search_bids") args.purchaser = name;
    if (/beneficial|key_personnel|shareholder|stock|dishonest|debtor|restriction|bidding|bid|supplier|customer|qualifications|license|recruitment|patent|copyright/.test(tool)) {
      args.pageNum = 1;
      args.pageSize = options.pageSize || 20;
    }
    const result = await callTianyanchaTool(tool, args, { timeoutMs: options.timeoutMs || TYC_TIMEOUT_MS });
    diagnostics.push({ tool, ok: result.ok, skipped: result.skipped, status: result.status || "", error: result.error || "" });
    return result;
  });
  const riskOverview = results.find((result) => result?.ok && result.tool === "get_risk_overview");
  const riskIds = extractRiskIds(riskOverview?.data, options.riskDetailLimit ?? 2);
  if (riskIds.length) {
    const detailResults = await mapLimit(riskIds, 2, async (id) => {
      const result = await callTianyanchaTool("get_risk_detail", { id, pageNum: 1, pageSize: options.pageSize || 20 }, { timeoutMs: options.timeoutMs || TYC_TIMEOUT_MS });
      diagnostics.push({ tool: "get_risk_detail", ok: result.ok, skipped: result.skipped, status: result.status || "", error: result.error || "" });
      return result;
    });
    results.push(...detailResults);
  }
  const evidence = results
    .filter((result) => result?.ok && dataHasUsefulPayload(result.data))
    .filter((result) => {
      if (!requiresReturnedNameMatch(result.tool)) return true;
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
