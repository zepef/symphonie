import * as os from 'os'
import * as path from 'path'
import { ResolvedConfig, SymphonyError, WorkflowDefinition } from '../types'

// Resolve $VAR references in string values from environment
function resolveEnvVar(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  if (value.startsWith('$')) {
    const varName = value.slice(1)
    const resolved = process.env[varName]
    if (!resolved || resolved.trim() === '') return undefined
    return resolved
  }
  return value
}

function expandTilde(p: string): string {
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(1))
  }
  return p
}

function coerceInt(value: unknown, defaultVal: number): number {
  if (value === undefined || value === null) return defaultVal
  const n = typeof value === 'string' ? parseInt(value, 10) : Number(value)
  return isNaN(n) ? defaultVal : n
}

export function resolveConfig(def: WorkflowDefinition): ResolvedConfig {
  const c = def.config

  const tracker_kind = (c.tracker?.kind ?? 'linear').toLowerCase()
  if (tracker_kind !== 'linear') {
    throw new SymphonyError(
      'unsupported_tracker_kind',
      `Unsupported tracker.kind: ${tracker_kind}. Only 'linear' is supported.`,
    )
  }

  const tracker_api_key = resolveEnvVar(c.tracker?.api_key)
  if (!tracker_api_key) {
    throw new SymphonyError(
      'missing_tracker_api_key',
      'tracker.api_key is missing or empty (env var resolved to empty)',
    )
  }

  const tracker_project_slug = resolveEnvVar(c.tracker?.project_slug)
  if (!tracker_project_slug) {
    throw new SymphonyError(
      'missing_tracker_project_slug',
      'tracker.project_slug is missing or empty',
    )
  }

  const dispatch_states = c.tracker?.dispatch_states ?? ['Todo', 'In Progress']
  const terminal_states = c.tracker?.terminal_states ?? ['Done', 'Cancelled', 'Duplicate']

  const max_concurrent_agents = coerceInt(
    c.concurrency?.max_workers ?? c.concurrency?.max_concurrent_agents,
    3,
  )

  const by_state_raw = c.concurrency?.max_concurrent_agents_by_state ?? {}
  const max_concurrent_agents_by_state: Record<string, number> = {}
  for (const [k, v] of Object.entries(by_state_raw)) {
    max_concurrent_agents_by_state[k.trim().toLowerCase()] = coerceInt(v, 0)
  }

  const workspace_root_raw = c.workspace?.root ?? '~/.symphony/workspaces'
  const workspace_root = path.resolve(expandTilde(workspace_root_raw))

  const hooks = c.workspace?.hooks ?? {}

  const codex_command = c.codex?.command ?? 'codex'
  const stall_timeout_ms = coerceInt(c.codex?.stall_timeout_ms, 300_000)
  const read_timeout_ms = coerceInt(c.codex?.read_timeout_ms, 30_000)
  const turn_timeout_ms = coerceInt(c.codex?.turn_timeout_ms, 600_000)
  const max_turns = coerceInt(c.codex?.max_turns, 10)

  const poll_interval_ms = coerceInt(c.polling?.interval_ms, 60_000)
  const max_retries = coerceInt(c.retry?.max_retries, 3)
  const max_retry_backoff_ms = coerceInt(c.retry?.max_retry_backoff_ms, 600_000)

  const server_port = c.server?.port !== undefined
    ? coerceInt(c.server.port, 0) || undefined
    : undefined

  return {
    tracker_kind,
    tracker_api_key,
    tracker_project_slug,
    tracker_dispatch_states: dispatch_states,
    tracker_terminal_states: terminal_states,
    max_concurrent_agents,
    max_concurrent_agents_by_state,
    workspace_root,
    hooks_after_create: hooks.after_create,
    hooks_before_run: hooks.before_run,
    hooks_after_run: hooks.after_run,
    hooks_before_remove: hooks.before_remove,
    codex_command,
    stall_timeout_ms,
    read_timeout_ms,
    turn_timeout_ms,
    max_turns,
    poll_interval_ms,
    max_retries,
    max_retry_backoff_ms,
    server_port,
    prompt_template: def.prompt_template,
  }
}
