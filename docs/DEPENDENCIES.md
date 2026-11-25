# Dependencies and licences

NovaLoomBoard is MIT-licensed. Every dependency uses a permissive licence that is compatible with it, and there are no paid or proprietary components. The versions below are the ones locked in `pnpm-lock.yaml` at the time of writing.

## Shipped in the app

These are bundled into the installed application. Their full licence texts are collected into `THIRD_PARTY_NOTICES.txt` by `apps/desktop/scripts/package.mjs` and installed next to the app.

| Package | Version | Licence | Used for |
| --- | --- | --- | --- |
| [Electron](https://www.electronjs.org/) | 45.4.1 | MIT (Chromium and Node.js under their own licences, shipped as `LICENSE.electron.txt` and `LICENSES.chromium.html`) | Desktop runtime |
| [React](https://react.dev/) and `react-dom` | 19.3.1 | MIT | Interface |
| `scheduler` (dependency of `react-dom`) | 0.28.0 | MIT | Interface |
| [Lucide](https://lucide.dev/) (`lucide-react`) | 0.548.0 | ISC | Icons |
| [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) | 6.5.438 | Apache-2.0 | PDF import |
| [MathJax](https://www.mathjax.org/) (`mathjax-full`) | 3.2.2 | Apache-2.0 | Equation typesetting |
| `mhchemparser` (dependency of MathJax) | 4.2.1 | Apache-2.0 | Chemistry notation in equations |
| [perfect-freehand](https://github.com/steveruizok/perfect-freehand) | 1.2.3 | MIT | Ink stroke outlines |
| [rbush](https://github.com/mourner/rbush) | 4.0.1 | MIT | Spatial index for hit-testing |
| `quickselect` (dependency of rbush) | 3.0.0 | ISC | Spatial index |

pdf.js also ships data files, which are copied from `pdfjs-dist` at build time into `apps/web/public/pdfjs/`, each folder with its licence:

| Files | Licence |
| --- | --- |
| Character maps (`cmaps/`) | Adobe, BSD-style (see `cmaps/LICENSE`) |
| Standard fonts (`standard_fonts/`) | Foxit fonts: BSD-style (PDFium). Liberation fonts: SIL Open Font License 1.1 |
| Image decoders (`wasm/`): OpenJPEG, JBIG2, qcms, QuickJS | BSD-2-Clause, BSD-3-Clause (PDFium), MIT, MIT |
| Colour profile (`iccs/`) | CC0 1.0 |

## Development only

These are used to build and test, and are not shipped in the app.

| Package | Licence | Used for |
| --- | --- | --- |
| [TypeScript](https://www.typescriptlang.org/) | Apache-2.0 | Type checking |
| [Vite](https://vite.dev/) and `@vitejs/plugin-react` | MIT | Interface dev server and bundling |
| [esbuild](https://esbuild.github.io/) | MIT | Main-process and preload bundles |
| [electron-builder](https://www.electron.build/) | MIT | Installer and Store packages |
| [Vitest](https://vitest.dev/) | MIT | Tests |
| [fast-check](https://fast-check.dev/) | MIT | Property-based tests |
| `@types/*` (DefinitelyTyped) | MIT | Type definitions |

## Platform features used instead of dependencies

- **SQLite:** Node's built-in `node:sqlite` module (SQLite is public domain), so there is no native module.
- **Fonts:** the interface uses the fonts installed with Windows (Segoe UI Variable). No font files are bundled apart from pdf.js's standard PDF fonts.

## Checking licences

To list the licences of every installed production dependency:

```sh
pnpm -r licenses list --prod
```

That list is longer than the table above, because it includes packages that are installed but never bundled into the app: MathJax's Node-only helpers (`speech-rule-engine`, `mj-context-menu`, `@xmldom/xmldom`, `wicked-good-xpath`, `commander`, `esm`) and pdf.js's optional Node canvas (`@napi-rs/canvas`). All of them are MIT or Apache-2.0.
