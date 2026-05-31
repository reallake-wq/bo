import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(root, "..");
const outPath = path.resolve(workspaceRoot, "oac-secret-safety-summary.json");

const roots = [
  root,
  path.resolve(root, "src"),
  path.resolve(root, "netlify"),
  path.resolve(root, "scripts"),
  path.resolve(root, "docs")
];

const skippedDirs = new Set([
  ".git",
  ".netlify",
  ".npm-cache",
  ".netlify-cli-appdata",
  ".netlify-cli-local",
  "node_modules",
  "dist",
  "local-data"
]);

const skippedExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".ico",
  ".pdf",
  ".docx",
  ".xlsx",
  ".zip"
]);

const allowedLicenseExamples = new Set([
  "OAC-ABCD-2345",
  "OAC-XXXX-XXXX"
]);

const rules = [
  { name: "openai-or-deepseek-style-key", pattern: /\bsk-[A-Za-z0-9_-]{12,}\b/g },
  { name: "tavily-key", pattern: /\btvly-[A-Za-z0-9_-]{8,}\b/g },
  { name: "hardcoded-admin-secret", pattern: /\bffloxy999\b/g },
  { name: "friendly-license-key", pattern: /\bOAC-[A-Z2-9]{4}-[A-Z2-9]{4}\b/g },
  { name: "tianyancha-known-prefix", pattern: /\bb12ebce4-[0-9a-f-]{27,}\b/gi }
];

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
      if (skippedDirs.has(entry.name)) continue;
      walk(full, out);
      continue;
    }
    if (skippedExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    out.push(full);
  }
  return out;
}

function shouldSkipFile(file) {
  const normalized = path.normalize(file);
  if (normalized.includes(`${path.sep}.env`) && !normalized.endsWith(".env.example")) return true;
  if (normalized.includes(`${path.sep}oac-offline-e2e-store${path.sep}`)) return true;
  if (normalized.includes(`${path.sep}oac-local-dist${path.sep}`)) return true;
  if (normalized.includes(`${path.sep}oac-preview-latest.html`)) return false;
  return false;
}

const files = Array.from(new Set(roots.flatMap((dir) => walk(dir)))).filter((file) => !shouldSkipFile(file));
const failures = [];

for (const file of files) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    const matches = [...text.matchAll(rule.pattern)];
    for (const match of matches) {
      const value = match[0];
      if (rule.name === "friendly-license-key" && allowedLicenseExamples.has(value)) continue;
      const before = text.slice(0, match.index);
      const line = before.split(/\r?\n/).length;
      failures.push({
        file,
        line,
        rule: rule.name,
        value: value.slice(0, 16) + (value.length > 16 ? "..." : "")
      });
    }
  }
}

const output = {
  ok: failures.length === 0,
  checkedFiles: files.length,
  failures
};
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");
console.log(JSON.stringify(output, null, 2));
if (failures.length) process.exitCode = 1;
