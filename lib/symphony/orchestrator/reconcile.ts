import { ResolvedConfig, SymphonyError } from '../types'
import { fetchIssueStatesByIds } from '../tracker/linear'
import { OrchestratorState } from './state'

const log = (...args: unknown[]) => console.log('[symphony:reconcile]', ...args)

export interface ReconcileActions {
  killWorker: (issueId: string, reason: string, cleanup: boolean) => void
  queueRetry: (issueId: string, reason: string) => void
}

export async function reconcile(
  state: OrchestratorState,
  config: ResolvedConfig,
  actions: ReconcileActions,
): Promise<void> {
  const now = Date.now()

  // ── Part A: Stall detection ──────────────────────────────────────────────
  if (config.stall_timeout_ms > 0) {
    for (const [issueId, entry] of state.running) {
      const lastActivity = entry.session.last_codex_timestamp ?? entry.started_at
      const elapsed = now - lastActivity.getTime()
      if (elapsed > config.stall_timeout_ms) {
        log(
          `Stall detected for ${entry.issue.identifier}: ${elapsed}ms since last activity`,
        )
        actions.killWorker(issueId, `Stall timeout (${elapsed}ms)`, false)
        actions.queueRetry(issueId, 'stall_timeout')
      }
    }
  }

  // ── Part B: Tracker state refresh ────────────────────────────────────────
  const runningIds = [...state.running.keys()]
  if (runningIds.length === 0) return

  let stateMap: Map<string, string>
  try {
    stateMap = await fetchIssueStatesByIds(config, runningIds)
  } catch (err) {
    log(`State refresh failed (keeping workers running): ${(err as SymphonyError).message}`)
    return
  }

  for (const [issueId, entry] of state.running) {
    const currentState = stateMap.get(issueId)
    if (currentState === undefined) {
      // Issue no longer accessible — kill without cleanup
      log(`Issue ${entry.issue.identifier} not found in tracker, killing worker`)
      actions.killWorker(issueId, 'Issue not found in tracker', false)
      continue
    }

    const terminalStates = config.tracker_terminal_states.map((s) =>
      s.trim().toLowerCase(),
    )
    const dispatchStates = config.tracker_dispatch_states.map((s) =>
      s.trim().toLowerCase(),
    )
    const stateNorm = currentState.trim().toLowerCase()

    if (terminalStates.includes(stateNorm)) {
      log(
        `Issue ${entry.issue.identifier} moved to terminal state ${currentState}, stopping worker`,
      )
      actions.killWorker(issueId, `Moved to terminal state: ${currentState}`, true)
    } else if (dispatchStates.includes(stateNorm)) {
      // Still active — update state on the entry
      entry.issue.state = currentState
    } else {
      // Neither active nor terminal — kill without cleanup
      log(
        `Issue ${entry.issue.identifier} in unknown state ${currentState}, killing worker`,
      )
      actions.killWorker(issueId, `Unexpected state: ${currentState}`, false)
    }
  }
}
