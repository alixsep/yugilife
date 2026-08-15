# Yugilife

Under development again after six years. Thank you to everyone who kept emailing and encouraging
the project to continue.

## Setup

The workspace requires the Node version declared in `package.json`; its `packageManager` field pins
the intended pnpm release. Install that pnpm release directly, or activate it with your Node package-
manager version tool, and confirm `pnpm --version` before installing JavaScript dependencies and the
two browsers used by the test suites:

```sh
pnpm install --frozen-lockfile
pnpm setup:browsers
```

On a Linux machine that does not already have Playwright's operating-system libraries, use
`pnpm setup:browsers:with-deps` instead. The `--with-deps` command may request administrator access.

## CLI

Build and run the browser-backed renderer from the workspace with:

```sh
pnpm --filter yugilife-cli build
node packages/yugilife-cli/dist/cli.js doctor
node packages/yugilife-cli/dist/cli.js render ./card.json --output ./card.svg
```

The CLI accepts one JSON card at a time and writes SVG, lossless PNG, JPEG, or WebP output at native
or aspect-preserving custom dimensions. See
[`packages/yugilife-cli/README.md`](packages/yugilife-cli/README.md) for the JSON transport format.

The `/inventory` route stores multiple cards, shows revision-matched gallery previews, and provides
create, edit, duplicate, and delete workflows. `/build/:cardId` downloads SVG, PNG, JPEG, or WebP
renders with native, preset, or custom aspect-preserving dimensions and can export/import a
self-contained versioned JSON card document. Saved and imported documents migrate to the current
release of the same stable template and are fully validated before entering the editor; embedded
artwork is carried as a data URL for JSON exchange and stored by asset reference in the inventory.

The template manager can import, export, duplicate, edit, and delete local user templates. It shows
template-cache usage and browser storage estimates; inventory, template, and reference persistence
use an in-memory page-session fallback when IndexedDB is unavailable.

Start the application with `pnpm dev`, then open `http://127.0.0.1:5173`. This command first checks
that committed generated data matches its inputs; if it reports stale output, run the generation
command named in the error and start development again. The development server loads `yugilife-core`
directly from workspace source, so a second core watcher is neither required nor desirable. Ports
are strict: if 5173 is occupied, stop the conflicting process rather than silently developing
against a different URL.

## GitHub Pages

The application is deployed to <https://alixsep.github.io/yugilife/> by
`.github/workflows/pages.yml` after a successful push to `main`. The workflow runs the complete
Linux verification chain, builds the app with the `/yugilife/` Vite base, exercises that exact
artifact in Chromium, and deploys it with GitHub's official Pages actions.

The Pages build uses hash routes such as `/yugilife/#/inventory`. GitHub Pages has no SPA rewrite
facility, so hash routing ensures that opening or refreshing any application route requests the real
`/yugilife/` document instead of relying on a custom 404 page. Local development and ordinary E2E
retain clean history routes. Run the deployment-specific build and smoke test locally with:

```sh
pnpm test:pages
```

For the first workflow deployment, the repository's **Settings → Pages → Build and deployment →
Source** must be set to **GitHub Actions**. This is repository configuration rather than a committed
file; subsequent pushes to `main` deploy automatically.

## Generated files

Ordinary checks never rewrite committed source. Use the narrow command matching the input changed:

- `pnpm generate:catalog` after changing the bundled-template allow-list or manifests;
- `pnpm generate:assets` after changing a Chromapair configuration, source texture, or calibration
  reference;
- `pnpm generate` when both kinds of generated output may be affected.

Asset generation requires [`uvx`](https://docs.astral.sh/uv/) and may download the pinned Chromapair
version on first use. `pnpm check:generated` is offline and verifies both catalog output and the
committed provenance of generated color presets.

## Verification

- `pnpm test:unit` runs the repository tooling tests and all workspace unit suites without the
  isolated packaging smoke builds.
- `pnpm test` runs each workspace's complete package-defined test command; `test:unit` remains the
  explicitly fast unit-only entry point as package suites grow.
- `pnpm typecheck` and `pnpm build` run the corresponding workspace checks.
- `pnpm test:e2e` builds the workspace and runs Chromium and Firefox against a server owned by the
  test process.
- `pnpm test:e2e:ui` builds the workspace and opens the same suite in Playwright UI mode.
- `pnpm test:visual` runs the Chromium visual baselines.
- `pnpm check` runs the authoritative complete verification chain on Linux, including the committed
  Linux visual baselines. It preflights both browser-test ports before expensive work, builds once,
  and immediately runs E2E against that output without maintaining separate build-validity state.
- `pnpm check:portable` runs the same chain except visual baselines and is the complete local command
  on macOS and Windows. Canonical visual verification remains a Linux/CI responsibility because
  browser rasterization is operating-system-specific.

If style verification fails, `pnpm lint:fix` applies available ESLint fixes and `pnpm format` rewrites
files with Prettier. Some lint findings still require a manual code correction; rerun `pnpm lint` and
`pnpm format:check` afterward.

Repository-orchestrated long-running children—packed-consumer checks and external color-preset
generation—print phase markers and have explicit deadlines. Ordinary
package tools such as ESLint, Prettier, TypeScript, Vite, Vitest, BDD generation, and Playwright run
directly and retain their native lifecycle and Ctrl-C behavior. For bounded orchestration on POSIX,
Ctrl-C gives an active process tree five seconds to stop before forcing termination; Windows
terminates the complete tree immediately because it has no equivalent cooperative console-process-
group signal. Isolated workflows then clean their temporary workspaces. Browser commands verify
their required Playwright binaries and fixed localhost ports before starting an expensive production
build. Development and test servers bind explicit IPv4 loopback addresses.
