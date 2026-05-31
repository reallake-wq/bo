import { createServer } from "node:net";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const staticRoot = path.resolve(process.env.OAC_DIST_DIR || path.join(root, "..", "oac-local-dist"));
const ports = (process.env.OAC_LOCAL_PORTS || "8888,9891,9892,9893,9999,10088,18088")
  .split(",")
  .map((item) => Number(item.trim()))
  .filter(Boolean);

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function findActiveOac() {
  for (const port of ports) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/__health`, { cache: "no-store" });
      const payload = await response.json();
      if (payload?.ok && payload?.app === "oac-local") return { port, url: `http://127.0.0.1:${port}` };
    } catch {
      // Ignore other local services.
    }
  }
  return null;
}

async function waitForHealth(port) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/__health`, { cache: "no-store" });
      const payload = await response.json();
      if (payload?.ok && payload?.app === "oac-local") return payload;
    } catch {
      // Server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Local server did not become healthy on port ${port}.`);
}

async function main() {
  if (!existsSync(path.join(staticRoot, "index.html"))) {
    throw new Error(`Built app not found at ${staticRoot}. Run npm run build first.`);
  }

  const active = await findActiveOac();
  if (active) {
    console.log(JSON.stringify({ ok: true, reused: true, ...active }, null, 2));
    return;
  }

  let selected = 0;
  for (const port of ports) {
    if (await isPortFree(port)) {
      selected = port;
      break;
    }
  }
  if (!selected) {
    throw new Error(`No free local port found: ${ports.join(", ")}`);
  }

  await mkdir(root, { recursive: true });
  const logDir = path.resolve(root, "..");
  const outFd = openSync(path.join(logDir, `oac-local-server-${selected}.out.log`), "a");
  const errFd = openSync(path.join(logDir, `oac-local-server-${selected}.err.log`), "a");
  const serverFile = path.join(root, "local-server.mjs");
  const isWindows = process.platform === "win32";
  let childPid = 0;
  if (isWindows) {
    const innerCommand = [
      `$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()`,
      `Set-Location -LiteralPath ${psQuote(root)}`,
      `$env:PORT = ${psQuote(selected)}`,
      `$env:OAC_DIST_DIR = ${psQuote(staticRoot)}`,
      `& ${psQuote(process.execPath)} ${psQuote(serverFile)}`
    ].join("; ");
    const launcherCommand = [
      `$argumentList = @('-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-Command', ${psQuote(innerCommand)})`,
      `Start-Process -FilePath 'powershell.exe' -ArgumentList $argumentList -WindowStyle Hidden`
    ].join("; ");
    const launched = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", launcherCommand],
      { cwd: root, encoding: "utf8" }
    );
    if (launched.status !== 0) {
      throw new Error(launched.stderr || launched.stdout || "Failed to launch local server process.");
    }
  } else {
    const child = spawn(process.execPath, [serverFile], {
        cwd: root,
        detached: true,
        stdio: ["ignore", outFd, errFd],
        env: {
          ...process.env,
          PORT: String(selected),
          OAC_DIST_DIR: staticRoot
        }
      });
    childPid = child.pid || 0;
    child.unref();
  }
  closeSync(outFd);
  closeSync(errFd);

  const health = await waitForHealth(selected);
  try {
    await writeFile(path.join(root, "local-server-ready.txt"), `http://localhost:${selected}\n`, "utf8");
  } catch {
    // Some local workspaces expose old marker files through restrictive reparse points.
    // The health check below is the source of truth, so the marker is best-effort only.
  }
  console.log(JSON.stringify({
    ok: true,
    reused: false,
    pid: childPid,
    url: `http://127.0.0.1:${selected}`,
    staticRoot: health.staticRoot
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
