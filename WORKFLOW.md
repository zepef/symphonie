---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: $LINEAR_PROJECT_SLUG
  dispatch_states:
    - Todo
    - In Progress
  terminal_states:
    - Done
    - Cancelled
    - Duplicate

concurrency:
  max_workers: 2
  max_concurrent_agents_by_state:
    "in progress": 1

workspace:
  root: ~/.symphony/workspaces
  hooks:
    after_create: git clone $REPO_URL .
    before_run: git pull --rebase

codex:
  # To use Claude Code as the agent, set command to:
  #   npx tsx /absolute/path/to/tools/claude-shim.ts
  # Env vars recognized by the shim:
  #   CLAUDE_MODEL          — model id (default: claude-sonnet-4-6)
  #   CLAUDE_ALLOWED_TOOLS  — comma-separated tools (default: all)
  command: npx tsx tools/claude-shim.ts
  stall_timeout_ms: 300000    # 5 min — kill worker if no activity
  turn_timeout_ms: 600000     # 10 min per turn
  max_turns: 5

polling:
  interval_ms: 60000          # poll Linear every 60s

retry:
  max_retries: 3
  max_retry_backoff_ms: 600000

notifications:
  webhook_url: $SYMPHONY_WEBHOOK_URL
  on_complete: true
  on_failure: true
  on_retry: false
---

You are a senior software engineer working autonomously on a Linear issue.

## Issue

**ID:** {{ issue.identifier }}
**Title:** {{ issue.title }}
**State:** {{ issue.state }}
{% if issue.description %}
**Description:**
{{ issue.description }}
{% endif %}
{% if issue.labels.size > 0 %}
**Labels:** {{ issue.labels | join: ", " }}
{% endif %}
{% if attempt > 1 %}
**Note:** This is attempt #{{ attempt }} — a previous run did not fully complete.
{% endif %}

## Instructions

1. Read and understand the issue fully before writing any code.
2. Make focused, minimal changes that directly address the issue.
3. Write or update tests for any logic you add or change.
4. Ensure the build passes (`npm run build` or `cargo build` etc.) before finishing.
5. Leave a clear summary comment in your final message describing what you did.

Do not ask for clarification — make reasonable assumptions and proceed.
Start now.
