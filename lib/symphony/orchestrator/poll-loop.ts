import { Issue, ResolvedConfig } from '../types'
import { fetchCandidateIssues } from '../tracker/linear'
import { OrchestratorState } from './state'
import { reconcile } from './reconcile'
import { sortCandidates, availableSlots, isEligible } from './dispatch'

const log = (...args: unknown[]) => console.log('[symphony:poll]', ...args)

export interface PollCallbacks {
  killWorker: (issueId: string, reason: string, cleanup: boolean) => void
  queueRetryForIssue: (issueId: string, reason: string) => void
  dispatchIssue: (issue: Issue, attempt: number) => void
  onError?: (error: string) => void
}

export async function tick(
  state: OrchestratorState,
  config: ResolvedConfig,
  callbacks: PollCallbacks,
): Promise<void> {
  state.lastPollAt = new Date()

  // ── Reconcile: stall detection + tracker state refresh ───────────────────
  try {
    await reconcile(state, config, {
      killWorker: callbacks.killWorker,
      queueRetry: callbacks.queueRetryForIssue,
    })
  } catch (err) {
    log(`Reconcile error: ${(err as Error).message}`)
  }

  // ── Dispatch preflight validation ────────────────────────────────────────
  if (!state.configValid) {
    log('Config invalid, skipping dispatch')
    callbacks.onError?.('Config is invalid, dispatch skipped')
    return
  }

  // ── Fetch candidate issues ────────────────────────────────────────────────
  let candidates: Issue[]
  try {
    candidates = await fetchCandidateIssues(config)
    log(`Fetched ${candidates.length} candidate issues`)
  } catch (err) {
    log(`Failed to fetch candidates: ${(err as Error).message}`)
    callbacks.onError?.(`Fetch failed: ${(err as Error).message}`)
    return
  }

  // ── Sort candidates ───────────────────────────────────────────────────────
  const sorted = sortCandidates(candidates)

  // ── Dispatch loop ─────────────────────────────────────────────────────────
  let slots = availableSlots(state, config)

  // Track per-state dispatches within this tick to enforce per-state concurrency
  const perStateDispatchedThisTick = new Map<string, number>()

  for (const issue of sorted) {
    if (slots <= 0) break

    if (!isEligible(issue, state, config)) continue

    // Per-state enforcement: isEligible checks current running count, but we
    // must also account for issues already dispatched in this same tick.
    const stateKey = issue.state.trim().toLowerCase()
    const stateLimit = config.max_concurrent_agents_by_state[stateKey]
    if (stateLimit !== undefined) {
      const alreadyRunning = [...state.running.values()].filter(
        (e) => e.issue.state.trim().toLowerCase() === stateKey,
      ).length
      const dispatchedThisTick = perStateDispatchedThisTick.get(stateKey) ?? 0
      if (alreadyRunning + dispatchedThisTick >= stateLimit) continue
      perStateDispatchedThisTick.set(stateKey, dispatchedThisTick + 1)
    }

    log(`Dispatching ${issue.identifier} (attempt 1)`)
    state.claim(issue.id)
    callbacks.dispatchIssue(issue, 1)
    slots--
  }
}
