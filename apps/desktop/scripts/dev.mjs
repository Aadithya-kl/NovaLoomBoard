// Development: Vite dev server for the board UI + Electron pointed at it.
// The Vite port is read from the running server (5173 may be taken by another app).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { buildDesktop } from "./build.mjs";

const desktopDir = fileURLToPath(new URL("..", import.meta.url));
const webDir = fileURLToPath(new URL("../../web", import.meta.url));

await buildDesktop();
const server = await createServer({ root: webDir, configFile: `${webDir}/vite.config.ts`, server: { host: "127.0.0.1" } });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`[dev] board UI at ${url}`);

const electronPath = createRequire(import.meta.url)("electron");
const child = spawn(electronPath, [".", ...process.argv.slice(2)], { cwd: desktopDir, stdio: "inherit", env: { ...process.env, NLB_DEV_URL: url } });
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill());
