import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

const LOCAL_ROOT = join(process.cwd(), "local-data");
const localWriteQueues = new Map();
const tenantContextStore = new AsyncLocalStorage();
const TENANT_DATA_NAMESPACE = "tenant-data";
const TENANT_SCOPED_NAMESPACES = new Set([
  "annual-reports",
  "checkpoints",
  "index",
  "jobs",
  "profiles",
  "reports"
]);

function envValue(name) {
  try {
    const value = globalThis.Netlify?.env?.get?.(name);
    if (value) return value;
  } catch {
    // Ignore non-Netlify runtime.
  }
  return process.env[name] || "";
}

function cleanTenantId(value) {
  return String(value || "internal-demo")
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "internal-demo";
}

export function getTenantContext() {
  return tenantContextStore.getStore() || null;
}

export function withTenantContext(context, fn) {
  const tenantId = cleanTenantId(context?.tenantId);
  return tenantContextStore.run({ ...(context || {}), tenantId }, fn);
}

function route(namespace, key = "") {
  const context = getTenantContext();
  if (!context?.tenantId || !TENANT_SCOPED_NAMESPACES.has(namespace)) {
    return { namespace, key, routed: false, tenantId: "" };
  }
  const prefix = `${cleanTenantId(context.tenantId)}/${namespace}`;
  return {
    namespace: TENANT_DATA_NAMESPACE,
    key: key ? `${prefix}/${key}` : `${prefix}/`,
    prefix,
    routed: true,
    tenantId: cleanTenantId(context.tenantId)
  };
}

async function blobStore(namespace) {
  const explicitSiteId = envValue("OAC_BLOBS_SITE_ID") || envValue("NETLIFY_SITE_ID") || envValue("SITE_ID");
  const explicitToken = envValue("OAC_BLOBS_TOKEN") || envValue("NETLIFY_BLOBS_TOKEN");
  const isNetlifyRuntime =
    process.env.NETLIFY === "true" ||
    process.env.NETLIFY_DEV === "true" ||
    Boolean(process.env.NETLIFY_BLOBS_CONTEXT);
  if (!isNetlifyRuntime && !(explicitSiteId && explicitToken)) return null;

  try {
    const { getStore } = await import("@netlify/blobs");
    if (explicitSiteId && explicitToken) {
      return getStore({ name: namespace, siteID: explicitSiteId, token: explicitToken, consistency: "strong" });
    }
    return getStore({ name: namespace, consistency: "strong" });
  } catch {
    return null;
  }
}

function localPath(namespace, key) {
  return join(LOCAL_ROOT, namespace, key);
}

export async function readJson(namespace, key, fallback = null) {
  const target = route(namespace, key);
  const store = await blobStore(target.namespace);
  if (store) {
    const value = await store.get(target.key, { type: "json" });
    if (value === null && target.routed && target.tenantId === "internal-demo") {
      const legacy = await store.get(key, { type: "json" }).catch(() => null);
      if (legacy !== null) return legacy;
    }
    return value ?? fallback;
  }
  const path = localPath(target.namespace, target.key);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const raw = await readFile(path, "utf8");
      return JSON.parse(raw.replace(/^\uFEFF/, ""));
    } catch {
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  if (target.routed && target.tenantId === "internal-demo") {
    try {
      const raw = await readFile(localPath(namespace, key), "utf8");
      return JSON.parse(raw.replace(/^\uFEFF/, ""));
    } catch {
      // Fall through to fallback.
    }
  }
  return fallback;
}

export async function writeJson(namespace, key, value) {
  const target = route(namespace, key);
  const store = await blobStore(target.namespace);
  if (store) {
    await store.setJSON(target.key, value);
    return;
  }
  const path = localPath(target.namespace, target.key);
  const previous = localWriteQueues.get(path) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    const data = JSON.stringify(value, null, 2);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(tmp, data, "utf8");
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await rename(tmp, path);
        return;
      } catch (error) {
        if (!["EPERM", "EBUSY", "EACCES"].includes(error?.code) || attempt === 7) {
          if (["EPERM", "EBUSY", "EACCES"].includes(error?.code)) {
            await writeFile(path, data, "utf8");
            await rm(tmp, { force: true });
            return;
          }
          await rm(tmp, { force: true });
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  });
  const queued = task.finally(() => {
    if (localWriteQueues.get(path) === queued) localWriteQueues.delete(path);
  });
  localWriteQueues.set(path, queued);
  return task;
}

