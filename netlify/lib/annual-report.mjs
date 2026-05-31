import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { readJson, writeJson } from "./store.mjs";
import { clip, id, nowIso, slugify } from "./util.mjs";

const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_PAGES = 320;
const MIN_TOTAL_TEXT = 1200;
const MIN_AVG_TEXT_PER_PAGE = 35;

const MONEY_RE = /[-负亏－]?\d[\d,，]*(?:\.\d+)?\s*(?:亿元|万元|千元|百万元|元)?/;
const PERCENT_RE = /[-负亏－]?\d{1,3}(?:\.\d+)?\s*%/;

function cleanText(value = "") {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, "$1")
    .replace(/(\d)\s+(?=[\d,.，%])/g, "$1")
    .replace(/([,.，%])\s+(?=\d)/g, "$1")
    .replace(/([A-Za-z])\s+(?=[A-Za-z])/g, "$1")
    .replace(/\/\s*(\d)\s+(\d)\s+(\d)\b/g, "/$1$2$3")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanEvidenceText(value = "") {
  return cleanText(value)
    .replace(/^\d{4,6}\s*[\s\S]{0,80}?年度报告\s*\d+\s*\/\s*\d+\s*/g, "")
    .replace(/报告期内履行持续督导职责[\s\S]{0,320}?持续督导的期间/g, "")
    .replace(/签字的保荐代表人姓名[\s\S]{0,180}?持续督导的期间/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(value = "") {
  return cleanText(value)
    .replace(/[，]/g, ",")
    .replace(/[－]/g, "-")
    .replace(/\s+/g, "");
}

function excerptAround(text, index, radius = 180) {
  const safeIndex = Number.isFinite(index) && index >= 0 ? index : 0;
  const start = Math.max(0, safeIndex - radius);
  const end = Math.min(text.length, safeIndex + radius);
  return clip(cleanEvidenceText(text.slice(start, end)), 260);
}

function excerptForLabel(pageText = "", labels = []) {
  const source = cleanEvidenceText(pageText);
  const index = labels
    .map((label) => source.indexOf(label))
    .find((value) => Number.isFinite(value) && value >= 0);
  return excerptAround(source, index ?? 0, 240);
}

function normalizeNumberText(value = "") {
  return String(value || "")
    .replace(/，/g, ",")
    .replace(/－/g, "-")
    .replace(/\s+/g, "")
    .replace(/^负|^亏/, "-")
    .replace(/^--/, "-")
    .trim();
}

function formatMoney(raw = "") {
  const value = normalizeNumberText(raw);
  const unit = value.match(/(亿元|万元|千元|百万元|元)$/)?.[1] || "";
  const numberText = value.replace(/(亿元|万元|千元|百万元|元)$/g, "").replace(/,/g, "");
  const number = Number(numberText);
  if (!Number.isFinite(number)) return value;
  let yuan = number;
  if (unit === "亿元") yuan = number * 100000000;
  else if (unit === "万元") yuan = number * 10000;
  else if (unit === "千元") yuan = number * 1000;
  else if (unit === "百万元") yuan = number * 1000000;

  if (Math.abs(yuan) >= 100000000) return `${(yuan / 100000000).toFixed(2).replace(/\.00$/, "")}亿元`;
  if (Math.abs(yuan) >= 10000) return `${(yuan / 10000).toFixed(2).replace(/\.00$/, "")}万元`;
  return `${Number(yuan.toFixed(2))}元`;
}

function formatPercent(raw = "") {
  const value = normalizeNumberText(raw);
  const numberText = value.replace(/%$/g, "");
  const number = Number(numberText);
  if (!Number.isFinite(number)) return value.endsWith("%") ? value : `${value}%`;
  return `${number.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}%`;
}

function formatPeople(raw = "") {
  const value = normalizeNumberText(raw);
  const number = Number((value.match(/\d[\d,]*/)?.[0] || "").replace(/,/g, ""));
  if (!Number.isFinite(number) || number <= 0) return "";
  return `${Math.round(number)}人`;
}

function findIndexByLabels(compact = "", labels = []) {
  let best = -1;
  for (const label of labels) {
    const index = compact.indexOf(label);
    if (index >= 0 && (best < 0 || index < best)) best = index;
  }
  return best;
}

function numberAfter(compact = "", start = 0, type = "money", maxSpan = 220) {
  const slice = compact.slice(start, start + maxSpan);
  const pattern = type === "percent" ? PERCENT_RE : MONEY_RE;
  const match = slice.match(pattern);
  return match?.[0] || "";
}

function isBadMetricContext(context = "", label = "", rawValue = "") {
  const text = cleanEvidenceText(context);
  if (/报告期内履行持续督导职责|保荐机构|保荐代表|财务顾问|签字|办公地址|持续督导的期间/.test(text)) return true;
  if (/净利润/.test(label) && /现金红利|每10股|派发|分红|利润分配|净利润比例/.test(text)) return true;
  if (/员工|人数/.test(label)) {
    const num = Number(String(rawValue || "").replace(/[^\d]/g, ""));
    if (!Number.isFinite(num) || num <= 0) return true;
    if (/核心员工|股本结构|股份性质|无限售|有限售|普通股|期初|期末|持股/.test(text)) return true;
    if (!/在职员工的数量合计|员工总数|员工数量|专业构成|母公司在职员工|人员构成|员工情况/.test(text)) return true;
  }
  return false;
}

function metricFromPage(pageText, page, def) {
  const compact = compactText(pageText);
  const index = findIndexByLabels(compact, def.labels);
  if (index < 0) return null;
  const rawValue = numberAfter(compact, index + def.labels[0].length, def.type, def.maxSpan || 240);
  if (!rawValue) return null;
  const context = excerptForLabel(pageText, def.labels);
  if (isBadMetricContext(context, def.label, rawValue)) return null;

  let value = rawValue;
  if (def.type === "percent") value = formatPercent(rawValue);
  else if (def.type === "people") value = formatPeople(rawValue);
  else value = formatMoney(rawValue);
  if (!value) return null;
  return { label: def.label, value, page, context };
}

function extractMetrics(pageTexts) {
  const definitions = [
    {
      label: "营业收入",
      labels: ["营业收入", "营业总收入", "主营业务收入"],
      type: "money"
    },
    {
      label: "归母净利润",
      labels: ["归属于挂牌公司股东的净利润", "归属于上市公司股东的净利润", "归属于母公司所有者的净利润", "归母净利润"],
      type: "money"
    },
    {
      label: "扣非净利润",
      labels: ["归属于挂牌公司股东的扣除非经常性损益后的净利润", "归属于上市公司股东的扣除非经常性损益后的净利润", "扣除非经常性损益后的净利润", "扣非净利润"],
      type: "money",
      maxSpan: 260
    },
    {
      label: "毛利率",
      labels: ["综合毛利率", "毛利率"],
      type: "percent"
    },
    {
      label: "经营现金流",
      labels: ["经营活动产生的现金流量净额", "经营现金流量净额", "经营现金流"],
      type: "money"
    },
    {
      label: "资产负债率",
      labels: ["资产负债率"],
      type: "percent"
    },
    {
      label: "研发投入",
      labels: ["研发投入金额", "研发投入", "研发费用"],
      type: "money"
    },
    {
      label: "员工数量",
      labels: ["在职员工的数量合计", "员工总数", "员工数量", "报告期末员工"],
      type: "people"
    },
    {
      label: "前五大客户/客户集中度",
      labels: ["前五名客户", "前五大客户", "客户集中度"],
      type: "percent",
      maxSpan: 360
    }
  ];

  const metrics = [];
  const seen = new Set();
  for (const def of definitions) {
    for (let index = 0; index < pageTexts.length; index += 1) {
      const candidate = metricFromPage(pageTexts[index] || "", index + 1, def);
      if (!candidate) continue;
      if (seen.has(candidate.label)) break;
      metrics.push(candidate);
      seen.add(candidate.label);
      break;
    }
  }
  return metrics;
}

function findSection(pageTexts, title, keywords) {
  for (let index = 0; index < pageTexts.length; index += 1) {
    const text = pageTexts[index] || "";
    const compact = compactText(text);
    const keyword = keywords.find((item) => compact.includes(item));
    if (!keyword) continue;
    return {
      title,
      page: index + 1,
      excerpt: excerptForLabel(text, [keyword])
    };
  }
  return null;
}

function extractSections(pageTexts) {
  return [
    findSection(pageTexts, "主营业务与产品", ["主营业务", "主要业务", "主要产品", "产品结构"]),
    findSection(pageTexts, "经营情况讨论与分析", ["经营情况讨论与分析", "管理层讨论与分析", "经营情况分析"]),
    findSection(pageTexts, "研发投入", ["研发投入", "研发费用", "核心技术"]),
    findSection(pageTexts, "客户与供应商", ["前五名客户", "主要客户", "客户集中度", "主要供应商"]),
    findSection(pageTexts, "员工与组织", ["员工情况", "员工数量", "专业构成"]),
    findSection(pageTexts, "风险因素", ["风险因素", "可能面对的风险", "重大风险提示"])
  ].filter(Boolean);
}

async function parsePdf(buffer) {
  const pageTexts = [];
  let currentPage = 0;
  const options = {
    max: MAX_PAGES,
    pagerender: async (pageData) => {
      currentPage += 1;
      const content = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false
      });
      const text = cleanText(content.items.map((item) => item.str).join(" "));
      pageTexts[currentPage - 1] = text;
      return `\n[[PAGE:${currentPage}]]\n${text}`;
    }
  };
  const data = await pdfParse(buffer, options);
  return {
    pageCount: data.numpages || pageTexts.length,
    text: cleanText(data.text || pageTexts.join("\n")),
    pageTexts
  };
}

