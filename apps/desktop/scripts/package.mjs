// Builds a Windows installer (NSIS) and an unpacked app into apps/desktop/release/.
// Only built files are packaged: the main and preload bundles (esbuild, no
// runtime dependencies), the web interface, and third-party licence notices.
// Usage: node scripts/package.mjs [--dir | --store]
//   --dir    unpacked app only, no installer
//   --store  Microsoft Store package (.appx) in place of the installer. It is left unsigned:
//            the Store signs it. Its identity comes from store-identity.json (Partner Center >
//            the app > Product identity; see store-identity.example.json). That file is not
//            committed; without it a local test package is built.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDesktop } from "./build.mjs";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const repo = path.resolve(desktop, "../..");
const web = path.join(repo, "apps/web");
const release = path.join(desktop, "release");
const stage = path.join(release, "app");
const pkg = JSON.parse(fs.readFileSync(path.join(desktop, "package.json"), "utf8"));
const electronVersion = JSON.parse(fs.readFileSync(path.join(desktop, "node_modules/electron/package.json"), "utf8")).version;

/** Publisher and copyright holder (CompanyName, Apps & features). This is metadata only: it does not sign anything. */
const PUBLISHER = "Ghaith Heni";
const COPYRIGHT = `Copyright © 2026 ${PUBLISHER} and NovaLoomBoard contributors. MIT License.`;

const store = process.argv.includes("--store");

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });

// 1. Build the interface and the main process.
run("pnpm", ["--filter", "@novaloom/web", "build"], repo);
await buildDesktop();

// 2. Stage the app: nothing but what runs.
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, "dist"), { recursive: true });
for (const f of ["main.cjs", "preload.cjs"]) fs.copyFileSync(path.join(desktop, "dist", f), path.join(stage, "dist", f));
fs.cpSync(path.join(web, "dist"), path.join(stage, "web"), { recursive: true });
fs.writeFileSync(
  path.join(stage, "package.json"),
  JSON.stringify(
    {
      name: "novaloomboard",
      productName: "NovaLoomBoard",
      version: pkg.version,
      description: "NovaLoomBoard: an open-source digital whiteboard",
      author: { name: PUBLISHER },
      license: "MIT",
      main: "dist/main.cjs",
    },
    null,
    2,
  ),
);

// 3. Licence notices for the open-source code bundled into the app (Electron adds its own).
// [package, the package that depends on it when it is not a direct dependency]
const bundled = {
  web: [["react"], ["react-dom"], ["scheduler", "react-dom"], ["lucide-react"], ["pdfjs-dist"], ["mathjax-full"], ["mhchemparser", "mathjax-full"]],
  engine: [["perfect-freehand"], ["rbush"], ["quickselect", "rbush"]],
};
const notices = ["NovaLoomBoard is free software under the MIT License (see LICENSE.txt). It includes the following third-party\nopen-source software, under the licences reproduced below.\n"];
/** The installed folder of package `name` as seen from `from` (pnpm links, so follow them). */
const pkgDir = (from, name) => {
  for (let d = from; ; d = path.dirname(d)) {
    const c = path.join(d, "node_modules", name);
    if (fs.existsSync(c)) return fs.realpathSync(c);
    if (path.dirname(d) === d) throw new Error(`${name} not found from ${from}`);
  }
};
const roots = { web, engine: path.join(repo, "packages/board-engine") };
for (const [where, names] of Object.entries(bundled)) {
  for (const [name, parent] of names) {
    // pnpm keeps a dependency's own dependencies next to it.
    const dir = parent ? path.join(pkgDir(roots[where], parent), "..", name) : pkgDir(roots[where], name);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const file = fs.readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
    if (!file) throw new Error(`no licence file for ${name}`);
    notices.push(`\n${"=".repeat(72)}\n${name} ${meta.version} (${meta.license})\n${"=".repeat(72)}\n\n${fs.readFileSync(path.join(dir, file), "utf8").trim()}\n`);
  }
}
notices.push(`\n${"=".repeat(72)}\npdf.js fonts, character maps and decoders\n${"=".repeat(72)}\n\nTheir licences are in resources/app.asar/web/pdfjs/ next to each file group.\n`);
fs.writeFileSync(path.join(stage, "THIRD_PARTY_NOTICES.txt"), notices.join(""));

