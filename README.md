<p align="center">
  <img src="https://raw.githubusercontent.com/Blaketon/orchboard/main/logo.png" alt="Orchboard logo" width="160">
</p>

<h1 align="center">Orchboard</h1>

<p align="center">
  An agentic project board for Claude Code and Codex: plan, queue, and track your AI coding agents across every project.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://discord.gg/JRHBcwzUag"><img src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white" alt="Join the Discord"></a>
  <a href="#requirements"><img src="https://img.shields.io/badge/node-%E2%89%A522.18-5FA04E?logo=node.js&logoColor=white" alt="Node 22.18 or newer"></a>
  <a href="#development"><img src="https://img.shields.io/badge/dependencies-0-brightgreen" alt="Zero runtime dependencies"></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Blaketon/orchboard/main/docs/demo.gif" alt="Orchboard: opening a task, editing project docs, and starting a new one" width="900">
</p>

Run several coding agents at once and you lose track of them: which one is waiting for you, which
one is still working, what each of them actually did. Orchboard is a local dashboard that shows
every Claude Code and Codex task on one board, tells you the moment one needs input, and lets you
reply, approve, or start the next task without hunting through terminal windows.

It runs on your machine, talks to the `claude` and `codex` CLIs you already have, and keeps its own
data in a single folder. No account, no telemetry, no cloud.

## Try it

```sh
npx orchboard --demo --open
```

Demo mode fills the board with sample projects and agents, so you can click around before pointing
it at your own work. It never starts an agent or touches a real file.

## Install

```sh
npx orchboard          # run it
npx orchboard --open   # run it and open the browser
```

Or install it globally:

```sh
npm install -g orchboard
orchboard
```

Then open <http://localhost:4317>.

### Requirements

- **Node.js 22.18 or newer**
- **[Claude Code](https://claude.com/claude-code)** for Claude tasks: a recent version, with
  `claude agents --json --all` available
- **[Codex CLI](https://developers.openai.com/codex/cli)** for Codex tasks
- Either one is enough. Orchboard shows what it can and says what is missing.

## What you can do

| ![The board, with agents, queue columns and plan usage](https://raw.githubusercontent.com/Blaketon/orchboard/main/docs/screenshots/board.png) | ![Task detail with a Codex approval request](https://raw.githubusercontent.com/Blaketon/orchboard/main/docs/screenshots/detail.png) | ![The Docs view editing CLAUDE.md](https://raw.githubusercontent.com/Blaketon/orchboard/main/docs/screenshots/docs.png) |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Agents, queue columns and plan usage on one board.                                                                                            | Follow a task's conversation, tokens, cost and context — and answer Codex's approval requests.                                      | Edit each project's `CLAUDE.md` and `AGENTS.md` in the browser.                                                         |

- **One board for both agents.** Claude Code background agents and Codex tasks side by side,
  grouped into Awaiting input, Working and Completed, updated live.
- **Know when you are the blocker.** Toast, sound and system notifications when an agent finishes
  or needs you, with plan usage for both tools in the sidebar.
- **Start work from the board.** Pick the project, prompt, agent and permission mode; paste
  screenshots straight into the prompt.
- **Queue what comes next.** Custom columns per project, drag and drop, start a queued task when
  you are ready.
- **Answer Codex approvals.** Approve a command once or for the whole session, or decline it,
  without switching to a terminal.
- **Read the whole conversation.** Transcripts with Markdown, tool calls and results, token usage,
  context window and Claude's recorded cost.
- **Keep instructions tidy.** A Docs view for `CLAUDE.md` and `AGENTS.md`, with a warning instead
  of a silent overwrite when an agent edits the same file.
- **See your skills.** Everything installed under `~/.claude/skills` and `~/.codex/skills`,
  searchable.
- **Jump into a terminal** for any task (`claude attach`, `codex resume`) when you want the real
  thing.

## Configuration

Orchboard needs no configuration. These environment variables are available anyway:

| Variable             | Default        | What it does                                   |
| -------------------- | -------------- | ---------------------------------------------- |
| `ORCHBOARD_PORT`     | `4317`         | Port to listen on                              |
| `ORCHBOARD_HOST`     | `127.0.0.1`    | Address to bind                                |
| `ORCHBOARD_DATA_DIR` | `~/.orchboard` | Where projects, the queue and attachments live |
| `CLAUDE_CONFIG_DIR`  | `~/.claude`    | Claude Code's config directory                 |
| `CODEX_HOME`         | `~/.codex`     | Codex's config directory                       |

Command line options: `--port`, `--host`, `--demo`, `--open`, `--help`, `--version`.

## Security and privacy

Orchboard can start agents and write files, so it is built to be reachable only by you:

- It binds to `127.0.0.1`. Nothing outside your machine can reach it unless you change
  `ORCHBOARD_HOST`.
- Every request must come from a loopback `Host` with a matching `Origin`, which blocks DNS
  rebinding and cross-site requests from pages you have open.
- Writes are limited to what you asked for: a project's `CLAUDE.md` or `AGENTS.md`, and Orchboard's
  own data folder.
- Transcripts and usage are read from the files Claude Code and Codex already write locally.
  Nothing is sent anywhere, and there is no telemetry.

Setting `ORCHBOARD_HOST` to a public address exposes agent control to anyone who can reach it.
Don't, unless you have put your own authentication in front of it.

Found a vulnerability? See [SECURITY.md](SECURITY.md).

## Troubleshooting

**"Claude Code not found"** — install Claude Code and check that `claude` runs in the same terminal.
On Windows, Orchboard also looks for `claude.cmd`.

**No agents on the board** — Orchboard lists background agents (`claude --bg`). An agent you
started in a terminal without `--bg` is an interactive session and is not shown.

**A Codex task says Orchboard stopped while it was running** — Codex turns run as child processes,
so they end when Orchboard does. Reply to the task and it continues where it left off.

**Port already in use** — run `orchboard --port 4400`, or set `ORCHBOARD_PORT`.

## Development

```sh
git clone https://github.com/Blaketon/orchboard.git
cd orchboard
npm install
npm run dev        # rebuilds the browser code and restarts on change
npm run demo       # sample data, no real agents
npm test           # unit tests
npm run lint && npm run typecheck
```

TypeScript throughout, no runtime dependencies, no bundler: the server runs `.ts` files directly
through Node's type stripping, and the browser code is compiled by `tsc`.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Community

Questions, ideas, or feedback? [Join the Discord](https://discord.gg/JRHBcwzUag).

## Support

Orchboard is free and MIT licensed. If it saves you time, you can
[buy me a coffee on Ko-fi](https://ko-fi.com/blaketon).

## License

[MIT](LICENSE) © Blaketon

Orchboard is an independent project. It is not affiliated with, endorsed by, or sponsored by
Anthropic or OpenAI. "Claude" and "Claude Code" are trademarks of Anthropic; "Codex" and "ChatGPT"
are trademarks of OpenAI.