export async function parseAnnualReportBuffer(buffer, { fileName = "annual-report.pdf", companyName = "" } = {}) {
  const size = buffer?.byteLength || buffer?.length || 0;
  if (!size) throw new Error("年报文件为空");
  if (size > MAX_PDF_BYTES) throw new Error("年报 PDF 超过 5MB，建议先压缩或上传更小版本。");

  const parsed = await parsePdf(buffer);
  if (parsed.pageCount > MAX_PAGES) throw new Error(`年报页数超过 ${MAX_PAGES} 页，当前版本暂不解析。`);

  const textLength = parsed.text.length;
  const avgText = parsed.pageCount ? textLength / parsed.pageCount : 0;
  if (textLength < MIN_TOTAL_TEXT || avgText < MIN_AVG_TEXT_PER_PAGE) {
    throw new Error("这份 PDF 可能是扫描版或不可复制文字版，当前只支持非 OCR 的文字型 PDF。");
  }

  const annualReportId = id("annual", `${companyName}:${fileName}`);
  const metrics = extractMetrics(parsed.pageTexts);
  const sections = extractSections(parsed.pageTexts);
  const now = nowIso();
  const evidence = {
    annualReportId,
    companyName,
    fileName,
    fileSlug: slugify(fileName),
    uploadedAt: now,
    parsedAt: now,
    pageCount: parsed.pageCount,
    textLength,
    avgTextPerPage: Math.round(avgText),
    sourceType: "用户上传年报",
    metrics,
    sections,
    warnings: [
      metrics.length < 4 ? "年报已解析，但自动提取出的财务指标偏少，建议在报告中人工核对关键表格。" : ""
    ].filter(Boolean)
  };
  await writeJson("annual-reports", `${annualReportId}.json`, evidence);
  return evidence;
}

export async function readAnnualReportEvidence(annualReportId) {
  const key = String(annualReportId || "").trim();
  if (!key) return null;
  return readJson("annual-reports", `${key}.json`, null);
}
