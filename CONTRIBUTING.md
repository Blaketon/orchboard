# Contributing to Orchboard

Thanks for helping out. Bug reports, ideas and pull requests are all welcome.

## Getting set up

```sh
npm install
npm run demo   # sample data on http://localhost:4317, no real agents
```

For work against your real agents, use `npm run dev` and a spare port:

```sh
ORCHBOARD_PORT=4400 ORCHBOARD_DATA_DIR=/tmp/orchboard-dev npm run dev
```

That keeps your everyday board and its data untouched.

## Before opening a pull request

```sh
npm test
npm run lint
npm run typecheck
npm run format
```

The same checks run in CI on Linux, macOS and Windows with Node 22 and 24.

## House rules

- **No runtime dependencies, no bundler.** Server code uses Node built-ins; browser code uses plain
  DOM APIs and is compiled by `tsc`. Development dependencies are fine.
- **Cross-platform.** Windows, macOS and Linux all matter. Branch on `process.platform` where
  needed and pass arguments as arrays instead of building shell strings.
- **Security first.** Every request goes through the loopback `Host` and `Origin` checks in
  `src/server/security.ts`. Don't bypass them or change the default loopback bind. Validate
  anything that reaches the filesystem or a spawned process.
- **Only write where the user asked.** Orchboard's own data lives in `~/.orchboard`; inside a
  user's project, only files they explicitly edit (`CLAUDE.md`, `AGENTS.md`).
- **Never build HTML from strings.** Use the `el()` helper so agent output can't inject markup.
- **Test what you add.** Pure logic gets unit tests (`*.test.ts` next to the code, `node:test`).

## Project layout

```
src/server   HTTP server, agent CLIs, Codex app-server client, stores
src/web      Browser app, compiled to dist/web
src/shared   Types and helpers used by both
public       index.html, styles, icons
```

## Commit messages

Short Conventional Commit subjects, e.g. `feat: add a skills browser` or
`fix: keep CRLF line endings when saving project docs`.

## Reporting bugs

Include your OS, Node version, and the versions of Claude Code or Codex you use
(`claude --version`, `codex --version`). If the board looks wrong, a screenshot of the browser and
the terminal output of Orchboard helps. Please don't paste real transcript content you would rather
keep private.
