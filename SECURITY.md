# Security policy

## Supported versions

NovaLoomBoard is in early development. Security fixes are made on the `main` branch and included in the next release.

## Reporting a vulnerability

**Please do not report security problems in public issues.**

Report them privately through GitHub: open the repository's **Security** tab, then choose **Report a vulnerability**. Only the maintainers can see the report.

Please include:

- a description of the problem and its impact;
- steps to reproduce it, or a proof of concept (for example a crafted board file, image or PDF);
- the version or commit you tested.

You can expect an acknowledgement within a week. We'll keep you informed while we work on a fix, and credit you in the release notes unless you'd rather stay anonymous.

## Scope

NovaLoomBoard runs locally and makes no network connections. Reports that matter most involve:

- a board file, image, PDF or clipboard content that can run code, read or write files outside the app's library, or escape the renderer sandbox;
- ways to bypass the IPC validation between the interface and the main process;
- weaknesses in the packaged app's hardening (Electron fuses, Content-Security-Policy).

The design is described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#security-model).