export async function readText(namespace, key, fallback = "") {
  const target = route(namespace, key);
  const store = await blobStore(target.namespace);
  if (store) {
    const value = await store.get(target.key, { type: "text" });
    if (value === null && target.routed && target.tenantId === "internal-demo") {
      const legacy = await store.get(key, { type: "text" }).catch(() => null);
      if (legacy !== null) return legacy;
    }
    return value ?? fallback;
  }
  try {
    return await readFile(localPath(target.namespace, target.key), "utf8");
  } catch {
    if (target.routed && target.tenantId === "internal-demo") {
      try {
        return await readFile(localPath(namespace, key), "utf8");
      } catch {
        // Fall through to fallback.
      }
    }
    return fallback;
  }
}

export async function writeText(namespace, key, value) {
  const target = route(namespace, key);
  const store = await blobStore(target.namespace);
  if (store) {
    await store.set(target.key, value);
    return;
  }
  const path = localPath(target.namespace, target.key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}

export async function listJson(namespace) {
  const target = route(namespace, "");
  const store = await blobStore(target.namespace);
  if (store) {
    try {
      const listed = await store.list(target.routed ? { prefix: target.key } : undefined);
      const rows = Array.isArray(listed?.blobs) ? listed.blobs : [];
      const out = [];
      for (const row of rows) {
        const key = row.key || row.name;
        if (!key || !String(key).endsWith(".json")) continue;
        const value = await store.get(key, { type: "json" });
        if (value) out.push({ key: target.routed ? String(key).slice(target.key.length) : key, value });
      }
      if (target.routed && target.tenantId === "internal-demo") {
        const legacyStore = await blobStore(namespace).catch(() => null);
        const legacyListed = await legacyStore?.list().catch(() => null);
        const legacyRows = Array.isArray(legacyListed?.blobs) ? legacyListed.blobs : [];
        const seen = new Set(out.map((item) => item.key));
        for (const row of legacyRows) {
          const key = row.key || row.name;
          if (!key || !String(key).endsWith(".json") || seen.has(key)) continue;
          const value = await legacyStore.get(key, { type: "json" }).catch(() => null);
          if (value) out.push({ key, value });
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  try {
    const dir = localPath(target.namespace, target.key);
    const files = await readdir(dir, { withFileTypes: true });
    const out = [];
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      try {
        const raw = await readFile(localPath(target.namespace, join(target.key, file.name)), "utf8");
        out.push({ key: file.name, value: JSON.parse(raw.replace(/^\uFEFF/, "")) });
      } catch {
        // Ignore unreadable local cache files.
      }
    }
    if (target.routed && target.tenantId === "internal-demo") {
      try {
        const legacyFiles = await readdir(localPath(namespace, ""), { withFileTypes: true });
        const seen = new Set(out.map((item) => item.key));
        for (const file of legacyFiles) {
          if (!file.isFile() || !file.name.endsWith(".json") || seen.has(file.name)) continue;
          try {
            const raw = await readFile(localPath(namespace, file.name), "utf8");
            out.push({ key: file.name, value: JSON.parse(raw.replace(/^\uFEFF/, "")) });
          } catch {
            // Ignore unreadable legacy files.
          }
        }
      } catch {
        // No legacy namespace.
      }
    }
    return out;
  } catch {
    if (target.routed && target.tenantId === "internal-demo") {
      try {
        const files = await readdir(localPath(namespace, ""), { withFileTypes: true });
        const out = [];
        for (const file of files) {
          if (!file.isFile() || !file.name.endsWith(".json")) continue;
          try {
            const raw = await readFile(localPath(namespace, file.name), "utf8");
            out.push({ key: file.name, value: JSON.parse(raw.replace(/^\uFEFF/, "")) });
          } catch {
            // Ignore unreadable legacy files.
          }
        }
        return out;
      } catch {
        // Fall through.
      }
    }
    return [];
  }
}

export async function deleteObject(namespace, key) {
  const target = route(namespace, key);
  const store = await blobStore(target.namespace);
  if (store) {
    await store.delete(target.key);
    return;
  }
  await rm(localPath(target.namespace, target.key), { force: true });
}

export async function getIndex() {
  return readJson("index", "reports.json", { reports: [] });
}

export async function saveIndex(index) {
  await writeJson("index", "reports.json", index);
}