// 4. Package.
const config = {
  appId: "app.novaloomboard.desktop",
  productName: "NovaLoomBoard",
  executableName: "NovaLoomBoard",
  copyright: COPYRIGHT,
  electronVersion,
  directories: { app: stage, output: path.join(release, "dist"), buildResources: path.join(desktop, "resources") },
  // Everything the app needs is bundled; keep the workspace's packages out.
  files: ["**/*", "!**/node_modules{,/**}"],
  npmRebuild: false,
  asar: true,
  extraResources: [{ from: path.join(stage, "THIRD_PARTY_NOTICES.txt"), to: "THIRD_PARTY_NOTICES.txt" }],
  // NovaLoomBoard's own notice, next to the executable and Electron's licence files.
  extraFiles: [{ from: path.join(repo, "LICENSE"), to: "LICENSE.txt" }],
  // Executable switches that a released app must not honour: running as plain Node,
  // NODE_OPTIONS, --inspect; code is loaded only from the checked app.asar.
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    enableCookieEncryption: true,
  },
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    artifactName: "NovaLoomBoard-Setup-${version}.${ext}",
    // Square artwork (768×768, transparent): electron-builder makes the multi-size .ico from it
    // for the executable, shortcuts, Apps & features, and the installer and uninstaller.
    icon: path.join(desktop, "resources", "icon.png"),
  },
  // One-click, per-user: no folder choice, so the program can never be installed
  // over the board library (%LOCALAPPDATA%\NovaLoomBoard) and removed with it.
  nsis: { oneClick: true, perMachine: false, deleteAppDataOnUninstall: false, createDesktopShortcut: true, shortcutName: "NovaLoomBoard" },
  publish: null,
};
if (store) {
  const identityFile = path.join(desktop, "store-identity.json");
  const real = fs.existsSync(identityFile);
  if (!real) console.warn("store-identity.json not found: building a local test package, not one to upload.");
  const id = real
    ? JSON.parse(fs.readFileSync(identityFile, "utf8"))
    : { identityName: "NovaLoomBoard.LocalTest", publisher: "CN=NovaLoomBoard local test", publisherDisplayName: PUBLISHER };
  for (const k of ["identityName", "publisher", "publisherDisplayName"]) if (!id[k]) throw new Error(`store-identity.json: ${k} is missing`);
  config.win.target = [{ target: "appx", arch: ["x64"] }];
  config.win.artifactName = (real ? "NovaLoomBoard-Store-" : "NovaLoomBoard-StoreTest-") + "${version}.${ext}";
  config.appx = {
    identityName: id.identityName,
    publisher: id.publisher,
    publisherDisplayName: id.publisherDisplayName,
    displayName: "NovaLoomBoard",
    applicationId: "NovaLoomBoard",
    backgroundColor: "transparent",
    languages: ["en-US"],
    // resources/appxmanifest.xml turns off file-system write virtualization, so boards stay
    // in %LOCALAPPDATA%\NovaLoomBoard after an uninstall, as with the installer.
    customManifestPath: "appxmanifest.xml",
    capabilities: ["unvirtualizedResources"],
    minVersion: "10.0.19041.0",
    maxVersionTested: "10.0.26100.0",
  };
}
const configPath = path.join(release, "builder.json");
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
const args = ["--win", "--x64", "--config", configPath, "--publish", "never"];
if (process.argv.includes("--dir") && !store) args.push("--dir");
run(path.join(desktop, "node_modules/.bin/electron-builder"), args, desktop);
