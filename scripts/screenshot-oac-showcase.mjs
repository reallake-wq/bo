import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(root, "..");
const showcasePath = path.resolve(workspaceRoot, "oac-effect-showcase.html");
const screenshotPath = path.resolve(workspaceRoot, "oac-effect-showcase.png");

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
  if (!fs.existsSync(showcasePath)) throw new Error(`Showcase page not found: ${showcasePath}`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "oac-showcase-"));
  const child = spawn(chromePath(), [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "--window-size=1280,1700",
    pathToFileURL(showcasePath).href
  ], { stdio: "ignore", windowsHide: true });

  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    await waitForFile(portFile);
    const [port] = fs.readFileSync(portFile, "utf8").trim().split(/\r?\n/);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const pageTarget = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
    if (!pageTarget) throw new Error("No page target.");
    const ws = await makeWs(pageTarget.webSocketDebuggerUrl);
    const call = (method, params = {}) => send(ws, method, params);
    await call("Page.enable");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const { result } = await call("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => ({ title: document.title, text: document.body.innerText.slice(0, 500), width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 2 }))()`
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
