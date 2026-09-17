# Agent instructions

Orchboard is a local dashboard for Claude Code and Codex background agents. TypeScript, zero
runtime dependencies, no bundler.

```
src/server   HTTP server, Claude/Codex runners, stores (runs as .ts via Node type stripping)
src/web      Browser app, compiled to dist/web by tsc
src/shared   Types and helpers used by both sides
public       index.html, styles.css, icons
```

## Rules

- **No runtime dependencies and no bundler.** Node built-ins on the server, plain DOM APIs in the
  browser. Dev dependencies are fine.
- **Cross-platform.** Windows, macOS and Linux. Branch on `process.platform` and pass process
  arguments as arrays; never build shell command strings from user input.
- **Keep the security model.** Every request passes the loopback `Host` and `Origin` checks in
  `src/server/security.ts`; the default bind stays `127.0.0.1`. Validate every path, id and prompt
  that reaches the filesystem or a spawned process.
- **Write only where the user asked.** Orchboard's own state lives in `~/.orchboard`
  (`ORCHBOARD_DATA_DIR`). Inside a user's project, only `CLAUDE.md` and `AGENTS.md`, and only on an
  explicit save.
- **No HTML from strings.** Build DOM with the `el()` helper in `src/web/dom.ts`, so agent output
  can never inject markup.
- **Tests next to the code.** `*.test.ts` with `node:test`; keep logic in pure functions where it
  can be tested without a browser or a real CLI.

## Checks

```sh
npm test            # unit tests
npm run lint        # eslint
npm run typecheck   # server and browser projects
npm run format      # prettier
```

Add or update tests with any behaviour change, and run all four before finishing.

## Trying things out

- `npm run demo` serves sample data; no agent is started and no real file is touched. Use it for UI
  work and screenshots.
- To test against real agents without touching the user's board or data, use a spare port and data
  directory: `ORCHBOARD_PORT=4400 ORCHBOARD_DATA_DIR=/tmp/orchboard-dev npm run dev`.
- Never restart or stop a dashboard the user is already running.
