import path from "node:path";
import { build } from "vite";

const outDir =
  process.env.OAC_DIST_DIR ||
  (process.env.NETLIFY ? "dist" : path.join("..", "oac-local-dist"));

await build({
  build: {
    outDir,
    emptyOutDir: true
  }
});
