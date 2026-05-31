import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(root, "..");

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  return "application/octet-stream";
}

function startStaticServer(staticRoot) {
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    const candidate = path.normalize(path.join(staticRoot, pathname));
    const safe = candidate.startsWith(path.normalize(staticRoot));
    const file = safe && fs.existsSync(candidate) ? candidate : path.join(staticRoot, "index.html");
    try {
      const data = fs.readFileSync(file);
      res.writeHead(200, { "content-type": contentType(file), "cache-control": "no-store" });
      res.end(data);
    } catch {
      res.writeHead(404).end("Not found");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);
  const found = candidates.find((item) => fs.existsSync(item));
  if (!found) throw new Error("Chrome/Edge executable not found for mobile render check.");
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

async function waitForDevTools(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError || new Error(`Timed out waiting for Chrome DevTools on port ${port}`);
}

function probePort(port) {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function findDebugPort() {
  for (let port = 9222; port < 9322; port += 1) {
    if (await probePort(port)) return port;
  }
  throw new Error("No available Chrome debugging port in safe range.");
}

async function renderCase({ name, url, screenshot }) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `oac-mobile-${name}-`));
  const debugPort = await findDebugPort();
  const child = spawn(chromePath(), [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${debugPort}`,
    "--window-size=390,1100",
    url
  ], { stdio: "ignore", windowsHide: true });

  try {
    const targets = await (await waitForDevTools(debugPort)).json();
    const pageTarget = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
    if (!pageTarget) throw new Error(`No page target for ${name}.`);
    const pageWs = await makeWs(pageTarget.webSocketDebuggerUrl);
    const call = (method, params = {}) => send(pageWs, method, params);

    await call("Page.enable");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const { result } = await call("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const de = document.documentElement;
        const body = document.body;
        const text = body ? body.innerText.slice(0, 600) : "";
        return {
          title: document.title,
          innerWidth,
          scrollWidth: Math.max(de.scrollWidth, body ? body.scrollWidth : 0),
          clientWidth: de.clientWidth,
          bodyTextLength: body ? body.innerText.length : 0,
          hasHorizontalOverflow: Math.max(de.scrollWidth, body ? body.scrollWidth : 0) > innerWidth + 2,
          text
        };
      })()`
    });
    const metrics = result.value;
    const shot = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.writeFileSync(screenshot, Buffer.from(shot.data, "base64"));
    pageWs.close();
    return { name, screenshot, ...metrics };
  } finally {
    child.kill();
  }
}

const reportPath = path.resolve(workspaceRoot, "oac-preview-latest.html");
const appPath = path.resolve(workspaceRoot, "oac-local-dist", "index.html");
const appServer = await startStaticServer(path.dirname(appPath));
const cases = [
  {
    name: "report",
    url: pathToFileURL(reportPath).href,
    screenshot: path.resolve(workspaceRoot, "oac-mobile-report-check.png")
  },
  {
    name: "app",
    url: appServer.url,
    screenshot: path.resolve(workspaceRoot, "oac-mobile-app-check.png")
  }
];

const results = [];
for (const item of cases) {
  if (item.url.startsWith("file:") && !fs.existsSync(new URL(item.url))) {
    results.push({ name: item.name, ok: false, error: "file missing", url: item.url });
    continue;
  }
  results.push(await renderCase(item));
}
appServer.server.close();

const failures = results.filter((item) => item.error || item.hasHorizontalOverflow || item.bodyTextLength < 100);
console.log(JSON.stringify({ ok: failures.length === 0, results, failures }, null, 2));
if (failures.length) process.exitCode = 1;
