# Changelog

All notable changes to Orchboard are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Live board of Claude Code background agents and Codex tasks, grouped into Awaiting input, Working
  and Completed, with project filter, search and a list view.
- Task detail: transcript with Markdown, tool calls and results, token usage, context window and
  Claude's recorded cost, plus reply, stop, hide, delete and "open in terminal".
- Starting tasks from the board for either agent, with permission modes and pasted images.
- Per-project queue columns with drag and drop, and starting a queued task on demand.
- Codex support through `codex app-server`: turns, replies, approval requests (command, file
  change, permissions), transcripts from Codex's own session files, and `codex resume`.
- Notifications for completed and blocked agents: toasts, a chime and system notifications, plus
  Claude and Codex plan usage in the sidebar.
- Docs view for editing a project's `CLAUDE.md` and `AGENTS.md`, with conflict detection.
- Skills browser for `~/.claude/skills` and `~/.codex/skills`.
- Settings for theme, notifications, sound and usage alerts.
- `orchboard` command with `--port`, `--host`, `--demo`, `--open`, `--help` and `--version`.
