import { Issue, ResolvedConfig } from '../types'
import { OrchestratorState } from './state'

const log = (...args: unknown[]) => console.log('[symphony:retry]', ...args)

export function calcBackoffMs(attempt: number, maxBackoffMs: number): number {
  if (attempt === 1) return 1000 // continuation retry
  return Math.min(10_000 * Math.pow(2, attempt - 1), maxBackoffMs)
}

export function scheduleRetry(
  issueId: string,
  identifier: string,
  attempt: number,
  error: string,
  state: OrchestratorState,
  config: ResolvedConfig,
  onFired: (issueId: string) => void,
) {
  // Cancel any existing retry timer
  state.cancelRetry(issueId)

  const delayMs = calcBackoffMs(attempt, config.max_retry_backoff_ms)
  const retry_at = new Date(Date.now() + delayMs)

  log(`Scheduling retry for ${identifier} in ${delayMs}ms (attempt ${attempt})`)

  const timer_handle = setTimeout(() => {
    state.retryAttempts.delete(issueId)
    onFired(issueId)
  }, delayMs)

  state.queueRetry(issueId, {
    issue_id: issueId,
    identifier,
    attempt,
    error,
    retry_at,
    timer_handle,
  })
}

export function cancelRetry(issueId: string, state: OrchestratorState) {
  state.cancelRetry(issueId)
}

export function handleRetryFired(
  issueId: string,
  cachedIssue: Issue,
  state: OrchestratorState,
  config: ResolvedConfig,
  dispatch: (issue: Issue, attempt: number) => void,
) {
  // Check if there are still available slots
  if (state.running.size < config.max_concurrent_agents) {
    log(`Retry fired for ${cachedIssue.identifier}, dispatching`)
    const retryEntry = state.retryAttempts.get(issueId)
    const attempt = retryEntry ? retryEntry.attempt : 1
    state.retryAttempts.delete(issueId)
    dispatch(cachedIssue, attempt)
  } else {
    // Re-queue with "no available slots" reason
    const retryEntry = state.retryAttempts.get(issueId)
    const attempt = retryEntry ? retryEntry.attempt : 1
    log(`Retry fired for ${cachedIssue.identifier} but no slots available, re-queuing`)
    scheduleRetry(
      issueId,
      cachedIssue.identifier,
      attempt,
      'No available orchestrator slots',
      state,
      config,
      (id) => handleRetryFired(id, cachedIssue, state, config, dispatch),
    )
  }
}
