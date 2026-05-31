import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = path.resolve(root, "..");

const sourceRoots = ["src", "netlify", "scripts"].map((item) => path.join(root, item));
const extraFiles = [
  path.join(workspace, "oac-preview-latest.html"),
  path.join(workspace, "oac-offline-e2e-preview.html"),
  path.join(workspace, "oac-offline-e2e-quality-preview.html")
];

const badPatterns = [
  { name: "replacement-char", pattern: /\uFFFD/ },
  { name: "question-placeholder", pattern: /\?{4,}/ },
  { name: "latin-mojibake", pattern: /(?:Ã|Â|â€|â€”|â€“)/ },
  {
    name: "cjk-mojibake",
    pattern:
      /\u6d63\u6c33|\u93b6\u63a8|\u93c8\u0010|\u7f02\u54c4|\u93b6\u0017|\u6d7c\u0012|\u942e\u0010|\u93b6\u6701|\u6d63\u6214|\u9fac\u5fda|\u93c8\ue045|\u93b6\ue1ce|\u7f02\u54c4\u7691|\u93b6\u0017\u7c21|鏆備笉|璇勭|鎺堟|浼氳|鐧诲|涓嶅|澶辫|缂哄|娴忚|绠＄/
  },
  {
    name: "visible-cjk-mojibake",
    pattern:
      /涓讳|缂撳|妫€|鎶ュ|浠诲|鍗冲|绉抈|灏忔|鍒嗛|瀹屾|妯″|璇诲|璐ㄦ|棰樻|閲囬|惎鍔|繁搴|粡|鐢熸|澶辫|姝|掑|嫨/
  },
  { name: "skipped-planning", pattern: /model-planning-skipped/i },
  { name: "raw-json-error", pattern: /Unexpected token '<'|not valid JSON/i },
  { name: "internal-sync-error", pattern: /Cannot read properties of null/i },
  { name: "public-login-admin-instruction", pattern: /普通用户只需要|管理员请打开/i },
  { name: "old-capability-profile-wording", pattern: /能力画像|我的企业画像ID/i }
];

const allowedFiles = new Set([
  path.normalize(path.join(root, "scripts", "check-oac-text-safety.mjs"))
]);

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "local-data", "dist"].includes(entry.name)) continue;
      walk(full, out);
    } else if (/\.(mjs|js|ts|tsx|css|html|json|md)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function snippets(text, pattern) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (pattern.test(line)) {
      rows.push({ line: index + 1, text: line.trim().slice(0, 180) });
      if (rows.length >= 5) break;
    }
  }
  return rows;
}

function main() {
  const files = [
    ...sourceRoots.flatMap((dir) => walk(dir)),
    ...extraFiles.filter((file) => fs.existsSync(file))
  ];
  const failures = [];
  for (const file of files) {
    const normalized = path.normalize(file);
    if (allowedFiles.has(normalized)) continue;
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const item of badPatterns) {
      const rows = snippets(text, new RegExp(item.pattern.source, item.pattern.flags));
      if (rows.length) failures.push({ file, rule: item.name, rows });
    }
  }
  const output = { ok: failures.length === 0, checkedFiles: files.length, failures };
  console.log(JSON.stringify(output, null, 2));
  if (failures.length) process.exitCode = 1;
}

main();
