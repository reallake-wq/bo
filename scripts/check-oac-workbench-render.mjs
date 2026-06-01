import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(root, "..");
const staticRoot = path.resolve(process.env.OAC_DIST_DIR || path.join(root, "dist"));
const screenshotPath = path.resolve(workspaceRoot, "oac-mobile-workbench-check.png");
const summaryPath = path.resolve(workspaceRoot, "oac-workbench-render-summary.json");

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  return "application/octet-stream";
}

function json(res, payload, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
}

function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/.netlify/functions/auth-me") {
      return json(res, {
        ok: true,
        me: {
          tenantId: "tenant-demo",
          tenantName: "OAC 演示租户",
          userId: "demo-user",
          license: {
            licenseId: "lic_demo",
            status: "active",
            quotaTotal: 100,
            quotaUsed: 3,
            remainingUses: 97,
            maxDevices: 15,
            activatedUsers: ["demo-user"]
          }
        }
      });
    }
    if (url.pathname === "/.netlify/functions/list-profiles") {
      return json(res, {
        ok: true,
        profiles: [
          {
            profileId: "profile-zykw",
            companyName: "智用开物",
            mainBusiness: "企业 AI 智能体、知识库和智能排产",
            coreProducts: ["商机参谋团 OAC", "知识库智能体", "智能排产方案"]
          }
        ]
      });
    }
    if (url.pathname === "/.netlify/functions/search-reports") return json(res, { ok: true, reports: [] });
    if (url.pathname === "/.netlify/functions/list-report-jobs") return json(res, { ok: true, jobs: [] });

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
  if (!found) throw new Error("Chrome/Edge executable not found for workbench render check.");
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

function writeSummary(payload) {
  fs.writeFileSync(summaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

const appServer = await startServer();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "oac-workbench-render-"));
const child = spawn(chromePath(), [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  `--user-data-dir=${profile}`,
  "--remote-debugging-port=0",
  "--window-size=390,1200",
  appServer.url
], { stdio: "ignore", windowsHide: true });

try {
  const portFile = path.join(profile, "DevToolsActivePort");
  await waitForFile(portFile);
  const [port] = fs.readFileSync(portFile, "utf8").trim().split(/\r?\n/);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const pageTarget = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (!pageTarget) throw new Error("No page target for workbench render check.");
  const pageWs = await makeWs(pageTarget.webSocketDebuggerUrl);
  const call = (method, params = {}) => send(pageWs, method, params);
  await call("Page.enable");
  await new Promise((resolve) => setTimeout(resolve, 700));
  await call("Runtime.evaluate", {
    expression: `(() => {
      localStorage.setItem("oacAccessToken", "mock-access");
      localStorage.setItem("oacRefreshToken", "mock-refresh");
      localStorage.setItem("nbBoV2Started", "1");
      localStorage.setItem("nbBoV2Tab", "home");
    })()`
  });
  await call("Page.reload", { ignoreCache: true });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const { result } = await call("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const de = document.documentElement;
      const body = document.body;
      const text = body ? body.innerText : "";
      const has = (value) => text.includes(value);
      return {
        title: document.title,
        innerWidth,
        scrollWidth: Math.max(de.scrollWidth, body ? body.scrollWidth : 0),
        clientWidth: de.clientWidth,
        bodyTextLength: text.length,
        hasHorizontalOverflow: Math.max(de.scrollWidth, body ? body.scrollWidth : 0) > innerWidth + 2,
        checks: {
          valueSection: has("谁会直接受益"),
          boss: has("老板") && has("看清商机质量"),
          sales: has("销售") && has("知道值不值得跟"),
          presales: has("售前") && has("拿到方案切入点"),
          delivery: has("交付") && has("提前看到落地风险"),
          buyerReason: has("为什么值得买") && has("少浪费售前") && has("提高命中率") && has("沉淀团队打法"),
          managementReason:
            has("管理层为什么会买单") &&
            has("线索分级") &&
            has("投入管控") &&
            has("打法复制") &&
            has("复盘闭环"),
          bottomTabs: has("首页") && has("创建") && has("任务") && has("报告") && has("我的企业")
        },
        text: text.slice(0, 900)
      };
    })()`
  });
  const metrics = result.value;
  const shot = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(screenshotPath, Buffer.from(shot.data, "base64"));
  pageWs.close();

  const missing = Object.entries(metrics.checks).filter(([, ok]) => !ok).map(([key]) => key);
  const ok = !metrics.hasHorizontalOverflow && missing.length === 0;
  const summary = { ok, screenshotPath, metrics, missing };
  writeSummary(summary);
  console.log(JSON.stringify(summary, null, 2));
  if (!ok) process.exitCode = 1;
} catch (error) {
  const summary = { ok: false, error: error?.message || String(error), screenshotPath };
  writeSummary(summary);
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = 1;
} finally {
  child.kill();
  appServer.server.close();
}
