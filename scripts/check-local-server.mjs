const ports = (process.env.OAC_LOCAL_PORTS || "8888,9891,9892,9893,9999,10088,18088")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

async function checkPort(port) {
  const url = `http://127.0.0.1:${port}`;
  try {
    const health = await fetch(`${url}/__health`, { cache: "no-store" });
    const healthText = await health.text();
    let healthPayload = null;
    try {
      healthPayload = healthText ? JSON.parse(healthText) : null;
    } catch {
      // Ignore non-JSON health responses; this is likely another local service.
    }
    const root = await fetch(`${url}/`, { cache: "no-store" });
    const rootText = await root.text();
    const isOac = Boolean(healthPayload?.ok && healthPayload?.app === "oac-local");
    return {
      port,
      url,
      reachable: true,
      oac: isOac,
      rootStatus: root.status,
      healthStatus: health.status,
      staticIndexExists: Boolean(healthPayload?.staticIndexExists),
      staticRoot: healthPayload?.staticRoot || "",
      title: rootText.match(/<title>(.*?)<\/title>/i)?.[1] || ""
    };
  } catch (error) {
    return {
      port,
      url,
      reachable: false,
      oac: false,
      error: error?.message || String(error)
    };
  }
}

const results = [];
for (const port of ports) {
  results.push(await checkPort(port));
}

const active = results.find((item) => item.oac && item.rootStatus === 200);
console.log(JSON.stringify({
  ok: Boolean(active),
  activeUrl: active?.url || "",
  results
}, null, 2));

if (!active) process.exitCode = 1;
