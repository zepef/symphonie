import { Issue, ResolvedConfig } from '../types'
import { fetchCandidateIssues } from '../tracker/linear'
import { OrchestratorState } from './state'
import { reconcile } from './reconcile'
import { sortCandidates, availableSlots } from './dispatch'

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

  for (const issue of sorted) {
    if (slots <= 0) break

    // Skip if already claimed or running
    if (state.claimed.has(issue.id) || state.running.has(issue.id)) continue

    // Skip if in retry queue — will self-dispatch when timer fires
    if (state.retryAttempts.has(issue.id)) continue

    // Check if issue has existing retry attempt data
    const retryEntry = state.retryAttempts.get(issue.id)
    const attempt = retryEntry ? retryEntry.attempt : 1

    log(`Dispatching ${issue.identifier} (attempt ${attempt})`)
    state.claim(issue.id)
    callbacks.dispatchIssue(issue, attempt)
    slots--
  }
}
