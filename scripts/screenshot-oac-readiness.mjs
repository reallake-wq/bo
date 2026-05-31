import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(root, "..");
const pagePath = path.resolve(workspaceRoot, "oac-release-readiness.html");
const screenshotPath = path.resolve(workspaceRoot, "oac-release-readiness.png");

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);
  const found = candidates.find((item) => fs.existsSync(item));
  if (!found) throw new Error("Chrome/Edge executable not found.");
  return found;
}

function makeWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", reject);
  });
}

function send(ws, method, params = {}) {
  const id = ++send.id;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id !== id) return;
      ws.removeEventListener("message", onMessage);
      if (payload.error) reject(new Error(payload.error.message || JSON.stringify(payload.error)));
      else resolve(payload.result || {});
    };
    ws.addEventListener("message", onMessage);
  });
}
send.id = 0;

async function waitForFile(file, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${file}`);
}

async function main() {
  if (!fs.existsSync(pagePath)) throw new Error(`Readiness page not found: ${pagePath}`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "oac-readiness-"));
  const child = spawn(chromePath(), [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "--window-size=1280,1500",
    pathToFileURL(pagePath).href
  ], { stdio: "ignore", windowsHide: true });
  try {
    await waitForFile(path.join(profile, "DevToolsActivePort"));
    const [port] = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").trim().split(/\r?\n/);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    if (!target) throw new Error("No page target.");
    const ws = await makeWs(target.webSocketDebuggerUrl);
    const call = (method, params = {}) => send(ws, method, params);
    await call("Page.enable");
    await new Promise((resolve) => setTimeout(resolve, 900));
    const { result } = await call("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => ({ title: document.title, text: document.body.innerText.slice(0, 500), overflow: document.documentElement.scrollWidth > innerWidth + 2 }))()`
    });
    const shot = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(screenshotPath, Buffer.from(shot.data, "base64"));
    ws.close();
    console.log(JSON.stringify({ ok: true, screenshotPath, metrics: result.value }, null, 2));
  } finally {
    child.kill();
  }
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
