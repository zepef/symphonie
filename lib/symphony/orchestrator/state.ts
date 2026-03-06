import {
  IssueHistoryEntry,
  LiveSession,
  RetryEntry,
  RunningEntry,
  TokenTotals,
} from '../types'

export class OrchestratorState {
  running = new Map<string, RunningEntry>()
  retryAttempts = new Map<string, RetryEntry>()
  claimed = new Set<string>()
  completed = new Set<string>()
  issueHistory = new Map<string, IssueHistoryEntry[]>()
  startedAt = new Date()
  lastPollAt: Date | null = null
  configValid = false
  configError: string | null = null
  workflowPath: string | null = null
  running_status: 'running' | 'stopped' = 'stopped'

  tokenTotals: TokenTotals = {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  }

  makeLiveSession(pid: number | null = null): LiveSession {
    return {
      session_id: null,
      thread_id: null,
      turn_id: null,
      codex_app_server_pid: pid,
      last_codex_event: null,
      last_codex_timestamp: null,
      last_codex_message: '',
      codex_input_tokens: 0,
      codex_output_tokens: 0,
      codex_total_tokens: 0,
      last_reported_input_tokens: 0,
      last_reported_output_tokens: 0,
      last_reported_total_tokens: 0,
      turn_count: 0,
    }
  }

  claim(issueId: string) {
    this.claimed.add(issueId)
  }

  unclaim(issueId: string) {
    this.claimed.delete(issueId)
    this.running.delete(issueId)
  }

  setRunning(issueId: string, entry: RunningEntry) {
    this.running.set(issueId, entry)
  }

  removeRunning(issueId: string) {
    this.running.delete(issueId)
  }

  queueRetry(issueId: string, entry: RetryEntry) {
    this.retryAttempts.set(issueId, entry)
  }

  cancelRetry(issueId: string) {
    const entry = this.retryAttempts.get(issueId)
    if (entry) {
      clearTimeout(entry.timer_handle)
      this.retryAttempts.delete(issueId)
    }
  }

  recordHistory(issueId: string, entry: IssueHistoryEntry) {
    const existing = this.issueHistory.get(issueId) ?? []
    existing.push(entry)
    this.issueHistory.set(issueId, existing)
  }

  addTokens(input: number, output: number, total: number) {
    this.tokenTotals.input_tokens += input
    this.tokenTotals.output_tokens += output
    this.tokenTotals.total_tokens += total
  }

  getRunningForIssue(issueId: string): RunningEntry | undefined {
    return this.running.get(issueId)
  }

  getRetryForIssue(issueId: string): RetryEntry | undefined {
    return this.retryAttempts.get(issueId)
  }
}
