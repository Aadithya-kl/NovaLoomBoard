// Bundles the Electron main and preload scripts (CommonJS) into dist/.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

export async function buildDesktop() {
  const common = { bundle: true, platform: "node", target: "node22", format: "cjs", external: ["electron"], sourcemap: true, logLevel: "warning", absWorkingDir: root };
  await Promise.all([
    build({ ...common, entryPoints: ["src/main.ts"], outfile: "dist/main.cjs" }),
    build({ ...common, entryPoints: ["src/preload.ts"], outfile: "dist/preload.cjs" }),
  ]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildDesktop();
