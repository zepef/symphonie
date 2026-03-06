# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start dev server at http://localhost:3000
npm run build     # Production build
npm run lint      # Run ESLint
```

No test runner is configured yet.

## Project Purpose

**Symphonie** is the frontend UI for the Symphony Service — a long-running daemon that orchestrates coding agents (e.g. Claude/Codex) against issues from Linear. The full service specification is in `SPEC.md`.

The core service concept:
- Polls Linear for issues matching configured states
- Creates isolated per-issue workspaces (`<workspace.root>/<sanitized_issue_id>`)
- Runs a coding agent subprocess per issue using a JSON-RPC-like stdio protocol
- Reads agent behavior from a `WORKFLOW.md` file in the target repo (front matter = config, body = prompt)

## Service Architecture (from SPEC.md)

Six layers the implementation must cover:

1. **Workflow/Config Layer** — Parses `WORKFLOW.md` front matter into typed runtime settings; hot-reloads on file change
2. **Coordination Layer** — Polling loop, concurrency limits, retries, reconciliation; single-authority state machine
3. **Execution Layer** — Workspace filesystem lifecycle + coding-agent stdio subprocess protocol
4. **Integration Layer** — Linear GraphQL adapter (fetch issues by state, pagination, field normalization)
5. **Observability Layer** — Structured logs; optional HTTP status surface
6. **Configuration Layer** — Typed getters, env var indirection (e.g. `$LINEAR_API_KEY`), defaults

### Orchestration State Machine

Internal claim states (distinct from Linear tracker states):
- `Unclaimed` → `Claimed` → `Running` → `Completed` / `Failed` / `RetryQueued`

Reconciliation runs on every tick before dispatch. No durable DB needed — state is recovered from tracker + filesystem on restart.

### Key Config Fields (WORKFLOW.md front matter)

- `tracker.kind: linear`, `tracker.api_key`, `tracker.project_slug`
- `tracker.dispatch_states[]` — Linear states eligible for dispatch
- `concurrency.max_workers` — max parallel agent runs
- `workspace.root` — base directory for per-issue workspaces
- `codex.stall_timeout_ms` (default 300000) — kills stalled agent workers
- `polling.interval_ms` — poll cadence
- `server.port` (optional) — enables HTTP status endpoint

## Tech Stack

- **Next.js 16** (App Router), **React 19**, **TypeScript**
- **Tailwind CSS v4** (via `@tailwindcss/postcss`)
- App entry: `app/page.tsx`, layout: `app/layout.tsx`, globals: `app/globals.css`
