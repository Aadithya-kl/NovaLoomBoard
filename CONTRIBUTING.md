# Contributing to NovaLoomBoard

Thanks for helping make NovaLoomBoard better. Bug reports, feature ideas, documentation fixes and code are all welcome.

By taking part, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting bugs

Search the [existing issues](https://github.com/ghaithheni/NovaLoomBoard/issues) first. If your bug isn't there, open a new issue with the **Bug report** template and include:

- what you did, what you expected, and what happened instead;
- your Windows version, and NovaLoomBoard's version or commit;
- your input device (mouse, pen, touch), if the bug is about drawing;
- a screenshot or a short recording, if it helps.

Please don't attach boards that contain private content. A minimal board that shows the problem is best.

Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Suggesting features

Open an issue with the **Feature request** template. Describe the problem you want solved before the solution you have in mind. That makes it easier to find the design that fits the rest of the app.

NovaLoomBoard is deliberately local-first: no accounts, no servers, no telemetry. Features that need those are unlikely to be accepted into the core app.

## Setting up

Follow [Development](README.md#development) in the README. In short:

```sh
pnpm install
pnpm dev
```

Before opening a pull request, run:

```sh
pnpm typecheck
pnpm test
```

Both must pass.

## Making changes

1. Fork the repository and create a branch from `main` (for example `fix/eraser-on-rotated-shapes`).
2. Keep each pull request focused on one change. Small pull requests are reviewed faster.
3. Add or update tests for behaviour changes. Engine and store logic should be covered by Vitest tests next to the code.
4. Update the documentation when you change behaviour, shortcuts or file formats.
5. Open the pull request and fill in the template.

### Code style

- TypeScript in strict mode everywhere. Avoid `any`, and validate anything that crosses a process boundary or comes from a file (see `packages/board-engine/src/persist.ts`).
- Match the formatting and naming of the surrounding code: two-space indentation and double quotes. `.editorconfig` covers the basics.
- Comments explain *why*, not *what*.
- Interface text is plain and specific, in sentence case. Say what a button does ("Export as PDF", not "Submit"), and make error messages say what went wrong and what to do.
- Keep `board-engine` free of React and Electron, and keep Node APIs in the main process.

### Board file format

Board files are SQLite databases (see [ARCHITECTURE.md](docs/ARCHITECTURE.md#packagesboard-store)). Any change to the schema must:

- bump `SCHEMA_VERSION` in `packages/board-store/src/board-file.ts`;
- add a migration that runs in one transaction, plus a test that upgrades a file from the previous version;
- keep read-only opens from modifying files.

### Commit messages

Write commit messages in the imperative mood, with a short summary line ("Fix eraser on rotated shapes") and, if needed, a body that explains why.

## Licensing of contributions

NovaLoomBoard is MIT-licensed. By submitting a contribution, you agree that it is licensed under the [MIT License](LICENSE), and that you have the right to submit it.

When you add a dependency, check that its licence is compatible with MIT (MIT, ISC, BSD, Apache-2.0 and similar permissive licences are fine). Then add it to [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md), and, if it ships in the app, to the notices list in `apps/desktop/scripts/package.mjs`.
