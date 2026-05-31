import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8888);
const staticRoot = process.env.OAC_DIST_DIR
  ? normalize(isAbsolute(process.env.OAC_DIST_DIR) ? process.env.OAC_DIST_DIR : resolve(root, process.env.OAC_DIST_DIR))
  : join(root, "dist");
const startedAt = new Date().toISOString();

async function loadEnv() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;
  const raw = await readFile(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function contentType(file) {
  const ext = extname(file).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function sendResponse(res, response) {
  res.statusCode = response.status;
  for (const [key, value] of response.headers.entries()) {
    res.setHeader(key, value);
  }
  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}

async function handleFunction(req, res, url) {
  const name = decodeURIComponent(url.pathname.replace("/.netlify/functions/", ""));
  if (!/^[\w-]+$/.test(name)) {
    res.writeHead(404).end("Not found");
    return;
  }
  const file = join(root, "netlify", "functions", `${name}.mjs`);
  if (!existsSync(file)) {
    res.writeHead(404).end("Function not found");
    return;
  }

  try {
    const body = await readBody(req);
    const init = {
      method: req.method,
      headers: req.headers
    };
    if (body.length && req.method !== "GET" && req.method !== "HEAD") {
      init.body = body;
      init.duplex = "half";
    }
    if (name.endsWith("-background")) {
      setTimeout(() => {
        const backgroundInit = { ...init };
        if (body.length && req.method !== "GET" && req.method !== "HEAD") {
          backgroundInit.body = Buffer.from(body);
          backgroundInit.duplex = "half";
        }
        const request = new Request(`http://localhost:${port}${req.url}`, backgroundInit);
        import(`${pathToFileURL(file).href}?t=${Date.now()}`)
          .then((mod) => mod.default(request))
          .catch((error) => {
            console.error(`Background function ${name} failed:`, error);
          });
      }, 0);
      res.writeHead(202, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, accepted: true }));
      return;
    }
    const request = new Request(`http://localhost:${port}${req.url}`, init);
    const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
    const response = await mod.default(request);
    await sendResponse(res, response);
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: error?.message || String(error) }));
  }
}

async function handleStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const candidate = normalize(join(staticRoot, pathname));
  const safe = candidate.startsWith(normalize(staticRoot));
  const file = safe && existsSync(candidate) ? candidate : join(staticRoot, "index.html");
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": contentType(file), "cache-control": "no-store" });
    res.end(data);
  } catch {
    res.writeHead(404).end("Not found");
  }
}

await loadEnv();
await mkdir(join(root, "local-data"), { recursive: true });

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${port}`);
  if (url.pathname === "/__health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify({
      ok: true,
      app: "oac-local",
      port,
      root,
      staticRoot,
      staticIndexExists: existsSync(join(staticRoot, "index.html")),
      startedAt
    }));
    return;
  }
  if (url.pathname.startsWith("/.netlify/functions/")) {
    await handleFunction(req, res, url);
    return;
  }
  await handleStatic(req, res, url);
});

server.listen(port, "127.0.0.1", async () => {
  try {
    await writeFile(join(root, "local-server-ready.txt"), `http://localhost:${port}\n`, "utf8");
  } catch {
    // The Codex sandbox may forbid writing this marker; the server itself can still run.
  }
  console.log(`nb-bo local server ready: http://localhost:${port}`);
});
