// ─── Workflow / Config ───────────────────────────────────────────────────────

export interface WorkflowFrontMatter {
  tracker: {
    kind: string
    api_key?: string
    project_slug?: string
    dispatch_states?: string[]
    terminal_states?: string[]
  }
  concurrency?: {
    max_workers?: number
    max_concurrent_agents?: number
    max_concurrent_agents_by_state?: Record<string, number>
  }
  workspace?: {
    root?: string
    hooks?: {
      after_create?: string
      before_run?: string
      after_run?: string
      before_remove?: string
    }
  }
  codex?: {
    command?: string
    stall_timeout_ms?: number
    read_timeout_ms?: number
    turn_timeout_ms?: number
    max_turns?: number
  }
  polling?: {
    interval_ms?: number
  }
  retry?: {
    max_retries?: number
    max_retry_backoff_ms?: number
  }
  server?: {
    port?: number
  }
  notifications?: {
    webhook_url?: string
    on_complete?: boolean
    on_failure?: boolean
    on_retry?: boolean
  }
}

export interface WorkflowDefinition {
  config: Partial<WorkflowFrontMatter>
  prompt_template: string
}

// Resolved / typed config (all defaults applied)
export interface ResolvedConfig {
  tracker_kind: string
  tracker_api_key: string
  tracker_project_slug: string
  tracker_dispatch_states: string[]
  tracker_terminal_states: string[]
  max_concurrent_agents: number
  max_concurrent_agents_by_state: Record<string, number>
  workspace_root: string
  hooks_after_create?: string
  hooks_before_run?: string
  hooks_after_run?: string
  hooks_before_remove?: string
  codex_command: string
  stall_timeout_ms: number
  read_timeout_ms: number
  turn_timeout_ms: number
  max_turns: number
  poll_interval_ms: number
  max_retries: number
  max_retry_backoff_ms: number
  server_port?: number
  notifications_webhook_url?: string
  notifications_on_complete: boolean
  notifications_on_failure: boolean
  notifications_on_retry: boolean
  prompt_template: string
}

// ─── Linear / Tracker ────────────────────────────────────────────────────────

export interface Issue {
  id: string
  identifier: string
  title: string
  description: string | null
  state: string        // current Linear state name
  priority: number | null
  labels: string[]
  blocked_by: string[] // list of issue identifiers blocking this one
  created_at: Date | null
  updated_at: Date | null
  url: string
}

// ─── Agent Protocol ──────────────────────────────────────────────────────────

export type RunAttemptPhase =
  | 'prepare_workspace'
  | 'before_run_hook'
  | 'build_prompt'
  | 'launch_agent'
  | 'stream_turns'
  | 'after_run_hook'
  | 'exit'

export interface AgentEvent {
  type:
    | 'session_started'
    | 'startup_failed'
    | 'turn_completed'
    | 'turn_failed'
    | 'turn_cancelled'
    | 'turn_ended_with_error'
    | 'turn_input_required'
    | 'approval_auto_approved'
    | 'unsupported_tool_call'
    | 'notification'
    | 'other_message'
    | 'malformed'
  session_id?: string
  thread_id?: string
  turn_id?: string
  message?: string
  tool_name?: string
  data?: unknown
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
}

// ─── Orchestrator State ───────────────────────────────────────────────────────

export interface LiveSession {
  session_id: string | null
  thread_id: string | null
  turn_id: string | null
  codex_app_server_pid: number | null
  last_codex_event: string | null
  last_codex_timestamp: Date | null
  last_codex_message: string
  codex_input_tokens: number
  codex_output_tokens: number
  codex_total_tokens: number
  last_reported_input_tokens: number
  last_reported_output_tokens: number
  last_reported_total_tokens: number
  turn_count: number
}

export interface RunningEntry {
  issue: Issue
  workspace_path: string
  started_at: Date
  attempt: number
  abort: AbortController
  session: LiveSession
}

export interface RetryEntry {
  issue_id: string
  identifier: string
  attempt: number
  error: string
  retry_at: Date
  timer_handle: ReturnType<typeof setTimeout>
}

export interface TokenTotals {
  input_tokens: number
  output_tokens: number
  total_tokens: number
}

// ─── API Response shapes ──────────────────────────────────────────────────────

export interface RunningEntrySummary {
  identifier: string
  title: string
  state: string
  workspace_path: string
  started_at: string
  attempt: number
  session: {
    session_id: string | null
    thread_id: string | null
    turn_id: string | null
    pid: number | null
    last_event: string | null
    last_timestamp: string | null
    last_message: string
    input_tokens: number
    output_tokens: number
    total_tokens: number
    turn_count: number
  }
}

export interface RetryEntrySummary {
  identifier: string
  attempt: number
  error: string
  retry_at: string
}

export interface StateResponse {
  status: 'running' | 'stopped'
  workflow_path: string | null
  running: RunningEntrySummary[]
  retrying: RetryEntrySummary[]
  completed_count: number
  token_totals: TokenTotals
  config_valid: boolean
  config_error: string | null
  last_poll_at: string | null
  uptime_ms: number
}

export interface IssueDetail {
  identifier: string
  title: string
  state: string
  running: RunningEntrySummary | null
  retrying: RetryEntrySummary | null
  completed: boolean
  history: IssueHistoryEntry[]
}

export interface IssueHistoryEntry {
  attempt: number
  started_at: string
  ended_at: string
  outcome: 'completed' | 'failed' | 'retried'
  error?: string
  tokens?: TokenTotals
  after_run_hook_error?: string
}

export interface RefreshResponse {
  queued: boolean
  message: string
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export type SymphonyErrorCode =
  | 'missing_workflow_file'
  | 'workflow_parse_error'
  | 'workflow_front_matter_not_a_map'
  | 'unsupported_tracker_kind'
  | 'missing_tracker_api_key'
  | 'missing_tracker_project_slug'
  | 'linear_api_request'
  | 'linear_api_status'
  | 'linear_graphql_errors'
  | 'linear_unknown_payload'
  | 'linear_missing_end_cursor'
  | 'issue_not_found'
  | 'workspace_path_escape'
  | 'hook_fatal_failure'
  | 'prompt_render_error'
  | 'agent_startup_failed'
  | 'agent_stall_timeout'
  | 'agent_turn_timeout'
  | 'agent_input_required'
  | 'config_validation_error'

export class SymphonyError extends Error {
  constructor(
    public readonly code: SymphonyErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'SymphonyError'
  }
}
