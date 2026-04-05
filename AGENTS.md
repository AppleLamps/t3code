# AGENTS.md

## Task Completion Requirements

- All of `bun fmt`, `bun lint`, and `bun typecheck` must pass before considering tasks completed.
- NEVER run `bun test`. Always use `bun run test` (runs Vitest via turbo).
- Server tests run sequentially (`fileParallelism: false`) with 60s timeouts — full suite takes ~5min.

## Local Development

### macOS / Linux

```bash
bun install
bun dev
```

### Windows

Bun lacks PTY support on Windows. Build and run with Node instead:

```bash
bun install
bun run build
cd apps/server
node dist/bin.mjs --mode web --port 3773
```

To rebuild after changes, stop the server, run `bun run build` from the repo root, then restart.

### Quality checks

```bash
bun fmt          # Format (oxfmt)
bun lint         # Lint (oxlint)
bun typecheck    # Type-check (turbo + tsc). TS2 hints from Effect-TS plugin are informational, not errors.
bun run test     # Run all tests (vitest via turbo)
```

## Project Snapshot

T3 Code is a minimal web GUI for using coding agents like Codex and Claude.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket. State is managed via Zustand in `src/store/` (decomposed into appState, mappers, threadUpdaters, eventReducer, actions, selectors, createStore).
- `packages/contracts`: Shared Effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic. Dependency direction: `shared` depends on `contracts`, NOT the reverse.
- `packages/shared`: Shared runtime utilities consumed by both server and web. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index. tsconfig has `importFromBarrel: "error"` — cannot use `export *` in index.ts.

## Cross-Platform Notes

- **Windows PTY**: Bun PTY is unavailable on Windows. Use Node.js to run the server.
- **Git CRLF**: Test repos must set `core.autocrlf=false` to preserve exact content. Windows defaults to true.
- **chmod**: Setting `0o000` permissions doesn't restrict access on Windows (uses ACLs, not POSIX permissions). Tests relying on chmod for access control should be skipped with `it.effect.skipIf(process.platform === "win32")`.
- **Path separators**: Use `node:path` functions (`join`, `basename`, `resolve`) for cross-platform path assertions in tests. Never hardcode `/` or `\` in assertions.

## Codex App Server (Important)

T3 Code is currently Codex-first. The server starts `codex app-server` (JSON-RPC over stdio) per provider session, then streams structured events to the browser through WebSocket push messages.

How we use it in this codebase:

- Session startup/resume and turn lifecycle are brokered in `apps/server/src/codexAppServerManager.ts`.
- Provider dispatch and thread event logging are coordinated in `apps/server/src/providerManager.ts`.
- WebSocket server routes NativeApi methods in `apps/server/src/wsServer.ts`.
- Web app consumes orchestration domain events via WebSocket push on channel `orchestration.domainEvent` (provider runtime activity is projected into orchestration events server-side).

Docs:

- Codex App Server docs: https://developers.openai.com/codex/sdk/#app-server

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.
