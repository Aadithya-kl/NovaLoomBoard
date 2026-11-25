# Packaging

`apps/desktop/scripts/package.mjs` builds the interface and the main process, stages only the files the app needs, collects third-party licence notices, and runs electron-builder.

```sh
pnpm package                                         # Windows installer (NSIS)
pnpm --filter @novaloom/desktop package -- --dir     # unpacked app only
pnpm --filter @novaloom/desktop package -- --store   # Microsoft Store package (.appx)
```

Output goes to `apps/desktop/release/dist/`.

## Installer

The installer is one-click and per-user. It installs to `%LOCALAPPDATA%\Programs\novaloomboard` and creates a desktop shortcut. Boards live separately in `%LOCALAPPDATA%\NovaLoomBoard`, and uninstalling never removes them.

The installer is not code-signed. Windows SmartScreen will warn about it until it is signed with a code-signing certificate, or the app is distributed through the Microsoft Store, which signs packages itself.

## Microsoft Store

1. Reserve the app name in [Partner Center](https://partner.microsoft.com/dashboard).
2. Copy `apps/desktop/store-identity.example.json` to `apps/desktop/store-identity.json` and fill it in from **Product management › Product identity**. This file is git-ignored.
3. Run the `--store` build and upload the `.appx`. The Store signs it.

Without `store-identity.json`, `--store` builds a local test package with a placeholder identity, which is useful for checking the build but cannot be uploaded.

The Store package turns off file-system write virtualisation (`resources/appxmanifest.xml`), so boards are stored in the same real `%LOCALAPPDATA%\NovaLoomBoard` folder as with the installer, and survive reinstalling. This uses the restricted capability `unvirtualizedResources` and needs Windows 10 version 2004 or later.

## Hardening

Packaged builds set these Electron fuses:

| Fuse | Setting |
| --- | --- |
| `RunAsNode` | off |
| `EnableNodeOptionsEnvironmentVariable` | off |
| `EnableNodeCliInspectArguments` | off |
| `EnableEmbeddedAsarIntegrityValidation` | on |
| `OnlyLoadAppFromAsar` | on |
| `EnableCookieEncryption` | on |

Developer tools are disabled and remote-debugging switches are ignored in packaged builds.

## Icons

The app icon is generated from `assets/brand/logo.svg`. If you change the logo, regenerate these files:

| File | Size |
| --- | --- |
| `apps/desktop/resources/icon.png` | 1024 × 1024 (electron-builder makes the `.ico` from it) |
| `apps/desktop/resources/appx/Square150x150Logo.png` | 150 × 150 |
| `apps/desktop/resources/appx/Square44x44Logo.png` | 44 × 44 |
| `apps/desktop/resources/appx/StoreLogo.png` | 50 × 50 |
| `apps/desktop/resources/appx/Wide310x150Logo.png` | 310 × 150 |
| `assets/brand/icon-*.png`, `assets/brand/favicon.ico` | 16 to 1024 |
| `apps/web/src/assets/logo.svg`, `apps/web/public/favicon.svg` | copies of the SVG |
