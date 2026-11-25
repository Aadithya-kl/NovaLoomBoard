import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * pdf.js needs its character maps, standard fonts and image decoders at run
 * time (PDFs that do not embed their fonts, CJK text, JPEG 2000 images).
 * They are copied into public/pdfjs so they ship with the app, offline.
 */
function pdfjsAssets(): Plugin {
  const copy = () => {
    const src = path.dirname(require.resolve("pdfjs-dist/package.json"));
    const dest = path.resolve(__dirname, "public/pdfjs");
    for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
      const from = path.join(src, dir);
      if (fs.existsSync(from)) fs.cpSync(from, path.join(dest, dir), { recursive: true });
    }
  };
  return { name: "pdfjs-assets", buildStart: copy };
}

/**
 * Content-Security-Policy for the built app only (the dev server injects inline
 * scripts). Everything comes from the app's own files: no remote content, no
 * eval; WebAssembly for pdf.js decoders; data:/blob: images for imported pictures.
 */
function contentSecurityPolicy(): Plugin {
  const csp = [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self'",
    "connect-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join("; ");
  return {
    name: "content-security-policy",
    apply: "build",
    transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: csp }, injectTo: "head-prepend" }],
  };
}

const require = (await import("node:module")).createRequire(import.meta.url);
const __dirname = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");

export default defineConfig({
  plugins: [react(), pdfjsAssets(), contentSecurityPolicy()],
  // Relative asset paths so the built UI loads from file:// inside Electron.
  base: "./",
  server: { port: 5173, strictPort: false },
});
