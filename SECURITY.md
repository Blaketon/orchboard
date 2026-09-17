# Security policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub's private vulnerability reporting](https://github.com/Blaketon/orchboard/security/advisories/new)
rather than in a public issue.

Include what you did, what happened, and what an attacker could achieve. A proof of concept helps.
You can expect a first reply within a few days, and credit in the release notes once a fix ships,
unless you prefer to stay anonymous.

## Supported versions

Fixes go into the latest release. There are no long-term support branches yet.

## What Orchboard assumes

Orchboard starts coding agents and writes files on your machine, so its whole security model is
"only the person at this computer can reach it":

- It binds to `127.0.0.1` by default.
- Requests are accepted only with a loopback `Host` header and, when present, a matching `Origin`,
  which blocks DNS rebinding and cross-site requests from other pages in your browser.
- API requests with bodies must use `application/json` (or `image/*` for pasted images), so an
  HTML form on another site cannot submit to them.
- The page is served with a Content Security Policy that allows no inline or third-party scripts.
- Only `CLAUDE.md` and `AGENTS.md`, in projects already on the board, can be written inside your
  projects. Everything else Orchboard stores goes to `~/.orchboard`.

Reports that depend on the operator overriding these defaults — for example setting
`ORCHBOARD_HOST=0.0.0.0` and exposing the dashboard to a network without authentication — are
documented behaviour rather than vulnerabilities. The same goes for anything an agent does with the
permissions you granted it.
