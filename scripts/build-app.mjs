import path from "node:path";
import { build } from "vite";

const outDir =
  process.env.OAC_DIST_DIR ||
  (process.argv.includes("--local") ? path.join("..", "oac-local-dist") : "dist");

await build({
  build: {
    outDir,
    emptyOutDir: true
  }
});
