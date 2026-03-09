import { Issue, ResolvedConfig } from '../types'
import { OrchestratorState } from './state'

export function isEligible(
  issue: Issue,
  state: OrchestratorState,
  config: ResolvedConfig,
): boolean {
  // Must have required fields
  if (!issue.id || !issue.identifier || !issue.title) return false

  // Must be in a dispatch state
  const dispatchStates = config.tracker_dispatch_states.map((s) =>
    s.trim().toLowerCase(),
  )
  if (!dispatchStates.includes(issue.state.trim().toLowerCase())) return false

  // Not already claimed or running
  if (state.claimed.has(issue.id)) return false
  if (state.running.has(issue.id)) return false

  // Not waiting in retry queue
  if (state.retryAttempts.has(issue.id)) return false

  // Global concurrency check
  if (state.running.size >= config.max_concurrent_agents) return false

  // Per-state concurrency check
  const stateKey = issue.state.trim().toLowerCase()
  const stateLimit = config.max_concurrent_agents_by_state[stateKey]
  if (stateLimit !== undefined) {
    const runningInState = [...state.running.values()].filter(
      (e) => e.issue.state.trim().toLowerCase() === stateKey,
    ).length
    if (runningInState >= stateLimit) return false
  }

  // Blocker rule: Todo issues with any blocked_by entries are skipped.
  // TODO: Full resolution requires querying tracker state for all blocked_by issues
  // to verify they are in terminal states before allowing dispatch.
  if (issue.state.trim().toLowerCase() === 'todo' && issue.blocked_by.length > 0) {
    return false
  }

  return true
}

export function sortCandidates(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    // Priority ascending (null last)
    if (a.priority !== b.priority) {
      if (a.priority === null) return 1
      if (b.priority === null) return -1
      return a.priority - b.priority
    }
    // Oldest first by created_at
    const aTime = a.created_at?.getTime() ?? Infinity
    const bTime = b.created_at?.getTime() ?? Infinity
    if (aTime !== bTime) return aTime - bTime
    // Lexicographic by identifier
    return a.identifier.localeCompare(b.identifier)
  })
}

export function availableSlots(
  state: OrchestratorState,
  config: ResolvedConfig,
): number {
  return Math.max(config.max_concurrent_agents - state.running.size, 0)
}

export function perStateSlots(
  stateName: string,
  state: OrchestratorState,
  config: ResolvedConfig,
): number {
  const key = stateName.trim().toLowerCase()
  const limit = config.max_concurrent_agents_by_state[key]
  if (limit === undefined) return Infinity
  const inState = [...state.running.values()].filter(
    (e) => e.issue.state.trim().toLowerCase() === key,
  ).length
  return Math.max(limit - inState, 0)
}
