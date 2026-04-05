# T3 Code

T3 Code is a minimal web GUI for coding agents (currently Codex and Claude, more coming soon).

## Installation

> [!WARNING]
> T3 Code currently supports Codex and Claude.
> Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://github.com/openai/codex) and run `codex login`
> - Claude: install Claude Code and run `claude auth login`

### Run without installing

```bash
npx t3
```

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Arch Linux (AUR)

```bash
yay -S t3code-bin
```

## Local Development

### Prerequisites

- [Bun](https://bun.sh/) (package manager, formatter, linter runner)
- [Node.js](https://nodejs.org/) v22+ (required for the server on Windows — Bun lacks PTY support)

### Install dependencies

```bash
bun install
```

### Running locally (macOS / Linux)

```bash
bun dev
```

This starts the contracts watcher, Vite dev server (port 5733), and the T3 server (port 3773) together via turbo.

### Running locally (Windows)

Bun's PTY support is unavailable on Windows. Build and start with Node instead:

```bash
bun run build
cd apps/server
node dist/bin.mjs --mode web --port 3773
```

Then open http://localhost:3773 in your browser. The server serves the built web app.

To rebuild after changes:

```bash
# Stop the server (Ctrl+C), then:
cd <repo-root>
bun run build
cd apps/server
node dist/bin.mjs --mode web --port 3773
```

### Quality checks

```bash
bun fmt          # Format (oxfmt)
bun lint         # Lint (oxlint)
bun typecheck    # Type-check all packages (turbo + tsc)
bun run test     # Run all tests (vitest via turbo) — do NOT use `bun test`
```

## Architecture

| Package              | Role                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `apps/server`        | Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, manages provider sessions. |
| `apps/web`           | React/Vite UI. Session UX, conversation/event rendering, client-side state via Zustand.                                      |
| `packages/contracts` | Shared Effect/Schema schemas and TypeScript contracts. Schema-only — no runtime logic.                                       |
| `packages/shared`    | Shared runtime utilities. Explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.                           |

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

Observability guide: [docs/observability.md](./docs/observability.md)

## If you REALLY want to contribute still.... read this first

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
